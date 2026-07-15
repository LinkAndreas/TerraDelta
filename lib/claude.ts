import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type AnalyzeResult, type Category, type Effort, type SupportedModels, type TokenUsage, type VerifyResult } from "./types";
import {
  buildSystem,
  VERIFY_SYSTEM,
  buildResult,
  buildVerifyResult,
  dataUrlParts,
  languageInstruction,
  verifyLanguageInstruction,
  stripFences,
} from "./prompt";

// Scoping the schema's category enum to the caller's selection (rather than
// always the full 62-category CATEGORIES list) makes the restriction a hard
// API-level guarantee, not just a prompt instruction the model could ignore
// — Anthropic's structured-output schema rejects any category outside the
// enum, so an out-of-scope detection literally can't be emitted.
function buildSchema(enabledCategories: readonly Category[]) {
  return {
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
            category: { type: "string", enum: enabledCategories as unknown as string[] },
            change_type: { type: "string", enum: ["added", "removed", "modified"] },
            description: { type: "string" },
            confidence: {
              type: "integer",
              description: "How certain the change is genuine, an integer from 0 to 100 (use the full range, not just round buckets).",
            },
            bbox: {
              type: "array",
              items: { type: "number" },
              description: "[x, y, width, height], normalized 0..1, a TIGHT box hugging the changed object.",
            },
          },
          required: ["category", "change_type", "description", "confidence", "bbox"],
        },
      },
    },
    required: ["analysis", "summary", "changes"],
  };
}

function tokenUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      }
    | undefined
    | null,
): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

// Wraps a system prompt string as a single cacheable block. The system
// prompt is identical across every tile/candidate call within one run (same
// catalog + same category selection throughout), so marking it as an
// ephemeral cache breakpoint means only the FIRST call in a run pays full
// price for it — every later call in the same run (there can be 15-20+ tile
// calls, plus one per verified candidate) reads it back at ~10% of the input
// price instead of paying full price again. This is the single biggest
// token-cost lever available here, since the system prompt (full 62-object
// catalog description) dwarfs the per-tile image+instruction text.
function cachedSystem(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export async function anthropicDetect(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: { model: string; apiKey?: string; language?: string; effort?: Effort; categories?: Category[]; includeVegetation?: boolean },
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
  const enabledCategories = opts.categories && opts.categories.length > 0 ? opts.categories : (CATEGORIES as unknown as Category[]);

  const params = {
    model: opts.model,
    max_tokens: 8000,
    system: cachedSystem(buildSystem(enabledCategories, { includeVegetation: opts.includeVegetation })),
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: buildSchema(enabledCategories) } },
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
  const usage = tokenUsage(response.usage);

  let parsed: { summary?: string; changes?: [] };
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildResult(parsed, opts.model, usage);
}

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    genuine: { type: "boolean" },
    confidence: {
      type: "integer",
      description: "How certain the change is genuine, an integer from 0 to 100.",
    },
    change_type: {
      type: "string",
      enum: ["added", "removed", "modified"],
      description: "Corrected direction of the change as judged from the two crops.",
    },
    bbox: {
      type: "array",
      items: { type: "number" },
      description: "TIGHT box hugging the object in this crop, normalized 0..1. [0,0,0,0] if rejected.",
    },
    reason: { type: "string" },
  },
  required: ["genuine", "confidence", "change_type", "bbox", "reason"],
};

export async function anthropicVerify(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: {
    model: string;
    apiKey?: string;
    language?: string;
    effort?: Effort;
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
    // VERIFY_SYSTEM is short enough that it may fall under Anthropic's
    // minimum cacheable block size (in which case this is a harmless no-op)
    // — wrapped the same way as the detector's system prompt for
    // consistency and so it starts benefiting automatically if it grows.
    system: cachedSystem(VERIFY_SYSTEM),
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: VERIFY_SCHEMA } },
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
  const usage = tokenUsage(response.usage);

  let parsed: Parameters<typeof buildVerifyResult>[0];
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildVerifyResult(parsed, usage);
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
