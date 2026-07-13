// Shared types used by both the browser and the API route.

export type ChangeType = "added" | "removed" | "modified";
export type Confidence = "low" | "medium" | "high";

// Categories of semantic change we ask the model to classify.
export const CATEGORIES = [
  "building",
  "house",
  "road",
  "bridge",
  "railway",
  "plot",
  "water",
  "vegetation",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Categories checked by default in "Spitzenaktualität" (priority currency)
// mode; "Grundaktualität" (baseline currency) mode checks every category.
export const PRIORITY_CATEGORIES: Category[] = ["building", "road", "bridge"];

export interface Change {
  id: string;
  category: string;
  change_type: ChangeType;
  description: string;
  confidence: Confidence;
  // Normalized bounding box on the aligned reference image:
  // [x, y, width, height], each in 0..1, origin top-left. This is the sole
  // geometry for a change — used for map overlays, dedup IoU, search-area
  // pruning, and export. A tight rectangle is a simpler, more reliable
  // target for the model than a free-form polygon (fewer points to get
  // right, no risk of a self-intersecting or mismatched-scale outline).
  bbox: [number, number, number, number];
}

// Token counts for one API call, as reported by the provider — used to
// estimate the API spend of a run (see lib/models.ts estimateCostUsd).
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyzeResult {
  changes: Change[];
  summary: string;
  model: string;
  usage: TokenUsage;
}

// Result of the second-pass verification of a single candidate change,
// judged on a zoomed-in crop around the detection.
export interface VerifyResult {
  genuine: boolean;
  confidence: Confidence;
  // Refined tight box in the CROP's normalized coordinates ([0,0,0,0] if rejected).
  bbox: [number, number, number, number];
  reason: string;
  usage: TokenUsage;
}

export type SupportedModels = { id: string; name: string }[];

export const CHANGE_COLORS: Record<ChangeType, string> = {
  added: "#22c55e", // green
  removed: "#ef4444", // red
  modified: "#f59e0b", // amber
};

export const CONF_PCT: Record<Confidence, number> = { low: 35, medium: 65, high: 90 };
export const confLabel = (c: Confidence): string => `${CONF_PCT[c]}%`;

// ── Georeferencing (from GeoTIFF input) ────────────────────────────────────

// Enough to map pixel <-> geographic coordinates for one image: a proj4
// definition for the raster's native CRS, its bounding box in that CRS
// ([minX, minY, maxX, maxY], north-up assumed), and its original pixel size.
export interface GeoRef {
  proj4Def: string;
  bbox: [number, number, number, number];
  pixelWidth: number;
  pixelHeight: number;
}

// ── Search-area restriction (requires GeoTIFF input for both images) ──────

export type SearchShape = "circle" | "rectangle" | "square";

export interface SearchArea {
  shape: SearchShape;
  lat: number;
  lon: number;
  // Circle: radiusM. Rectangle: widthM x heightM. Square: widthM === heightM
  // (kept as a distinct shape so the UI can offer a single "side length"
  // field instead of independent width/height).
  radiusM: number;
  widthM: number;
  heightM: number;
}

export const DEFAULT_RADIUS_M = 200;

// ── Category selection presets (§5.0) ──────────────────────────────────────
// "spitze" (Spitzenaktualität) and "grund" (Grundaktualität) lock the
// category checkboxes to a fixed set; "custom" (Benutzerdefiniert) unlocks
// them for the user to pick freely. Independent of whether a search area is
// active — the two are separate concerns (what to look for vs. where).
export type CategoryPreset = "spitze" | "grund" | "custom";

export function categoriesForPreset(preset: CategoryPreset): Record<Category, boolean> {
  const useAll = preset === "grund";
  return Object.fromEntries(
    CATEGORIES.map((c) => [c, useAll || PRIORITY_CATEGORIES.includes(c)]),
  ) as Record<Category, boolean>;
}
