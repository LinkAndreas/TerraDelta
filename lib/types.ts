// Shared types used by both the browser and the API route.

export type ChangeType = "added" | "removed" | "modified";
export type Confidence = "low" | "medium" | "high";

// Categories of semantic change we ask the model to classify.
export const CATEGORIES = [
  "building",
  "house",
  "road",
  "bridge",
  "plot",
  "water",
  "vegetation",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Change {
  id: string;
  category: string;
  change_type: ChangeType;
  description: string;
  confidence: Confidence;
  // Normalized bounding box on the aligned reference image:
  // [x, y, width, height], each in 0..1, origin top-left.
  bbox: [number, number, number, number];
}

export interface AnalyzeResult {
  changes: Change[];
  summary: string;
  model: string;
}

export const CHANGE_COLORS: Record<ChangeType, string> = {
  added: "#22c55e", // green
  removed: "#ef4444", // red
  modified: "#f59e0b", // amber
};
