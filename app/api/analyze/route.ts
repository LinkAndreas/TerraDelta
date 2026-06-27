import { NextRequest, NextResponse } from "next/server";
import { detectChanges } from "@/lib/detect";
import { PROVIDERS, type Provider } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reference, target, provider, model, apiKey, lang } = body ?? {};

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

    const result = await detectChanges({
      provider: prov,
      model: typeof model === "string" ? model : PROVIDERS[prov].defaultModel,
      apiKey: cleanKey,
      language: typeof lang === "string" ? lang : undefined,
      reference,
      target,
    });
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
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
