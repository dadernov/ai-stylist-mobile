import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Check, Download, Heart, LucideIcon, RefreshCw, Share2, Shirt } from 'lucide-react-native';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { WardrobeItem } from '../data/mock';
import { saveTryOnToGallery } from '../services/tryOnExport';
import { AppPressable } from './AppPressable';
import { useFavorites, useSaveLook } from './SaveLook';
import { createDoubleTap } from './studio/doubleTap';
import { Glass, Pill } from './studio/Glass';
import { ACTION_FONT, ACTION_GAP, ACTION_INSET, ACTIONS_HEIGHT, PIECE_SIZE, RESULT_RADIUS } from './studio/resultLayout';
import { pictureFit } from './studio/imageFit';
import { useImageAspect } from './studio/useImageAspect';
import { FittedFrame } from './ui/FittedFrame';
import { SheetGestureBlock } from './studio/SheetHandle';
import { font, glassEdge, glassFill, INK, INK_ON_DARK, useReducedMotion } from './studio/studio';
import { SheetStrip } from './ui/FormScrollView';
import { ZoomableImage } from './ui/ZoomableImage';

/** The one way to the gallery from a finished look: the state of the button, and an error to say. */
export function useGallerySave(uri: string | null | undefined, draft?: boolean) {
  const { login } = useFavorites();
  const t = useT();
  const [state, setState] = useState<{ uri: string; status: 'saving' | 'saved' | 'error'; message?: string } | null>(null);
  const current = state && state.uri === uri ? state : null;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async () => {
    if (!uri || current?.status === 'saving') return;
    setState({ uri, status: 'saving' });
    try {
      // The full-size file, never a preview (tryOnExport).
      await saveTryOnToGallery(uri, login);
      if (mounted.current) setState({ uri, status: 'saved' });
    } catch (error: any) {
      if (mounted.current) setState({ uri, status: 'error', message: t(error?.message || 'Не удалось сохранить в галерею') });
    }
  };
  const note = current?.status === 'saved' ? t(draft ? 'Черновик сохранён в галерею' : 'Сохранено в галерею в полном качестве') : undefined;
  return { status: current?.status || 'idle' as const, message: current?.status === 'error' ? current.message : undefined, note, draft: Boolean(draft), save };
}

function ActionCell({ icon: Icon, label, a11y, onPress, disabled, loading, filled, selected }: {
  icon: LucideIcon; label: string; a11y: string; onPress: () => void; disabled?: boolean; loading?: boolean; filled?: boolean; selected?: boolean;
}) {
  const { isDark } = useTheme();
  const ink = isDark ? '#FFFFFF' : INK;
  return (
    <AppPressable haptics accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading), selected }}
      disabled={disabled || loading} onPress={onPress} style={[styles.cell, disabled && styles.off]}>
      <Glass radius={20}>
        <View style={styles.cellInner}>
          {loading ? <ActivityIndicator size="small" color={ink} style={styles.spinner} /> : <Icon size={19} strokeWidth={1.8} color={ink} fill={filled ? ink : 'none'} />}
          <Text style={[font('semibold'), styles.cellLabel, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.1}>{label}</Text>
        </View>
      </Glass>
    </AppPressable>
  );
}

/**
 * The three buttons beside every finished try-on, the same words everywhere: to the gallery, into the favourites, once again.
 * The visible words are short, so three fit a row on the narrowest phone; a screen reader hears them in full.
 * `onUnsave`: where unsaving is destructive, the screen asks first instead of the heart removing at once.
 */
export function ResultActions({ gallery, save, onAgain, againDisabled, onUnsave }: {
  gallery: ReturnType<typeof useGallerySave>; save: ReturnType<typeof useSaveLook>; onAgain: () => void; againDisabled?: boolean; onUnsave?: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const message = gallery.message || (save.failed ? t('Не удалось сохранить образ. Проверь интернет и место на устройстве.') : null);
  return (
    <View style={styles.actions}>
      <View style={styles.row}>
        <ActionCell icon={gallery.status === 'saved' ? Check : Download} loading={gallery.status === 'saving'} label={t(gallery.status === 'saved' ? 'Сохранено' : 'В галерею')}
          a11y={t(gallery.status === 'saved' ? 'Сохранено в галерею' : gallery.draft ? 'Сохранить черновик в галерею' : 'Сохранить в галерею')} onPress={() => { void gallery.save(); }} />
        <ActionCell icon={Heart} filled={save.saved} selected={save.saved} loading={save.busy} label={t(save.saved ? 'Сохранён' : 'Сохранить')}
          a11y={t(save.saved ? 'В избранном' : 'Сохранить образ')} onPress={() => { if (save.saved && onUnsave) onUnsave(); else void save.toggle(); }} />
        <ActionCell icon={RefreshCw} label={t('Ещё раз')} a11y={t('Примерить снова')} disabled={againDisabled} onPress={onAgain} />
      </View>
      {message ? <Text accessibilityRole="alert" style={[font('regular'), styles.error, { color: colors.danger }]} numberOfLines={2}>{message}</Text>
        : gallery.note ? <Text accessibilityLiveRegion="polite" style={[font('regular'), styles.error, { color: colors.muted }]} numberOfLines={2}>{gallery.note}</Text> : null}
    </View>
  );
}

/** The look's pieces as one row of small thumbnails, scrolled sideways when there are many. */
export function ResultPieces({ items, onPress }: { items: { id: string; name: string; imageUri?: string; item?: WardrobeItem }[]; onPress?: (id: string) => void }) {
  const t = useT();
  const { colors, isDark } = useTheme();
  if (!items.length) return null;
  return (
    <SheetStrip showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripRow}>
      {items.map(item => {
        const body = (
          <View style={[styles.piece, { backgroundColor: glassFill(isDark), borderColor: glassEdge(isDark) }]}>
            {item.imageUri ? <Image source={{ uri: item.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} accessibilityLabel={item.name} />
              : <View style={styles.pieceEmpty} accessibilityLabel={item.name}><Shirt size={18} strokeWidth={1.4} color={colors.muted} /></View>}
          </View>
        );
        return onPress && item.item
          ? <AppPressable key={item.id} accessibilityRole="button" accessibilityLabel={t('Открыть вещь: {name}', { name: item.name })} onPress={() => onPress(item.id)}>{body}</AppPressable>
          : <View key={item.id}>{body}</View>;
      })}
    </SheetStrip>
  );
}

/** The controls that stand on every result photo: before/after on the left; share, and what else this screen has, on the right. */
export function ResultPhotoControls({ onShare, compare, children }: { onShare?: () => void; compare?: { before: boolean; onToggle: () => void }; children?: ReactNode }) {
  const t = useT();
  return (
    <View pointerEvents="box-none" style={styles.controls}>
      {compare ? <Pill size="sm" title={t(compare.before ? 'После' : 'До')} accessibilityLabel={t(compare.before ? 'Показать результат' : 'Показать исходное фото')}
        accessibilityState={{ selected: compare.before }} onPress={compare.onToggle} /> : <View />}
      <View style={styles.controlsRight}>
        {children}
        {onShare ? <Pill size="sm" icon={Share2} accessibilityLabel={t('Поделиться')} onPress={onShare} /> : null}
      </View>
    </View>
  );
}

/** A stored result in its own shape, opening full screen on a tap, its controls on the picture itself. Fills the height left in its column. */
export function ResultPicture({ uri, onOpen, children }: { uri: string; onOpen: () => void; children?: ReactNode }) {
  const t = useT();
  const aspect = useImageAspect(uri);
  return (
    <FittedFrame aspect={aspect} radius={RESULT_RADIUS} style={styles.picture}>
      <AppPressable style={StyleSheet.absoluteFill} accessibilityRole="imagebutton" accessibilityLabel={t('Открыть во весь экран')} onPress={onOpen}>
        <Image source={{ uri }} resizeMode={pictureFit(aspect)} style={StyleSheet.absoluteFill} />
      </AppPressable>
      {children}
    </FittedFrame>
  );
}

/** The photo full screen, pinchable, on black in either theme. */
export function PhotoViewer({ uri, onClose, inSheet }: { uri: string | null; onClose: () => void; inSheet?: boolean }) {
  const t = useT();
  return (
    <>
      {inSheet ? <SheetGestureBlock active={Boolean(uri)} /> : null}
      <Modal transparent animationType="fade" visible={Boolean(uri)} onRequestClose={onClose}>
        <View style={styles.viewer}>
          {uri ? <ZoomableImage uri={uri} style={styles.viewerImage} /> : null}
          <Pill title={t('Закрыть')} style={styles.viewerClose} onPress={onClose} />
        </View>
      </Modal>
    </>
  );
}

/** Watches a photo for a double tap without taking any touch from what is around it: pinch, pager and sheet go on as ever. */
export function DoubleTapArea({ enabled, onDoubleTap, children }: { enabled: boolean; onDoubleTap: () => void; children: ReactNode }) {
  const taps = useRef(createDoubleTap()).current;
  return (
    <View style={StyleSheet.absoluteFill}
      onTouchStart={event => { taps.down(event.nativeEvent.pageX, event.nativeEvent.pageY, Date.now(), event.nativeEvent.touches?.length ?? 1); }}
      onTouchEnd={event => { if (taps.up(event.nativeEvent.pageX, event.nativeEvent.pageY, Date.now(), event.nativeEvent.touches?.length ?? 0) && enabled) onDoubleTap(); }}
      onTouchCancel={() => taps.cancel()}>
      {children}
    </View>
  );
}

/** A heart that blooms on the photo each time `shot` grows. */
export function HeartBurst({ shot }: { shot: number }) {
  const reduced = useReducedMotion();
  const { isDark } = useTheme();
  const bloom = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shot) return;
    bloom.setValue(reduced ? 1 : 0.4);
    fade.setValue(1);
    const run = Animated.parallel([
      ...(reduced ? [] : [Animated.spring(bloom, { toValue: 1, damping: 9, stiffness: 260, mass: 0.7, useNativeDriver: true })]),
      Animated.sequence([Animated.delay(reduced ? 300 : 420), Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true })]),
    ]);
    run.start();
    return () => run.stop();
  }, [shot]);
  return (
    <Animated.View pointerEvents="none" style={[styles.burst, { opacity: fade, transform: [{ scale: bloom }] }]}>
      <Heart size={88} strokeWidth={1.2} color={isDark ? INK_ON_DARK : '#FFFFFF'} fill={isDark ? INK_ON_DARK : '#FFFFFF'} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  picture: { flex: 1, minHeight: 150 },
  actions: { gap: 6 },
  row: { flexDirection: 'row', gap: ACTION_GAP },
  cell: { flex: 1, minWidth: 0, borderRadius: 20 },
  off: { opacity: 0.45 },
  cellInner: { height: ACTIONS_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: ACTION_INSET },
  cellLabel: { fontSize: ACTION_FONT, lineHeight: 16 },
  spinner: { height: 19, transform: [{ scale: 0.8 }] },
  error: { fontSize: 12, lineHeight: 16 },
  strip: { flexGrow: 0, height: PIECE_SIZE },
  stripRow: { gap: 8 },
  piece: { width: PIECE_SIZE, height: PIECE_SIZE, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  pieceEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'flex-start' },
  controlsRight: { flexDirection: 'row', gap: 8 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 16 },
  viewerImage: { width: '100%', height: '86%', flex: 0 },
  viewerClose: { alignSelf: 'center', marginTop: 12 },
  burst: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: 0 },
});
