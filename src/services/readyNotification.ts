import { AppState, Platform } from 'react-native';

/**
 * «Образ готов» as a LOCAL notification, shown when the app hears of a finished try-on from the background.
 *
 * It can only fire while JS still runs: the job store polls the server from JS, and once the OS suspends the
 * app (on iOS, within seconds of leaving it) nothing polls and nothing fires; the look is then found on return.
 * Reliable delivery to a suspended or closed app needs server push and a dev/TestFlight build, not this.
 */
type NotificationsApi = {
  getPermissionsAsync: () => Promise<{ status: string; granted: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ status: string; granted: boolean }>;
  setNotificationChannelAsync: (id: string, channel: { name: string; importance: number }) => Promise<unknown>;
  scheduleNotificationAsync: (request: { content: { title: string; body: string }; trigger: null }) => Promise<string>;
  AndroidImportance: { DEFAULT: number };
};

// Loaded on first use, not at launch: the package warns on import in Expo Go, and a binary built
// before it was added (an OTA update onto an older build) has no native module, which then only costs the notification.
const load = (): NotificationsApi | null => {
  if (Platform.OS === 'web') return null;
  try { return require('expo-notifications') as NotificationsApi; } catch { return null; }
};

/** Asked at the first try-on start, never on launch. The OS shows its question once; later calls change nothing. */
export async function askReadyNotificationPermission(channelName: string) {
  try {
    const notifications = load();
    if (!notifications) return;
    // Android 13+ shows the question only once a channel exists.
    if (Platform.OS === 'android') await notifications.setNotificationChannelAsync('default', { name: channelName, importance: notifications.AndroidImportance.DEFAULT });
    const { status } = await notifications.getPermissionsAsync();
    if (status === 'undetermined') await notifications.requestPermissionsAsync();
  } catch { /* the try-on goes on without notifications */ }
}

/** Says the look is ready if the app is not on screen; on screen the green banner says it. */
export async function notifyLookReady(title: string, body: string) {
  if (AppState.currentState === 'active') return;
  try {
    const notifications = load();
    if (!notifications || !(await notifications.getPermissionsAsync()).granted) return;
    await notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch { /* the look is still there on return */ }
}
