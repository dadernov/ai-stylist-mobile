import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import type { WardrobeItem } from '../../data/mock';
import { isCutout } from './studio';
import { CARD_ASPECT, type Aspects } from './lookLayout';

// The server crops a cut-out to the garment (alpha > 32, a 4 % margin), so the picture's own shape is the
// garment's. Measured once per picture for the whole session.
const known = new Map<string, number>();

/** Width ÷ height of each piece's picture by item id; a photo with its own ground is shown as a card. */
export function useAspects(items: WardrobeItem[] | undefined): Aspects {
  const read = () => Object.fromEntries((items || []).map(item => [item.id,
    item.imageUri && !isCutout(item.imageUri) ? CARD_ASPECT : item.imageUri ? known.get(item.imageUri) : undefined]));
  const [aspects, setAspects] = useState<Aspects>(read);
  const key = (items || []).map(item => `${item.id}:${item.imageUri?.length ?? 0}:${item.imageUri?.slice(-24) ?? ''}`).join('|');
  useEffect(() => {
    let alive = true;
    setAspects(read());
    for (const item of items || []) {
      const uri = item.imageUri;
      if (!uri || !isCutout(uri) || known.has(uri)) continue;
      Image.getSize(uri, (w, h) => {
        if (w > 0 && h > 0) known.set(uri, w / h);
        if (alive) setAspects(read());
      }, () => {});
    }
    return () => { alive = false; };
  }, [key]);
  return aspects;
}
