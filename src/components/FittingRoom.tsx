import { usePhotoPicker } from './usePhotoPicker';
import { OverlayOutlet } from './OverlayHost';
import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Keyboard, Modal, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, Download, ImageOff, Pencil, Plus, RefreshCw, Save, Search, Shirt, UserRound, X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WardrobeItem } from '../data/mock';
import { SavedLook, TryOnHistoryItem } from '../types/looks';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { localeFor, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { AiTryOnPreview } from './AiTryOnPreview';
import { PrimaryButton } from './ui/PrimaryButton';
import { Chip } from './Chip';
import { PhotoAdvice } from './PhotoAdvice';
import { ZoomableImage } from './ui/ZoomableImage';
import { Glass, Pill } from './studio/Glass';
import { font, glassEdge, glassFill, INK, INK_SOFT, isCutout, useReducedMotion } from './studio/studio';
import { StudioSheet } from './studio/StudioSheet';
import { useTryOnJobs } from './TryOnJobsContext';
import { useGenerationDock } from './GenerationDock';
import { SpinnerIcon } from './GenerationStage';
import { tryOnStatusLabel } from './tryOnStatus';
import { saveTryOnToGallery } from '../services/tryOnExport';
import { TryOnJob } from '../services/tryOnJobs';
import { isLegwear } from '../domain/legwear';
import { accessorySlot, TRYON_SECTIONS } from '../domain/accessories';

type Props = {
  items: WardrobeItem[];
  modelUri?: string;
  onProfile: () => void;
  onModelChange?: (uri: string) => void;
  onWardrobe: () => void;
  onSave: (look: SavedLook) => void;
  onOpenHistory: () => void;
  initialItemId?: string;
  initialItemIds?: string[];
  // The screen shows "Try on" as a floating button, always in reach while picking.
  onSelectionCta?: (cta: { count: number; open: () => void } | null) => void;
};

const supportedSections = TRYON_SECTIONS;
const onePiece = new Set(['Платье', 'Сарафан', 'Комбинезон']);

// How many garments of a section one look can layer, and how many the upper
// body takes in all: a T-shirt, a long-sleeve, a hoodie and a jacket.
const LAYERS: Record<string, number> = { 'Верх': 4, 'Верхняя одежда': 2 };
const UPPER = ['Верх', 'Верхняя одежда'];
const MAX_UPPER = 4;

export function FittingRoom({ items, modelUri, onProfile, onModelChange, onWardrobe, onSave, onOpenHistory, initialItemId, initialItemIds, onSelectionCta }: Props) {
  // Фото для примерки выбирается прямо здесь, без перехода в профиль.
  const { pickPhoto, cropModal } = usePhotoPicker();
  const pickModel = async () => {
    if (!onModelChange) { onProfile(); return; }
    const uri = await pickPhoto();
    if (uri) onModelChange(uri);
  };
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialItemIds || (initialItemId ? [initialItemId] : []));
  const [section, setSection] = useState('Все');
  const [search, setSearch] = useState('');
  const [previewOpen, setPreviewOpen] = useState(Boolean(initialItemId || initialItemIds?.length));
  const selection = useMemo(() => selectedIds.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[], [items, selectedIds]);
  useEffect(() => {
    onSelectionCta?.(selection.length ? { count: selection.length, open: () => setPreviewOpen(true) } : null);
  }, [selection.length, onSelectionCta]);
  useEffect(() => () => onSelectionCta?.(null), [onSelectionCta]);
  const visibleItems = items.filter(item => (section === 'Все' || item.section === section)
    && `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  // The session belongs to these exact photos, including the profile photo.
  const sessionKey = JSON.stringify([modelUri, selection.map(item => [item.id, item.imageUri, item.section])]);

  // Stable while the wardrobe is unchanged, so a tile redraws only when its own state does.
  const toggle = useCallback((item: WardrobeItem) => {
    setSelectedIds(previous => {
      if (previous.includes(item.id)) return previous.filter(id => id !== item.id);
      // Upper layers can be combined; the server puts them on in their natural order.
      // One more of a full section, or of a full upper body, replaces the oldest of it.
      const sectionOf = (id: string) => items.find(candidate => candidate.id === id)?.section || '';
      // Tights pair with a skirt or a dress instead of replacing them.
      // One of each accessory: a second hat replaces the first, a scarf goes with it.
      const groupOf = (candidate?: WardrobeItem) => candidate ? isLegwear(candidate) ? 'legwear' : accessorySlot(candidate) || candidate.section : '';
      const layers = LAYERS[item.section] || 1;
      const sameSection = previous.filter(id => groupOf(items.find(candidate => candidate.id === id)) === groupOf(item));
      const dropped = new Set(sameSection.slice(0, Math.max(0, sameSection.length - layers + 1)));
      if (UPPER.includes(item.section)) {
        const upper = previous.filter(id => UPPER.includes(sectionOf(id)) && !dropped.has(id));
        upper.slice(0, Math.max(0, upper.length - MAX_UPPER + 1)).forEach(id => dropped.add(id));
      }
      return [...previous.filter(id => {
        const current = items.find(candidate => candidate.id === id);
        if (!current || dropped.has(id)) return false;
        if (onePiece.has(item.category) && ['Верх', 'Низ'].includes(current.section) && !isLegwear(current) && current.id !== item.id) return false;
        if (onePiece.has(current.category) && ['Верх', 'Низ'].includes(item.section) && !isLegwear(item)) return false;
        return true;
      }), item.id];
    });
  }, [items]);

  return (
    <View style={styles.content}>
      <FittingStage items={items} modelUri={modelUri} onSave={onSave} onOpenHistory={onOpenHistory} quiet={selection.length > 0}
        onPickModel={() => { void pickModel(); }}
        // «Переодеть»: the look's pieces go back into the picker and the try-on sheet opens on them.
        onRedo={ids => {
          const present = ids.filter(id => items.some(item => item.id === id));
          if (!present.length) return;
          setSelectedIds(present); setPreviewOpen(true);
        }} />
      <PhotoAdvice uri={modelUri} />
      <View style={styles.row}>
        <Text style={styles.heading}>{t('Вещи для примерки')}</Text>
        <Text style={styles.muted}>{t('Выбрано: {count}', { count: selection.length })}</Text>
      </View>
      <Glass style={styles.searchBar}>
        <View style={styles.searchInner}>
          <Search size={17} strokeWidth={1.6} color={colors.muted} />
          <TextInput accessibilityLabel={t('Найти вещь')} placeholder={t('Найти вещь')} placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} style={styles.searchInput} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
          {search.length > 0 && <AppPressable accessibilityLabel={t('Очистить поиск')} onPress={() => setSearch('')} style={{ padding: 8 }}><X size={16} color={colors.muted} /></AppPressable>}
        </View>
      </Glass>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {['Все', ...Array.from(new Set(items.map(item => item.section)))].map(value => (
          <Chip key={value} label={t(value)} active={section === value} onPress={() => setSection(value)} />
        ))}
      </ScrollView>
      {selection.length > 0 && (
        <View style={styles.selected}>
          {selection.map(item => (
            <AppPressable key={item.id} onPress={() => toggle(item)} accessibilityRole="button" accessibilityLabel={t('Убрать {name}', { name: item.name })} style={{ borderRadius: 999, maxWidth: '100%' }}>
              <Glass>
                <View style={styles.selectedItem}>
                  {item.imageUri && <Image source={{ uri: item.imageUri }} style={styles.selectedPhoto} resizeMode="contain" />}
                  <Text style={styles.selectedName} numberOfLines={1}>{item.name}</Text>
                  <X size={14} color={colors.muted} />
                </View>
              </Glass>
            </AppPressable>
          ))}
          <AppPressable onPress={() => setSelectedIds([])}><Text style={styles.link}>{t('Очистить')}</Text></AppPressable>
        </View>
      )}
      {selection.filter(item => UPPER.includes(item.section)).length > 1 && (
        <Text style={styles.layerHint}>{t('До четырёх слоёв верха: они надеваются в естественном порядке. Например, футболка окажется под лонгсливом, а куртка — поверх всего.')}</Text>
      )}
      {selection.length > 0 && !onSelectionCta && <PrimaryButton title={t('К примерке')} icon={ArrowUpRight} onPress={() => setPreviewOpen(true)} />}
      <View style={styles.grid}>
        {visibleItems.map(item => {
          const supported = supportedSections.includes(item.section);
          const available = supported && Boolean(item.imageUri);
          const selected = selection.some(candidate => candidate.id === item.id);
          return (
            <View key={item.id} style={[styles.item, width >= 720 && { width: '31.5%' }]}>
              <PickTile item={item} selected={selected} disabled={!available} onToggle={toggle}
                status={!supported ? t('Примерка недоступна') : !item.imageUri ? t('Нет фото') : undefined} />
            </View>
          );
        })}
      </View>
      {!visibleItems.length && <Text style={styles.muted}>{t(items.length ? 'Ничего не найдено' : 'Гардероб пока пуст')}</Text>}
      {!items.length && <PrimaryButton title={t('Добавить вещи')} onPress={onWardrobe} variant="ghost" />}
      {selection.length > 0 && <FittingSession key={sessionKey} items={selection} modelUri={modelUri} onSave={onSave} visible={previewOpen} onClose={() => setPreviewOpen(false)} />}
      {cropModal}
    </View>
  );
}

const shortDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString(localeFor(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const KNOB = 78;

/**
 * The fitting room's picture: the person's own photo, or the try-on chosen in «Недавние примерки»
 * (the durable try-on journal), with a glass switch that fades between the two.
 */
function FittingStage({ items, modelUri, onSave, onOpenHistory, onPickModel, onRedo, quiet }: {
  items: WardrobeItem[]; modelUri?: string; onSave: (look: SavedLook) => void; onOpenHistory: () => void;
  onPickModel: () => void; onRedo: (ids: string[]) => void;
  /** Garments are being picked: the floating «К примерке» is then the main action, not «Сохранить». */
  quiet: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors: c, isDark } = useTheme();
  const reduced = useReducedMotion();
  const { jobs, store, error, login } = useTryOnJobs();
  // Looked at here, a finished look no longer waits in the small window.
  const dock = useGenerationDock();
  const recent = jobs.slice(0, 12);
  const [currentId, setCurrentId] = useState<string>();
  // The try-on whose result is being checked: its pill spins and waits until the poll answers.
  const [checkingId, setCheckingId] = useState<string | null>(null);
  // A newly started try-on takes the frame, so its veil shows.
  const newest = recent[0]?.id;
  useEffect(() => { setCurrentId(undefined); }, [newest]);
  const current: TryOnJob | undefined = recent.find(job => job.id === currentId) || recent[0];
  const result = current?.result;
  const busy = current?.status === 'pending';
  const [after, setAfter] = useState(true);
  useEffect(() => { setAfter(true); }, [result?.imageUri]);
  const showResult = Boolean(result && (after || !modelUri));
  // 1 shows the try-on, 0 the person's own photo.
  const fade = useRef(new Animated.Value(showResult ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: showResult ? 1 : 0, duration: reduced ? 0 : 700, easing: Easing.bezier(0.2, 0.7, 0.2, 1), useNativeDriver: true }).start();
  }, [showResult, reduced, fade]);
  const [saved, setSaved] = useState<string[]>([]);
  const [viewer, setViewer] = useState(false);
  // A finished try-on opened full screen has been looked at: it no longer waits in the small window.
  const openViewer = (job: TryOnJob) => {
    setCurrentId(job.id);
    if (!job.result) return;
    dock.viewed(job.id);
    setViewer(true);
  };
  const [gallery, setGallery] = useState<{ uri: string; state: 'saving' | 'saved' | 'error'; message?: string }>();
  const galleryState = gallery && gallery.uri === result?.imageUri ? gallery : undefined;
  const pieces = (current?.itemIds || []).map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
  const ink = isDark ? '#FFFFFF' : INK;

  const saveLook = (job: TryOnJob) => {
    const done = job.result!;
    onSave({ id: `job-${job.id}`, name: job.name, itemIds: job.itemIds, createdAt: job.createdAt,
      tryOnImageUri: done.imageUri, tryOnUpdatedAt: done.updatedAt, tryOnWarning: done.warning, tuckMode: done.tuckMode,
      tryOnQualityMode: 'quality', tryOnHistory: [done] });
    setSaved(previous => [...previous, job.id]);
  };
  const saveToGallery = async () => {
    if (!result || galleryState?.state === 'saving') return;
    const uri = result.imageUri;
    setGallery({ uri, state: 'saving' });
    try {
      // One way to the gallery for the whole app (tryOnExport): the full-size file, never a preview.
      await saveTryOnToGallery(uri, login);
      setGallery({ uri, state: 'saved', message: t('Сохранено в галерею в полном качестве') });
    } catch (e: any) {
      setGallery({ uri, state: 'error', message: e?.message || t('Не удалось сохранить в галерею') });
    }
  };

  return <View style={{ gap: 12 }}>
    <View style={styles.frameShadow}>
      <View style={styles.frame}>
        {modelUri ? <Animated.Image source={{ uri: modelUri }} resizeMode="cover" accessibilityLabel={t('Фото для примерки')}
          style={[StyleSheet.absoluteFill, { opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ scale: reduced ? 1 : fade.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }]} />
          : <View style={styles.noPhoto}>
            <UserRound size={40} strokeWidth={1.2} color={c.muted} />
            <Text style={styles.noPhotoText}>{t('Фото ещё не добавлено')}</Text>
            <Pill variant="primary" title={t('Добавить фото')} onPress={onPickModel} />
          </View>}
        {result ? <Animated.View pointerEvents={showResult ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { opacity: fade,
          transform: [{ scale: reduced ? 1 : fade.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }] }]}>
          <AppPressable feedback={false} accessibilityRole="imagebutton" accessibilityLabel={t('Открыть во весь экран')}
            onPress={() => openViewer(current!)} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: result.imageUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          </AppPressable>
        </Animated.View> : null}
        {busy ? <BusyVeil label={tryOnStatusLabel(current?.progress, t)} reduced={reduced} /> : null}
        <View style={styles.frameTop} pointerEvents="box-none">
          {result && modelUri ? <Glass style={styles.switch}>
            <View accessibilityRole="tablist" style={styles.switchInner}>
              <Animated.View pointerEvents="none" style={[styles.knob, { backgroundColor: isDark ? '#FFFFFF' : INK,
                transform: [{ translateX: fade.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB] }) }] }]} />
              {[false, true].map(look => <AppPressable key={String(look)} haptics accessibilityRole="tab" accessibilityState={{ selected: after === look }}
                onPress={() => setAfter(look)} style={styles.switchTab}>
                <Text style={[styles.switchText, { color: after === look ? (isDark ? INK : '#FFFFFF') : (isDark ? '#E4E6EA' : '#3F444B') }]}>{t(look ? 'В образе' : 'До')}</Text>
              </AppPressable>)}
            </View>
          </Glass> : <View />}
          <View style={styles.frameIcons}>
            {modelUri ? <Pill size="sm" icon={Pencil} accessibilityLabel={t('Заменить фото')} onPress={onPickModel} /> : null}
            {/* A bookmark, not a heart: hearts mean «Избранное» only; this keeps the try-on in «Образы». */}
            {result && current ? <Pill size="sm" icon={saved.includes(current.id) ? BookmarkCheck : Bookmark} accessibilityLabel={t(saved.includes(current.id) ? 'Сохранено в образы' : 'Сохранить в образы')}
              accessibilityState={{ selected: saved.includes(current.id) }} onPress={() => { if (!saved.includes(current.id)) saveLook(current); }} /> : null}
          </View>
        </View>
        {current && (result || !busy) ? <Glass radius={24} style={styles.caption}>
          <View style={styles.captionInner}>
            {pieces.length ? <View style={styles.pieces}>
              {pieces.slice(0, 4).map((item, index) => <View key={item.id} style={[styles.piece, index > 0 && { marginLeft: -8 }]}>
                {item.imageUri ? <Image source={{ uri: item.imageUri }} resizeMode={isCutout(item.imageUri) ? 'contain' : 'cover'}
                  style={isCutout(item.imageUri) ? styles.pieceCutout : styles.piecePhoto} /> : <Shirt size={18} strokeWidth={1.4} color={INK_SOFT} />}
              </View>)}
            </View> : null}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.captionTitle} numberOfLines={1}>{current.name}</Text>
              {result ? <Text style={styles.captionMeta}>{shortDateTime(result.updatedAt)}</Text>
                : current.error ? <Text style={styles.captionError} numberOfLines={3}>{t(current.error)}</Text>
                : <Text style={styles.captionMeta}>{t('Примерка не завершена')}</Text>}
            </View>
            {!result && current.status === 'retry' ? <Pill size="icon" icon={checkingId === current.id ? SpinnerIcon : RefreshCw}
              accessibilityLabel={t('Проверить результат')} disabled={checkingId === current.id} accessibilityState={{ disabled: checkingId === current.id }}
              onPress={() => { const id = current.id; setCheckingId(id); void store.poll(current).finally(() => setCheckingId(value => value === id ? null : value)); }} /> : null}
          </View>
        </Glass> : null}
      </View>
    </View>
    {busy && current ? <Pill title={t('Открыть генерацию')} onPress={() => dock.open(current.id)} />
      : current ? <View style={styles.actions}>
        {result ? <Pill style={{ flex: 1 }} variant={quiet ? 'glass' : 'primary'} icon={galleryState?.state === 'saved' ? Check : Download}
          title={t(galleryState?.state === 'saving' ? 'Сохраняем…' : galleryState?.state === 'saved' ? 'Сохранено' : 'Сохранить')}
          accessibilityLabel={t('Сохранить в галерею')} disabled={galleryState?.state === 'saving'} onPress={() => { void saveToGallery(); }} /> : null}
        <Pill style={{ flex: 1 }} icon={RefreshCw} title={t('Переодеть')} disabled={!pieces.length} onPress={() => onRedo(current.itemIds)} />
      </View> : null}
    {galleryState?.message ? <Text style={galleryState.state === 'error' ? styles.error : styles.muted}>{galleryState.message}</Text> : null}
    {error ? <Text style={styles.error}>{t(error)}</Text> : null}
    {recent.length ? <>
      <View style={styles.recentHead}>
        <Text style={styles.recentTitle}>{t('Недавние примерки')}</Text>
        <AppPressable accessibilityRole="button" accessibilityLabel={t('Вся история')} onPress={onOpenHistory} hitSlop={8}>
          <Text style={styles.recentAll}>{t('Все')}</Text>
        </AppPressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {recent.map(job => {
          const on = job.id === current?.id;
          return <AppPressable key={job.id} accessibilityRole="button" accessibilityLabel={t('Открыть примерку: {name}', { name: job.name })}
            accessibilityState={{ selected: on }} onPress={() => openViewer(job)}
            style={[styles.thumb, { borderColor: on ? ink : 'transparent' }]}>
            {job.result ? <Image source={{ uri: job.result.imageUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              : <Glass radius={14} style={[StyleSheet.absoluteFill, styles.thumbState]}>
                <View style={styles.thumbCenter}>
                  {job.status === 'pending' ? <ActivityIndicator color={ink} /> : <RefreshCw color={job.error ? c.danger : c.muted} size={20} />}
                </View>
              </Glass>}
          </AppPressable>;
        })}
      </ScrollView>
    </> : null}
    <Modal visible={viewer && Boolean(result)} presentationStyle="fullScreen" animationType="slide" onRequestClose={() => setViewer(false)}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: c.background }}>
        {result && current ? <SafeAreaView style={{ flex: 1, backgroundColor: c.background, paddingHorizontal: 20, gap: 16 }}>
          <View style={styles.viewerHead}>
            <Text numberOfLines={2} style={styles.viewerTitle}>{current.name}</Text>
            <Pill size="icon" icon={X} accessibilityLabel={t('Закрыть примерку')} onPress={() => setViewer(false)} />
          </View>
          <ZoomableImage uri={result.imageUri} />
          <PrimaryButton title={t(saved.includes(current.id) ? 'Сохранено' : 'Сохранить образ')} icon={saved.includes(current.id) ? Check : Save}
            disabled={saved.includes(current.id)} onPress={() => saveLook(current)} style={{ marginBottom: 16 }} />
        </SafeAreaView> : null}
      </SafeAreaProvider>
      <OverlayOutlet />
    </Modal>
  </View>;
}

/** A try-on being made: the picture under a light veil, a beam of light passing over it. */
function BusyVeil({ label, reduced }: { label: string; reduced: boolean }) {
  const { isDark } = useTheme();
  const [height, setHeight] = useState(0);
  const beam = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || !height) return;
    beam.setValue(0);
    const loop = Animated.loop(Animated.timing(beam, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, height, beam]);
  return <View pointerEvents="none" onLayout={event => setHeight(event.nativeEvent.layout.height)}
    style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(18,20,23,0.45)' : 'rgba(255,255,255,0.35)', overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 }]}>
    {!reduced && height ? <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.6,
      transform: [{ translateY: beam.interpolate({ inputRange: [0, 1], outputRange: [-height * 0.6, height] }) }] }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.0)' }} />
      <View style={{ flex: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.45)' }} />
      <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.0)' }} />
    </Animated.View> : null}
    <Glass>
      <View style={{ height: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator size="small" color={isDark ? '#FFFFFF' : INK} />
        <Text style={[font('semibold'), { fontSize: 13, color: isDark ? '#FFFFFF' : INK }]} numberOfLines={1}>{label}</Text>
      </View>
    </Glass>
  </View>;
}

/**
 * A garment to pick: a cut-out stands bare on glass, a photo with its own ground as a rounded print. A wardrobe
 * can hold hundreds, so the tile is memoised and drawn with glass's tint alone, without a blur of its own.
 */
const PickTile = memo(function PickTile({ item, selected, disabled, status, onToggle }: {
  item: WardrobeItem; selected: boolean; disabled: boolean; status?: string; onToggle: (item: WardrobeItem) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c, isDark } = useTheme();
  const t = useT();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item.imageUri]);
  const cutout = isCutout(item.imageUri);
  const ink = isDark ? '#FFFFFF' : INK;
  const fill = { backgroundColor: glassFill(isDark), borderColor: glassEdge(isDark) };
  return (
    <AppPressable haptics onPress={() => onToggle(item)} disabled={disabled} accessibilityRole="checkbox"
      accessibilityLabel={item.name} accessibilityState={{ checked: selected, disabled }} style={{ gap: 8 }}>
      <View style={[styles.tile, { backgroundColor: fill.backgroundColor, borderColor: selected ? ink : fill.borderColor }, disabled && { opacity: 0.6 }]}>
        {item.imageUri && !failed ? <Image source={{ uri: item.imageUri }} resizeMode={cutout ? 'contain' : 'cover'} onError={() => setFailed(true)}
          style={cutout ? styles.tileCutout : styles.tilePrint} />
          : <View style={styles.tileMissing}>
            {failed ? <ImageOff size={30} strokeWidth={1} color={c.muted} /> : <Shirt size={36} strokeWidth={1} color={c.muted} />}
            <Text style={styles.tileMissingText}>{t(failed ? 'Фото недоступно' : 'Нет фото')}</Text>
          </View>}
        {!disabled ? <View style={styles.tileBadge}>
          {selected ? <View style={[styles.badgeFill, { backgroundColor: ink }]}><Check size={15} strokeWidth={2} color={isDark ? INK : '#FFFFFF'} /></View>
            : <View style={[styles.badgeFill, styles.badgeGlass, fill]}><Plus size={15} strokeWidth={2} color={ink} /></View>}
        </View> : null}
        {status ? <View style={[styles.tileStatus, styles.badgeGlass, fill]}><Text style={styles.tileStatusText}>{status}</Text></View> : null}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>{item.name}</Text>
    </AppPressable>
  );
});

function FittingSession({ items, modelUri, onSave, visible, onClose }: Pick<Props, 'items' | 'modelUri' | 'onSave'> & { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [name, setName] = useState('');
  const [history, setHistory] = useState<TryOnHistoryItem[]>([]);
  const [selected, setSelected] = useState<TryOnHistoryItem>();
  const [saved, setSaved] = useState(false);
  const latest = selected || history[0];
  return <StudioSheet visible={visible} title={t('Примерка')} subtitle={items.map(item => item.name).join(' + ')} onClose={onClose}
    closeLabel={t('Закрыть примерку')} height="92%" scroll={false}>
    {/* How to wear each garment, then the button: the look itself opens in the generation window. */}
    {/* Closing the generation window closes this sheet too: the next look is picked on the main screen,
        with the running one in the small window in the corner. */}
    <AiTryOnPreview variant="sheet" modelUri={modelUri} items={items} history={history} resultUri={latest?.imageUri} onLeave={onClose}
      updatedAt={latest?.updatedAt} warningMessage={latest?.warning} qualityMode={latest?.qualityMode} onGenerated={payload => {
        const entry = { ...payload, id: String(payload.updatedAt) };
        setHistory(previous => [entry, ...previous.filter(item => item.imageUri !== entry.imageUri)].slice(0, 8));
        setSelected(entry);
        setSaved(false);
      }} onSelectHistory={entry => {
        setSelected(entry); setSaved(false);
        setHistory(previous => [entry, ...previous.filter(item => item.imageUri !== entry.imageUri)]
          .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
      }}
      sheetContent={<TextInput style={styles.nameInput} accessibilityLabel={t('Название образа')} placeholder={items.length === 1 ? items[0].name : t('Название образа')} value={name} onChangeText={value => { setName(value); setSaved(false); }} multiline scrollEnabled={false} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={Keyboard.dismiss} />}
      sheetFooter={<PrimaryButton title={t(saved ? 'Сохранено' : 'Сохранить образ')} icon={saved ? Check : Save} disabled={saved} variant="ghost" onPress={() => {
        onSave({
          id: `fitting-${Date.now()}`, name: name.trim() || items.map(item => item.name).join(' + '),
          itemIds: items.map(item => item.id), createdAt: Date.now(),
          tryOnImageUri: latest?.imageUri, tryOnWarning: latest?.warning, tryOnUpdatedAt: latest?.updatedAt,
          tuckMode: latest?.tuckMode, tryOnQualityMode: latest?.qualityMode, tryOnHistory: history
        });
        setSaved(true);
      }} />} />
  </StudioSheet>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { gap: 16, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  heading: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20 },
  muted: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 18 },
  error: { ...font('regular'), color: c.danger, fontSize: 13, lineHeight: 18 },
  link: { ...font('semibold'), color: c.text, fontSize: 13, paddingVertical: 8 },
  // The picture: a 34-radius frame on a soft shadow, as in the mock-up.
  frameShadow: { width: '100%', maxWidth: 480, alignSelf: 'center', aspectRatio: 0.8, borderRadius: 34,
    boxShadow: '0px 30px 60px -24px rgba(20,25,30,0.35)' },
  frame: { flex: 1, borderRadius: 34, overflow: 'hidden', backgroundColor: c.surface },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  noPhotoText: { ...font('medium'), color: c.muted, fontSize: 14, textAlign: 'center' },
  frameTop: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  frameIcons: { flexDirection: 'row', gap: 8 },
  switch: { height: 38 },
  switchInner: { flexDirection: 'row', padding: 3, height: 38 },
  knob: { position: 'absolute', top: 3, left: 3, width: KNOB, height: 32, borderRadius: 999 },
  switchTab: { width: KNOB, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  switchText: { ...font('semibold'), fontSize: 13 },
  caption: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  captionInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  pieces: { flexDirection: 'row' },
  piece: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pieceCutout: { width: 28, height: 28 },
  piecePhoto: { width: '100%', height: '100%' },
  captionTitle: { ...font('semibold'), color: c.text, fontSize: 14, lineHeight: 18 },
  captionMeta: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 16 },
  captionError: { ...font('regular'), color: c.danger, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 8 },
  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
  recentTitle: { ...font('semibold'), color: c.text, fontSize: 15 },
  recentAll: { ...font('regular'), color: c.muted, fontSize: 13 },
  thumb: { width: 62, height: 84, borderRadius: 16, overflow: 'hidden', borderWidth: 2, backgroundColor: c.surface },
  thumbState: { borderRadius: 14 },
  thumbCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  viewerTitle: { ...font('semibold'), flex: 1, color: c.text, fontSize: 17, lineHeight: 22 },
  nameInput: { ...font('regular'), color: c.text, backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  searchBar: { height: 44 },
  searchInner: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16 },
  searchInput: { ...font('regular'), flex: 1, minWidth: 0, color: c.text, fontSize: 14, height: '100%' },
  filters: { gap: 0 },
  layerHint: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 18 },
  selected: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  selectedItem: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 6, paddingRight: 12 },
  selectedPhoto: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF' },
  selectedName: { ...font('medium'), color: c.text, fontSize: 13, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { width: '48%' },
  tile: { width: '100%', aspectRatio: 0.8, borderRadius: 24, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tileCutout: { width: '80%', height: '80%' },
  tilePrint: { width: '82%', height: '86%', borderRadius: 18 },
  tileMissing: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  tileMissingText: { ...font('regular'), fontSize: 12, color: c.muted },
  tileBadge: { position: 'absolute', right: 10, top: 10 },
  badgeFill: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  badgeGlass: { borderWidth: StyleSheet.hairlineWidth * 2 },
  tileStatus: { position: 'absolute', left: 8, right: 8, bottom: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 14 },
  tileStatusText: { ...font('medium'), color: c.text, fontSize: 11, textAlign: 'center' },
  tileName: { ...font('medium'), color: c.text, fontSize: 13, lineHeight: 18, paddingHorizontal: 4 }
});
