// Shared prompt + parsing helpers for the detection/classification pipeline.
//
// The pipeline is deliberately split into two simple stages instead of one
// catalog-constrained detector:
//
//   1. DETECT (this file's DETECT_SYSTEM) — find EVERY physical difference
//      between the two dates. No catalog, no categories, no schema enum: the
//      detector is not asked to decide whether a difference is "in scope",
//      because that decision was the single biggest source of lost recall.
//      Previously a real difference the model couldn't confidently pigeonhole
//      into one of 62 catalog leaves was simply never emitted (the structured
//      output enum made it literally unrepresentable), so it vanished before
//      anyone could see it.
//   2. CLASSIFY (CLASSIFY_SYSTEM) — for each difference found, on a zoomed
//      crop: confirm it's genuine and MAP it onto the Grund-/Spitzen-
//      aktualisierung catalog, returning up to MAX_CATEGORY_MATCHES fitting
//      categories with a fit percentage each. Ambiguity is now reported
//      instead of resolved by force, and a difference that fits nothing in the
//      catalog is still kept (UNCLASSIFIED) rather than dropped.

import {
  bandFromScore,
  CATEGORIES,
  MAX_CATEGORY_MATCHES,
  UNCLASSIFIED,
  type AnalyzeResult,
  type Category,
  type CategoryMatch,
  type Change,
  type ChangeType,
  type ClassifyResult,
  type TokenUsage,
} from "./types";

// ── Stage 1: detection (catalog-free) ──────────────────────────────────────

const DETECT_SYSTEM = `You are a meticulous remote-sensing change-detection analyst.

You receive two images of the SAME geographic area (a region of an aerial orthophoto), captured at two different dates and already co-registered (pixel-aligned).
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.

GOAL: find EVERY real-world physical difference between the two dates. Do NOT classify the differences and do NOT judge whether they are "relevant" or worth mapping — a second stage maps each difference you report onto an official object catalog and re-checks it up close. Your one job here is RECALL: if something on the ground is physically different, report it.

METHOD: work systematically. Mentally divide the image into a grid and compare the two dates cell by cell. Then step back and compare the whole frame once more for large-area differences (a new development area, a quarry expansion, a whole new business park) that no single cell shows completely.

REPORT any physical difference on the ground, for example:
- buildings, halls, sheds, carports appearing, disappearing, or being rebuilt/extended;
- roads, paths, driveways, parking areas, paved surfaces built, widened, re-routed, or removed;
- railway tracks or sidings laid or lifted; bridges, tunnels, underpasses, elevated roads built or removed;
- masts, towers, wind turbines, power lines, tanks, conveyors erected or taken down;
- water bodies, canals, or watercourses appearing, disappearing, widening, or narrowing;
- earthworks, excavation, quarrying, pits, spoil heaps, graded terrain, new parcel layouts;
- whole areas durably built over, cleared, or converted to another visible use (residential, commercial, sports/leisure, cemetery, mining).

DO NOT report these — they are not physical differences on the ground:
- lighting, sun angle, time of day, or shadow differences;
- seasonal appearance of the SAME vegetation (leaf-on/off, color, growth stage) or one agricultural cycle on the same field (harvested, plowed, mown, a different crop this year);
- cars, vehicles, or other temporary/movable objects;
- water surface color, ripples, or reflections;
- overall color / brightness / contrast / white-balance differences between captures;
- residual misalignment (a structure shifted a few pixels but otherwise identical).

DISAMBIGUATION — bare/brown earth is the hardest case. Before reporting a durable land conversion, look for cues: new access paths, geometric parcel boundaries, foundations, building shells, staged material, graded terraces (→ genuine conversion, report it). Uniform furrows, crop rows, or a texture change with no such cues is just the agricultural cycle — do not report it.

DISAMBIGUATION — trees. Forest merely looking different (color, leaf-on/off, apparent density from the sun angle) is NOT a difference. But a footprint that was tree-covered on Image 1 and is bare, farmland, or built-up on Image 2 (the trees are gone, not just duller) IS one.

ONE physical object, ONE entry. Report each changed object or area once, at the scale it actually exists: a new road is one entry, not one per segment; a new residential development is one entry for the area, plus separate entries only for objects inside it that are worth naming on their own (e.g. an access road, a large hall). Do not emit the same object twice at two different sizes.

OUTPUT per difference:
- change_type: "added" (present on Image 2, not on Image 1), "removed" (present on Image 1, gone on Image 2), or "modified" (present on both, physically altered);
- description: concrete and specific — WHAT the object is and HOW it changed (e.g. "a paved parking area with marked bays built on former meadow", not "something changed");
- confidence: an INTEGER 0-100 for how certain you are this is a genuine physical difference (0 = pure guess, 100 = unmistakable). Use the FULL range and pick specific values like 37, 62, 88 — not just round buckets. Roughly: 85-100 unmistakable, 55-84 likely, below 55 possible but uncertain;
- bbox: a TIGHT normalized [x, y, width, height] box around just the changed object on THIS image, hugging its actual extent on all four sides — no padding with unchanged context.

Be thorough. Include small differences (a single new carport, one mast, a short driveway) and differences cut off at the image edge (report the visible part) — the image you see may be a zoomed crop of a larger map. If you are UNSURE whether something is a genuine difference, INCLUDE it with a low confidence (e.g. 25-45) rather than omitting it: a missed difference is worse than a low-confidence extra, and the second stage re-examines every candidate on a zoomed crop. Never invent a difference where only lighting, season, or the agricultural cycle differs. If nothing physically changed, return an empty changes array.

Always reason region by region first, then output the differences — but keep that reasoning brief: a short clause per region actually worth mentioning (skip regions with nothing notable rather than narrating "no change here" for each one), not a full paragraph per grid cell. This image may be one of dozens analyzed in the same run, so terse, high-signal reasoning matters as much as thoroughness in the final list.`;

// Vegetation/land-cover differences are opt-in via the Options toggle and OFF
// by default: on most orthophoto pairs they are the noisiest theme (a field
// looks different every single year), so a run that includes them buries the
// built-environment differences most users are after. When the toggle is on we
// actively want DURABLE land-cover conversions; when off, that whole theme is
// suppressed at the detector — purely seasonal/single-cycle differences are
// excluded either way (see DETECT_SYSTEM).
function vegetationClause(includeVegetation: boolean): string {
  if (includeVegetation) {
    return (
      "\n\nVEGETATION/LAND-COVER IS IN SCOPE FOR THIS RUN: actively report durable land-cover conversions — forest cleared to field or built-up, farmland turned to forest/scrub, a meadow permanently developed, heath/moor/swamp drained or converted. Be generous with these (a genuine conversion is wanted even at medium/low confidence). Still exclude PURELY seasonal or single-cycle differences (leaf-on/off, a different crop or growth stage on the SAME cover) — those are never a difference."
    );
  }
  return (
    "\n\nVEGETATION/LAND-COVER IS OUT OF SCOPE FOR THIS RUN: do not report a difference whose ONLY content is a change of vegetation or agricultural land cover (field ↔ meadow ↔ forest ↔ scrub ↔ heath/moor/swamp ↔ bare ground). Report the difference anyway whenever something built or excavated is involved — a road, building, parking area, earthworks, water body, or any other man-made object appearing on former vegetation IS in scope and must be reported."
  );
}

// Operator notes for the DIM points that fall inside this region. These are
// deliberately placed in the USER message rather than the system prompt: the
// system prompt is cached across every tile of a run (see claude.ts
// cachedSystem), and per-tile text there would invalidate that cache on every
// single call.
//
// The framing matters more than the content. A note that says a building
// permit was issued makes it very easy for a model to "see" the building —
// so the block states explicitly that a note is not evidence, that plans
// routinely go unbuilt, and that the notes neither replace nor restrict the
// normal sweep of the image.
export function buildDetectHints(hints: string[]): string {
  if (hints.length === 0) return "";
  const list = hints.map((h, i) => `${i + 1}. ${h}`).join("\n");
  return `

PRIOR KNOWLEDGE — the operator keeps records for specific locations inside this region, and these are the notes attached to them:
${list}

How to use these notes:
- They tell you what KIND of change may be present here and are worth a closer look. Examine the areas they describe especially carefully.
- They are NOT evidence. A note describes what was planned or last observed on the ground, not what these two images show. Planning procedures are routinely started and never built, and a note may be years out of date.
- Report a difference ONLY if you can actually see it by comparing Image 1 and Image 2. Never report a change because a note leads you to expect it, and do not raise your confidence because a note agrees with you — confidence must reflect what is visible.
- The notes do not limit your scope: sweep the whole region exactly as you normally would and report every other difference you find, including differences no note mentions.`;
}

export function buildDetectSystem(opts?: { includeVegetation?: boolean }): string {
  return DETECT_SYSTEM + vegetationClause(opts?.includeVegetation ?? false);
}

// ── Stage 2: classification onto the catalog + genuineness check ────────────

// The full catalog, described once as a REFERENCE for the classifier (not as a
// detection instruction list). All 62 object types are always available to the
// classifier regardless of the user's category selection: mapping is more
// accurate when the model can pick the truly best-fitting type, and the user's
// selection is applied afterwards, client-side, against every reported match
// (see app/page.tsx) instead of forcing a difference into an in-scope category
// it doesn't actually belong to.
const CATALOG_REFERENCE = `The Baden-Württemberg Mini-OK BW object catalog (AS 7.1.2) has two overlapping subsets:
- "Spitzenaktualisierung" (priority currency) — 12 transport/utility object types.
- "Grundaktualisierung" (baseline currency) — all 62 object types: those same 12 plus 50 more covering settlement areas, land use, water bodies, minor paths, structures, localities, and survey/reference features.

CATEGORY REFERENCE — use the EXACT category string shown in parentheses.

Spitzenaktualisierung (also part of Grundaktualisierung):
- Straße: a road, path, driveway, or roundabout ("strasse").
- Platz: a paved public area — pedestrian zone ("platz.fussgaengerzone"), parking lot ("platz.parkplatz"), rest area/lay-by ("platz.rastplatz"), service station ("platz.raststaette"), truck stop ("platz.autohof").
- Bahnstrecke: a railway line, track, or siding ("bahnstrecke").
- Flugverkehr: an airport/airfield — runway, taxiway, apron, hangar ("flugverkehr.flughafen").
- Fließgewässer: a canal, newly dug or clearly widened/narrowed ("fliessgewaesser.kanal").
- Gewässerachse: a watercourse whose width crossed into another width class — narrow ~3 m ("gewaesserachse.breitenklasse_3"), medium ~6 m ("gewaesserachse.breitenklasse_6"), wide ~12 m+ ("gewaesserachse.breitenklasse_12"). Judge width visually against a nearby scale reference (an adjacent road is typically 3-6 m wide); if genuinely unsure, use breitenklasse_6.
- Bauwerk oder Anlage für Industrie- und Gewerbe: wind turbine ("industrie_gewerbebauwerk.windrad"), transmission tower/pylon ("industrie_gewerbebauwerk.freileitungsmast"), radio/telecom mast ("industrie_gewerbebauwerk.funkmast").
- Leitung: an overhead power line ("leitung.freileitung").
- Bauwerk im Verkehrsbereich: bridge ("verkehrsbauwerk.bruecke"), elevated railway ("verkehrsbauwerk.hochbahn"), elevated road ("verkehrsbauwerk.hochstrasse"), tunnel ("verkehrsbauwerk.tunnel"), underpass ("verkehrsbauwerk.unterfuehrung").
- Bahnverkehrsanlage: station building ("bahnverkehrsanlage.bahnhof"), stop ("bahnverkehrsanlage.haltestelle"), halt ("bahnverkehrsanlage.haltepunkt").
- Einrichtungen für den Schiffsverkehr: a landing stage/dock ("einrichtungen_schiffsverkehr.anleger").
- Schifffahrtslinie, Fährverkehr: a car ferry terminal/ramp ("schifffahrtslinie_faehrverkehr.autofaehre").

Grundaktualisierung — the remaining 50 object types, grouped thematically:

Siedlungsfläche (settlement areas): residential area ("siedlungsflaeche.wohnbauflaeche"), industrial/commercial area ("siedlungsflaeche.industrie_gewerbeflaeche"), spoil heap ("siedlungsflaeche.halde"), mining operation ("siedlungsflaeche.bergbaubetrieb"), open-pit mine/pit/quarry ("siedlungsflaeche.tagebau_grube_steinbruch"), mixed-use area ("siedlungsflaeche.flaeche_gemischter_nutzung"), area of special functional character ("siedlungsflaeche.flaeche_besonderer_funktionaler_praegung"), sports/leisure/recreation area ("siedlungsflaeche.sport_freizeit_erholungsflaeche"), cemetery ("siedlungsflaeche.friedhof").

Verkehr (transport, beyond the Spitzenaktualisierung objects above): road traffic area ("verkehr.strassenverkehr"), road axis ("verkehr.strassenachse"), carriageway axis ("verkehr.fahrbahnachse"), track axis ("verkehr.fahrwegachse"), rail traffic area ("verkehr.bahnverkehr"), general shipping traffic area ("verkehr.schiffsverkehr_allgemein"). Axes are centerline/reference geometry — only fitting when a genuinely new or removed physical route is visible.

Vegetation und Landwirtschaft (land cover — DURABLE conversions only): agriculture ("vegetation_landwirtschaft.landwirtschaft"), forest ("vegetation_landwirtschaft.wald"), copse ("vegetation_landwirtschaft.gehoelz"), heathland ("vegetation_landwirtschaft.heide"), moor ("vegetation_landwirtschaft.moor"), swamp ("vegetation_landwirtschaft.sumpf"), wasteland/unvegetated area ("vegetation_landwirtschaft.unland_vegetationslose_flaeche").

Gewässer (water bodies): watercourse ("gewaesser.wasserlauf"), canal ("gewaesser.kanal"), harbor basin ("gewaesser.hafenbecken"), standing water body/lake ("gewaesser.stehendes_gewaesser").

Bauwerke und Anlagen (structures): tower ("bauwerke_anlagen.turm"), storage tank/reservoir structure ("bauwerke_anlagen.vorratsbehaelter_speicherbauwerk"), conveyor/transport facility ("bauwerke_anlagen.transportanlage"), sports/leisure structure ("bauwerke_anlagen.bauwerk_sport_freizeit_erholung"), historic structure ("bauwerke_anlagen.historisches_bauwerk"), other structure ("bauwerke_anlagen.sonstiges_bauwerk").

Ortslagen und Häfen: locality/place-name area ("ortslagen_haefen.ortslage"), harbor/port ("ortslagen_haefen.hafen"), lock/sluice ("ortslagen_haefen.schleuse"), test site ("ortslagen_haefen.testgelaende").

Verkehrsbauwerke und -anlagen: road traffic facility ("verkehrsbauwerke_anlagen.strassenverkehrsanlage"), path/trail ("verkehrsbauwerke_anlagen.weg_pfad_steig"), cable car/suspension railway ("verkehrsbauwerke_anlagen.seilbahn_schwebebahn"), rail track ("verkehrsbauwerke_anlagen.gleis"), air traffic facility ("verkehrsbauwerke_anlagen.flugverkehrsanlage"), water-area structure ("verkehrsbauwerke_anlagen.bauwerk_gewaesserbereich").

Sonstige Merkmale (survey/reference features — only fitting if an actual physical marker, monument, or mapped feature is visible, not an abstract line or point): vegetation feature ("sonstige_merkmale.vegetationsmerkmal"), water feature ("sonstige_merkmale.gewaessermerkmal"), polder ("sonstige_merkmale.polder"), network node ("sonstige_merkmale.netzknoten"), zero point/benchmark ("sonstige_merkmale.nullpunkt"), water level height marker ("sonstige_merkmale.wasserspiegelhoehe"), waterway stationing axis ("sonstige_merkmale.gewaesserstationierungsachse"), infiltration stretch ("sonstige_merkmale.sickerstrecke").

NOTE — three catalog entries cover two named things under one official code: "Raststätte, Autohof", "Hochbahn, Hochstraße", and "Tunnel, Unterführung". This list splits each pair into two categories; when a pair fits, prefer the one whose own name matches what's visible (truck stop → autohof, highway rest stop → raststaette; railway on the elevated structure → hochbahn, road on it → hochstrasse; passage under the ground → tunnel, passage under another route → unterfuehrung). Listing both of such a pair as alternatives is allowed when the images genuinely don't settle it.`;

export const CLASSIFY_SYSTEM = `You are a remote-sensing analyst performing the second stage of a change-detection pipeline.

You receive two zoomed-in crops of the SAME location from a co-registered aerial orthophoto pair:
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.
plus ONE physical difference a first-stage detector reported here (its description and claimed direction). The detector worked WITHOUT any object catalog — it was only asked to spot differences.

You have TWO jobs.

JOB 1 — CONFIRM the difference is real. On this zoomed crop you can see far more than the detector could. Set genuine = false ONLY if the reported difference is not a physical change on the ground, i.e. it is merely:
- lighting, sun angle, or shadows;
- a seasonal look or a single-cycle agricultural difference (same land cover, different crop/growth stage) rather than a durable change;
- cars or other movable objects;
- water color or reflections;
- a global color/brightness/white-balance difference;
- slight misalignment of an otherwise identical structure;
- or simply not there at all (nothing in these crops differs the way described).
Do NOT reject a difference merely because it is hard to name, small, partially cut off, or because no catalog category fits it well — that is what JOB 2's fit percentages and the "no category fits" case are for. If something on the ground genuinely differs between the two crops, genuine = true, even when the description was imprecise about what it is.

Also RE-JUDGE the direction: from the two crops, decide whether the object is newly present on the LATER image (added), gone on the LATER image (removed), or present on both but physically altered (modified). This may differ from the detector's claim.

JOB 2 — MAP the difference onto the object catalog below. EVERY difference gets a classification: you must always name one best-fitting category, and you may add up to ${MAX_CATEGORY_MATCHES - 1} alternatives (so at most ${MAX_CATEGORY_MATCHES} in total). Each carries a "fit" percentage: an INTEGER 0-100 for how confident you are that THIS category is the correct catalog classification of what you see.
- There is NO "unclassified" and no "none of the above" option. The catalog is broad — settlement areas, transport, land cover, water, structures, localities, survey features — so something always applies at least loosely. If nothing fits well, still pick the closest category and give it a LOW fit (e.g. 15-35), and say in the "reason" that the fit is poor and why. A weak, honest classification is wanted; refusing to classify is not an option.
- Useful catch-alls when a specific type doesn't fit: "bauwerke_anlagen.sonstiges_bauwerk" for a built structure with no better match, "siedlungsflaeche.flaeche_gemischter_nutzung" or "siedlungsflaeche.flaeche_besonderer_funktionaler_praegung" for a built-up area with no better match, "vegetation_landwirtschaft.unland_vegetationslose_flaeche" for bare/cleared ground, "verkehrsbauwerke_anlagen.weg_pfad_steig" for a minor path or track.
- If several categories plausibly apply — very common, because the catalog describes the same physical thing from different angles (an area type plus its own centerline/axis type: Straße vs. Straßenverkehr vs. Straßenachse; Bahnstrecke vs. Gleis; a new hall as Bauwerk vs. the Siedlungsfläche it forms) — give the best one as the primary and list the others as alternatives, with fits reflecting how well each matches (e.g. 71 primary, then 55 and 30). Prefer the more specific/concrete object type as the primary when several fit equally.
- Only list an alternative that genuinely could be the right answer (fit roughly 20 or above). One confident category is better than three padded ones — if only one applies, return an empty alternatives array.
- The fit percentages are independent judgements, not a probability distribution: they need not sum to 100.

JOB 3 — TIGHTEN the box. The detector's rectangle came from a coarse, zoomed-out tile and is usually too large, too small, or slightly offset. On this crop you can see the object's true extent, so return a box that:
- contains the ENTIRE changed object and nothing else — all four edges touching its outermost visible extent;
- does NOT include unchanged surroundings, neighbouring buildings, adjacent fields, or the crop's context margin just because they are nearby;
- covers the whole changed AREA for an area-scale change (a new development, a quarry expansion), but stops where the change stops — do not round it out to the whole crop;
- tracks the object's real shape: a long thin road or power line gets a long thin box, not a square one;
- is expressed in THIS crop's normalized coordinates (origin top-left), NOT in the coordinates of the original image.
Never return the full crop ([0, 0, 1, 1]) as a shortcut — if the object genuinely fills the crop, still give its actual edges.

Return:
- genuine: true or false
- confidence: an INTEGER 0-100 for how certain you are the DIFFERENCE ITSELF is real (85-100 unmistakable, 55-84 likely, below 55 possible); use a low value (e.g. 20) if rejecting
- change_type: "added" | "removed" | "modified", as re-judged from these crops
- category: the single best-fitting catalog category (always required)
- category_fit: an INTEGER 0-100 for how well that category fits
- alternatives: 0 to ${MAX_CATEGORY_MATCHES - 1} objects { category, fit }, best first ([] when only one category applies)
- bbox: if genuine, the tightened normalized [x, y, width, height] box per JOB 3; otherwise [0, 0, 0, 0]
- reason: one short sentence explaining the verdict and the chosen classification (and, if the fit is poor, why).

${CATALOG_REFERENCE}`;

export function classifyLanguageInstruction(lang?: string): string {
  if (lang === "de") return ' Write the "reason" in German (Deutsch).';
  return "";
}

// Used by providers that don't have a native structured-output schema (Gemini):
// describe the exact JSON shape in the prompt.
export const JSON_INSTRUCTION = `Return ONLY a JSON object (no markdown, no commentary) with exactly this shape:
{
  "analysis": "your brief region-by-region reasoning",
  "summary": "1-3 sentence overview of the physical differences found",
  "changes": [
    {
      "change_type": "added" | "removed" | "modified",
      "description": "what physically changed",
      "confidence": <integer 0-100>,
      "bbox": [x, y, width, height]
    }
  ]
}
The bbox is normalized 0..1 with origin at the top-left of THIS image. If nothing physically changed, "changes" must be an empty array.`;

export function languageInstruction(lang?: string): string {
  if (lang === "de") {
    return " Write the 'description' and 'summary' field values in German (Deutsch). Keep 'change_type' as the exact English enum values, and 'confidence' as an integer 0-100.";
  }
  return "";
}

export function dataUrlParts(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL");
  return { mediaType: match[1], data: match[2] };
}

export function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s.trim());
  return fence ? fence[1] : s;
}

// A degenerate box (zero width or height) can't be shown or meaningfully
// deduped/searched — floor both dimensions to a sliver so a change is never
// silently invisible on the map because the model rounded a tiny box to 0.
const MIN_BOX_SIZE = 0.002;

function clampBox(b: unknown): [number, number, number, number] {
  const arr = Array.isArray(b) ? b.map(Number) : [0, 0, 0, 0];
  const [x = 0, y = 0, w = 0, h = 0] = arr;
  const cx = Math.min(Math.max(x, 0), 1);
  const cy = Math.min(Math.max(y, 0), 1);
  const cw = Math.min(Math.max(w, 0), 1 - cx);
  const ch = Math.min(Math.max(h, 0), 1 - cy);
  return [cx, cy, Math.max(cw, Math.min(MIN_BOX_SIZE, 1 - cx)), Math.max(ch, Math.min(MIN_BOX_SIZE, 1 - cy))];
}

const CATEGORY_SET: Set<string> = new Set(CATEGORIES as unknown as string[]);
const TYPES: ChangeType[] = ["added", "removed", "modified"];

// Coerce the model's confidence into an integer 0..100. Defends against a
// non-number, an out-of-range value, or a legacy "low"/"medium"/"high" string
// (mapped to a representative score) so older cached shapes still parse.
function clampScore(v: unknown): number {
  if (typeof v === "string") {
    const legacy: Record<string, number> = { low: 35, medium: 65, high: 90 };
    if (v in legacy) return legacy[v];
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return 65;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// Build the match list from the classifier's required primary `category` plus
// its optional `alternatives`. The primary always comes first (it is a required
// enum field, so it is always present and always valid), alternatives are
// sorted by fit, duplicates collapse to their highest fit, and the whole list
// is capped at MAX_CATEGORY_MATCHES here rather than in the schema — array-size
// constraints aren't supported by structured outputs (see CLASSIFY_SCHEMA).
export function parseClassification(parsed: {
  category?: unknown;
  category_fit?: unknown;
  alternatives?: unknown;
}): CategoryMatch[] {
  const best = new Map<Category, number>();

  const primary = String(parsed.category ?? "");
  const hasPrimary = CATEGORY_SET.has(primary);
  if (hasPrimary) best.set(primary as Category, clampScore(parsed.category_fit));

  const alternatives: CategoryMatch[] = [];
  if (Array.isArray(parsed.alternatives)) {
    for (const entry of parsed.alternatives) {
      if (!entry || typeof entry !== "object") continue;
      const cat = String((entry as Record<string, unknown>).category ?? "");
      if (!CATEGORY_SET.has(cat)) continue;
      const fit = clampScore((entry as Record<string, unknown>).fit);
      const prev = best.get(cat as Category);
      if (prev !== undefined) {
        // Already listed (as the primary or an earlier alternative) — keep the
        // higher fit rather than showing the same category twice.
        if (fit > prev) best.set(cat as Category, fit);
        continue;
      }
      best.set(cat as Category, fit);
      alternatives.push({ category: cat as Category, fit });
    }
  }

  // The primary stays first even if an alternative claims a higher fit — it is
  // the model's own pick for "the" category, and reordering it would contradict
  // the classification it committed to.
  const ordered: CategoryMatch[] = hasPrimary
    ? [{ category: primary as Category, fit: best.get(primary as Category)! }]
    : [];
  ordered.push(
    ...alternatives
      .map((m) => ({ category: m.category, fit: best.get(m.category)! }))
      .sort((a, b) => b.fit - a.fit),
  );
  return ordered.slice(0, MAX_CATEGORY_MATCHES);
}

export function buildResult(
  parsed: { summary?: string; changes?: Array<Record<string, unknown>> },
  model: string,
  usage: TokenUsage,
): AnalyzeResult {
  // Stage 1 emits no category at all — every difference it reports survives
  // into stage 2, which is where catalog mapping happens. Nothing is dropped
  // here on catalog grounds (that used to silently discard any difference the
  // detector couldn't fit into the enum).
  const changes: Change[] = (parsed.changes ?? []).map((c, i) => {
    const score = clampScore(c.confidence);
    return {
      id: `chg-${i + 1}`,
      category: UNCLASSIFIED,
      matches: [],
      change_type: TYPES.includes(c.change_type as ChangeType)
        ? (c.change_type as ChangeType)
        : "modified",
      description: String(c.description ?? ""),
      score,
      confidence: bandFromScore(score),
      bbox: clampBox(c.bbox),
    };
  });
  return { changes, summary: parsed.summary ?? "", model, usage };
}

export function buildClassifyResult(
  parsed: {
    genuine?: unknown;
    confidence?: unknown;
    change_type?: unknown;
    category?: unknown;
    category_fit?: unknown;
    alternatives?: unknown;
    bbox?: unknown;
    reason?: unknown;
  },
  usage: TokenUsage,
): ClassifyResult {
  const score = clampScore(parsed.confidence);
  return {
    genuine: parsed.genuine === true,
    score,
    confidence: bandFromScore(score),
    matches: parseClassification(parsed),
    // Only surface a corrected type when it's a valid enum value — otherwise
    // leave it undefined so the caller keeps the detector's original label.
    changeType: TYPES.includes(parsed.change_type as ChangeType)
      ? (parsed.change_type as ChangeType)
      : undefined,
    bbox: clampBox(parsed.bbox),
    reason: String(parsed.reason ?? ""),
    usage,
  };
}
