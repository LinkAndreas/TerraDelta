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

import { changeAreaM2, changeBboxRingLonLat, changeCenterLonLat } from "./geo";
import { CATEGORY_REF, CHANGE_COLORS, type Category, type Change, type ChangeType, type GeoRef } from "./types";
import type { Lang } from "./i18n";

// Official Mini-OK BW catalog reference for a change's category, or "" if
// the category isn't a recognized catalog leaf (shouldn't happen — kept
// defensive since exports run on user-facing data).
function catalogRef(category: string): string {
  return CATEGORY_REF[category as Category] ?? "";
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
  category: string;
  catalog_ref: string;
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
  center_lon: number | null;
  center_lat: number | null;
  area_m2: number | null;
}

function toRecord(c: Change, geo?: GeoRef | null): ChangeRecord {
  const [x, y, w, h] = c.bbox;
  let center_lon: number | null = null;
  let center_lat: number | null = null;
  let area_m2: number | null = null;
  if (geo) {
    const [lon, lat] = changeCenterLonLat(geo, c);
    center_lon = lon;
    center_lat = lat;
    area_m2 = changeAreaM2(geo, c);
  }
  return {
    id: c.id,
    category: c.category,
    catalog_ref: catalogRef(c.category),
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
    area_m2,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV body as a string — shared by the direct download and the ZIP bundle.
function csvString(changes: Change[], geo?: GeoRef | null): string {
  const hasGeo = !!geo;
  const header = [
    "id",
    "category",
    "catalog_ref",
    "change_type",
    "confidence",
    "confidence_score",
    "agreement",
    "description",
    "note",
    ...(hasGeo ? ["lon", "lat", "area_m2"] : []),
    "bbox_x",
    "bbox_y",
    "bbox_w",
    "bbox_h",
  ];
  const rows = changes.map((c) => {
    const r = toRecord(c, geo);
    return [
      r.id,
      r.category,
      r.catalog_ref,
      r.change_type,
      r.confidence,
      r.score,
      r.agreement,
      r.description,
      r.note,
      ...(hasGeo ? [r.center_lon!.toFixed(7), r.center_lat!.toFixed(7), r.area_m2!.toFixed(1)] : []),
      r.bbox_x.toFixed(6),
      r.bbox_y.toFixed(6),
      r.bbox_w.toFixed(6),
      r.bbox_h.toFixed(6),
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportCsv(changes: Change[], geo?: GeoRef | null): void {
  triggerDownload(csvString(changes, geo), "text/csv;charset=utf-8", `terradelta-changes-${fileStamp()}.csv`);
}

// ── GeoJSON (polygon footprints) ────────────────────────────────────────────

export function buildGeoJson(changes: Change[], geo: GeoRef): string {
  const featureCollection = {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } }, // WGS84 lon/lat
    features: changes.map((c) => {
      const r = toRecord(c, geo);
      return {
        type: "Feature",
        // Polygon footprint = the change's bounding box on the ground, so QGIS
        // draws the real extent (a parcel, a building) rather than a dot.
        geometry: { type: "Polygon", coordinates: [changeBboxRingLonLat(geo, c)] },
        properties: {
          id: r.id,
          category: r.category,
          catalog_ref: r.catalog_ref,
          change_type: r.change_type,
          confidence: r.confidence,
          confidence_score: r.score,
          agreement: r.agreement,
          description: r.description,
          note: r.note,
          center_lon: r.center_lon,
          center_lat: r.center_lat,
          area_m2: r.area_m2 !== null ? Math.round(r.area_m2 * 10) / 10 : null,
        },
      };
    }),
  };
  return JSON.stringify(featureCollection, null, 2);
}

export function exportGeoJson(changes: Change[], geo: GeoRef): void {
  triggerDownload(buildGeoJson(changes, geo), "application/geo+json", `terradelta-changes-${fileStamp()}.geojson`);
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

export function buildKml(changes: Change[], geo: GeoRef, lang: Lang): string {
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
      const r = toRecord(c, geo);
      const ring = changeBboxRingLonLat(geo, c)
        .map(([lon, lat]) => `${lon},${lat},0`)
        .join(" ");
      const areaStr = r.area_m2 !== null ? `${Math.round(r.area_m2)} m²` : "";
      const desc = [
        `${r.catalog_ref} · ${r.change_type} · ${r.score}%`,
        r.description,
        r.note ? `↳ ${r.note}` : "",
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

export function exportKml(changes: Change[], geo: GeoRef, lang: Lang): void {
  triggerDownload(
    buildKml(changes, geo, lang),
    "application/vnd.google-earth.kml+xml",
    `terradelta-changes-${fileStamp()}.kml`,
  );
}

// ── Combined ZIP bundle ─────────────────────────────────────────────────────
// One download containing the PDF report plus every data export that the
// current input supports (GeoJSON/KML only when georeferenced).

export async function exportAll(opts: {
  changes: Change[];
  refUrl: string;
  targetUrl: string;
  lang: Lang;
  geo?: GeoRef | null;
}): Promise<void> {
  const { changes, refUrl, targetUrl, lang, geo } = opts;
  const [{ makeZip }, { buildReportBlob }] = await Promise.all([import("./zip"), import("./pdf")]);
  const enc = new TextEncoder();
  const stamp = fileStamp();

  const pdfBlob = await buildReportBlob({ refUrl, targetUrl, changes, lang, geo });
  const entries = [
    { name: `terradelta-report-${stamp}.pdf`, data: new Uint8Array(await pdfBlob.arrayBuffer()) },
    { name: `terradelta-changes-${stamp}.csv`, data: enc.encode(csvString(changes, geo)) },
  ];
  if (geo) {
    entries.push({ name: `terradelta-changes-${stamp}.geojson`, data: enc.encode(buildGeoJson(changes, geo)) });
    entries.push({ name: `terradelta-changes-${stamp}.kml`, data: enc.encode(buildKml(changes, geo, lang)) });
  }

  triggerDownload(makeZip(entries), "application/zip", `terradelta-export-${stamp}.zip`);
}
