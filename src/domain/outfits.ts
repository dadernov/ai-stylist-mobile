import { WardrobeItem } from '../data/mock';
import { GeneratedLook } from '../types/looks';
import { Gender } from '../types/profile';
import { pickBeauty } from '../constants/beauty';

export type Precipitation = 'rain' | 'snow' | null;
export type OutfitContext = { style: string; event: string; temperature: number | null; gender?: Gender; precipitation?: Precipitation; wind?: number | null };
export type RecommendationOptions = { anchorId?: string; excludedIds?: string[]; favoriteItemIds?: string[]; precipitation?: Precipitation; wind?: number | null; t?: Translator; now?: number };

// A garment added in the last two weeks gets a head start that fades day by
// day: without it the long-owned pieces keep every place in the ideas and a
// newly added one never shows up. Wardrobe item ids are their creation time.
const NEW_ITEM_DAYS = 14;
export function noveltyBonus(item: WardrobeItem, now = Date.now()) {
  if (!/^\d{13}$/.test(item.id)) return 0;
  const days = (now - Number(item.id)) / 86_400_000;
  return days < 0 || days >= NEW_ITEM_DAYS ? 0 : 4 * (1 - days / NEW_ITEM_DAYS);
}

/** Open-Meteo WMO code → осадки. 51–67, 80–82, 95–99 дождь; 71–77, 85–86 снег. */
export function precipitationFromCode(code: number | null | undefined): Precipitation {
  if (typeof code !== 'number') return null;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return null;
}

// Одна таблица знаний о вещах вместо разрозненных списков: и подбор, и советы
// читают отсюда, поэтому образ не может быть собран по одним правилам, а
// прокомментирован по другим.
//   formality — 1 спортивное … 5 строгое
//   warmth    — 0 не греет … 5 мороз
//   volume    — 1 облегающий, 2 прямой, 3 объёмный
type Garment = { section: string; formality: number; warmth: number; volume: number; sporty?: boolean; onePiece?: boolean };

const garments: Record<string, Garment> = {
  Футболка: { section: 'Верх', formality: 2, warmth: 1, volume: 2, sporty: true },
  Поло: { section: 'Верх', formality: 3, warmth: 1, volume: 2 },
  Лонгслив: { section: 'Верх', formality: 2, warmth: 2, volume: 2 },
  Рубашка: { section: 'Верх', formality: 4, warmth: 2, volume: 2 },
  Блуза: { section: 'Верх', formality: 4, warmth: 1, volume: 2 },
  Топ: { section: 'Верх', formality: 2, warmth: 0, volume: 1 },
  Майка: { section: 'Верх', formality: 1, warmth: 0, volume: 1, sporty: true },
  Водолазка: { section: 'Верх', formality: 3, warmth: 3, volume: 1 },
  Свитер: { section: 'Верх', formality: 3, warmth: 4, volume: 3 },
  Худи: { section: 'Верх', formality: 1, warmth: 3, volume: 3, sporty: true },
  Свитшот: { section: 'Верх', formality: 2, warmth: 3, volume: 3, sporty: true },
  Кардиган: { section: 'Верх', formality: 3, warmth: 3, volume: 3 },
  Жилет: { section: 'Верх', formality: 3, warmth: 2, volume: 2 },
  Платье: { section: 'Верх', formality: 4, warmth: 1, volume: 2, onePiece: true },
  Сарафан: { section: 'Верх', formality: 3, warmth: 0, volume: 2, onePiece: true },
  Комбинезон: { section: 'Верх', formality: 3, warmth: 1, volume: 2, onePiece: true },
  Пиджак: { section: 'Верхняя одежда', formality: 5, warmth: 2, volume: 2 },
  Бомбер: { section: 'Верхняя одежда', formality: 2, warmth: 3, volume: 3 },
  Куртка: { section: 'Верхняя одежда', formality: 2, warmth: 3, volume: 3 },
  Пальто: { section: 'Верхняя одежда', formality: 5, warmth: 4, volume: 3 },
  Тренч: { section: 'Верхняя одежда', formality: 4, warmth: 3, volume: 3 },
  Плащ: { section: 'Верхняя одежда', formality: 3, warmth: 2, volume: 3 },
  Пуховик: { section: 'Верхняя одежда', formality: 1, warmth: 5, volume: 3 },
  Парка: { section: 'Верхняя одежда', formality: 2, warmth: 5, volume: 3 },
  Шуба: { section: 'Верхняя одежда', formality: 4, warmth: 5, volume: 3 },
  Юбка: { section: 'Низ', formality: 4, warmth: 1, volume: 2 },
  Джинсы: { section: 'Низ', formality: 2, warmth: 2, volume: 2 },
  Брюки: { section: 'Низ', formality: 4, warmth: 2, volume: 2 },
  Шорты: { section: 'Низ', formality: 1, warmth: 0, volume: 2, sporty: true },
  Леггинсы: { section: 'Низ', formality: 1, warmth: 1, volume: 1, sporty: true },
  Джоггеры: { section: 'Низ', formality: 1, warmth: 2, volume: 3, sporty: true },
  Кроссовки: { section: 'Обувь', formality: 2, warmth: 2, volume: 2, sporty: true },
  Кеды: { section: 'Обувь', formality: 2, warmth: 1, volume: 2 },
  Лоферы: { section: 'Обувь', formality: 4, warmth: 1, volume: 1 },
  Туфли: { section: 'Обувь', formality: 5, warmth: 1, volume: 1 },
  Ботинки: { section: 'Обувь', formality: 3, warmth: 3, volume: 2 },
  Сандалии: { section: 'Обувь', formality: 1, warmth: 0, volume: 1 },
  Сапоги: { section: 'Обувь', formality: 3, warmth: 4, volume: 2 },
  Балетки: { section: 'Обувь', formality: 3, warmth: 1, volume: 1 },
  Сумка: { section: 'Сумки', formality: 3, warmth: 0, volume: 2 },
  Рюкзак: { section: 'Сумки', formality: 2, warmth: 0, volume: 2, sporty: true },
  Клатч: { section: 'Сумки', formality: 5, warmth: 0, volume: 1 }
};

const fallbackGarment: Garment = { section: 'Верх', formality: 3, warmth: 2, volume: 2 };
const describe = (item: WardrobeItem): Garment => garments[item.category] || fallbackGarment;
const isOnePiece = (item: WardrobeItem) => Boolean(describe(item).onePiece);
// Кавычки тоже зависят от языка: «ёлочки» в русском, “лапки” в английском и китайском.
const named = (item: WardrobeItem, t: Translator) => t('«{name}»', { name: item.name });
const list = (items: WardrobeItem[], t: Translator) => items.map(item => named(item, t)).join(', ');

// Событие задаёт целевую строгость образа, стиль её уточняет.
export const EVENTS = ['Прогулка', 'Работа', 'Совещание', 'Собеседование', 'Учёба', 'Свидание', 'Ресторан', 'Театр', 'Вечеринка',
  'Концерт', 'Свадьба', 'Путешествие', 'Дома', 'Пляж', 'Спортзал'];
export const STYLES = ['Кэжуал', 'Смарт-кэжуал', 'Минимализм', 'Классика', 'Офисный', 'Old money', 'Романтичный', 'Бохо',
  'Стритвир', 'Спорт-шик', 'Гранж', 'Преппи'];
const eventFormality: Record<string, number> = {
  Прогулка: 2.5, Работа: 3.8, Совещание: 4.5, Собеседование: 4.6, Учёба: 2.6, Свидание: 3.5, Ресторан: 3.6, Театр: 4.2,
  Вечеринка: 4, Концерт: 2.2, Свадьба: 4.5, Путешествие: 2, Дома: 1.5, Пляж: 1.2, Спортзал: 1,
};
const styleFormality: Record<string, number> = {
  Кэжуал: 2.5, 'Смарт-кэжуал': 3.3, Минимализм: 3.5, Классика: 4.5, Офисный: 4.5, 'Old money': 4, Романтичный: 3.5,
  Бохо: 2.5, Стритвир: 1.8, 'Спорт-шик': 1.5, Гранж: 2, Преппи: 3.5,
};
// Что делает вещь «своей» для стиля: категории, узоры, палитра.
type StyleRule = { categories: string[]; patterns?: string[]; colors?: string[]; plainOnly?: boolean; neutralPalette?: boolean };
const styleRules: Record<string, StyleRule> = {
  Кэжуал: { categories: ['Футболка', 'Лонгслив', 'Свитшот', 'Худи', 'Джинсы', 'Кеды', 'Кроссовки', 'Куртка', 'Бомбер', 'Рубашка'] },
  'Смарт-кэжуал': { categories: ['Рубашка', 'Поло', 'Свитер', 'Водолазка', 'Брюки', 'Джинсы', 'Лоферы', 'Ботинки', 'Пиджак', 'Тренч', 'Кардиган'] },
  Минимализм: { categories: [], plainOnly: true, neutralPalette: true },
  Классика: { categories: ['Рубашка', 'Блуза', 'Брюки', 'Пиджак', 'Пальто', 'Туфли', 'Лоферы', 'Юбка', 'Тренч', 'Водолазка', 'Платье'] },
  Офисный: { categories: ['Рубашка', 'Блуза', 'Брюки', 'Пиджак', 'Лоферы', 'Туфли', 'Водолазка', 'Юбка', 'Жилет', 'Кардиган'] },
  'Old money': { categories: ['Поло', 'Рубашка', 'Свитер', 'Кардиган', 'Брюки', 'Лоферы', 'Тренч', 'Пальто', 'Пиджак', 'Юбка'], neutralPalette: true },
  Романтичный: { categories: ['Блуза', 'Платье', 'Юбка', 'Балетки', 'Кардиган', 'Сарафан'], patterns: ['Цветочный', 'Горох'], colors: ['Розовый', 'Пудровый', 'Лавандовый', 'Молочный', 'Кремовый'] },
  Бохо: { categories: ['Кардиган', 'Сарафан', 'Юбка', 'Сандалии', 'Рубашка', 'Джинсы', 'Платье'], patterns: ['Цветочный'], colors: ['Песочный', 'Карамельный', 'Оливковый', 'Горчичный', 'Бежевый'] },
  Стритвир: { categories: ['Худи', 'Свитшот', 'Футболка', 'Джоггеры', 'Кроссовки', 'Бомбер', 'Джинсы', 'Кеды', 'Парка'] },
  'Спорт-шик': { categories: ['Худи', 'Свитшот', 'Кроссовки', 'Джоггеры', 'Леггинсы', 'Бомбер', 'Футболка', 'Лонгслив'] },
  Гранж: { categories: ['Ботинки', 'Куртка', 'Джинсы', 'Футболка', 'Рубашка', 'Сапоги'], patterns: ['Клетка'], colors: ['Черный', 'Чёрный', 'Графит', 'Бордовый', 'Хаки'] },
  Преппи: { categories: ['Поло', 'Рубашка', 'Кардиган', 'Свитер', 'Юбка', 'Лоферы', 'Брюки', 'Пиджак'], patterns: ['Клетка', 'Полоска'] },
};
// События с особыми требованиями к вещам сверх строгости.
const eventBonus: Record<string, { good?: string[]; bad?: string[] }> = {
  Пляж: { good: ['Шорты', 'Сандалии', 'Сарафан', 'Футболка', 'Майка', 'Топ', 'Рубашка'], bad: ['Ботинки', 'Сапоги', 'Пиджак', 'Брюки', 'Свитер', 'Водолазка', 'Джинсы', 'Джоггеры', 'Лоферы', 'Туфли'] },
  Путешествие: { good: ['Кроссовки', 'Кеды', 'Джинсы', 'Джоггеры', 'Свитшот', 'Худи', 'Лонгслив', 'Куртка'], bad: ['Туфли', 'Балетки', 'Пиджак'] },
  Дома: { good: ['Футболка', 'Худи', 'Свитшот', 'Джоггеры', 'Леггинсы', 'Шорты', 'Лонгслив'], bad: ['Пиджак', 'Туфли', 'Пальто'] },
  Концерт: { good: ['Футболка', 'Джинсы', 'Кеды', 'Ботинки', 'Куртка', 'Кроссовки'], bad: ['Туфли', 'Балетки'] },
  Собеседование: { good: ['Рубашка', 'Блуза', 'Брюки', 'Пиджак', 'Лоферы', 'Туфли'], bad: ['Шорты', 'Худи', 'Джоггеры', 'Майка', 'Сандалии'] },
};
export function styleFit(item: WardrobeItem, style: string) {
  const rule = styleRules[style];
  if (!rule) return false;
  const info = colorInfo(item.color);
  if (rule.plainOnly && item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)) return false;
  if (rule.categories.includes(item.category)) return !rule.neutralPalette || !info || info.neutral;
  if (rule.patterns?.includes(item.pattern)) return true;
  if (rule.colors?.includes(item.color)) return true;
  return Boolean(rule.plainOnly && rule.neutralPalette && info?.neutral);
}

function targetFormality(context: OutfitContext) {
  const values = [eventFormality[context.event], styleFormality[context.style]].filter(value => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 3;
}

const neutralNames = new Set(['Белый', 'Молочный', 'Кремовый', 'Бежевый', 'Песочный', 'Черный', 'Чёрный', 'Графит', 'Серый', 'Серебристый', 'Коричневый']);
const colors: Record<string, string> = {
  Белый: '#ffffff', Молочный: '#f5f2e8', Кремовый: '#f3ead6', Бежевый: '#c5b39a', Песочный: '#d8c8a8', Черный: '#181818', Чёрный: '#181818',
  Графит: '#393939', Серый: '#8a8a8a', Серебристый: '#c0c0c0', Синий: '#294979', 'Синий деним': '#456a8d', Голубой: '#8abbd5',
  Зеленый: '#44825a', Зелёный: '#44825a', Оливковый: '#83875c', Хаки: '#777c56', Красный: '#b9383e', Розовый: '#dfa1b0', Бордовый: '#73384b',
  Коричневый: '#82634e', Желтый: '#e2c455', Жёлтый: '#e2c455', Оранжевый: '#d68443', Фиолетовый: '#806296', Лавандовый: '#b4a0c6',
  Карамельный: '#b07a4a', Горчичный: '#c9a23a', Бирюзовый: '#3fa7a3', Пудровый: '#e3c1bd'
};
// Вещи, которые в гардеробе работают как база, даже если у цвета есть тон:
// деним, тёмно-синий, земляные оттенки. Иначе джинсы спорили бы с любым цветным верхом.
const baseColorNames = new Set(['Синий деним', 'Хаки', 'Оливковый', 'Карамельный', 'Кремовый', 'Пудровый']);
const baseCategories = new Set(['Джинсы']);

type ColorInfo = { hue: number; saturation: number; lightness: number; neutral: boolean };

function colorInfo(color: string): ColorInfo | null {
  const hex = colors[color] || (/^#[a-f\d]{6}$/i.test(color) ? color : undefined);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 || lightness === 0 || lightness === 1 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  // Тёмно-синий костюм или молочная рубашка работают как нейтральные, даже если
  // формально у них есть тон, поэтому нейтральность — про восприятие, не про hue.
  const navy = hue >= 200 && hue <= 250 && lightness < 0.36;
  const neutral = neutralNames.has(color) || baseColorNames.has(color) || navy || saturation < 0.2 || lightness < 0.16 || lightness > 0.93;
  return { hue, saturation, lightness, neutral };
}

/** Цвет вещи с учётом её роли: джинсы любого синего оттенка — база, а не акцент. */
function itemColor(item: WardrobeItem): ColorInfo | null {
  const info = colorInfo(item.color);
  return info && baseCategories.has(item.category) ? { ...info, neutral: true } : info;
}

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function paletteScore(items: WardrobeItem[]) {
  const accents = items.map(itemColor).filter(info => info && !info.neutral) as ColorInfo[];
  if (accents.length < 2) return accents.length === 1 ? 6 : 5;
  let score = accents.length > 2 ? -6 : 0;
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      const distance = hueDistance(accents[i].hue, accents[j].hue);
      // Провал в середине не случаен: «почти совпало» читается как ошибка,
      // а родственные и прямо контрастные пары выглядят намеренными.
      score += distance <= 30 ? 3 : distance <= 70 ? -4 : distance >= 150 ? 1 : -3;
    }
  }
  return score;
}

// Материал уточняет утепление: шерстяная рубашка теплее хлопковой, льняные брюки легче джинсов.
const materialWarmth: [RegExp, number][] = [
  [/пух|down|羽绒/i, 1], [/шерст|кашемир|wool|cashmere|флис|fleece|羊毛|羊绒/i, 1], [/мех|fur|шуба/i, 1],
  [/лён|льн|linen|亚麻/i, -1], [/шёлк|шелк|silk|丝/i, -0.5], [/сетк|mesh/i, -1],
];
function warmthOf(item: WardrobeItem) {
  const base = describe(item).warmth;
  const material = item.material || '';
  const delta = materialWarmth.reduce((sum, [pattern, value]) => sum + (pattern.test(material) ? value : 0), 0);
  return Math.max(0, Math.min(5, base + delta));
}
const isSuede = (item: WardrobeItem) => /замш|suede|nubuck|нубук|麂皮/i.test(item.material || '');
const openShoes = new Set(['Сандалии', 'Балетки']);
const lowShoes = new Set(['Кеды', 'Лоферы', 'Туфли', 'Сандалии', 'Балетки']);
const closedWarmShoes = new Set(['Ботинки', 'Сапоги']);
const rainLayers = new Set(['Плащ', 'Тренч', 'Куртка', 'Парка', 'Бомбер']);
const isLight = (item: WardrobeItem) => (itemColor(item)?.lightness ?? 0) > 0.8;

function itemScore(item: WardrobeItem, context: OutfitContext) {
  const garment = describe(item);
  const { event, temperature, gender } = context;
  let score = item.imageUri ? 2 : 0;
  score -= Math.abs(garment.formality - targetFormality(context)) * 3;
  if (event === 'Спортзал') score += garment.sporty ? 12 : -35;
  if (styleRules[context.style]) score += styleFit(item, context.style) ? 5 : -1;
  const special = eventBonus[event];
  if (special?.good?.includes(item.category)) score += 6;
  if (special?.bad?.includes(item.category)) score -= 12;
  if (event === 'Собеседование' && item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)) score -= 3;
  // Rank the user's actual wardrobe, not assumed clothing preferences by gender.
  if (temperature !== null) {
    const comfort = warmthFor(temperature);
    // Под тёплой верхней одеждой верх греет меньше решающего, поэтому штраф мягче.
    const weight = garment.section === 'Верхняя одежда' ? 4 : garment.section === 'Верх' && temperature < 5 ? 1.5 : 2.5;
    score -= Math.abs(warmthOf(item) - comfort) * weight;
    if (temperature >= 22 && item.season === 'Зима') score -= 20;
    if (temperature <= 5 && item.season === 'Зима') score += 7;
    if (temperature >= 22 && item.season === 'Лето') score += 5;
  }
  if (garment.section === 'Обувь') {
    if (context.precipitation === 'rain') {
      if (closedWarmShoes.has(item.category)) score += 6;
      if (openShoes.has(item.category) || isSuede(item)) score -= 18;
      if (item.category === 'Кеды' || isLight(item)) score -= 5;
    }
    if (context.precipitation === 'snow') {
      if (closedWarmShoes.has(item.category)) score += 10;
      if (lowShoes.has(item.category) || isSuede(item)) score -= 25;
    }
  }
  if (garment.section === 'Верхняя одежда' && context.precipitation === 'rain' && rainLayers.has(item.category) && !isSuede(item)) score += 6;
  return score;
}

// Насколько тёплой должна быть вещь при такой погоде (в шкале warmth).
function warmthFor(temperature: number) {
  if (temperature >= 25) return 0;
  if (temperature >= 18) return 1;
  if (temperature >= 12) return 2;
  if (temperature >= 5) return 3;
  if (temperature >= -5) return 4;
  return 5;
}

// Советы копятся из разных правил, а показываем мы только три. Без ранга
// наверх всплывало то, что просто посчиталось раньше, и совет «заправь верх» —
// единственный, который меняет и примерку, — вытеснялся замечанием о светлоте.
type Tip = { text: string; rank: number };
const push = (tips: Tip[], rank: number, text: string) => tips.push({ text, rank });
type Translator = (source: string, vars?: Record<string, string | number>) => string;
const originalText: Translator = (source, vars) => Object.entries(vars || {}).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), source);

function colorAdvice(items: WardrobeItem[], tips: Tip[], warnings: string[], reasons: string[], t: Translator) {
  const known = items.map(item => ({ item, info: itemColor(item) })).filter(entry => entry.info) as { item: WardrobeItem; info: ColorInfo }[];
  if (!known.length) return;
  const accents = known.filter(entry => !entry.info.neutral);
  const names = [...new Set(known.map(entry => entry.item.color))];
  if (names.length) reasons.push(t('Палитра: {colors}.', { colors: names.map(color => t(color)).join(', ').toLocaleLowerCase() }));

  if (!accents.length && known.length >= 2) {
    push(tips, 5, t('Образ в нейтральных тонах. Для более выразительного сочетания можно добавить цветной акцент; для спокойного оставить эту палитру.'));
  }
  if (accents.length === 1) {
    push(tips, 4, t('Оставь {item} единственным цветным пятном — остальное лучше держать нейтральным.', { item: named(accents[0].item, t) }));
  }
  if (accents.length === 2) {
    const distance = hueDistance(accents[0].info.hue, accents[1].info.hue);
    const pair = t('{first} и {second}', { first: named(accents[0].item, t), second: named(accents[1].item, t) });
    if (distance <= 30) reasons.push(t('{pair} — соседние оттенки, они складываются в единую гамму.', { pair }));
    else if (distance <= 70) push(tips, 4, t('{pair} близки по тону. Их можно оставить в одной гамме; для большего контраста попробуй нейтральную замену одной вещи.', { pair }));
    else if (distance >= 150) reasons.push(t('{pair} — контрастная пара; она работает, пока одна из вещей занимает меньшую площадь.', { pair }));
    else push(tips, 4, t('{pair} дают выразительное сочетание. Если хочется спокойнее, попробуй нейтральную обувь или замену одного цвета.', { pair }));
  }
  if (accents.length >= 3) {
    push(tips, 4, t('В сочетании несколько цветов: {items}. Для более сдержанного варианта оставь один акцент.', { items: list(accents.map(entry => entry.item), t) }));
  }
  const lightness = known.map(entry => entry.info.lightness);
  if (known.length >= 3 && Math.max(...lightness) - Math.min(...lightness) < 0.14) {
    push(tips, 6, t('Вещи близки по светлоте. Более светлая или тёмная обувь добавит контраста, а текущая палитра сохранит цельный силуэт.'));
  }
}

function formalityAdvice(items: WardrobeItem[], context: OutfitContext, tips: Tip[], warnings: string[], reasons: string[], t: Translator) {
  const wearables = items.filter(item => describe(item).section !== 'Сумки');
  if (wearables.length < 2) return;
  const ranked = [...wearables].sort((a, b) => describe(a).formality - describe(b).formality);
  const lowest = ranked[0], highest = ranked[ranked.length - 1];
  const spread = describe(highest).formality - describe(lowest).formality;
  if (spread >= 3) {
    warnings.push(t('{high} и {low} из разных регистров: одна вещь строгая, другая подчёркнуто простая. Подтяни {low} к остальному образу.', { high: named(highest, t), low: named(lowest, t) }));
  } else if (spread === 2) {
    push(tips, 3, t('{item} снижает градус образа — это уместно, если хочется мягкой, менее формальной подачи.', { item: named(lowest, t) }));
  }
  const target = targetFormality(context);
  const average = wearables.reduce((sum, item) => sum + describe(item).formality, 0) / wearables.length;
  if (context.event && Math.abs(average - target) <= 0.6 && spread <= 2) {
    reasons.push(t('Уровень формальности собран ровно под «{event}».', { event: t(context.event).toLocaleLowerCase() }));
  } else if (context.event && average < target - 1.2) {
    warnings.push(t('Для события «{event}» образ выглядит слишком повседневным. Замени самую простую вещь на более строгую.', { event: t(context.event).toLocaleLowerCase() }));
  } else if (context.event && average > target + 1.2) {
    push(tips, 3, t('Образ строже, чем требует «{event}». Достаточно сменить обувь на более простую, чтобы снять лишний официоз.', { event: t(context.event).toLocaleLowerCase() }));
  }
}

function proportionAdvice(top: WardrobeItem | undefined, bottom: WardrobeItem | undefined, tips: Tip[], t: Translator) {
  if (!top || !bottom) return;
  const topVolume = describe(top).volume, bottomVolume = describe(bottom).volume;
  if (topVolume === 3 && bottomVolume === 3) {
    push(tips, 2, t('Если {top} и {bottom} обе объёмные, попробуй открыть линию талии или взять одну вещь прямого кроя.', { top: named(top, t), bottom: named(bottom, t) }));
  } else if (topVolume === 1 && bottomVolume === 1) {
    push(tips, 2, t('Если оба слоя облегающие, свободная верхняя одежда или прямой низ добавят объёма.'));
  }
}

function weatherAdvice(items: WardrobeItem[], outer: WardrobeItem | undefined, temperature: number, tips: Tip[], warnings: string[], reasons: string[], t: Translator) {
  const comfort = warmthFor(temperature);
  const warmOuter = Boolean(outer && warmthOf(outer) >= 4);
  // Под тёплой курткой верх не мёрзнет, а джинсы в -8 — обычная норма; предупреждаем
  // только о том, что действительно мёрзнет: обувь, открытые ноги, верх без куртки.
  const tooLight = items.filter(item => {
    const section = describe(item).section;
    if (section === 'Сумки' || warmthOf(item) > Math.max(0, comfort - 3)) return false;
    if (section === 'Верх' && warmOuter) return false;
    if (section === 'Низ' && temperature > -12 && !['Шорты', 'Юбка'].includes(item.category)) return false;
    return true;
  });
  const tooWarm = items.filter(item => warmthOf(item) >= comfort + 3);
  if (temperature < 12 && !outer) {
    warnings.push(t('На улице {temperature}°C: для выхода может понадобиться дополнительный слой.', { temperature }));
  }
  if (tooLight.length && temperature < 12) {
    warnings.push(t('При {temperature}°C {items} может не подойти для долгого пребывания на улице.', { temperature, items: list(tooLight, t) }));
  }
  if (tooWarm.length) {
    warnings.push(t('При {temperature}°C {items} будет слишком тёплой вещью.', { temperature, items: list(tooWarm, t) }));
  }
  if (outer && temperature < 12 && !tooWarm.includes(outer)) {
    reasons.push(t('{item} добавляет слой для погоды {temperature}°C; утепление по фото точно не определить.', { item: named(outer, t), temperature }));
  }
  if (temperature >= 12 && temperature < 18 && !outer) {
    push(tips, 3, t('Для {temperature}°C пригодится лёгкий верхний слой на утро и вечер — днём его можно снять.', { temperature }));
  }
}

function precipitationAdvice(outer: WardrobeItem | undefined, shoes: WardrobeItem | undefined, context: OutfitContext, tips: Tip[], warnings: string[], reasons: string[], t: Translator) {
  if (context.precipitation === 'rain') {
    if (outer && rainLayers.has(outer.category) && !isSuede(outer)) reasons.push(t('{item} прикроет от дождя.', { item: named(outer, t) }));
    else if (!outer && context.event !== 'Спортзал') warnings.push(t('Обещают дождь: добавь плащ, тренч или куртку.'));
    if (shoes && (openShoes.has(shoes.category) || isSuede(shoes))) warnings.push(t('{item} промокнет под дождём — лучше закрытая обувь.', { item: named(shoes, t) }));
    else if (shoes && (shoes.category === 'Кеды' || isLight(shoes))) push(tips, 2, t('В дождь {item} быстро испачкаются; ботинки будут практичнее.', { item: named(shoes, t) }));
  }
  if (context.precipitation === 'snow' && shoes && !closedWarmShoes.has(shoes.category)) {
    warnings.push(t('В снег {item} промокнут и будут скользить — лучше ботинки или сапоги.', { item: named(shoes, t) }));
  }
  if (context.wind !== null && context.wind !== undefined && context.wind >= 8 && context.temperature !== null && context.temperature < 20 && !outer) {
    push(tips, 2, t('Ветер {wind} м/с: верхний слой защитит от продувания.', { wind: Math.round(context.wind) }));
  }
}

export function getOutfitAdvice(items: WardrobeItem[], context: OutfitContext, t: Translator = originalText) {
  const top = items.find(item => item.section === 'Верх');
  const bottom = items.find(item => item.section === 'Низ');
  const shoes = items.find(item => item.section === 'Обувь');
  const outer = items.find(item => item.section === 'Верхняя одежда');
  const completePiece = items.some(isOnePiece);
  const warnings: string[] = [];
  const reasons: string[] = [];
  const tips: Tip[] = [];

  const missing = [!top && t('Верх').toLocaleLowerCase(), !bottom && !completePiece && t('Низ').toLocaleLowerCase(), !shoes && t('Обувь').toLocaleLowerCase()].filter(Boolean);
  if (missing.length) warnings.push(t('Неполный образ: ещё нужны {items}.', { items: missing.join(', ') }));
  if (items.some(item => !item.imageUri)) warnings.push(t('У части вещей нет фото: их не получится примерить.'));

  colorAdvice(items, tips, warnings, reasons, t);
  formalityAdvice(items, context, tips, warnings, reasons, t);
  proportionAdvice(top, bottom, tips, t);

  const patterns = items.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern));
  if (patterns.length === 1) push(tips, 4, t('Рисунок на {item} уже задаёт акцент: дополнительные принты не нужны.', { item: named(patterns[0], t) }));
  if (patterns.length > 1) warnings.push(t('Вместе несколько рисунков: {items}. Более спокойный вариант — заменить один из них однотонной вещью.', { items: patterns.map(item => item.name).join(', ') }));

  let tuckMode: 'auto' | 'tucked' | 'untucked' = 'auto';
  if (top && bottom && !completePiece) {
    if (['Рубашка', 'Блуза', 'Поло'].includes(top.category) && targetFormality(context) >= 4) {
      tuckMode = 'tucked';
      push(tips, 1, t('Заправь {top} в {bottom}, если длина позволяет: линия талии будет аккуратнее.', { top: named(top, t), bottom: named(bottom, t) }));
    } else if (describe(top).volume === 3) {
      tuckMode = 'untucked';
      push(tips, 1, t('{item} можно оставить навыпуск; проверь, чтобы низ верха не собирался складками над поясом.', { item: named(top, t) }));
    }
  }

  if (context.event === 'Спортзал') {
    const casual = items.filter(item => !describe(item).sporty && describe(item).section !== 'Сумки');
    if (casual.length) warnings.push(t('Для тренировки {items} не подойдёт: нужен спортивный комплект.', { items: list(casual, t) }));
  }
  if (context.event === 'Прогулка' && shoes) push(tips, 7, t('Для прогулки проверь удобство {item} и запас места в носке.', { item: named(shoes, t) }));
  if (context.temperature !== null) weatherAdvice(items, outer, context.temperature, tips, warnings, reasons, t);
  precipitationAdvice(outer, shoes, context, tips, warnings, reasons, t);

  const ordered = tips.map((tip, index) => ({ tip, index }))
    .sort((a, b) => a.tip.rank - b.tip.rank || a.index - b.index)
    .map(entry => entry.tip.text);
  return { reasons: reasons.slice(0, 3), tips: ordered.slice(0, 3), warnings, tuckMode };
}

export type CriterionKey = 'set' | 'occasion' | 'style' | 'weather' | 'colors';
export type CriterionStatus = 'good' | 'ok' | 'bad' | 'unknown';
export type Criterion = { key: CriterionKey; status: CriterionStatus; note: string; value: number };
export const CRITERION_LABELS: Record<CriterionKey, string> = { set: 'Комплект', occasion: 'Событие', style: 'Стиль', weather: 'Погода', colors: 'Цвета' };
const WEIGHTS: Record<CriterionKey, number> = { set: 20, occasion: 25, weather: 25, style: 15, colors: 15 };
const clamp01 = (value: number) => Math.max(0.1, Math.min(1, value));
// Плавная оценка вместо «да/нет»: иначе почти всё получает 100% и цифра ничего не говорит.
const statusOf = (value: number): CriterionStatus => value >= 0.8 ? 'good' : value >= 0.5 ? 'ok' : 'bad';

/**
 * Проверяемая оценка образа: пять понятных критериев и процент совпадения.
 * Каждый критерий считается по тем же правилам, что и подбор, поэтому
 * «почему подходит» и порядок образов не могут разойтись.
 */
export function evaluateLook(items: WardrobeItem[], context: OutfitContext, t: Translator = originalText) {
  const wearables = items.filter(item => describe(item).section !== 'Сумки');
  const top = items.find(item => item.section === 'Верх');
  const bottom = items.find(item => item.section === 'Низ');
  const shoes = items.find(item => item.section === 'Обувь');
  const outer = items.find(item => item.section === 'Верхняя одежда');
  const onePiece = items.some(isOnePiece);
  const event = context.event ? t(context.event).toLocaleLowerCase() : '';
  const criteria: Criterion[] = [];

  const missing = [!top && t('Верх').toLocaleLowerCase(), !bottom && !onePiece && t('Низ').toLocaleLowerCase(), !shoes && t('Обувь').toLocaleLowerCase()].filter(Boolean) as string[];
  const setValue = !missing.length ? 1 : missing.length === 1 && !shoes ? 0.6 : 0.2;
  criteria.push({ key: 'set', status: statusOf(setValue), value: setValue,
    note: missing.length ? t('Не хватает: {items}.', { items: missing.join(', ') }) : t('Верх, низ и обувь на месте.') });

  if (context.event === 'Спортзал') {
    const casual = wearables.filter(item => !describe(item).sporty);
    const value = !casual.length ? 1 : casual.length === 1 ? 0.55 : 0.2;
    criteria.push({ key: 'occasion', status: statusOf(value), value,
      note: casual.length ? t('Для тренировки не подходит: {items}.', { items: list(casual, t) }) : t('Всё спортивное — удобно тренироваться.') });
  } else if (wearables.length) {
    const target = targetFormality(context);
    const values = wearables.map(item => describe(item).formality);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const spread = Math.max(...values) - Math.min(...values);
    const diff = average - target;
    const special = eventBonus[context.event];
    const unsuitable = special?.bad ? wearables.filter(item => special.bad!.includes(item.category)) : [];
    const value = unsuitable.length ? 0.2 : clamp01(1 - Math.max(0, Math.abs(diff) - 0.3) * 0.35 - Math.max(0, spread - 1) * 0.12);
    const status = statusOf(value);
    const note = unsuitable.length ? t('Для «{event}» не подходит: {items}.', { event, items: list(unsuitable, t) })
      : status === 'good' ? t('Строгость как раз для «{event}».', { event })
      : spread >= 3 ? t('Вещи из разных регистров: строгая и подчёркнуто простая.')
      : diff < 0 ? t('Проще, чем обычно носят на «{event}».', { event }) : t('Строже, чем нужно для «{event}».', { event });
    criteria.push({ key: 'occasion', status, note, value });
  }

  if (styleRules[context.style] && wearables.length) {
    const matching = wearables.filter(item => styleFit(item, context.style));
    const share = matching.length / wearables.length;
    const value = clamp01(0.25 + 0.75 * share);
    criteria.push({ key: 'style', status: statusOf(value), value,
      note: t('{count} из {total} вещей в стиле «{style}».', { count: matching.length, total: wearables.length, style: t(context.style) }) });
  }

  if (context.temperature === null && !context.precipitation) {
    criteria.push({ key: 'weather', status: 'unknown', note: t('Погода не указана.'), value: 0 });
  } else {
    const warnings: string[] = []; const reasons: string[] = []; const tips: Tip[] = [];
    if (context.temperature !== null) weatherAdvice(items, outer, context.temperature, tips, warnings, reasons, t);
    precipitationAdvice(outer, shoes, context, tips, warnings, reasons, t);
    const conditions = [context.temperature !== null ? `${Math.round(context.temperature)}°C` : '',
      context.precipitation === 'rain' ? t('дождь') : context.precipitation === 'snow' ? t('снег') : ''].filter(Boolean).join(', ');
    // Замечания — серьёзно, советы про погоду (кеды в дождь, ветер) — слегка.
    const mild = tips.filter(tip => tip.rank <= 3).length;
    const value = clamp01(1 - warnings.length * 0.35 - mild * 0.12);
    criteria.push({ key: 'weather', status: statusOf(value), value,
      note: warnings.length ? warnings[0] : mild ? tips[0].text : t('Подходит для погоды: {conditions}.', { conditions }) });
  }

  const known = items.map(itemColor).filter(Boolean) as ColorInfo[];
  if (known.length >= 2) {
    const palette = paletteScore(items);
    const patterned = items.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)).length;
    const accents = known.filter(info => !info.neutral).length;
    let value = palette >= 5 ? 1 : palette >= 3 ? 0.9 : palette >= 0 ? 0.68 : palette >= -4 ? 0.45 : 0.25;
    if (patterned > 1) value = Math.min(value, 0.6);
    const status = statusOf(value);
    const note = patterned > 1 ? t('Несколько принтов сразу — смело, но шумно.')
      : status === 'bad' ? t('Цвета спорят между собой.')
      : accents === 0 ? t('Спокойная нейтральная палитра.')
      : accents === 1 ? t('Один цветной акцент на нейтральной базе.') : t('Цвета поддерживают друг друга.');
    criteria.push({ key: 'colors', status, note, value });
  }

  const scored = criteria.filter(criterion => criterion.status !== 'unknown');
  const weight = scored.reduce((sum, criterion) => sum + WEIGHTS[criterion.key], 0);
  let percent = weight ? Math.round(scored.reduce((sum, criterion) => sum + WEIGHTS[criterion.key] * criterion.value, 0) / weight * 100) : 0;
  // Провал по главному не компенсируется красивыми цветами: образ не к месту
  // не бывает «хорошим», а неполный или не по погоде — лучше чем «с оговорками».
  const failed = (key: CriterionKey) => criteria.some(criterion => criterion.key === key && criterion.status === 'bad');
  if (failed('occasion')) percent = Math.min(percent, 45);
  if (failed('set') || failed('weather')) percent = Math.min(percent, 60);
  return { percent, criteria };
}

/** Каких вещей в гардеробе не хватает, чтобы подбор под этот контекст был точным. */
export function wardrobeGaps(items: WardrobeItem[], context: OutfitContext, t: Translator = originalText) {
  const has = (predicate: (item: WardrobeItem) => boolean) => items.some(predicate);
  const gaps: string[] = [];
  if (!has(item => item.section === 'Верх')) gaps.push(t('верха'));
  if (!has(item => item.section === 'Низ' || isOnePiece(item))) gaps.push(t('брюк, юбки или платья'));
  if (!has(item => item.section === 'Обувь')) gaps.push(t('обуви'));
  if (context.event === 'Спортзал') {
    if (!has(item => item.section === 'Верх' && Boolean(describe(item).sporty))) gaps.push(t('спортивного верха'));
    if (!has(item => item.section === 'Низ' && Boolean(describe(item).sporty))) gaps.push(t('спортивного низа'));
    if (!has(item => item.section === 'Обувь' && Boolean(describe(item).sporty))) gaps.push(t('кроссовок'));
  } else if (targetFormality(context) >= 4) {
    if (!has(item => item.section === 'Верх' && describe(item).formality >= 4)) gaps.push(t('рубашки или блузы'));
    if (!has(item => (item.section === 'Низ' || isOnePiece(item)) && describe(item).formality >= 4)) gaps.push(t('брюк, юбки или платья построже'));
    if (!has(item => item.section === 'Обувь' && describe(item).formality >= 4)) gaps.push(t('строгой обуви (лоферы, туфли)'));
  }
  if (context.temperature !== null && context.temperature < 5 && !has(item => item.section === 'Верхняя одежда' && warmthOf(item) >= 4)) gaps.push(t('тёплой верхней одежды'));
  if (((context.temperature !== null && context.temperature < 0) || context.precipitation === 'snow') && !has(item => closedWarmShoes.has(item.category))) gaps.push(t('ботинок или сапог'));
  if (context.precipitation === 'rain' && !has(item => rainLayers.has(item.category))) gaps.push(t('плаща или куртки'));
  if (styleRules[context.style] && !has(item => styleFit(item, context.style))) gaps.push(t('вещей в стиле «{style}»', { style: t(context.style) }));
  return [...new Set(gaps)];
}

export function buildLooks(items: WardrobeItem[], style: string, event: string, weather: string, temperature: number | null, gender: Gender = 'unspecified', beautyAdvice = false, options: RecommendationOptions = {}): GeneratedLook[] {
  const context: OutfitContext = { style, event, temperature, gender, precipitation: options.precipitation ?? null, wind: options.wind ?? null };
  const wardrobe = Array.from(new Map(items.map(item => [item.id, item])).values()).filter(item => !options.excludedIds?.includes(item.id));
  const anchor = wardrobe.find(item => item.id === options.anchorId);
  const hasWinterShoes = wardrobe.some(item => item.section === 'Обувь' && closedWarmShoes.has(item.category));
  const hasWarmOuter = wardrobe.some(item => item.section === 'Верхняя одежда' && warmthOf(item) >= 4);
  const eligible = (item: WardrobeItem) => {
    if (item.id === anchor?.id) return true;
    if (event === 'Спортзал') return Boolean(describe(item).sporty) && item.section !== 'Верхняя одежда';
    if (temperature !== null && temperature >= 24 && (item.season === 'Зима' || ['Пуховик', 'Шуба', 'Парка'].includes(item.category))) return false;
    if (temperature !== null && temperature < 5 && ['Шорты', 'Сандалии'].includes(item.category)) return false;
    if (temperature !== null && temperature < 0 && openShoes.has(item.category)) return false;
    // В мороз лёгкий плащ вместо пуховика — не вариант, если есть тёплая верхняя одежда.
    if (temperature !== null && temperature < 0 && item.section === 'Верхняя одежда' && warmthOf(item) < 4 && hasWarmOuter) return false;
    // В снег низкую обувь не предлагаем, если есть чем её заменить.
    if (context.precipitation === 'snow' && item.section === 'Обувь' && !closedWarmShoes.has(item.category) && hasWinterShoes) return false;
    return true;
  };
  const now = options.now ?? Date.now();
  const preference = (item: WardrobeItem) => itemScore(item, context) + (options.favoriteItemIds?.includes(item.id) ? 2 : 0) + noveltyBonus(item, now);
  const choose = (section: string, limit: number) => {
    if (anchor?.section === section) return [anchor];
    if (anchor && isOnePiece(anchor) && section === 'Низ') return [];
    return wardrobe.filter(item => item.section === section && eligible(item) && !(anchor?.section === 'Низ' && isOnePiece(item)))
      .sort((a, b) => preference(b) - preference(a)).slice(0, limit);
  };
  const tops = choose('Верх', 8), bottoms = choose('Низ', 8), shoes = choose('Обувь', 5), outer = choose('Верхняя одежда', 5);
  const bags = choose('Сумки', 2);
  const optional = (candidates: WardrobeItem[]): (WardrobeItem | null)[] => candidates.length ? candidates : [null];
  const candidates: { items: WardrobeItem[]; score: number; signature: string }[] = [];
  for (const top of optional(tops)) for (const bottom of top && isOnePiece(top) ? [null] : optional(bottoms)) {
    for (const shoe of optional(shoes)) for (const layer of anchor?.section === 'Верхняя одежда' ? outer : [null, ...outer]) {
      const selection = [top, bottom, shoe, layer].filter(Boolean) as WardrobeItem[];
      if (!selection.length) continue;
      let score = selection.reduce((total, item) => total + preference(item), 0) + paletteScore(selection);
      if (top) score += 12;
      if (bottom || (top && isOnePiece(top))) score += 12;
      if (shoe) score += 8;
      if (layer) {
        // 12–17°C — погода лёгкого слоя: тренч, куртка, пиджак; тёплое пальто уже лишнее.
        const light = warmthOf(layer) <= 3;
        // Пиджак на деловом событии — часть образа, а не защита от погоды.
        const tailoring = layer.category === 'Пиджак' && targetFormality(context) >= 4 && (temperature === null || temperature < 27);
        score += tailoring ? 12 : temperature === null ? -8 : temperature < 12 ? 14 - Math.max(0, warmthFor(temperature) - warmthOf(layer)) * 6 : temperature < 18 ? (light ? 8 : -6) : temperature < 22 ? -4 : -35;
        if (context.precipitation === 'rain' && temperature !== null && temperature < 24) score += rainLayers.has(layer.category) ? 10 : 4;
        if ((options.wind ?? 0) >= 8 && temperature !== null && temperature < 20) score += 4;
      } else if (temperature !== null && temperature < 8) score -= 10;
      else if (context.precipitation === 'rain' && event !== 'Спортзал') score -= 8;
      if (event === 'Спортзал' && layer) score -= 25;
      const formalities = selection.filter(item => describe(item).section !== 'Сумки').map(item => describe(item).formality);
      // Разнобой по строгости портит образ сильнее, чем неидеальный отдельный
      // предмет, поэтому штраф берётся от разброса, а не от суммы.
      score -= Math.max(0, Math.max(...formalities) - Math.min(...formalities) - 1) * 6;
      if (top && bottom && describe(top).volume === 3 && describe(bottom).volume === 3) score -= 6;
      const patterned = selection.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)).length;
      score -= Math.max(0, patterned - 1) * 5;
      candidates.push({ items: selection, score, signature: [top?.id, bottom?.id, shoe?.id, layer?.id].join('|') });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const unique = [...new Map([...candidates].reverse().map(candidate => [candidate.signature, candidate])).values()]
    .sort((a, b) => b.score - a.score).slice(0, 80);
  // Не советуем то, что сами же раскритикуем: каждое замечание к образу — штраф.
  // «Неполный образ» и «нет фото» зависят от гардероба, а не от выбора, их не считаем.
  for (const candidate of unique) {
    const { warnings } = getOutfitAdvice(candidate.items, context);
    candidate.score -= warnings.filter(text => !text.startsWith('Неполный') && !text.startsWith('У части вещей')).length * 14;
  }
  unique.sort((a, b) => b.score - a.score);
  const core = (candidate: { items: WardrobeItem[] }) => candidate.items.filter(item => ['Верх', 'Низ'].includes(item.section)).map(item => item.id);
  const selected: typeof candidates = [];
  while (unique.length && selected.length < 4) {
    const adjusted = (candidate: typeof unique[number]) => candidate.score - Math.max(0, ...selected.map(previous => {
      const shared = candidate.items.filter(item => previous.items.some(other => item.id === other.id)).length / Math.max(1, candidate.items.length) * 18;
      // Тот же верх и низ с другой обувью — это не новый образ, а вариант того же.
      const sameCore = core(candidate).length > 0 && core(candidate).every(id => core(previous).includes(id)) ? 30 : 0;
      return shared + sameCore;
    }));
    unique.sort((a, b) => adjusted(b) - adjusted(a));
    const next = unique.shift()!;
    if (selected.length && adjusted(next) < selected[0].score - 32) break;
    selected.push(next);
  }
  const beauty = pickBeauty(event, beautyAdvice);
  return selected.map((candidate, index) => {
    const selection = [...candidate.items];
    if (bags.length && (anchor?.section === 'Сумки' || (event !== 'Спортзал' && itemScore(bags[0], context) >= -4))) selection.push(bags[0]);
    const t = options.t || originalText;
    const advice = getOutfitAdvice(selection, context, t);
    const match = evaluateLook(selection, context);
    return {
      id: `idea-${style}-${event}-${temperature}-${selection.map(item => item.id).join('-')}`, title: selection.filter(item => ['Верх', 'Низ'].includes(item.section)).map(item => t(item.category)).join(' + ') || t('Лук {n}', { n: index + 1 }),
      itemIds: selection.map(item => item.id), weather, style, event, temperature,
      fitReasons: advice.reasons, stylingTips: advice.tips, warnings: advice.warnings,
      tuckMode: advice.tuckMode, makeup: beauty.makeup, hair: beauty.hair,
      matchPercent: match.percent, fitScore: match.percent
    };
  }).sort((a, b) => b.matchPercent - a.matchPercent)
    .filter((look, index, all) => index === 0 || look.matchPercent >= Math.max(45, all[0].matchPercent - 30));
}

export function getOutfitSwaps(selection: WardrobeItem[], wardrobe: WardrobeItem[], context: OutfitContext, anchorId?: string, t: Translator = originalText) {
  const current = new Set(selection.map(item => item.id));
  const swaps: { from: WardrobeItem; to: WardrobeItem; reason: string; gain: number }[] = [];
  for (const from of selection) {
    if (from.id === anchorId) continue;
    for (const to of wardrobe) {
      if (current.has(to.id) || to.section !== from.section || isOnePiece(from) !== isOnePiece(to)) continue;
      if (context.event === 'Спортзал' && !describe(to).sporty) continue;
      const replaced = selection.map(item => item.id === from.id ? to : item);
      const gain = itemScore(to, context) - itemScore(from, context) + paletteScore(replaced) - paletteScore(selection);
      if (gain < 4) continue;
      const reason = context.temperature !== null && Math.abs(describe(to).warmth - warmthFor(context.temperature)) < Math.abs(describe(from).warmth - warmthFor(context.temperature))
        ? t('Ближе к погоде {temperature}°C', { temperature: context.temperature })
        : t(Math.abs(describe(to).formality - targetFormality(context)) < Math.abs(describe(from).formality - targetFormality(context)) ? 'Ближе к выбранному событию' : 'Более спокойная палитра');
      swaps.push({ from, to, reason, gain });
    }
  }
  const sorted = swaps.sort((a, b) => b.gain - a.gain);
  return sorted.filter((swap, index) => sorted.findIndex(other => other.from.id === swap.from.id) === index).slice(0, 2);
}
