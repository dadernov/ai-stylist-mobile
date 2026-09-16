import { WardrobeItem } from '../data/mock';
import { GeneratedLook } from '../types/looks';
import { Gender } from '../types/profile';
import { pickBeauty } from '../constants/beauty';

export type OutfitContext = { style: string; event: string; temperature: number | null; gender?: Gender };
const onePiece = new Set(['Платье', 'Сарафан', 'Комбинезон']);
const sport = new Set(['Футболка', 'Майка', 'Топ', 'Худи', 'Свитшот', 'Леггинсы', 'Джоггеры', 'Шорты', 'Кроссовки', 'Кеды']);
const formal = new Set(['Рубашка', 'Блуза', 'Поло', 'Пиджак', 'Брюки', 'Юбка', 'Лоферы', 'Туфли', 'Пальто', 'Тренч']);
const heavyOuter = new Set(['Пуховик', 'Шуба', 'Парка', 'Пальто']);
const neutrals = new Set(['Белый', 'Молочный', 'Кремовый', 'Бежевый', 'Песочный', 'Черный', 'Графит', 'Серый', 'Серебристый', 'Коричневый']);
const colors: Record<string, string> = {
  Белый: '#ffffff', Молочный: '#f5f2e8', Кремовый: '#f3ead6', Бежевый: '#c5b39a', Черный: '#181818', Графит: '#393939',
  Серый: '#8a8a8a', Синий: '#294979', 'Синий деним': '#456a8d', Голубой: '#8abbd5', Зеленый: '#44825a',
  Оливковый: '#83875c', Хаки: '#777c56', Красный: '#b9383e', Розовый: '#dfa1b0', Бордовый: '#73384b',
  Коричневый: '#82634e', Желтый: '#e2c455', Оранжевый: '#d68443', Фиолетовый: '#806296', Лавандовый: '#b4a0c6'
};

function colorInfo(color: string) {
  const hex = colors[color] || (/^#[a-f\d]{6}$/i.test(color) ? color : undefined);
  if (!hex) return null;
  const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = delta === 0 ? 0 : max === rgb[0] ? ((rgb[1] - rgb[2]) / delta) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, neutral: neutrals.has(color) || delta < 0.14 || max < 0.22 };
}

function paletteScore(items: WardrobeItem[]) {
  const chromatic = items.map(item => colorInfo(item.color)).filter(value => value && !value.neutral) as { hue: number }[];
  if (chromatic.length < 2) return 5;
  let score = 0;
  for (let i = 0; i < chromatic.length; i++) for (let j = i + 1; j < chromatic.length; j++) {
    const distance = Math.min(Math.abs(chromatic[i].hue - chromatic[j].hue), 360 - Math.abs(chromatic[i].hue - chromatic[j].hue));
    score += distance <= 50 ? 2 : distance >= 150 && chromatic.length <= 2 ? 1 : -2;
  }
  return score;
}

function itemScore(item: WardrobeItem, context: OutfitContext) {
  let score = item.imageUri ? 2 : 0;
  const { style, event, temperature, gender } = context;
  if (event === 'Спортзал') score += sport.has(item.category) ? 12 : -35;
  if (event === 'Совещание' || style === 'Офисный') score += formal.has(item.category) ? 10 : ['Худи', 'Шорты', 'Леггинсы', 'Джоггеры'].includes(item.category) ? -20 : 0;
  if (style === 'Спорт-шик') score += sport.has(item.category) ? 7 : 0;
  if (style === 'Минимализм') score += item.pattern === 'Однотонный' ? 5 : -3;
  if (style === 'Бохо') score += ['Кардиган', 'Джинсы', 'Сандалии', 'Юбка', 'Рубашка'].includes(item.category) ? 4 : 0;
  if (style === 'Романтичный') score += ['Рубашка', 'Кардиган', 'Блуза', 'Платье', 'Юбка', 'Лоферы'].includes(item.category) ? 4 : 0;
  if (event === 'Прогулка') score += ['Кеды', 'Кроссовки', 'Джинсы', 'Футболка', 'Лонгслив'].includes(item.category) ? 4 : 0;
  if (gender === 'male') score += ['Рубашка', 'Поло', 'Брюки', 'Джинсы', 'Лоферы', 'Свитер'].includes(item.category) ? 2 : 0;
  if (temperature !== null) {
    if (temperature >= 22 && (item.season === 'Зима' || heavyOuter.has(item.category))) score -= 35;
    if (temperature <= 8 && ['Шорты', 'Сандалии'].includes(item.category)) score -= 25;
    if (temperature <= 5 && item.season === 'Зима') score += 7;
    if (temperature >= 22 && item.season === 'Лето') score += 5;
  }
  return score;
}

export function getOutfitAdvice(items: WardrobeItem[], context: OutfitContext) {
  const top = items.find(item => item.section === 'Верх');
  const bottom = items.find(item => item.section === 'Низ');
  const shoes = items.find(item => item.section === 'Обувь');
  const outer = items.find(item => item.section === 'Верхняя одежда');
  const completePiece = items.some(item => onePiece.has(item.category));
  const warnings: string[] = [];
  const reasons: string[] = [];
  const tips: string[] = [];
  const missing = [!top && 'верх', !bottom && !completePiece && 'низ', !shoes && 'обувь'].filter(Boolean);
  if (missing.length) warnings.push(`Неполный образ: ещё нужны ${missing.join(', ')}.`);
  if (items.some(item => !item.imageUri)) warnings.push('У части вещей нет фото: их не получится примерить.');

  const knownColors = [...new Set(items.map(item => item.color).filter(color => Boolean(colorInfo(color))))];
  const accent = items.filter(item => { const info = colorInfo(item.color); return info && !info.neutral; });
  if (knownColors.length) reasons.push(`Палитра: ${knownColors.join(', ').toLocaleLowerCase()}.`);
  if (accent.length === 1) tips.push(`Оставь «${accent[0].name}» цветовым акцентом; остальные детали можно сохранить спокойными.`);
  const patterns = items.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern));
  if (patterns.length === 1) tips.push(`Рисунок на «${patterns[0].name}» уже задаёт акцент: дополнительные принты не нужны.`);
  if (patterns.length > 1) warnings.push(`Вместе несколько рисунков: ${patterns.map(item => item.name).join(', ')}. Более спокойный вариант — заменить один из них однотонной вещью.`);

  let tuckMode: 'auto' | 'tucked' | 'untucked' = 'auto';
  if (top && bottom && !completePiece) {
    if (['Рубашка', 'Блуза', 'Поло'].includes(top.category) && (context.event === 'Совещание' || context.style === 'Офисный')) {
      tuckMode = 'tucked';
      tips.push(`Заправь «${top.name}» в «${bottom.name}», если длина позволяет: линия талии будет аккуратнее.`);
    } else if (['Худи', 'Свитшот', 'Свитер', 'Кардиган'].includes(top.category)) {
      tuckMode = 'untucked';
      tips.push(`«${top.name}» можно оставить навыпуск; проверь, чтобы низ верха не собирался складками над поясом.`);
    } else tips.push(`Сравни «${top.name}» с «${bottom.name}» по объёму: свободный верх проще сбалансировать более прямым низом.`);
  }
  if (context.event === 'Прогулка' && shoes) tips.push(`Для прогулки проверь удобство «${shoes.name}» и запас места в носке.`);
  if (context.event === 'Совещание') {
    const casual = items.filter(item => ['Худи', 'Шорты', 'Леггинсы', 'Джоггеры'].includes(item.category));
    if (casual.length) warnings.push(`Для строгого дресс-кода ${casual.map(item => `«${item.name}»`).join(', ')} может не подойти.`);
    else if (!missing.length) reasons.push('В комплекте нет выраженно спортивных вещей; проверь дресс-код встречи.');
  }
  if (context.event === 'Спортзал' && items.some(item => !sport.has(item.category))) warnings.push('В этом наборе есть неспортивные вещи: полноценный комплект для тренировки не собран.');
  if (context.temperature !== null) {
    if (context.temperature <= 8) {
      const light = items.filter(item => ['Шорты', 'Сандалии'].includes(item.category));
      if (light.length) warnings.push(`При ${context.temperature}°C ${light.map(item => `«${item.name}»`).join(', ')} может не подойти для долгого пребывания на улице.`);
    }
    if (context.temperature < 12 && !outer) warnings.push(`На улице ${context.temperature}°C: для выхода может понадобиться дополнительный слой.`);
    if (context.temperature >= 22 && outer) warnings.push(`При ${context.temperature}°C «${outer.name}» может быть слишком тёплой вещью.`);
    if (context.temperature < 12 && outer) reasons.push(`«${outer.name}» добавляет слой для погоды ${context.temperature}°C; утепление по фото точно не определить.`);
  }
  return { reasons: reasons.slice(0, 3), tips: tips.slice(0, 3), warnings, tuckMode };
}

export function buildLooks(items: WardrobeItem[], style: string, event: string, weather: string, temperature: number | null, gender: Gender = 'unspecified', beautyAdvice = false): GeneratedLook[] {
  const context = { style, event, temperature, gender };
  const wardrobe = Array.from(new Map(items.map(item => [item.id, item])).values());
  const choose = (section: string, limit: number) => wardrobe.filter(item => item.section === section)
    .sort((a, b) => itemScore(b, context) - itemScore(a, context)).slice(0, limit);
  const tops = choose('Верх', 6), bottoms = choose('Низ', 6), shoes = choose('Обувь', 4), outer = choose('Верхняя одежда', 4);
  const bags = choose('Сумки', 2);
  const optional = (list: WardrobeItem[]): (WardrobeItem | null)[] => list.length ? list : [null];
  const candidates: { items: WardrobeItem[]; score: number; signature: string }[] = [];
  for (const top of optional(tops)) for (const bottom of top && onePiece.has(top.category) ? [null] : optional(bottoms)) {
    for (const shoe of optional(shoes)) for (const layer of [null, ...outer]) {
      const selection = [top, bottom, shoe, layer].filter(Boolean) as WardrobeItem[];
      if (!selection.length) continue;
      let score = selection.reduce((total, item) => total + itemScore(item, context), 0) + paletteScore(selection);
      if (top) score += 12;
      if (bottom || (top && onePiece.has(top.category))) score += 12;
      if (shoe) score += 8;
      if (layer) score += temperature === null ? -8 : temperature < 12 ? 14 : temperature < 20 ? -4 : -35;
      else if (temperature !== null && temperature < 8) score -= 10;
      if (context.event === 'Спортзал' && layer) score -= 25;
      const patterned = selection.filter(item => item.pattern && !['Однотонный', 'Не определено'].includes(item.pattern)).length;
      score -= Math.max(0, patterned - 1) * 5;
      candidates.push({ items: selection, score, signature: [top?.id, bottom?.id, shoe?.id].join('|') });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const unique = candidates.filter((candidate, index, all) => all.findIndex(other => other.signature === candidate.signature) === index);
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
    if (bags.length && event !== 'Спортзал' && itemScore(bags[0], context) >= 0) selection.push(bags[0]);
    const advice = getOutfitAdvice(selection, context);
    return {
      id: `look-${Date.now()}-${index}`, title: selection.filter(item => ['Верх', 'Низ'].includes(item.section)).map(item => item.category).join(' + ') || `Образ ${index + 1}`,
      itemIds: selection.map(item => item.id), weather, style, event, temperature,
      fitReasons: advice.reasons, stylingTips: advice.tips, warnings: advice.warnings,
      tuckMode: advice.tuckMode, makeup: beauty.makeup, hair: beauty.hair
    };
  });
}
