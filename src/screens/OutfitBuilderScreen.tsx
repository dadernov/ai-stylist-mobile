import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { ScreenTitle } from '../components/ScreenTitle';
import { Chip } from '../components/Chip';
import { LookPreview } from '../components/LookPreview';
import { AiTryOnPreview } from '../components/AiTryOnPreview';
import { AppPressable } from '../components/AppPressable';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT, translate } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';
import { TryOnQualityMode, TuckMode } from '../services/ai';

const stylePresets = ['Кэжуал', 'Спорт-шик', 'Романтичный', 'Бохо', 'Минимализм', 'Офисный'];
const events = ['Свидание', 'Прогулка', 'Совещание', 'Вечеринка', 'Спортзал'];

type OutfitBuilderProps = {
  items: WardrobeItem[];
  modelUri?: string;
  savedLooks: SavedLook[];
  onSavedLooksChange: (looks: SavedLook[]) => void;
  onLooksGenerated: (looks: GeneratedLook[], context: { style: string; event: string; weather: string }) => void;
  onFavoriteAdd: (look: GeneratedLook) => void;
};

const colorGroups: Record<string, 'neutral' | 'warm' | 'cool'> = {
  Белый: 'neutral',
  Молочный: 'neutral',
  Кремовый: 'neutral',
  Бежевый: 'neutral',
  Песочный: 'neutral',
  Карамельный: 'neutral',
  Коричневый: 'neutral',
  Черный: 'neutral',
  Графит: 'neutral',
  Серый: 'neutral',
  Серебристый: 'neutral',
  Синий: 'cool',
  'Синий деним': 'cool',
  Голубой: 'cool',
  Бирюзовый: 'cool',
  Зеленый: 'cool',
  Оливковый: 'cool',
  Хаки: 'cool',
  Желтый: 'warm',
  Горчичный: 'warm',
  Оранжевый: 'warm',
  Красный: 'warm',
  Бордовый: 'warm',
  Розовый: 'warm',
  Пудровый: 'warm',
  Фиолетовый: 'cool',
  Лавандовый: 'cool'
};

const patternPreferences: Record<string, string[]> = {
  Минимализм: ['Однотонный'],
  Офисный: ['Однотонный', 'Полоска'],
  Романтичный: ['Цветочный', 'Горох'],
  Бохо: ['Цветочный', 'Клетка'],
  'Спорт-шик': ['Однотонный', 'Полоска'],
  Кэжуал: ['Однотонный', 'Клетка']
};

type PaletteGroup = 'neutral' | 'warm' | 'cool';

type LookPreferenceProfile = {
  preferredCategories?: string[];
  avoidedCategories?: string[];
  preferredPatterns?: string[];
  avoidedPatterns?: string[];
  preferredColorGroups?: PaletteGroup[];
  requiredSections?: string[];
  discouragedSections?: string[];
};

const mergeTryOnHistory = (nextItem: TryOnHistoryItem, history: TryOnHistoryItem[] = []) => {
  const nextKey = nextItem.id || `${nextItem.updatedAt}-${nextItem.tuckMode || 'auto'}-${nextItem.qualityMode || 'quality'}`;
  return [
    nextItem,
    ...history.filter((item) => {
      const itemKey = item.id || `${item.updatedAt}-${item.tuckMode || 'auto'}-${item.qualityMode || 'quality'}`;
      return itemKey !== nextKey && item.imageUri !== nextItem.imageUri;
    })
  ].slice(0, 8);
};

const styleProfiles: Record<string, LookPreferenceProfile> = {
  Кэжуал: {
    preferredCategories: ['Футболка', 'Лонгслив', 'Рубашка', 'Джинсы', 'Брюки', 'Кеды', 'Кроссовки', 'Лоферы'],
    preferredPatterns: ['Однотонный', 'Клетка', 'Полоска'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  'Спорт-шик': {
    preferredCategories: ['Футболка', 'Майка', 'Топ', 'Худи', 'Свитшот', 'Джоггеры', 'Леггинсы', 'Шорты', 'Кроссовки', 'Кеды', 'Бомбер'],
    avoidedCategories: ['Туфли', 'Балетки', 'Пальто'],
    preferredPatterns: ['Однотонный', 'Полоска'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь'],
    discouragedSections: ['Сумки']
  },
  Романтичный: {
    preferredCategories: ['Блуза', 'Топ', 'Юбка', 'Платье', 'Сарафан', 'Кардиган', 'Туфли', 'Балетки', 'Сандалии'],
    preferredPatterns: ['Цветочный', 'Горох', 'Однотонный'],
    preferredColorGroups: ['warm', 'neutral'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Бохо: {
    preferredCategories: ['Кардиган', 'Платье', 'Сарафан', 'Юбка', 'Шорты', 'Ботинки', 'Сандалии', 'Сумка'],
    preferredPatterns: ['Цветочный', 'Клетка'],
    preferredColorGroups: ['warm', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Минимализм: {
    preferredCategories: ['Футболка', 'Рубашка', 'Брюки', 'Юбка', 'Пиджак', 'Пальто', 'Лоферы', 'Туфли'],
    preferredPatterns: ['Однотонный'],
    avoidedPatterns: ['Цветочный', 'Горох'],
    preferredColorGroups: ['neutral'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Офисный: {
    preferredCategories: ['Рубашка', 'Блуза', 'Брюки', 'Юбка', 'Пиджак', 'Пальто', 'Лоферы', 'Туфли', 'Ботинки'],
    avoidedCategories: ['Шорты', 'Леггинсы', 'Худи', 'Свитшот', 'Майка'],
    preferredPatterns: ['Однотонный', 'Полоска'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  }
};

const eventProfiles: Record<string, LookPreferenceProfile> = {
  Свидание: {
    preferredCategories: ['Блуза', 'Топ', 'Юбка', 'Платье', 'Сарафан', 'Туфли', 'Балетки', 'Лоферы'],
    preferredPatterns: ['Однотонный', 'Цветочный'],
    preferredColorGroups: ['warm', 'neutral'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Прогулка: {
    preferredCategories: ['Футболка', 'Лонгслив', 'Рубашка', 'Джинсы', 'Шорты', 'Кеды', 'Кроссовки', 'Бомбер'],
    preferredPatterns: ['Однотонный', 'Клетка', 'Полоска'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Совещание: {
    preferredCategories: ['Рубашка', 'Блуза', 'Брюки', 'Юбка', 'Пиджак', 'Пальто', 'Лоферы', 'Туфли', 'Ботинки'],
    avoidedCategories: ['Шорты', 'Леггинсы', 'Худи', 'Свитшот', 'Кроссовки'],
    preferredPatterns: ['Однотонный', 'Полоска'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Вечеринка: {
    preferredCategories: ['Топ', 'Блуза', 'Платье', 'Юбка', 'Пиджак', 'Туфли', 'Сапоги', 'Балетки'],
    avoidedCategories: ['Джоггеры', 'Леггинсы'],
    preferredPatterns: ['Однотонный', 'Горох'],
    preferredColorGroups: ['warm', 'neutral'],
    requiredSections: ['Верх', 'Низ', 'Обувь']
  },
  Спортзал: {
    preferredCategories: ['Майка', 'Футболка', 'Топ', 'Леггинсы', 'Джоггеры', 'Шорты', 'Кроссовки', 'Кеды'],
    avoidedCategories: ['Пиджак', 'Пальто', 'Юбка', 'Туфли', 'Лоферы'],
    preferredPatterns: ['Однотонный'],
    preferredColorGroups: ['neutral', 'cool'],
    requiredSections: ['Верх', 'Низ', 'Обувь'],
    discouragedSections: ['Верхняя одежда', 'Сумки']
  }
};

const beautyMap: Record<string, { makeup: string; hair: string }> = {
  Совещание: {
    makeup: 'Nude-тон, мягкая подводка и аккуратные брови.',
    hair: 'Низкий хвост или гладкий пучок.'
  },
  Вечеринка: {
    makeup: 'Smoky eyes или сияющие тени, акцент на губы.',
    hair: 'Объемные локоны или высокий хвост.'
  },
  Свидание: {
    makeup: 'Мягкий румянец и сияние, легкий акцент на губы.',
    hair: 'Распущенные локоны или полупучок.'
  },
  Прогулка: {
    makeup: 'Легкий BB/CC тон, бальзам и тушь.',
    hair: 'Свободные волны или коса.'
  },
  Спортзал: {
    makeup: 'Минимум: SPF и прозрачный бальзам.',
    hair: 'Высокий хвост или пучок.'
  }
};

const weatherCodeMap: Record<number, string> = {
  0: 'ясно',
  1: 'переменная облачность',
  2: 'облачно',
  3: 'пасмурно',
  45: 'туман',
  48: 'изморозь',
  51: 'морось',
  61: 'дождь',
  71: 'снег',
  80: 'ливень',
  95: 'гроза'
};

const getColorGroup = (color: string) => colorGroups[color] || 'neutral';

const scoreColors = (colors: string[]) => {
  const groups = new Set(colors.map(getColorGroup));
  if (groups.size === 1) return 2;
  if (groups.has('neutral')) return 1;
  return -1;
};

const seasonScore = (item: WardrobeItem, temp: number | null) => {
  if (temp === null) return 0;
  if (item.season === 'Круглый год') return 1;
  if (temp <= 5 && item.season === 'Зима') return 2;
  if (temp <= 5 && item.season === 'Демисезон') return 1;
  if (temp >= 18 && item.season === 'Лето') return 2;
  if (temp >= 18 && item.season === 'Демисезон') return 1;
  if (temp >= 18 && item.season === 'Зима') return -2;
  if (temp <= 5 && item.season === 'Лето') return -2;
  return 0;
};

// Решение о слоях. Верхняя одежда нужна только когда реально прохладно/холодно.
// В тепле куртка/пальто — лишний слой, поэтому образ без верхней одежды должен
// выигрывать. Это убирает поведение «всегда максимум слоёв».
const layeringScore = (selection: WardrobeItem[], temp: number | null) => {
  const hasOuter = selection.some((item) => item.section === 'Верхняя одежда');
  if (temp === null) {
    // Погода неизвестна — не навязываем верхнюю одежду.
    return hasOuter ? -3 : 1;
  }
  if (temp >= 20) return hasOuter ? -18 : 5; // жарко: верхняя одежда не нужна
  if (temp >= 14) return hasOuter ? -10 : 4; // тепло: обычно без куртки
  if (temp >= 8) return hasOuter ? 0 : 2; // прохладно: куртка по желанию, без неё ок
  if (temp >= 2) return hasOuter ? 6 : -4; // холодно: лучше с верхней одеждой
  return hasOuter ? 12 : -12; // мороз: верхняя одежда обязательна
};

// Тяжёлая верхняя одежда (пуховик/пальто/шуба) в относительно тёплую погоду
// выглядит неуместно — отдельно штрафуем, чтобы не предлагать пуховик в +10.
const heavyOuterCategories = new Set(['Пуховик', 'Шуба', 'Парка', 'Пальто']);
const outerWeightScore = (selection: WardrobeItem[], temp: number | null) => {
  if (temp === null) return 0;
  const heavy = selection.some(
    (item) => item.section === 'Верхняя одежда' && heavyOuterCategories.has(item.category)
  );
  if (!heavy) return 0;
  if (temp >= 12) return -10;
  if (temp >= 6) return -4;
  return 4;
};

const onePieceCategories = new Set(['Платье', 'Сарафан', 'Комбинезон']);

const strictEventDisallowedCategories: Record<string, string[]> = {
  Совещание: ['Шорты', 'Леггинсы', 'Худи', 'Свитшот', 'Майка'],
  Спортзал: ['Пиджак', 'Пальто', 'Туфли', 'Лоферы', 'Сапоги', 'Юбка'],
  Вечеринка: ['Джоггеры'],
  Свидание: [],
  Прогулка: []
};

const strictStyleDisallowedPatterns: Record<string, string[]> = {
  Минимализм: ['Цветочный', 'Горох']
};

const alwaysUntuckedCategories = new Set([
  'Худи',
  'Свитшот',
  'Свитер',
  'Кардиган',
  'Пиджак',
  'Бомбер',
  'Куртка',
  'Пальто',
  'Тренч',
  'Плащ',
  'Пуховик',
  'Парка'
]);

const isIn = (value: string, list?: string[]) => Boolean(list?.includes(value));

const hasOnePiece = (items: WardrobeItem[]) => items.some((item) => onePieceCategories.has(item.category));

const sectionSatisfied = (items: WardrobeItem[], section: string) => {
  if (section === 'Верх') {
    return items.some((item) => item.section === 'Верх' || item.section === 'Верхняя одежда');
  }
  if (section === 'Низ' && hasOnePiece(items)) return true;
  return items.some((item) => item.section === section);
};

const scoreItemByProfile = (item: WardrobeItem, profile?: LookPreferenceProfile) => {
  if (!profile) return 0;
  let score = 0;
  if (isIn(item.category, profile.preferredCategories)) score += 6;
  if (isIn(item.category, profile.avoidedCategories)) score -= 10;
  if (isIn(item.pattern, profile.preferredPatterns)) score += 3;
  if (isIn(item.pattern, profile.avoidedPatterns)) score -= 5;
  if (profile.preferredColorGroups?.length) {
    score += profile.preferredColorGroups.includes(getColorGroup(item.color) as PaletteGroup) ? 2 : -2;
  }
  if (item.imageUri) score += 1;
  return score;
};

const scoreSectionExpectations = (
  selection: WardrobeItem[],
  profile: LookPreferenceProfile | undefined,
  wardrobe: WardrobeItem[]
) => {
  if (!profile) return 0;
  const wardrobeHasSection = (section: string) => {
    if (section === 'Верх') {
      return wardrobe.some((item) => item.section === 'Верх' || item.section === 'Верхняя одежда');
    }
    if (section === 'Низ') {
      return wardrobe.some((item) => item.section === 'Низ') || wardrobe.some((item) => onePieceCategories.has(item.category));
    }
    return wardrobe.some((item) => item.section === section);
  };

  let score = 0;
  (profile.requiredSections || []).forEach((section) => {
    if (!wardrobeHasSection(section)) return;
    score += sectionSatisfied(selection, section) ? 6 : -12;
  });
  (profile.discouragedSections || []).forEach((section) => {
    if (sectionSatisfied(selection, section)) score -= 4;
  });
  return score;
};

const styleScore = (selection: WardrobeItem[], style: string, wardrobe: WardrobeItem[]) => {
  const profile = styleProfiles[style];
  const preferred = patternPreferences[style] || [];
  let score = selection.reduce((sum, item) => sum + scoreItemByProfile(item, profile), 0);
  score += scoreSectionExpectations(selection, profile, wardrobe);
  selection.forEach((item) => {
    if (preferred.includes(item.pattern)) score += 2;
    if (style === 'Минимализм' && getColorGroup(item.color) === 'neutral') score += 2;
    if (style === 'Романтичный' && ['Розовый', 'Пудровый', 'Лавандовый'].includes(item.color)) score += 2;
    if (style === 'Бохо' && ['Оливковый', 'Коричневый', 'Бежевый'].includes(item.color)) score += 2;
  });
  return score;
};

const eventScore = (selection: WardrobeItem[], event: string, wardrobe: WardrobeItem[]) => {
  const profile = eventProfiles[event];
  let score = selection.reduce((sum, item) => sum + scoreItemByProfile(item, profile), 0);
  score += scoreSectionExpectations(selection, profile, wardrobe);
  if (event === 'Совещание' && selection.some((item) => item.pattern === 'Цветочный')) score -= 4;
  if (event === 'Вечеринка' && selection.some((item) => getColorGroup(item.color) === 'warm')) score += 3;
  if (event === 'Спортзал' && selection.some((item) => ['Пальто', 'Юбка'].includes(item.category))) score -= 5;
  return score;
};

const scoreCompleteness = (selection: WardrobeItem[], wardrobe: WardrobeItem[]) => {
  const wardrobeHasTop = wardrobe.some((item) => item.section === 'Верх' || item.section === 'Верхняя одежда');
  const wardrobeHasBottom = wardrobe.some((item) => item.section === 'Низ') || wardrobe.some((item) => onePieceCategories.has(item.category));
  const wardrobeHasShoes = wardrobe.some((item) => item.section === 'Обувь');

  const hasTop = sectionSatisfied(selection, 'Верх');
  const hasBottom = sectionSatisfied(selection, 'Низ');
  const hasShoes = sectionSatisfied(selection, 'Обувь');

  let score = 0;
  if (wardrobeHasTop) score += hasTop ? 5 : -14;
  if (wardrobeHasBottom) score += hasBottom ? 5 : -14;
  if (wardrobeHasShoes) score += hasShoes ? 4 : -10;
  return score;
};

const evaluateStrictRules = (selection: WardrobeItem[], style: string, event: string, wardrobe: WardrobeItem[]) => {
  const wardrobeHasTop = wardrobe.some((item) => item.section === 'Верх' || item.section === 'Верхняя одежда');
  const wardrobeHasBottom = wardrobe.some((item) => item.section === 'Низ') || wardrobe.some((item) => onePieceCategories.has(item.category));
  const wardrobeHasShoes = wardrobe.some((item) => item.section === 'Обувь');

  const hasTop = sectionSatisfied(selection, 'Верх');
  const hasBottom = sectionSatisfied(selection, 'Низ');
  const hasShoes = sectionSatisfied(selection, 'Обувь');

  if (wardrobeHasTop && !hasTop) return false;
  if (wardrobeHasBottom && !hasBottom) return false;
  if (wardrobeHasShoes && !hasShoes) return false;

  const strictDisallowedCategories = new Set([
    ...(strictEventDisallowedCategories[event] || []),
    ...((eventProfiles[event]?.avoidedCategories || []).slice(0, 5))
  ]);
  if (selection.some((item) => strictDisallowedCategories.has(item.category))) return false;

  const strictDisallowedPatterns = new Set(strictStyleDisallowedPatterns[style] || []);
  if (selection.some((item) => strictDisallowedPatterns.has(item.pattern))) return false;

  return true;
};

const resolveTuckDecision = (selection: WardrobeItem[], style: string, event: string) => {
  const top = selection.find((item) => item.section === 'Верх');
  if (!top || !sectionSatisfied(selection, 'Низ') || onePieceCategories.has(top.category)) {
    return { mode: 'auto' as TuckMode, tip: null as string | null };
  }

  if (alwaysUntuckedCategories.has(top.category)) {
    return {
      mode: 'untucked' as TuckMode,
      tip: translate('Этот верх лучше носить навыпуск: так силуэт выглядит естественнее.')
    };
  }

  let tuckScore = 0;
  if (['Рубашка', 'Блуза'].includes(top.category)) tuckScore += 2;
  if (top.category === 'Поло') tuckScore += 1;
  if (['Офисный', 'Минимализм'].includes(style)) tuckScore += 2;
  if (style === 'Романтичный') tuckScore += 1;
  if (['Кэжуал', 'Бохо'].includes(style)) tuckScore -= 1;
  if (style === 'Спорт-шик') tuckScore -= 2;
  if (event === 'Совещание') tuckScore += 2;
  if (['Свидание', 'Вечеринка'].includes(event)) tuckScore += 1;
  if (event === 'Прогулка') tuckScore -= 1;
  if (event === 'Спортзал') tuckScore -= 3;

  if (tuckScore >= 4) {
    return {
      mode: 'tucked' as TuckMode,
      tip: translate('Лучше заправить верх полностью: образ будет собраннее и аккуратнее.')
    };
  }
  if (tuckScore >= 2) {
    return {
      mode: 'tucked' as TuckMode,
      tip: translate('Оптимально сделать частичную заправку спереди — баланс строгости и расслабленности.')
    };
  }
  if (tuckScore <= -2) {
    return {
      mode: 'untucked' as TuckMode,
      tip: translate('Лучше оставить верх навыпуск: так лук выглядит живее и комфортнее.')
    };
  }
  return {
    mode: 'auto' as TuckMode,
    tip: translate('Можно носить и заправленным, и навыпуск: выбери по настроению дня.')
  };
};

const buildFitReasons = (
  selection: WardrobeItem[],
  style: string,
  event: string,
  temp: number | null,
  wardrobe: WardrobeItem[],
  totalScore: number
) => {
  const styleProfile = styleProfiles[style];
  const eventProfile = eventProfiles[event];
  const top = sectionSatisfied(selection, 'Верх');
  const bottom = sectionSatisfied(selection, 'Низ');
  const shoes = sectionSatisfied(selection, 'Обувь');

  const reasons: string[] = [];

  if (top && bottom && shoes) {
    reasons.push(translate('Полный комплект: верх, низ и обувь в одном образе.'));
  }

  const tuckTip = resolveTuckDecision(selection, style, event).tip;
  if (tuckTip) reasons.push(tuckTip);

  const preferredMatches = selection.filter(
    (item) =>
      isIn(item.category, styleProfile?.preferredCategories) || isIn(item.category, eventProfile?.preferredCategories)
  ).length;
  if (preferredMatches > 0) {
    const noun = preferredMatches === 1 ? 'вещь' : preferredMatches < 5 ? 'вещи' : 'вещей';
    reasons.push(
      translate('{count} {noun} попадает в приоритеты «{style}» и «{event}».', {
        count: preferredMatches,
        noun,
        style: translate(style),
        event: translate(event)
      })
    );
  }

  const avoidedMatches = selection.filter(
    (item) =>
      isIn(item.category, styleProfile?.avoidedCategories) || isIn(item.category, eventProfile?.avoidedCategories)
  ).length;
  if (avoidedMatches === 0) {
    reasons.push(translate('Нет конфликтующих категорий для выбранного события.'));
  }

  const seasonTotal = selection.reduce((sum, item) => sum + seasonScore(item, temp), 0);
  if (typeof temp === 'number') {
    if (seasonTotal >= 2) reasons.push(translate('Сезонность подходит под текущую погоду ({temp}°C).', { temp }));
    if (seasonTotal <= -2) reasons.push(translate('Сезонность спорная для текущей погоды ({temp}°C).', { temp }));
  }

  const hasOuter = selection.some((item) => item.section === 'Верхняя одежда');
  if (typeof temp === 'number') {
    if (!hasOuter && temp >= 14) reasons.push(translate('При {temp}°C верхняя одежда не нужна — без лишних слоёв.', { temp }));
    if (hasOuter && temp <= 7) reasons.push(translate('Добавили верхнюю одежду: при {temp}°C без неё прохладно.', { temp }));
  }

  const groups = Array.from(new Set(selection.map((item) => getColorGroup(item.color))));
  if (groups.length <= 2) {
    reasons.push(translate('Палитра образа выглядит цельно по цветовым группам.'));
  }

  const wardrobeHasShoes = wardrobe.some((item) => item.section === 'Обувь');
  if (wardrobeHasShoes && !shoes) {
    reasons.push(translate('В гардеробе есть обувь, но в этот вариант она не попала.'));
  }

  if (totalScore >= 55) reasons.push(translate('Сильное совпадение с контекстом — один из лучших вариантов.'));

  return reasons.slice(0, 4);
};

const pickBeauty = (event: string) => beautyMap[event] || beautyMap['Прогулка'];

const buildLooks = (
  items: WardrobeItem[],
  style: string,
  event: string,
  weatherText: string,
  temp: number | null
) => {
  const styleProfile = styleProfiles[style];
  const eventProfile = eventProfiles[event];

  const uniqueById = (list: WardrobeItem[]) =>
    Array.from(new Map(list.map((item) => [item.id, item])).values());

  const rankForContext = (item: WardrobeItem) =>
    scoreItemByProfile(item, styleProfile) + scoreItemByProfile(item, eventProfile) + (item.imageUri ? 1 : 0);

  const prioritizeForContext = (list: WardrobeItem[]) => {
    const unique = uniqueById(list);
    const withPhotoFirst = [...unique].sort((a, b) => Number(Boolean(b.imageUri)) - Number(Boolean(a.imageUri)));
    const preferred = withPhotoFirst
      .filter(
        (item) =>
          (isIn(item.category, styleProfile?.preferredCategories) || isIn(item.category, eventProfile?.preferredCategories)) &&
          !isIn(item.category, styleProfile?.avoidedCategories) &&
          !isIn(item.category, eventProfile?.avoidedCategories)
      )
      .sort((a, b) => rankForContext(b) - rankForContext(a));
    const neutral = withPhotoFirst
      .filter(
        (item) =>
          !isIn(item.category, styleProfile?.avoidedCategories) && !isIn(item.category, eventProfile?.avoidedCategories)
      )
      .sort((a, b) => rankForContext(b) - rankForContext(a));
    const ranked = (preferred.length ? preferred : neutral.length ? neutral : withPhotoFirst).slice(0, 7);
    return ranked;
  };

  const tops = prioritizeForContext(items.filter((item) => item.section === 'Верх'));
  const bottoms = prioritizeForContext(items.filter((item) => item.section === 'Низ'));
  const shoes = prioritizeForContext(items.filter((item) => item.section === 'Обувь'));
  const outer = prioritizeForContext(items.filter((item) => item.section === 'Верхняя одежда'));
  const bags = prioritizeForContext(items.filter((item) => item.section === 'Сумки'));

  const safeTops = tops.length ? tops : [null];
  const safeBottoms = bottoms.length ? bottoms : [null];
  const safeShoes = shoes.length ? shoes : [null];
  // Верхняя одежда и сумка — необязательные слои: всегда оставляем вариант «без них»,
  // чтобы конструктор не лепил максимум слоёв, когда они не нужны (например, в тепло).
  const safeOuter = [null, ...outer];
  const safeBags = [null, ...bags];

  type ScoredCombo = {
    items: WardrobeItem[];
    score: number;
    strictValid: boolean;
    signature: string;
    reasons: string[];
    tuckMode: TuckMode;
  };
  const combos: ScoredCombo[] = [];

  const makeSignature = (selection: WardrobeItem[]) => {
    const bySection = (section: string) => selection.find((item) => item.section === section)?.id || '_';
    const topId = bySection('Верх') !== '_' ? bySection('Верх') : bySection('Верхняя одежда');
    const bottomKey = hasOnePiece(selection) ? 'one-piece' : bySection('Низ');
    return [topId, bottomKey, bySection('Обувь'), bySection('Верхняя одежда')].join('|');
  };

  safeTops.forEach((top) => {
    safeBottoms.forEach((bottom) => {
      safeShoes.forEach((shoe) => {
        safeOuter.forEach((outerwear) => {
          safeBags.forEach((bag) => {
            const selectionRaw = [top, bottom, shoe, outerwear, bag].filter(Boolean) as WardrobeItem[];
            const selection = uniqueById(selectionRaw);
            if (!selection.length) return;

            const strictValid = evaluateStrictRules(selection, style, event, items);
            const colors = selection.map((item) => item.color);
            const score =
              scoreColors(colors) * 2 +
              selection.reduce((sum, item) => sum + seasonScore(item, temp), 0) * 2 +
              layeringScore(selection, temp) * 2 +
              outerWeightScore(selection, temp) +
              styleScore(selection, style, items) +
              eventScore(selection, event, items) +
              scoreCompleteness(selection, items);
            const tuckDecision = resolveTuckDecision(selection, style, event);

            combos.push({
              items: selection,
              score,
              strictValid,
              signature: makeSignature(selection),
              reasons: buildFitReasons(selection, style, event, temp, items, score),
              tuckMode: tuckDecision.mode
            });
          });
        });
      });
    });
  });

  const ranked = [...combos].sort((a, b) => b.score - a.score);
  const strictOnly = ranked.filter((combo) => combo.strictValid);
  const pool = strictOnly.length ? strictOnly : ranked;
  if (!pool.length) return [];

  const uniqueBySignature: ScoredCombo[] = [];
  const signatures = new Set<string>();
  for (const combo of pool) {
    if (signatures.has(combo.signature)) continue;
    signatures.add(combo.signature);
    uniqueBySignature.push(combo);
  }
  if (!uniqueBySignature.length) return [];

  const bestScore = uniqueBySignature[0].score;
  const minAcceptableScore = Math.max(10, bestScore - 10);
  const qualityCombos = uniqueBySignature.filter((combo) => combo.score >= minAcceptableScore);
  const finalCombos = qualityCombos.length ? qualityCombos : uniqueBySignature.slice(0, 1);

  const dynamicLimit = bestScore >= 55 ? 5 : bestScore >= 42 ? 4 : bestScore >= 28 ? 3 : 2;
  const selectedCombos = finalCombos.slice(0, dynamicLimit);
  const beauty = pickBeauty(event);

  return selectedCombos.map((combo, index) => ({
    id: `look-${Date.now()}-${index}`,
    title: translate('Лук {n} · {style}', { n: index + 1, style: translate(style) }),
    itemIds: uniqueById(combo.items).map((item) => item.id),
    weather: weatherText || translate('Погода недоступна'),
    style,
    event,
    fitScore: combo.score,
    fitReasons: combo.reasons,
    tuckMode: combo.tuckMode,
    makeup: beauty.makeup,
    hair: beauty.hair
  }));
};

export function OutfitBuilderScreen({
  items,
  modelUri,
  savedLooks,
  onSavedLooksChange,
  onLooksGenerated,
  onFavoriteAdd
}: OutfitBuilderProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'builder' | 'looks'>('builder');
  const [activeStyle, setActiveStyle] = useState(stylePresets[0]);
  const [activeEvent, setActiveEvent] = useState(events[2]);
  const [weatherText, setWeatherText] = useState(translate('Определяем погоду…'));
  const [temperature, setTemperature] = useState<number | null>(null);
  const [looks, setLooks] = useState<GeneratedLook[]>([]);

  const [selectedTop, setSelectedTop] = useState<WardrobeItem | null>(null);
  const [selectedBottom, setSelectedBottom] = useState<WardrobeItem | null>(null);
  const [selectedShoes, setSelectedShoes] = useState<WardrobeItem | null>(null);
  const [selectedOuter, setSelectedOuter] = useState<WardrobeItem | null>(null);
  const [selectedBag, setSelectedBag] = useState<WardrobeItem | null>(null);
  const [manualName, setManualName] = useState('');

  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [editLookId, setEditLookId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTop, setEditTop] = useState<WardrobeItem | null>(null);
  const [editBottom, setEditBottom] = useState<WardrobeItem | null>(null);
  const [editShoes, setEditShoes] = useState<WardrobeItem | null>(null);
  const [editOuter, setEditOuter] = useState<WardrobeItem | null>(null);
  const [editBag, setEditBag] = useState<WardrobeItem | null>(null);

  const tops = useMemo(() => items.filter((item) => item.section === 'Верх'), [items]);
  const bottoms = useMemo(() => items.filter((item) => item.section === 'Низ'), [items]);
  const shoes = useMemo(() => items.filter((item) => item.section === 'Обувь'), [items]);
  const outer = useMemo(() => items.filter((item) => item.section === 'Верхняя одежда'), [items]);
  const bags = useMemo(() => items.filter((item) => item.section === 'Сумки'), [items]);
  const itemsById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items]
  );

  const getLookItems = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
  };

  const savedLookToGeneratedLook = (look: SavedLook): GeneratedLook => ({
    id: look.id,
    title: look.name,
    itemIds: look.itemIds,
    weather: '',
    style: '',
    event: '',
    makeup: '',
    hair: '',
    fitScore: look.fitScore,
    fitReasons: look.fitReasons,
    tuckMode: look.tuckMode,
    tryOnImageUri: look.tryOnImageUri,
    tryOnWarning: look.tryOnWarning,
    tryOnUpdatedAt: look.tryOnUpdatedAt,
    tryOnQualityMode: look.tryOnQualityMode,
    tryOnHistory: look.tryOnHistory
  });

  useEffect(() => {
    if (!selectedTop && tops.length) setSelectedTop(tops[0]);
    if (!selectedBottom && bottoms.length) setSelectedBottom(bottoms[0]);
    if (!selectedShoes && shoes.length) setSelectedShoes(shoes[0]);
  }, [tops, bottoms, shoes, selectedTop, selectedBottom, selectedShoes]);

  useEffect(() => {
    const loadWeather = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setWeatherText(t('Разреши доступ к геолокации, чтобы узнать погоду.'));
          return;
        }
        const location = await Location.getCurrentPositionAsync({});
        const geo = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });
        const city = geo[0]?.city || t('твоем городе');
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${location.coords.latitude}` +
          `&longitude=${location.coords.longitude}&current=temperature_2m,weathercode,wind_speed_10m&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const temp = data?.current?.temperature_2m;
        const code = data?.current?.weathercode;
        const wind = data?.current?.wind_speed_10m;
        const description = t(weatherCodeMap[code] || 'переменная облачность');
        setTemperature(typeof temp === 'number' ? temp : null);
        setWeatherText(
          t('Сейчас {temp}°C, {description}, ветер {wind} м/с ({city})', {
            temp: temp ?? '--',
            description,
            wind: wind ?? '--',
            city
          })
        );
      } catch (error) {
        setWeatherText(t('Не удалось получить погоду. Проверь интернет.'));
      }
    };

    loadWeather();
  }, []);

  const handleGenerateLooks = () => {
    if (!items.length) {
      Alert.alert(t('Нет вещей'), t('Добавь хотя бы 3 вещи в гардероб.'));
      return;
    }
    const generated = buildLooks(items, activeStyle, activeEvent, weatherText, temperature);
    if (!generated.length) {
      Alert.alert(t('Не удалось собрать лук'), t('Добавь больше вещей разных категорий.'));
      return;
    }
    setLooks(generated);
    onLooksGenerated(generated, { style: activeStyle, event: activeEvent, weather: weatherText });
  };

  const handleSaveManualLook = () => {
    const selectedItems = [selectedTop, selectedBottom, selectedShoes, selectedOuter, selectedBag].filter(
      Boolean
    ) as WardrobeItem[];
    if (selectedItems.length < 3) {
      Alert.alert(t('Недостаточно вещей'), t('Добавь хотя бы верх, низ и обувь.'));
      return;
    }
    const name = manualName.trim() || t('Лук {n}', { n: savedLooks.length + 1 });
    const newLook: SavedLook = {
      id: Date.now().toString(),
      name,
      itemIds: selectedItems.map((item) => item.id),
      createdAt: Date.now()
    };
    onSavedLooksChange([newLook, ...savedLooks]);
    setManualName('');
    setActiveTab('looks');
  };

  const handleSaveGeneratedLook = (look: GeneratedLook) => {
    const name = look.title || t('Лук {n}', { n: savedLooks.length + 1 });
    const newLook: SavedLook = {
      id: Date.now().toString(),
      name,
      itemIds: look.itemIds,
      createdAt: Date.now(),
      fitScore: look.fitScore,
      fitReasons: look.fitReasons,
      tuckMode: look.tuckMode,
      tryOnImageUri: look.tryOnImageUri,
      tryOnWarning: look.tryOnWarning,
      tryOnUpdatedAt: look.tryOnUpdatedAt,
      tryOnQualityMode: look.tryOnQualityMode,
      tryOnHistory: look.tryOnHistory
    };
    onSavedLooksChange([newLook, ...savedLooks]);
    setActiveTab('looks');
  };

  const updateSavedLookTryOn = (
    lookId: string,
    payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
  ) => {
    onSavedLooksChange(
      savedLooks.map((look) => {
        if (look.id !== lookId) return look;
        const historyItem: TryOnHistoryItem = {
          id: `${payload.updatedAt}-${payload.tuckMode}-${payload.qualityMode}`,
          imageUri: payload.imageUri,
          updatedAt: payload.updatedAt,
          tuckMode: payload.tuckMode,
          qualityMode: payload.qualityMode
        };
        if (payload.warning) historyItem.warning = payload.warning;
        return {
          ...look,
          tuckMode: payload.tuckMode,
          tryOnImageUri: payload.imageUri,
          tryOnWarning: payload.warning,
          tryOnUpdatedAt: payload.updatedAt,
          tryOnQualityMode: payload.qualityMode,
          tryOnHistory: mergeTryOnHistory(historyItem, look.tryOnHistory)
        };
      })
    );
  };

  const updateGeneratedLookTryOn = (
    lookId: string,
    payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
  ) => {
    setLooks((prev) =>
      prev.map((look) => {
        if (look.id !== lookId) return look;
        const historyItem: TryOnHistoryItem = {
          id: `${payload.updatedAt}-${payload.tuckMode}-${payload.qualityMode}`,
          imageUri: payload.imageUri,
          updatedAt: payload.updatedAt,
          tuckMode: payload.tuckMode,
          qualityMode: payload.qualityMode
        };
        if (payload.warning) historyItem.warning = payload.warning;
        return {
          ...look,
          tuckMode: payload.tuckMode,
          tryOnImageUri: payload.imageUri,
          tryOnWarning: payload.warning,
          tryOnUpdatedAt: payload.updatedAt,
          tryOnQualityMode: payload.qualityMode,
          tryOnHistory: mergeTryOnHistory(historyItem, look.tryOnHistory)
        };
      })
    );
  };

  const openEditLook = (look: SavedLook) => {
    const lookItems = getLookItems(look.itemIds);
    const pickSection = (section: string, fallback: WardrobeItem[]) =>
      lookItems.find((item) => item.section === section) || fallback[0] || null;
    setEditLookId(look.id);
    setEditName(look.name);
    setEditTop(pickSection('Верх', tops));
    setEditBottom(pickSection('Низ', bottoms));
    setEditShoes(pickSection('Обувь', shoes));
    setEditOuter(pickSection('Верхняя одежда', outer));
    setEditBag(pickSection('Сумки', bags));
    setEditModalVisible(true);
  };

  const handleSaveEditedLook = () => {
    if (!editLookId) return;
    const selection = [editTop, editBottom, editShoes, editOuter, editBag].filter(Boolean) as WardrobeItem[];
    if (selection.length < 3) {
      Alert.alert(t('Недостаточно вещей'), t('Добавь хотя бы верх, низ и обувь.'));
      return;
    }
    const updated = savedLooks.map((look) =>
      look.id === editLookId
        ? {
            ...look,
            name: editName.trim() || look.name,
            itemIds: selection.map((item) => item.id),
            fitScore: undefined,
            fitReasons: undefined,
            tuckMode: undefined,
            tryOnImageUri: undefined,
            tryOnWarning: undefined,
            tryOnUpdatedAt: undefined,
            tryOnQualityMode: undefined,
            tryOnHistory: undefined
          }
        : look
    );
    onSavedLooksChange(updated);
    setEditModalVisible(false);
  };

  const handleDeleteLook = (id: string) => {
    Alert.alert(t('Удалить лук?'), t('Действие нельзя отменить.'), [
      { text: t('Отмена'), style: 'cancel' },
      {
        text: t('Удалить'),
        style: 'destructive',
        onPress: () => onSavedLooksChange(savedLooks.filter((look) => look.id !== id))
      }
    ]);
  };

  const renderPicker = (
    title: string,
    list: WardrobeItem[],
    selected: WardrobeItem | null,
    onSelect: (item: WardrobeItem) => void
  ) => (
    <View style={styles.selectorBlock}>
      <Text style={styles.selectorTitle}>{t(title)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>
        {list.map((item) => {
          const active = selected?.id === item.id;
          return (
            <AppPressable
              key={item.id}
              style={[styles.selectorCard, active && styles.selectorCardActive]}
              onPress={() => onSelect(item)}
            >
              {item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={styles.selectorImage} resizeMode="cover" />
              ) : null}
              <Text style={styles.selectorLabel} numberOfLines={1}>
                {item.name}
              </Text>
            </AppPressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderFitReasons = (reasons?: string[], score?: number) => {
    if (!reasons?.length && typeof score !== 'number') return null;
    return (
      <View style={styles.reasonBlock}>
        <Text style={styles.reasonTitle}>{t('Почему этот лук подходит')}</Text>
        {typeof score === 'number' ? (
          <Text style={styles.reasonScore}>{t('Оценка совпадения: {score}', { score: Math.round(score) })}</Text>
        ) : null}
        {(reasons || []).map((reason, index) => (
          <Text key={`${reason}-${index}`} style={styles.reasonText}>
            • {reason}
          </Text>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}>
        <ScreenTitle
          title={t('Конструктор образов')}
          subtitle={t('Выбери стиль и событие, а ИИ соберет луки из твоего гардероба с учетом погоды.')}
        />

        <View style={styles.segment}>
          <AppPressable
            style={[styles.segmentTab, activeTab === 'builder' && styles.segmentTabActive]}
            onPress={() => setActiveTab('builder')}
          >
            <Text style={[styles.segmentText, activeTab === 'builder' && styles.segmentTextActive]}>
              {t('Конструктор')}
            </Text>
          </AppPressable>
          <AppPressable
            style={[styles.segmentTab, activeTab === 'looks' && styles.segmentTabActive]}
            onPress={() => setActiveTab('looks')}
          >
            <Text style={[styles.segmentText, activeTab === 'looks' && styles.segmentTextActive]}>{t('Луки')}</Text>
          </AppPressable>
        </View>

        {activeTab === 'builder' ? (
          <>
            <Text style={styles.groupTitle}>{t('Стиль')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {stylePresets.map((preset) => (
                <Chip
                  key={preset}
                  label={t(preset)}
                  active={preset === activeStyle}
                  onPress={() => setActiveStyle(preset)}
                />
              ))}
            </ScrollView>

            <Text style={styles.groupTitle}>{t('Мероприятие')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {events.map((event) => (
                <Chip
                  key={event}
                  label={t(event)}
                  active={event === activeEvent}
                  onPress={() => setActiveEvent(event)}
                />
              ))}
            </ScrollView>

            <View style={styles.weatherCard}>
              <Text style={styles.weatherTitle}>{t('Погода рядом с тобой')}</Text>
              <Text style={styles.weatherText}>{weatherText}</Text>
            </View>

            <AppPressable style={styles.generateButton} onPress={handleGenerateLooks}>
              <Text style={styles.generateText}>{t('Сгенерировать подходящие образы')}</Text>
            </AppPressable>
            <Text style={styles.generateHint}>{t('Покажем только те варианты, которые реально подходят под стиль и событие.')}</Text>

            <View style={styles.manualWrap}>
              <Text style={styles.manualTitle}>{t('Собери образ вручную')}</Text>
              {renderPicker('Верх', tops, selectedTop, setSelectedTop)}
              {renderPicker('Низ', bottoms, selectedBottom, setSelectedBottom)}
              {renderPicker('Обувь', shoes, selectedShoes, setSelectedShoes)}
              {renderPicker('Верхняя одежда', outer, selectedOuter, setSelectedOuter)}
              {renderPicker('Сумка', bags, selectedBag, setSelectedBag)}

              <Text style={styles.manualLabel}>{t('Название образа')}</Text>
              <TextInput
                style={styles.manualInput}
                placeholder={t('Например, Оранжевый кэжуал')}
                placeholderTextColor={themeColors.muted}
                value={manualName}
                onChangeText={setManualName}
              />

              <AppPressable style={styles.addLookButton} onPress={handleSaveManualLook}>
                <Text style={styles.addLookText}>{t('Добавить в образы')}</Text>
              </AppPressable>

              <View style={styles.manualResult}>
                <Text style={styles.manualResultTitle}>{t('Текущий образ')}</Text>
                {[selectedTop, selectedBottom, selectedShoes, selectedOuter, selectedBag]
                  .filter(Boolean)
                  .map((item) => (
                    <Text key={(item as WardrobeItem).id} style={styles.manualItem}>
                      • {(item as WardrobeItem).name}
                    </Text>
                  ))}
              </View>
            </View>

            <View style={styles.looksWrap}>
              {looks.map((look) => {
                const lookItems = getLookItems(look.itemIds);
                return (
                  <View key={look.id} style={styles.lookCard}>
                    <View style={styles.lookHeader}>
                      <Text style={styles.lookTitle}>{look.title}</Text>
                      <View style={styles.lookActions}>
                        <AppPressable style={styles.secondaryButton} onPress={() => handleSaveGeneratedLook(look)}>
                          <Text style={styles.secondaryButtonText}>{t('В луки')}</Text>
                        </AppPressable>
                        <AppPressable style={styles.favoriteButton} onPress={() => onFavoriteAdd(look)}>
                          <Text style={styles.favoriteText}>{t('В избранное')}</Text>
                        </AppPressable>
                      </View>
                    </View>
                    <Text style={styles.lookWeather}>{look.weather}</Text>
                    <LookPreview items={lookItems} />
                    <AiTryOnPreview
                      modelUri={modelUri}
                      items={lookItems}
                      tuckMode={look.tuckMode}
                      resultUri={look.tryOnImageUri}
                      warningMessage={look.tryOnWarning}
                      updatedAt={look.tryOnUpdatedAt}
                      qualityMode={look.tryOnQualityMode}
                      history={look.tryOnHistory}
                      onGenerated={(payload) => updateGeneratedLookTryOn(look.id, payload)}
                    />
                    {lookItems.map((item) => (
                      <Text key={item.id} style={styles.lookItem}>
                        • {item.name}
                      </Text>
                    ))}
                    {renderFitReasons(look.fitReasons, look.fitScore)}
                    <View style={styles.beautyBlock}>
                      <Text style={styles.beautyTitle}>{t('Макияж')}</Text>
                      <Text style={styles.beautyText}>{t(look.makeup)}</Text>
                      <Text style={styles.beautyTitle}>{t('Укладка')}</Text>
                      <Text style={styles.beautyText}>{t(look.hair)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.looksWrap}>
            {!savedLooks.length ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{t('Пока нет сохраненных образов')}</Text>
                <Text style={styles.emptyText}>{t('Собери лук вручную и добавь его в образы.')}</Text>
              </View>
            ) : null}
            {savedLooks.map((look) => {
              const lookItems = getLookItems(look.itemIds);
              return (
                <View key={look.id} style={styles.lookCard}>
                  <View style={styles.lookHeader}>
                    <Text style={styles.lookTitle}>{look.name}</Text>
                    <View style={styles.lookActions}>
                      <AppPressable style={styles.secondaryButton} onPress={() => openEditLook(look)}>
                        <Text style={styles.secondaryButtonText}>{t('Изменить')}</Text>
                      </AppPressable>
                      <AppPressable style={styles.favoriteButton} onPress={() => onFavoriteAdd(savedLookToGeneratedLook(look))}>
                        <Text style={styles.favoriteText}>{t('В избранное')}</Text>
                      </AppPressable>
                      <AppPressable style={styles.deleteButton} onPress={() => handleDeleteLook(look.id)}>
                        <Text style={styles.deleteButtonText}>{t('Удалить')}</Text>
                      </AppPressable>
                    </View>
                  </View>
                  <LookPreview items={lookItems} />
                  <AiTryOnPreview
                    modelUri={modelUri}
                    items={lookItems}
                    tuckMode={look.tuckMode}
                    resultUri={look.tryOnImageUri}
                    warningMessage={look.tryOnWarning}
                    updatedAt={look.tryOnUpdatedAt}
                    qualityMode={look.tryOnQualityMode}
                    history={look.tryOnHistory}
                    onGenerated={(payload) => updateSavedLookTryOn(look.id, payload)}
                  />
                  {lookItems.map((item) => (
                    <Text key={item.id} style={styles.lookItem}>
                      • {item.name}
                    </Text>
                  ))}
                  {renderFitReasons(look.fitReasons, look.fitScore)}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={isEditModalVisible} onRequestClose={() => setEditModalVisible(false)}>
        <AppPressable feedback={false} style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <AppPressable feedback={false} style={styles.modalCard} onPress={() => undefined}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{t('Редактировать лук')}</Text>
                <Text style={styles.modalLabel}>{t('Название')}</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder={t('Название')}
                  placeholderTextColor={themeColors.muted}
                  value={editName}
                  onChangeText={setEditName}
                />
                {renderPicker('Верх', tops, editTop, setEditTop)}
                {renderPicker('Низ', bottoms, editBottom, setEditBottom)}
                {renderPicker('Обувь', shoes, editShoes, setEditShoes)}
                {renderPicker('Верхняя одежда', outer, editOuter, setEditOuter)}
                {renderPicker('Сумка', bags, editBag, setEditBag)}
                <AppPressable style={styles.modalSave} onPress={handleSaveEditedLook}>
                  <Text style={styles.modalSaveText}>{t('Сохранить')}</Text>
                </AppPressable>
                <AppPressable style={styles.modalClose} onPress={() => setEditModalVisible(false)}>
                  <Text style={styles.modalCloseText}>{t('Отмена')}</Text>
                </AppPressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </AppPressable>
        </AppPressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
  pageContent: {
    paddingBottom: 24
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: c.chip,
    borderRadius: 14,
    padding: 4,
    marginBottom: 12
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center'
  },
  segmentTabActive: {
    backgroundColor: c.buttonPrimaryBg
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text
  },
  segmentTextActive: {
    color: c.buttonPrimaryText
  },
  groupTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4
  },
  chipsRow: {
    paddingBottom: 6,
    marginBottom: 16,
    paddingRight: 12
  },
  chipsRowAndroid: {
    paddingBottom: 10,
    marginBottom: 20
  },
  chipsScroll: {
    minHeight: 48
  },
  weatherCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12
  },
  weatherTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700'
  },
  weatherText: {
    color: c.muted,
    fontSize: 12,
    marginTop: 4
  },
  generateButton: {
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 12
  },
  generateText: {
    color: c.buttonPrimaryText,
    fontSize: 15,
    fontWeight: '700'
  },
  generateHint: {
    color: c.muted,
    fontSize: 12,
    marginTop: -4,
    marginBottom: 12
  },
  manualWrap: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    marginBottom: 12
  },
  manualTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  manualLabel: {
    color: c.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 6
  },
  manualInput: {
    backgroundColor: c.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text
  },
  addLookButton: {
    marginTop: 10,
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center'
  },
  addLookText: {
    color: c.buttonPrimaryText,
    fontSize: 14,
    fontWeight: '700'
  },
  selectorBlock: {
    marginBottom: 10
  },
  selectorTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  selectorRow: {
    gap: 8,
    paddingBottom: 6
  },
  selectorCard: {
    width: 120,
    backgroundColor: c.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    padding: 8
  },
  selectorCardActive: {
    borderColor: c.text
  },
  selectorImage: {
    width: '100%',
    height: 70,
    borderRadius: 8,
    backgroundColor: c.chip
  },
  selectorLabel: {
    marginTop: 6,
    color: c.text,
    fontSize: 12,
    fontWeight: '600'
  },
  manualResult: {
    marginTop: 8
  },
  manualResultTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4
  },
  manualItem: {
    color: c.muted,
    fontSize: 12
  },
  looksWrap: {
    gap: 10,
    paddingBottom: 20
  },
  lookCard: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 4
  },
  lookHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  lookTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1
  },
  favoriteButton: {
    backgroundColor: c.chip,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  favoriteText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '600'
  },
  lookActions: {
    flexDirection: 'row',
    gap: 6
  },
  secondaryButton: {
    backgroundColor: c.chip,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  secondaryButtonText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '600'
  },
  deleteButton: {
    backgroundColor: '#FBEAEA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  deleteButtonText: {
    color: '#9B2C2C',
    fontSize: 12,
    fontWeight: '600'
  },
  lookWeather: {
    color: c.muted,
    fontSize: 12,
    marginBottom: 3
  },
  lookItem: {
    color: c.text,
    fontSize: 13
  },
  reasonBlock: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    gap: 2
  },
  reasonTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2
  },
  reasonScore: {
    color: c.muted,
    fontSize: 11,
    marginBottom: 2
  },
  reasonText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  beautyBlock: {
    marginTop: 6,
    gap: 4
  },
  beautyTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700'
  },
  beautyText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  emptyState: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 16
  },
  emptyTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4
  },
  emptyText: {
    color: c.muted,
    fontSize: 12
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: c.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: '85%'
  },
  modalContent: {
    paddingBottom: 24
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginBottom: 12
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: c.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text,
    marginBottom: 8
  },
  modalSave: {
    marginTop: 12,
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalSaveText: {
    color: c.buttonPrimaryText,
    fontSize: 14,
    fontWeight: '600'
  },
  modalClose: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 8
  },
  modalCloseText: {
    color: c.muted,
    fontSize: 13
  }
});
