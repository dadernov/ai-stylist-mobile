// Светлая и тёмная палитры. Ключи в обеих палитрах ОБЯЗАНЫ совпадать.
// Тематизируем только структурные поверхности (фон/карточки/текст/границы/таб-бар/тосты).
// Семантические акценты (цвета вещей, статусы, предупреждения) остаются как есть в компонентах.

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
  overlay: 'rgba(0,0,0,0.35)'
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
  overlay: 'rgba(0,0,0,0.6)'
};

export type ThemeColors = typeof lightColors;

// Обратная совместимость: статичный импорт COLORS остаётся валидным (светлая палитра).
export const COLORS = lightColors;
