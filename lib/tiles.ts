// Client-side tiling: split an aligned image pair into overlapping tiles so the
// vision model can analyze each region up-close (small structures become large
// in-frame -> far better recall and localization). Also maps per-tile boxes
// back to global coordinates and de-duplicates overlapping detections.

import type { Change } from "./types";

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
  const maxTilePx = opts?.maxTilePx ?? 1100;

  const ref = await imgFromUrl(refUrl);
  const tgt = await imgFromUrl(targetUrl);
  const W = ref.naturalWidth;
  const H = ref.naturalHeight;

  const overview: Tile = {
    refUrl: cropToUrl(ref, 0, 0, W, H, 1500),
    targetUrl: cropToUrl(tgt, 0, 0, W, H, 1500),
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

  const baseW = W / cols;
  const baseH = H / rows;
  const ovx = baseW * overlap;
  const ovy = baseH * overlap;

  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
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
        label: `r${r + 1}c${c + 1}`,
      });
    }
  }

  return { overview, tiles };
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

// Merge detections from overlapping tiles: drop near-duplicate boxes of the
// same change type, keeping the higher-confidence / larger one. Returns a clean
// list sorted top-left -> bottom-right with fresh sequential ids.
export function dedupe(changes: Change[]): Change[] {
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const sorted = [...changes].sort(
    (a, b) =>
      (rank[b.confidence] ?? 0) - (rank[a.confidence] ?? 0) || area(b.bbox) - area(a.bbox),
  );

  const kept: Change[] = [];
  for (const c of sorted) {
    const dup = kept.some(
      (k) => k.change_type === c.change_type && iou(k.bbox, c.bbox) > 0.4,
    );
    if (!dup) kept.push(c);
  }

  kept.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return kept.map((c, i) => ({ ...c, id: `chg-${i + 1}` }));
}
