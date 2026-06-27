import type { AnalyzeResult } from "./types";
import {
  JSON_INSTRUCTION,
  SYSTEM,
  buildResult,
  dataUrlParts,
  languageInstruction,
  stripFences,
} from "./prompt";

// Calls the Google Generative Language REST API (no SDK dependency).
export async function geminiDetect(
  referenceDataUrl: string,
  targetDataUrl: string,
  opts: { model: string; apiKey?: string; language?: string },
): Promise<AnalyzeResult> {
  const apiKey = opts.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Google Gemini API key. Add one in the provider settings, or set GEMINI_API_KEY.",
    );
  }

  const ref = dataUrlParts(referenceDataUrl);
  const tgt = dataUrlParts(targetDataUrl);

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Image 1 — EARLIER (reference) capture:" },
          { inline_data: { mime_type: ref.mediaType, data: ref.data } },
          { text: "Image 2 — LATER capture:" },
          { inline_data: { mime_type: tgt.mediaType, data: tgt.data } },
          { text: JSON_INSTRUCTION + languageInstruction(opts.language) },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 8192,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model,
  )}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini request failed (${res.status})`;
    throw new Error(msg);
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const raw: string = Array.isArray(parts)
    ? parts.map((p: { text?: string }) => p.text ?? "").join("")
    : "";
  if (!raw.trim()) {
    const finish = data?.candidates?.[0]?.finishReason;
    throw new Error(
      `Gemini returned no content${finish ? ` (finishReason: ${finish})` : ""}.`,
    );
  }

  let parsed: { summary?: string; changes?: [] };
  try {
    parsed = JSON.parse(stripFences(raw.trim()));
  } catch {
    throw new Error("Gemini did not return valid JSON. Raw: " + raw.slice(0, 300));
  }
  return buildResult(parsed, opts.model);
}
