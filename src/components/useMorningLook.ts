import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { DAILY_EVENT, DAILY_STYLE, decodeDailyLook, greetingName, pickDailyLook } from '../domain/dailyLook';
import { LookVote, buildTaste } from '../domain/lookTaste';
import { lookName } from '../domain/lookName';
import { createSerial, DEFAULT_MORNING, decodeMorningSettings, MorningSettings, opensIdeas, planMorning, weatherIsFresh } from '../domain/morningLook';
import { buildLooks } from '../domain/outfits';
import { accountKey } from '../services/accountStorage';
import { askMorningPermission, cancelMorningNotifications, listenToMorningTaps, MorningPermission, morningPermissionGranted, scheduleMorningNotifications } from '../services/morningNotifications';
import { loadValidated, saveJson } from '../services/storage';
import { Gender } from '../types/profile';
import { useFavoriteColors } from './useFavoriteColors';

// One line for all the app: a run left by a closed session, and the cancel after it, come before anything the next one writes.
const writes = createSerial(error => console.warn('Failed to write the morning look', error));

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
  const session = useRef({ alive: true });

  // Declared first, so the runs asked for by the effects below belong to this session. Leaving (sign-out, deletion, an expired
  // token) marks what is under way, and a cancel after it takes off whatever that run got written.
  useEffect(() => {
    const current = { alive: true };
    session.current = current;
    return () => { current.alive = false; void writes(cancelMorningNotifications); };
  }, [input.login]);

  useEffect(() => {
    let active = true;
    void loadValidated(key, decodeMorningSettings).then(result => { if (active) setSettings(result.value ?? DEFAULT_MORNING); }).catch(() => { if (active) setSettings(DEFAULT_MORNING); });
    return () => { active = false; };
  }, [key]);

  // One at a time: the cancel of a later run must not fall on the entries of an earlier one half way.
  const reschedule = () => {
    const mine = session.current;
    void writes(async () => {
      if (!mine.alive) return;
      const { input: now, t: translate, settings: current, favoriteColors: colors } = latest.current;
      if (!current?.enabled || colors === undefined) return;
      const granted = await morningPermissionGranted();
      if (!mine.alive) return;
      setPermissionLost(!granted);
      const stored = await loadValidated(accountKey(now.login, 'dailyLook'), decodeDailyLook).catch(() => ({ value: null }));
      if (!mine.alive) return;
      const record = stored.value ?? null;
      const clock = new Date();
      const fresh = weatherIsFresh(record, clock);
      const known = new Map(now.items.map(item => [item.id, item]));
      const candidates = buildLooks(now.items, DAILY_STYLE, DAILY_EVENT, '', record?.temperature ?? null, now.gender, now.beautyAdvice,
        { favoriteItemIds: now.favoriteItemIds, dismissed: now.dismissed, favoriteColors: colors ?? undefined, taste: buildTaste(now.votes, Date.now()) });
      const lookFor = (day: string) => {
        const chosen = pickDailyLook(candidates, now.items, record?.day === day ? record : null, day, now.dismissed);
        if (!fresh || !chosen.lookId) return null;
        return lookName(chosen.itemIds.map(id => known.get(id)).filter(Boolean) as WardrobeItem[], translate('и')) || null;
      };
      const plan = planMorning({ now: clock, settings: current, login: now.login, name: greetingName(now.displayName, now.login), hasClothes: now.items.length >= 2, lookFor, t: translate });
      await scheduleMorningNotifications(plan, translate('Образ дня'), () => mine.alive);
    });
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
      void writes(cancelMorningNotifications);
    },
    setTime: (hour, minute) => remember({ ...base(), hour, minute })
  };
}
