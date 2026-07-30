// Coordinate reference systems for user-facing coordinates — entry (DIM
// points, search-area location) and export (CSV/PDF/GeoJSON/KML attributes).
//
// Internally the app stays on WGS84 lon/lat everywhere (lib/geo.ts, the
// SearchArea/DimPoint model, every overlay and containment test). A
// CoordSystem is purely a *presentation and input* concern: it says how a
// coordinate pair is written down and read back, never how it is stored. That
// keeps the georeferencing math in one system and confines projection to this
// file's two conversion functions.
//
// Supported: WGS84 geographic (lat/lon degrees) and UTM (Universal Transverse
// Mercator) with an explicit zone and hemisphere. UTM uses the WGS84 datum;
// for ETRS89-based national grids (EPSG:258xx, the usual German orthophoto
// CRS) the difference is a few centimetres — far below the metre-scale
// precision a search radius or a change footprint is judged at.

import proj4 from "proj4";

export type CoordFormat = "wgs84" | "utm";

export const COORD_FORMATS: CoordFormat[] = ["wgs84", "utm"];

export interface CoordSystem {
  format: CoordFormat;
  // UTM zone 1..60 and hemisphere. Ignored when format === "wgs84", but kept
  // on the object so switching format back and forth doesn't lose the zone.
  zone: number;
  south: boolean;
}

export const MIN_UTM_ZONE = 1;
export const MAX_UTM_ZONE = 60;

// Zone 32N covers most of Germany (6°E–12°E) — the natural default for the
// orthophoto and DIM-point data this app is built around. Export defaults to
// WGS84 instead (see DEFAULT_EXPORT_CRS) so existing exports keep their shape
// until the user asks for something else.
export const DEFAULT_COORD_SYSTEM: CoordSystem = { format: "utm", zone: 32, south: false };
export const DEFAULT_EXPORT_CRS: CoordSystem = { format: "wgs84", zone: 32, south: false };

export function clampZone(zone: number): number {
  if (!Number.isFinite(zone)) return DEFAULT_COORD_SYSTEM.zone;
  return Math.min(MAX_UTM_ZONE, Math.max(MIN_UTM_ZONE, Math.round(zone)));
}

// The UTM zone whose 6°-wide band contains this longitude. Used to preselect a
// sensible zone from the loaded GeoTIFF instead of making the user work it out.
// (Norway/Svalbard have irregular zone widths; those exceptions are ignored —
// this only picks a *default* the user can override.)
export function utmZoneForLon(lon: number): number {
  return clampZone(Math.floor((((lon + 180) % 360) + 360) % 360 / 6) + 1);
}

export function coordSystemForLonLat(lon: number, lat: number): CoordSystem {
  return { format: "utm", zone: utmZoneForLon(lon), south: lat < 0 };
}

export function crsProj4(cs: CoordSystem): string {
  if (cs.format === "wgs84") return "WGS84";
  return `+proj=utm +zone=${clampZone(cs.zone)}${cs.south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}

// EPSG code for the system, for labelling exports. WGS84 geographic is 4326;
// WGS84/UTM north is 326xx and south 327xx.
export function crsEpsg(cs: CoordSystem): string {
  if (cs.format === "wgs84") return "EPSG:4326";
  return `EPSG:${(cs.south ? 32700 : 32600) + clampZone(cs.zone)}`;
}

// Short human label, e.g. "WGS84 (lat/lon)" or "UTM 32N".
export function crsLabel(cs: CoordSystem): string {
  if (cs.format === "wgs84") return "WGS84 lat/lon";
  return `UTM ${clampZone(cs.zone)}${cs.south ? "S" : "N"}`;
}

// Machine-readable identity, for a slug in an export's CRS column/filename.
export function crsId(cs: CoordSystem): string {
  return cs.format === "wgs84" ? "wgs84" : `utm${clampZone(cs.zone)}${cs.south ? "s" : "n"}`;
}

export function sameCrs(a: CoordSystem, b: CoordSystem): boolean {
  if (a.format !== b.format) return false;
  if (a.format === "wgs84") return true;
  return clampZone(a.zone) === clampZone(b.zone) && a.south === b.south;
}

// ── Conversion ─────────────────────────────────────────────────────────────
// `x`/`y` are the system's own axis order as a *user* writes them: for WGS84
// that is (lon, lat) degrees, for UTM (easting, northing) metres. The lat/lon
// side is always WGS84 lon/lat, matching the app's internal representation.

export function fromLonLat(cs: CoordSystem, lon: number, lat: number): [number, number] {
  if (cs.format === "wgs84") return [lon, lat];
  const [x, y] = proj4("WGS84", crsProj4(cs), [lon, lat]);
  return [x, y];
}

export function toLonLat(cs: CoordSystem, x: number, y: number): [number, number] {
  if (cs.format === "wgs84") return [x, y];
  const [lon, lat] = proj4(crsProj4(cs), "WGS84", [x, y]);
  return [lon, lat];
}

// ── Zone-prefixed eastings ─────────────────────────────────────────────────
// German UTM coordinates are commonly written with the zone number glued onto
// the front of the easting ("Ostwert mit Zonenkennziffer"): 32578636 means
// zone 32, easting 578 636 m. A bare UTM easting is always 6 digits
// (100 000–900 000 m within a zone), so any value of 1 000 000 or more carries
// a zone prefix — that is what makes this decodable without extra input.

export interface ParsedEasting {
  easting: number;
  // The zone read off the prefix, or null when the value was a bare easting.
  zone: number | null;
}

export function parseEasting(value: number): ParsedEasting {
  if (!Number.isFinite(value) || Math.abs(value) < 1_000_000) return { easting: value, zone: null };
  const zone = Math.floor(value / 1_000_000);
  if (zone < MIN_UTM_ZONE || zone > MAX_UTM_ZONE) return { easting: value, zone: null };
  return { easting: value % 1_000_000, zone };
}

// The inverse, for writing a coordinate back out in the same convention.
export function withZonePrefix(easting: number, zone: number): number {
  return clampZone(zone) * 1_000_000 + Math.round(easting);
}

// ── Formatting ─────────────────────────────────────────────────────────────
// Degrees need ~6 decimals to resolve to the decimetre; projected metres are
// already metre-scale, so 2 decimals is more than enough and 0 is what a DIM
// point list actually carries.

export function coordDecimals(cs: CoordSystem): number {
  return cs.format === "wgs84" ? 6 : 2;
}

export function formatCoordValue(cs: CoordSystem, n: number, decimals = coordDecimals(cs)): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

// The two axis labels of a system, in the order a user enters/reads them.
// `zonePrefixed` switches the easting label to the German zone-prefixed form.
export function axisLabels(cs: CoordSystem, zonePrefixed = false): { x: string; y: string } {
  if (cs.format === "wgs84") return { x: "Lon", y: "Lat" };
  return { x: zonePrefixed ? "UTM_E (zone-prefixed)" : "UTM_E", y: "UTM_N" };
}

// One-line rendering of a WGS84 position in the target system, e.g.
// "578636.00, 5345793.00" (UTM) or "9.9412, 48.2731" (WGS84). Used by the PDF
// coordinate column and the map captions.
export function formatLonLatIn(cs: CoordSystem, lon: number, lat: number, decimals?: number): string {
  const [x, y] = fromLonLat(cs, lon, lat);
  const d = decimals ?? coordDecimals(cs);
  // WGS84 is conventionally read/written lat-first in this app's UI, projected
  // systems easting-first — keep each to its own convention.
  return cs.format === "wgs84" ? `${lat.toFixed(d)}, ${lon.toFixed(d)}` : `${x.toFixed(d)}, ${y.toFixed(d)}`;
}

// Bounds for validating manual entry. Degrees have hard limits; projected
// metres are only sanity-checked (a UTM easting is always inside one zone's
// band, northings span the hemisphere).
export function axisBounds(cs: CoordSystem): { x: [number, number]; y: [number, number] } {
  if (cs.format === "wgs84") return { x: [-180, 180], y: [-90, 90] };
  // Easting allows the zone-prefixed form (up to 60 999 999); northing covers
  // both hemispheres' full range.
  return { x: [0, 60_999_999], y: [0, 10_000_000] };
}
