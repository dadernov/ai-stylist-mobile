// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

import { Platform, TextStyle, ViewStyle } from 'react-native';

export const lightColors = {
  background: '#F6F5F2',
  card: '#FFFFFF',
  surface: '#F3EFE8',
  chip: '#EFEAE1',
  accent: '#D8CBB8',
  border: '#ECE7DD',
  text: '#1F1D1A',
  muted: '#6E6A63',
  success: '#3E7A58',
  tabActiveBg: '#EDE8DD',
  tabBarBorder: '#E9E5DC',
  toastBg: '#1E1C19',
  toastText: '#FFFFFF',
  buttonPrimaryBg: '#1F1D1A',
  buttonPrimaryText: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.35)',
  // --- Ателье: шампань-бронза и editorial-акценты ---
  accentGold: '#9C7A4A',
  accentGoldSoft: '#F0E6D6',
  goldHairline: 'rgba(156,122,74,0.35)',
  goldTransparent: 'rgba(156,122,74,0)',
  goldFrom: '#AA8654',
  goldTo: '#8E6C3F',
  textOnGold: '#FFFFFF',
  danger: '#A63D2F',
  dangerSoft: '#F6E3DE',
  heroFrom: '#F6F5F2',
  heroTo: '#F1E7D8',
  skeleton: '#ECE5D9'
};

export const darkColors: typeof lightColors = {
  background: '#141310',
  card: '#1E1B16',
  surface: '#26221B',
  chip: '#2A261E',
  accent: '#D8CBB8',
  border: '#322D24',
  text: '#F3F0E9',
  muted: '#A39E92',
  success: '#5FAE83',
  tabActiveBg: '#2E2920',
  tabBarBorder: '#2A261E',
  toastBg: '#EDE8DD',
  toastText: '#1E1C19',
  buttonPrimaryBg: '#EDE7DB',
  buttonPrimaryText: '#15130F',
  overlay: 'rgba(0,0,0,0.6)',
  // --- Ателье: шампань-бронза и editorial-акценты ---
  accentGold: '#C9A96E',
  accentGoldSoft: '#3A3226',
  goldHairline: 'rgba(201,169,110,0.4)',
  goldTransparent: 'rgba(201,169,110,0)',
  goldFrom: '#D3B47C',
  goldTo: '#B8945A',
  textOnGold: '#241A0E',
  danger: '#E08A6D',
  dangerSoft: '#3B241D',
  heroFrom: '#141310',
  heroTo: '#1D1811',
  skeleton: '#2C2820'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;

// --- Дизайн-константы «Ателье» ---

// Серифная гарнитура для display-заголовков (editorial-стиль).
export const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

// Скругления: sm — мелкие элементы, md — поля/плашки, lg/xl — карточки.
export const RADII = { sm: 10, md: 14, lg: 20, xl: 24 } as const;

// Базовая шкала отступов.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Пресеты теней. card — карточки, floating — CTA-кнопки/плавающие элементы.
// Тёплый коричневый shadowColor даёт мягкую «бумажную» тень вместо серой.
export const SHADOWS: Record<'card' | 'floating', ViewStyle> = {
  card: {
    shadowColor: '#4A3B28',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  floating: {
    shadowColor: '#4A3B28',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  }
};

// Типографика. Цвет задаётся на месте использования из токенов темы.
export const TYPE: Record<'display' | 'title' | 'eyebrow' | 'body' | 'caption', TextStyle> = {
  // Крупный серифный заголовок экрана.
  display: {
    fontFamily: SERIF,
    fontSize: 33,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 38
  },
  // Заголовок карточки/секции.
  title: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2
  },
  // Надзаголовок КАПСОМ (обычно цветом accentGold).
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.5,
    textTransform: 'uppercase'
  },
  body: {
    fontSize: 15,
    lineHeight: 22
  },
  caption: {
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0.1
  }
};
