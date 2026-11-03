/** A picture whose size is not known (it failed to measure) is taken for a usual portrait photo. */
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

/** The box a picture is fitted to may only shrink: the page around it changing (status, then buttons) cannot make the picture jump. */
export const heldHeight = (previous: number, next: number) => (previous > 0 ? Math.min(previous, next) : next);
