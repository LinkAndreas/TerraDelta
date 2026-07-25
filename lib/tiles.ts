// Client-side tiling: split an aligned image pair into overlapping tiles so the
// vision model can analyze each region up-close (small structures become large
// in-frame -> far better recall and localization). Also maps per-tile boxes
// back to global coordinates and de-duplicates overlapping detections.

import { bandFromScore, type Change } from "./types";

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

// Inverse of mapToGlobal: express a global box in one tile's/crop's own
// normalized coordinates. Used to tell the classifier where inside its zoomed
// crop the detector's candidate box sits, so it can correct that rectangle
// instead of hunting for the object from scratch.
export function mapToTile(
  tile: Tile,
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [gx, gy, gw, gh] = bbox;
  if (tile.gw <= 0 || tile.gh <= 0) return [0, 0, 0, 0];
  const x = clamp01((gx - tile.gx) / tile.gw);
  const y = clamp01((gy - tile.gy) / tile.gh);
  const w = Math.min(gw / tile.gw, 1 - x);
  const h = Math.min(gh / tile.gh, 1 - y);
  return [x, y, Math.max(w, 0), Math.max(h, 0)];
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

// Consensus bonus added to a change's 0..100 score per corroborating pass
// beyond the first (capped), plus the overall cap.
const CONSENSUS_BONUS_PER_VOTE = 6;
const CONSENSUS_BONUS_MAX = 15;
const SCORE_CAP = 99;

// Two detections count as the same real-world difference when they describe
// the same direction of change over substantially the same footprint.
//
// This is deliberately geometry-only now. Detections arrive uncategorized
// (classification happens later, per candidate — see lib/prompt.ts), and the
// old category-family containment rule also collapsed genuinely distinct
// nested differences: a coarse "new development area" box swallowed the
// individual road and hall detections inside it whenever they happened to
// share an OAR family. A plain IoU threshold merges the same object seen by
// two overlapping tiles (both boxes hug the same object → high IoU) while
// keeping a small object inside a large area as its own difference.
const SAME_CHANGE_IOU = 0.45;

function sameChange(k: Change, c: Change): boolean {
  return k.change_type === c.change_type && iou(k.bbox, c.bbox) > SAME_CHANGE_IOU;
}

export function dedupe(changes: Change[]): Change[] {
  const sorted = [...changes].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || area(b.bbox) - area(a.bbox),
  );

  // Each kept entry is the representative (highest-score, largest) of a
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
  // trustworthy than a lone sighting, so nudge its numeric score up (a few
  // points per extra vote, capped) and recompute its band. This is a no-cost
  // accuracy signal — it reranks and recolors the detections we already have,
  // surfacing the ones multiple passes agreed on. `agreement` is carried
  // through for the report/export.
  const boosted = kept.map((c, i) => {
    const votes = agreement[i];
    const bonus = Math.min(CONSENSUS_BONUS_MAX, (votes - 1) * CONSENSUS_BONUS_PER_VOTE);
    const score = Math.min(SCORE_CAP, (c.score ?? 0) + bonus);
    return { ...c, score, confidence: bandFromScore(score), agreement: votes };
  });

  boosted.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return boosted.map((c, i) => ({ ...c, id: `chg-${i + 1}` }));
}
