import { NextRequest, NextResponse } from "next/server";
import { classifyDetectedChange, detectChanges } from "@/lib/detect";
import { PROVIDERS, type Provider } from "@/lib/models";
import { EFFORT_LEVELS, type Effort } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reference, target, provider, model, apiKey, lang, effort, candidate, includeVegetation } = body ?? {};

    if (typeof reference !== "string" || typeof target !== "string") {
      return NextResponse.json(
        { error: "Body must include 'reference' and 'target' image data URLs." },
        { status: 400 },
      );
    }

    const prov: Provider = provider in PROVIDERS ? provider : "anthropic";

    const cleanKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined;
    // API keys must be plain ASCII; a non-ASCII char (commonly an em-dash "—"
    // from copy-paste auto-formatting in place of a hyphen "-") would crash
    // HTTP header construction with an opaque ByteString error.
    if (cleanKey && /[^\x20-\x7E]/.test(cleanKey)) {
      const bad = [...cleanKey].find((ch) => ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 32);
      return NextResponse.json(
        {
          error: `The API key contains an invalid character ("${bad}") — this usually means a hyphen "-" was turned into an em-dash "—" by copy-paste auto-formatting. Re-paste your key as plain text (or clear it to use the server key).`,
        },
        { status: 400 },
      );
    }

    const common = {
      provider: prov,
      model: typeof model === "string" ? model : "default",
      apiKey: cleanKey,
      language: typeof lang === "string" ? lang : undefined,
      effort: EFFORT_LEVELS.includes(effort) ? (effort as Effort) : undefined,
      reference,
      target,
      includeVegetation: includeVegetation === true, // default false
    };

    // With a candidate, this is the second pass over one detected difference
    // on a zoomed crop (confirm + classify); without one, a detection pass.
    if (candidate && typeof candidate === "object") {
      const result = await classifyDetectedChange({
        ...common,
        candidate: {
          change_type: String(candidate.change_type ?? "modified"),
          description: String(candidate.description ?? ""),
          // The detector's box in the crop's own coordinates — only forwarded
          // when it's four finite numbers, so a malformed client can't inject
          // nonsense into the prompt.
          bbox:
            Array.isArray(candidate.bbox) &&
            candidate.bbox.length === 4 &&
            candidate.bbox.every((n: unknown) => typeof n === "number" && Number.isFinite(n))
              ? (candidate.bbox as [number, number, number, number])
              : undefined,
        },
      });
      return NextResponse.json(result);
    }

    const result = await detectChanges(common);
    return NextResponse.json(result);
  } catch (err) {
    let message = err instanceof Error ? err.message : "Unknown error";
    const status = (err as { status?: number })?.status;
    if (
      status === 401 ||
      status === 403 ||
      /\b40[13]\b|authentication|invalid x-api-key|api key not valid|permission/i.test(message)
    ) {
      message =
        'Authentication failed — the API key is invalid or expired. Open "⚙ Provider & API key", clear the key field to use the server key, or paste a valid one. Details: ' +
        message;
    } else if (status === 429 || /rate.?limit|quota|too many requests|overloaded/i.test(message)) {
      message =
        "Rate limit or usage quota reached for this API key. Wait a moment and try again, or use a different key/model in \"⚙ Provider & API key\". Details: " +
        message;
    }
    // Forward the provider's actual status for recognized client errors so
    // the UI can react (e.g. a distinct rate-limit alert) — anything else
    // collapses to 500, matching prior behavior.
    const httpStatus = status === 401 || status === 403 || status === 429 ? status : 500;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
