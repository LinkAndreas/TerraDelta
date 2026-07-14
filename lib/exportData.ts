// §2/§3: CSV export (with coordinates of detected changes) and a
// QGIS-importable GeoJSON (EPSG:4326 Point features — QGIS opens these via
// drag-and-drop with no import wizard needed).

import { changeCenterLonLat } from "./geo";
import { CATEGORY_REF, type Category, type Change, type GeoRef } from "./types";

// Official Mini-OK BW catalog reference for a change's category, or "" if
// the category isn't a recognized catalog leaf (shouldn't happen — kept
// defensive since exports run on user-facing data).
function catalogRef(category: string): string {
  return CATEGORY_REF[category as Category] ?? "";
}

function triggerDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(changes: Change[], geo: GeoRef): void {
  const header = ["id", "category", "catalog_ref", "change_type", "confidence", "description", "lon", "lat"];
  const rows = changes.map((c) => {
    const [lon, lat] = changeCenterLonLat(geo, c);
    return [c.id, c.category, catalogRef(c.category), c.change_type, c.confidence, c.description, lon.toFixed(7), lat.toFixed(7)];
  });
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  triggerDownload(csv, "text/csv;charset=utf-8", `terradelta-changes-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportGeoJson(changes: Change[], geo: GeoRef): void {
  const featureCollection = {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } }, // WGS84 lon/lat — QGIS's default for GeoJSON
    features: changes.map((c) => {
      const [lon, lat] = changeCenterLonLat(geo, c);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          id: c.id,
          category: c.category,
          catalog_ref: catalogRef(c.category),
          change_type: c.change_type,
          confidence: c.confidence,
          description: c.description,
        },
      };
    }),
  };
  triggerDownload(
    JSON.stringify(featureCollection, null, 2),
    "application/geo+json",
    `terradelta-changes-${new Date().toISOString().slice(0, 10)}.geojson`,
  );
}
