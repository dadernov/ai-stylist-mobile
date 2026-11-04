import { usePhotoPicker } from './usePhotoPicker';
import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Keyboard, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SheetStrip } from './ui/FormScrollView';
import { Check, ImageOff, Pencil, Plus, RefreshCw, Search, Shirt, UserRound, X } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { localeFor, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { EmptyState } from './ui/EmptyState';
import { Chip } from './Chip';
import { PhotoAdvice } from './PhotoAdvice';
import { Glass, Pill } from './studio/Glass';
import { font, glassEdge, glassFill, INK, isCutout, useReducedMotion } from './studio/studio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTryOnJobs } from './TryOnJobsContext';
import { useGenerationDock } from './GenerationDock';
import { tryOnStatusLabel } from './tryOnStatus';
import { DevelopingImage } from './studio/DevelopingImage';
import { GenerationStatus } from './studio/GenerationView';
import { revealLedger } from './studio/generationFog';
import { successHaptic } from '../services/haptics';
import { useShareChoice } from './SharePoster';
import { PhotoViewer, ResultActions, ResultPhotoControls, ResultPieces, useGallerySave } from './ResultKit';
import { estimatedViewport, RESULT_GAP, RESULT_RADIUS, resultPhotoHeight } from './studio/resultLayout';
import { TryOnJob } from '../services/tryOnJobs';
import { lookFromJob } from '../domain/favorites';
import { useSaveLook } from './SaveLook';
import { isLegwear } from '../domain/legwear';
import { accessorySlot, TRYON_SECTIONS } from '../domain/accessories';

type Props = {
  items: WardrobeItem[];
  modelUri?: string;
  onProfile: () => void;
  onModelChange?: (uri: string) => void;
  onWardrobe: () => void;
  onOpenHistory: () => void;
  initialItemId?: string;
  initialItemIds?: string[];
  // The screen shows "Try on" as a floating button, always in reach while picking.
  onSelectionCta: (cta: { count: number; open: () => void } | null) => void;
  /** The tab holding this room is on screen: hidden, its generation fog pauses and a finished look's reveal waits. */
  visible?: boolean;
  /** The height of the list this room scrolls in, less what floats over it: the frame and its buttons fit it whole. */
  viewport?: number;
};

const supportedSections = TRYON_SECTIONS;
const onePiece = new Set(['Платье', 'Сарафан', 'Комбинезон']);

// How many garments of a section one look can layer, and how many the upper
// body takes in all: a T-shirt, a long-sleeve, a hoodie and a jacket.
const LAYERS: Record<string, number> = { 'Верх': 4, 'Верхняя одежда': 2 };
const UPPER = ['Верх', 'Верхняя одежда'];
const MAX_UPPER = 4;

export function FittingRoom({ items, modelUri, onProfile, onModelChange, onWardrobe, onOpenHistory, initialItemId, initialItemIds, onSelectionCta, visible = true, viewport }: Props) {
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
  const selection = useMemo(() => selectedIds.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[], [items, selectedIds]);
  const dock = useGenerationDock();
  const chosen = useRef(selection);
  chosen.current = selection;
  useEffect(() => {
    onSelectionCta(selection.length ? { count: selection.length, open: () => dock.prepare(chosen.current) } : null);
  }, [selection.length, onSelectionCta, dock.prepare]);
  useEffect(() => () => onSelectionCta(null), [onSelectionCta]);
  // Come here with garments (a card, a look, the history): their setup step opens. Nothing starts before its «Примерить».
  useEffect(() => { if (selection.length && (initialItemId || initialItemIds?.length)) dock.prepare(selection); }, []);
  const visibleItems = items.filter(item => (section === 'Все' || item.section === section)
    && `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
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
      <FittingStage viewport={viewport} visible={visible} items={items} modelUri={modelUri} onOpenHistory={onOpenHistory}
        onPickModel={() => { void pickModel(); }}
        // «Ещё раз»: the look's pieces go back into the picker and its setup step opens on them, with the choices it had.
        onRedo={job => {
          const present = job.itemIds.flatMap(id => items.filter(item => item.id === id));
          if (!present.length) return;
          setSelectedIds(present.map(item => item.id));
          dock.prepare(present, { options: job.options, name: job.name === present.map(item => item.name).join(' + ') ? undefined : job.name });
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
      <SheetStrip showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {['Все', ...Array.from(new Set(items.map(item => item.section)))].map(value => (
          <Chip key={value} label={t(value)} active={section === value} onPress={() => setSection(value)} />
        ))}
      </SheetStrip>
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
      {!visibleItems.length ? <EmptyState icon={Shirt} title={t(items.length ? 'Ничего не найдено' : 'Гардероб пока пуст')}
        actionLabel={items.length ? undefined : t('Добавить вещи')} onAction={items.length ? undefined : onWardrobe} /> : null}
      {cropModal}
    </View>
  );
}

const shortDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString(localeFor(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * The fitting room's picture: the person's own photo, or the try-on chosen in «Недавние примерки»
 * (the durable try-on journal), with a glass switch that fades between the two.
 */
function FittingStage({ viewport, visible, items, modelUri, onOpenHistory, onPickModel, onRedo }: {
  viewport?: number; visible: boolean;
  items: WardrobeItem[]; modelUri?: string; onOpenHistory: () => void;
  onPickModel: () => void; onRedo: (job: TryOnJob) => void;
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
  const [viewer, setViewer] = useState(false);
  // A finished try-on brought into the frame has been looked at: it no longer waits in the small window.
  const show = (job: TryOnJob) => {
    setCurrentId(job.id);
    if (job.result) dock.viewed(job.id);
  };
  // The picture itself only zooms: its actions stand right under it.
  const zoom = (job: TryOnJob) => { show(job); if (job.result) setViewer(true); };
  const gallery = useGallerySave(result?.imageUri);
  const favorite = useSaveLook(current && result ? lookFromJob(current) : null);
  const sharing = useShareChoice(login);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pieces = (current?.itemIds || []).map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
  const ink = isDark ? '#FFFFFF' : INK;
  // A look that finished owes its reveal here until it has played, seen live or on coming back.
  const [revealPlayed, setRevealPlayed] = useState<string>();
  // The ledger settles as the reveal starts: from then on this keeps the fog in the frame until it has played.
  const [revealingId, setRevealingId] = useState<string>();
  const fieldOwed = Boolean(current && result && (revealingId === current.id || (revealPlayed !== current.id && revealLedger.owes(current.id, 'full'))));
  const photoHeight = resultPhotoHeight({ available: viewport || estimatedViewport(windowHeight, insets.top), pieces: pieces.length > 0 });

  return <View style={{ gap: RESULT_GAP }}>
    <View style={[styles.frameShadow, { height: photoHeight }]}>
      <View style={styles.frame}>
        {modelUri ? <Animated.Image source={{ uri: modelUri }} resizeMode={result ? 'contain' : 'cover'} accessibilityLabel={t('Фото для примерки')}
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
            onPress={() => zoom(current!)} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: result.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
          </AppPressable>
        </Animated.View> : null}
        {/* The one generation picture, while it runs and until its reveal has played; then the frame's own layers, identical under it. */}
        {current && (busy || fieldOwed) ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <DevelopingImage key={current.id} revealKey={current.id} photoUri={current.progress?.previewUrl || modelUri || null} resultUri={result?.imageUri || null} developing={busy} isDark={isDark}
            active={visible && !dock.windowUp} items={pieces}  onRevealStart={() => { setRevealingId(current.id); successHaptic(); }} onRevealEnd={() => { setRevealPlayed(current.id); setRevealingId(undefined); }}>
            {result ? <Image source={{ uri: result.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} /> : null}
          </DevelopingImage>
        </View> : null}
        <ResultPhotoControls onShare={result && current ? () => sharing.offer({ uri: result.imageUri, items: pieces, title: current.name }) : undefined}
          compare={result && modelUri && !fieldOwed ? { before: !after, onToggle: () => setAfter(value => !value) } : undefined}>
          {modelUri ? <Pill size="sm" icon={Pencil} accessibilityLabel={t('Заменить фото')} onPress={onPickModel} /> : null}
        </ResultPhotoControls>
        {current && (result || !busy) ? <Glass radius={24} style={styles.caption}>
          <View style={styles.captionInner}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.captionTitle} numberOfLines={1}>{current.name}</Text>
              {result ? <Text style={styles.captionMeta}>{shortDateTime(result.updatedAt)}</Text>
                : current.error ? <Text style={styles.captionError} numberOfLines={3}>{t(current.error)}</Text>
                : <Text style={styles.captionMeta}>{t('Примерка не завершена')}</Text>}
            </View>
            {!result && current.status === 'retry' ? <Pill size="icon" icon={RefreshCw} loading={checkingId === current.id} haptics={false}
              accessibilityLabel={t('Проверить результат')}
              onPress={() => { const id = current.id; setCheckingId(id); void store.poll(current).finally(() => setCheckingId(value => value === id ? null : value)); }} /> : null}
          </View>
        </Glass> : null}
      </View>
    </View>
    {busy && current ? <GenerationStatus label={tryOnStatusLabel(current.progress, t)} stage={current.progress?.stage} items={pieces} active={visible && !dock.windowUp} /> : null}
    {busy && current ? <Pill title={t('Открыть генерацию')} onPress={() => dock.open(current.id)} />
      : current && result && !fieldOwed ? <>
        <ResultPieces items={pieces.map(item => ({ id: item.id, name: item.name, imageUri: item.imageUri }))} />
        <ResultActions gallery={gallery} save={favorite} againDisabled={!pieces.length} onAgain={() => onRedo(current)} />
      </> : current && !result ? <Pill icon={RefreshCw} title={t('Попробовать снова')} disabled={!pieces.length} onPress={() => onRedo(current)} /> : null}
    {error ? <Text style={styles.error}>{t(error)}</Text> : null}
    {recent.length ? <>
      <View style={styles.recentHead}>
        <Text style={styles.recentTitle}>{t('Недавние примерки')}</Text>
        <AppPressable accessibilityRole="button" accessibilityLabel={t('Вся история')} onPress={onOpenHistory} hitSlop={8}>
          <Text style={styles.recentAll}>{t('Все')}</Text>
        </AppPressable>
      </View>
      <SheetStrip showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {recent.map(job => {
          const on = job.id === current?.id;
          return <AppPressable key={job.id} accessibilityRole="button" accessibilityLabel={t('Открыть примерку: {name}', { name: job.name })}
            accessibilityState={{ selected: on }} onPress={() => show(job)}
            style={[styles.thumb, { borderColor: on ? ink : 'transparent' }]}>
            {job.result ? <Image source={{ uri: job.result.imageUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              : <Glass radius={14} style={[StyleSheet.absoluteFill, styles.thumbState]}>
                <View style={styles.thumbCenter}>
                  {job.status === 'pending' ? <ActivityIndicator color={ink} /> : <RefreshCw color={job.error ? c.danger : c.muted} size={20} />}
                </View>
              </Glass>}
          </AppPressable>;
        })}
      </SheetStrip>
    </> : null}
    <PhotoViewer uri={viewer && result ? result.imageUri : null} onClose={() => setViewer(false)} />
    {sharing.sheet}
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { gap: 16, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  heading: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20 },
  muted: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 18 },
  error: { ...font('regular'), color: c.danger, fontSize: 13, lineHeight: 18 },
  link: { ...font('semibold'), color: c.text, fontSize: 13, paddingVertical: 8 },
  // The picture: a 34-radius frame on a soft shadow, as in the mock-up.
  frameShadow: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: RESULT_RADIUS,
    boxShadow: '0px 30px 60px -24px rgba(20,25,30,0.35)' },
  frame: { flex: 1, borderRadius: RESULT_RADIUS, overflow: 'hidden', backgroundColor: c.surface },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  noPhotoText: { ...font('medium'), color: c.muted, fontSize: 14, textAlign: 'center' },
  caption: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  captionInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  captionTitle: { ...font('semibold'), color: c.text, fontSize: 14, lineHeight: 18 },
  captionMeta: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 16 },
  captionError: { ...font('regular'), color: c.danger, fontSize: 12, lineHeight: 16 },
  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
  recentTitle: { ...font('semibold'), color: c.text, fontSize: 15 },
  recentAll: { ...font('regular'), color: c.muted, fontSize: 13 },
  thumb: { width: 62, height: 84, borderRadius: 16, overflow: 'hidden', borderWidth: 2, backgroundColor: c.surface },
  thumbState: { borderRadius: 14 },
  thumbCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
