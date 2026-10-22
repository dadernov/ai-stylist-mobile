import type { WardrobeItem } from '../../data/mock';
import { isLegwear } from '../../domain/legwear';

/** Where a piece of a look stands on the stage: box in px from the stage's top-left, and a slight tilt. */
export type PlacedPiece = { id: string; x: number; y: number; w: number; h: number; rotate: string };

// Slots on the mock-up's 390×404 stage (ideas.html): [x, y, width, height ÷ width, tilt in degrees].
type Slot = [number, number, number, number, number];
const STAGE_W = 390, STAGE_H = 404;
const SOLO = { main: [30, 34, 210, 1.05, -2], bottom: [240, 104, 104, 1.6, 2], shoes: [190, 306, 132, 0.62, -6] } satisfies Record<string, Slot>;
// A layer over another: the big piece on the left, what is under it upper-right, the bottom below that.
const LAYERED = { main: [20, 24, 214, 1.15, -2], inner: [216, 34, 136, 1, 3], bottom: [236, 160, 100, 1.6, -2], shoes: [104, 306, 128, 0.62, -5] } satisfies Record<string, Slot>;
// A dress or a jumpsuit on its own stands in the middle, the shoes at its foot.
const ONE_PIECE = { main: [100, 16, 190, 1.45, -1], shoes: [250, 306, 120, 0.62, -4] } satisfies Record<string, Slot>;
const BAG: Slot = [18, 300, 92, 0.9, 3];
const ACCESSORY: Slot = [14, 236, 66, 0.8, 3];

const ONE_PIECES = new Set(['Платье', 'Сарафан', 'Комбинезон']);
const isOnePiece = (item: WardrobeItem) => ONE_PIECES.has(item.category);

/**
 * Lays a look out on a stage of the given size the way the mock-up composes it: outerwear or a one-piece large
 * on the left (a one-piece alone in the centre), the top upper-left or, under a layer, upper-right, the bottom
 * to the right, shoes low, a bag lower-left. Tights are worn under and not shown. Every box stays on the stage.
 */
export function layoutLook(items: WardrobeItem[], width: number, height: number): PlacedPiece[] {
  const shown = items.filter(item => !isLegwear(item));
  if (!shown.length || width <= 0 || height <= 0) return [];
  const outers = shown.filter(item => item.section === 'Верхняя одежда');
  const onePieces = shown.filter(item => item.section !== 'Верхняя одежда' && isOnePiece(item));
  const tops = shown.filter(item => item.section === 'Верх' && !isOnePiece(item));
  const bottoms = shown.filter(item => item.section === 'Низ');
  const shoes = shown.filter(item => item.section === 'Обувь');
  const bags = shown.filter(item => item.section === 'Сумки');
  const placed = new Set([...outers, ...onePieces, ...tops, ...bottoms, ...shoes, ...bags]);
  const rest = shown.filter(item => !placed.has(item));

  const upper = [...outers, ...onePieces, ...tops];
  const layered = upper.length > 1;
  const centred = !layered && onePieces.length === 1 && !bottoms.length;
  const plan = layered ? LAYERED : centred ? ONE_PIECE : SOLO;
  const slots: [WardrobeItem[], Slot | undefined][] = [
    [upper.slice(0, 1), plan.main],
    [upper.slice(1), layered ? LAYERED.inner : undefined],
    // A centred one-piece never has a bottom beside it.
    [bottoms, layered ? LAYERED.bottom : SOLO.bottom],
    [shoes, plan.shoes], [bags, BAG], [rest, ACCESSORY]
  ];

  // The mock-up's stage scaled to fit, centred; pieces are kept wholly inside.
  const s = Math.min(width / STAGE_W, height / STAGE_H);
  const dx = (width - STAGE_W * s) / 2, dy = (height - STAGE_H * s) / 2;
  const round = (n: number) => Math.floor(n * 10) / 10;
  const out: PlacedPiece[] = [];
  for (const [group, slot] of slots) {
    if (!slot) continue;
    group.forEach((item, k) => {
      // Further pieces of the same kind are set a little lower-right and smaller, overlapping like a flat lay.
      const [X, Y, W, ratio, tilt] = slot;
      const w = Math.min(width, W * s * Math.pow(0.86, k));
      const h = Math.min(height, w * ratio);
      // A look of a single piece stands in the middle.
      const x = shown.length === 1 ? (width - w) / 2 : Math.max(0, Math.min(width - w, X * s + dx + 24 * s * k));
      const y = Math.max(0, Math.min(height - h, Y * s + dy + 22 * s * k));
      out.push({ id: item.id, x: round(x), y: round(y), w: round(w), h: round(h), rotate: `${tilt}deg` });
    });
  }
  return out;
}
