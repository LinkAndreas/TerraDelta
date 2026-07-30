import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, MAX_CATEGORY_MATCHES, type AnalyzeResult, type ClassifyResult, type Effort, type SupportedModels, type TokenUsage } from "./types";
import {
  buildDetectHints,
  buildDetectSystem,
  CLASSIFY_SYSTEM,
  buildResult,
  buildClassifyResult,
  dataUrlParts,
  languageInstruction,
  classifyLanguageInstruction,
  stripFences,
} from "./prompt";

// Stage 1 (detection) carries NO category field: differences are found first
// and classified afterwards (see lib/prompt.ts). The schema deliberately has
// no category enum, so a real difference can never be lost just because the
// detector couldn't fit it into one of the catalog's 62 leaves.
const DETECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    analysis: { type: "string", description: "Region-by-region reasoning before listing the differences." },
    summary: { type: "string", description: "1-3 sentence overview of the physical differences found." },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          change_type: { type: "string", enum: ["added", "removed", "modified"] },
          description: {
            type: "string",
            description: "What the object is and how it physically changed between the two dates.",
          },
          confidence: {
            type: "integer",
            description: "How certain this is a genuine physical difference, an integer from 0 to 100 (use the full range, not just round buckets).",
          },
          bbox: {
            type: "array",
            items: { type: "number" },
            description: "[x, y, width, height], normalized 0..1, a TIGHT box hugging the changed object.",
          },
        },
        required: ["change_type", "description", "confidence", "bbox"],
      },
    },
  },
  required: ["analysis", "summary", "changes"],
};

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
// prompt is identical across every tile/candidate call within one run (the
// detect prompt for tiles, the classify prompt for candidates), so marking it as an
// ephemeral cache breakpoint means only the FIRST call in a run pays full
// price for it — every later call in the same run (there can be 15-20+ tile
// calls, plus one per classified candidate) reads it back at ~10% of the input
// price instead of paying full price again. This is the single biggest
// token-cost lever available here, since the system prompt (for the classify
// pass, the full 62-object catalog reference) dwarfs the per-call
// image+instruction text.
function cachedSystem(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export async function anthropicDetect(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: {
    model: string;
    apiKey?: string;
    language?: string;
    effort?: Effort;
    includeVegetation?: boolean;
    hints?: string[];
  },
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
    // A tile dense with changes emits a long region-by-region `analysis`
    // string followed by many change objects; at 8000 tokens the JSON could
    // be truncated mid-object (→ a parse failure that loses the whole tile).
    // 16000 gives ample headroom for the busiest tiles.
    max_tokens: 16000,
    system: cachedSystem(buildDetectSystem({ includeVegetation: opts.includeVegetation })),
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: DETECT_SCHEMA } },
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
              "Identify every physical difference between the two dates and return them in the required JSON schema." +
              buildDetectHints(opts.hints ?? []) +
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
    // A "max_tokens" stop means the JSON was cut off mid-output — a clearer,
    // actionable message than a raw-snippet dump. (max_tokens is already
    // generous; this region was just unusually change-dense.)
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "The model's response for this region was cut off (token limit reached) before the JSON was complete — this region may be unusually dense with changes. Try a lower reasoning effort, or re-run.",
      );
    }
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildResult(parsed, opts.model, usage);
}

// The classify schema's category enum is ALWAYS the full 62-leaf catalog,
// never the user's selection: the model should name the truly best-fitting
// types, and the selection is applied afterwards (client-side) against every
// reported match — rather than forcing a difference into an in-scope category
// it doesn't belong to, or making it unrepresentable and losing it.
//
// Two schema details carry the "every change gets at least one category, at
// most MAX_CATEGORY_MATCHES" requirement:
//
//  • `category` is a REQUIRED scalar enum, not an array entry. A required enum
//    field cannot come back empty, so the API itself guarantees a primary
//    classification — far more reliable than asking the prompt nicely and
//    hoping for a non-empty array.
//  • `alternatives` carries the runner-ups. It deliberately has NO `maxItems`:
//    Anthropic's structured outputs do not support array-size constraints, and
//    an unsupported keyword makes the whole schema invalid — which is what
//    previously failed EVERY classify call (the error was then swallowed by the
//    caller's fallback, so every change silently stayed unclassified). The
//    1..MAX_CATEGORY_MATCHES limit is stated in the prompt and enforced in code
//    (see parseClassification).
const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    genuine: { type: "boolean" },
    confidence: {
      type: "integer",
      description: "How certain the difference itself is a real physical change, an integer from 0 to 100.",
    },
    change_type: {
      type: "string",
      enum: ["added", "removed", "modified"],
      description: "Corrected direction of the change as judged from the two crops.",
    },
    category: {
      type: "string",
      enum: CATEGORIES as unknown as string[],
      description: "The single best-fitting catalog category for this difference. Always required — pick the closest one even when the fit is poor.",
    },
    category_fit: {
      type: "integer",
      description: "How confident you are that `category` is the correct classification, an integer from 0 to 100.",
    },
    alternatives: {
      type: "array",
      description:
        `Other categories that also plausibly fit, best first, at most ${MAX_CATEGORY_MATCHES - 1} (so at most ${MAX_CATEGORY_MATCHES} including \`category\`). Empty when only one category fits.`,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: CATEGORIES as unknown as string[] },
          fit: {
            type: "integer",
            description: "How confident you are that this category is the correct classification, an integer from 0 to 100.",
          },
        },
        required: ["category", "fit"],
      },
    },
    bbox: {
      type: "array",
      items: { type: "number" },
      description: "TIGHT box hugging the changed object in THIS crop, normalized 0..1. [0,0,0,0] if rejected.",
    },
    reason: { type: "string" },
  },
  required: ["genuine", "confidence", "change_type", "category", "category_fit", "alternatives", "bbox", "reason"],
};

export async function anthropicClassify(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: {
    model: string;
    apiKey?: string;
    language?: string;
    effort?: Effort;
    // `bbox` is the detector's rectangle expressed in THIS crop's coordinates.
    // Telling the classifier where the candidate object sits inside the crop is
    // what makes box refinement work: without it the model has to re-find the
    // object in a crop that is mostly context, and tends to return either the
    // whole crop or a box around the wrong thing.
    candidate: { change_type: string; description: string; bbox?: [number, number, number, number] };
  },
): Promise<ClassifyResult> {
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
    // The classify JSON is small (a verdict, two or three categories, a box, one
    // sentence) — but `max_tokens` caps THINKING PLUS response text, and current
    // models think by default. At 2000 the hardest crops spent the entire budget
    // reasoning and the response ended before any JSON was emitted: an empty
    // text block and stop_reason "max_tokens", which surfaced as an unparseable
    // (blank) response. The cap is a ceiling, not a reservation — only what the
    // model actually generates is billed — so it's set well above what the
    // answer needs, and effort is what really governs the spend.
    max_tokens: 12000,
    // CLASSIFY_SYSTEM carries the full catalog reference and is identical for
    // every candidate in a run, so caching it means only the first classify
    // call pays for those tokens.
    system: cachedSystem(CLASSIFY_SYSTEM),
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
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
              `Difference reported here by the detector: ${c.change_type} — ${c.description}\n` +
              (c.bbox
                ? `The detector's rectangle for it, in THIS crop's normalized coordinates, is approximately [${c.bbox
                    .map((n) => n.toFixed(3))
                    .join(", ")}] as [x, y, width, height]. That box is coarse: correct it so it hugs the changed object exactly.\n`
                : "") +
              "Decide whether it is a genuine physical change, map it onto the catalog (always one best category, plus up to " +
              `${MAX_CATEGORY_MATCHES - 1} alternatives, each with a fit percentage), tighten the box, and return the JSON.` +
              classifyLanguageInstruction(opts.language),
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

  let parsed: Parameters<typeof buildClassifyResult>[0];
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    // Name the two distinguishable causes instead of echoing a raw snippet that
    // is empty in exactly the case that matters. An empty response with a
    // "max_tokens" stop means the budget went entirely on reasoning; an empty
    // response otherwise means the model returned no text block at all.
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "The model used its whole token budget on this candidate before returning the classification. Try a lower reasoning effort, or re-run.",
      );
    }
    if (!raw) {
      throw new Error(
        `Claude returned no text to parse for this candidate (stop_reason: ${response.stop_reason ?? "unknown"}).`,
      );
    }
    throw new Error("Claude did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildClassifyResult(parsed, usage);
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
