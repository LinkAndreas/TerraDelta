import { NextRequest, NextResponse } from "next/server";
import { fetchModels as fetchClaudeModels } from "@/lib/claude";

export async function POST(req: NextRequest) {
  try {
    const { provider, apiKey } = await req.json();
    if (provider === "anthropic") {
      const models = await fetchClaudeModels({ apiKey });
      return NextResponse.json({ models });
    }
    return NextResponse.json({ models: [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
