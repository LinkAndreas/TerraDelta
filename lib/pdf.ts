import type { Change } from "./types";
import { CHANGE_COLORS, confLabel } from "./types";
import { translate, type Lang, type StringKey } from "./i18n";

// ── DIN A4 constants (all in mm) ──────────────────────────────────────────
const PW = 210;
const PH = 297;
const M = 14; // margin
const CW = PW - 2 * M; // 182 mm content width

// Brand palette
const BRAND: [number, number, number] = [185, 80, 43]; // #b9502b
const BRAND_LIGHT: [number, number, number] = [224, 133, 90]; // #e0855a
const DARK: [number, number, number] = [22, 26, 38];
const MID: [number, number, number] = [90, 96, 112];
const LIGHT_BG: [number, number, number] = [248, 247, 245];
const TABLE_STRIPE: [number, number, number] = [242, 240, 237];
const WHITE: [number, number, number] = [255, 255, 255];

function hex2rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ── Logo SVG (matches Logo.tsx exactly) ──────────────────────────────────
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="192" height="192">
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

async function svgToPng(svgStr: string, px: number): Promise<string> {
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

interface RenderedImage {
  dataUrl: string;
  ar: number; // width / height
}

async function renderWithBoxes(srcUrl: string, changes: Change[], px: number): Promise<RenderedImage> {
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
        const rw = bw * px;
        const rh = bh * h;
        const color = CHANGE_COLORS[c.change_type];

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
        ctx.fillText(String(i + 1), bx2 + bW / 2, by2 + bH / 2);
      }

      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.92), ar });
    };
    img.onerror = reject;
    img.src = srcUrl;
  });
}

// ── jsPDF helpers ─────────────────────────────────────────────────────────

type Doc = import("jspdf").jsPDF;

function setFont(doc: Doc, style: "normal" | "bold", size: number, color: [number, number, number] = DARK) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function drawPageHeader(
  doc: Doc,
  logoPng: string,
  compact: boolean,
  t: (k: StringKey, v?: Record<string, string | number>) => string,
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
  doc.text(t("pdf.title"), PW - M, ty, { align: "right" });
}

function drawPageFooter(doc: Doc, pageNum: number, totalPages: number, t: (k: StringKey, v?: Record<string, string | number>) => string) {
  const y = PH - 8;
  doc.setDrawColor(...BRAND_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(M, y - 3, PW - M, y - 3);
  setFont(doc, "normal", 7.5, MID);
  doc.text("TerraDelta", M, y);
  doc.text(t("pdf.page", { n: pageNum, total: totalPages }), PW - M, y, { align: "right" });
}

// ── Main export ───────────────────────────────────────────────────────────

export async function exportPdf(opts: {
  refUrl: string;
  targetUrl: string;
  changes: Change[];
  lang: Lang;
}): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { refUrl, targetUrl, changes, lang } = opts;
  const t = (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);

  // Render assets in parallel
  const PX = 1000;
  const [logoPng, refImg, tgtImg] = await Promise.all([
    svgToPng(LOGO_SVG, 192),
    renderWithBoxes(refUrl, changes, PX),
    renderWithBoxes(targetUrl, changes, PX),
  ]);

  // ── calculate total pages ──────────────────────────────────────────────
  // Table rows: need to pre-measure line counts
  const colW = { num: 8, type: 24, cat: 26, conf: 18, desc: CW - 8 - 24 - 26 - 18 };
  const ROW_PAD = 2.2;
  const LINE_H = 4.0;
  const FONT_SIZE_ROW = 8.5;

  // We'll calculate page count properly after we build rows.
  // Rough estimate first to construct doc, then we'll correct it.
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // ── PAGE 1: Images (stacked vertically, one above the other) ────────────
  const HEADER_H = 26;
  const imgAreaY = HEADER_H + 10;

  // Each image may use at most this much height so both fit on the page:
  //   available = PH - imgAreaY - gapBetween(8) - legendZone(14) - footerZone(16)
  //   each slot = available/2, image = slot - labelStrip(7.5) - bottomPad(2)
  const IMG_MAX_H = Math.floor((PH - imgAreaY - 8 - 14 - 16) / 2) - 10;

  // Fit image within (CW × IMG_MAX_H) preserving aspect ratio
  function fitInSlot(ar: number): { w: number; h: number; xOff: number } {
    const hByW = CW / ar;
    if (hByW <= IMG_MAX_H) return { w: CW, h: hByW, xOff: 0 };
    const w = IMG_MAX_H * ar;
    return { w, h: IMG_MAX_H, xOff: (CW - w) / 2 };
  }

  const ref1 = fitInSlot(refImg.ar);
  const tgt1 = fitInSlot(tgtImg.ar);

  drawPageHeader(doc, logoPng, false, t);

  // Date line below header bar
  const dateStr = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    year: "numeric", month: "long", day: "numeric",
  }).format(new Date());
  setFont(doc, "normal", 8, MID);
  doc.text(t("pdf.generated", { date: dateStr }), PW - M, HEADER_H + 6, { align: "right" });

  function drawImagePanel(
    label: string, img: { dataUrl: string }, fit: { w: number; h: number; xOff: number }, panelY: number,
  ) {
    const panelH = fit.h + 10;
    // Background
    doc.setFillColor(...LIGHT_BG);
    doc.roundedRect(M, panelY, CW, panelH, 2, 2, "F");
    // Label strip (brand color bar at top of panel)
    doc.setFillColor(...BRAND);
    doc.roundedRect(M, panelY, CW, 7, 2, 2, "F");
    doc.rect(M, panelY + 3, CW, 4, "F"); // square bottom corners of strip
    setFont(doc, "bold", 8.5, WHITE);
    doc.text(label, M + CW / 2, panelY + 4.8, { align: "center" });
    // Image (centered horizontally within the panel)
    doc.addImage(img.dataUrl, "JPEG", M + fit.xOff + 1, panelY + 7.5, fit.w - 2, fit.h);
  }

  // Earlier image (top)
  drawImagePanel(t("pdf.earlier"), refImg, ref1, imgAreaY);

  // Later image (below, with 8 mm gap)
  const img2Y = imgAreaY + ref1.h + 10 + 8;
  drawImagePanel(t("pdf.later"), tgtImg, tgt1, img2Y);

  // Legend row below both images
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

  // Change count summary
  setFont(doc, "normal", 8.5, MID);
  doc.text(
    `${changes.length} ${t("pdf.changes").toLowerCase()}`,
    PW - M,
    legendY + 0.8,
    { align: "right" },
  );

  // ── TABLE PAGES ──────────────────────────────────────────────────────────
  // Pre-calculate row line counts for pagination
  const COMPACT_HEADER_H = 20;
  const TABLE_START_Y_P2 = COMPACT_HEADER_H + 10; // first table page
  const TABLE_HEADER_H = 8;
  const PAGE_TABLE_H = PH - TABLE_START_Y_P2 - TABLE_HEADER_H - 14; // available height for rows

  type RowMeta = { lines: string[]; height: number };
  const rowMetas: RowMeta[] = changes.map((c) => {
    // We can't call doc.splitTextToSize until doc exists, so use approximate char count
    // 1 char ≈ 1.8mm at 8.5pt helvetica
    const approxCharsPerLine = Math.floor(colW.desc / 1.85);
    const words = c.description.split(" ");
    const lns: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + (cur ? " " : "") + w).length <= approxCharsPerLine) {
        cur = cur ? cur + " " + w : w;
      } else {
        if (cur) lns.push(cur);
        cur = w;
      }
    }
    if (cur) lns.push(cur);
    const lineCount = Math.max(lns.length, 1);
    return { lines: lns, height: lineCount * LINE_H + ROW_PAD * 2 };
  });

  // Count table pages
  let tablePages = 0;
  let usedH = 0;
  for (const rm of rowMetas) {
    if (usedH + rm.height > PAGE_TABLE_H) {
      tablePages++;
      usedH = rm.height;
    } else {
      usedH += rm.height;
    }
  }
  tablePages++; // final partial page

  const totalPages = 1 + tablePages;

  // Draw footers with correct total now that we know it
  drawPageFooter(doc, 1, totalPages, t);

  // ── Now render table pages ───────────────────────────────────────────────
  const COL_X = {
    num: M,
    type: M + colW.num,
    cat: M + colW.num + colW.type,
    desc: M + colW.num + colW.type + colW.cat,
    conf: M + colW.num + colW.type + colW.cat + colW.desc,
  };

  function drawTableHeader(doc: Doc, y: number) {
    doc.setFillColor(...DARK);
    doc.rect(M, y, CW, TABLE_HEADER_H, "F");
    setFont(doc, "bold", 8, WHITE);
    const mid = y + TABLE_HEADER_H / 2 + 1.2;
    doc.text(t("th.num"), COL_X.num + colW.num / 2, mid, { align: "center" });
    doc.text(t("th.type"), COL_X.type + 2, mid);
    doc.text(t("th.category"), COL_X.cat + 2, mid);
    doc.text(t("th.description"), COL_X.desc + 2, mid);
    doc.text(t("th.conf"), COL_X.conf + 2, mid);
  }

  let pageIdx = 2;
  let curY = 0;
  let firstTablePage = true;

  function startTablePage() {
    doc.addPage();
    drawPageHeader(doc, logoPng, true, t);
    let y = COMPACT_HEADER_H + 4;

    if (firstTablePage) {
      setFont(doc, "bold", 12, DARK);
      doc.text(t("pdf.changes"), M, y + 5);
      y += 10;
      firstTablePage = false;
    }

    drawTableHeader(doc, y);
    curY = y + TABLE_HEADER_H;
    drawPageFooter(doc, pageIdx, totalPages, t);
    pageIdx++;
  }

  startTablePage();

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const rm = rowMetas[i];

    // Check if row fits
    if (curY + rm.height > PH - 14) {
      startTablePage();
    }

    // Stripe
    if (i % 2 === 1) {
      doc.setFillColor(...TABLE_STRIPE);
      doc.rect(M, curY, CW, rm.height, "F");
    }

    const color = hex2rgb(CHANGE_COLORS[c.change_type]);
    const rowMid = curY + rm.height / 2 + 1.1;

    // # column
    setFont(doc, "bold", FONT_SIZE_ROW, MID);
    doc.text(String(i + 1), COL_X.num + colW.num / 2, rowMid, { align: "center" });

    // Type (colored pill background)
    doc.setFillColor(...color);
    doc.roundedRect(COL_X.type + 1, curY + rm.height / 2 - 2.5, colW.type - 4, 5, 1.5, 1.5, "F");
    setFont(doc, "bold", 7.5, WHITE);
    doc.text(t(`type.${c.change_type}` as StringKey), COL_X.type + (colW.type - 3) / 2, rowMid, { align: "center" });

    // Category (localized — fall back to raw value for unknown categories)
    setFont(doc, "normal", FONT_SIZE_ROW, DARK);
    const catKey = `cat.${c.category}` as StringKey;
    const catStr = t(catKey) !== catKey ? t(catKey) : c.category;
    doc.text(catStr, COL_X.cat + 2, rowMid);

    // Description (wrapped)
    setFont(doc, "normal", FONT_SIZE_ROW, DARK);
    const lineCount = rm.lines.length;
    const blockH = lineCount * LINE_H;
    const startY = curY + (rm.height - blockH) / 2 + LINE_H * 0.85;
    rm.lines.forEach((line, li) => {
      doc.text(line, COL_X.desc + 2, startY + li * LINE_H);
    });

    // Confidence
    setFont(doc, "bold", FONT_SIZE_ROW, MID);
    doc.text(confLabel(c.confidence), COL_X.conf + 2, rowMid);

    // Bottom border
    doc.setDrawColor(220, 218, 215);
    doc.setLineWidth(0.15);
    doc.line(M, curY + rm.height, M + CW, curY + rm.height);

    curY += rm.height;
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const fileDateStr = new Date().toISOString().slice(0, 10);
  doc.save(`terradelta-report-${fileDateStr}.pdf`);
}
