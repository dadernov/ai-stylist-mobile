import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { DAILY_EVENT, DAILY_STYLE, decodeDailyLook, greetingName, pickDailyLook } from '../domain/dailyLook';
import { LookVote, buildTaste } from '../domain/lookTaste';
import { lookName } from '../domain/lookName';
import { DEFAULT_MORNING, decodeMorningSettings, MorningSettings, opensIdeas, planMorning } from '../domain/morningLook';
import { buildLooks } from '../domain/outfits';
import { accountKey } from '../services/accountStorage';
import { askMorningPermission, cancelMorningNotifications, listenToMorningTaps, MorningPermission, morningPermissionGranted, scheduleMorningNotifications } from '../services/morningNotifications';
import { loadValidated, saveJson } from '../services/storage';
import { Gender } from '../types/profile';
import { useFavoriteColors } from './useFavoriteColors';

type Input = { login: string; displayName?: string; ready: boolean; items: WardrobeItem[]; gender: Gender; beautyAdvice: boolean; favoriteItemIds: string[]; dismissed: string[]; votes: LookVote[]; onOpenIdeas: () => void };
export type MorningControl = { settings: MorningSettings; permissionLost: boolean; turnOn: () => Promise<MorningPermission>; turnOff: () => void; setTime: (hour: number, minute: number) => void };

/**
 * The morning notification's settings, and its text written ahead each time the app opens. Everything comes from what is on
 * the phone: the look is picked as the hero picks it, on the temperature it last saw, and nothing here goes to the network.
 */
export function useMorningLook(input: Input): MorningControl {
  const t = useT();
  const key = accountKey(input.login, 'morningLook');
  const [settings, setSettings] = useState<MorningSettings | null>(null);
  const [permissionLost, setPermissionLost] = useState(false);
  const favoriteColors = useFavoriteColors(input.login);
  const latest = useRef({ input, t, settings, favoriteColors });
  latest.current = { input, t, settings, favoriteColors };
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void loadValidated(key, decodeMorningSettings).then(result => { if (active) setSettings(result.value ?? DEFAULT_MORNING); }).catch(() => { if (active) setSettings(DEFAULT_MORNING); });
    return () => { active = false; };
  }, [key]);

  // One at a time: the cancel of a later run must not fall on the entries of an earlier one half way.
  const reschedule = () => {
    chain.current = chain.current.then(async () => {
      const { input: now, t: translate, settings: current, favoriteColors: colors } = latest.current;
      if (!current?.enabled || colors === undefined) return;
      setPermissionLost(!(await morningPermissionGranted()));
      const stored = await loadValidated(accountKey(now.login, 'dailyLook'), decodeDailyLook).catch(() => ({ value: null }));
      const record = stored.value ?? null;
      const known = new Map(now.items.map(item => [item.id, item]));
      const candidates = buildLooks(now.items, DAILY_STYLE, DAILY_EVENT, '', record?.temperature ?? null, now.gender, now.beautyAdvice,
        { favoriteItemIds: now.favoriteItemIds, dismissed: now.dismissed, favoriteColors: colors ?? undefined, taste: buildTaste(now.votes, Date.now()) });
      const lookFor = (day: string) => {
        const chosen = pickDailyLook(candidates, now.items, record?.day === day ? record : null, day, now.dismissed);
        if (!chosen.lookId) return null;
        return lookName(chosen.itemIds.map(id => known.get(id)).filter(Boolean) as WardrobeItem[], translate('и')) || null;
      };
      const plan = planMorning({ now: new Date(), settings: current, login: now.login, name: greetingName(now.displayName, now.login), hasClothes: now.items.length >= 2, lookFor, t: translate });
      await scheduleMorningNotifications(plan, translate('Образ дня'));
    }).catch(error => console.warn('Failed to write the morning look', error));
  };

  const enabled = settings?.enabled === true;
  const stamp = settings ? `${settings.enabled}:${settings.hour}:${settings.minute}` : '';
  // The app opened, or the switch or the time changed; the colour answer read counts too.
  useEffect(() => { if (input.ready && enabled) reschedule(); }, [input.ready, stamp, favoriteColors]);
  // The wardrobe or the votes changed: the text follows, once they have settled.
  useEffect(() => {
    if (!input.ready || !enabled) return;
    const timer = setTimeout(reschedule, 3000);
    return () => clearTimeout(timer);
  }, [input.ready, enabled, input.items, input.votes]);
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reschedule(); });
    return () => subscription.remove();
  }, [enabled]);
  // Only once it is on: the package is not even loaded for those who never asked for it.
  useEffect(() => {
    if (!enabled) return;
    return listenToMorningTaps(data => { if (opensIdeas(data, latest.current.input.login)) latest.current.input.onOpenIdeas(); });
  }, [enabled]);

  const remember = (next: MorningSettings) => { setSettings(next); void saveJson(key, next).catch(() => {}); };
  const base = () => latest.current.settings ?? DEFAULT_MORNING;
  return {
    settings: settings ?? DEFAULT_MORNING,
    permissionLost,
    turnOn: async () => {
      const answer = await askMorningPermission(t('Образ дня'));
      if (answer === 'granted') { setPermissionLost(false); remember({ ...base(), enabled: true }); }
      return answer;
    },
    turnOff: () => {
      remember({ ...base(), enabled: false });
      setPermissionLost(false);
      chain.current = chain.current.then(cancelMorningNotifications);
    },
    setTime: (hour, minute) => remember({ ...base(), hour, minute })
  };
}
