import { useEffect, useState } from 'react';
import { AccessibilityInfo, TextStyle } from 'react-native';
import { WardrobeItem } from '../../data/mock';

/** «Студия»: Manrope at the weights the screens use, by family name (custom fonts ignore fontWeight). */
export const MANROPE = { regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold' };
export const font = (weight: keyof typeof MANROPE = 'regular'): TextStyle => ({ fontFamily: MANROPE[weight] });

export const INK = '#121417';
export const INK_SOFT = '#6E737B';
export const INK_FAINT = '#9A9EA4';

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

/** Whether the person asked the system to cut motion down: floating and automatic effects stay still then. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return reduced;
}
