import { useEffect, useState } from 'react';
import { FavoriteColors } from '../domain/outfits';
import { accountKey } from '../services/accountStorage';
import { loadJson } from '../services/storage';

const VALUES: FavoriteColors[] = ['neutral', 'dark', 'pastel', 'bright'];

/** The first minute's colour answer: undefined until read, null when there is none. */
export function useFavoriteColors(login?: string) {
  const [value, setValue] = useState<FavoriteColors | null | undefined>(login ? undefined : null);
  useEffect(() => {
    if (!login) { setValue(null); return; }
    let active = true;
    void loadJson<string>(accountKey(login, 'favoriteColors')).then(result => {
      if (active) setValue(VALUES.find(option => option === result.value) ?? null);
    }).catch(() => { if (active) setValue(null); });
    return () => { active = false; };
  }, [login]);
  return value;
}
