import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, LayoutChangeEvent, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView,
  StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpRight, Check, ChevronDown, Download, RefreshCw, Share2, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { EXPECTED_TRYON_MS } from './tryOnStatus';
import { TryOnOptions } from './TryOnOptions';
import { WardrobeItem } from '../data/mock';
import { GarmentOptions } from '../domain/garmentOptions';
import { ZoomableImage } from './ui/ZoomableImage';

/** Before the try-on: how each garment is worn, and the button that starts it. */
export type StageSetup = {
  title: string;
  items: WardrobeItem[];
  options: GarmentOptions;
  onOptions: (options: GarmentOptions) => void;
  onGenerate: () => void;
  starting?: boolean;
  error?: string | null;
};

/** One try-on in the window: running, finished or failed. */
export type StagePage = {
  key: string;
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
};

type Props = {
  /** The try-ons of the dock, the first one first: the window is leafed through like the small one in the corner. */
  pages: StagePage[];
  /** The page the window opens on. */
  initialPage?: number;
  /** Changing it leafs over to that page (the "look is ready" banner). */
  scrollTo?: { page: number; at: number } | null;
  onPageChange?: (page: number) => void;
  onClose: () => void;
  /** Set while a look is being prepared: the window asks how to wear it, then turns into the try-on. */
  setup?: StageSetup;
  /** Drawn over the window: iOS shows nothing from under a modal. */
  banner?: ReactNode;
};

/**
 * The window try-ons happen in: it slides up when the user taps "Try on",
 * shows the photo under a scanning shimmer with the current step, and the
 * finished look fades in over it. With several try-ons the window leafs
 * through them, the first one first. Closing it early keeps them running.
 */
export function GenerationStage({ pages, initialPage = 0, scrollTo, onPageChange, onClose, setup, banner }: Props) {
  const t = useT();
  const { colors: c } = useTheme();
  const { height } = useWindowDimensions();
  const slide = useRef(new Animated.Value(height)).current;
  const pager = useRef<ScrollView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(Math.min(initialPage, Math.max(0, pages.length - 1)));
  const current = setup ? null : pages[Math.min(page, pages.length - 1)];

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, damping: 22, stiffness: 180, mass: 0.9, useNativeDriver: true }).start();
  }, [slide]);
  useEffect(() => { onPageChange?.(page); }, [page]);
  // The setup step turns into the try-ons on the page asked for: the first look, the new one a swipe away.
  useEffect(() => { if (!setup) setPage(Math.min(initialPage, Math.max(0, pages.length - 1))); }, [Boolean(setup)]);
  // A look that left the dock takes its page with it.
  useEffect(() => { if (page > pages.length - 1) setPage(Math.max(0, pages.length - 1)); }, [pages.length, page]);
  // Opened on its page straight away, without a visible scroll from the first.
  useEffect(() => { if (size.width) pager.current?.scrollTo({ x: page * size.width, animated: false }); }, [size.width]);
  useEffect(() => {
    if (!scrollTo || !size.width) return;
    pager.current?.scrollTo({ x: scrollTo.page * size.width, animated: true });
    setPage(scrollTo.page);
  }, [scrollTo?.at]);

  const close = () => {
    Animated.timing(slide, { toValue: height, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
  };
  const measure = (event: LayoutChangeEvent) => {
    const { width, height: tall } = event.nativeEvent.layout;
    if (width !== size.width || tall !== size.height) setSize({ width, height: tall });
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!size.width) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / size.width);
    if (next !== page && next >= 0 && next < pages.length) setPage(next);
  };
  const busy = Boolean(current?.busy);

  return (
    // The window animates itself: the modal comes and goes at once, so the sheet under it can
    // close right after (iOS ignores closing a modal while the one on top of it is still fading).
    <Modal transparent visible animationType="none" onRequestClose={close}>
      <SafeAreaProvider>
        <View style={styles.backdrop}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay,
            opacity: slide.interpolate({ inputRange: [0, height], outputRange: [1, 0], extrapolate: 'clamp' }) }]} />
          <Animated.View style={[styles.sheet, { backgroundColor: c.card, transform: [{ translateY: slide }] }]}>
            <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: c.text }]}>{t('Примерка')}</Text>
                  <Text style={[styles.subtitle, { color: c.muted }]} numberOfLines={1}>{setup ? setup.title : current?.title}</Text>
                </View>
                {/* While the look generates the cross folds the window into the corner. */}
                <AppPressable accessibilityRole="button" accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')} onPress={close}
                  style={[styles.close, { borderColor: c.border }]}>
                  {busy ? <ChevronDown size={22} color={c.text} /> : <X size={20} color={c.text} />}
                </AppPressable>
              </View>
              {!setup && pages.length > 1 ? (
                <View style={styles.dots} accessibilityLabel={t('Образ {page} из {count}', { page: page + 1, count: pages.length })}>
                  {pages.map((item, index) => (
                    <View key={item.key} style={[styles.dot, { backgroundColor: c.border }, index === page && [styles.dotActive, { backgroundColor: c.text }]]} />
                  ))}
                </View>
              ) : null}

              {setup ? <>
                {/* First how each garment is worn; the try-on starts from here and plays in this same window. */}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.setup}>
                  <Text style={[styles.setupTitle, { color: c.text }]}>{t('Как надеть')}</Text>
                  <TryOnOptions items={setup.items} options={setup.options} onChange={setup.onOptions} disabled={setup.starting} />
                  {setup.error ? <Text style={[styles.note, { color: c.danger }]}>{setup.error}</Text> : null}
                </ScrollView>
                <View style={styles.actions}>
                  <AppPressable accessibilityRole="button" onPress={setup.onGenerate} disabled={setup.starting}
                    accessibilityState={{ disabled: setup.starting, busy: setup.starting }}
                    style={[styles.primary, { backgroundColor: c.buttonPrimaryBg }, setup.starting && { opacity: 0.6 }]}>
                    {setup.starting ? <ActivityIndicator size="small" color={c.buttonPrimaryText} /> : <ArrowUpRight size={18} color={c.buttonPrimaryText} />}
                    <Text style={[styles.primaryText, { color: c.buttonPrimaryText }]}>{t('Примерить')}</Text>
                  </AppPressable>
                </View>
              </> : (
                <View style={{ flex: 1 }} onLayout={measure}>
                  {size.width ? (
                    <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} bounces={pages.length > 1}
                      onScroll={onScroll} scrollEventThrottle={32} contentOffset={{ x: page * size.width, y: 0 }}>
                      {pages.map(item => (
                        <View key={item.key} style={{ width: size.width, height: size.height }}>
                          <PageView page={item} onDone={close} />
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              )}
            </SafeAreaView>
          </Animated.View>
          {banner}
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** One try-on: the photo under a shimmer while it runs, then the look, its status and actions. */
function PageView({ page, onDone }: { page: StagePage; onDone: () => void }) {
  const t = useT();
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const { busy, busyLabel, startedAt, photoUri, resultUri, error, warning, saveState, onSave, onShare, onRegenerate } = page;
  const shimmer = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(resultUri && !busy ? 1 : 0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [now, setNow] = useState(Date.now());
  const done = Boolean(resultUri) && !busy;

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
    // The bar follows the usual minute and waits at 95%.
    const target = done ? 1 : busy ? Math.min(0.95, 1 - Math.exp(-2.2 * elapsed / EXPECTED_TRYON_MS)) : 0;
    Animated.timing(progress, { toValue: target, duration: done ? 350 : 500, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [now, startedAt, busy, done, progress]);

  useEffect(() => {
    if (done) Animated.timing(reveal, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    else reveal.setValue(0);
  }, [done, reveal]);

  const frameWidth = Math.min(width - 32, 480);
  const sweep = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-frameWidth, frameWidth] });
  const resultScale = reveal.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1] });

  return (
    <View style={{ flex: 1 }}>
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
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal, transform: [{ scale: resultScale }] }]}>
            <ZoomableImage uri={resultUri} accessibilityLabel={t('Результат')} />
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
            <Text style={[styles.note, { color: c.muted }]}>{t('Обычно около минуты. Окно можно свернуть — примерка продолжится.')}</Text>
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
            <AppPressable accessibilityRole="button" onPress={onDone} style={[styles.secondary, { borderColor: c.border, flex: 1 }]}>
              <Text style={[styles.secondaryText, { color: c.text }]}>{t('Готово')}</Text>
            </AppPressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '94%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 14, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: -4, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 16 },
  frame: { flex: 1, alignSelf: 'center', borderRadius: 4, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  sweep: { position: 'absolute', top: -80, bottom: -80, width: 140 },
  status: { paddingTop: 14, gap: 10, minHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { fontSize: 16, fontWeight: '600', flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  note: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 10, paddingTop: 12, paddingBottom: 8 },
  setup: { gap: 14, paddingBottom: 16 },
  setupTitle: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  primary: { minHeight: 50, borderRadius: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 16, fontWeight: '600' },
  square: { width: 50, minHeight: 50, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 46, borderRadius: 4, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontSize: 15, fontWeight: '600' },
});
