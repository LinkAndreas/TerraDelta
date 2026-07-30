// Data exports for detected changes:
//  • CSV — every change with its catalog reference, WGS84 center coordinate,
//    real-world footprint area, corroboration count, and verifier note.
//  • GeoJSON — QGIS-importable EPSG:4326 *polygon* footprints (the change's
//    actual bounding box on the ground, not just a center point) carrying the
//    same rich attributes.
//  • KML — the same footprints color-coded by change type, for Google Earth.
//  • ZIP — a single "export all" bundle (PDF report + CSV + GeoJSON + KML).
//
// Coordinate-bearing formats require GeoTIFF georeferencing (`geo`); CSV also
// works without it (coordinate/area columns are simply omitted).
//
// Every coordinate an export writes is expressed in the user-selected
// CoordSystem (`crs`, § lib/crs.ts) — CSV columns, KML descriptions and
// GeoJSON properties alike, each labelled with the system's EPSG code so a
// file is never ambiguous about what its numbers mean. GeoJSON and KML
// *geometry* stays WGS84 lon/lat: both formats mandate it (GeoJSON RFC 7946,
// KML 2.2), and writing projected metres into those coordinate elements would
// produce files that QGIS and Google Earth silently misplace. The selected
// system therefore rides along as attributes there rather than replacing the
// geometry.

import { changeAreaM2, changeBboxRingLonLat, changeCenterLonLat, dimPointForChange } from "./geo";
import { crsEpsg, crsId, fromLonLat, coordDecimals, DEFAULT_EXPORT_CRS, type CoordSystem } from "./crs";
import {
  CATEGORY_REF,
  CHANGE_COLORS,
  type Category,
  type Change,
  type ChangeType,
  type DimPoint,
  type GeoRef,
} from "./types";
import type { Lang } from "./i18n";
import type { PdfFilterInfo } from "./pdf";

// Everything an export needs beyond the changes themselves. Grouped into one
// object because it is threaded through every format and the ZIP bundle.
export interface ExportContext {
  geo?: GeoRef | null;
  // Coordinate system the exported coordinates are written in.
  crs?: CoordSystem;
  // Present when the run was restricted to DIM points — adds a column naming
  // the point each change was found at.
  dimPoints?: DimPoint[];
}

// Official Mini-OK BW catalog reference for a change's category, or "" if the
// category isn't a recognized catalog leaf (the UNCLASSIFIED sentinel, for a
// difference no catalog object type describes).
function catalogRef(category: string): string {
  return CATEGORY_REF[category as Category] ?? "";
}

// The alternative classifications of a change, as one compact field:
// "platz.parkplatz:71|strasse:45". Empty when the best match was the only one
// (or when nothing in the catalog fit). Kept as a single column/property so
// every export format stays flat and diff-friendly.
function alternativesField(c: Change): string {
  return (c.matches ?? [])
    .slice(1)
    .map((m) => `${m.category}:${Math.round(m.fit)}`)
    .join("|");
}

function triggerDownload(content: string | Blob, mimeType: string, filename: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Shared per-change attribute record ──────────────────────────────────────
// One flat object of the attributes every format shares, so CSV columns,
// GeoJSON properties, and KML fields stay in sync.

interface ChangeRecord {
  id: string;
  // Name of the DIM point this change was found at, "" when the run wasn't
  // restricted to points (or the change fell outside all of them).
  dim_point: string;
  category: string;
  catalog_ref: string;
  // How well `category` (the best-fitting catalog type) matches, 0..100 —
  // null when no catalog type fit the difference at all.
  category_fit: number | null;
  // Runner-up classifications, "category:fit" pairs joined by "|".
  category_alternatives: string;
  change_type: ChangeType;
  confidence: string;
  score: number;
  agreement: number;
  description: string;
  note: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  // Always WGS84 — the geometry every format's spec requires.
  center_lon: number | null;
  center_lat: number | null;
  // The same center in the selected export system: (lon, lat) degrees for
  // WGS84, (easting, northing) metres for UTM. Equal to center_lon/lat when
  // the selected system IS WGS84.
  center_x: number | null;
  center_y: number | null;
  crs: string;
  area_m2: number | null;
}

function toRecord(c: Change, ctx: ExportContext = {}): ChangeRecord {
  const { geo, crs = DEFAULT_EXPORT_CRS, dimPoints } = ctx;
  const [x, y, w, h] = c.bbox;
  let center_lon: number | null = null;
  let center_lat: number | null = null;
  let center_x: number | null = null;
  let center_y: number | null = null;
  let area_m2: number | null = null;
  let dim_point = "";
  if (geo) {
    const [lon, lat] = changeCenterLonLat(geo, c);
    center_lon = lon;
    center_lat = lat;
    [center_x, center_y] = fromLonLat(crs, lon, lat);
    area_m2 = changeAreaM2(geo, c);
    if (dimPoints && dimPoints.length > 0) {
      dim_point = dimPointForChange(geo, dimPoints, c)?.name ?? "";
    }
  }
  return {
    id: c.id,
    dim_point,
    category: c.category,
    catalog_ref: catalogRef(c.category),
    category_fit: c.matches?.[0]?.fit ?? null,
    category_alternatives: alternativesField(c),
    change_type: c.change_type,
    confidence: c.confidence,
    score: c.score,
    agreement: c.agreement ?? 1,
    description: c.description,
    note: c.note ?? "",
    bbox_x: x,
    bbox_y: y,
    bbox_w: w,
    bbox_h: h,
    center_lon,
    center_lat,
    center_x,
    center_y,
    crs: crsEpsg(crs),
    area_m2,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Coordinate column names follow the selected system, so a reader can tell
// what the numbers are without consulting the crs column: lon/lat for WGS84,
// utm_e/utm_n for UTM.
function coordColumnNames(crs: CoordSystem): [string, string] {
  return crs.format === "wgs84" ? ["lon", "lat"] : ["utm_e", "utm_n"];
}

// CSV body as a string — shared by the direct download and the ZIP bundle.
function csvString(changes: Change[], ctx: ExportContext = {}): string {
  const { geo, crs = DEFAULT_EXPORT_CRS, dimPoints } = ctx;
  const hasGeo = !!geo;
  const hasDim = hasGeo && !!dimPoints && dimPoints.length > 0;
  const [xCol, yCol] = coordColumnNames(crs);
  const decimals = coordDecimals(crs);
  const header = [
    "id",
    ...(hasDim ? ["dim_point"] : []),
    "category",
    "catalog_ref",
    "category_fit",
    "category_alternatives",
    "change_type",
    "confidence",
    "confidence_score",
    "agreement",
    "description",
    "note",
    ...(hasGeo ? [xCol, yCol, "crs", "area_m2"] : []),
    "bbox_x",
    "bbox_y",
    "bbox_w",
    "bbox_h",
  ];
  const rows = changes.map((c) => {
    const r = toRecord(c, ctx);
    return [
      r.id,
      ...(hasDim ? [r.dim_point] : []),
      r.category,
      r.catalog_ref,
      r.category_fit ?? "",
      r.category_alternatives,
      r.change_type,
      r.confidence,
      r.score,
      r.agreement,
      r.description,
      r.note,
      ...(hasGeo
        ? [r.center_x!.toFixed(decimals), r.center_y!.toFixed(decimals), r.crs, r.area_m2!.toFixed(1)]
        : []),
      r.bbox_x.toFixed(6),
      r.bbox_y.toFixed(6),
      r.bbox_w.toFixed(6),
      r.bbox_h.toFixed(6),
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// Exported filenames carry the coordinate system, so two exports of the same
// run in different systems don't overwrite each other in the Downloads folder.
function stampWithCrs(ctx: ExportContext): string {
  const crs = ctx.crs ?? DEFAULT_EXPORT_CRS;
  return ctx.geo ? `${fileStamp()}-${crsId(crs)}` : fileStamp();
}

export function exportCsv(changes: Change[], ctx: ExportContext = {}): void {
  triggerDownload(csvString(changes, ctx), "text/csv;charset=utf-8", `terradelta-changes-${stampWithCrs(ctx)}.csv`);
}

// ── GeoJSON (polygon footprints) ────────────────────────────────────────────

export function buildGeoJson(changes: Change[], geo: GeoRef, ctx: ExportContext = {}): string {
  const full: ExportContext = { ...ctx, geo };
  const crs = full.crs ?? DEFAULT_EXPORT_CRS;
  const [xProp, yProp] = coordColumnNames(crs);
  const featureCollection = {
    type: "FeatureCollection",
    // Geometry is WGS84 lon/lat, as GeoJSON requires. The user-selected
    // system travels in each feature's properties (see center_x/center_y
    // below) instead of being forced onto the geometry.
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: changes.map((c) => {
      const r = toRecord(c, full);
      return {
        type: "Feature",
        // Polygon footprint = the change's bounding box on the ground, so QGIS
        // draws the real extent (a parcel, a building) rather than a dot.
        geometry: { type: "Polygon", coordinates: [changeBboxRingLonLat(geo, c)] },
        properties: {
          id: r.id,
          ...(r.dim_point ? { dim_point: r.dim_point } : {}),
          category: r.category,
          catalog_ref: r.catalog_ref,
          category_fit: r.category_fit,
          category_alternatives: r.category_alternatives,
          change_type: r.change_type,
          confidence: r.confidence,
          confidence_score: r.score,
          agreement: r.agreement,
          description: r.description,
          note: r.note,
          center_lon: r.center_lon,
          center_lat: r.center_lat,
          [`center_${xProp}`]: r.center_x,
          [`center_${yProp}`]: r.center_y,
          crs: r.crs,
          area_m2: r.area_m2 !== null ? Math.round(r.area_m2 * 10) / 10 : null,
        },
      };
    }),
  };
  return JSON.stringify(featureCollection, null, 2);
}

export function exportGeoJson(changes: Change[], geo: GeoRef, ctx: ExportContext = {}): void {
  triggerDownload(
    buildGeoJson(changes, geo, ctx),
    "application/geo+json",
    `terradelta-changes-${stampWithCrs({ ...ctx, geo })}.geojson`,
  );
}

// ── KML (Google Earth) ──────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// KML color is aabbggrr (alpha, blue, green, red) hex — reorder our #rrggbb.
function kmlColor(hex: string, alpha = "ff"): string {
  const rr = hex.slice(1, 3);
  const gg = hex.slice(3, 5);
  const bb = hex.slice(5, 7);
  return `${alpha}${bb}${gg}${rr}`;
}

export function buildKml(changes: Change[], geo: GeoRef, lang: Lang, ctx: ExportContext = {}): string {
  const full: ExportContext = { ...ctx, geo };
  const crs = full.crs ?? DEFAULT_EXPORT_CRS;
  const decimals = coordDecimals(crs);
  const types: ChangeType[] = ["added", "removed", "modified"];
  const styles = types
    .map(
      (tp) => `    <Style id="td-${tp}">
      <LineStyle><color>${kmlColor(CHANGE_COLORS[tp])}</color><width>2</width></LineStyle>
      <PolyStyle><color>${kmlColor(CHANGE_COLORS[tp], "4d")}</color></PolyStyle>
    </Style>`,
    )
    .join("\n");

  const placemarks = changes
    .map((c, i) => {
      const r = toRecord(c, full);
      // KML geometry is WGS84 lon/lat by spec; the selected system is written
      // into the description alongside it so a reviewer reading the placemark
      // sees the coordinates they asked for.
      const ring = changeBboxRingLonLat(geo, c)
        .map(([lon, lat]) => `${lon},${lat},0`)
        .join(" ");
      const areaStr = r.area_m2 !== null ? `${Math.round(r.area_m2)} m²` : "";
      const coordStr =
        r.center_x !== null && r.center_y !== null
          ? `${r.center_x.toFixed(decimals)}, ${r.center_y.toFixed(decimals)} (${r.crs})`
          : "";
      const catLine = [r.catalog_ref, r.category_fit !== null ? `${r.category_fit}% fit` : ""]
        .filter(Boolean)
        .join(" · ");
      const desc = [
        [catLine, r.change_type, `${r.score}%`].filter(Boolean).join(" · "),
        r.dim_point ? `DIM: ${r.dim_point}` : "",
        r.category_alternatives ? `alt: ${r.category_alternatives}` : "",
        r.description,
        r.note ? `↳ ${r.note}` : "",
        coordStr,
        areaStr,
      ]
        .filter(Boolean)
        .join("\n");
      return `    <Placemark>
      <name>${i + 1}. ${xmlEscape(r.category)}</name>
      <description>${xmlEscape(desc)}</description>
      <styleUrl>#td-${r.change_type}</styleUrl>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>TerraDelta — ${lang === "de" ? "Erkannte Veränderungen" : "Detected changes"}</name>
${styles}
${placemarks}
  </Document>
</kml>`;
}

export function exportKml(changes: Change[], geo: GeoRef, lang: Lang, ctx: ExportContext = {}): void {
  triggerDownload(
    buildKml(changes, geo, lang, ctx),
    "application/vnd.google-earth.kml+xml",
    `terradelta-changes-${stampWithCrs({ ...ctx, geo })}.kml`,
  );
}

// ── Combined ZIP bundle ─────────────────────────────────────────────────────
// One download containing the PDF report plus every data export that the
// current input supports (GeoJSON/KML only when georeferenced).

export async function exportAll(
  opts: {
    changes: Change[];
    refUrl: string;
    targetUrl: string;
    lang: Lang;
    // Forwarded to the PDF so its numbering and filter note match the app.
    displayNumbers?: number[];
    filter?: PdfFilterInfo;
  } & ExportContext,
): Promise<void> {
  const { changes, refUrl, targetUrl, lang, geo, crs = DEFAULT_EXPORT_CRS, dimPoints } = opts;
  const ctx: ExportContext = { geo, crs, dimPoints };
  const [{ makeZip }, { buildReportBlob }] = await Promise.all([import("./zip"), import("./pdf")]);
  const enc = new TextEncoder();
  const stamp = stampWithCrs(ctx);

  const pdfBlob = await buildReportBlob({
    refUrl,
    targetUrl,
    changes,
    lang,
    geo,
    crs,
    dimPoints,
    displayNumbers: opts.displayNumbers,
    filter: opts.filter,
  });
  const entries = [
    { name: `terradelta-report-${stamp}.pdf`, data: new Uint8Array(await pdfBlob.arrayBuffer()) },
    { name: `terradelta-changes-${stamp}.csv`, data: enc.encode(csvString(changes, ctx)) },
  ];
  if (geo) {
    entries.push({ name: `terradelta-changes-${stamp}.geojson`, data: enc.encode(buildGeoJson(changes, geo, ctx)) });
    entries.push({ name: `terradelta-changes-${stamp}.kml`, data: enc.encode(buildKml(changes, geo, lang, ctx)) });
  }

  triggerDownload(makeZip(entries), "application/zip", `terradelta-export-${stamp}.zip`);
}
