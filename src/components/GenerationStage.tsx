import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Modal, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Download, RefreshCw, Share2, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { EXPECTED_TRYON_MS } from './tryOnStatus';

type Props = {
  title: string;
  busy: boolean;
  busyLabel: string;
  /** When the running try-on started, for the progress bar. */
  startedAt?: number;
  /** The photo being dressed, or the intermediate frame once there is one. */
  photoUri: string | null;
  resultUri: string | null;
  error?: string | null;
  warning?: string | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  onSave: () => void;
  onShare: () => void;
  onRegenerate: () => void;
  onClose: () => void;
};

/**
 * The window a try-on happens in: it slides up when the user taps "Try on",
 * shows the photo under a scanning shimmer with the current step, and the
 * finished look fades in over it. Closing it early keeps the try-on running.
 */
export function GenerationStage({ title, busy, busyLabel, startedAt, photoUri, resultUri, error, warning, saveState, onSave, onShare, onRegenerate, onClose }: Props) {
  const t = useT();
  const { colors: c } = useTheme();
  const { height, width } = useWindowDimensions();
  const slide = useRef(new Animated.Value(height)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(resultUri && !busy ? 1 : 0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [now, setNow] = useState(Date.now());
  const done = Boolean(resultUri) && !busy;

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, damping: 22, stiffness: 180, mass: 0.9, useNativeDriver: true }).start();
  }, [slide]);

  useEffect(() => {
    if (!busy) return;
    const loop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    shimmer.setValue(0);
    loop.start();
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { loop.stop(); clearInterval(timer); };
  }, [busy, shimmer]);

  useEffect(() => {
    const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
    // The bar follows the usual two minutes and waits at 95%.
    const target = done ? 1 : busy ? Math.min(0.95, 1 - Math.exp(-2.2 * elapsed / EXPECTED_TRYON_MS)) : 0;
    Animated.timing(progress, { toValue: target, duration: done ? 350 : 500, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [now, startedAt, busy, done, progress]);

  useEffect(() => {
    if (done) Animated.timing(reveal, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    else reveal.setValue(0);
  }, [done, reveal]);

  const close = () => {
    Animated.timing(slide, { toValue: height, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
  };
  const frameWidth = Math.min(width - 32, 480);
  const sweep = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-frameWidth, frameWidth] });
  const resultScale = reveal.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1] });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <SafeAreaProvider>
        <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
          <Animated.View style={[styles.sheet, { backgroundColor: c.card, transform: [{ translateY: slide }] }]}>
            <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: c.text }]}>{t('Примерка')}</Text>
                  <Text style={[styles.subtitle, { color: c.muted }]} numberOfLines={1}>{title}</Text>
                </View>
                {/* While the look generates the cross folds the window into the corner. */}
                <AppPressable accessibilityRole="button" accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')} onPress={close}
                  style={[styles.close, { borderColor: c.border }]}>
                  <X size={20} color={c.text} />
                </AppPressable>
              </View>

              <View style={[styles.frame, { width: frameWidth, backgroundColor: c.surface }]}>
                {photoUri ? (
                  // The photo gives way to the result, so no edge of it shows around a finished look.
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
                    <Image source={{ uri: photoUri }} style={styles.image} resizeMode="contain" />
                  </Animated.View>
                ) : null}
                {busy ? (
                  <>
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.18)' }]} />
                    <Animated.View pointerEvents="none" style={[styles.sweep, { transform: [{ translateX: sweep }, { rotate: '12deg' }] }]}>
                      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
                        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    </Animated.View>
                  </>
                ) : null}
                {resultUri ? (
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal, transform: [{ scale: resultScale }] }]} pointerEvents="none">
                    <Image source={{ uri: resultUri }} style={styles.image} resizeMode="contain" accessibilityLabel={t('Результат')} />
                  </Animated.View>
                ) : null}
              </View>

              <View style={styles.status}>
                {busy ? (
                  <>
                    <View style={styles.statusRow}>
                      <ActivityIndicator size="small" color={c.accentGold} />
                      <Text style={[styles.statusText, { color: c.text }]}>{busyLabel}</Text>
                    </View>
                    <View style={[styles.track, { backgroundColor: c.surface }]}>
                      <Animated.View style={[styles.bar, { backgroundColor: c.accentGold,
                        width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
                    </View>
                    <Text style={[styles.note, { color: c.muted }]}>{t('Обычно около двух минут. Окно можно свернуть — примерка продолжится.')}</Text>
                  </>
                ) : null}
                {error && !busy ? <Text style={[styles.note, { color: c.danger }]}>{error}</Text> : null}
                {warning && done ? <Text style={[styles.note, { color: c.muted }]}>{warning}</Text> : null}
              </View>

              {!busy ? (
                <View style={styles.actions}>
                  {done ? (
                    <View style={styles.row}>
                      <AppPressable accessibilityRole="button" onPress={onSave} disabled={saveState === 'saving'}
                        style={[styles.primary, { backgroundColor: c.buttonPrimaryBg, flex: 1 }]}>
                        {saveState === 'saving' ? <ActivityIndicator size="small" color={c.buttonPrimaryText} />
                          : saveState === 'saved' ? <Check size={18} color={c.buttonPrimaryText} /> : <Download size={18} color={c.buttonPrimaryText} />}
                        <Text style={[styles.primaryText, { color: c.buttonPrimaryText }]}>
                          {t(saveState === 'saving' ? 'Сохраняем…' : saveState === 'saved' ? 'Сохранено в галерею' : 'Сохранить в галерею')}
                        </Text>
                      </AppPressable>
                      {Platform.OS !== 'web' ? (
                        <AppPressable accessibilityRole="button" accessibilityLabel={t('Поделиться')} onPress={onShare}
                          style={[styles.square, { borderColor: c.border }]}>
                          <Share2 size={18} color={c.text} />
                        </AppPressable>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.row}>
                    <AppPressable accessibilityRole="button" onPress={onRegenerate} style={[styles.secondary, { borderColor: c.border, flex: 1 }]}>
                      <RefreshCw size={16} color={c.text} />
                      <Text style={[styles.secondaryText, { color: c.text }]}>{t(done ? 'Ещё вариант' : 'Попробовать снова')}</Text>
                    </AppPressable>
                    <AppPressable accessibilityRole="button" onPress={close} style={[styles.secondary, { borderColor: c.border, flex: 1 }]}>
                      <Text style={[styles.secondaryText, { color: c.text }]}>{t('Готово')}</Text>
                    </AppPressable>
                  </View>
                </View>
              ) : null}
            </SafeAreaView>
          </Animated.View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '94%', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 14, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { flex: 1, alignSelf: 'center', borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  sweep: { position: 'absolute', top: -80, bottom: -80, width: 140 },
  status: { paddingTop: 14, gap: 10, minHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { fontSize: 16, fontWeight: '600', flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  note: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 10, paddingTop: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 10 },
  primary: { minHeight: 50, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 16, fontWeight: '600' },
  square: { width: 50, minHeight: 50, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 46, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontSize: 15, fontWeight: '600' },
});
