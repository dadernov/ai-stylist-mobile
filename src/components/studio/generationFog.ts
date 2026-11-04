/** The pure logic of the generation view: the fog's colour, its reveal, how it steps down, and which reveals are owed. */
import { NAMED_COLORS } from '../../domain/namedColors';

export type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
};
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => a.map((value, index) => value + (b[index] - value) * amount) as Rgb;
const LIGHT_A: Rgb = [0.82, 0.8, 0.93];
const LIGHT_B: Rgb = [0.93, 0.86, 0.84];
const DARK_A: Rgb = [0.34, 0.37, 0.52];
const DARK_B: Rgb = [0.5, 0.42, 0.5];
const saturation = (c: Rgb) => Math.max(...c) - Math.min(...c);
const BY_NAME = new Map<string, Rgb>();
for (const { name, hex } of NAMED_COLORS) {
  const rgb = hexToRgb(hex);
  if (rgb) BY_NAME.set(name.toLowerCase(), rgb);
}

/**
 * The fog's two tints, from the look's own garments: their most colourful named colours, softened into the default
 * pearl so no garment can turn the whole frame loud or muddy. Unknown or colourless clothes keep the default.
 */
export function fogPalette(items: { color?: string; tags?: string[] }[], isDark: boolean): { a: Rgb; b: Rgb } {
  const base = isDark ? { a: DARK_A, b: DARK_B } : { a: LIGHT_A, b: LIGHT_B };
  const colors = items.flatMap(item => [item.color, ...(item.tags || [])])
    .map(name => name ? BY_NAME.get(name.toLowerCase()) : undefined)
    .filter((rgb): rgb is Rgb => Boolean(rgb) && saturation(rgb as Rgb) > 0.12)
    .sort((x, y) => saturation(y) - saturation(x));
  const strength = isDark ? 0.45 : 0.5;
  return {
    a: colors[0] ? mix(base.a, colors[0], strength) : base.a,
    b: colors[1] ? mix(base.b, colors[1], strength) : colors[0] ? mix(base.b, colors[0], strength * 0.5) : base.b,
  };
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
export const REVEAL_COVER_MS = 420;
export const REVEAL_OPEN_MS = 1250;
export const REVEAL_TOTAL_MS = REVEAL_COVER_MS + REVEAL_OPEN_MS;

/** Where the reveal is `ms` after its start: the fog thickens until nothing shows, then parts from the top. */
export function revealAt(ms: number) {
  return {
    cover: smooth(ms / REVEAL_COVER_MS),
    open: smooth((ms - REVEAL_COVER_MS) / REVEAL_OPEN_MS),
    covered: ms >= REVEAL_COVER_MS,
    finished: ms >= REVEAL_TOTAL_MS,
  };
}

/** A seed from a job's id: each look has its own fog, and the same one in every window that shows it. */
export function fogSeed(key?: string | null) {
  let hash = 7;
  for (const char of key || '') hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash / 9973 * 500;
}

const FOG_PERIOD_S = 1800;
/** The fog's clock runs on the wall clock, so a look folded into the corner or reopened goes on from the same moment. */
export const fogTime = (nowMs: number, seed: number) => seed + (nowMs / 1000) % FOG_PERIOD_S;

export const FOG_LEVELS = [
  { intervalMs: 16, scale: 0.5 }, // the canvas at half size, scaled up: the fog is soft, and that is a quarter of the pixels
  { intervalMs: 33, scale: 0.5 },
  { intervalMs: 50, scale: 0.34 },
] as const;

/** Watches the frame times and steps down, never up: a fog that changes its pace back and forth would be seen. */
export function createFrameGovernor(alpha = 0.08) {
  let level = 0;
  let average = 0;
  let frames = 0;
  return {
    get level() { return level; },
    /** One delivered frame after `dtMs`; returns the level to run at. Long gaps are a pause, not a slow frame. */
    tick(dtMs: number) {
      if (dtMs > 400) return level;
      average = frames ? average + (dtMs - average) * alpha : dtMs;
      if (++frames < 30) return level;
      if (average > FOG_LEVELS[level].intervalMs * 1.45 && level < FOG_LEVELS.length - 1) { level++; frames = 0; average = 0; }
      return level;
    },
  };
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
