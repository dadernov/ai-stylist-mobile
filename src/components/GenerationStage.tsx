import { forwardRef, ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Modal, NativeScrollEvent, NativeSyntheticEvent, ScrollView, ScrollViewProps,
  StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { ArrowUpRight, Check, ChevronDown, Download, RefreshCw, Share2, X } from 'lucide-react-native';
import { SHADOWS } from '../constants/theme';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { GenerationView } from './studio/GenerationView';
import { TryOnOptions } from './TryOnOptions';
import { WardrobeItem } from '../data/mock';
import { GeneratedLook } from '../types/looks';
import { SaveLookButton } from './SaveLook';
import { GarmentOptions } from '../domain/garmentOptions';
import { ZoomableImage } from './ui/ZoomableImage';
import { FormScrollView } from './ui/FormScrollView';
import { SheetGestureContext, useSheetDrag, useSheetScrollLock } from './studio/SheetHandle';
import { Pill } from './studio/Glass';
import { backdropDim, font, glassEdge, INK, INK_ON_DARK, inkSoft, sheetFill, useReducedMotion } from './studio/studio';

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
  /** The stage of the running try-on: a new one is felt as well as read. */
  stage?: string | null;
  /** The look's garments that are still in the wardrobe, for the comments and thumbnails while waiting. */
  items: WardrobeItem[];
  /** The photo this try-on started from, for before/after (looks made before this was recorded have none). */
  sourceUri: string | null;
  /** When the running try-on started, for the progress bar. */
  startedAt?: number;
  /** The photo being dressed, or the intermediate frame once there is one. */
  photoUri: string | null;
  resultUri: string | null;
  error?: string | null;
  warning?: string | null;
  /** The finished look as a favourite. */
  favorite?: GeneratedLook | null;
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
 * shows the one generation view (GenerationView): the look develops in a volume
 * of light with one calm line of status, and comes through it from top to bottom. With several try-ons the window leafs
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

  // The whole window drags, like any sheet: pulled down far or fast enough it folds (busy) or closes, the same as the button;
  // onClose decides which. A second close while it slides away (double tap, tap + drag) never calls onClose twice.
  const drag = useSheetDrag({ onClose, value: slide, dismissDistance: height, threshold: Math.min(0.5, 120 / height), velocity: 0.9 });
  const close = () => drag.dismiss();
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
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,
            { opacity: slide.interpolate({ inputRange: [0, height], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
            <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: backdropDim(isDark) }]} />
          </Animated.View>
          <Animated.View onLayout={drag.onLayout} {...drag.panHandlers} style={[styles.sheet, SHADOWS.floating, { backgroundColor: sheetFill(isDark), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glassEdge(isDark), borderBottomWidth: 0, transform: [{ translateY: slide }] }]}>
            <View {...drag.grabHandlers} style={styles.grab} accessible accessibilityRole="button"
              accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')} accessibilityHint={t('Смахни вниз, чтобы закрыть')} onAccessibilityTap={close}>
              <View style={[styles.handle, { backgroundColor: isDark ? '#3A3D42' : '#D5D7DA' }]} />
            </View>
            <SheetGestureContext.Provider value={drag.hub}>
            <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: ink }]}>{t('Примерка')}</Text>
                  <Text style={[styles.subtitle, { color: inkSoft(isDark) }]} numberOfLines={1}>{setup ? setup.title : current?.title}</Text>
                </View>
                {/* While the look generates the cross folds the window into the corner. */}
                <Pill size="icon" icon={busy ? ChevronDown : X} accessibilityLabel={t(busy ? 'Свернуть' : 'Закрыть')} onPress={close} />
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
                <FormScrollView style={{ flex: 1 }} contentContainerStyle={styles.setup} showsVerticalScrollIndicator>
                  <Text style={[styles.setupTitle, { color: ink }]}>{t('Как надеть')}</Text>
                  <TryOnOptions items={setup.items} options={setup.options} onChange={setup.onOptions} disabled={setup.starting} />
                  {setup.error ? <Text style={[styles.note, { color: danger }]}>{setup.error}</Text> : null}
                </FormScrollView>
                <View style={styles.actions}>
                  <Pill variant="primary" title={t('Примерить')} icon={ArrowUpRight} loading={setup.starting} onPress={setup.onGenerate} />
                </View>
              </> : (
                <View style={{ flex: 1 }} onLayout={measure}>
                  {size.width ? (
                    <Pager ref={pager} pagingEnabled showsHorizontalScrollIndicator={false} bounces={pages.length > 1}
                      onScroll={onScroll} scrollEventThrottle={32} contentOffset={{ x: page * size.width, y: 0 }}>
                      {pages.map((item, index) => (
                        <View key={item.key} style={{ width: size.width, height: size.height }}>
                          <PageView page={item} width={size.width} active={index === page} onDone={close} />
                        </View>
                      ))}
                    </Pager>
                  ) : null}
                </View>
              )}
            </SafeAreaView>
            </SheetGestureContext.Provider>
          </Animated.View>
          {banner}
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** The pages side by side; it stands still while the window follows a downward drag. */
const Pager = forwardRef<ScrollView, ScrollViewProps>(function Pager(props, ref) {
  const locked = useSheetScrollLock();
  return <ScrollView ref={ref} horizontal scrollEnabled={!locked} {...props} />;
});

/** One try-on: the look developing out of a soft blur, then the look, its status and actions. */
function PageView({ page, width, active, onDone }: { page: StagePage; width: number; active: boolean; onDone: () => void }) {
  const t = useT();
  const { colors: { danger }, isDark } = useTheme();
  const { key, busy, busyLabel, stage, items, sourceUri, photoUri, resultUri, error, warning, saveState, onSave, onShare, onRegenerate } = page;
  const done = Boolean(resultUri) && !busy;

  // Before/after of the finished look: a new result starts on the result.
  const [showBefore, setShowBefore] = useState(false);
  useEffect(() => { setShowBefore(false); }, [resultUri]);

  // The measured pager page (the sheet inside its padding), not the window: the frame never overflows its page.
  const frameWidth = Math.min(width, 480);

  return (
    <View style={{ flex: 1 }}>
      <GenerationView jobKey={key} busy={busy} label={busyLabel} stage={stage} items={items} sourceUri={sourceUri} photoUri={photoUri} resultUri={resultUri} active={active}
        showBefore={showBefore} frameStyle={[styles.frame, { width: frameWidth }]} note={t('Обычно это около минуты. Можно свернуть окно: примерка не остановится.')}
        renderResult={fit => <ZoomableImage uri={resultUri!} resizeMode={fit} accessibilityLabel={t('Результат')} />}
        overlay={done && sourceUri ? (
          <Pill size="sm" title={t(showBefore ? 'После' : 'До')} accessibilityLabel={t(showBefore ? 'Показать результат' : 'Показать исходное фото')}
            accessibilityState={{ selected: showBefore }} onPress={() => setShowBefore(value => !value)} style={styles.compare} />
        ) : null} />

      {!busy ? (
        <View style={styles.status}>
          {error ? <Text style={[styles.note, { color: danger }]}>{error}</Text> : null}
          {warning && done ? <Text style={[styles.note, { color: inkSoft(isDark) }]}>{warning}</Text> : null}
        </View>
      ) : null}

      {!busy ? (
        <View style={styles.actions}>
          {done && page.favorite ? <SaveLookButton look={page.favorite} /> : null}
          {done ? (
            <View style={styles.row}>
              <Pill variant="primary" style={{ flex: 1 }} onPress={onSave} loading={saveState === 'saving'}
                icon={saveState === 'saved' ? Check : Download}
                title={t(saveState === 'saving' ? 'Сохраняем…' : saveState === 'saved' ? 'Сохранено в галерею' : 'Сохранить в галерею')} />
              <Pill size="icon" icon={Share2} accessibilityLabel={t('Поделиться')} onPress={onShare} />
            </View>
          ) : null}
          <View style={styles.row}>
            <Pill style={{ flex: 1 }} icon={RefreshCw} title={t(done ? 'Ещё вариант' : 'Попробовать снова')} onPress={onRegenerate} />
            <Pill style={{ flex: 1 }} title={t('Готово')} onPress={onDone} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  compare: { position: 'absolute', right: 12, bottom: 12 },
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
  frame: { flex: 1, minHeight: 200, alignSelf: 'center' },
  status: { paddingTop: 14, gap: 10, minHeight: 20 },
  note: { ...font('regular'), fontSize: 13, lineHeight: 18 },
  actions: { gap: 10, paddingTop: 12, paddingBottom: 8 },
  setup: { gap: 14, paddingBottom: 16 },
  setupTitle: { ...font('semibold'), fontSize: 15, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
