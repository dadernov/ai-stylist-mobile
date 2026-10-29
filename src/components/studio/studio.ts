import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, TextStyle } from 'react-native';
import { WardrobeItem } from '../../data/mock';
import { darkColors } from '../../constants/theme';

/** «Студия»: Manrope at the weights the screens use, by family name (custom fonts ignore fontWeight). */
export const MANROPE = { regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold' };
export const font = (weight: keyof typeof MANROPE = 'regular'): TextStyle => ({ fontFamily: MANROPE[weight] });

export const INK = '#121417';
export const INK_SOFT = '#6E737B';
export const INK_FAINT = '#9A9EA4';
/** Ink on the dark studio and dark sheets. */
export const INK_ON_DARK = '#F4F5F7';
/** Secondary text that stays legible on whichever studio it sits on (INK_SOFT is too dark on the night one). */
export const inkSoft = (isDark: boolean) => (isDark ? darkColors.muted : INK_SOFT);
/** Glass without the blur: its tint and light edge, for many small surfaces at once (a blur each is costly). */
export const glassFill = (isDark: boolean) => (isDark ? 'rgba(40,43,48,0.55)' : 'rgba(255,255,255,0.55)');
export const glassEdge = (isDark: boolean) => (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)');
/** The near-opaque fill of sheets, dialogs and floating cards that carry text. */
export const sheetFill = (isDark: boolean) => (isDark ? 'rgba(24,26,30,0.97)' : 'rgba(250,250,249,0.97)');
/** The dim laid over the screen behind a modal (the blur alone does not dim on Android). */
export const backdropDim = (isDark: boolean) => (isDark ? 'rgba(0,0,0,0.45)' : 'rgba(18,20,23,0.28)');
/** The hairline between rows on a glass panel or a sheet. */
export const hairline = (isDark: boolean) => (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');

// The key light takes a pale version of the piece's colour: by its stored hex when the profile has one,
// else by its colour name.
const NAMED: Record<string, string> = {
  Белый: '#E6E9EE', Молочный: '#ECE7DB', Черный: '#C9CDD6', Чёрный: '#C9CDD6', Серый: '#D9D9D5', Бежевый: '#E5D9C5',
  Синий: '#C3D3EA', 'Синий деним': '#C3D3EA', Голубой: '#CFE0F0', Зеленый: '#BFDCCF', Зелёный: '#BFDCCF', Оливковый: '#D6DABF',
  Хаки: '#D6D8C2', Красный: '#F0C9C6', Розовый: '#F2D3DD', Бордовый: '#E6C4CC', Коричневый: '#E2D2C3', Желтый: '#F3E4B5',
  Жёлтый: '#F3E4B5', Оранжевый: '#F5D6BC', Фиолетовый: '#DCD0EC', Лавандовый: '#E2DAF0'
};

const mixWithWhite = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount) + 255 * amount);
  return `#${[16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('')}`;
};

export function studioTint(item?: Pick<WardrobeItem, 'color' | 'profile'> | null) {
  if (!item) return null;
  const hex = item.profile?.hex;
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return mixWithWhite(hex, 0.62);
  if (/^#[0-9a-f]{6}$/i.test(item.color)) return mixWithWhite(item.color, 0.62);
  return NAMED[item.color] || null;
}

/** A cut-out garment (PNG with a transparent background) floats on its own; a photo with a ground is shown as a print. */
export const isCutout = (uri?: string) => Boolean(uri && (/^data:image\/png/i.test(uri) || /\.png(\?|$)/i.test(uri)));

// One shared reduce-motion subscription for the whole app (AppPressable alone mounts hundreds of callers).
let reducedMotion = false;
const motionListeners = new Set<() => void>();
let motionSubscribed = false;
const setReducedMotion = (value: boolean) => {
  if (value === reducedMotion) return;
  reducedMotion = value;
  motionListeners.forEach(listener => listener());
};
function subscribeReducedMotion(listener: () => void) {
  motionListeners.add(listener);
  if (!motionSubscribed) {
    motionSubscribed = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReducedMotion).catch(() => {});
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReducedMotion);
  }
  return () => { motionListeners.delete(listener); };
}
const getReducedMotion = () => reducedMotion;

/** Whether the person asked the system to cut motion down: floating and automatic effects stay still then. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getReducedMotion);
}
