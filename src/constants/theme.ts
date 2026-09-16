// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

import { Platform, TextStyle, ViewStyle } from 'react-native';

export const lightColors = {
  background: '#FAFBFA',
  card: '#FFFFFF',
  surface: '#F0F3F1',
  chip: '#EEF1EF',
  accent: '#C8DCD3',
  border: '#E2E8E4',
  text: '#202A26',
  muted: '#717E77',
  success: '#3E7A58',
  tabActiveBg: '#E3EEE8',
  tabBarBorder: '#E2E8E4',
  toastBg: '#202A26',
  toastText: '#FFFFFF',
  buttonPrimaryBg: '#254F40',
  buttonPrimaryText: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.35)',
  // Legacy token names keep existing screens on the shared accent palette.
  accentGold: '#315E4C',
  accentGoldSoft: '#E4EEE8',
  goldHairline: 'rgba(49,94,76,0.20)',
  goldTransparent: 'rgba(49,94,76,0)',
  goldFrom: '#315E4C',
  goldTo: '#315E4C',
  textOnGold: '#FFFFFF',
  danger: '#A63D2F',
  dangerSoft: '#F6E3DE',
  heroFrom: '#FAFBFA',
  heroTo: '#FAFBFA',
  skeleton: '#E4EAE6'
};

export const darkColors: typeof lightColors = {
  background: '#141917',
  card: '#1D2420',
  surface: '#242D28',
  chip: '#28312C',
  accent: '#B5D0C1',
  border: '#35423A',
  text: '#F0F5F1',
  muted: '#ABB8AF',
  success: '#5FAE83',
  tabActiveBg: '#2C4034',
  tabBarBorder: '#35423A',
  toastBg: '#EDF4EF',
  toastText: '#18251D',
  buttonPrimaryBg: '#B8D7C5',
  buttonPrimaryText: '#18251D',
  overlay: 'rgba(0,0,0,0.6)',
  accentGold: '#B8D7C5',
  accentGoldSoft: '#2C4034',
  goldHairline: 'rgba(184,215,197,0.25)',
  goldTransparent: 'rgba(184,215,197,0)',
  goldFrom: '#B8D7C5',
  goldTo: '#B8D7C5',
  textOnGold: '#18251D',
  danger: '#E08A6D',
  dangerSoft: '#3B241D',
  heroFrom: '#141917',
  heroTo: '#141917',
  skeleton: '#2D3831'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;

// --- Дизайн-константы «Ателье» ---

// Серифная гарнитура для display-заголовков (editorial-стиль).
export const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

// Скругления: sm — мелкие элементы, md — поля/плашки, lg/xl — карточки.
export const RADII = { sm: 6, md: 8, lg: 8, xl: 8 } as const;

// Базовая шкала отступов.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Пресеты теней. card — карточки, floating — CTA-кнопки/плавающие элементы.
// Тёплый коричневый shadowColor даёт мягкую «бумажную» тень вместо серой.
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
  // Крупный серифный заголовок экрана.
  display: {
    fontFamily: SERIF,
    fontSize: 34,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 42
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
