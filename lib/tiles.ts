// Client-side tiling: split an aligned image pair into overlapping tiles so the
// vision model can analyze each region up-close (small structures become large
// in-frame -> far better recall and localization). Also maps per-tile boxes
// back to global coordinates and de-duplicates overlapping detections.

import { CATEGORY_REF, type Category, type Change, type Confidence } from "./types";

export interface Tile {
  refUrl: string;
  targetUrl: string;
  // Global normalized rectangle of this tile within the full image.
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  label: string;
}

export interface TileSet {
  overview: Tile;
  tiles: Tile[];
}

function imgFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for tiling"));
    img.src = url;
  });
}

function cropToUrl(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxPx: number,
): string {
  const scale = Math.min(1, maxPx / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function buildTiles(
  refUrl: string,
  targetUrl: string,
  opts?: { targetTilePx?: number; overlap?: number; maxTiles?: number; maxTilePx?: number },
): Promise<TileSet> {
  const targetTilePx = opts?.targetTilePx ?? 760;
  const overlap = opts?.overlap ?? 0.15;
  const maxTiles = opts?.maxTiles ?? 16;
  const maxTilePx = opts?.maxTilePx ?? 1400;

  const ref = await imgFromUrl(refUrl);
  const tgt = await imgFromUrl(targetUrl);
  const W = ref.naturalWidth;
  const H = ref.naturalHeight;

  const overview: Tile = {
    refUrl: cropToUrl(ref, 0, 0, W, H, 1560),
    targetUrl: cropToUrl(tgt, 0, 0, W, H, 1560),
    gx: 0,
    gy: 0,
    gw: 1,
    gh: 1,
    label: "overview",
  };

  let cols = Math.max(1, Math.ceil(W / targetTilePx));
  let rows = Math.max(1, Math.ceil(H / targetTilePx));
  while (cols * rows > maxTiles) {
    if (cols >= rows && cols > 1) cols--;
    else if (rows > 1) rows--;
    else break;
  }

  const tiles: Tile[] = [];

  const addGrid = (gcols: number, grows: number, prefix: string) => {
    const baseW = W / gcols;
    const baseH = H / grows;
    const ovx = baseW * overlap;
    const ovy = baseH * overlap;
    for (let r = 0; r < grows; r++) {
      for (let c = 0; c < gcols; c++) {
        const x0 = Math.max(0, Math.floor(c * baseW - ovx));
        const y0 = Math.max(0, Math.floor(r * baseH - ovy));
        const x1 = Math.min(W, Math.ceil((c + 1) * baseW + ovx));
        const y1 = Math.min(H, Math.ceil((r + 1) * baseH + ovy));
        const sw = x1 - x0;
        const sh = y1 - y0;
        tiles.push({
          refUrl: cropToUrl(ref, x0, y0, sw, sh, maxTilePx),
          targetUrl: cropToUrl(tgt, x0, y0, sw, sh, maxTilePx),
          gx: x0 / W,
          gy: y0 / H,
          gw: sw / W,
          gh: sh / H,
          label: `${prefix}r${r + 1}c${c + 1}`,
        });
      }
    }
  };

  addGrid(cols, rows, "");

  // Mid-zoom layer: area-scale changes (new development areas, quarry
  // expansions) span many fine tiles, where each tile sees only an ambiguous
  // fragment. A 2x2 quadrant pass shows such areas whole at readable detail.
  if (cols * rows > 4) addGrid(2, 2, "q-");

  return { overview, tiles };
}

// Zoomed crops around candidate detections for the verification pass: each
// candidate is re-examined up close with generous context so the model can
// confirm or reject it. Returned as Tiles so mapToGlobal can bring refined
// boxes back to global coordinates.
export async function buildVerifyCrops(
  refUrl: string,
  targetUrl: string,
  boxes: [number, number, number, number][],
  maxPx = 1400,
): Promise<Tile[]> {
  const ref = await imgFromUrl(refUrl);
  const tgt = await imgFromUrl(targetUrl);
  const W = ref.naturalWidth;
  const H = ref.naturalHeight;

  return boxes.map(([x, y, w, h], i) => {
    // Context margin: 60% of the box per side, floored so tiny detections
    // still come with enough surroundings to judge them.
    const mx = Math.max(w * 0.6, 0.08);
    const my = Math.max(h * 0.6, 0.08);
    const x0 = Math.max(0, Math.floor((x - mx) * W));
    const y0 = Math.max(0, Math.floor((y - my) * H));
    const x1 = Math.min(W, Math.ceil((x + w + mx) * W));
    const y1 = Math.min(H, Math.ceil((y + h + my) * H));
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    return {
      refUrl: cropToUrl(ref, x0, y0, sw, sh, maxPx),
      targetUrl: cropToUrl(tgt, x0, y0, sw, sh, maxPx),
      gx: x0 / W,
      gy: y0 / H,
      gw: sw / W,
      gh: sh / H,
      label: `verify-${i + 1}`,
    };
  });
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

export function mapToGlobal(
  tile: Tile,
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [x, y, w, h] = bbox;
  const gx = clamp01(tile.gx + x * tile.gw);
  const gy = clamp01(tile.gy + y * tile.gh);
  const gw = Math.min(w * tile.gw, 1 - gx);
  const gh = Math.min(h * tile.gh, 1 - gy);
  return [gx, gy, gw, gh];
}

function area(b: [number, number, number, number]) {
  return b[2] * b[3];
}

function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

// Fraction of the smaller box covered by the intersection — catches the same
// change detected at different scales (e.g. overview vs fine tile), where IoU
// stays low because the box sizes differ a lot.
function containment(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ix = Math.max(
    0,
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
  );
  const iy = Math.max(
    0,
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
  );
  const minArea = Math.min(area(a), area(b));
  return minArea <= 0 ? 0 : (ix * iy) / minArea;
}

// OAR object-type family of a category (the part before "/" in
// CATEGORY_REF), or the raw string if it's not a recognized catalog leaf.
// Two categories in the same family are either literal subtypes of one
// official object type (e.g. "platz.parkplatz"/"platz.rastplatz", both under
// OAR 42009) or — for three specific pairs — two app-level categories that
// map to the exact same official WAR code (raststaette/autohof,
// hochbahn/hochstrasse, tunnel/unterfuehrung; see CATEGORY_REF's note).
function oarFamily(category: string): string {
  const ref = CATEGORY_REF[category as Category];
  return ref ? ref.split("/")[0] : category;
}

// Merge detections from overlapping tiles: drop near-duplicate boxes of the
// same change type, keeping the higher-confidence / larger one. Boxes are
// also deduped by containment when they're the same OAR family — not just
// exact same category — so a change re-detected at a coarser zoom, OR the
// same real object classified under two adjacent subtypes/synonym-pairs by
// different detector passes (e.g. one tile calls a rest stop "raststaette",
// an overlapping tile calls it "autohof"), doesn't appear twice. Distinct
// objects inside an area-scale change (houses within a new "plot") still
// survive because they belong to unrelated OAR families entirely.
const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
const CONF_BY_RANK: Confidence[] = ["low", "medium", "high"];

// Whether two detections describe the SAME real-world change — the identical
// predicate the loop below uses to fold a raw detection into a kept cluster.
function sameChange(k: Change, c: Change): boolean {
  return (
    k.change_type === c.change_type &&
    (iou(k.bbox, c.bbox) > 0.4 ||
      (oarFamily(k.category) === oarFamily(c.category) && containment(k.bbox, c.bbox) > 0.75))
  );
}

export function dedupe(changes: Change[]): Change[] {
  const sorted = [...changes].sort(
    (a, b) =>
      (CONF_RANK[b.confidence] ?? 0) - (CONF_RANK[a.confidence] ?? 0) || area(b.bbox) - area(a.bbox),
  );

  // Each kept entry is the representative (highest-confidence, largest) of a
  // cluster; `agreement` counts how many raw detections — from independent
  // overview / fine / quadrant passes — landed in that cluster.
  const kept: Change[] = [];
  const agreement: number[] = [];
  for (const c of sorted) {
    const idx = kept.findIndex((k) => sameChange(k, c));
    if (idx === -1) {
      kept.push(c);
      agreement.push(1);
    } else {
      agreement[idx]++;
    }
  }

  // Consensus boost: a change corroborated by ≥2 independent passes is more
  // trustworthy than a lone sighting, so lift its confidence one level (never
  // past "high"). This is a no-cost accuracy signal — it reranks and
  // recolors the same detections we already have, surfacing the ones multiple
  // passes agreed on. `agreement` is also carried through for the report/export.
  const boosted = kept.map((c, i) => {
    const votes = agreement[i];
    const lifted =
      votes >= 2 ? CONF_BY_RANK[Math.min(2, (CONF_RANK[c.confidence] ?? 0) + 1)] : c.confidence;
    return { ...c, confidence: lifted, agreement: votes };
  });

  boosted.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return boosted.map((c, i) => ({ ...c, id: `chg-${i + 1}` }));
}
