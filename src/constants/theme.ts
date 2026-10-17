// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

import { TextStyle, ViewStyle } from 'react-native';

export const lightColors = {
  // Чёрно-белый fashion-минимализм: белый фон, чёрный текст и кнопки, светло-серая
  // подложка под фото вещей. Цвет в приложение приносят сами вещи и фото.
  background: '#FFFFFF',
  card: '#FFFFFF',
  surface: '#F2F2F2',
  chip: '#F2F2F2',
  accent: '#E5E5E5',
  border: '#E5E5E5',
  text: '#000000',
  muted: '#6B6B6B',
  success: '#2E7D32',
  tabActiveBg: '#F2F2F2',
  tabBarBorder: '#E5E5E5',
  toastBg: '#000000',
  toastText: '#FFFFFF',
  buttonPrimaryBg: '#000000',
  buttonPrimaryText: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.4)',
  // Legacy token names keep existing screens on the shared accent palette.
  accentGold: '#000000',
  accentGoldSoft: '#F2F2F2',
  goldHairline: 'rgba(0,0,0,0.14)',
  goldTransparent: 'rgba(255,255,255,0)',
  goldFrom: '#000000',
  goldTo: '#000000',
  textOnGold: '#FFFFFF',
  danger: '#D0021B',
  dangerSoft: '#FDECEE',
  heroFrom: '#FFFFFF',
  heroTo: '#FFFFFF',
  skeleton: '#EDEDED',
  // The light stage garment photos stand on, in both themes: black jeans vanish on a dark one.
  stage: '#F2F2F2'
};

export const darkColors: typeof lightColors = {
  background: '#000000',
  card: '#0D0D0D',
  surface: '#1A1A1A',
  chip: '#1A1A1A',
  accent: '#2A2A2A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  muted: '#A0A0A0',
  success: '#6FBF73',
  tabActiveBg: '#1A1A1A',
  tabBarBorder: '#2A2A2A',
  toastBg: '#FFFFFF',
  toastText: '#000000',
  buttonPrimaryBg: '#FFFFFF',
  buttonPrimaryText: '#000000',
  overlay: 'rgba(0,0,0,0.6)',
  accentGold: '#FFFFFF',
  accentGoldSoft: '#1A1A1A',
  goldHairline: 'rgba(255,255,255,0.18)',
  goldTransparent: 'rgba(0,0,0,0)',
  goldFrom: '#FFFFFF',
  goldTo: '#FFFFFF',
  textOnGold: '#000000',
  danger: '#FF5A5F',
  dangerSoft: '#2A1213',
  heroFrom: '#000000',
  heroTo: '#000000',
  skeleton: '#1F1F1F',
  stage: '#EDEDED'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;

// --- Дизайн-константы ---

// Гротеск для заголовков (Onest, с хорошей кириллицей), грузится в App.tsx. Начертание
// зашито в имя гарнитуры, поэтому fontWeight к ней не добавляется. Имя SERIF осталось
// от прежней антиквы, чтобы не трогать все экраны.
export const SERIF = 'Onest_700Bold';
export const SERIF_BOLD = 'Onest_800ExtraBold';
// Самое жирное начертание — для заголовков экранов: их видно сразу.
export const DISPLAY = 'Onest_900Black';

// Почти прямые углы, как у fashion-витрин: фото и кнопки — 4 px, только листы снизу скруглены сильнее.
export const RADII = { sm: 4, md: 4, lg: 4, xl: 16, pill: 999 } as const;

// Базовая шкала отступов.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Тени мягкие: карточкам едва заметная, кнопкам и плавающей панели — объём, чтобы они выделялись.
export const SHADOWS: Record<'card' | 'floating' | 'button', ViewStyle> = {
  // Витрина плоская: карточки и кнопки без теней, объём остаётся только у плавающих окон.
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  button: {
    shadowColor: '#000000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  }
};

// Типографика. Цвет задаётся на месте использования из токенов темы.
export const TYPE: Record<'display' | 'title' | 'eyebrow' | 'body' | 'caption', TextStyle> = {
  // Заголовок экрана: самый жирный гротеск, крупно.
  display: {
    fontFamily: SERIF_BOLD,
    fontSize: 26,
    letterSpacing: -0.4,
    lineHeight: 31
  },
  // Заголовок карточки/секции.
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0
  },
  // Надзаголовок: мелкий капс с разрядкой.
  eyebrow: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0
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
