/** Pure decisions of the wardrobe rail (kept apart from React Native for tests). Positions are in pieces, velocities in px/ms. */

/** Below this a release is a placed drop rather than a flick. */
export const FLICK_VELOCITY = 0.25;
/** The hardest flick still lands within this many pieces, and the mounted window covers them. */
export const MAX_FLICK_STEPS = 3;
/** Pieces mounted on either side of the centre: they are decoded before they slide in. */
export const WINDOW_RADIUS = 3;
export const THUMB_PITCH = 70;

export const mod = (value: number, count: number) => count > 0 ? ((value % count) + count) % count : 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Three pieces or more go round; with two the same piece on both sides would look like a mistake, so the rail has ends. */
export const railLoops = (count: number) => count >= 3;

/** The positions the rail can rest at, given which position shows which list index. */
export function railBounds(center: number, index: number, count: number) {
  if (railLoops(count)) return { min: -Infinity, max: Infinity };
  const min = center - index;
  return { min, max: min + Math.max(0, count - 1) };
}

/** The positions to mount: every one holds a piece, none when the list is empty. */
export function railWindow(center: number, index: number, count: number, radius = WINDOW_RADIUS) {
  if (count <= 0) return [];
  const { min, max } = railBounds(center, index, count);
  const slots: number[] = [];
  for (let at = Math.max(min, center - radius); at <= Math.min(max, center + radius); at++) slots.push(at);
  return slots;
}

/** Past an end of the rail the drag gives only a little, and never as far as the next place. */
export function rubberBand(position: number, min: number, max: number, reach = 0.22) {
  if (position < min) return min - reach * (1 - Math.exp((position - min) / reach));
  if (position > max) return max + reach * (1 - Math.exp((max - position) / reach));
  return position;
}

/**
 * Where a release lands. `velocityX` is the finger's (right is positive: the rail then runs backwards);
 * `anchor` is where the rail was already heading when this drag began, so a flick made during the previous
 * one's landing counts on top of it instead of being lost; `origin` is the position the drag began from.
 */
export function snapTarget({ position, velocityX, anchor, origin, min, max }:
  { position: number; velocityX: number; anchor: number; origin: number; min: number; max: number }) {
  const speed = Math.abs(velocityX);
  if (speed < FLICK_VELOCITY) return clamp(Math.round(position), min, max);
  const direction = velocityX < 0 ? 1 : -1;
  const net = position - origin;
  const sameWay = net === 0 || Math.sign(net) === direction;
  const extra = speed >= 4.5 ? 2 : speed >= 3 ? 1 : 0;
  const near = direction > 0 ? Math.ceil(position) : Math.floor(position);
  const first = !sameWay ? near : direction > 0 ? Math.max(near, anchor + 1) : Math.min(near, anchor - 1);
  const limit = Math.round(position) + direction * MAX_FLICK_STEPS;
  const target = first + direction * extra;
  return clamp(direction > 0 ? Math.min(target, limit) : Math.max(target, limit), min, max);
}

/** The lean while the rail moves, -1…1: the hook leads and the piece trails, and it saturates so a hard flick stays tasteful. */
export const swingFromVelocity = (velocityX: number) => Math.tanh(velocityX / 1.6);

/** The push a release gives the damped pendulum, in swing units a second. */
export const swingKick = (velocityX: number) => clamp(velocityX * 4, -6, 6);

/** Pieces hang at slightly different lengths, so a row never swings as one block. Stable per place on the rail. */
export const swingFactor = (at: number) => 0.85 + mod(at, 3) * 0.15;

/** The place to tick for when the rail comes close to a new centre; null while nothing new has arrived. */
export function centreTick(position: number, last: number, radius = 0.3) {
  const near = Math.round(position);
  return near !== last && Math.abs(position - near) <= radius ? near : null;
}

/** The shorter way along the rail from one index to another; straight when the rail has ends. */
export function shortestDelta(from: number, to: number, count: number) {
  const direct = to - from;
  if (!railLoops(count)) return direct;
  const forward = mod(direct, count);
  return forward > count / 2 ? forward - count : forward;
}

/** The strip's scroll offset that brings a thumbnail to the middle, within what the strip can scroll. */
export function stripOffset(index: number, count: number, viewWidth: number, pitch = THUMB_PITCH, padding = 16) {
  const content = count * pitch + padding * 2;
  const wanted = padding + index * pitch + 30 - viewWidth / 2;
  return Math.max(0, Math.min(wanted, content - viewWidth));
}

/** Whether a piece hangs from the rail or stands on the shelf: by its wardrobe section, so every item of a section behaves alike. */
const STANDING_SECTIONS = new Set(['Обувь', 'Сумки', 'Аксессуары']);
export const restingKind = (section?: string): 'hang' | 'stand' => section && STANDING_SECTIONS.has(section) ? 'stand' : 'hang';

/** The largest box of this width ÷ height within a square, so a cut-out's top meets the hanger and its bottom the shelf. */
export function fitBox(aspect: number | undefined, side: number) {
  const ratio = aspect && aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return ratio >= 1 ? { width: side, height: side / ratio } : { width: side * ratio, height: side };
}
