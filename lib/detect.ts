import type { AnalyzeResult } from "./types";
import { PROVIDERS, type Provider } from "./models";
import { anthropicDetect } from "./claude";

export interface DetectRequest {
  provider: Provider;
  model: string;
  apiKey?: string;
  language?: string;
  reference: string;
  target: string;
}

export async function detectChanges(req: DetectRequest): Promise<AnalyzeResult> {
  const meta = PROVIDERS[req.provider];
  if (!meta) throw new Error(`Unknown provider: ${req.provider}`);
  const model = meta.models.includes(req.model) ? req.model : meta.defaultModel;
  const o = { model, apiKey: req.apiKey, language: req.language };

  return anthropicDetect(req.reference, req.target, o);
}
