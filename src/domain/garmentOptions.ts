import { WardrobeItem } from '../data/mock';

/**
 * How a garment is worn in a try-on, set per garment: a top tucked in or out,
 * something with buttons or a zip worn open or closed. 'auto' leaves it to the
 * look. The same lists live on the server (ai-server tryon_policy).
 */
export type TuckChoice = 'auto' | 'tucked' | 'untucked';
export type FastenChoice = 'auto' | 'closed' | 'open';
export type GarmentOption = { tuck?: TuckChoice; fasten?: FastenChoice };
/** By wardrobe item id. */
export type GarmentOptions = Record<string, GarmentOption>;

const TUCKABLE = new Set(['Футболка', 'Поло', 'Лонгслив', 'Рубашка', 'Блуза', 'Топ', 'Майка', 'Водолазка', 'Свитер', 'Свитшот']);
const FASTENABLE = new Set(['Рубашка', 'Блуза', 'Кардиган', 'Жилет', 'Пиджак', 'Бомбер', 'Куртка', 'Пальто', 'Тренч', 'Плащ', 'Пуховик', 'Парка', 'Шуба']);

/** A top can be tucked only into trousers or a skirt of the same look. */
export const canTuck = (item: WardrobeItem, look: WardrobeItem[]) =>
  TUCKABLE.has(item.category) && look.some(other => other.section === 'Низ');
export const canFasten = (item: WardrobeItem) => FASTENABLE.has(item.category);

/** The choices that mean something for this look, without 'auto'. */
export function effectiveOptions(look: WardrobeItem[], options: GarmentOptions = {}): GarmentOptions {
  const result: GarmentOptions = {};
  for (const item of look) {
    const chosen = options[item.id] || {};
    const option: GarmentOption = {};
    if (chosen.tuck && chosen.tuck !== 'auto' && canTuck(item, look)) option.tuck = chosen.tuck;
    if (chosen.fasten && chosen.fasten !== 'auto' && canFasten(item)) option.fasten = chosen.fasten;
    if (Object.keys(option).length) result[item.id] = option;
  }
  return result;
}
