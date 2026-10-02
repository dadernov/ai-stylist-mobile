// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

import { TextStyle, ViewStyle } from 'react-native';

export const lightColors = {
  // Тёплый минимализм: льняной фон, сливочные карточки, эспрессо для текста
  // и главных кнопок, терракота — единственный акцент.
  background: '#F5F0E8',
  card: '#FFFCF7',
  surface: '#ECE4D8',
  chip: '#EFE8DD',
  accent: '#E8CDB6',
  border: '#E5DBCD',
  text: '#2A2320',
  muted: '#6E6155',
  success: '#4A7350',
  tabActiveBg: '#EDE1D3',
  tabBarBorder: '#E5DBCD',
  toastBg: '#2A2320',
  toastText: '#FFF9F2',
  buttonPrimaryBg: '#2A2320',
  buttonPrimaryText: '#FFF9F2',
  overlay: 'rgba(42,35,32,0.38)',
  // Legacy token names keep existing screens on the shared accent palette.
  accentGold: '#984C29',
  accentGoldSoft: '#F2E2D4',
  goldHairline: 'rgba(152,76,41,0.22)',
  goldTransparent: 'rgba(152,76,41,0)',
  goldFrom: '#984C29',
  goldTo: '#984C29',
  textOnGold: '#FFF9F2',
  danger: '#A8402F',
  dangerSoft: '#F6E1D8',
  heroFrom: '#F5F0E8',
  heroTo: '#F5F0E8',
  skeleton: '#E9E0D3',
  // The light stage garment photos stand on, in both themes: black jeans vanish on a dark one.
  stage: '#EFE8DD'
};

export const darkColors: typeof lightColors = {
  // Тёплый уголь вместо холодного чёрного.
  background: '#161311',
  card: '#201C19',
  surface: '#2A2521',
  chip: '#2C2723',
  accent: '#5A3E2E',
  border: '#3A332D',
  text: '#F3ECE3',
  muted: '#A99B8D',
  success: '#8FB892',
  tabActiveBg: '#3B2C23',
  tabBarBorder: '#3A332D',
  toastBg: '#F1E6D9',
  toastText: '#201C19',
  buttonPrimaryBg: '#F1E6D9',
  buttonPrimaryText: '#201C19',
  overlay: 'rgba(0,0,0,0.6)',
  accentGold: '#E3A47F',
  accentGoldSoft: '#3B2C23',
  goldHairline: 'rgba(227,164,127,0.26)',
  goldTransparent: 'rgba(227,164,127,0)',
  goldFrom: '#E3A47F',
  goldTo: '#E3A47F',
  textOnGold: '#201C19',
  danger: '#E5917C',
  dangerSoft: '#3D2620',
  heroFrom: '#161311',
  heroTo: '#161311',
  skeleton: '#2C2622',
  stage: '#E4DACC'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;

// --- Дизайн-константы ---

// Антиква для крупных заголовков: модный журнал, а не панель управления. Начертание
// зашито в имя гарнитуры, поэтому fontWeight к ней не добавляется. Грузится в App.tsx.
export const SERIF = 'CormorantGaramond_600SemiBold';
export const SERIF_BOLD = 'CormorantGaramond_700Bold';

// Скругления: sm — мелкие элементы, md — поля и плашки, lg — карточки, xl — листы и крупные карточки.
export const RADII = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

// Базовая шкала отступов.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Тени тёплого оттенка и мягкие: глубина без грязи.
export const SHADOWS: Record<'card' | 'floating', ViewStyle> = {
  card: {
    shadowColor: '#3B2A1E',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1
  },
  floating: {
    shadowColor: '#3B2A1E',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  }
};

// Типографика. Цвет задаётся на месте использования из токенов темы.
export const TYPE: Record<'display' | 'title' | 'eyebrow' | 'body' | 'caption', TextStyle> = {
  // Заголовок экрана.
  display: {
    fontFamily: SERIF,
    fontSize: 38,
    letterSpacing: -0.3,
    lineHeight: 42
  },
  // Заголовок карточки/секции.
  title: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.1
  },
  // Надзаголовок КАПСОМ с разрядкой (обычно цветом accentGold).
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
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
