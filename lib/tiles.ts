// Client-side tiling: split an aligned image pair into overlapping tiles so the
// vision model can analyze each region up-close (small structures become large
// in-frame -> far better recall and localization). Also maps per-tile boxes
// back to global coordinates and de-duplicates overlapping detections.

import { bandFromScore, type Change } from "./types";
import type { NormalizedRect, OverlayShape } from "./geo";

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

// Darkens everything outside the union of `shapes` (in the crop's OWN
// normalized [0..1] coordinates) and strokes each shape's boundary, so the
// model sees the requested search scope directly instead of only through
// post-hoc geometric filtering. Called with byte-identical shapes/alpha for
// both the ref and target crop of the same tile — any difference between the
// two masks would itself look like a "change" to the model.
function drawAoiMask(ctx: CanvasRenderingContext2D, shapes: OverlayShape[], w: number, h: number) {
  if (shapes.length === 0) return;

  const tracePaths = (c: CanvasRenderingContext2D) => {
    for (const s of shapes) {
      c.beginPath();
      if (s.kind === "ellipse") {
        c.ellipse(s.cx * w, s.cy * h, Math.max(1, s.rx * w), Math.max(1, s.ry * h), 0, 0, Math.PI * 2);
      } else {
        c.rect(s.x * w, s.y * h, s.w * w, s.h * h);
      }
    }
  };

  // Build the dim mask on an offscreen canvas: solid black, then cut a hole
  // for each shape ("destination-out") so it ends up opaque outside the AOI
  // and fully transparent inside it.
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d")!;
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, w, h);
  mctx.globalCompositeOperation = "destination-out";
  mctx.fillStyle = "#000";
  tracePaths(mctx);
  mctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.drawImage(mask, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.004);
  ctx.setLineDash([Math.max(4, w * 0.01), Math.max(3, w * 0.007)]);
  tracePaths(ctx);
  ctx.stroke();
  ctx.restore();
}

// Re-express a GLOBAL (whole-image-normalized) shape in a crop's own [0..1]
// coordinates, given that crop's global normalized rect. Returns null when
// the shape doesn't reach the crop at all, so callers can filter it out
// instead of drawing a mask/outline that never appears on screen.
function mapShapeToLocal(
  shape: OverlayShape,
  rect: { gx: number; gy: number; gw: number; gh: number },
): OverlayShape | null {
  const { gx, gy, gw, gh } = rect;
  if (gw <= 0 || gh <= 0) return null;
  if (shape.kind === "ellipse") {
    const cx = (shape.cx - gx) / gw;
    const cy = (shape.cy - gy) / gh;
    const rx = shape.rx / gw;
    const ry = shape.ry / gh;
    if (cx + rx < 0 || cx - rx > 1 || cy + ry < 0 || cy - ry > 1) return null;
    return { kind: "ellipse", cx, cy, rx, ry };
  }
  const x = (shape.x - gx) / gw;
  const y = (shape.y - gy) / gh;
  const w = shape.w / gw;
  const h = shape.h / gh;
  if (x + w < 0 || x > 1 || y + h < 0 || y > 1) return null;
  return { kind: "rect", x, y, w, h };
}

function cropToUrl(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxPx: number,
  shapes?: OverlayShape[],
): string {
  const scale = Math.min(1, maxPx / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  if (shapes && shapes.length > 0) drawAoiMask(ctx, shapes, dw, dh);
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

export interface AoiTile extends Tile {
  // Which DIM points' (padded) search rects contributed to this crop — lets
  // the caller attach exactly the right operator notes to it, and nothing
  // else. Empty for a drawn-area region (no DIM points involved). Usually one
  // id per DIM-point region; more when nearby points were merged (below).
  pointIds: string[];
}

// One area of interest to analyze: a drawn search area, or a DIM point (each
// modeled as a circle) — see lib/geo.ts OverlayShape. `shapes` carries the
// PRECISE shape(s) (for the visual AOI mask, §2), `rect` is just their
// bounding box (for merging/cropping); both in whole-image normalized coords.
export interface AoiRegion {
  id: string;
  rect: NormalizedRect;
  shapes?: OverlayShape[];
  pointIds?: string[];
}

// Shape-aware AOI tiling for BOTH search-area restriction modes (§1/§5): a
// drawn circle/rectangle, or a list of DIM points. Replaces the old
// points-only buildDimPointTiles — a single drawn area used to be tiled by
// filtering the generic whole-image grid (buildTiles) down to overlapping
// tiles, which has the exact fragmentation problem this function solves for
// points:
//   • a small AOI can straddle a grid-tile boundary, so no single tile shows
//     it whole;
//   • a tile sized for the FULL orthophoto also drags in a lot of unrelated
//     surrounding area at whatever resolution the fixed grid assigned that
//     region, diluting the model's attention and wasting resolution on the
//     one thing being searched.
//
// EACH region (one DIM point, or the one drawn area) is tiled INDEPENDENTLY —
// no merging across regions. An earlier version merged overlapping/nearby
// regions to save API calls when DIM points sat close together, but that
// merging was the source of a long string of visibly wrong results (regions
// silently absorbing unrelated points, chain-merging a whole settlement's
// worth of points into one oversized crop, thresholds that didn't scale with
// the aligned working image's own resolution...). Per-region tiling is simple
// and predictable: what you asked to search is exactly what gets its own
// crop, at its own best resolution — the cost is that two genuinely
// overlapping DIM points now cost two (mostly-identical) API calls instead of
// one shared one, which is a fine trade for correctness and predictability.
//
// A region that fits in one crop at good resolution gets exactly that — the
// model sees the whole AOI in one image. A LARGER region (a big drawn area)
// gets a region-scoped "overview" crop (the whole region, reduced) PLUS a
// fine grid within just that region's bounding box — restoring the "step back
// and look at the whole area" pass for area-scale changes, but scoped to the
// AOI instead of the whole photo (unlike the old area-mode path, which lost
// that pass entirely once restricted — see app/page.tsx run()).
export async function buildAoiTiles(
  refUrl: string,
  targetUrl: string,
  regions: AoiRegion[],
  opts?: {
    padding?: number;
    circlePadding?: number;
    maxTilePx?: number;
    maxTiles?: number;
    fineTargetFrac?: number;
    fineOverlap?: number;
    singleCropMaxFrac?: number;
  },
): Promise<AoiTile[]> {
  if (regions.length === 0) return [];
  const padding = opts?.padding ?? 0.35;
  // A lone circle (a DIM point, or a drawn circular area) is already
  // generously margined by its own bounding SQUARE — fitting a circle inside
  // a square wastes (4-π)/4 ≈ 21% of that square's area in the corners before
  // any context padding is even added. The full 0.35 context padding on top
  // of that piles a second, avoidable layer of waste onto corners the model
  // was always going to see dimmed out anyway (§ drawAoiMask). A drawn
  // rectangle/square keeps the larger `padding` — genuinely benefits from
  // more surrounding context, and isn't a clean circle to begin with.
  const circlePadding = opts?.circlePadding ?? 0.15;
  // `maxTilePx` governs ONLY the final crop's own resolution (how many actual
  // pixels of detail the model gets — see cropToUrl) — it stays an absolute
  // pixel budget on purpose, since that's what image sharpness depends on.
  const maxTilePx = opts?.maxTilePx ?? 1400;
  // Cost guard for a pathological import (hundreds of scattered points inside
  // one scene): cap how many regions are actually tiled/analyzed rather than
  // silently issuing an unbounded number of model calls. Ordinary use — tens
  // of points, or one drawn area — never reaches this.
  const maxTiles = opts?.maxTiles ?? 40;
  const fineOverlap = opts?.fineOverlap ?? 0.15;
  // Target size (as a fraction of the region) for each fine sub-tile within
  // a large region's grid.
  const fineTargetFrac = opts?.fineTargetFrac ?? 0.14;
  const MAX_FINE_PER_REGION = 9;

  const ref = await imgFromUrl(refUrl);
  const tgt = await imgFromUrl(targetUrl);
  const W = ref.naturalWidth;
  const H = ref.naturalHeight;

  // Below this fraction of the whole (aligned) working image, a single crop
  // already shows the region at good detail — only larger regions need the
  // overview+fine-grid split. This can't be a fixed fraction: it has to be
  // derived from maxTilePx against the working image's OWN size, because that
  // relationship is what actually determines whether a crop needs splitting.
  // This function crops from the aligned working frame (see app/page.tsx
  // run()), which lib/align.ts caps to ~2600px on its long side regardless of
  // the source orthophoto's real resolution. If a region's own native pixel
  // size in that frame is already at or below maxTilePx, cropToUrl shows it
  // at FULL native resolution with no downsampling at all (scale = 1) —
  // splitting it into a fine grid at that point buys nothing (every sub-tile
  // just re-shows a wedge of already-full-resolution content) while
  // multiplying API calls and cluttering the live preview with tiles that add
  // no detail. A small constant margin (1.3x) allows a LITTLE downsampling
  // before that stops being true.
  const singleCropMaxFrac = opts?.singleCropMaxFrac ?? Math.min(0.6, (maxTilePx * 1.3) / Math.max(W, H));

  const cappedRegions = regions.length > maxTiles ? regions.slice(0, maxTiles) : regions;

  const tiles: AoiTile[] = [];

  for (let ri = 0; ri < cappedRegions.length; ri++) {
    const region = cappedRegions[ri];
    const shapes = region.shapes ?? [];
    const ids = region.pointIds ?? [];
    const isSoloCircle = shapes.length === 1 && shapes[0].kind === "ellipse";
    const regionPadding = isSoloCircle ? circlePadding : padding;
    const rectW = region.rect.x1 - region.rect.x0;
    const rectH = region.rect.y1 - region.rect.y0;
    const padX = rectW * regionPadding;
    const padY = rectH * regionPadding;
    const bounds = {
      x0: Math.max(0, region.rect.x0 - padX),
      y0: Math.max(0, region.rect.y0 - padY),
      x1: Math.min(1, region.rect.x1 + padX),
      y1: Math.min(1, region.rect.y1 + padY),
    };
    // Branch decision on the NORMALIZED span, before any pixel conversion —
    // see singleCropMaxFrac above for why this can't be a pixel comparison.
    const spanX = bounds.x1 - bounds.x0;
    const spanY = bounds.y1 - bounds.y0;
    const x0 = Math.floor(bounds.x0 * W);
    const y0 = Math.floor(bounds.y0 * H);
    const x1 = Math.ceil(bounds.x1 * W);
    const y1 = Math.ceil(bounds.y1 * H);
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const regionRect = { gx: x0 / W, gy: y0 / H, gw: sw / W, gh: sh / H };
    const localShapes = (rect: { gx: number; gy: number; gw: number; gh: number }) =>
      shapes.map((s) => mapShapeToLocal(s, rect)).filter((s): s is OverlayShape => s !== null);

    if (Math.max(spanX, spanY) <= singleCropMaxFrac) {
      // Small enough for one crop at good detail.
      tiles.push({
        refUrl: cropToUrl(ref, x0, y0, sw, sh, maxTilePx, localShapes(regionRect)),
        targetUrl: cropToUrl(tgt, x0, y0, sw, sh, maxTilePx, localShapes(regionRect)),
        gx: regionRect.gx,
        gy: regionRect.gy,
        gw: regionRect.gw,
        gh: regionRect.gh,
        label: `aoi-${ri + 1}`,
        pointIds: ids,
      });
      continue;
    }

    // Region overview: the whole region at reduced detail, so area-scale
    // changes (a new development, a quarry expansion) that no single fine
    // tile shows completely are still caught — scoped to this AOI, not the
    // whole orthophoto.
    tiles.push({
      refUrl: cropToUrl(ref, x0, y0, sw, sh, maxTilePx, localShapes(regionRect)),
      targetUrl: cropToUrl(tgt, x0, y0, sw, sh, maxTilePx, localShapes(regionRect)),
      gx: regionRect.gx,
      gy: regionRect.gy,
      gw: regionRect.gw,
      gh: regionRect.gh,
      label: `aoi-${ri + 1}-overview`,
      pointIds: ids,
    });

    // Fine sub-tiles gridded within just this region's own bounding box.
    let cols = Math.max(1, Math.round(spanX / fineTargetFrac));
    let rows = Math.max(1, Math.round(spanY / fineTargetFrac));
    while (cols * rows > MAX_FINE_PER_REGION) {
      if (cols >= rows && cols > 1) cols--;
      else if (rows > 1) rows--;
      else break;
    }
    const baseW = sw / cols;
    const baseH = sh / rows;
    const ovx = baseW * fineOverlap;
    const ovy = baseH * fineOverlap;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fx0 = Math.max(x0, Math.floor(x0 + c * baseW - ovx));
        const fy0 = Math.max(y0, Math.floor(y0 + r * baseH - ovy));
        const fx1 = Math.min(x1, Math.ceil(x0 + (c + 1) * baseW + ovx));
        const fy1 = Math.min(y1, Math.ceil(y0 + (r + 1) * baseH + ovy));
        const fsw = Math.max(1, fx1 - fx0);
        const fsh = Math.max(1, fy1 - fy0);
        const fineRect = { gx: fx0 / W, gy: fy0 / H, gw: fsw / W, gh: fsh / H };
        tiles.push({
          refUrl: cropToUrl(ref, fx0, fy0, fsw, fsh, maxTilePx, localShapes(fineRect)),
          targetUrl: cropToUrl(tgt, fx0, fy0, fsw, fsh, maxTilePx, localShapes(fineRect)),
          gx: fineRect.gx,
          gy: fineRect.gy,
          gw: fineRect.gw,
          gh: fineRect.gh,
          label: `aoi-${ri + 1}-r${r + 1}c${c + 1}`,
          pointIds: ids,
        });
      }
    }
  }

  return tiles;
}

// Zoomed crops around candidate detections for the verification pass: each
// candidate is re-examined up close with generous context so the model can
// confirm or reject it. Returned as Tiles so mapToGlobal can bring refined
// boxes back to global coordinates.
//
// `shapes` (the same whole-image AOI shape list passed to buildAoiTiles, or
// [] for an unrestricted run) is re-mapped into each crop's own coordinates —
// mapShapeToLocal drops shapes that don't reach a given crop, so passing the
// same list to every candidate is enough; only crops actually near the AOI
// boundary end up with a visible mask/outline.
export async function buildVerifyCrops(
  refUrl: string,
  targetUrl: string,
  boxes: [number, number, number, number][],
  maxPx = 1400,
  shapes: OverlayShape[] = [],
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
    const rect = { gx: x0 / W, gy: y0 / H, gw: sw / W, gh: sh / H };
    const localShapes = shapes.map((s) => mapShapeToLocal(s, rect)).filter((s): s is OverlayShape => s !== null);
    return {
      refUrl: cropToUrl(ref, x0, y0, sw, sh, maxPx, localShapes),
      targetUrl: cropToUrl(tgt, x0, y0, sw, sh, maxPx, localShapes),
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
