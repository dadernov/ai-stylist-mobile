/** Pure decisions of the sheet's drag and grab bar (kept apart from React Native for tests). */

/** A release counts as a tap only after a small movement and a short press. */
export const isTap = (dx: number, dy: number, ms: number, slop = 10, maxMs = 500) =>
  Math.hypot(dx, dy) <= slop && ms <= maxMs;

/** How far the sheet follows a downward drag; while dismiss is blocked it only rubber-bands a little. */
export const dragOffset = (dy: number, canDismiss: boolean) => {
  const down = Math.max(0, dy);
  return canDismiss ? down : 40 * (1 - Math.exp(-down / 120));
};

/** How far the sheet must have travelled for a flick to close it when the pull came out of a scrolling list: that speed was the scroll's. */
export const HANDOFF_FLICK_TRAVEL = 40;

/** Whether a release closes the sheet: past the threshold (unless flicked back up) or a fast downward flick that moved it past `flickTravel`, and only when allowed. */
export const releaseCloses = ({ dy, vy, height, threshold, velocity, canDismiss, flickTravel = 0 }:
  { dy: number; vy: number; height: number; threshold: number; velocity: number; canDismiss: boolean; flickTravel?: number }) =>
  canDismiss && ((dy > height * threshold && vy > -velocity / 2) || (vy > velocity && dy > flickTravel));

/** Finger travel before a drag belongs to the sheet: small, so the grab feels immediate. */
export const DRAG_SLOP = 6;
/** The same on the sheet's body, where the buttons are: a shaky tap stays a tap. */
export const BODY_DRAG_SLOP = 10;
/** Sideways travel that hands the whole touch to a pager or strip. */
export const HORIZONTAL_SLOP = 10;

/** One touch on a sheet: where its pull started and whether it has been ruled out for good. */
export type DragTrack = { anchorX: number; anchorY: number; horizontal: boolean; multi: boolean };

export const startTrack = (x: number, y: number, touches = 1): DragTrack =>
  ({ anchorX: x, anchorY: y, horizontal: false, multi: touches > 1 });

/**
 * One finger move: does the sheet take over now? `free` says that the touch may move the sheet at this moment (not on a
 * scrolled list, a zoomed photo or a focused input). While it isn't, the anchor follows the finger, so a list that
 * reaches its top mid-gesture hands over with a fresh pull instead of counting the travel spent on scrolling.
 * A sideways touch stays sideways and a pinch stays a pinch until the fingers lift.
 */
export const stepTrack = (track: DragTrack, { x, y, touches, free, slop = DRAG_SLOP }: { x: number; y: number; touches: number; free: boolean; slop?: number }): { track: DragTrack; claim: boolean } => {
  const multi = track.multi || touches > 1;
  if (!free) return { track: { ...track, anchorX: x, anchorY: y, multi }, claim: false };
  const dx = x - track.anchorX;
  const dy = y - track.anchorY;
  const horizontal = track.horizontal || (Math.abs(dx) > HORIZONTAL_SLOP && Math.abs(dx) > Math.abs(dy));
  const next = { ...track, multi, horizontal, anchorY: dy < 0 ? y : track.anchorY };
  return { track: next, claim: !horizontal && !multi && dy > slop && dy > Math.abs(dx) * 1.2 };
};

/** Whether a touch may move the sheet at this moment. */
export const dragFree = ({ blocked, inert, body, grabbed, scrollerAtTop }:
  { blocked: boolean; inert: boolean; body: boolean; grabbed: boolean; scrollerAtTop: boolean }) =>
  !blocked && !inert && scrollerAtTop && (body || grabbed);

/** The sheet's offset under the finger: measured from where it was grabbed, so taking over never jumps by the slop. */
export const grabOffset = (y: number, grabY: number, base: number) => Math.max(0, base + y - grabY);

export type VelocitySample = { t: number; y: number };

/** Keeps the moves the release speed is read from. */
export const addSample = (samples: VelocitySample[], sample: VelocitySample, windowMs = 100): VelocitySample[] =>
  [...samples.filter(item => sample.t - item.t <= windowMs), sample];

/** The finger's speed at release in px/ms; a finger that rested before lifting has none. */
export const releaseVelocity = (samples: VelocitySample[], now: number, restMs = 60) => {
  const last = samples[samples.length - 1];
  const first = samples[0];
  if (!last || now - last.t > restMs || last.t <= first.t) return 0;
  return (last.y - first.y) / (last.t - first.t);
};

/** Animated.spring reads velocity in px/s, gestures measure px/ms. Clamped so that a jittery sample cannot fling it. */
export const springVelocity = (pxPerMs: number, max = 5000) => Math.max(-max, Math.min(max, pxPerMs * 1000));

/** A scroll offset that counts as the top of a list. */
export const scrollAtTop = (offsetY: number) => offsetY <= 0.5;

/** A photo counts as zoomed only past the rounding of a settled zoom. */
export const isZoomed = (zoomScale: number | undefined) => (zoomScale ?? 1) > 1.01;
