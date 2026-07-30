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
// Systems are identified by their EPSG code, which is what surveying data
// actually carries — an orthophoto's metadata, a DIM point list and a QGIS
// project all name an EPSG, not "UTM zone 32 north". The registry below is
// curated rather than complete: these are the systems German and central
// European orthophoto work uses, and each one is only here because its proj4
// definition has been checked.

import proj4 from "proj4";

export interface CoordSystem {
  epsg: number;
}

export interface CrsDef {
  code: number;
  // Shown in the picker, e.g. "ETRS89 / UTM 32N".
  label: string;
  proj4: string;
  // Degrees (lon/lat) rather than projected metres.
  geographic: boolean;
  // Axis captions in the order a user enters them.
  xLabel: string;
  yLabel: string;
  // Decimal places for display and export.
  decimals: number;
  // The UTM zone this system belongs to, where it has one. Used to decode the
  // German zone-prefixed easting convention on import.
  utmZone?: number;
  // True for the "zE-N" systems (EPSG:4647, 5650) whose easting already
  // carries the zone number, so it must NOT be stripped again.
  zonePrefixed?: boolean;
  // Grouping in the picker.
  group: "geographic" | "etrs89" | "wgs84utm" | "legacy" | "web";
}

// ETRS89 and WGS84 agree to a few centimetres in Europe, far below the
// metre-scale precision a search radius or a change footprint is judged at —
// but they are kept as separate entries because the EPSG code is what users
// have to match against their source data.
const ETRS89_UTM = (zone: number) =>
  `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
const WGS84_UTM = (zone: number) => `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
// Gauss-Krüger on the Bessel ellipsoid. The 7-parameter towgs84 shift is the
// standard national one for Germany; without it GK coordinates land ~600 m off.
const DHDN_GK = (zone: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=1 +x_0=${zone * 1_000_000 + 500_000} +y_0=0 ` +
  `+ellps=bessel +datum=potsdam +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs`;

export const CRS_LIST: CrsDef[] = [
  {
    code: 4326,
    label: "WGS 84 (Lat/Lon)",
    proj4: "+proj=longlat +datum=WGS84 +no_defs",
    geographic: true,
    xLabel: "Lon",
    yLabel: "Lat",
    decimals: 6,
    group: "geographic",
  },
  {
    code: 25831,
    label: "ETRS89 / UTM 31N",
    proj4: ETRS89_UTM(31),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 31,
    group: "etrs89",
  },
  {
    code: 25832,
    label: "ETRS89 / UTM 32N",
    proj4: ETRS89_UTM(32),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 32,
    group: "etrs89",
  },
  {
    code: 25833,
    label: "ETRS89 / UTM 33N",
    proj4: ETRS89_UTM(33),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 33,
    group: "etrs89",
  },
  {
    code: 4647,
    label: "ETRS89 / UTM 32N (zE-N)",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=9 +k=0.9996 +x_0=32500000 +y_0=0 " +
      "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 32,
    zonePrefixed: true,
    group: "etrs89",
  },
  {
    code: 5650,
    label: "ETRS89 / UTM 33N (zE-N)",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=33500000 +y_0=0 " +
      "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 33,
    zonePrefixed: true,
    group: "etrs89",
  },
  {
    code: 32631,
    label: "WGS 84 / UTM 31N",
    proj4: WGS84_UTM(31),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 31,
    group: "wgs84utm",
  },
  {
    code: 32632,
    label: "WGS 84 / UTM 32N",
    proj4: WGS84_UTM(32),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 32,
    group: "wgs84utm",
  },
  {
    code: 32633,
    label: "WGS 84 / UTM 33N",
    proj4: WGS84_UTM(33),
    geographic: false,
    xLabel: "UTM_E",
    yLabel: "UTM_N",
    decimals: 2,
    utmZone: 33,
    group: "wgs84utm",
  },
  {
    code: 31466,
    label: "DHDN / Gauß-Krüger Zone 2",
    proj4: DHDN_GK(2),
    geographic: false,
    xLabel: "Rechtswert",
    yLabel: "Hochwert",
    decimals: 2,
    group: "legacy",
  },
  {
    code: 31467,
    label: "DHDN / Gauß-Krüger Zone 3",
    proj4: DHDN_GK(3),
    geographic: false,
    xLabel: "Rechtswert",
    yLabel: "Hochwert",
    decimals: 2,
    group: "legacy",
  },
  {
    code: 31468,
    label: "DHDN / Gauß-Krüger Zone 4",
    proj4: DHDN_GK(4),
    geographic: false,
    xLabel: "Rechtswert",
    yLabel: "Hochwert",
    decimals: 2,
    group: "legacy",
  },
  {
    code: 3857,
    label: "WGS 84 / Pseudo-Mercator",
    proj4:
      "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 " +
      "+units=m +nadgrids=@null +no_defs",
    geographic: false,
    xLabel: "X",
    yLabel: "Y",
    decimals: 2,
    group: "web",
  },
];

const BY_CODE = new Map(CRS_LIST.map((d) => [d.code, d]));

// Register every definition with proj4 once, so conversions can address them
// by "EPSG:xxxxx" and a caller never has to carry the raw proj4 string.
for (const def of CRS_LIST) proj4.defs(`EPSG:${def.code}`, def.proj4);

// ETRS89 / UTM 32N — what German orthophotos and DIM point lists are supplied
// in, and therefore what the app should assume until told otherwise.
export const DEFAULT_EPSG = 25832;
export const DEFAULT_COORD_SYSTEM: CoordSystem = { epsg: DEFAULT_EPSG };
// Exports default to the same system: a file whose coordinates match the
// source data needs no reprojection step on the receiving end.
export const DEFAULT_EXPORT_CRS: CoordSystem = { epsg: DEFAULT_EPSG };

export function crsDef(cs: CoordSystem): CrsDef {
  return BY_CODE.get(cs.epsg) ?? BY_CODE.get(DEFAULT_EPSG)!;
}

export function isKnownEpsg(code: number): boolean {
  return BY_CODE.has(code);
}

export function crsProj4(cs: CoordSystem): string {
  return crsDef(cs).proj4;
}

export function crsEpsg(cs: CoordSystem): string {
  return `EPSG:${crsDef(cs).code}`;
}

export function crsLabel(cs: CoordSystem): string {
  return crsDef(cs).label;
}

// Machine-readable identity, for a slug in an export's filename.
export function crsId(cs: CoordSystem): string {
  return `epsg${crsDef(cs).code}`;
}

export function sameCrs(a: CoordSystem, b: CoordSystem): boolean {
  return crsDef(a).code === crsDef(b).code;
}

export function isGeographic(cs: CoordSystem): boolean {
  return crsDef(cs).geographic;
}

// ── Conversion ─────────────────────────────────────────────────────────────
// `x`/`y` are the system's own axis order as a *user* writes them: for a
// geographic system that is (lon, lat) in degrees, for a projected one
// (easting, northing) in metres. The lat/lon side is always WGS84 lon/lat,
// matching the app's internal representation.

export function fromLonLat(cs: CoordSystem, lon: number, lat: number): [number, number] {
  const def = crsDef(cs);
  if (def.code === 4326) return [lon, lat];
  const [x, y] = proj4("WGS84", def.proj4, [lon, lat]);
  return [x, y];
}

export function toLonLat(cs: CoordSystem, x: number, y: number): [number, number] {
  const def = crsDef(cs);
  if (def.code === 4326) return [x, y];
  const [lon, lat] = proj4(def.proj4, "WGS84", [x, y]);
  return [lon, lat];
}

// ── Choosing a system for a loaded image ───────────────────────────────────

export function utmZoneForLon(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor(((((lon + 180) % 360) + 360) % 360) / 6) + 1));
}

// A sensible EPSG for a position, preferring the ETRS89 grids that German and
// central European data uses and falling back to the global WGS84/UTM ones.
export function coordSystemForLonLat(lon: number, lat: number): CoordSystem {
  if (lat < 0) return { epsg: DEFAULT_EPSG }; // southern hemisphere: no curated entry
  const zone = utmZoneForLon(lon);
  if (zone >= 31 && zone <= 33) return { epsg: 25800 + zone };
  if (zone >= 1 && zone <= 60 && isKnownEpsg(32600 + zone)) return { epsg: 32600 + zone };
  return { epsg: DEFAULT_EPSG };
}

// Best-matching registry entry for a GeoTIFF's own proj4 definition, so the
// picker can preselect the system the image is actually stored in. The image's
// proj4 string is not an EPSG code and cannot be reversed exactly, so this
// matches on the two things that identify the grid in practice: the UTM zone
// and the datum family.
export function coordSystemForProj4(def: string, centerLon: number, centerLat: number): CoordSystem {
  const zoneMatch = /\+zone=(\d+)/.exec(def);
  const isEtrs = /GRS80|etrs|ETRS/.test(def);
  const isWgs = /WGS84|WGS_1984/.test(def);
  // The zE-N grids are recognizable by their false easting alone.
  if (/\+x_0=32500000/.test(def)) return { epsg: 4647 };
  if (/\+x_0=33500000/.test(def)) return { epsg: 5650 };

  // A UTM grid is not always written as "+proj=utm +zone=N". GeoTIFF geokey
  // translation emits the equivalent transverse-Mercator form instead
  // (+proj=tmerc +k_0=0.9996 +x_0=500000 +lon_0=6·zone−183), which is what the
  // app actually receives from an orthophoto — recognize it by its shape.
  const utmZone = (() => {
    if (zoneMatch) return Number(zoneMatch[1]);
    const lon0 = /\+lon_0=(-?\d+(?:\.\d+)?)/.exec(def);
    const isUtmShaped = /\+k(?:_0)?=0\.9996\b/.test(def) && /\+x_0=500000\b/.test(def);
    if (!lon0 || !isUtmShaped) return null;
    const zone = (Number(lon0[1]) + 183) / 6;
    return Number.isInteger(zone) && zone >= 1 && zone <= 60 ? zone : null;
  })();

  if (utmZone !== null) {
    const zone = utmZone;
    if (isWgs && !isEtrs && isKnownEpsg(32600 + zone)) return { epsg: 32600 + zone };
    if (zone >= 31 && zone <= 33) return { epsg: 25800 + zone };
    if (isKnownEpsg(32600 + zone)) return { epsg: 32600 + zone };
  }
  if (/bessel|potsdam/i.test(def)) {
    const lonMatch = /\+lon_0=(\d+)/.exec(def);
    const gkZone = lonMatch ? Number(lonMatch[1]) / 3 : 0;
    if (isKnownEpsg(31464 + gkZone)) return { epsg: 31464 + gkZone };
  }
  return coordSystemForLonLat(centerLon, centerLat);
}

// ── Zone-prefixed eastings ─────────────────────────────────────────────────
// German UTM coordinates are commonly written with the zone number glued onto
// the front of the easting ("Ostwert mit Zonenkennziffer"): 32578636 means
// zone 32, easting 578 636 m. A bare UTM easting is always 6 digits
// (100 000–900 000 m within a zone), so any value of 1 000 000 or more carries
// a zone prefix — that is what makes it decodable.
//
// EPSG:4647 / 5650 are the exception: those grids define the prefix as part of
// the coordinate, so their eastings legitimately exceed 1 000 000 and must be
// left alone.

export interface ParsedEasting {
  easting: number;
  // The zone read off the prefix, or null when the value was already a plain
  // easting for the target system.
  zone: number | null;
}

export function parseEasting(value: number, cs?: CoordSystem): ParsedEasting {
  if (cs && crsDef(cs).zonePrefixed) return { easting: value, zone: null };
  if (!Number.isFinite(value) || Math.abs(value) < 1_000_000) return { easting: value, zone: null };
  const zone = Math.floor(value / 1_000_000);
  if (zone < 1 || zone > 60) return { easting: value, zone: null };
  return { easting: value % 1_000_000, zone };
}

// The registry entry for a UTM zone within the same datum family as `like`,
// so a zone prefix read off an imported easting can actually change the system
// used for that row rather than being silently ignored.
export function crsForZone(zone: number, like: CoordSystem): CoordSystem {
  const def = crsDef(like);
  if (def.group === "wgs84utm" && isKnownEpsg(32600 + zone)) return { epsg: 32600 + zone };
  if (isKnownEpsg(25800 + zone)) return { epsg: 25800 + zone };
  return like;
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function coordDecimals(cs: CoordSystem): number {
  return crsDef(cs).decimals;
}

export function formatCoordValue(cs: CoordSystem, n: number, decimals = coordDecimals(cs)): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

export function axisLabels(cs: CoordSystem): { x: string; y: string } {
  const def = crsDef(cs);
  return { x: def.xLabel, y: def.yLabel };
}

// One-line rendering of a WGS84 position in the target system. Geographic
// systems are read lat-first in this app's UI; projected ones easting-first.
export function formatLonLatIn(cs: CoordSystem, lon: number, lat: number, decimals?: number): string {
  const def = crsDef(cs);
  const d = decimals ?? def.decimals;
  if (def.geographic) return `${lat.toFixed(d)}, ${lon.toFixed(d)}`;
  const [x, y] = fromLonLat(cs, lon, lat);
  return `${x.toFixed(d)}, ${y.toFixed(d)}`;
}

// Bounds for validating manual entry: hard limits for degrees, generous sanity
// limits for projected metres (the zE-N grids reach eight digits).
export function axisBounds(cs: CoordSystem): { x: [number, number]; y: [number, number] } {
  if (crsDef(cs).geographic) return { x: [-180, 180], y: [-90, 90] };
  return { x: [-10_000_000, 60_999_999], y: [-10_000_000, 20_000_000] };
}
