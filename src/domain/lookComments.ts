import { WardrobeItem } from '../data/mock';
import { garmentFacts, isNeutralColorName } from './outfits';

type Translator = (source: string, vars?: Record<string, string | number>) => string;
const UNKNOWN = new Set(['', 'Не определено']);
const known = (value?: string) => Boolean(value) && !UNKNOWN.has(value as string) && !String(value).startsWith('#');

/**
 * What the stylist says while a look is being put on: only about the pieces in this look (their real names,
 * colours, patterns and categories), then honest generic tips. It never names or suggests anything else.
 */
export function lookComments(items: WardrobeItem[], t: Translator): string[] {
  const named = (item: WardrobeItem) => t('«{name}»', { name: item.name });
  const pieces = items.filter(item => item.name?.trim());
  const said: string[] = [];
  const colourName = (color: string) => t(color).toLocaleLowerCase();

  if (pieces.length === 1) said.push(t('Примеряем одну вещь: {item}. Так проще понять, твоё ли это.', { item: named(pieces[0]) }));

  const coloured = pieces.filter(item => known(item.color));
  const colours = [...new Set(coloured.map(item => item.color))];
  const accents = colours.filter(color => !isNeutralColorName(color));
  if (coloured.length >= 2) {
    if (colours.length === 1) said.push(t('Всё в одном цвете: {color}. Монохром обычно вытягивает силуэт.', { color: colourName(colours[0]) }));
    else if (accents.length === 1) {
      const carriers = coloured.filter(item => item.color === accents[0]);
      if (carriers.length === 1) said.push(t('Цветовой акцент здесь: {item}. Остальное его спокойно поддерживает.', { item: named(carriers[0]) }));
      else said.push(t('Акцентный цвет здесь: {color}. Остальное его спокойно поддерживает.', { color: colourName(accents[0]) }));
    } else if (!accents.length) said.push(t('Спокойная палитра: {colors}. На таком фоне хорошо читаются силуэт и фактуры.', { colors: colours.map(colourName).join(', ') }));
    else said.push(t('Смелая палитра: {colors}. Сейчас увидим, как эти цвета уживаются вместе.', { colors: colours.map(colourName).join(', ') }));
  }

  const patterned = pieces.filter(item => known(item.pattern) && item.pattern !== 'Однотонный');
  if (patterned.length === 1) said.push(t('Рисунок на {item} уже сам по себе акцент, остальному можно звучать тише.', { item: named(patterned[0]) }));
  if (patterned.length > 1) said.push(t('Здесь сразу несколько рисунков. Посмотрим, не спорят ли они между собой.'));

  const onePiece = pieces.find(item => garmentFacts(item)?.onePiece);
  if (onePiece) said.push(t('{item} уже почти целый образ: смотри на длину и линию талии.', { item: named(onePiece) }));
  const outer = pieces.find(item => item.section === 'Верхняя одежда');
  if (outer) said.push(t('Верхний слой здесь: {item}. Когда картинка будет готова, глянь на линию плеч и длину.', { item: named(outer) }));
  const shoes = pieces.find(item => item.section === 'Обувь');
  if (shoes) said.push(t('Обувь здесь: {item}. Часто именно она решает, будет образ строже или расслабленнее.', { item: named(shoes) }));

  const top = pieces.find(item => item.section === 'Верх' && !garmentFacts(item)?.onePiece);
  const bottom = pieces.find(item => item.section === 'Низ');
  const topVolume = top && garmentFacts(top)?.volume, bottomVolume = bottom && garmentFacts(bottom)?.volume;
  if (topVolume === 3 && bottomVolume && bottomVolume < 3) said.push(t('Объёмный верх и более собранный низ: проверенный способ держать баланс.'));
  if (topVolume === 3 && bottomVolume === 3) said.push(t('И верх, и низ объёмные. Посмотрим, как ляжет такой свободный силуэт.'));

  const formality = pieces.filter(item => !['Сумки', 'Аксессуары'].includes(item.section)).map(item => garmentFacts(item)?.formality).filter(Boolean) as number[];
  if (formality.length >= 2 && Math.max(...formality) - Math.min(...formality) >= 3) said.push(t('Тут встретились строгое и расслабленное. Такой контраст часто делает образ живым.'));

  return [...said,
    t('Сначала посмотри на образ целиком, а потом уже на детали.'),
    t('Картинка покажет сочетание и силуэт, но не точный размер. Посадку лучше проверить вживую.'),
    t('Сомневаешься в цвете? Сравни результат с исходным фото кнопкой «До».'),
  ];
}
