// Server-side (Node) GeoTIFF geo-key extraction. Kept separate from lib/geo.ts
// (which is imported by client code) since `geotiff`'s Node file reads pull
// in Node-only internals.

import type { GeoRef } from "./types";

export async function extractGeoRef(buffer: Buffer): Promise<GeoRef | null> {
  try {
    const { fromArrayBuffer } = await import("geotiff");
    const { toProj4 } = await import("geotiff-geokeys-to-proj4");

    // Node Buffer.buffer may be a shared pool slice — copy it out as a standalone ArrayBuffer.
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const tiff = await fromArrayBuffer(ab);
    const image = await tiff.getImage();

    const geoKeys = image.getGeoKeys();
    if (!geoKeys || Object.keys(geoKeys).length === 0) return null; // plain (non-geo) TIFF

    const bbox = image.getBoundingBox();
    if (!bbox || bbox.some((n: number) => !Number.isFinite(n))) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proj = toProj4(geoKeys as any);
    if (!proj?.proj4) return null;

    return {
      proj4Def: proj.proj4,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      pixelWidth: image.getWidth(),
      pixelHeight: image.getHeight(),
    };
  } catch {
    return null; // not parseable as a georeferenced TIFF — caller treats the image as plain
  }
}
