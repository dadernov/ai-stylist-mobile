import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Modal, PanResponder, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView,
  StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { ArrowUpRight, Check, ChevronDown, Download, RefreshCw, Share2, X } from 'lucide-react-native';
import { SHADOWS } from '../constants/theme';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { DevelopingImage } from './studio/DevelopingImage';
import { TryOnOptions } from './TryOnOptions';
import { WardrobeItem } from '../data/mock';
import { GarmentOptions } from '../domain/garmentOptions';
import { ZoomableImage } from './ui/ZoomableImage';
import { Pill } from './studio/Glass';
import { backdropDim, font, glassEdge, glassFill, INK, INK_ON_DARK, inkSoft, sheetFill, useReducedMotion } from './studio/studio';

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
 * lets the look develop out of a soft blur with one calm line of status, and
 * the finished picture sharpens from top to bottom. With several try-ons the window leafs
 * through them, the first one first. Closing it early keeps them running.
 */
export function GenerationStage({ pages, initialPage = 0, scrollTo, onPageChange, onClose, setup, banner }: Props) {
  const t = useT();
  const { colors: { danger }, isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  const { height } = useWindowDimensions();
  const slide = useRef(new Animated.Value(height)).current;
  const pager = useRef<ScrollView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(Math.min(initialPage, Math.max(0, pages.length - 1)));
  const current = setup ? null : pages[Math.min(page, pages.length - 1)];

  useEffect(() => {
    if (reduced) slide.setValue(0);
    else Animated.spring(slide, { toValue: 0, damping: 22, stiffness: 180, mass: 0.9, useNativeDriver: true }).start();
  }, [slide, reduced]);
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
    Animated.timing(slide, { toValue: height, duration: reduced ? 0 : 260, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
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
  // The grab handle works: pulled down far or fast enough the window folds (busy) or closes, the same as the button.
  const closeRef = useRef(close);
  closeRef.current = close;
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => slide.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || g.vy > 0.9) closeRef.current();
      else Animated.spring(slide, { toValue: 0, damping: 22, stiffness: 220, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(slide, { toValue: 0, damping: 22, stiffness: 220, useNativeDriver: true }).start(),
  })).current;

  return (
    // The window animates itself: the modal comes and goes at once, so the sheet under it can
    // close right after (iOS ignores closing a modal while the one on top of it is still fading).
    <Modal transparent visible animationType="none" onRequestClose={close}>
      <SafeAreaProvider>
        <View style={styles.backdrop}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,
            { opacity: slide.interpolate({ inputRange: [0, height], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
            <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: backdropDim(isDark) }]} />
          </Animated.View>
          <Animated.View style={[styles.sheet, SHADOWS.floating, { backgroundColor: sheetFill(isDark), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glassEdge(isDark), borderBottomWidth: 0, transform: [{ translateY: slide }] }]}>
            <View {...drag.panHandlers} style={styles.grab} accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')}>
              <View style={[styles.handle, { backgroundColor: isDark ? '#3A3D42' : '#D5D7DA' }]} />
            </View>
            <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
              <View style={styles.header} {...drag.panHandlers}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: ink }]}>{t('Примерка')}</Text>
                  <Text style={[styles.subtitle, { color: inkSoft(isDark) }]} numberOfLines={1}>{setup ? setup.title : current?.title}</Text>
                </View>
                {/* While the look generates the cross folds the window into the corner. */}
                <Pill size="icon" icon={busy ? ChevronDown : X} accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')} onPress={close} haptics={false} />
              </View>
              {!setup && pages.length > 1 ? (
                <View style={styles.dots} accessibilityLabel={t('Образ {page} из {count}', { page: page + 1, count: pages.length })}>
                  {pages.map((item, index) => (
                    <View key={item.key} style={[styles.dot, { backgroundColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(18,20,23,0.14)' }, index === page && [styles.dotActive, { backgroundColor: ink }]]} />
                  ))}
                </View>
              ) : null}

              {setup ? <>
                {/* First how each garment is worn; the try-on starts from here and plays in this same window. */}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.setup}>
                  <Text style={[styles.setupTitle, { color: ink }]}>{t('Как надеть')}</Text>
                  <TryOnOptions items={setup.items} options={setup.options} onChange={setup.onOptions} disabled={setup.starting} />
                  {setup.error ? <Text style={[styles.note, { color: danger }]}>{setup.error}</Text> : null}
                </ScrollView>
                <View style={styles.actions}>
                  <Pill variant="primary" title={t('Примерить')} icon={ArrowUpRight} loading={setup.starting} onPress={setup.onGenerate} haptics={false} />
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

/** One try-on: the look developing out of a soft blur, then the look, its status and actions. */
function PageView({ page, onDone }: { page: StagePage; onDone: () => void }) {
  const t = useT();
  const { width } = useWindowDimensions();
  const { colors: { danger }, isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  const { busy, busyLabel, photoUri, resultUri, error, warning, saveState, onSave, onShare, onRegenerate } = page;
  const done = Boolean(resultUri) && !busy;
  // The status line changes calmly: the old words fade out, the new ones in.
  const [label, setLabel] = useState(busyLabel);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (busyLabel === label) return;
    if (reduced) { setLabel(busyLabel); return; }
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setLabel(busyLabel);
      Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
  }, [busyLabel]);

  const frameWidth = Math.min(width - 32, 480);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.frame, { width: frameWidth, backgroundColor: glassFill(isDark) }]}>
        <DevelopingImage photoUri={photoUri} resultUri={resultUri} developing={busy} isDark={isDark}>
          {resultUri ? <ZoomableImage uri={resultUri} accessibilityLabel={t('Результат')} /> : null}
        </DevelopingImage>
      </View>

      <View style={styles.status}>
        {busy ? (
          <>
            <Animated.Text style={[styles.statusText, { color: ink, opacity: fade }]} numberOfLines={1} accessibilityLiveRegion="polite">{label}</Animated.Text>
            <Text style={[styles.note, { color: inkSoft(isDark) }]}>{t('Обычно около минуты. Окно можно свернуть — примерка продолжится.')}</Text>
          </>
        ) : null}
        {error && !busy ? <Text style={[styles.note, { color: danger }]}>{error}</Text> : null}
        {warning && done ? <Text style={[styles.note, { color: inkSoft(isDark) }]}>{warning}</Text> : null}
      </View>

      {!busy ? (
        <View style={styles.actions}>
          {done ? (
            <View style={styles.row}>
              <Pill variant="primary" style={{ flex: 1 }} onPress={onSave} loading={saveState === 'saving'} haptics={false}
                icon={saveState === 'saved' ? Check : Download}
                title={t(saveState === 'saving' ? 'Сохраняем…' : saveState === 'saved' ? 'Сохранено в галерею' : 'Сохранить в галерею')} />
              {Platform.OS !== 'web' ? <Pill size="icon" icon={Share2} accessibilityLabel={t('Поделиться')} onPress={onShare} haptics={false} /> : null}
            </View>
          ) : null}
          <View style={styles.row}>
            <Pill style={{ flex: 1 }} icon={RefreshCw} title={t(done ? 'Ещё вариант' : 'Попробовать снова')} onPress={onRegenerate} haptics={false} />
            <Pill style={{ flex: 1 }} title={t('Готово')} onPress={onDone} haptics={false} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '94%', width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 20, overflow: 'hidden' },
  grab: { alignSelf: 'stretch', paddingTop: 10, paddingBottom: 14 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  title: { ...font('semibold'), fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  subtitle: { ...font('regular'), fontSize: 13, lineHeight: 18, marginTop: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: -4, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 16 },
  frame: { flex: 1, alignSelf: 'center', borderRadius: 30, overflow: 'hidden' },
  status: { paddingTop: 14, gap: 10, minHeight: 20 },
  statusText: { ...font('medium'), fontSize: 15, lineHeight: 20, textAlign: 'center' },
  note: { ...font('regular'), fontSize: 13, lineHeight: 18 },
  actions: { gap: 10, paddingTop: 12, paddingBottom: 8 },
  setup: { gap: 14, paddingBottom: 16 },
  setupTitle: { ...font('semibold'), fontSize: 15, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
