import { WardrobeItem } from '../data/mock';
import { GeneratedLook } from '../types/looks';
import { Gender } from '../types/profile';
import { pickBeauty } from '../constants/beauty';

export type OutfitContext = { style: string; event: string; temperature: number | null; gender?: Gender };
export type RecommendationOptions = { anchorId?: string; excludedIds?: string[]; favoriteItemIds?: string[] };

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
const named = (item: WardrobeItem) => `«${item.name}»`;
const list = (items: WardrobeItem[]) => items.map(named).join(', ');

// Событие задаёт целевую строгость образа, стиль её уточняет.
const eventFormality: Record<string, number> = { Совещание: 4.5, Вечеринка: 4, Свидание: 3.5, Прогулка: 2.5, Спортзал: 1 };
const styleFormality: Record<string, number> = { Офисный: 4.5, Классика: 4.5, Минимализм: 3.5, Романтичный: 3.5, Бохо: 2.5, Кэжуал: 2.5, 'Спорт-шик': 1.5 };

function targetFormality(context: OutfitContext) {
  const values = [eventFormality[context.event], styleFormality[context.style]].filter(value => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 3;
}

const neutralNames = new Set(['Белый', 'Молочный', 'Кремовый', 'Бежевый', 'Песочный', 'Черный', 'Чёрный', 'Графит', 'Серый', 'Серебристый', 'Коричневый']);
const colors: Record<string, string> = {
  Белый: '#ffffff', Молочный: '#f5f2e8', Кремовый: '#f3ead6', Бежевый: '#c5b39a', Песочный: '#d8c8a8', Черный: '#181818', Чёрный: '#181818',
  Графит: '#393939', Серый: '#8a8a8a', Серебристый: '#c0c0c0', Синий: '#294979', 'Синий деним': '#456a8d', Голубой: '#8abbd5',
  Зеленый: '#44825a', Зелёный: '#44825a', Оливковый: '#83875c', Хаки: '#777c56', Красный: '#b9383e', Розовый: '#dfa1b0', Бордовый: '#73384b',
  Коричневый: '#82634e', Желтый: '#e2c455', Жёлтый: '#e2c455', Оранжевый: '#d68443', Фиолетовый: '#806296', Лавандовый: '#b4a0c6'
};

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
  const neutral = neutralNames.has(color) || saturation < 0.2 || lightness < 0.16 || lightness > 0.93;
  return { hue, saturation, lightness, neutral };
}

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function paletteScore(items: WardrobeItem[]) {
  const accents = items.map(item => colorInfo(item.color)).filter(info => info && !info.neutral) as ColorInfo[];
  if (accents.length < 2) return 5;
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

function itemScore(item: WardrobeItem, context: OutfitContext) {
  const garment = describe(item);
  const { event, temperature, gender } = context;
  let score = item.imageUri ? 2 : 0;
  score -= Math.abs(garment.formality - targetFormality(context)) * 3;
  if (event === 'Спортзал') score += garment.sporty ? 12 : -35;
  if (context.style === 'Минимализм') score += item.pattern === 'Однотонный' ? 5 : -3;
  if (context.style === 'Бохо' && ['Кардиган', 'Джинсы', 'Сандалии', 'Юбка', 'Рубашка'].includes(item.category)) score += 4;
  if (context.style === 'Романтичный' && ['Блуза', 'Платье', 'Юбка', 'Балетки', 'Кардиган'].includes(item.category)) score += 4;
  // Rank the user's actual wardrobe, not assumed clothing preferences by gender.
  if (temperature !== null) {
    const comfort = warmthFor(temperature);
    score -= Math.abs(garment.warmth - comfort) * (garment.section === 'Верхняя одежда' ? 4 : 2.5);
    if (temperature >= 22 && item.season === 'Зима') score -= 20;
    if (temperature <= 5 && item.season === 'Зима') score += 7;
    if (temperature >= 22 && item.season === 'Лето') score += 5;
  }
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

function colorAdvice(items: WardrobeItem[], tips: Tip[], warnings: string[], reasons: string[]) {
  const known = items.map(item => ({ item, info: colorInfo(item.color) })).filter(entry => entry.info) as { item: WardrobeItem; info: ColorInfo }[];
  if (!known.length) return;
  const accents = known.filter(entry => !entry.info.neutral);
  const names = [...new Set(known.map(entry => entry.item.color))];
  if (names.length) reasons.push(`Палитра: ${names.join(', ').toLocaleLowerCase()}.`);

  if (!accents.length && known.length >= 2) {
    push(tips, 5, 'Образ в нейтральных тонах. Для более выразительного сочетания можно добавить цветной акцент; для спокойного оставить эту палитру.');
  }
  if (accents.length === 1) {
    push(tips, 4, `Оставь ${named(accents[0].item)} единственным цветным пятном — остальное лучше держать нейтральным.`);
  }
  if (accents.length === 2) {
    const distance = hueDistance(accents[0].info.hue, accents[1].info.hue);
    const pair = `${named(accents[0].item)} и ${named(accents[1].item)}`;
    if (distance <= 30) reasons.push(`${pair} — соседние оттенки, они складываются в единую гамму.`);
    else if (distance <= 70) push(tips, 4, `${pair} близки по тону. Их можно оставить в одной гамме; для большего контраста попробуй нейтральную замену одной вещи.`);
    else if (distance >= 150) reasons.push(`${pair} — контрастная пара; она работает, пока одна из вещей занимает меньшую площадь.`);
    else push(tips, 4, `${pair} дают выразительное сочетание. Если хочется спокойнее, попробуй нейтральную обувь или замену одного цвета.`);
  }
  if (accents.length >= 3) {
    push(tips, 4, `В сочетании несколько цветов: ${list(accents.map(entry => entry.item))}. Для более сдержанного варианта оставь один акцент.`);
  }
  const lightness = known.map(entry => entry.info.lightness);
  if (known.length >= 3 && Math.max(...lightness) - Math.min(...lightness) < 0.14) {
    push(tips, 6, 'Вещи близки по светлоте. Более светлая или тёмная обувь добавит контраста, а текущая палитра сохранит цельный силуэт.');
  }
}

function formalityAdvice(items: WardrobeItem[], context: OutfitContext, tips: Tip[], warnings: string[], reasons: string[]) {
  const wearables = items.filter(item => describe(item).section !== 'Сумки');
  if (wearables.length < 2) return;
  const ranked = [...wearables].sort((a, b) => describe(a).formality - describe(b).formality);
  const lowest = ranked[0], highest = ranked[ranked.length - 1];
  const spread = describe(highest).formality - describe(lowest).formality;
  if (spread >= 3) {
    warnings.push(`${named(highest)} и ${named(lowest)} из разных регистров: одна вещь строгая, другая подчёркнуто простая. Подтяни ${named(lowest)} к остальному образу.`);
  } else if (spread === 2) {
    push(tips, 3, `${named(lowest)} снижает градус образа — это уместно, если хочется мягкой, менее формальной подачи.`);
  }
  const target = targetFormality(context);
  const average = wearables.reduce((sum, item) => sum + describe(item).formality, 0) / wearables.length;
  if (context.event && Math.abs(average - target) <= 0.6 && spread <= 2) {
    reasons.push(`Уровень формальности собран ровно под «${context.event.toLocaleLowerCase()}».`);
  } else if (context.event && average < target - 1.2) {
    warnings.push(`Для события «${context.event.toLocaleLowerCase()}» образ выглядит слишком повседневным. Замени самую простую вещь на более строгую.`);
  } else if (context.event && average > target + 1.2) {
    push(tips, 3, `Образ строже, чем требует «${context.event.toLocaleLowerCase()}». Достаточно сменить обувь на более простую, чтобы снять лишний официоз.`);
  }
}

function proportionAdvice(top: WardrobeItem | undefined, bottom: WardrobeItem | undefined, tips: Tip[]) {
  if (!top || !bottom) return;
  const topVolume = describe(top).volume, bottomVolume = describe(bottom).volume;
  if (topVolume === 3 && bottomVolume === 3) {
    push(tips, 2, `Если ${named(top)} и ${named(bottom)} обе объёмные, попробуй открыть линию талии или взять одну вещь прямого кроя.`);
  } else if (topVolume === 1 && bottomVolume === 1) {
    push(tips, 2, 'Если оба слоя облегающие, свободная верхняя одежда или прямой низ добавят объёма.');
  }
}

function weatherAdvice(items: WardrobeItem[], outer: WardrobeItem | undefined, temperature: number, tips: Tip[], warnings: string[], reasons: string[]) {
  const comfort = warmthFor(temperature);
  const tooLight = items.filter(item => describe(item).section !== 'Сумки' && describe(item).warmth <= Math.max(0, comfort - 3));
  const tooWarm = items.filter(item => describe(item).warmth >= comfort + 3);
  if (temperature < 12 && !outer) {
    warnings.push(`На улице ${temperature}°C: для выхода может понадобиться дополнительный слой.`);
  }
  if (tooLight.length && temperature < 12) {
    warnings.push(`При ${temperature}°C ${list(tooLight)} может не подойти для долгого пребывания на улице.`);
  }
  if (tooWarm.length) {
    warnings.push(`При ${temperature}°C ${list(tooWarm)} будет слишком тёплой вещью.`);
  }
  if (outer && temperature < 12 && !tooWarm.includes(outer)) {
    reasons.push(`${named(outer)} добавляет слой для погоды ${temperature}°C; утепление по фото точно не определить.`);
  }
  if (temperature >= 12 && temperature < 18 && !outer) {
    push(tips, 3, `Для ${temperature}°C пригодится лёгкий верхний слой на утро и вечер — днём его можно снять.`);
  }
}

export function getOutfitAdvice(items: WardrobeItem[], context: OutfitContext) {
  const top = items.find(item => item.section === 'Верх');
  const bottom = items.find(item => item.section === 'Низ');
  const shoes = items.find(item => item.section === 'Обувь');
  const outer = items.find(item => item.section === 'Верхняя одежда');
  const completePiece = items.some(isOnePiece);
  const warnings: string[] = [];
  const reasons: string[] = [];
  const tips: Tip[] = [];

  const missing = [!top && 'верх', !bottom && !completePiece && 'низ', !shoes && 'обувь'].filter(Boolean);
  if (missing.length) warnings.push(`Неполный образ: ещё нужны ${missing.join(', ')}.`);
  if (items.some(item => !item.imageUri)) warnings.push('У части вещей нет фото: их не получится примерить.');

  colorAdvice(items, tips, warnings, reasons);
  formalityAdvice(items, context, tips, warnings, reasons);
  proportionAdvice(top, bottom, tips);

  const patterns = items.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern));
  if (patterns.length === 1) push(tips, 4, `Рисунок на ${named(patterns[0])} уже задаёт акцент: дополнительные принты не нужны.`);
  if (patterns.length > 1) warnings.push(`Вместе несколько рисунков: ${patterns.map(item => item.name).join(', ')}. Более спокойный вариант — заменить один из них однотонной вещью.`);

  let tuckMode: 'auto' | 'tucked' | 'untucked' = 'auto';
  if (top && bottom && !completePiece) {
    if (['Рубашка', 'Блуза', 'Поло'].includes(top.category) && targetFormality(context) >= 4) {
      tuckMode = 'tucked';
      push(tips, 1, `Заправь ${named(top)} в ${named(bottom)}, если длина позволяет: линия талии будет аккуратнее.`);
    } else if (describe(top).volume === 3) {
      tuckMode = 'untucked';
      push(tips, 1, `${named(top)} можно оставить навыпуск; проверь, чтобы низ верха не собирался складками над поясом.`);
    }
  }

  if (context.event === 'Спортзал') {
    const casual = items.filter(item => !describe(item).sporty && describe(item).section !== 'Сумки');
    if (casual.length) warnings.push(`Для тренировки ${list(casual)} не подойдёт: нужен спортивный комплект.`);
  }
  if (context.event === 'Прогулка' && shoes) push(tips, 7, `Для прогулки проверь удобство ${named(shoes)} и запас места в носке.`);
  if (context.temperature !== null) weatherAdvice(items, outer, context.temperature, tips, warnings, reasons);

  const ordered = tips.map((tip, index) => ({ tip, index }))
    .sort((a, b) => a.tip.rank - b.tip.rank || a.index - b.index)
    .map(entry => entry.tip.text);
  return { reasons: reasons.slice(0, 3), tips: ordered.slice(0, 3), warnings, tuckMode };
}

export function buildLooks(items: WardrobeItem[], style: string, event: string, weather: string, temperature: number | null, gender: Gender = 'unspecified', beautyAdvice = false, options: RecommendationOptions = {}): GeneratedLook[] {
  const context = { style, event, temperature, gender };
  const wardrobe = Array.from(new Map(items.map(item => [item.id, item])).values()).filter(item => !options.excludedIds?.includes(item.id));
  const anchor = wardrobe.find(item => item.id === options.anchorId);
  const eligible = (item: WardrobeItem) => {
    if (item.id === anchor?.id) return true;
    if (event === 'Спортзал') return Boolean(describe(item).sporty) && item.section !== 'Верхняя одежда';
    if (temperature !== null && temperature >= 24 && (item.season === 'Зима' || ['Пуховик', 'Шуба', 'Парка'].includes(item.category))) return false;
    if (temperature !== null && temperature < 5 && ['Шорты', 'Сандалии'].includes(item.category)) return false;
    return true;
  };
  const preference = (item: WardrobeItem) => itemScore(item, context) + (options.favoriteItemIds?.includes(item.id) ? 2 : 0);
  const choose = (section: string, limit: number) => {
    if (anchor?.section === section) return [anchor];
    if (anchor && isOnePiece(anchor) && section === 'Низ') return [];
    return wardrobe.filter(item => item.section === section && eligible(item) && !(anchor?.section === 'Низ' && isOnePiece(item)))
      .sort((a, b) => preference(b) - preference(a)).slice(0, limit);
  };
  const tops = choose('Верх', 6), bottoms = choose('Низ', 6), shoes = choose('Обувь', 4), outer = choose('Верхняя одежда', 4);
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
      if (layer) score += temperature === null ? -8 : temperature < 12 ? 14 : temperature < 20 ? -4 : -35;
      else if (temperature !== null && temperature < 8) score -= 10;
      if (event === 'Спортзал' && layer) score -= 25;
      const formalities = selection.filter(item => describe(item).section !== 'Сумки').map(item => describe(item).formality);
      // Разнобой по строгости портит образ сильнее, чем неидеальный отдельный
      // предмет, поэтому штраф берётся от разброса, а не от суммы.
      score -= Math.max(0, Math.max(...formalities) - Math.min(...formalities) - 1) * 6;
      if (top && bottom && describe(top).volume === 3 && describe(bottom).volume === 3) score -= 6;
      const patterned = selection.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)).length;
      score -= Math.max(0, patterned - 1) * 5;
      candidates.push({ items: selection, score, signature: [top?.id, bottom?.id, shoe?.id].join('|') });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const unique = [...new Map([...candidates].reverse().map(candidate => [candidate.signature, candidate])).values()].sort((a, b) => b.score - a.score);
  const selected: typeof candidates = [];
  while (unique.length && selected.length < 4) {
    unique.sort((a, b) => {
      const adjusted = (candidate: typeof a) => candidate.score - Math.max(0, ...selected.map(previous =>
        candidate.items.filter(item => previous.items.some(other => item.id === other.id)).length / Math.max(1, candidate.items.length) * 18));
      return adjusted(b) - adjusted(a);
    });
    const next = unique.shift()!;
    if (selected.length && next.score < selected[0].score - 18) continue;
    selected.push(next);
  }
  const beauty = pickBeauty(event, beautyAdvice);
  return selected.map((candidate, index) => {
    const selection = [...candidate.items];
    if (bags.length && (anchor?.section === 'Сумки' || (event !== 'Спортзал' && itemScore(bags[0], context) >= -4))) selection.push(bags[0]);
    const advice = getOutfitAdvice(selection, context);
    return {
      id: `idea-${style}-${event}-${temperature}-${selection.map(item => item.id).join('-')}`, title: selection.filter(item => ['Верх', 'Низ'].includes(item.section)).map(item => item.category).join(' + ') || `Образ ${index + 1}`,
      itemIds: selection.map(item => item.id), weather, style, event, temperature,
      fitReasons: advice.reasons, stylingTips: advice.tips, warnings: advice.warnings,
      tuckMode: advice.tuckMode, makeup: beauty.makeup, hair: beauty.hair
    };
  });
}

export function getOutfitSwaps(selection: WardrobeItem[], wardrobe: WardrobeItem[], context: OutfitContext, anchorId?: string) {
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
        ? `Ближе к погоде ${context.temperature}°C`
        : Math.abs(describe(to).formality - targetFormality(context)) < Math.abs(describe(from).formality - targetFormality(context)) ? 'Ближе к выбранному событию' : 'Более спокойная палитра';
      swaps.push({ from, to, reason, gain });
    }
  }
  const sorted = swaps.sort((a, b) => b.gain - a.gain);
  return sorted.filter((swap, index) => sorted.findIndex(other => other.from.id === swap.from.id) === index).slice(0, 2);
}
