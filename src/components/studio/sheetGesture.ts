/** Pure decisions of the sheet's drag and grab bar (kept apart from React Native for tests). */

/** A release counts as a tap only after a small movement and a short press. */
export const isTap = (dx: number, dy: number, ms: number, slop = 10, maxMs = 500) =>
  Math.hypot(dx, dy) <= slop && ms <= maxMs;

/** How far the sheet follows a downward drag; while dismiss is blocked it only rubber-bands a little. */
export const dragOffset = (dy: number, canDismiss: boolean) => {
  const down = Math.max(0, dy);
  return canDismiss ? down : 40 * (1 - Math.exp(-down / 120));
};

/** Whether a release closes the sheet: past the threshold or a fast downward flick, and only when allowed. */
export const releaseCloses = ({ dy, vy, height, threshold, velocity, canDismiss }:
  { dy: number; vy: number; height: number; threshold: number; velocity: number; canDismiss: boolean }) =>
  canDismiss && (dy > height * threshold || (vy > velocity && dy > 0));
