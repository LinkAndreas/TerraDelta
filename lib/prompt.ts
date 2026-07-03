// Shared prompt + parsing helpers used by every provider, so Anthropic and
// Gemini analyze identically and return the same structure.

import {
  CATEGORIES,
  type AnalyzeResult,
  type Change,
  type ChangeType,
  type Confidence,
  type VerifyResult,
} from "./types";

export const SYSTEM = `You are a meticulous remote-sensing change-detection analyst.

You receive two images of the SAME geographic area (a region of an aerial orthophoto), captured at two different dates and already co-registered (pixel-aligned).
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.

GOAL: detect real-world semantic changes to the BUILT ENVIRONMENT and LAND USE with both HIGH PRECISION and HIGH RECALL.

METHOD: Work systematically. Mentally divide the image into a grid and compare the two dates cell by cell. For each location ask: "Did a man-made structure or the land use actually, physically change here?"

REPORT these (one entry each):
- Buildings / houses / halls / sheds: newly built, demolished/removed, or visibly modified (footprint extended, new wing, roof replaced or re-structured, rooftop solar panels added).
- Construction activity: a building site appearing (foundations, excavated bare ground, cranes, staged materials) where there was none.
- NEW DEVELOPMENT AREAS (residential subdivisions, commercial/industrial parks — German "Neubaugebiet"): a field, meadow, or forest being turned into a development, at ANY stage — land cleared or graded, streets and parcels laid out, utility trenches, foundations, building shells, or finished houses. Report the overall converted area as ONE change with category "plot" (change_type "added"), AND additionally report each clearly identifiable new building and new road inside it as its own entry.
- Roads / paths / driveways / parking lots / roundabouts / bridges: added, removed, widened, or newly paved.
- Durable, human-driven land development: a quarry/gravel pit or pond newly dug or clearly expanded; land cleared/graded for construction.
- New permanent installations: solar farms, swimming pools, large tanks/silos, new walls or fences enclosing a newly developed area.

DO NOT REPORT (these are NOT semantic changes — reporting them is an error):
- Lighting, sun angle, time of day, or shadow differences.
- Seasonal vegetation: leaf-on vs leaf-off, green vs brown grass, tree/forest color, growth stage. Forest looking different in color or density is NOT a change.
- Agricultural cycle: harvested vs unharvested, plowed vs planted, mown vs grown, a different crop. (Only report if the land was PERMANENTLY converted to non-agricultural use.)
- Cars, vehicles, or other temporary/movable objects.
- Water surface color, ripples, or reflections.
- Overall color / brightness / contrast / white-balance differences between captures.
- Minor residual misalignment (a structure shifted a few pixels but otherwise identical is NOT a change).

DISAMBIGUATION — bare/brown earth is the hardest case. Before dismissing a bare-earth area as agriculture, check for development cues: new access roads or curbs cutting through it, geometric parcel boundaries, foundations or footings, building shells, cranes, staged material piles, utility trenches, sharply graded terraces. ANY of these means it is construction/development — report it. Uniform furrows, crop rows, or a texture change with NO new infrastructure means agriculture — do not report it.

OUTPUT per change: category, change_type (added/removed/modified), a concise description of what changed, confidence (high = unmistakable, medium = likely, low = possible), and a TIGHT normalized [x, y, width, height] box around just the changed object on THIS image. For area-scale changes (a whole development, a quarry expansion) the box covers the whole affected area.

Be thorough — list EVERY genuine structural / infrastructure / land-development change, including small single houses and short driveways. The image you see may be a zoomed crop of a larger map; a change partially cut off at the edge still counts — report the visible part. If you are UNSURE whether a candidate is a genuine change, include it with confidence "low" rather than omitting it — a missed real change is worse than a low-confidence extra. But never invent changes where only vegetation, season, lighting, or the agricultural cycle differs. If nothing genuine changed, return an empty changes array.

Always reason region by region first, then output the changes.`;

// Second-pass verifier: judges ONE candidate change on a zoomed-in crop.
// The detector pass is tuned for recall; this pass restores precision.
export const VERIFY_SYSTEM = `You are a strict remote-sensing change-detection verifier.

You receive two zoomed-in crops of the SAME location from a co-registered aerial orthophoto pair:
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.
plus ONE candidate change that a first-pass detector claims to see here.

Your job: decide whether the claimed change is GENUINE — a real physical change to the built environment or land use (a building/road/bridge/plot/water feature added, removed, or modified).

Judge strictly. REJECT the candidate if the difference is only:
- lighting, sun angle, or shadows;
- seasonal vegetation (leaf-on/off, color, growth) or the agricultural cycle (plowed/harvested/mown/different crop);
- cars or other movable objects;
- water color or reflections;
- global color/brightness/white-balance differences;
- slight misalignment of an otherwise identical structure.

But CONFIRM bare graded earth WITH development cues (new access roads or curbs, parcel layout, foundations, utility trenches, building shells, cranes, staged material piles) — that is genuine land development, even at an early stage.

Return:
- genuine: true or false
- confidence: certainty about the change if genuine (high = unmistakable, medium = likely, low = possible); use "low" if rejecting
- bbox: if genuine, a TIGHT normalized [x, y, width, height] box around the changed object in THIS crop (origin top-left); otherwise [0, 0, 0, 0]
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
All bbox values are normalized 0..1 with origin at the top-left of THIS image. If nothing genuine changed, "changes" must be an empty array.`;

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

function clampBox(b: unknown): [number, number, number, number] {
  const arr = Array.isArray(b) ? b.map(Number) : [0, 0, 0, 0];
  const [x = 0, y = 0, w = 0, h = 0] = arr;
  const cx = Math.min(Math.max(x, 0), 1);
  const cy = Math.min(Math.max(y, 0), 1);
  return [cx, cy, Math.min(Math.max(w, 0), 1 - cx), Math.min(Math.max(h, 0), 1 - cy)];
}

const TYPES: ChangeType[] = ["added", "removed", "modified"];
const CONFS: Confidence[] = ["low", "medium", "high"];

export function buildResult(
  parsed: { summary?: string; changes?: Partial<Change>[] },
  model: string,
): AnalyzeResult {
  const changes: Change[] = (parsed.changes ?? []).map((c, i) => ({
    id: `chg-${i + 1}`,
    category: String(c.category ?? "other"),
    change_type: TYPES.includes(c.change_type as ChangeType)
      ? (c.change_type as ChangeType)
      : "modified",
    description: String(c.description ?? ""),
    confidence: CONFS.includes(c.confidence as Confidence)
      ? (c.confidence as Confidence)
      : "medium",
    bbox: clampBox(c.bbox),
  }));
  return { changes, summary: parsed.summary ?? "", model };
}

export function buildVerifyResult(parsed: {
  genuine?: unknown;
  confidence?: unknown;
  bbox?: unknown;
  reason?: unknown;
}): VerifyResult {
  return {
    genuine: parsed.genuine === true,
    confidence: CONFS.includes(parsed.confidence as Confidence)
      ? (parsed.confidence as Confidence)
      : "medium",
    bbox: clampBox(parsed.bbox),
    reason: String(parsed.reason ?? ""),
  };
}
