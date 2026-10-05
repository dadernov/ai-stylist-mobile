import { GarmentTraits } from '../data/mock';

const TRAIT_VALUES: Record<keyof GarmentTraits, readonly string[]> = {
  sleeves: ['long', 'short', 'none'], length: ['cropped', 'hip', 'long'], opening: ['front', 'none'], bulk: ['bulky', 'thin']
};
/** Only the values the server gives; anything else is dropped, and the item is simply read again. */
export function decodeTraits(value: unknown): GarmentTraits | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const traits: GarmentTraits = {};
  for (const [name, allowed] of Object.entries(TRAIT_VALUES) as [keyof GarmentTraits, readonly string[]][]) {
    const read = (value as Record<string, unknown>)[name];
    (traits as Record<string, string | null>)[name] = typeof read === 'string' && allowed.includes(read) ? read : null;
  }
  return traits;
}
