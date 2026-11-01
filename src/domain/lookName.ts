import { WardrobeItem } from '../data/mock';
import { isLegwear } from './legwear';

/** A look named by its pieces, top first: «Свитшот с вышивкой и голубые джинсы». Empty when it has no such pieces. */
export function lookName(selection: WardrobeItem[], and: string) {
  const named = selection.filter(item => ['Верх', 'Низ'].includes(item.section) && !isLegwear(item)).map(item => item.name.trim()).filter(Boolean);
  return named.map((name, i) => i ? name.charAt(0).toLocaleLowerCase() + name.slice(1) : name).join(` ${and} `);
}
