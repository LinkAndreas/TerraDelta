import type { AnalyzeResult, ClassifyResult, Effort } from "./types";
import { PROVIDERS, type Provider } from "./models";
import { anthropicDetect, anthropicClassify } from "./claude";

export interface DetectRequest {
  provider: Provider;
  model: string;
  apiKey?: string;
  language?: string;
  effort?: Effort;
  reference: string;
  target: string;
  // Whether vegetation/land-cover differences are wanted this run (Options
  // toggle, default OFF). Only affects the detection prompt's vegetation
  // stance; classification always works against the full catalog. Note the
  // detector is otherwise NOT scoped by the user's category selection — that
  // selection is applied client-side to the classified matches, so a real
  // difference is never lost just because it fell outside the current scope.
  includeVegetation?: boolean;
  // Operator notes for the DIM points overlapping this region (§ prompt.ts
  // buildDetectHints). Detection only — the classifier judges a candidate on
  // its own merits, where a prior expectation would be confirmation bias.
  hints?: string[];
  // Whether this tile's/crop's image carries the visual AOI mask/boundary
  // (§ lib/tiles.ts drawAoiMask) — tells the prompt what that overlay means.
  aoiMasked?: boolean;
}

export interface ClassifyRequest extends DetectRequest {
  candidate: {
    change_type: string;
    description: string;
    // The detector's box in the verification crop's own coordinates, so the
    // classifier can tighten that rectangle rather than re-locate the object.
    bbox?: [number, number, number, number];
  };
}

// `hints` on ClassifyRequest (inherited from DetectRequest) carries the notes
// for the DIM point(s) that contain THIS SPECIFIC candidate — computed by the
// caller per-candidate, unlike detection's per-tile hints. See app/page.tsx.

export async function detectChanges(req: DetectRequest): Promise<AnalyzeResult> {
  const meta = PROVIDERS[req.provider];
  if (!meta) throw new Error(`Unknown provider: ${req.provider}`);

  return anthropicDetect(req.reference, req.target, {
    model: req.model,
    apiKey: req.apiKey,
    language: req.language,
    effort: req.effort,
    includeVegetation: req.includeVegetation,
    hints: req.hints,
    aoiMasked: req.aoiMasked,
  });
}

// Second pass over one detected difference on a zoomed crop: confirm it's a
// real physical change and map it onto the catalog (up to
// MAX_CATEGORY_MATCHES categories with a fit percentage each).
export async function classifyDetectedChange(req: ClassifyRequest): Promise<ClassifyResult> {
  const meta = PROVIDERS[req.provider];
  if (!meta) throw new Error(`Unknown provider: ${req.provider}`);

  return anthropicClassify(req.reference, req.target, {
    model: req.model,
    apiKey: req.apiKey,
    language: req.language,
    effort: req.effort,
    candidate: req.candidate,
    hints: req.hints,
    aoiMasked: req.aoiMasked,
  });
}
