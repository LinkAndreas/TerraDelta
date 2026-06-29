import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { refUrl, targetUrl, apiKey } = await req.json() as {
      refUrl: string;
      targetUrl: string;
      apiKey?: string;
    };

    if (!refUrl || !targetUrl) {
      return NextResponse.json({ error: "Missing refUrl or targetUrl" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const toSource = (dataUrl: string) => ({
      type: "base64" as const,
      media_type: (dataUrl.match(/data:([^;]+);/)?.[1] ?? "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp",
      data: dataUrl.split(",")[1],
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: toSource(refUrl) },
            { type: "image", source: toSource(targetUrl) },
            {
              type: "text",
              text: `Evaluate the visual resolution of these two aerial orthophotos for change detection.

Assess sharpness of building edges, road markings, and plot boundaries to choose the optimal integer upscaling factor:
- 1: Already high-resolution, no upscaling needed
- 2: Moderate resolution, mild upscaling helps feature matching
- 3: Low resolution, significant upscaling improves detection
- 4: Very low resolution, maximum upscaling required

Return ONLY valid JSON: {"factor": N}`,
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? '{"factor":1}';
    const match = text.match(/"factor"\s*:\s*([1-4])/);
    const factor = match ? parseInt(match[1], 10) : 1;

    return NextResponse.json({ factor });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolution assessment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
