import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { useT } from '../constants/i18n';
import { SHADOWS } from '../constants/theme';
import { AppPressable } from './AppPressable';

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
  const enter = useRef(new Animated.Value(0)).current;
  const hidden = useRef(false);
  const hide = () => {
    if (hidden.current) return;
    hidden.current = true;
    Animated.timing(enter, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onHide());
  };
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, damping: 18, stiffness: 210, mass: 0.8, useNativeDriver: true }).start();
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
          <LinearGradient colors={['#2F8F5B', '#1E6B43']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" /> : null}
            <View style={styles.texts}>
              <Text style={styles.title} numberOfLines={1}>{t('Образ готов')}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{title}</Text>
            </View>
            <View style={styles.badge}><Check size={16} strokeWidth={2.6} color="#1E6B43" /></View>
          </LinearGradient>
        </AppPressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  shadow: { width: '100%', maxWidth: 480, borderRadius: 22 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, paddingVertical: 10, paddingLeft: 10, paddingRight: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  thumb: { width: 38, height: 50, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)' },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  subtitle: { color: 'rgba(255,255,255,0.86)', fontSize: 13, fontWeight: '500' },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
