/** The pure logic of the generation view: the placeholder's colours and sweep, the status line's wave, the top-down reveal, and which reveals are owed. */

/** A neutral grey that sits quietly on either theme's page. */
export const placeholderFill = (isDark: boolean) => (isDark ? '#2B2C30' : '#E4E4E8');
/** Depth in the grey: a whisper lighter at the top. */
export const placeholderDepth = (isDark: boolean): [string, string] => (isDark ? ['#313238', '#26272A'] : ['#EBEBEE', '#DEDEE2']);

/** The band of light: transparent at both ends so it has no edges, white at the heart, an iridescent hint on either side. */
export function sweepColors(isDark: boolean): [string, string, ...string[]] {
  return isDark
    ? ['rgba(255,255,255,0)', 'rgba(170,190,255,0.03)', 'rgba(205,190,255,0.07)', 'rgba(255,255,255,0.13)', 'rgba(255,205,200,0.06)', 'rgba(190,240,235,0.03)', 'rgba(255,255,255,0)']
    : ['rgba(255,255,255,0)', 'rgba(225,230,245,0.06)', 'rgba(235,230,250,0.14)', 'rgba(255,255,255,0.55)', 'rgba(250,235,232,0.12)', 'rgba(228,244,240,0.05)', 'rgba(255,255,255,0)'];
}
export const SWEEP_STOPS: [number, number, ...number[]] = [0, 0.16, 0.34, 0.5, 0.66, 0.84, 1];
export const SWEEP_MS = 2400;
export const SWEEP_REST_MS = 500;
/** How far the light leans. */
export const SWEEP_TILT_DEG = 14;
/** The band's height against the frame's: tilted, it still reaches past the corners. */
export const SWEEP_OVERHANG = 1.4;

/**
 * The band is a horizontal gradient, tilted as a whole, so its long edges are its transparent ends and can never show.
 * It starts and ends wholly outside the frame, tilt included, so a loop's jump back is never seen.
 */
export function sweepTravel(frameWidth: number, frameHeight: number) {
  const bandWidth = Math.round(frameWidth * 0.8);
  const lean = Math.ceil(Math.tan(SWEEP_TILT_DEG * Math.PI / 180) * frameHeight * SWEEP_OVERHANG / 2);
  return { bandWidth, from: -bandWidth - lean, to: frameWidth + lean };
}

export const TEXT_WAVE_MS = 2200;
const TEXT_LOW = 0.45;
const TEXT_WIDTH = 0.3;

/** One letter's brightness as the wave `t` (0 to 1) crosses the line: dim, bright as the crest passes it, dim again. */
export function letterWave(index: number, count: number) {
  const span = 1 + TEXT_WIDTH * 2;
  const at = count > 1 ? index / (count - 1) : 0.5;
  const crest = (at + TEXT_WIDTH) / span;
  const half = TEXT_WIDTH / span;
  return { inputRange: [crest - half, crest, crest + half], outputRange: [TEXT_LOW, 1, TEXT_LOW], extrapolate: 'clamp' as const };
}
/** The letters of a line, a surrogate pair staying one letter, spaces that keep their width in a row. */
export const lineLetters = (line: string) => Array.from(line).map(letter => (letter === ' ' ? ' ' : letter));
/** Beyond this the line would not fit in a row of letters: it pulses as a whole instead. */
export const WAVE_MAX_LETTERS = 36;

export const REVEAL_BLUR_IN_MS = 350;
export const REVEAL_SHARPEN_DELAY_MS = 150;
export const REVEAL_SHARPEN_MS = 1350;
export const REVEAL_TOTAL_MS = REVEAL_SHARPEN_DELAY_MS + REVEAL_SHARPEN_MS;
/** How long a slow network may hold the reveal back. */
export const PREFETCH_LIMIT_MS = 2000;
/** A finished look on screen stands revealed by now, whatever happens. */
export const REVEAL_WATCHDOG_MS = 4000;

/** How many bands sharpen one after another: enough for a soft edge, few enough for a small phone. */
export const REVEAL_STRIPS = 24;
/** The part of the reveal one band takes: long, so several are always part way, which is the soft edge. */
const STRIP_FEATHER = 0.3;

/** The picture cut in whole-point rows without a gap or an overlap, either of which would show as a line. */
export function revealStrips(height: number, count = REVEAL_STRIPS) {
  const whole = Math.ceil(Math.max(0, height));
  const rows = Math.max(1, Math.min(count, whole));
  return Array.from({ length: rows }, (_, index) => {
    const top = Math.round(whole * index / rows);
    return { top, height: Math.round(whole * (index + 1) / rows) - top };
  });
}

/** When a band turns from blurred to sharp, top first; the last ends exactly when the reveal does. */
export function stripOpacity(index: number, count: number) {
  const start = count > 1 ? index / (count - 1) * (1 - STRIP_FEATHER) : 0;
  const end = Math.min(1, start + STRIP_FEATHER);
  return { inputRange: [start, end], outputRange: [0, 1], extrapolate: 'clamp' as const };
}

export type RevealSurface = 'full' | 'mini';

/**
 * Which looks still owe their reveal. A look seen running owes one to the big view and one to the small window, however
 * it finished: on screen, in the corner or while the user was away. Old finished looks were never tracked and owe nothing.
 */
export function createRevealLedger() {
  const owed = new Map<string, Set<RevealSurface>>();
  return {
    track(key: string) { if (!owed.has(key)) owed.set(key, new Set<RevealSurface>(['full', 'mini'])); },
    owes(key: string, surface: RevealSurface) { return Boolean(owed.get(key)?.has(surface)); },
    settle(key: string, surface: RevealSurface) { owed.get(key)?.delete(surface); },
    /** Looked at elsewhere (full screen, from the history): nothing is owed any more. */
    forget(key: string) { owed.get(key)?.clear(); },
  };
}
export const revealLedger = createRevealLedger();
