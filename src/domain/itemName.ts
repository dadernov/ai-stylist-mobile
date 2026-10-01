import { WardrobeItem } from '../data/mock';
import { getActiveLang, Lang, translate, translateIn } from '../constants/i18n';

// Имя вещи по умолчанию — то, что определил анализ: «Оранжевая футболка»,
// «Чёрные джинсы», «Белая рубашка в полоску». Прилагательное согласуется с
// родом и числом категории, иначе выходит «Черный футболка».
type Form = 'm' | 'f' | 'n' | 'pl';
const forms: Record<string, Form> = {
  Футболка: 'f', Поло: 'n', Лонгслив: 'm', Рубашка: 'f', Блуза: 'f', Топ: 'm', Майка: 'f', Водолазка: 'f', Свитер: 'm',
  Худи: 'n', Свитшот: 'm', Кардиган: 'm', Жилет: 'm', Пиджак: 'm', Бомбер: 'm', Куртка: 'f', Пальто: 'n', Тренч: 'm',
  Плащ: 'm', Пуховик: 'm', Парка: 'f', Платье: 'n', Сарафан: 'm', Комбинезон: 'm', Юбка: 'f', 'Мини-юбка': 'f',
  'Миди-юбка': 'f', 'Макси-юбка': 'f', Джинсы: 'pl', Брюки: 'pl', Шорты: 'pl', Леггинсы: 'pl', Колготки: 'pl', Джоггеры: 'pl',
  Кроссовки: 'pl', Кеды: 'pl', Лоферы: 'pl', Туфли: 'pl', Ботинки: 'pl', Сандалии: 'pl', Сапоги: 'pl', Балетки: 'pl',
  Сумка: 'f', Рюкзак: 'm', Клатч: 'm',
};
// Цвета-существительные и несклоняемые — к прилагательному или после названия.
const colorAdjective: Record<string, string> = { Графит: 'Графитовый', 'Синий деним': 'Синий', Чёрный: 'Черный', Зелёный: 'Зеленый', Жёлтый: 'Желтый' };
const postfixColor: Record<string, string> = { Хаки: 'хаки' };
const patternSuffix: Record<string, string> = { Полоска: 'в полоску', Клетка: 'в клетку', Горох: 'в горошек', Цветочный: 'с цветочным принтом' };
const patternEn: Record<string, string> = { Полоска: 'striped', Клетка: 'checked', Горох: 'polka-dot', Цветочный: 'floral' };
const patternZh: Record<string, string> = { Полоска: '条纹', Клетка: '格纹', Горох: '波点', Цветочный: '碎花' };
const unknown = (value?: string) => !value || value === 'Не определено';

function agree(adjective: string, form: Form) {
  if (form === 'm') return adjective;
  const soft = adjective.endsWith('ний');
  const stem = adjective.slice(0, -2);
  if (form === 'f') return stem + (soft ? 'яя' : 'ая');
  if (form === 'n') return stem + (soft ? 'ее' : 'ое');
  return stem + (soft ? 'ие' : /[гкхжшчщ]$/.test(stem) ? 'ие' : 'ые');
}

const lowerFirst = (text: string) => text && /^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLocaleLowerCase() + text.slice(1) : text;
const upperFirst = (text: string) => text ? text[0].toLocaleUpperCase() + text.slice(1) : text;

/** Имя по категории, цвету и узору на языке интерфейса; пусто, если категория не определена. */
export function suggestItemName(item: Pick<WardrobeItem, 'category' | 'color' | 'pattern'>, lang: Lang = getActiveLang()) {
  if (unknown(item.category)) return '';
  const color = unknown(item.color) ? '' : item.color;
  const pattern = unknown(item.pattern) || item.pattern === 'Однотонный' ? '' : item.pattern;
  if (lang === 'en') {
    const words = [pattern && patternEn[pattern], color && translateIn('en', color).toLocaleLowerCase(), lowerFirst(translateIn('en', item.category))].filter(Boolean);
    return upperFirst(words.join(' '));
  }
  if (lang === 'zh') {
    return [pattern && patternZh[pattern], color && translateIn('zh', color), translateIn('zh', item.category)].filter(Boolean).join('');
  }
  const noun = item.category.toLocaleLowerCase();
  const form = forms[item.category] || 'f';
  const parts: string[] = [];
  if (color && postfixColor[color]) parts.push(noun, postfixColor[color]);
  else if (color && /(ый|ий|ой)$/.test(colorAdjective[color] || color)) parts.push(agree(colorAdjective[color] || color, form), noun);
  else parts.push(noun);
  if (pattern && patternSuffix[pattern]) parts.push(patternSuffix[pattern]);
  return upperFirst(parts.join(' '));
}

/** Имя, которое не придумывал человек: заглушка «Новая вещь…» или голая категория. */
export function isAutoItemName(name: string, category: string) {
  const value = name.trim();
  return !value || /^новая вещь[\s_\-#№]*\d*$/i.test(value) || /^new item[\s_\-#]*\d*$/i.test(value)
    || value.toLocaleLowerCase() === category.toLocaleLowerCase()
    || value.toLocaleLowerCase() === translate(category).toLocaleLowerCase();
}
