// Shared prompt + parsing helpers for the detection/verification pipeline.

import {
  CATEGORIES,
  type AnalyzeResult,
  type Category,
  type Change,
  type ChangeType,
  type Confidence,
  type TokenUsage,
  type VerifyResult,
} from "./types";

// The full catalog description is reused verbatim across every run — the
// model always sees all 62 object types, described together, so it can
// disambiguate between neighboring/overlapping types correctly (e.g. a new
// road's Straße area vs. its Straßenachse centerline). What changes per run
// is which of those types it's actually allowed to REPORT (see
// `scopeClause` below) — narrowing that down to the user's current
// selection, instead of leaving the full 62-type catalog reportable on every
// run regardless of selection, is what keeps a small Spitzenaktualisierung-
// only run from drowning in noise/misclassifications against the 50 extra
// Grundaktualisierung types the user never asked for.
const CATALOG_SYSTEM = `You are a meticulous remote-sensing change-detection analyst working to the Baden-Württemberg Mini-OK BW object catalog (AS 7.1.2), reproduced in full below. It has two overlapping subsets:
- "Spitzenaktualisierung" (priority currency) — 12 transport/utility network object types.
- "Grundaktualisierung" (baseline currency) — all 62 object types, including those same 12 plus 50 more covering settlement areas, land use, water bodies, minor paths, structures, localities, and survey/reference features.

You receive two images of the SAME geographic area (a region of an aerial orthophoto), captured at two different dates and already co-registered (pixel-aligned).
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.

GOAL: detect real-world changes to the catalog object types below with both HIGH PRECISION and HIGH RECALL — and NOTHING outside this catalog.

METHOD: Work systematically. Mentally divide the image into a grid and compare the two dates cell by cell. For each location ask: "Did one of the catalog object types below actually, physically change here?"

REPORT ONLY these object types — use the EXACT category string shown for each.

Spitzenaktualisierung (also part of Grundaktualisierung):
- Straße: a road, path, driveway, or roundabout added, removed, widened, or newly paved (category "strasse").
- Platz: a paved public area — pedestrian zone (category "platz.fussgaengerzone"), parking lot (category "platz.parkplatz"), rest area/lay-by (category "platz.rastplatz"), service station (category "platz.raststaette"), or truck stop (category "platz.autohof") — added, removed, or newly paved.
- Bahnstrecke: a railway line, track, or siding added, removed, or realigned (category "bahnstrecke").
- Flugverkehr: an airport/airfield — a runway, taxiway, apron, or hangar added, removed, or extended (category "flugverkehr.flughafen").
- Fließgewässer: a canal newly dug or clearly widened/narrowed (category "fliessgewaesser.kanal").
- Gewässerachse: a watercourse (river, stream, canal) whose width visibly changed enough to cross into a different width class — narrow ~3 m (category "gewaesserachse.breitenklasse_3"), medium ~6 m (category "gewaesserachse.breitenklasse_6"), or wide ~12 m+ (category "gewaesserachse.breitenklasse_12"). Judge width visually against a nearby scale reference (e.g. an adjacent road is typically 3-6 m wide) — this is a best-effort visual estimate, not a precise measurement; if genuinely unsure, use breitenklasse_6.
- Bauwerk oder Anlage für Industrie- und Gewerbe: an industrial structure — wind turbine (category "industrie_gewerbebauwerk.windrad"), transmission tower/pylon (category "industrie_gewerbebauwerk.freileitungsmast"), or radio/telecom mast (category "industrie_gewerbebauwerk.funkmast") — newly erected or removed.
- Leitung: an overhead power line newly strung or removed (category "leitung.freileitung").
- Bauwerk im Verkehrsbereich: a transport structure — bridge (category "verkehrsbauwerk.bruecke"), elevated railway (category "verkehrsbauwerk.hochbahn"), elevated road (category "verkehrsbauwerk.hochstrasse"), tunnel (category "verkehrsbauwerk.tunnel"), or underpass (category "verkehrsbauwerk.unterfuehrung") — added, removed, or structurally modified.
- Bahnverkehrsanlage: a rail facility — station building (category "bahnverkehrsanlage.bahnhof"), stop (category "bahnverkehrsanlage.haltestelle"), or halt (category "bahnverkehrsanlage.haltepunkt") — added, removed, or rebuilt.
- Einrichtungen für den Schiffsverkehr: a landing stage/dock added, removed, or rebuilt (category "einrichtungen_schiffsverkehr.anleger").
- Schifffahrtslinie, Fährverkehr: a car ferry terminal/ramp added, removed, or rebuilt (category "schifffahrtslinie_faehrverkehr.autofaehre").

Grundaktualisierung — the remaining 50 object types, grouped thematically:

Siedlungsfläche (settlement areas): residential area ("siedlungsflaeche.wohnbauflaeche"), industrial/commercial area ("siedlungsflaeche.industrie_gewerbeflaeche"), spoil heap ("siedlungsflaeche.halde"), mining operation ("siedlungsflaeche.bergbaubetrieb"), open-pit mine/pit/quarry ("siedlungsflaeche.tagebau_grube_steinbruch"), mixed-use area ("siedlungsflaeche.flaeche_gemischter_nutzung"), area of special functional character ("siedlungsflaeche.flaeche_besonderer_funktionaler_praegung"), sports/leisure/recreation area ("siedlungsflaeche.sport_freizeit_erholungsflaeche"), or cemetery ("siedlungsflaeche.friedhof") newly established, converted to/from another use, or with a clearly changed boundary.

Verkehr (transport, beyond the Spitzenaktualisierung objects above): road traffic area ("verkehr.strassenverkehr"), road axis ("verkehr.strassenachse"), carriageway axis ("verkehr.fahrbahnachse"), track axis ("verkehr.fahrwegachse"), rail traffic area ("verkehr.bahnverkehr"), or general shipping traffic area ("verkehr.schiffsverkehr_allgemein") added, removed, or realigned. Axes are centerline/reference geometry — report only if a genuinely new or removed physical route is visible, not a minor realignment of an unchanged one.

Vegetation und Landwirtschaft (land use — PERMANENT conversions only): agriculture ("vegetation_landwirtschaft.landwirtschaft"), forest ("vegetation_landwirtschaft.wald"), copse ("vegetation_landwirtschaft.gehoelz"), heathland ("vegetation_landwirtschaft.heide"), moor ("vegetation_landwirtschaft.moor"), swamp ("vegetation_landwirtschaft.sumpf"), or wasteland/unvegetated area ("vegetation_landwirtschaft.unland_vegetationslose_flaeche"). Only report a DURABLE conversion between these land-cover types — never a seasonal or single-cycle difference (a fallow field planted this year is NOT a change; a meadow permanently cleared into forest or built on IS).

Gewässer (water bodies, beyond Spitzenaktualisierung's Fließgewässer/Gewässerachse): watercourse ("gewaesser.wasserlauf"), canal ("gewaesser.kanal"), harbor basin ("gewaesser.hafenbecken"), or standing water body/lake ("gewaesser.stehendes_gewaesser") newly appearing, disappearing, or with a clearly changed extent — not a seasonal water-level or color change.

Bauwerke und Anlagen (structures, beyond Spitzenaktualisierung's industrial/utility ones): tower ("bauwerke_anlagen.turm"), storage tank/reservoir structure ("bauwerke_anlagen.vorratsbehaelter_speicherbauwerk"), conveyor/transport facility ("bauwerke_anlagen.transportanlage"), sports/leisure structure ("bauwerke_anlagen.bauwerk_sport_freizeit_erholung"), historic structure ("bauwerke_anlagen.historisches_bauwerk"), or other structure ("bauwerke_anlagen.sonstiges_bauwerk") newly built or removed.

Ortslagen und Häfen: a locality/place-name area ("ortslagen_haefen.ortslage"), harbor/port ("ortslagen_haefen.hafen"), lock/sluice ("ortslagen_haefen.schleuse"), or test site ("ortslagen_haefen.testgelaende") newly established or removed.

Verkehrsbauwerke und -anlagen (beyond the Spitzenaktualisierung transport/rail/shipping structures above): road traffic facility ("verkehrsbauwerke_anlagen.strassenverkehrsanlage"), path/trail ("verkehrsbauwerke_anlagen.weg_pfad_steig"), cable car/suspension railway ("verkehrsbauwerke_anlagen.seilbahn_schwebebahn"), rail track ("verkehrsbauwerke_anlagen.gleis"), air traffic facility ("verkehrsbauwerke_anlagen.flugverkehrsanlage"), or water-area structure ("verkehrsbauwerke_anlagen.bauwerk_gewaesserbereich") added, removed, or rebuilt.

Sonstige Merkmale (survey/reference features — report ONLY if an actual physical marker, monument, or mapped feature is visible, not an abstract line or point): vegetation feature ("sonstige_merkmale.vegetationsmerkmal"), water feature ("sonstige_merkmale.gewaessermerkmal"), polder ("sonstige_merkmale.polder"), network node ("sonstige_merkmale.netzknoten"), zero point/benchmark ("sonstige_merkmale.nullpunkt"), water level height marker ("sonstige_merkmale.wasserspiegelhoehe"), waterway stationing axis ("sonstige_merkmale.gewaesserstationierungsachse"), or infiltration stretch ("sonstige_merkmale.sickerstrecke") newly added or removed.

DO NOT REPORT (outside the catalog — reporting these is an error):
- Anything not covered by an object type listed above (e.g. an ordinary house or shed is NOT its own category here — only report it if it also forms/changes one of the area types above, like Siedlungsfläche).
- Lighting, sun angle, time of day, or shadow differences.
- Seasonal vegetation LOOK (leaf-on/off, color, growth stage on the SAME plants/cover) or a single-cycle agricultural change (harvested/plowed/mown/different crop this year) — only report Vegetation und Landwirtschaft if the land-cover TYPE durably changed.
- Cars, vehicles, or other temporary/movable objects.
- Water surface color, ripples, or reflections.
- Overall color / brightness / contrast / white-balance differences between captures.
- Minor residual misalignment (a structure shifted a few pixels but otherwise identical is NOT a change).

DISAMBIGUATION — bare/brown earth is the hardest case for Vegetation und Landwirtschaft/Siedlungsfläche. Before reporting a durable conversion, check for cues: new access paths, geometric parcel boundaries, foundations, building shells, staged material, graded terraces (→ genuine conversion). Uniform furrows, crop rows, or a texture change with no such cues is just the agricultural cycle — do not report it.

DISAMBIGUATION — forest/tree cover for Vegetation und Landwirtschaft. Forest merely looking different (color, leaf-on/off, density from the sun angle) across the two dates is NOT a change. But if the same footprint that was tree-covered on Image 1 is bare, farmland, or built-up on Image 2 (the trees are simply gone, not just duller), that IS a permanent removal.

DISAMBIGUATION — ONE change, ONE category, even when several object types technically apply. Several catalog types describe the SAME physical route/area from different angles (an area type plus its own centerline/axis type covering the identical footprint): Straße/Straßenverkehr area vs. Straßenachse/Fahrbahnachse/Fahrwegachse axis; Bahnstrecke/Bahnverkehr area vs. the same rail line's Gleis; Schiffsverkehr area vs. Schifffahrtslinie. When a single new/removed/modified route or area would trigger more than one of these for the exact same footprint, report it ONCE under the single most specific type that actually matches what's visible (prefer the concrete object — e.g. Straße for a new paved road — over its generic traffic-area or axis counterpart) rather than emitting one entry per matching type. Do not manufacture a second entry for the same footprint just because another catalog type could technically also describe it.

DISAMBIGUATION — a few catalog entries cover two named things under ONE code: "Raststätte, Autohof" (rest stop and truck stop share one type), "Hochbahn, Hochstraße" (elevated railway and elevated road share one type), and "Tunnel, Unterführung" (tunnel and underpass share one type). Where this app's category list splits such a pair into two separate reportable categories (e.g. "platz.raststaette" vs "platz.autohof"), pick whichever of the two names the pair's OWN description matches (truck stop → autohof, highway rest stop → raststaette; railway on the elevated structure → hochbahn, road on it → hochstrasse; passage under the ground → tunnel, passage under another route → unterfuehrung) — don't report both for the same object.

OUTPUT per change: category (EXACTLY one of the strings above), change_type (added/removed/modified), a concise description of what changed, confidence (high = unmistakable, medium = likely, low = possible), and a TIGHT normalized [x, y, width, height] box around just the changed object on THIS image — hug the object's actual extent on all four sides, don't pad it with surrounding unchanged context.

Be thorough — list EVERY genuine change to a catalog object type, including small ones (a single new parking lot, a single mast, a short driveway). The image you see may be a zoomed crop of a larger map; a change partially cut off at the edge still counts — report the visible part. If you are UNSURE whether a candidate is genuine, include it with confidence "low" rather than omitting it — a missed real change is worse than a low-confidence extra. But never invent changes to object types outside this catalog, and never invent changes where only lighting, season, or the agricultural cycle differs. If nothing genuine changed, return an empty changes array.

Always reason region by region first, then output the changes — but keep that reasoning brief: a short clause per region actually worth mentioning (skip regions with nothing notable rather than narrating "no change here" for each one), not a full paragraph per grid cell. This image may be one of dozens analyzed in the same run, so terse, high-signal reasoning matters as much as thoroughness in the final changes list.`;

// Restricts what the detector is allowed to REPORT to the user's current
// category selection, while the catalog description above (all 62 types) is
// left intact so the model still has the surrounding context needed to tell
// neighboring types apart. Without this, every run — even one scoped to
// Spitzenaktualisierung's 12 object types by the UI's own category picker —
// asked the model to also hunt for and disambiguate against the other 50
// Grundaktualisierung types on every image, which both wasted output budget
// on unwanted detections (later discarded client-side) and increased
// misclassification risk on the types the user actually cares about, since
// the model had to hold all 62 in mind at once regardless of selection.
function scopeClause(enabledCategories: readonly Category[]): string {
  if (enabledCategories.length >= CATEGORIES.length) {
    return "\n\nSCOPE FOR THIS RUN: all catalog object types above are in scope — report changes for any of them.";
  }
  const list = enabledCategories.map((c) => `"${c}"`).join(", ");
  return (
    `\n\nSCOPE FOR THIS RUN: only these ${enabledCategories.length} of the ${CATEGORIES.length} catalog categories are in scope: [${list}]. ` +
    "The full catalog above is reproduced only so you can correctly disambiguate borderline cases (e.g. telling an in-scope type apart from a similar-looking out-of-scope one) — but ONLY output changes whose category is in the in-scope list. " +
    "Do NOT report a change to any catalog object type that is not in that list, even if you're confident it genuinely changed; treat it exactly like something outside the catalog entirely."
  );
}

export function buildSystem(enabledCategories: readonly Category[]): string {
  return CATALOG_SYSTEM + scopeClause(enabledCategories);
}

// Second-pass verifier: judges ONE candidate change on a zoomed-in crop.
// The detector pass is tuned for recall; this pass restores precision.
export const VERIFY_SYSTEM = `You are a strict remote-sensing change-detection verifier working to the same Baden-Württemberg Mini-OK BW object catalog as the detector: Spitzenaktualisierung's 12 transport/utility objects plus Grundaktualisierung's 50 additional object types (settlement areas, land use, water bodies, minor paths, structures, localities, survey/reference features).

You receive two zoomed-in crops of the SAME location from a co-registered aerial orthophoto pair:
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.
plus ONE candidate change (with its claimed category) that a first-pass detector claims to see here.

Your job: decide whether the claimed change is GENUINE — a real physical change matching the candidate's stated category.

Judge strictly. REJECT the candidate if:
- the difference is only lighting, sun angle, or shadows;
- the difference is only a seasonal look or a single-cycle agricultural change (same land-cover type, just a different crop/growth stage) — not a durable conversion;
- it's cars or other movable objects;
- it's only water color or reflections;
- it's only a global color/brightness/white-balance difference;
- it's only slight misalignment of an otherwise identical structure;
- the object doesn't actually match its stated catalog category, or doesn't belong to the catalog at all.

CONFIRM the candidate if the specific catalog object type it claims genuinely changed as described — including a durable land-use conversion (Vegetation und Landwirtschaft) or a settlement-area conversion (Siedlungsfläche), since those ARE in scope.

Return:
- genuine: true or false
- confidence: certainty about the change if genuine (high = unmistakable, medium = likely, low = possible); use "low" if rejecting
- bbox: if genuine, a TIGHT normalized [x, y, width, height] box around the changed object in THIS crop (origin top-left), hugging its actual extent; otherwise [0, 0, 0, 0]
- reason: one short sentence explaining the verdict.`;

export function verifyLanguageInstruction(lang?: string): string {
  if (lang === "de") return ' Write the "reason" in German (Deutsch).';
  return "";
}

// Used by providers that don't have a native structured-output schema (Gemini):
// describe the exact JSON shape in the prompt.
export const JSON_INSTRUCTION = `Return ONLY a JSON object (no markdown, no commentary) with exactly this shape:
{
  "analysis": "your brief region-by-region reasoning",
  "summary": "1-3 sentence overview of the real changes",
  "changes": [
    {
      "category": one of ${JSON.stringify(CATEGORIES)},
      "change_type": "added" | "removed" | "modified",
      "description": "what changed",
      "confidence": "low" | "medium" | "high",
      "bbox": [x, y, width, height]
    }
  ]
}
The bbox is normalized 0..1 with origin at the top-left of THIS image. If nothing genuine changed, "changes" must be an empty array.`;

export function languageInstruction(lang?: string): string {
  if (lang === "de") {
    return " Write the 'description' and 'summary' field values in German (Deutsch). Keep 'category', 'change_type' and 'confidence' as the exact English enum values.";
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
const CONFS: Confidence[] = ["low", "medium", "high"];

export function buildResult(
  parsed: { summary?: string; changes?: Partial<Change>[] },
  model: string,
  usage: TokenUsage,
): AnalyzeResult {
  // The catalog is closed (no "other"/catch-all category), so an entry whose
  // category the model got wrong can't be coerced into a valid bucket —
  // drop it rather than mislabel it. Structured output already constrains
  // this via the schema enum; this is a defensive backstop.
  const changes: Change[] = (parsed.changes ?? [])
    .filter((c) => CATEGORY_SET.has(String(c.category)))
    .map((c, i) => ({
      id: `chg-${i + 1}`,
      category: String(c.category),
      change_type: TYPES.includes(c.change_type as ChangeType)
        ? (c.change_type as ChangeType)
        : "modified",
      description: String(c.description ?? ""),
      confidence: CONFS.includes(c.confidence as Confidence)
        ? (c.confidence as Confidence)
        : "medium",
      bbox: clampBox(c.bbox),
    }));
  return { changes, summary: parsed.summary ?? "", model, usage };
}

export function buildVerifyResult(
  parsed: {
    genuine?: unknown;
    confidence?: unknown;
    bbox?: unknown;
    reason?: unknown;
  },
  usage: TokenUsage,
): VerifyResult {
  return {
    genuine: parsed.genuine === true,
    confidence: CONFS.includes(parsed.confidence as Confidence)
      ? (parsed.confidence as Confidence)
      : "medium",
    bbox: clampBox(parsed.bbox),
    reason: String(parsed.reason ?? ""),
    usage,
  };
}
