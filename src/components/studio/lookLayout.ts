import type { WardrobeItem } from '../../data/mock';
import { isLegwear } from '../../domain/legwear';

/** Where a piece of a look stands on the stage: box in px from the stage's top-left, and a slight tilt. */
export type PlacedPiece = { id: string; x: number; y: number; w: number; h: number; rotate: string };

/** Width ÷ height of each piece's picture, by item id (a cut-out is cropped to the garment by the server). */
export type Aspects = Record<string, number | undefined>;

const ONE_PIECES = new Set(['Платье', 'Сарафан', 'Комбинезон']);
const isOnePiece = (item: WardrobeItem) => ONE_PIECES.has(item.category);

// Where a piece is worn, top to bottom: the order of the flat lay.
const rank = (item: WardrobeItem) =>
  item.section === 'Верхняя одежда' ? 0 : isOnePiece(item) ? 1 : item.section === 'Верх' ? 2 : item.section === 'Низ' ? 3
    : item.section === 'Обувь' ? 4 : item.section === 'Сумки' ? 5 : 6;
// Until the picture's own size is known, a guess by kind: trousers are tall, shoes and bags wide.
const GUESS = [0.85, 0.6, 0.9, 0.55, 1.4, 1.1, 1];
/** A photo with its own ground is shown as a card of this shape. */
export const CARD_ASPECT = 0.8;

const GAP = 18;      // between pieces, leaves room for a tilt and the floor shadow
const PAD = 16;      // around the stage edge
const SHADOW = 14;   // the floor shadow below the lowest row
/** Linear size of shoes, bags and accessories against clothes. */
export const SMALL = 0.7;
const TILTS = [-2, 1.5, -1, 2, -1.5, 1];

type Piece = { item: WardrobeItem; a: number; band: number };
// One way to lay the pieces out: lines of pieces, as rows (side by side) or as columns (stacked).
type Plan = { lines: Piece[][]; rows: boolean };

const clampAspect = (a: number) => Math.min(2.2, Math.max(0.4, a));

/** Every way to cut the ordered pieces into consecutive lines (at most 6 pieces, so at most 32). */
function splits(pieces: Piece[]): Piece[][][] {
  if (pieces.length <= 1) return [[pieces]];
  const out: Piece[][][] = [];
  for (let mask = 0; mask < 1 << (pieces.length - 1); mask++) {
    const lines: Piece[][] = [[pieces[0]]];
    for (let i = 1; i < pieces.length; i++) (mask >> (i - 1)) & 1 ? lines.push([pieces[i]]) : lines[lines.length - 1].push(pieces[i]);
    out.push(lines);
  }
  return out;
}

// Unit pieces of area 1: w = √a, h = 1/√a; the plan's scale is what fits the stage.
// Shoes, bags and accessories are a little smaller than clothes, as they are in life; the rest share one area.
const unit = (p: Piece) => { const s = p.band === 2 ? SMALL : 1; return { w: s * Math.sqrt(p.a), h: s / Math.sqrt(p.a) }; };
function scaleOf(plan: Plan, width: number, height: number) {
  const along = (p: Piece) => (plan.rows ? unit(p).w : unit(p).h);
  const across = (p: Piece) => (plan.rows ? unit(p).h : unit(p).w);
  const roomAlong = (plan.rows ? width : height - SHADOW) - 2 * PAD;
  const roomAcross = (plan.rows ? height - SHADOW : width) - 2 * PAD - GAP * (plan.lines.length - 1);
  let k = roomAcross / plan.lines.reduce((sum, line) => sum + Math.max(...line.map(across)), 0);
  for (const line of plan.lines) k = Math.min(k, (roomAlong - GAP * (line.length - 1)) / line.reduce((sum, p) => sum + along(p), 0));
  return k;
}

// Rows read top to bottom as worn: shoes never share a row with a top. A column never starts with shoes.
const sensible = (plan: Plan) => plan.lines.every(line => {
  const bands = line.map(p => p.band);
  return plan.rows ? Math.max(...bands) - Math.min(...bands) <= 1 : bands[0] <= 1;
});

/**
 * Lays a look out as a tidy flat lay: every piece at about the same visual size (the same area, from its picture's
 * aspect), none over another, all inside the stage. Upper body first, then the bottom, shoes and bags last; the
 * arrangement (rows or columns) is the one that lets the pieces be largest. Tights are worn under and not shown.
 */
export function layoutLook(items: WardrobeItem[], width: number, height: number, aspects: Aspects = {}): PlacedPiece[] {
  const shown = items.filter(item => !isLegwear(item)).slice(0, 6);
  if (!shown.length || width <= 0 || height <= 0) return [];
  const pieces: Piece[] = shown
    .map((item, order) => ({ item, order, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .map(({ item, r }) => ({ item, a: clampAspect(aspects[item.id] || GUESS[r]), band: r <= 2 ? 0 : r === 3 ? 1 : 2 }));

  let best: { plan: Plan; k: number } | undefined;
  for (const rows of [true, false]) for (const lines of splits(pieces)) {
    const plan = { lines, rows };
    if (!sensible(plan)) continue;
    // A small bias towards rows: they read as the body, top to bottom.
    const k = scaleOf(plan, width, height) * (rows ? 1.04 : 1);
    if (!best || k > best.k) best = { plan, k };
  }
  const { plan } = best!;
  // A lone piece should not fill the whole stage.
  const k = Math.min(scaleOf(plan, width, height), Math.sqrt(width * height * 0.32));

  const size = (p: Piece) => ({ w: unit(p).w * k, h: unit(p).h * k });
  const lineAcross = plan.lines.map(line => Math.max(...line.map(p => (plan.rows ? size(p).h : size(p).w))));
  const totalAcross = lineAcross.reduce((a, b) => a + b, 0) + GAP * (plan.lines.length - 1);
  const round = (n: number) => Math.floor(n * 10) / 10;
  const out: PlacedPiece[] = [];
  let cursor = ((plan.rows ? height - SHADOW : width) - totalAcross) / 2;
  let n = 0;
  plan.lines.forEach((line, li) => {
    const along = line.reduce((sum, p) => sum + (plan.rows ? size(p).w : size(p).h), 0) + GAP * (line.length - 1);
    let pos = ((plan.rows ? width : height - SHADOW) - along) / 2;
    for (const p of line) {
      const { w, h } = size(p);
      // Centred in its line's band.
      const off = cursor + (lineAcross[li] - (plan.rows ? h : w)) / 2;
      const x = plan.rows ? pos : off, y = plan.rows ? off : pos;
      out.push({ id: p.item.id, x: round(x), y: round(y), w: round(w), h: round(h), rotate: `${TILTS[n++ % TILTS.length]}deg` });
      pos += (plan.rows ? w : h) + GAP;
    }
    cursor += lineAcross[li] + GAP;
  });
  return out;
}

// The strict grid: the same cell for every piece, nothing tilted, nothing over another.
const GRID_PAD = 14;
const GRID_GUTTER = 10;
const GRID_LOW_STAGE = 200;   // one row, or two pieces: a taller stage would stand half empty
const GRID_TALL_STAGE = 290;  // two rows of pieces large enough to tell apart
const GRID_MAX_WIDE = 1.15;   // a cell is about square or a little tall: a garment contain-fits it well
const GRID_MAX_TALL = 1.25;
const GRID_MAX_SHARE = 0.62;  // of the stage's width: a lone piece stands in the middle, not filling it

// The column counts allowed for a number of pieces; the one giving the largest cell on the stage wins.
const gridColumns = (n: number) => n <= 2 ? [n] : n === 3 ? [3, 2] : n === 4 ? [2] : n <= 6 ? [3, 2] : n <= 8 ? [4, 3] : [Math.ceil(Math.sqrt(n)), Math.ceil(Math.sqrt(n)) + 1];

const gridShown = (items: WardrobeItem[]) => items.filter(item => !isLegwear(item));

/** How many pieces of these the grid shows: tights are worn under and not shown. */
export const gridCount = (items: WardrobeItem[]) => gridShown(items).length;

/** The stage for a grid of up to `count` pieces. It depends only on the count, never on the pictures. */
export const gridStageHeight = (count: number) => (count >= 4 ? GRID_TALL_STAGE : GRID_LOW_STAGE);

/**
 * Lays a look out as a strict grid: identical cells on shared rows and columns, zero rotation, even gutters, in the
 * order worn, with the last incomplete row centred. The box of each piece is its cell, to be contain-fitted. It takes
 * no aspects on purpose: a picture's size arriving late cannot move anything.
 */
export function gridLook(items: WardrobeItem[], width: number, height: number): PlacedPiece[] {
  const shown = gridShown(items);
  if (!shown.length || width <= 0 || height <= 0) return [];
  const ordered = shown.map((item, order) => ({ item, order, r: rank(item) })).sort((a, b) => a.r - b.r || a.order - b.order);
  const n = ordered.length;

  let best: { cols: number; rows: number; w: number; h: number } | undefined;
  for (const cols of gridColumns(n)) {
    const rows = Math.ceil(n / cols);
    const roomW = (width - 2 * GRID_PAD - GRID_GUTTER * (cols - 1)) / cols;
    const roomH = (height - 2 * GRID_PAD - GRID_GUTTER * (rows - 1)) / rows;
    const w = Math.floor(Math.min(roomW, width * GRID_MAX_SHARE, roomH * GRID_MAX_WIDE));
    const h = Math.floor(Math.min(roomH, w * GRID_MAX_TALL));
    // A garment contain-fits by the cell's shorter side, so that is what "largest" means here.
    const side = Math.min(w, h), bestSide = best ? Math.min(best.w, best.h) : -Infinity;
    if (!best || side > bestSide || (side === bestSide && w * h > best.w * best.h)) best = { cols, rows, w, h };
  }
  const { cols, rows, w, h } = best!;
  if (w < 1 || h < 1) return [];

  const top = Math.round((height - (rows * h + GRID_GUTTER * (rows - 1))) / 2);
  return ordered.map(({ item }, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const left = Math.round((width - (inRow * w + GRID_GUTTER * (inRow - 1))) / 2);
    return { id: item.id, x: left + col * (w + GRID_GUTTER), y: top + row * (h + GRID_GUTTER), w, h, rotate: '0deg' };
  });
}
