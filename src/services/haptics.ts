import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// A tap is a nicety: no web, no motor or an unavailable native module never reaches the caller.
const safely = (play: () => Promise<void>) => {
  if (Platform.OS === 'web') return;
  try { play().catch(() => {}); } catch { /* the module is missing from this build */ }
};

/** A light tap under the finger: buttons, tabs, a like. */
export const tapHaptic = () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
/** Something moved on by itself: the next stage of a try-on. */
export const selectionHaptic = () => safely(() => Haptics.selectionAsync());
/** The good news: the finished look is being revealed. */
export const successHaptic = () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
