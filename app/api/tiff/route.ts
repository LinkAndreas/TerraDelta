import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

async function sharpConvert(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(3000, 3000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// Fallback for TIFF variants libvips cannot handle (e.g. tiled separate planes).
// geotiff.js reads raw rasters, then we feed the interleaved pixels back to sharp.
async function geotiffConvert(buffer: Buffer): Promise<Buffer> {
  const { fromArrayBuffer } = await import("geotiff");

  // Node Buffer.buffer may be a shared pool slice — copy it out as a standalone ArrayBuffer.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const tiff = await fromArrayBuffer(ab);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const samplesPerPixel = image.getSamplesPerPixel();

  // Read only the first 3 samples (RGB) — skip extra bands / alpha for JPEG output.
  const bandCount = Math.min(samplesPerPixel, 3) as 1 | 2 | 3;
  const samples = Array.from({ length: bandCount }, (_, i) => i);

  const rasters = await image.readRasters({ interleave: true, samples });
  const typed = rasters as Uint8Array | Uint16Array | Float32Array | Int16Array | Int32Array | Float64Array;

  let data: Buffer;
  if (typed instanceof Uint8Array) {
    data = Buffer.from(typed);
  } else if (typed instanceof Uint16Array) {
    // 16-bit unsigned: scale 0–65535 → 0–255
    data = Buffer.allocUnsafe(typed.length);
    for (let i = 0; i < typed.length; i++) data[i] = typed[i] >> 8;
  } else {
    // Float32 / Int16 / etc: normalize using actual data range
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] < min) min = typed[i];
      if (typed[i] > max) max = typed[i];
    }
    const range = max - min || 1;
    data = Buffer.allocUnsafe(typed.length);
    for (let i = 0; i < typed.length; i++) {
      data[i] = Math.round(((typed[i] - min) / range) * 255);
    }
  }

  return sharp(data, { raw: { width, height, channels: bandCount } })
    .resize(3000, 3000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

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

    let jpeg: Buffer;
    try {
      jpeg = await sharpConvert(buffer);
    } catch {
      // sharp/libvips doesn't support this TIFF variant — try geotiff.js decoder
      jpeg = await geotiffConvert(buffer);
    }

    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    return NextResponse.json({ dataUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TIFF conversion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
