import type { Category, Change, ChangeType, Confidence, DimPoint, GeoRef, SearchArea } from "./types";
import { CATEGORY_REF, CHANGE_COLORS, scoreLabel } from "./types";
import { changeAreaM2, changeCenterLonLat, dimPointForChange } from "./geo";
import { crsEpsg, coordDecimals, formatLonLatIn, DEFAULT_EXPORT_CRS, type CoordSystem } from "./crs";
import { translate, type Lang, type StringKey } from "./i18n";

// ── DIN A4 constants (all in mm) ──────────────────────────────────────────
export const PW = 210;
export const PH = 297;
export const M = 14; // margin
export const CW = PW - 2 * M; // 182 mm content width

// Brand palette
export const BRAND: [number, number, number] = [185, 80, 43]; // #b9502b
export const BRAND_LIGHT: [number, number, number] = [224, 133, 90]; // #e0855a
export const DARK: [number, number, number] = [22, 26, 38];
export const MID: [number, number, number] = [90, 96, 112];
export const LIGHT_BG: [number, number, number] = [248, 247, 245];
const TABLE_STRIPE: [number, number, number] = [242, 240, 237];
export const WHITE: [number, number, number] = [255, 255, 255];

export function hex2rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ── Logo SVG (matches Logo.tsx exactly) ──────────────────────────────────
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="192" height="192">
  <defs>
    <linearGradient id="td-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e0855a"/>
      <stop offset="1" stop-color="#b9502b"/>
    </linearGradient>
  </defs>
  <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="url(#td-bg)"/>
  <path d="M24 9 L39 39 L24 39 Z" fill="#ffffff" fill-opacity="0.18"/>
  <path d="M24 9 L39 39 L9 39 Z" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"/>
  <line x1="24" y1="9" x2="24" y2="39" stroke="#ffffff" stroke-width="1.8" stroke-opacity="0.9"/>
  <circle cx="24" cy="26" r="3.4" fill="#ffffff"/>
</svg>`;

export async function svgToPng(svgStr: string, px: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Logo SVG failed to load"));
    };
    img.src = url;
  });
}

export interface RenderedImage {
  dataUrl: string;
  ar: number; // width / height
}

// `numbers` are the labels drawn in each box's badge. They must be the same
// numbers the table and the on-screen report use — passing none falls back to
// 1..N, which is only correct for an unfiltered export.
export async function renderWithBoxes(
  srcUrl: string,
  changes: Change[],
  px: number,
  numbers?: number[],
): Promise<RenderedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ar = img.naturalWidth / img.naturalHeight || 1;
      const h = Math.round(px / ar);
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, px, h);

      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const [bx, by, bw, bh] = c.bbox;
        const rx = bx * px;
        const ry = by * h;
        const color = CHANGE_COLORS[c.change_type];
        const rw = bw * px;
        const rh = bh * h;

        // Shadow stroke
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 3.5;
        ctx.strokeRect(rx, ry, rw, rh);
        // Color stroke
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        // Number badge
        const bW = 20;
        const bH = 14;
        const bx2 = Math.max(rx - 1, 0);
        const by2 = Math.max(ry - bH, 0);
        ctx.fillStyle = color;
        ctx.beginPath();
        // rounded top corners, square bottom-left
        const r2 = 3;
        ctx.moveTo(bx2 + r2, by2);
        ctx.lineTo(bx2 + bW - r2, by2);
        ctx.quadraticCurveTo(bx2 + bW, by2, bx2 + bW, by2 + r2);
        ctx.lineTo(bx2 + bW, by2 + bH);
        ctx.lineTo(bx2, by2 + bH);
        ctx.lineTo(bx2, by2 + r2);
        ctx.quadraticCurveTo(bx2, by2, bx2 + r2, by2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#06121f";
        ctx.font = `bold ${Math.round(bH * 0.72)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(numbers?.[i] ?? i + 1), bx2 + bW / 2, by2 + bH / 2);
      }

      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.92), ar });
    };
    img.onerror = reject;
    img.src = srcUrl;
  });
}

// ── jsPDF helpers ─────────────────────────────────────────────────────────

export type Doc = import("jspdf").jsPDF;

export function setFont(doc: Doc, style: "normal" | "bold", size: number, color: [number, number, number] = DARK) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

// ── WinAnsi sanitizing ─────────────────────────────────────────────────────
// jsPDF's built-in Helvetica is WinAnsi-encoded (Latin-1 plus the 0x80–0x9F
// typographic extras). A character outside that set is emitted as a mojibake
// pair rather than dropped — "↳" printed as "⁵" and "≥" as "\"e" in earlier
// reports. This matters beyond our own labels: change descriptions come from
// the vision model and DIM point names come from user CSVs, so arbitrary
// Unicode can reach the page.
//
// Map the symbols we actually use (and the ones models reach for) onto WinAnsi
// equivalents, then drop anything still unencodable — a missing rare glyph is
// far less damaging in a printed report than two random letters in its place.
const WINANSI_MAP: Record<string, string> = {
  "↳": "»", "→": "->", "⇒": "=>", "←": "<-", "▸": "-", "▪": "-", "◦": "-", "·": "·",
  "≥": ">=", "≤": "<=", "≈": "~", "≠": "!=", "±": "±", "∅": "O", "⌀": "O",
  "−": "-", "‒": "-", "―": "—", "⁻": "-",
  "✓": "+", "✔": "+", "✗": "x", "✘": "x", "★": "*", "☆": "*", "⚠": "!",
  "㎡": "m²", "㎢": "km²", "″": '"', "′": "'", "‑": "-", " ": " ",
};
// Latin-1 (0x20–0xFF) plus the WinAnsi 0x80–0x9F block that jsPDF can encode.
const WINANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function winAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = WINANSI_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.has(ch)) {
      out += ch;
    }
    // else: unencodable — omit rather than emit a mojibake pair.
  }
  return out;
}

// ── Text fitting ───────────────────────────────────────────────────────────
// Every label in this report is a translated string, and German runs ~30%
// longer than English ("Confidence" → "Konfidenz", "added" → "hinzugefügt").
// A font size chosen to fit one language silently overflows in the other —
// which is exactly how the coordinate header ended up printed across the
// description column. These two helpers make a cell's width authoritative:
// shrink to fit, and truncate only as a last resort.

// Largest size in [min, start] at which `text` fits `maxW`, in the currently
// selected font family/style. Leaves the chosen size selected on `doc`.
export function fitFontSize(doc: Doc, text: string, maxW: number, start: number, min: number): number {
  let size = start;
  while (size > min) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= maxW) return size;
    size -= 0.25;
  }
  doc.setFontSize(min);
  return min;
}

// Truncate with an ellipsis so text can never bleed past its column, measured
// in the font currently selected on `doc`.
export function ellipsize(doc: Doc, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export function drawPageHeader(
  doc: Doc,
  logoPng: string,
  compact: boolean,
  t: (k: StringKey, v?: Record<string, string | number>) => string,
  title?: string,
) {
  const logoMm = compact ? 7 : 10;
  // Accent bar along the top
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PW, compact ? 20 : 26, "F");

  // Logo badge
  doc.addImage(logoPng, "PNG", M, compact ? 5 : 8, logoMm, logoMm);

  // Wordmark
  const tx = M + logoMm + 3;
  const ty = compact ? 10.5 : 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 12 : 15);
  doc.setTextColor(...WHITE);
  doc.text("TerraDelta", tx, ty);

  if (!compact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 220, 200);
    doc.text(t("pdf.tagline"), tx, ty + 5);
  }

  // Report title (right side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 9 : 12);
  doc.setTextColor(...WHITE);
  doc.text(title ?? t("pdf.title"), PW - M, ty, { align: "right" });
}

export function drawPageFooter(doc: Doc, pageNum: number, totalPages: number, t: (k: StringKey, v?: Record<string, string | number>) => string) {
  const y = PH - 8;
  doc.setDrawColor(...BRAND_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(M, y - 3, PW - M, y - 3);
  setFont(doc, "normal", 7.5, MID);
  doc.text("TerraDelta", M, y);
  doc.text(t("pdf.page", { n: pageNum, total: totalPages }), PW - M, y, { align: "right" });
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function localeOf(lang: Lang): string {
  return lang === "de" ? "de-DE" : "en-GB";
}

// Real-world footprint, human-readable: m² up to a hectare, then ha.
export function formatArea(m2: number, lang: Lang): string {
  const loc = localeOf(lang);
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString(loc, { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString(loc)} m²`;
}

function localizedCategory(t: (k: StringKey) => string, category: string): string {
  const key = `cat.${category}` as StringKey;
  const label = t(key);
  return label === key ? category : label;
}

// ── Unified report builder ──────────────────────────────────────────────────
// Both the standard report (§ exportPdf) and the restricted-area Merkblatt
// (§6) share the exact same layout; they differ only in two optional inputs:
//   • `searchArea` present  → draw the search-area info box + use the Merkblatt
//     title (the restricted-area mode always has georeferencing).
//   • `geo` present         → the change table gains a Coordinates column
//     (WGS84 lat/lon of each change's center + its real-world area), and the
//     page-1 stats band gains a total-area figure. Without geo (a plain
//     PNG/JPEG comparison) those are simply omitted.
// Returning the jsPDF doc (rather than saving inline) lets callers either
// save it or hand its bytes to the combined ZIP export.

// What the report was filtered down to, so the document can say so on its face.
// A report that silently shows 12 of 27 detected changes is misleading — a
// reviewer has no way to tell a clean run from a filtered view. `total` is the
// unfiltered count; the rest describe which filters were active.
export interface PdfFilterInfo {
  total: number;
  // Minimum confidence score the reader required (0 = no threshold).
  minScore: number;
  // Change types left enabled. All three = no type filtering.
  types: ChangeType[];
  // Free-text search term, "" when unused.
  query: string;
}

export interface PdfBuildOptions {
  refUrl: string;
  targetUrl: string;
  changes: Change[];
  lang: Lang;
  geo?: GeoRef | null;
  searchArea?: SearchArea | null;
  // Coordinate system every coordinate in the report is written in (§ lib/crs.ts).
  crs?: CoordSystem;
  // Present when the run was restricted to DIM points — the info box lists
  // them and the change table names the point each change was found at.
  dimPoints?: DimPoint[];
  // The number each change carries in the on-screen report and on the
  // comparison-view chips. Those number by position in the FULL result set, so
  // a filtered export that renumbered 1..N would disagree with every other
  // surface. Defaults to 1..N when the caller has nothing better.
  displayNumbers?: number[];
  // Present when `changes` is a filtered subset (§ drawFilterBand).
  filter?: PdfFilterInfo;
}

async function buildPdf(opts: PdfBuildOptions): Promise<Doc> {
  const { default: jsPDF } = await import("jspdf");
  const {
    refUrl,
    targetUrl,
    changes,
    lang,
    geo,
    searchArea,
    crs = DEFAULT_EXPORT_CRS,
    dimPoints,
    filter,
  } = opts;
  const numberOf = (i: number) => opts.displayNumbers?.[i] ?? i + 1;
  const t = (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const hasCoord = !!geo;
  const hasDim = !!geo && !!dimPoints && dimPoints.length > 0;
  const title = searchArea || hasDim ? t("pdf.merkblattTitle") : t("pdf.title");

  // Render assets in parallel
  const PX = 1000;
  const [logoPng, refImg, tgtImg] = await Promise.all([
    svgToPng(LOGO_SVG, 192),
    renderWithBoxes(refUrl, changes, PX, opts.displayNumbers),
    renderWithBoxes(targetUrl, changes, PX, opts.displayNumbers),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  // Document metadata: what a PDF reader shows in its title bar and what a
  // document-management system indexes on. Without it the file is titled after
  // whatever the browser guessed.
  doc.setProperties({
    title: `TerraDelta — ${title}`,
    subject: t("pdf.subtitle"),
    author: "TerraDelta",
    creator: "TerraDelta",
  });

  // ── PAGE 1: header (+ optional search-area box) + both images ───────────
  const HEADER_H = 26;
  drawPageHeader(doc, logoPng, false, t, searchArea ? title : undefined);

  const dateStr = new Intl.DateTimeFormat(localeOf(lang), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  setFont(doc, "normal", 8, MID);
  doc.text(t("pdf.generated", { date: dateStr }), PW - M, HEADER_H + 6, { align: "right" });

  let imgAreaY = HEADER_H + 10;

  if (searchArea) {
    const infoY = HEADER_H + 10;
    const infoH = 22;
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(M, infoY, CW, infoH, 2, 2, "F");
    doc.setFillColor(...BRAND);
    doc.roundedRect(M, infoY, CW, 7, 2, 2, "F");
    doc.rect(M, infoY + 3, CW, 4, "F");
    setFont(doc, "bold", 8.5, WHITE);
    doc.text(t("pdf.searchArea"), M + CW / 2, infoY + 4.8, { align: "center" });

    const shapeLabel = t(`search.shape.${searchArea.shape}` as StringKey);
    const sizeLabel =
      searchArea.shape === "circle"
        ? t("pdf.radiusValue", { r: searchArea.radiusM })
        : t("pdf.rectValue", { w: searchArea.widthM, h: searchArea.heightM });

    setFont(doc, "normal", 9, DARK);
    doc.text(
      `${formatLonLatIn(crs, searchArea.lon, searchArea.lat, crs.format === "wgs84" ? 6 : coordDecimals(crs))}  (${crsEpsg(crs)})`,
      M + 3,
      infoY + 12,
    );
    doc.text(`${shapeLabel} · ${sizeLabel}`, M + 3, infoY + 18);
    imgAreaY = infoY + infoH + 6;
  } else if (hasDim) {
    // DIM-point mode gets the same banner, listing the points the run was
    // restricted to. Long lists are truncated to keep page 1 to its layout —
    // the full list is implicit in the change table's DIM column anyway.
    const points = dimPoints!;
    const MAX_LISTED = 6;
    const listed = points.slice(0, MAX_LISTED);
    const infoY = HEADER_H + 10;
    const infoH = 13 + listed.length * 4.6 + (points.length > MAX_LISTED ? 4.6 : 0);
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(M, infoY, CW, infoH, 2, 2, "F");
    doc.setFillColor(...BRAND);
    doc.roundedRect(M, infoY, CW, 7, 2, 2, "F");
    doc.rect(M, infoY + 3, CW, 4, "F");
    setFont(doc, "bold", 8.5, WHITE);
    doc.text(t("pdf.dimPoints", { n: points.length, crs: crsEpsg(crs) }), M + CW / 2, infoY + 4.8, {
      align: "center",
    });

    setFont(doc, "normal", 8, DARK);
    listed.forEach((p, i) => {
      const coord = formatLonLatIn(crs, p.lon, p.lat, crs.format === "wgs84" ? 6 : 0);
      const name = doc.splitTextToSize(winAnsi(p.name || `#${i + 1}`), CW - 70)[0] ?? "";
      doc.text(`${i + 1}. ${name}`, M + 3, infoY + 11.5 + i * 4.6);
      doc.text(`${coord} · r ${Math.round(p.radiusM)} m`, PW - M - 3, infoY + 11.5 + i * 4.6, { align: "right" });
    });
    if (points.length > MAX_LISTED) {
      setFont(doc, "normal", 7.5, MID);
      doc.text(t("pdf.dimPointsMore", { n: points.length - MAX_LISTED }), M + 3, infoY + 11.5 + listed.length * 4.6);
    }
    imgAreaY = infoY + infoH + 6;
  }

  const IMG_MAX_H = Math.floor((PH - imgAreaY - 8 - 14 - 16) / 2) - 10;

  function fitInSlot(ar: number): { w: number; h: number; xOff: number } {
    const hByW = CW / ar;
    if (hByW <= IMG_MAX_H) return { w: CW, h: hByW, xOff: 0 };
    const w = IMG_MAX_H * ar;
    return { w, h: IMG_MAX_H, xOff: (CW - w) / 2 };
  }

  const ref1 = fitInSlot(refImg.ar);
  const tgt1 = fitInSlot(tgtImg.ar);

  function drawImagePanel(
    label: string,
    img: { dataUrl: string },
    fit: { w: number; h: number; xOff: number },
    panelY: number,
  ) {
    const panelH = fit.h + 10;
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(M, panelY, CW, panelH, 2, 2, "F");
    doc.setFillColor(...BRAND);
    doc.roundedRect(M, panelY, CW, 7, 2, 2, "F");
    doc.rect(M, panelY + 3, CW, 4, "F");
    setFont(doc, "bold", 8.5, WHITE);
    doc.text(label, M + CW / 2, panelY + 4.8, { align: "center" });
    doc.addImage(img.dataUrl, "JPEG", M + fit.xOff + 1, panelY + 7.5, fit.w - 2, fit.h);
  }

  drawImagePanel(t("pdf.earlier"), refImg, ref1, imgAreaY);
  const img2Y = imgAreaY + ref1.h + 10 + 8;
  drawImagePanel(t("pdf.later"), tgtImg, tgt1, img2Y);

  // Legend + change count row below both images
  const legendY = img2Y + tgt1.h + 10 + 6;
  const legendTypes: Array<{ key: StringKey; color: string }> = [
    { key: "type.added", color: CHANGE_COLORS.added },
    { key: "type.removed", color: CHANGE_COLORS.removed },
    { key: "type.modified", color: CHANGE_COLORS.modified },
  ];
  let lx = M;
  for (const { key, color } of legendTypes) {
    const [r, g, b] = hex2rgb(color);
    doc.setFillColor(r, g, b);
    doc.roundedRect(lx, legendY - 2.5, 4, 4, 1, 1, "F");
    setFont(doc, "normal", 8.5, DARK);
    doc.text(t(key), lx + 5.5, legendY + 0.8);
    lx += 40;
  }
  setFont(doc, "normal", 8.5, MID);
  // Dedicated string rather than lowercasing the section heading — German
  // capitalizes nouns, so `t("pdf.changes").toLowerCase()` produced
  // "27 erkannte veränderungen".
  doc.text(t("pdf.changesCount", { n: changes.length }), PW - M, legendY + 0.8, { align: "right" });

  // ── TABLE ────────────────────────────────────────────────────────────────
  // Column widths are fixed; every cell measures its own text against them
  // (fitFontSize / ellipsize) so nothing can print outside its column.
  const colW = {
    num: 9,
    type: 20,
    cat: 29,
    coord: hasCoord ? 30 : 0,
    conf: 18,
    desc: 0,
  };
  colW.desc = CW - colW.num - colW.type - colW.cat - colW.coord - colW.conf;

  const COL_X = {
    num: M,
    type: M + colW.num,
    cat: M + colW.num + colW.type,
    coord: M + colW.num + colW.type + colW.cat,
    desc: M + colW.num + colW.type + colW.cat + colW.coord,
    conf: M + colW.num + colW.type + colW.cat + colW.coord + colW.desc,
  };

  // Vertical rhythm. Every stacked block below is MEASURED and DRAWN with the
  // same constants: a block's height is the sum of its line advances, and each
  // line's baseline sits one ascent below that line's top. Measuring with one
  // set of numbers and drawing with another is what made the catalog reference
  // and the first alternative category overprint each other, and what let tall
  // rows spill past their own background band.
  const ROW_PAD = 2.4;
  const LINE_H = 3.9; // 8pt body line
  const SMALL_LINE_H = 3.1; // 6.6pt reference / alternative / note line
  const COORD_LINE_H = 3.4;
  const ASCENT = 2.85; // baseline offset within an 8pt line
  const SMALL_ASCENT = 2.3;
  const GAP_REF = 0.6; // space above the catalog reference
  const GAP_ALT = 0.8; // space above the alternative-category block
  const GAP_NOTE = 1.0; // space above the verifier note
  const MIN_CONTENT_H = 6.4;

  const FONT_SIZE_ROW = 8;
  const FONT_SIZE_SMALL = 6.6;

  const FOOTER_RESERVE = 14;
  const COMPACT_HEADER_H = 20;
  const STATS_BAND_H = 12;
  const FILTER_BAND_H = 9;
  const CONTINUED_CAPTION_H = 5;
  // Two lines tall when there is a coordinate column, so the coordinate system
  // can sit under its header instead of inside it.
  const TABLE_HEADER_H = hasCoord ? 10.5 : 8.5;

  // Is this export a subset of what was detected? Only then is the filter band
  // drawn — an unfiltered report should not carry a caveat it doesn't need.
  const filterActive =
    !!filter &&
    (filter.total > changes.length ||
      filter.minScore > 0 ||
      filter.types.length < 3 ||
      filter.query.trim() !== "");

  // Pre-measure every row: the doc exists, so splitTextToSize gives true wraps
  // for the actual font size.
  interface RowMeta {
    descLines: string[];
    noteLines: string[];
    catLines: string[];
    ref: string;
    altLines: string[];
    coordLines: string[];
    height: number;
  }

  const rowMetas: RowMeta[] = changes.map((c) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT_SIZE_ROW);
    const descLines: string[] = doc.splitTextToSize(winAnsi(c.description || ""), colW.desc - 4);
    const matches = c.matches ?? [];
    const best = matches[0];
    const catText = best
      ? `${localizedCategory(t, best.category)} ${scoreLabel(best.fit)}`
      : t("cat.unclassified");
    const catLines: string[] = doc.splitTextToSize(winAnsi(catText), colW.cat - 4);
    const ref = best ? CATEGORY_REF[best.category as Category] ?? "" : "";

    doc.setFontSize(FONT_SIZE_SMALL);
    const altLines: string[] = matches
      .slice(1)
      .flatMap((m) =>
        doc.splitTextToSize(winAnsi(`~ ${localizedCategory(t, m.category)} ${scoreLabel(m.fit)}`), colW.cat - 4),
      );
    const noteLines: string[] = c.note ? doc.splitTextToSize(winAnsi(`↳ ${c.note}`), colW.desc - 4) : [];

    const coordLines: string[] = [];
    if (geo) {
      const [lon, lat] = changeCenterLonLat(geo, c);
      coordLines.push(formatLonLatIn(crs, lon, lat, crs.format === "wgs84" ? 5 : coordDecimals(crs)));
      coordLines.push(formatArea(changeAreaM2(geo, c), lang));
      if (hasDim) {
        const point = dimPointForChange(geo, dimPoints!, c);
        // Cap at two lines so one long DIM point name can't inflate every row.
        if (point?.name) coordLines.push(...doc.splitTextToSize(winAnsi(point.name), colW.coord - 4).slice(0, 2));
      }
    }

    const catH =
      catLines.length * LINE_H +
      (ref ? GAP_REF + SMALL_LINE_H : 0) +
      (altLines.length ? GAP_ALT + altLines.length * SMALL_LINE_H : 0);
    const descH =
      descLines.length * LINE_H + (noteLines.length ? GAP_NOTE + noteLines.length * SMALL_LINE_H : 0);
    const coordH = coordLines.length * COORD_LINE_H;

    const contentH = Math.max(catH, descH, coordH, MIN_CONTENT_H);
    return { descLines, noteLines, catLines, ref, altLines, coordLines, height: contentH + ROW_PAD * 2 };
  });

  // ── Pagination ───────────────────────────────────────────────────────────
  // The first table page carries the section title, the stats band and (when
  // filtered) the filter band; later pages start under a short "continued"
  // caption. The page-count pass and the render loop both consume `pageOfRow`,
  // so "Page n of m" cannot disagree with where rows actually land — they used
  // to use two different break rules and the footer total could be wrong.
  const TABLE_TOP_FIRST =
    COMPACT_HEADER_H + 4 + 9 + STATS_BAND_H + 3 + (filterActive ? FILTER_BAND_H + 3 : 0);
  const TABLE_TOP_REST = COMPACT_HEADER_H + 4 + CONTINUED_CAPTION_H;
  const TABLE_BOTTOM = PH - FOOTER_RESERVE;

  const pageOfRow: number[] = [];
  {
    let page = 0;
    let y = TABLE_TOP_FIRST + TABLE_HEADER_H;
    for (const rm of rowMetas) {
      // The second clause keeps a row that is taller than a whole page from
      // looping forever — it stays on the fresh page and overflows there.
      if (y + rm.height > TABLE_BOTTOM && y > TABLE_TOP_REST + TABLE_HEADER_H) {
        page++;
        y = TABLE_TOP_REST + TABLE_HEADER_H;
      }
      pageOfRow.push(page);
      y += rm.height;
    }
  }
  const tablePages = pageOfRow.length ? pageOfRow[pageOfRow.length - 1] + 1 : 1;
  const totalPages = 1 + tablePages;
  drawPageFooter(doc, 1, totalPages, t);

  // One header cell: shrink-to-fit, then ellipsize, so a long translation can
  // never reach into its neighbour.
  function headerCell(label: string, x: number, w: number, align: "left" | "center" | "right", baseline: number) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    fitFontSize(doc, label, w - 3, 8, 6);
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - 2 : x + 2;
    doc.text(ellipsize(doc, label, w - 3), tx, baseline, { align });
  }

  function drawTableHeader(y: number) {
    doc.setFillColor(...DARK);
    doc.rect(M, y, CW, TABLE_HEADER_H, "F");
    const baseline = y + (hasCoord ? 4.6 : TABLE_HEADER_H / 2 + 1.3);

    headerCell(t("th.num"), COL_X.num, colW.num, "center", baseline);
    headerCell(t("th.type"), COL_X.type, colW.type, "left", baseline);
    headerCell(t("th.category"), COL_X.cat, colW.cat, "left", baseline);
    if (hasCoord) headerCell(t("th.coordinates"), COL_X.coord, colW.coord, "left", baseline);
    headerCell(t("th.description"), COL_X.desc, colW.desc, "left", baseline);
    headerCell(t("th.conf"), COL_X.conf, colW.conf, "right", baseline);

    // The coordinate system gets its own line beneath the column header:
    // "Koordinaten (EPSG:25832)" on one line is wider than any sensible
    // coordinate column and printed straight across the description column.
    if (hasCoord) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(214, 202, 194);
      doc.text(ellipsize(doc, crsEpsg(crs), colW.coord - 3), COL_X.coord + 2, y + 8.5);
    }
  }

  // Summary-stats band (first table page only): counts by type + confidence,
  // corroboration, and (with geo) total changed area — what a reviewer wants
  // at a glance before reading any row.
  function drawStatsBand(y: number) {
    const byType: Record<ChangeType, number> = { added: 0, removed: 0, modified: 0 };
    const byConf: Record<Confidence, number> = { low: 0, medium: 0, high: 0 };
    let corroborated = 0;
    let totalArea = 0;
    for (const c of changes) {
      byType[c.change_type]++;
      byConf[c.confidence]++;
      if ((c.agreement ?? 1) >= 2) corroborated++;
      if (geo) totalArea += changeAreaM2(geo, c);
    }
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(M, y, CW, STATS_BAND_H, 2, 2, "F");

    const parts = [
      `${t("type.added")}: ${byType.added}`,
      `${t("type.removed")}: ${byType.removed}`,
      `${t("type.modified")}: ${byType.modified}`,
    ];
    setFont(doc, "normal", 8, DARK);
    doc.text(ellipsize(doc, parts.join("   ·   "), CW - 6), M + 3, y + 4.6);

    const line2 = [
      `${t("pdf.statHigh")}: ${byConf.high}`,
      `${t("pdf.statMedium")}: ${byConf.medium}`,
      `${t("pdf.statLow")}: ${byConf.low}`,
      `${t("pdf.statCorroborated")}: ${corroborated}`,
    ];
    if (geo) line2.push(`${t("pdf.statTotalArea")}: ${formatArea(totalArea, lang)}`);
    setFont(doc, "normal", 8, MID);
    doc.text(ellipsize(doc, line2.join("   ·   "), CW - 6), M + 3, y + 9.4);
  }

  // States plainly that this is a filtered view and which filters produced it.
  // Without it, "27 changes" reads as "27 changes were detected" when it may
  // really mean "27 of 41 passed my confidence threshold".
  function drawFilterBand(y: number) {
    const f = filter!;
    doc.setFillColor(253, 243, 232);
    doc.roundedRect(M, y, CW, FILTER_BAND_H, 2, 2, "F");

    const bits: string[] = [];
    if (f.minScore > 0) bits.push(t("pdf.filterMinConf", { n: f.minScore }));
    if (f.types.length < 3) {
      bits.push(
        t("pdf.filterTypes", { list: f.types.map((tp) => t(`type.${tp}` as StringKey)).join(", ") }),
      );
    }
    if (f.query.trim()) bits.push(t("pdf.filterQuery", { q: winAnsi(f.query.trim()) }));

    const head = t("pdf.filtered", { n: changes.length, total: f.total });
    setFont(doc, "bold", 7.5, DARK);
    doc.text(head, M + 3, y + 5.6);
    if (bits.length) {
      const headW = doc.getTextWidth(head);
      setFont(doc, "normal", 7.5, MID);
      doc.text(ellipsize(doc, `— ${bits.join("  ·  ")}`, CW - 8 - headW), M + 5 + headW, y + 5.6);
    }
  }

  let pageIdx = 2;
  let curY = 0;
  let firstTablePage = true;

  function startTablePage() {
    doc.addPage();
    drawPageHeader(doc, logoPng, true, t, searchArea || hasDim ? title : undefined);
    let y = COMPACT_HEADER_H + 4;

    if (firstTablePage) {
      setFont(doc, "bold", 12, DARK);
      doc.text(t("pdf.changes"), M, y + 5);
      y += 9;
      drawStatsBand(y);
      y += STATS_BAND_H + 3;
      if (filterActive) {
        drawFilterBand(y);
        y += FILTER_BAND_H + 3;
      }
      firstTablePage = false;
    } else {
      setFont(doc, "normal", 8, MID);
      doc.text(`${t("pdf.changes")} — ${t("pdf.tableContinued")}`, M, y + 3.4);
      y = TABLE_TOP_REST;
    }

    drawTableHeader(y);
    curY = y + TABLE_HEADER_H;
    drawPageFooter(doc, pageIdx, totalPages, t);
    pageIdx++;
  }

  startTablePage();

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const rm = rowMetas[i];

    if (i > 0 && pageOfRow[i] !== pageOfRow[i - 1]) startTablePage();

    if (i % 2 === 1) {
      doc.setFillColor(...TABLE_STRIPE);
      doc.rect(M, curY, CW, rm.height, "F");
    }

    const color = hex2rgb(CHANGE_COLORS[c.change_type]);
    const contentTop = curY + ROW_PAD;
    const firstBaseline = contentTop + ASCENT;

    // # — top-aligned with the rest of the row rather than vertically centred:
    // on a tall row a centred number floats away from the text it labels.
    setFont(doc, "bold", FONT_SIZE_ROW, MID);
    doc.text(String(numberOf(i)), COL_X.num + colW.num / 2, firstBaseline, { align: "center" });

    // Type pill — the label is shrunk to fit rather than overflowing the pill
    // ("hinzugefügt" is far wider than "added" at the same size).
    const pillW = colW.type - 5;
    const pillX = COL_X.type + 2;
    doc.setFillColor(...color);
    doc.roundedRect(pillX, contentTop - 0.4, pillW, 5.2, 1.6, 1.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    const pillLabel = t(`type.${c.change_type}` as StringKey);
    fitFontSize(doc, pillLabel, pillW - 2.5, 7, 5);
    doc.text(ellipsize(doc, pillLabel, pillW - 2.5), pillX + pillW / 2, contentTop + 3.3, { align: "center" });

    // Category: best match, catalog reference, then the alternatives. The
    // cursor advances by whole line heights, so the reference can no longer
    // land on top of the first alternative.
    let catTop = contentTop;
    setFont(doc, "normal", FONT_SIZE_ROW, DARK);
    for (const line of rm.catLines) {
      doc.text(line, COL_X.cat + 2, catTop + ASCENT);
      catTop += LINE_H;
    }
    if (rm.ref) {
      catTop += GAP_REF;
      setFont(doc, "normal", FONT_SIZE_SMALL, MID);
      doc.text(rm.ref, COL_X.cat + 2, catTop + SMALL_ASCENT);
      catTop += SMALL_LINE_H;
    }
    if (rm.altLines.length) {
      catTop += GAP_ALT;
      setFont(doc, "normal", FONT_SIZE_SMALL, MID);
      for (const line of rm.altLines) {
        doc.text(line, COL_X.cat + 2, catTop + SMALL_ASCENT);
        catTop += SMALL_LINE_H;
      }
    }

    // Coordinates (in the selected system), real-world area, and — in
    // DIM-point mode — the point the change was found at.
    if (hasCoord) {
      let coordTop = contentTop;
      rm.coordLines.forEach((line, li) => {
        if (li === 0) setFont(doc, "normal", 7.2, DARK);
        else setFont(doc, "normal", FONT_SIZE_SMALL, MID);
        doc.text(line, COL_X.coord + 2, coordTop + SMALL_ASCENT + 0.3);
        coordTop += COORD_LINE_H;
      });
    }

    // Description + the verifier's one-line rationale beneath it.
    let descTop = contentTop;
    setFont(doc, "normal", FONT_SIZE_ROW, DARK);
    for (const line of rm.descLines) {
      doc.text(line, COL_X.desc + 2, descTop + ASCENT);
      descTop += LINE_H;
    }
    if (rm.noteLines.length) {
      descTop += GAP_NOTE;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.setTextColor(...MID);
      for (const line of rm.noteLines) {
        doc.text(line, COL_X.desc + 2, descTop + SMALL_ASCENT);
        descTop += SMALL_LINE_H;
      }
    }

    // Confidence, right-aligned so the percentages form a readable column,
    // with the corroboration count beneath (as the on-screen report shows it).
    setFont(doc, "bold", FONT_SIZE_ROW, DARK);
    doc.text(scoreLabel(c.score), COL_X.conf + colW.conf - 2, firstBaseline, { align: "right" });
    if ((c.agreement ?? 1) >= 2) {
      setFont(doc, "normal", FONT_SIZE_SMALL, MID);
      doc.text(`${c.agreement}×`, COL_X.conf + colW.conf - 2, firstBaseline + SMALL_LINE_H + 0.6, {
        align: "right",
      });
    }

    // Bottom border
    doc.setDrawColor(220, 218, 215);
    doc.setLineWidth(0.15);
    doc.line(M, curY + rm.height, M + CW, curY + rm.height);

    curY += rm.height;
  }

  return doc;
}

// ── Public entry points ─────────────────────────────────────────────────────

export async function exportPdf(opts: {
  refUrl: string;
  targetUrl: string;
  changes: Change[];
  lang: Lang;
  geo?: GeoRef | null;
  crs?: CoordSystem;
  dimPoints?: DimPoint[];
  displayNumbers?: number[];
  filter?: PdfFilterInfo;
}): Promise<void> {
  const doc = await buildPdf(opts);
  doc.save(`terradelta-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Digitales Merkblatt (§6): the restricted-search-area report — same builder,
// with the search-area info box and (always-present) georeferencing.
export async function exportMerkblatt(opts: {
  refUrl: string;
  targetUrl: string;
  changes: Change[];
  lang: Lang;
  // Exactly one of these carries the restriction the Merkblatt documents:
  // the drawn area, or the DIM point list.
  searchArea?: SearchArea | null;
  geo: GeoRef;
  crs?: CoordSystem;
  dimPoints?: DimPoint[];
  displayNumbers?: number[];
  filter?: PdfFilterInfo;
}): Promise<void> {
  const doc = await buildPdf(opts);
  doc.save(`terradelta-merkblatt-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Report bytes for the combined ZIP export (§ exportData.exportAll) — same
// document as exportPdf, returned as a Blob instead of triggering a download.
export async function buildReportBlob(opts: {
  refUrl: string;
  targetUrl: string;
  changes: Change[];
  lang: Lang;
  geo?: GeoRef | null;
  crs?: CoordSystem;
  dimPoints?: DimPoint[];
  displayNumbers?: number[];
  filter?: PdfFilterInfo;
}): Promise<Blob> {
  const doc = await buildPdf(opts);
  return doc.output("blob");
}
