// Georeferencing math shared by client and server: converts between pixel
// coordinates on a GeoTIFF's ORIGINAL raster grid, native-CRS coordinates,
// and WGS84 lon/lat — plus helpers for the search-area restriction (§1) and
// coordinate export (§2/§3).
//
// Alignment in lib/align.ts only ever uniformly scales the reference image
// (never crops it) and warps the target onto that same frame, so a
// normalized [0..1] position in the aligned working frame is identical to
// the normalized position on the reference image's ORIGINAL pixel grid. That
// means geo lookups only need the reference (earlier) image's GeoRef — no
// intermediate resize/align scale factors to track.

import proj4 from "proj4";
import type { Change, GeoRef, SearchArea, SearchShape } from "./types";

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Native-CRS (x, y) -> normalized [0..1] position on the original raster
// (origin top-left, north-up assumed — true for orthophoto GeoTIFFs).
function nativeToNormalized(geo: GeoRef, x: number, y: number): [number, number] {
  const [minX, minY, maxX, maxY] = geo.bbox;
  const nx = (x - minX) / (maxX - minX || 1);
  const ny = (maxY - y) / (maxY - minY || 1);
  return [nx, ny];
}

function normalizedToNative(geo: GeoRef, nx: number, ny: number): [number, number] {
  const [minX, minY, maxX, maxY] = geo.bbox;
  const x = minX + nx * (maxX - minX);
  const y = maxY - ny * (maxY - minY);
  return [x, y];
}

export function lonLatToNormalized(geo: GeoRef, lon: number, lat: number): [number, number] {
  const [x, y] = proj4("WGS84", geo.proj4Def, [lon, lat]);
  return nativeToNormalized(geo, x, y);
}

export function normalizedToLonLat(geo: GeoRef, nx: number, ny: number): [number, number] {
  const [x, y] = normalizedToNative(geo, nx, ny);
  const [lon, lat] = proj4(geo.proj4Def, "WGS84", [x, y]);
  return [lon, lat];
}

export function changeCenterLonLat(geo: GeoRef, change: Change): [number, number] {
  if (change.polygon.length >= 3) {
    const n = change.polygon.length;
    const [sx, sy] = change.polygon.reduce(([ax, ay], [px, py]) => [ax + px, ay + py], [0, 0]);
    return normalizedToLonLat(geo, sx / n, sy / n);
  }
  const [x, y, w, h] = change.bbox;
  return normalizedToLonLat(geo, x + w / 2, y + h / 2);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Bounding rect (normalized [0..1] image coordinates) of a search area, for
// pruning tiles / drawing the overlay. Circles use their bounding square.
export function searchAreaToNormalizedRect(
  geo: GeoRef,
  area: SearchArea,
): { x0: number; y0: number; x1: number; y1: number } {
  const halfW = (area.shape === "circle" ? area.radiusM * 2 : area.widthM) / 2;
  const halfH = (area.shape === "circle" ? area.radiusM * 2 : area.heightM) / 2;
  const dLat = halfH / METERS_PER_DEG_LAT;
  const dLon = halfW / metersPerDegLon(area.lat);

  const corners: [number, number][] = [
    [area.lon - dLon, area.lat - dLat],
    [area.lon + dLon, area.lat - dLat],
    [area.lon - dLon, area.lat + dLat],
    [area.lon + dLon, area.lat + dLat],
  ];
  const normalized = corners.map(([lon, lat]) => lonLatToNormalized(geo, lon, lat));
  const xs = normalized.map((p) => p[0]);
  const ys = normalized.map((p) => p[1]);
  return {
    x0: clamp01(Math.min(...xs)),
    y0: clamp01(Math.min(...ys)),
    x1: clamp01(Math.max(...xs)),
    y1: clamp01(Math.max(...ys)),
  };
}

// Great-circle-ish planar distance in meters (accurate enough at the
// sub-kilometer scale a search-area restriction operates at).
function localMetersOffset(lat0: number, lon0: number, lat: number, lon: number): { dx: number; dy: number } {
  return {
    dx: (lon - lon0) * metersPerDegLon(lat0),
    dy: (lat - lat0) * METERS_PER_DEG_LAT,
  };
}

export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const { dx, dy } = localMetersOffset(lat1, lon1, lat2, lon2);
  return Math.hypot(dx, dy);
}

export interface GeoBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  widthM: number;
  heightM: number;
  areaKm2: number;
}

// WGS84 bounding box + real-world footprint of a whole GeoTIFF, for display
// in the upload metadata panel (§ image info dropdown). Reuses the same
// north-up-raster assumption as the rest of this file.
export function geoRefBounds(geo: GeoRef): GeoBounds {
  const [minLon, maxLat] = normalizedToLonLat(geo, 0, 0);
  const [maxLon, minLat] = normalizedToLonLat(geo, 1, 1);
  const widthM = metersBetween(maxLat, minLon, maxLat, maxLon);
  const heightM = metersBetween(maxLat, minLon, minLat, minLon);
  return { minLon, minLat, maxLon, maxLat, widthM, heightM, areaKm2: (widthM * heightM) / 1e6 };
}

export function isPointInSearchArea(area: SearchArea, lon: number, lat: number): boolean {
  const { dx, dy } = localMetersOffset(area.lat, area.lon, lat, lon);
  if (area.shape === "circle") return Math.hypot(dx, dy) <= area.radiusM;
  return Math.abs(dx) <= area.widthM / 2 && Math.abs(dy) <= area.heightM / 2;
}

export function changeInSearchArea(geo: GeoRef, area: SearchArea, change: Change): boolean {
  const [lon, lat] = changeCenterLonLat(geo, change);
  return isPointInSearchArea(area, lon, lat);
}

// Precise shape (not just its bounding box) for drawing the search area on
// the comparison view, in normalized [0..1] image coordinates.
export type OverlayShape =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };

export function searchAreaToOverlayShape(geo: GeoRef, area: SearchArea): OverlayShape {
  const [cx, cy] = lonLatToNormalized(geo, area.lon, area.lat);
  const halfW = (area.shape === "circle" ? area.radiusM : area.widthM) / 2;
  const halfH = (area.shape === "circle" ? area.radiusM : area.heightM) / 2;

  const dLon = halfW / metersPerDegLon(area.lat);
  const dLat = halfH / METERS_PER_DEG_LAT;
  const [eastNx] = lonLatToNormalized(geo, area.lon + dLon, area.lat);
  const [, northNy] = lonLatToNormalized(geo, area.lon, area.lat + dLat);

  const rx = Math.abs(eastNx - cx);
  const ry = Math.abs(cy - northNy);

  if (area.shape === "circle") return { kind: "ellipse", cx, cy, rx, ry };
  return { kind: "rect", x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
}

// ── Interactive placement (draw/move/resize on an image preview) ──────────
// These convert normalized [0..1] pointer positions on WHICHEVER image the
// user is drawing on — reference or target, each with its own GeoRef — into
// the shape-agnostic, real-world (lat/lon + meters) SearchArea. Because the
// result is real-world, it's valid regardless of which image was used to
// place it.

export interface NormalizedPoint {
  nx: number;
  ny: number;
}

// 4 decimal places (~11 m at the equator) is plenty of precision for placing
// a search area and keeps the lat/lon fields readable instead of trailing
// off into proj4 float noise.
export function roundCoord(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// New shape from a click-drag: for a circle, `from` is the center and `to`
// is a point on the edge (radius = distance between them); for a rectangle
// or square, `from`/`to` are opposite corners (a square takes the larger of
// the two dragged extents so it never shrinks to fit inside the drag box).
export function searchAreaFromDrag(
  geo: GeoRef,
  shape: SearchShape,
  from: NormalizedPoint,
  to: NormalizedPoint,
): SearchArea {
  if (shape === "circle") {
    const [lon, lat] = normalizedToLonLat(geo, from.nx, from.ny);
    const [elon, elat] = normalizedToLonLat(geo, to.nx, to.ny);
    const radiusM = Math.max(1, metersBetween(lat, lon, elat, elon));
    return { shape, lat: roundCoord(lat), lon: roundCoord(lon), radiusM, widthM: radiusM * 2, heightM: radiusM * 2 };
  }

  const cnx = (from.nx + to.nx) / 2;
  const cny = (from.ny + to.ny) / 2;
  const [lon, lat] = normalizedToLonLat(geo, cnx, cny);
  const [xLon] = normalizedToLonLat(geo, Math.max(from.nx, to.nx), cny);
  const [, yLat] = normalizedToLonLat(geo, cnx, Math.min(from.ny, to.ny));
  let widthM = Math.max(1, metersBetween(lat, lon, lat, xLon) * 2);
  let heightM = Math.max(1, metersBetween(lat, lon, yLat, lon) * 2);
  if (shape === "square") {
    widthM = heightM = Math.max(widthM, heightM);
  }
  return { shape, lat: roundCoord(lat), lon: roundCoord(lon), radiusM: widthM / 2, widthM, heightM };
}

// Reposition an existing area, keeping its size — used while dragging the
// shape's body. `grabOffset` is the normalized offset between the pointer
// and the shape's center at drag start, so the grabbed point stays under
// the cursor instead of the shape re-centering on it.
export function moveSearchArea(
  geo: GeoRef,
  pointer: NormalizedPoint,
  grabOffset: NormalizedPoint,
): Pick<SearchArea, "lat" | "lon"> {
  const [lon, lat] = normalizedToLonLat(geo, pointer.nx - grabOffset.nx, pointer.ny - grabOffset.ny);
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

// Resize an existing area by dragging a handle, symmetrically about its
// center (our data model is always center + half-extents, so this is the
// only resize that keeps the stored point meaningful).
export function resizeSearchArea(
  geo: GeoRef,
  area: SearchArea,
  handle: NormalizedPoint,
): Pick<SearchArea, "radiusM" | "widthM" | "heightM"> {
  const [hLon, hLat] = normalizedToLonLat(geo, handle.nx, handle.ny);
  if (area.shape === "circle") {
    const radiusM = Math.max(1, metersBetween(area.lat, area.lon, hLat, hLon));
    return { radiusM, widthM: radiusM * 2, heightM: radiusM * 2 };
  }
  const dx = metersBetween(area.lat, area.lon, area.lat, hLon);
  const dy = metersBetween(area.lat, area.lon, hLat, area.lon);
  let widthM = Math.max(1, dx * 2);
  let heightM = Math.max(1, dy * 2);
  if (area.shape === "square") {
    widthM = heightM = Math.max(widthM, heightM);
  }
  return { radiusM: widthM / 2, widthM, heightM };
}

// Does a tile (normalized rect on the aligned frame) overlap the search
// area's bounding rect? Used to skip regions outside it before calling the
// vision model.
export function rectsOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { gx: number; gy: number; gw: number; gh: number },
): boolean {
  const bx1 = b.gx + b.gw;
  const by1 = b.gy + b.gh;
  return a.x0 < bx1 && a.x1 > b.gx && a.y0 < by1 && a.y1 > b.gy;
}
