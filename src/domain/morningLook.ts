import { localDay } from './dailyLook';

/** The morning notification: what is set, and what each coming morning says. JS does not run at the moment it fires, so all of it is decided now. */
export type MorningSettings = { enabled: boolean; hour: number; minute: number };
export const DEFAULT_MORNING: MorningSettings = { enabled: false, hour: 8, minute: 0 };
export const MORNING_ID_PREFIX = 'morning-look-';
export const MORNING_KIND = 'morning-look';
/** A week covers a person away for days; each opening of the app writes it anew. */
export const MORNING_DAYS = 7;
/** Beyond these the look would rest on weather too far off: those mornings get a word without a look. */
const NAMED_FIRINGS = 2;

/** The temperature a look is named on must be recent: an older one may belong to another weather altogether. */
export const WEATHER_FRESH_DAYS = 3;
export function weatherIsFresh(record: { day: string; temperature: number | null } | null | undefined, now: Date) {
  if (!record || record.temperature === null || record.temperature === undefined) return false;
  const [year, month, date] = record.day.split(/-/).map(Number);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(year, month - 1, date).getTime()) / 86_400_000);
  return days >= 0 && days <= WEATHER_FRESH_DAYS;
}

/** Runs writes one after another. One that fails does not stop the next. */
export function createSerial(onError: (error: unknown) => void = () => {}) {
  let tail: Promise<unknown> = Promise.resolve();
  return (task: () => unknown) => (tail = tail.then(task).catch(onError));
}

/** Ours by the marker anywhere in its identifier (Expo Go prefixes identifiers) or by what it carries. */
export const isMorningEntry = (entry: { identifier: string; content?: { data?: unknown } | null }) =>
  entry.identifier.includes(MORNING_ID_PREFIX) || (entry.content?.data as { kind?: unknown } | null | undefined)?.kind === MORNING_KIND;

export type MorningPlanEntry = { identifier: string; date: Date; title: string; body: string; data: { kind: string; login: string } };
type Translator = (text: string, values?: Record<string, string | number>) => string;

export function decodeMorningSettings(value: unknown): MorningSettings {
  const v = value as Partial<MorningSettings> | null;
  if (!v || typeof v !== 'object') return DEFAULT_MORNING;
  const whole = (n: unknown, max: number, fallback: number) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max ? n : fallback);
  return { enabled: v.enabled === true, hour: whole(v.hour, 23, DEFAULT_MORNING.hour), minute: whole(v.minute, 59, DEFAULT_MORNING.minute) };
}

export const formatMorningTime = ({ hour, minute }: Pick<MorningSettings, 'hour' | 'minute'>) => `${hour}:${String(minute).padStart(2, '0')}`;

/** The coming moments of that clock time, local and across a clock change; one too close to now is left out. */
export function morningDates(now: Date, hour: number, minute: number, count = MORNING_DAYS) {
  const dates: Date[] = [];
  for (let offset = 0; dates.length < count && offset <= count; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0);
    if (date.getTime() > now.getTime() + 60_000) dates.push(date);
  }
  return dates;
}

/**
 * Never says anything of the weather: it cannot be known at that hour. A look is named only for the nearest mornings,
 * as an idea: the Ideas screen may pick another once it sees the real weather. No look: a warm word.
 */
export function planMorning(input: { now: Date; settings: MorningSettings; login: string; name: string; hasClothes: boolean; lookFor: (day: string) => string | null; t: Translator }): MorningPlanEntry[] {
  const { now, settings, login, name, hasClothes, lookFor, t } = input;
  if (!settings.enabled) return [];
  return morningDates(now, settings.hour, settings.minute).map((date, index) => {
    const day = localDay(date);
    const look = index < NAMED_FIRINGS && hasClothes ? lookFor(day) : null;
    const seed = date.getDate() % 3;
    const body = look ? t('Идея на сегодня: {look}. Загляни, что ещё подойдёт.', { look })
      : !hasClothes ? t('Добавь пару вещей, и подберём, что надеть.')
      : seed === 0 ? t('Загляни в идеи: подберём, что надеть сегодня.')
      : seed === 1 ? t('Пара минут, и понятно, что надеть сегодня.')
      : t('Твой гардероб на месте. Посмотрим, что из него собрать сегодня?');
    return { identifier: `${MORNING_ID_PREFIX}${day}`, date, title: name ? t('Доброе утро, {name}', { name }) : t('Доброе утро'), body, data: { kind: MORNING_KIND, login } };
  });
}

/** Whether a tap on a notification should open the Ideas of this account. */
export const opensIdeas = (data: unknown, login: string) => {
  const d = data as { kind?: unknown; login?: unknown } | null | undefined;
  return d?.kind === MORNING_KIND && d?.login === login;
};
