import { Platform } from 'react-native';
import { MORNING_ID_PREFIX, MorningPlanEntry } from '../domain/morningLook';

/**
 * Morning look as LOCAL notifications with fixed text, written ahead. Sent by the phone itself: no server, no try-on, nothing paid.
 * Loaded on first use, as in readyNotification: the package warns on import in Expo Go, and an older binary may not have it.
 */
type Response = { notification: { request: { content: { data?: unknown } } } };
type Api = {
  getPermissionsAsync: () => Promise<{ status: string; granted: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ status: string; granted: boolean; canAskAgain?: boolean }>;
  setNotificationChannelAsync: (id: string, channel: { name: string; importance: number }) => Promise<unknown>;
  scheduleNotificationAsync: (request: { identifier: string; content: { title: string; body: string; data: Record<string, unknown> }; trigger: { type: 'date'; date: Date; channelId?: string } }) => Promise<string>;
  getAllScheduledNotificationsAsync: () => Promise<{ identifier: string }[]>;
  cancelScheduledNotificationAsync: (id: string) => Promise<void>;
  addNotificationResponseReceivedListener: (listener: (response: Response) => void) => { remove: () => void };
  getLastNotificationResponse: () => Response | null;
  clearLastNotificationResponse: () => void;
  AndroidImportance: { DEFAULT: number };
  SchedulableTriggerInputTypes: { DATE: 'date' };
};
const CHANNEL = 'morning-look';

const load = (): Api | null => {
  if (Platform.OS === 'web') return null;
  try { return require('expo-notifications') as Api; } catch { return null; }
};

export type MorningPermission = 'granted' | 'denied' | 'unavailable';

/** Asked only when the person turns the morning look on. */
export async function askMorningPermission(channelName: string): Promise<MorningPermission> {
  try {
    const api = load();
    if (!api) return 'unavailable';
    if (Platform.OS === 'android') await api.setNotificationChannelAsync(CHANNEL, { name: channelName, importance: api.AndroidImportance.DEFAULT });
    if ((await api.getPermissionsAsync()).granted) return 'granted';
    return (await api.requestPermissionsAsync()).granted ? 'granted' : 'denied';
  } catch { return 'unavailable'; }
}

export async function morningPermissionGranted() {
  try { return Boolean((await load()?.getPermissionsAsync())?.granted); } catch { return false; }
}

/** Only this feature's own: others are left alone. */
export async function cancelMorningNotifications() {
  try {
    const api = load();
    if (!api) return;
    const scheduled = await api.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter(entry => entry.identifier.startsWith(MORNING_ID_PREFIX)).map(entry => api.cancelScheduledNotificationAsync(entry.identifier)));
  } catch { /* nothing to do about it */ }
}

/** Replaces what was written before. Without the permission nothing is written. */
export async function scheduleMorningNotifications(plan: MorningPlanEntry[], channelName: string) {
  await cancelMorningNotifications();
  if (!plan.length) return;
  try {
    const api = load();
    if (!api || !(await api.getPermissionsAsync()).granted) return;
    if (Platform.OS === 'android') await api.setNotificationChannelAsync(CHANNEL, { name: channelName, importance: api.AndroidImportance.DEFAULT });
    for (const entry of plan) {
      await api.scheduleNotificationAsync({ identifier: entry.identifier, content: { title: entry.title, body: entry.body, data: entry.data },
        trigger: { type: api.SchedulableTriggerInputTypes.DATE, date: entry.date, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) } });
    }
  } catch (error) { console.warn('Failed to schedule the morning look', error); }
}

/** Tells of a tap on a notification, including the one that opened a closed app. */
export function listenToMorningTaps(onData: (data: unknown) => void) {
  try {
    const api = load();
    if (!api) return () => {};
    const last = api.getLastNotificationResponse();
    if (last) { onData(last.notification.request.content.data); api.clearLastNotificationResponse(); }
    const subscription = api.addNotificationResponseReceivedListener(response => onData(response.notification.request.content.data));
    return () => subscription.remove();
  } catch { return () => {}; }
}
