import { WardrobeItem } from '../data/mock';
import { lookCore } from './outfits';

/** The hero's choice for one local day: the same look all day, whatever the weather does meanwhile. */
export type DailyLookRecord = { day: string; lookId: string; itemIds: string[]; temperature: number | null; skipped: string[] };
export type DayPart = 'morning' | 'day' | 'evening' | 'night';
type Candidate = { id: string; itemIds: string[]; temperature?: number | null };

const pad = (value: number) => String(value).padStart(2, '0');
export const localDay = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const dayPart = (hour: number): DayPart => hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'day' : hour >= 18 && hour < 23 ? 'evening' : 'night';

/** The name to greet by: the first word of a name the person gave. A login standing in for a name is not one. */
export function greetingName(displayName: string | undefined, login: string | undefined) {
  const name = (displayName || '').trim();
  return !name || name === login || name.includes('@') ? '' : name.split(/\s+/)[0];
}

export function decodeDailyLook(value: unknown): DailyLookRecord | null {
  const record = value as DailyLookRecord | null;
  const strings = (list: unknown) => Array.isArray(list) && list.every(entry => typeof entry === 'string');
  if (!record || typeof record !== 'object' || typeof record.day !== 'string' || typeof record.lookId !== 'string' || !strings(record.itemIds) || !strings(record.skipped)) return null;
  return { day: record.day, lookId: record.lookId, itemIds: record.itemIds, skipped: record.skipped, temperature: typeof record.temperature === 'number' ? record.temperature : null };
}

/**
 * Today's record: yesterday's choice never carries over, today's holds while its pieces are all still
 * in the wardrobe. A new one comes from the best few looks, varied by the date, so that the same
 * weather does not mean the same outfit every morning. One piece is no outfit: such looks are not offered.
 * lookId is empty when nothing is left to offer.
 */
export function pickDailyLook(candidates: Candidate[], items: WardrobeItem[], record: DailyLookRecord | null, day: string, avoid: string[] = []): DailyLookRecord {
  const known = new Map(items.map(item => [item.id, item]));
  const today = record?.day === day ? record : null;
  if (today?.lookId && today.itemIds.length && today.itemIds.every(id => known.has(id))) return today;
  const skipped = today?.skipped || [];
  const coreOf = (look: Candidate) => lookCore(look.itemIds.map(id => known.get(id)).filter(Boolean) as WardrobeItem[]);
  const open = candidates.filter(look => look.itemIds.length >= 2 && look.itemIds.every(id => known.has(id)) && !skipped.includes(coreOf(look)));
  const fresh = open.filter(look => !avoid.includes(coreOf(look)));
  const pool = (fresh.length ? fresh : open).slice(0, 3);
  if (!pool.length) {
    // Nothing to offer, and already recorded as such: the same record, so that nothing is saved again.
    if (today && !today.lookId) return today;
    return { day, lookId: '', itemIds: [], temperature: null, skipped };
  }
  const seed = [...day].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  const chosen = pool[seed % pool.length];
  return { day, lookId: chosen.id, itemIds: chosen.itemIds, temperature: chosen.temperature ?? null, skipped };
}

/** The look is put aside for today; the next pick passes over it. */
export const skipDailyLook = (record: DailyLookRecord, core: string): DailyLookRecord =>
  ({ ...record, lookId: '', itemIds: [], skipped: record.skipped.includes(core) ? record.skipped : [...record.skipped, core] });
