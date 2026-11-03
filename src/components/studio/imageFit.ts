/** A picture whose size is not known (it failed to measure) gets a frame of a usual portrait photo, and is shown whole in it: see `pictureFit`. */
export const FALLBACK_ASPECT = 3 / 4;

export type FitRect = { x: number; y: number; width: number; height: number };

/** Width ÷ height, if the measured size makes sense. */
export const aspectOf = (width: number, height: number): number | null => (width > 0 && height > 0 ? width / height : null);

/**
 * The rect a picture of this aspect really takes when contain-fitted and centred in a box, in whole pixels and never
 * outside the box. Rounding a container of exactly this size rounds the picture itself, with nothing around it.
 */
export function fitRect(aspect: number | null | undefined, boxWidth: number, boxHeight: number): FitRect {
  if (!(boxWidth > 0) || !(boxHeight > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const a = aspect && aspect > 0 && Number.isFinite(aspect) ? aspect : FALLBACK_ASPECT;
  const wide = boxWidth / boxHeight <= a;
  const width = Math.max(1, Math.min(boxWidth, Math.round(wide ? boxWidth : boxHeight * a)));
  const height = Math.max(1, Math.min(boxHeight, Math.round(wide ? boxWidth / a : boxHeight)));
  return { x: Math.round((boxWidth - width) / 2), y: Math.round((boxHeight - height) / 2), width, height };
}

/** An aspect being measured is `undefined`; one that could not be measured (or no picture at all) is `null`. */
export type MeasuredAspect = number | null | undefined;

/**
 * The one frame before and after share. The result's shape once it is known, the source photo's until then, so a
 * look that developed in its source's shape keeps standing while its result is measured. A finished look reopened later
 * (`developed` false) waits for its own shape instead of flashing the source's. `undefined`: nothing to draw yet.
 */
export function frameAspect(hasResult: boolean, result: MeasuredAspect, source: MeasuredAspect, developed: boolean): MeasuredAspect {
  if (!hasResult) return source;
  if (result) return result;
  if (result === null) return source;
  return developed ? source : undefined;
}

/**
 * How a picture sits in its frame. Only a picture of a measured shape fills it, its own rect, with nothing to crop;
 * while the shape is unknown the frame may be any other, so the whole picture is shown.
 */
export const pictureFit = (aspect: MeasuredAspect): 'cover' | 'contain' => (aspect ? 'cover' : 'contain');

/** The frame's shape while the next picture is measured: the last one known, rather than no frame at all. */
export const heldAspect = (last: MeasuredAspect, next: MeasuredAspect): MeasuredAspect => (next === undefined ? last : next);

export const MEASURE_TIMEOUT_MS = 3000;
const MEASURE_RETRY_MS = 400;
const ASPECT_CACHE_LIMIT = 200;

/** Remembers a measured shape, the oldest going first. A data: URI is not kept: it is a whole picture as a string, and cheap to measure again. */
export function rememberAspect(known: Map<string, number>, uri: string, aspect: number, limit = ASPECT_CACHE_LIMIT) {
  if (/^data:/i.test(uri)) return;
  known.delete(uri);
  known.set(uri, aspect);
  if (known.size > limit) known.delete(known.keys().next().value as string);
}

type GetSize = (uri: string, ok: (width: number, height: number) => void, fail: () => void) => void;
type After = (ms: number, run: () => void) => () => void;
const realAfter: After = (ms, run) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); };

/**
 * Measures a picture, and always answers in time: `null` on failure or after the timeout, so nothing waits on it for
 * long. An http picture gets one more try. A size that still arrives after `null` is reported too. Returns a cancel.
 */
export function measureAspect(uri: string, getSize: GetSize, report: (aspect: number | null) => void, after: After = realAfter, timeoutMs = MEASURE_TIMEOUT_MS) {
  let over = false, gaveUp = false, retried = false;
  let cancelRetry = () => {};
  const giveUp = () => { if (!over && !gaveUp) { gaveUp = true; report(null); } };
  const cancelTimeout = after(timeoutMs, giveUp);
  const stop = () => { over = true; cancelTimeout(); cancelRetry(); };
  const attempt = () => getSize(uri, (width, height) => {
    if (over) return;
    const aspect = aspectOf(width, height);
    if (aspect) { stop(); report(aspect); } else { giveUp(); stop(); }
  }, () => {
    if (over) return;
    if (retried || !/^https?:/i.test(uri)) { giveUp(); stop(); return; }
    retried = true;
    cancelRetry = after(MEASURE_RETRY_MS, attempt);
  });
  attempt();
  return stop;
}

/** The box a picture is fitted to may only shrink while it is held: the page around it changing (status, comments) cannot make the picture jump. */
export const heldHeight = (previous: number, next: number) => (previous > 0 ? Math.min(previous, next) : next);
