import { Dispatch, SetStateAction, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { WardrobeItem } from '../data/mock';
import { Session } from '../services/auth';
import { ClosetProfile, syncCloset } from '../services/closetSync';

/**
 * Keeps the wardrobe and the try-on photo mirrored on the server: once they
 * are read, a few seconds after each change and when the app comes back.
 * Nothing syncs while the local copy could not be read: an empty list read by
 * mistake must never reach the server as a deletion.
 */
export function useClosetSync({ session, ready, blocked, items, setItems, profile, applyProfile }: {
  session: Session; ready: boolean; blocked: () => boolean;
  items: WardrobeItem[]; setItems: Dispatch<SetStateAction<WardrobeItem[]>>;
  profile: ClosetProfile; applyProfile: (profile: ClosetProfile) => void;
}) {
  const latest = useRef({ items, profile, applyProfile, blocked });
  latest.current = { items, profile, applyProfile, blocked };
  const running = useRef(false);
  const again = useRef(false);

  const run = useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        if (latest.current.blocked()) return;
        await syncCloset(session, {
          items: () => latest.current.items, applyItems: setItems,
          profile: () => latest.current.profile, applyProfile: next => latest.current.applyProfile(next),
        }, { canDelete: true });
      } while (again.current);
    } catch (error) {
      // No connection or the server is away: the next change or return tries again.
      console.warn('Wardrobe sync failed', error);
    } finally {
      running.current = false;
    }
  }, [session, setItems]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void run(); }, 3000);
    return () => clearTimeout(timer);
  }, [ready, run, items, profile.gender, profile.beautyAdvice, profile.modelUri, profile.avatarUri]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && ready) void run(); });
    return () => subscription.remove();
  }, [ready, run]);
}
