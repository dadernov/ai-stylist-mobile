/**
 * Tells a double tap from everything else a finger does on a photo, from raw touches alone: it never claims the touch, so the
 * sheet's drag, the pager and the pinch go on as if it weren't there, and a single tap costs nothing because nothing waits for it.
 */
export const TAP_MAX_MS = 250;
export const TAP_SLOP = 10;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_RADIUS = 30;

export function createDoubleTap() {
  let start: { x: number; y: number; at: number } | null = null;
  let last: { x: number; y: number; at: number } | null = null;
  // More than one finger was down: nothing counts until all are up.
  let pinching = false;
  return {
    down(x: number, y: number, at: number, touches = 1) {
      if (touches > 1) { pinching = true; start = null; last = null; return; }
      if (!pinching) start = { x, y, at };
    },
    /** Returns true on the lift that completes a double tap. `left`: the fingers still down. */
    up(x: number, y: number, at: number, left = 0) {
      if (left > 0) return false;
      if (pinching) { pinching = false; start = null; return false; }
      const began = start;
      start = null;
      if (!began || at - began.at > TAP_MAX_MS || Math.hypot(x - began.x, y - began.y) > TAP_SLOP) { last = null; return false; }
      const previous = last;
      if (previous && at - previous.at <= DOUBLE_TAP_MS && Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_RADIUS) { last = null; return true; }
      last = { x, y, at };
      return false;
    },
    /** A scroll or a drag took the touch over. */
    cancel() { start = null; last = null; pinching = false; },
  };
}
