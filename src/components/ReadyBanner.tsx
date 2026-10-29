import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { SHADOWS } from '../constants/theme';
import { AppPressable } from './AppPressable';
import { font, glassEdge, INK, INK_ON_DARK, inkSoft, sheetFill, useReducedMotion } from './studio/studio';

const SHOWN_MS = 3500;

/**
 * "The look is ready": a green banner that slides down for a few seconds the
 * moment a try-on's picture is in, so a second look running in the background
 * is not forgotten. Tapping it opens that look.
 */
export function ReadyBanner({ title, imageUri, onPress, onHide }: {
  title: string; imageUri?: string | null; onPress: () => void; onHide: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  // The auto-hide timer fires after mount: read the latest setting, not the one it was created with.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const enter = useRef(new Animated.Value(0)).current;
  const hidden = useRef(false);
  const hide = () => {
    if (hidden.current) return;
    hidden.current = true;
    Animated.timing(enter, { toValue: 0, duration: reducedRef.current ? 0 : 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onHide());
  };
  useEffect(() => {
    if (reduced) enter.setValue(1);
    else Animated.spring(enter, { toValue: 1, damping: 18, stiffness: 210, mass: 0.8, useNativeDriver: true }).start();
    const timer = setTimeout(hide, SHOWN_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View pointerEvents="box-none" style={[styles.place, { top: insets.top + 8 }]}>
      <Animated.View accessibilityLiveRegion="polite" style={[SHADOWS.floating, styles.shadow, {
        opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-90, 0] }) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
        <AppPressable haptics accessibilityRole="button" accessibilityLabel={t('Образ готов: {name}', { name: title })}
          onPress={() => { onPress(); hide(); }}>
          <View style={[styles.card, { backgroundColor: sheetFill(isDark), borderColor: glassEdge(isDark) }]}>
            <View style={styles.banner}>
              {imageUri ? <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" /> : null}
              <View style={styles.texts}>
                <Text style={[styles.title, { color: isDark ? INK_ON_DARK : INK }]} numberOfLines={1}>{t('Образ готов')}</Text>
                <Text style={[styles.subtitle, { color: inkSoft(isDark) }]} numberOfLines={1}>{title}</Text>
              </View>
              <View style={styles.badge}><Check size={16} strokeWidth={2.4} color="#FFFFFF" /></View>
            </View>
          </View>
        </AppPressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  shadow: { width: '100%', maxWidth: 480, borderRadius: 24 },
  // Near-opaque, not glass: the text must read over whatever light content scrolls beneath.
  card: { borderRadius: 24, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 14 },
  thumb: { width: 38, height: 50, borderRadius: 12, backgroundColor: 'rgba(18,20,23,0.06)' },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...font('semibold'), fontSize: 15, lineHeight: 20 },
  subtitle: { ...font('regular'), fontSize: 13, lineHeight: 18 },
  // The one green of the banner: the look is ready.
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2F8F5B', alignItems: 'center', justifyContent: 'center' },
});
