import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type AnalyzeResult } from "./types";
import { SYSTEM, buildResult, dataUrlParts, languageInstruction, stripFences } from "./prompt";

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
          bbox: { type: "array", items: { type: "number" } },
        },
        required: ["category", "change_type", "description", "confidence", "bbox"],
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
