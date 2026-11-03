import type { WardrobeItem } from '../../data/mock';
import { isLegwear } from '../../domain/legwear';

/** Where a piece of a look stands on the stage: its cell in px from the stage's top-left. */
export type PlacedPiece = { id: string; x: number; y: number; w: number; h: number; rotate: string };

/** Width ÷ height of each piece's picture, by item id (a cut-out is cropped to the garment by the server). */
export type Aspects = Record<string, number | undefined>;

const ONE_PIECES = new Set(['Платье', 'Сарафан', 'Комбинезон']);
const isOnePiece = (item: WardrobeItem) => ONE_PIECES.has(item.category);

// Where a piece is worn, top to bottom: the order of the flat lay.
const rank = (item: WardrobeItem) =>
  item.section === 'Верхняя одежда' ? 0 : isOnePiece(item) ? 1 : item.section === 'Верх' ? 2 : item.section === 'Низ' ? 3
    : item.section === 'Обувь' ? 4 : item.section === 'Сумки' ? 5 : 6;
/** A photo with its own ground is shown as a card of this shape. */
export const CARD_ASPECT = 0.8;

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
