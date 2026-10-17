import { GarmentProfile, GarmentTraits } from '../data/mock';

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

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : undefined;
const words = (value: unknown, count: number) => Array.isArray(value) ? value.filter(word => typeof word === 'string').slice(0, count).map(word => word.slice(0, 40)) : [];
const scale = (value: unknown) => typeof value === 'number' && value >= 1 && value <= 5 ? Math.round(value) : null;
/** A stored or received garment profile, kept to its known fields and sizes. */
export function decodeGarmentProfile(value: unknown): GarmentProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const p = value as Record<string, unknown>;
  return { kind: text(p.kind, 80), colors: words(p.colors, 3), hex: typeof p.hex === 'string' && /^#[0-9a-f]{6}$/i.test(p.hex) ? p.hex : null,
    pattern: text(p.pattern, 20), material: text(p.material, 40), fit: text(p.fit, 20), formality: scale(p.formality), warmth: scale(p.warmth),
    styles: words(p.styles, 3), occasions: words(p.occasions, 4), seasons: words(p.seasons, 4), notes: text(p.notes, 160) };
}
