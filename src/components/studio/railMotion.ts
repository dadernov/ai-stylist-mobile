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

/** The largest box of this width ÷ height within a square, so a cut-out stands on the floor at its full size. */
export function fitBox(aspect: number | undefined, side: number) {
  const ratio = aspect && aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return ratio >= 1 ? { width: side, height: side / ratio } : { width: side * ratio, height: side };
}

/** The place nearest to a position, within the rail's ends. */
export const nearestPlace = (position: number, min: number, max: number) => clamp(Math.round(position), min, max);

/** How long the native side's reports of the rail's previous life can still arrive after JS has put it elsewhere. */
export const ECHO_DISCARD_MS = 80;

/** Whether a position reported by the native side counts: under a finger JS knows better, and just after a jump it is out of date. */
export const echoCounts = ({ dragging, now, staleUntil }: { dragging: boolean; now: number; staleUntil: number }) =>
  !dragging && now >= staleUntil;

/** Where the focus goes when its piece has left the list: the piece that took its place, or the new last one. */
export const neighbourIndex = (lastIndex: number, count: number) => Math.max(0, Math.min(lastIndex, count - 1));

/** Where GarmentImage draws a photo with its own ground, as shares of its box; the reflection starts from this picture's foot. */
export const PRINT_FRAME = { width: 0.84, height: 0.92 };
export function printRect(box: { width: number; height: number }) {
  const width = box.width * PRINT_FRAME.width;
  const height = box.height * PRINT_FRAME.height;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** The stage's layout: the pieces stand on one floor line, the reflections take what is below it. */
const REFLECTION_SHARE = 0.3;
export function showcaseGeometry(stageHeight: number, stageWidth: number, reduced = false) {
  const side = Math.max(150, Math.min((stageHeight - 8) / (1 + REFLECTION_SHARE), stageWidth - 90));
  const reflection = Math.max(0, Math.min(side * REFLECTION_SHARE, stageHeight - side - 4));
  const top = Math.max(4, (stageHeight - side - reflection) / 2);
  // Flat neighbours need the room that turning and shrinking gives the others.
  return { side, reflection, top, floorY: top + side, stageWidth, pitch: stageWidth * (reduced ? 0.75 : 0.5) };
}

/** Double image layers wherever a swipe can reach before the centre moves on: two places out, so none appears mid-swipe. */
export const REFLECTION_RADIUS = 2;
export const showsReflection = (at: number, center: number) => Math.abs(at - center) <= REFLECTION_RADIUS;

/** The list indices of the mounted window, the farthest first and the focused piece last. */
export function windowIndices(index: number, count: number) {
  const seen = new Set<number>();
  for (let step = WINDOW_RADIUS; step >= 0; step--) for (const place of [index + step, index - step]) {
    if (count && (railLoops(count) || (place >= 0 && place < count))) { const at = mod(place, count); seen.delete(at); seen.add(at); }
  }
  return [...seen];
}

const SIDE_ANGLE = 40;
const SIDE_SCALE = 0.72;
const SIDE_RISE = 10;
const SIDE_OPACITY = 0.55;
/** Two lights half on each cover only 3/4 of the stage: this high, the one going and the one coming still make nearly the whole. */
const MIDWAY_LIGHT = 0.8;

/**
 * How one place moves with the position: each is an interpolation's ranges, so all of it runs on the native side.
 * To the right of the centre a piece turns its inner edge away, to the left the same mirrored; farther off it is gone.
 * With reduced motion it only slides and fades.
 */
export function depthKeyframes(at: number, pitch: number, reduced: boolean) {
  const near = [at - 1, at, at + 1];
  const translateX = { inputRange: [at - 1, at + 1], outputRange: [pitch, -pitch] };
  const focus = { inputRange: near, outputRange: [0, 1, 0] };
  const light = { inputRange: [at - 1, at - 0.5, at, at + 0.5, at + 1], outputRange: [0, MIDWAY_LIGHT, 1, MIDWAY_LIGHT, 0] };
  if (reduced) return { translateX, focus, light, opacity: { inputRange: near, outputRange: [0.3, 1, 0.3] } };
  return {
    translateX, focus, light,
    opacity: { inputRange: [at - 2, ...near, at + 2], outputRange: [0, SIDE_OPACITY, 1, SIDE_OPACITY, 0] },
    scale: { inputRange: near, outputRange: [SIDE_SCALE, 1, SIDE_SCALE] },
    rise: { inputRange: near, outputRange: [-SIDE_RISE, 0, -SIDE_RISE] },
    rotateY: { inputRange: near, outputRange: [`${-SIDE_ANGLE}deg`, '0deg', `${SIDE_ANGLE}deg`] }
  };
}
