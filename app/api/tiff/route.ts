import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1e6).toFixed(0)} MB). Maximum is 150 MB.` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Convert to JPEG, capping at 3000 px on the longest side so the response
    // stays manageable while still providing enough resolution for alignment.
    const jpeg = await sharp(buffer)
      .resize(3000, 3000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    return NextResponse.json({ dataUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TIFF conversion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
