import type { AnalyzeResult, Effort, VerifyResult } from "./types";
import { PROVIDERS, type Provider } from "./models";
import { anthropicDetect, anthropicVerify } from "./claude";

export interface DetectRequest {
  provider: Provider;
  model: string;
  apiKey?: string;
  language?: string;
  effort?: Effort;
  reference: string;
  target: string;
}

export interface VerifyRequest extends DetectRequest {
  candidate: { category: string; change_type: string; description: string };
}

export async function detectChanges(req: DetectRequest): Promise<AnalyzeResult> {
  const meta = PROVIDERS[req.provider];
  if (!meta) throw new Error(`Unknown provider: ${req.provider}`);
  const o = { model: req.model, apiKey: req.apiKey, language: req.language, effort: req.effort };

  return anthropicDetect(req.reference, req.target, o);
}

export async function verifyDetectedChange(req: VerifyRequest): Promise<VerifyResult> {
  const meta = PROVIDERS[req.provider];
  if (!meta) throw new Error(`Unknown provider: ${req.provider}`);

  return anthropicVerify(req.reference, req.target, {
    model: req.model,
    apiKey: req.apiKey,
    language: req.language,
    effort: req.effort,
    candidate: req.candidate,
  });
}
