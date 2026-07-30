// Import of DIM point lists from CSV.
//
// The expected shape is the German DIM export: one row per point, with the
// position in UTM (Ostwert/Nordwert) and a set of administrative columns that
// are carried along for display but never affect the search:
//
//   Beschreibung;Bemerkung;Nächste Durchsicht;Gemeinde;Landkreis;
//   Schlüssel-Gmd;Letztes Update;UTM_E;UTM_N
//
// Only the coordinate columns are strictly required — everything else is
// optional, so a hand-made two-column list works too. Header matching is
// diacritic- and punctuation-insensitive (see `normalizeHeader`) and accepts
// common English aliases, because these lists are edited by hand in Excel and
// the exact spelling of "Nächste Durchsicht" is not worth failing an import
// over.
//
// UTM_E is usually written with the zone glued onto the front ("32578636" =
// zone 32, easting 578 636) — the convention German authorities use. That is
// decoded here (see lib/crs.ts `parseEasting`); a bare 6-digit easting falls
// back to the zone the user selected in the UI.

import {
  clampZone,
  parseEasting,
  toLonLat,
  type CoordSystem,
} from "./crs";
import { DEFAULT_RADIUS_M, type DimPoint } from "./types";

// ── RFC 4180 splitter ──────────────────────────────────────────────────────
// Hand-rolled rather than pulled from a library: the app ships no CSV
// dependency, and the format we need is small — quoted fields, doubled quotes
// inside them, and embedded newlines (the "Bemerkung" column is a multi-line
// history block, which is exactly the case a naive line-by-line split breaks
// on).

function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // Swallow; the \n that follows ends the row (a lone \r also ends it).
      if (text[i + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Delimiter sniffing on the header line only: whichever candidate appears most
// often outside quotes wins. German Excel writes ";", most other tools ",".
function detectDelimiter(text: string): string {
  const headerEnd = text.search(/\r?\n/);
  const header = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const counts = [";", ",", "\t", "|"].map((d) => ({ d, n: header.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ";";
}

// ── Header mapping ─────────────────────────────────────────────────────────

// Lowercase, strip diacritics, and drop everything that isn't a letter or
// digit — so "Nächste Durchsicht", "naechste_durchsicht" and "NAECHSTEDURCHSICHT"
// all collapse to the same key.
function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type FieldKey =
  | "name"
  | "note"
  | "nextReview"
  | "municipality"
  | "district"
  | "municipalityKey"
  | "lastUpdate"
  | "easting"
  | "northing"
  | "lat"
  | "lon"
  | "radius";

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  name: ["beschreibung", "name", "bezeichnung", "description", "titel", "title", "id", "punkt"],
  note: ["bemerkung", "bemerkungen", "note", "notes", "kommentar", "comment", "remark"],
  // Aliases are compared against already-normalized headers, so they must
  // themselves be written in normalized form (lowercase, ae/oe/ue, no
  // punctuation) — "Nächste Durchsicht" normalizes to "naechstedurchsicht".
  nextReview: ["naechstedurchsicht", "durchsicht", "nextreview", "naechstepruefung"],
  municipality: ["gemeinde", "municipality", "ort", "stadt", "city"],
  district: ["landkreis", "kreis", "district", "county"],
  municipalityKey: ["schluesselgmd", "gemeindeschluessel", "schluessel", "ags", "municipalitykey", "gmdschluessel"],
  lastUpdate: ["letztesupdate", "lastupdate", "letzteaktualisierung", "updated", "stand"],
  easting: ["utme", "ostwert", "easting", "rechtswert", "east", "e", "x"],
  northing: ["utmn", "nordwert", "northing", "hochwert", "north", "n", "y"],
  lat: ["lat", "latitude", "breite", "geogrbreite", "breitengrad"],
  lon: ["lon", "lng", "long", "longitude", "laenge", "geogrlaenge", "laengengrad"],
  radius: ["radius", "radiusm", "umkreis", "suchradius", "buffer", "puffer"],
};

// Column index per field, or -1. First matching column wins, so a file with
// both "UTM_E" and a stray "x" column uses the explicit one.
function mapHeaders(header: string[]): Record<FieldKey, number> {
  const normalized = header.map(normalizeHeader);
  const result = {} as Record<FieldKey, number>;
  for (const key of Object.keys(HEADER_ALIASES) as FieldKey[]) {
    result[key] = -1;
    for (const alias of HEADER_ALIASES[key]) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        result[key] = idx;
        break;
      }
    }
  }
  return result;
}

// ── Number parsing ─────────────────────────────────────────────────────────

// Accepts "578636", "578.636", "578636,50", "578.636,50" and "578,636.50".
// The rule: whichever of "." / "," appears LAST is the decimal separator; any
// earlier occurrences of the other one are thousands grouping. A single
// separator followed by exactly three digits is grouping, not a decimal —
// which is what makes "578.636" parse as 578636 rather than 578.636.
function parseNumber(raw: string): number {
  const s = raw.trim().replace(/\s|'/g, "");
  if (s === "") return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma === -1 && lastDot === -1) return Number(s);

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    return Number(s.split(groupSep).join("").replace(decimalSep, "."));
  }

  const sep = lastComma !== -1 ? "," : ".";
  const idx = lastComma !== -1 ? lastComma : lastDot;
  const decimals = s.length - idx - 1;
  const occurrences = s.split(sep).length - 1;
  // Exactly-3 trailing digits with no other separator is ambiguous; treat it
  // as grouping, which is right for coordinates ("578.636" m) and harmless
  // for a radius written that way.
  if (decimals === 3 && occurrences >= 1) return Number(s.split(sep).join(""));
  return Number(s.replace(sep, "."));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface DimCsvIssue {
  // 1-based row number in the source file, counting the header as row 1.
  row: number;
  message: string;
}

export interface DimCsvResult {
  points: DimPoint[];
  // Rows that were skipped, with the reason — surfaced in the UI so a partly
  // broken file reports what it lost instead of silently importing less.
  errors: DimCsvIssue[];
  // Non-fatal observations about the file as a whole (e.g. no radius column).
  warnings: string[];
  // Which coordinate columns the file turned out to use.
  detectedFormat: "utm" | "wgs84" | null;
}

export interface DimCsvOptions {
  // Zone/hemisphere to assume for UTM coordinates that carry no zone prefix.
  fallbackCrs: CoordSystem;
  // Radius for rows without a radius column of their own.
  defaultRadiusM?: number;
  // Prefix for generated point ids, so two imports don't collide.
  idPrefix?: string;
}

export function parseDimCsv(text: string, opts: DimCsvOptions): DimCsvResult {
  const { fallbackCrs, defaultRadiusM = DEFAULT_RADIUS_M, idPrefix = "dim" } = opts;
  const errors: DimCsvIssue[] = [];
  const warnings: string[] = [];

  const clean = text.replace(/^\ufeff/, "");
  if (clean.trim() === "") {
    return { points: [], errors: [{ row: 0, message: "empty" }], warnings, detectedFormat: null };
  }

  const rows = splitRows(clean, detectDelimiter(clean)).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) {
    return { points: [], errors: [{ row: 0, message: "empty" }], warnings, detectedFormat: null };
  }

  const cols = mapHeaders(rows[0]);
  const hasUtm = cols.easting !== -1 && cols.northing !== -1;
  const hasLonLat = cols.lat !== -1 && cols.lon !== -1;
  if (!hasUtm && !hasLonLat) {
    return {
      points: [],
      errors: [{ row: 1, message: "noCoordinateColumns" }],
      warnings,
      detectedFormat: null,
    };
  }
  // A file carrying both is read as UTM — that is the DIM list's native form,
  // and lat/lon columns in such an export are a derived convenience copy.
  const detectedFormat: "utm" | "wgs84" = hasUtm ? "utm" : "wgs84";
  if (cols.radius === -1) warnings.push("noRadiusColumn");

  const points: DimPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = (idx: number) => (idx === -1 ? "" : (row[idx] ?? "").trim());
    const rowNo = i + 1;

    let lon: number;
    let lat: number;

    if (detectedFormat === "utm") {
      const rawE = parseNumber(cell(cols.easting));
      const northing = parseNumber(cell(cols.northing));
      if (!Number.isFinite(rawE) || !Number.isFinite(northing)) {
        errors.push({ row: rowNo, message: "badCoordinate" });
        continue;
      }
      const { easting, zone } = parseEasting(rawE);
      const crs: CoordSystem = {
        format: "utm",
        zone: clampZone(zone ?? fallbackCrs.zone),
        south: fallbackCrs.south,
      };
      [lon, lat] = toLonLat(crs, easting, northing);
    } else {
      lat = parseNumber(cell(cols.lat));
      lon = parseNumber(cell(cols.lon));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        errors.push({ row: rowNo, message: "badCoordinate" });
        continue;
      }
    }

    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errors.push({ row: rowNo, message: "outOfRange" });
      continue;
    }

    const rawRadius = parseNumber(cell(cols.radius));
    const radiusM = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : defaultRadiusM;

    points.push({
      id: `${idPrefix}-${rowNo}`,
      name: cell(cols.name) || `#${points.length + 1}`,
      lat,
      lon,
      radiusM,
      note: cell(cols.note) || undefined,
      nextReview: cell(cols.nextReview) || undefined,
      municipality: cell(cols.municipality) || undefined,
      district: cell(cols.district) || undefined,
      municipalityKey: cell(cols.municipalityKey) || undefined,
      lastUpdate: cell(cols.lastUpdate) || undefined,
    });
  }

  return { points, errors, warnings, detectedFormat };
}

// The example shown behind the format info button, and the content of the
// downloadable template — kept next to the parser so the two can never drift.
export const DIM_CSV_TEMPLATE = [
  "Beschreibung;Bemerkung;Nächste Durchsicht;Gemeinde;Landkreis;Schlüssel-Gmd;Letztes Update;UTM_E;UTM_N",
  "BU Illerrieden_Wangen Nord (Bru).;Keine weitere Veränderung 23.01.26;24/08/26;Illerrieden;Alb-Donau-Kreis;08425066;23/01/26;32578636;5345793",
].join("\r\n");

export const DIM_CSV_COLUMNS: { header: string; required: boolean; key: FieldKey }[] = [
  { header: "Beschreibung", required: false, key: "name" },
  { header: "Bemerkung", required: false, key: "note" },
  { header: "Nächste Durchsicht", required: false, key: "nextReview" },
  { header: "Gemeinde", required: false, key: "municipality" },
  { header: "Landkreis", required: false, key: "district" },
  { header: "Schlüssel-Gmd", required: false, key: "municipalityKey" },
  { header: "Letztes Update", required: false, key: "lastUpdate" },
  { header: "UTM_E", required: true, key: "easting" },
  { header: "UTM_N", required: true, key: "northing" },
];
