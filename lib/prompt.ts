// Shared prompt + parsing helpers used by every provider, so Anthropic and
// Gemini analyze identically and return the same structure.

import { CATEGORIES, type AnalyzeResult, type Change, type ChangeType, type Confidence } from "./types";

export const SYSTEM = `You are a meticulous remote-sensing change-detection analyst.

You receive two images of the SAME geographic area (a region of an aerial orthophoto), captured at two different dates and already co-registered (pixel-aligned).
- Image 1 = the EARLIER date.
- Image 2 = the LATER date.

GOAL: detect real-world semantic changes to the BUILT ENVIRONMENT and LAND USE with both HIGH PRECISION and HIGH RECALL.

METHOD: Use TWO complementary passes.
1. ZOOM-IN PASS: mentally divide the image into a grid and compare the two dates cell by cell. For each location ask: "Did a man-made structure or the land use actually, physically change here?"
2. STEP-BACK PASS: then look at the whole frame at once and compare the two dates holistically, scanning for LARGE-AREA land-use conversion that spans many cells — especially at the EDGE OF A SETTLEMENT, where open land becomes built-up. Diffuse area-wide changes are easy to miss cell-by-cell precisely because they are big; do not let their size hide them.

REPORT these (one entry each):
- Buildings / houses / halls / sheds: newly built, demolished/removed, or visibly modified (footprint extended, new wing, roof replaced or re-structured, rooftop solar panels added).
- Construction activity: a building site appearing (foundations, excavated bare ground, cranes, staged materials) where there was none.
- Roads / paths / driveways / parking lots / roundabouts / bridges: added, removed, widened, or newly paved.
- Durable, human-driven land development: a field, meadow or forest converted into a development, built-up area, industrial/commercial estate or quarry; a new street grid or row of plots appearing on former open land at a town's edge; a quarry/gravel pit or pond that was newly dug or clearly expanded; land cleared/graded for construction.
- Urban / settlement expansion: an area that was fields or vegetation in the EARLIER image but shows the geometric texture of development in the LATER image (regular rectangular parcels, straight new roads, rooftops, graded bare earth, hard man-made edges) — even if individual buildings are small. Report the converted area as one entry.
- New permanent installations: solar farms, swimming pools, large tanks/silos, new walls or fences enclosing a newly developed area.

DISCRIMINATOR — development vs. farming/season. The decisive cue is TEXTURE and GEOMETRY, not color. A patch that merely changed color or tone (green↔brown, lush↔bare) but keeps the SAME smooth, organic, agricultural texture is NOT a change. A patch that gained REGULAR GEOMETRIC STRUCTURE — straight edges, rectangular parcels, road lines, building footprints, uniformly graded earth — IS development, even if it used to be farmland. When a land-cover change shows any such man-made geometric structure, report it (use medium/low confidence if unsure) rather than dismissing it as agriculture.

DO NOT REPORT (these are NOT semantic changes — reporting them is an error):
- Lighting, sun angle, time of day, or shadow differences.
- Seasonal vegetation: leaf-on vs leaf-off, green vs brown grass, tree/forest color, growth stage. Forest looking different in color or density is NOT a change.
- Agricultural cycle: harvested vs unharvested, plowed vs planted, mown vs grown, a different crop. (Only report if the land was PERMANENTLY converted to non-agricultural use — see the DISCRIMINATOR above.)
- Cars, vehicles, or other temporary/movable objects.
- Water surface color, ripples, or reflections.
- Overall color / brightness / contrast / white-balance differences between captures.
- Minor residual misalignment (a structure shifted a few pixels but otherwise identical is NOT a change).

NOTE: a change may continue past the edge of this frame (the area is one tile of a larger scene). Still report the visible part — box just what you can see.

OUTPUT per change: category, change_type (added/removed/modified), a concise description of what changed, confidence (high = unmistakable, medium = likely, low = possible), and a TIGHT normalized [x, y, width, height] box around just the changed object on THIS image.

Be thorough — list EVERY genuine structural / infrastructure / land-development change, including both small single houses / short driveways AND large area-wide developments that fill much of the frame. But never invent changes: if a region differs only in vegetation, season, lighting or agriculture, report nothing there. If nothing genuine changed, return an empty changes array.

Always reason first (zoom-in pass region by region, then step-back pass over the whole frame), then output the changes.`;

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
