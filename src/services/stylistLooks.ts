import { useEffect, useState } from 'react';
import { WardrobeItem } from '../data/mock';
import { hasAiConsent } from './aiConsent';
import { requestStylistLooks, StylistLook, StylistRequest } from './ai';

export type StylistState = { status: 'off' | 'loading' | 'ready' | 'failed'; looks: StylistLook[] };

// One answer per wardrobe and situation for half an hour: going back to an
// occasion shows its looks at once, and the stylist is not asked again for them.
const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; looks: StylistLook[] }>();
// A pause after the last tap on the chips before asking, so a run through them costs one request.
const SETTLE_MS = 700;

/** What the answer depends on. Profiles arriving in the background do not ask again. */
const wardrobeKey = (items: WardrobeItem[]) => items.map(item => `${item.id}:${item.section}:${item.category}`).sort().join('|');

/**
 * The stylist model's outfit ideas for this wardrobe and situation. Only with
 * the AI consent given; 'failed' and 'off' leave the rule-based ideas alone.
 */
export function useStylistLooks(items: WardrobeItem[], request: StylistRequest, login: string | undefined): StylistState {
  const key = JSON.stringify([login, wardrobeKey(items), request]);
  const cached = cache.get(key);
  const fresh = cached && Date.now() - cached.at < CACHE_MS ? cached.looks : null;
  const [state, setState] = useState<StylistState>(fresh ? { status: 'ready', looks: fresh } : { status: login ? 'loading' : 'off', looks: [] });
  useEffect(() => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { setState({ status: 'ready', looks: hit.looks }); return; }
    if (!login || !items.some(item => item.section === 'Верх' || item.section === 'Низ')) { setState({ status: 'off', looks: [] }); return; }
    let cancelled = false;
    setState({ status: 'loading', looks: [] });
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await hasAiConsent(login))) { if (!cancelled) setState({ status: 'off', looks: [] }); return; }
        try {
          const looks = await requestStylistLooks(items, request);
          cache.set(key, { at: Date.now(), looks });
          if (cache.size > 40) cache.delete(cache.keys().next().value as string);
          if (!cancelled) setState({ status: 'ready', looks });
        } catch {
          if (!cancelled) setState({ status: 'failed', looks: [] });
        }
      })();
    }, SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key]);
  return state;
}
