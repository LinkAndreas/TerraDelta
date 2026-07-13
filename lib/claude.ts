import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type AnalyzeResult, type SupportedModels, type VerifyResult } from "./types";
import {
  SYSTEM,
  VERIFY_SYSTEM,
  buildResult,
  buildVerifyResult,
  dataUrlParts,
  languageInstruction,
  verifyLanguageInstruction,
  stripFences,
} from "./prompt";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    analysis: { type: "string", description: "Region-by-region reasoning before listing changes." },
    summary: { type: "string", description: "1-3 sentence overview of the real changes." },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: CATEGORIES as unknown as string[] },
          change_type: { type: "string", enum: ["added", "removed", "modified"] },
          description: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          bbox: { type: "array", items: { type: "number" }, description: "[x, y, width, height], normalized 0..1." },
          polygon: {
            type: "array",
            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            minItems: 3,
            maxItems: 12,
            description: "Vertices tracing the changed object's actual outline, normalized 0..1. Repeat the bbox's four corners if unsure.",
          },
        },
        required: ["category", "change_type", "description", "confidence", "bbox", "polygon"],
      },
    },
  },
  required: ["analysis", "summary", "changes"],
};

export async function anthropicDetect(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: { model: string; apiKey?: string; language?: string },
): Promise<AnalyzeResult> {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key. Add one in the provider settings, or set ANTHROPIC_API_KEY.",
    );
  }

  const client = new Anthropic({ apiKey });
  const ref = dataUrlParts(referenceDataUrl);
  const tgt = dataUrlParts(targetDataUrl);

  const params = {
    model: opts.model,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Image 1 — EARLIER (reference) capture:" },
          { type: "image" as const, source: { type: "base64" as const, media_type: ref.mediaType, data: ref.data } },
          { type: "text" as const, text: "Image 2 — LATER capture:" },
          { type: "image" as const, source: { type: "base64" as const, media_type: tgt.mediaType, data: tgt.data } },
          {
            type: "text" as const,
            text:
              "Identify the semantic changes and return them in the required JSON schema." +
              languageInstruction(opts.language),
          },
        ],
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await client.messages.create(params as any);
  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as
    | { text?: string }
    | undefined;
  const raw = (textBlock?.text ?? "").trim();

  let parsed: { summary?: string; changes?: [] };
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildResult(parsed, opts.model);
}

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    genuine: { type: "boolean" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    bbox: { type: "array", items: { type: "number" } },
    polygon: {
      type: "array",
      items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      description: "Vertices tracing the object's actual outline in this crop, normalized 0..1. Empty if rejected.",
    },
    reason: { type: "string" },
  },
  required: ["genuine", "confidence", "bbox", "polygon", "reason"],
};

export async function anthropicVerify(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: {
    model: string;
    apiKey?: string;
    language?: string;
    candidate: { category: string; change_type: string; description: string };
  },
): Promise<VerifyResult> {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key. Add one in the provider settings, or set ANTHROPIC_API_KEY.",
    );
  }

  const client = new Anthropic({ apiKey });
  const ref = dataUrlParts(referenceDataUrl);
  const tgt = dataUrlParts(targetDataUrl);
  const c = opts.candidate;

  const params = {
    model: opts.model,
    max_tokens: 1500,
    system: VERIFY_SYSTEM,
    output_config: { format: { type: "json_schema", schema: VERIFY_SCHEMA } },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Image 1 — EARLIER capture (zoomed crop):" },
          { type: "image" as const, source: { type: "base64" as const, media_type: ref.mediaType, data: ref.data } },
          { type: "text" as const, text: "Image 2 — LATER capture (same crop):" },
          { type: "image" as const, source: { type: "base64" as const, media_type: tgt.mediaType, data: tgt.data } },
          {
            type: "text" as const,
            text:
              `Candidate change to verify: category "${c.category}", ${c.change_type} — ${c.description}\n` +
              "Decide whether this is a genuine semantic change and return the JSON." +
              verifyLanguageInstruction(opts.language),
          },
        ],
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await client.messages.create(params as any);
  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as
    | { text?: string }
    | undefined;
  const raw = (textBlock?.text ?? "").trim();

  let parsed: Parameters<typeof buildVerifyResult>[0];
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildVerifyResult(parsed);
}

export async function fetchModels(
  opts: { apiKey?: string; }
): Promise<SupportedModels> {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key. Add one in the provider settings, or set ANTHROPIC_API_KEY.",
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.models.list();
  return response.data.map((model) => ({
    id: model.id,
    name: model.display_name || model.id,
  }));
}
