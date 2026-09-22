// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

import { Platform, TextStyle, ViewStyle } from 'react-native';

export const lightColors = {
  background: '#F7F8FA',
  card: '#FFFFFF',
  surface: '#ECEEF2',
  chip: '#ECEEF2',
  accent: '#DDEA9C',
  border: '#DFE2E7',
  text: '#191B20',
  muted: '#686D78',
  success: '#3E7A58',
  tabActiveBg: '#E8F0CA',
  tabBarBorder: '#DFE2E7',
  toastBg: '#191B20',
  toastText: '#FFFFFF',
  buttonPrimaryBg: '#202329',
  buttonPrimaryText: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.35)',
  // Legacy token names keep existing screens on the shared accent palette.
  accentGold: '#506A20',
  accentGoldSoft: '#E8F0CA',
  goldHairline: 'rgba(80,106,32,0.20)',
  goldTransparent: 'rgba(80,106,32,0)',
  goldFrom: '#506A20',
  goldTo: '#506A20',
  textOnGold: '#FFFFFF',
  danger: '#A63D2F',
  dangerSoft: '#F6E3DE',
  heroFrom: '#F7F8FA',
  heroTo: '#F7F8FA',
  skeleton: '#E4E7EB'
};

export const darkColors: typeof lightColors = {
  background: '#121316',
  card: '#1C1E23',
  surface: '#26292F',
  chip: '#292C33',
  accent: '#DDEA9C',
  border: '#353942',
  text: '#F5F6F8',
  muted: '#A5AAB5',
  success: '#5FAE83',
  tabActiveBg: '#343D25',
  tabBarBorder: '#353942',
  toastBg: '#EDF4EF',
  toastText: '#18251D',
  buttonPrimaryBg: '#DDEA9C',
  buttonPrimaryText: '#1B2113',
  overlay: 'rgba(0,0,0,0.6)',
  accentGold: '#DDEA9C',
  accentGoldSoft: '#343D25',
  goldHairline: 'rgba(221,234,156,0.25)',
  goldTransparent: 'rgba(221,234,156,0)',
  goldFrom: '#DDEA9C',
  goldTo: '#DDEA9C',
  textOnGold: '#18251D',
  danger: '#E08A6D',
  dangerSoft: '#3B241D',
  heroFrom: '#121316',
  heroTo: '#121316',
  skeleton: '#30343B'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;

// --- Дизайн-константы «Ателье» ---

// Legacy name, shared system sans-serif for all headings.
export const SERIF = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' });

// Скругления: sm — мелкие элементы, md — поля/плашки, lg/xl — карточки.
export const RADII = { sm: 6, md: 8, lg: 8, xl: 8 } as const;

// Базовая шкала отступов.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Пресеты теней. card — карточки, floating — CTA-кнопки/плавающие элементы.
export const SHADOWS: Record<'card' | 'floating', ViewStyle> = {
  card: {
    shadowColor: '#152B20',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  floating: {
    shadowColor: '#152B20',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4
  }
};

// Типографика. Цвет задаётся на месте использования из токенов темы.
export const TYPE: Record<'display' | 'title' | 'eyebrow' | 'body' | 'caption', TextStyle> = {
  // Заголовок экрана.
  display: {
    fontFamily: SERIF,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 38
  },
  // Заголовок карточки/секции.
  title: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0
  },
  // Надзаголовок КАПСОМ (обычно цветом accentGold).
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  body: {
    fontSize: 15,
    lineHeight: 22
  },
  caption: {
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0
  }
};
