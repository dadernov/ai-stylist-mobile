import { WardrobeItem } from '../data/mock';

/**
 * Accessories the try-on can put on: one hat, one scarf, one pair of gloves
 * and one bag per look, each in its own upload slot (ai-server tryon_policy
 * accessory_instruction). Jewellery is not worn yet.
 */
export type AccessorySlot = 'hat' | 'scarf' | 'gloves' | 'bag';
export const ACCESSORY_CATEGORIES: Record<string, AccessorySlot> = {
  Шапка: 'hat', Кепка: 'hat', Шляпа: 'hat', Шарф: 'scarf', Перчатки: 'gloves'
};
/** Sections a try-on can dress: garments, and now bags and accessories too. */
export const TRYON_SECTIONS = ['Верх', 'Низ', 'Обувь', 'Верхняя одежда', 'Аксессуары', 'Сумки'];

export const accessorySlot = (item: WardrobeItem): AccessorySlot | null =>
  item.section === 'Сумки' ? 'bag' : ACCESSORY_CATEGORIES[item.category] || null;
