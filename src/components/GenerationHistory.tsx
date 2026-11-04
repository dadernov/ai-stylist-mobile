import { useEffect, useMemo, useRef, useState } from 'react';
import { TRYON_SECTIONS } from '../domain/accessories';
import { ActivityIndicator, FlatList, Image, Keyboard, Modal, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight, ChevronRight, Clock3, History, RefreshCw, Shirt, X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WardrobeItem } from '../data/mock';
import { lookFromJob } from '../domain/favorites';
import { SaveLookButton, useSaveLook } from './SaveLook';
import { ResultActions, ResultPhotoControls, ResultPicture, ResultPieces, useGallerySave } from './ResultKit';
import { useShareChoice } from './SharePoster';
import { EmptyState } from './ui/EmptyState';
import { RESULT_GAP, RESULT_RADIUS } from './studio/resultLayout';
import { TryOnJob } from '../services/tryOnJobs';
import { useTryOnJobs } from './TryOnJobsContext';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { localeFor, useLanguage, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { FormScrollView } from './ui/FormScrollView';
import { OptionPicker } from './ui/OptionPicker';
import { FittedImage } from './ui/FittedFrame';
import { ZoomableImage } from './ui/ZoomableImage';
import { Pill } from './studio/Glass';
import { StudioBackdrop } from './studio/StudioBackdrop';
import { font, hairline } from './studio/studio';

type Props = {
  items: WardrobeItem[];
  itemId?: string;
  onFilter: (id?: string) => void;
  onOpenItem: (id: string) => void;
  onTryOn: (ids: string[]) => void;
};

export function GenerationHistory({ items, itemId, onFilter, onOpenItem, onTryOn }: Props) {
  const { jobs, ready, error, store } = useTryOnJobs();
  const { colors: c, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { lang } = useLanguage();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = jobs.find(job => job.id === selectedId);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [expanded, setExpanded] = useState(false);
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const labels = useMemo(() => {
    const names: Record<string, string> = { '': t('Все вещи') };
    for (const job of jobs) for (const id of job.itemIds) {
      names[id] = byId.get(id)?.name || job.garments?.find(g => g.id === id)?.name || (job.itemIds.length === 1 ? job.name : t('Удалённая вещь'));
    }
    if (itemId && !names[itemId]) names[itemId] = byId.get(itemId)?.name || t('Удалённая вещь');
    return names;
  }, [jobs, byId, itemId, t]);
  const filtered = useMemo(() => jobs.filter(job => !itemId || job.itemIds.includes(itemId))
    .sort((a, b) => b.createdAt - a.createdAt), [jobs, itemId]);
  const date = (job: TryOnJob) => job.createdAt > 0 ? new Date(job.createdAt).toLocaleString(localeFor(lang), {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : t('Ранее');
  const status = (job: TryOnJob) => t(job.status === 'succeeded' ? 'Готово' : job.status === 'pending' ? 'Генерируем образ…'
    : job.status === 'retry' ? 'Ожидает проверки' : 'Не получилось');
  const canRepeat = !!selected?.itemIds.length && selected.itemIds.every(id => {
    const item = byId.get(id);
    return item?.imageUri && TRYON_SECTIONS.includes(item.section);
  });
  const close = () => { setExpanded(false); setSelectedId(undefined); };
  return <>
    <FlatList key={itemId || 'all'} data={filtered} numColumns={2} keyExtractor={job => job.id}
      style={styles.list} contentContainerStyle={styles.content} columnWrapperStyle={styles.columns}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      ListHeaderComponent={<View style={styles.filters}>
        <View style={styles.row}><Text accessibilityRole="header" style={styles.title}>{t('История генераций')}</Text>
          <Text style={styles.muted}>{filtered.length}</Text></View>
        <OptionPicker label="Вещь в образе" options={Object.keys(labels)} labels={labels} value={itemId || ''}
          onChange={id => onFilter(id || undefined)} />
        {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
      </View>}
      ListEmptyComponent={ready ? <EmptyState icon={History} title={t(itemId ? 'С этой вещью пока нет примерок' : 'Пока нет генераций')}
        actionLabel={t(itemId && byId.has(itemId) ? 'Примерить вещь' : 'К примерке')} onAction={() => onTryOn(itemId && byId.has(itemId) ? [itemId] : [])} />
        : <View style={styles.empty}><ActivityIndicator color={c.text} /><Text style={styles.heading}>{t('История ещё загружается.')}</Text></View>}
      renderItem={({ item: job }) => <View style={styles.card}><AppPressable accessibilityRole="button"
        accessibilityLabel={t('Открыть генерацию: {name}', { name: job.name })} onPress={() => setSelectedId(job.id)} style={styles.cardBody}>
        <View style={[styles.photo, job.result && styles.bare]}>
          {job.result ? <FittedImage uri={job.result.imageUri} radius={24} style={StyleSheet.absoluteFill} />
            : job.status === 'pending' ? <ActivityIndicator size="large" color={c.text} /> : <Clock3 size={32} color={c.muted} strokeWidth={1.3} />}
        </View>
        <Text numberOfLines={2} style={styles.name}>{job.name}</Text>
        <Text style={styles.date}>{date(job)}</Text>
        <Text style={[styles.status, job.status === 'failed' && { color: c.danger }]}>{status(job)}</Text>
      </AppPressable>{job.result ? <SaveLookButton look={lookFromJob(job)} compact /> : null}</View>} />
    {selected && <Modal presentationStyle="fullScreen" animationType="slide" onRequestClose={close}>
      <SafeAreaProvider>
      <StudioBackdrop>
      <SafeAreaView style={styles.modal}>
        <View style={styles.toolbar}><View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={styles.detailTitle}>{selected.name}</Text><Text style={styles.muted}>{date(selected)}</Text>
        </View><Pill size="icon" icon={X} accessibilityLabel={t('Закрыть генерацию')} onPress={close} /></View>
        {expanded && selected.result ? <>
          <ZoomableImage uri={selected.result.imageUri} />
          <Pill title={t('К деталям')} onPress={() => setExpanded(false)} style={{ margin: 16 }} />
        </> : selected.result ? <HistoryResult job={selected} byId={byId} canRepeat={canRepeat} onExpand={() => setExpanded(true)}
          onAgain={() => { close(); onTryOn(selected.itemIds); }} onOpenItem={id => { close(); onOpenItem(id); }} /> : <FormScrollView contentContainerStyle={styles.detail}>
          <View style={styles.result}>
            <View style={styles.empty}>{selected.status === 'pending' && <ActivityIndicator color={c.text} />}<Text style={styles.heading}>{status(selected)}</Text></View>
          </View>
          {selected.error && <Text accessibilityRole="alert" style={styles.error}>{t(selected.error)}</Text>}
          <Text style={styles.title}>{t('Вещи в образе')}</Text>
          {selected.itemIds.map(id => {
            const item = byId.get(id);
            const name = item?.name || selected.garments?.find(g => g.id === id)?.name || (selected.itemIds.length === 1 ? selected.name : t('Удалённая вещь'));
            return <AppPressable key={id} disabled={!item} accessibilityRole={item ? 'button' : undefined}
              accessibilityLabel={item ? t('Открыть вещь: {name}', { name }) : undefined} style={[styles.garment, { borderColor: hairline(isDark) }]}
              onPress={() => { close(); onOpenItem(id); }}>
              {item?.imageUri ? <Image source={{ uri: item.imageUri }} resizeMode="contain" style={styles.garmentPhoto} />
                : <View style={styles.garmentPhoto}><Shirt color={c.muted} size={22} /></View>}
              <View style={{ flex: 1, gap: 4 }}><Text style={styles.name}>{name}</Text>
                <Text style={styles.muted}>{item ? t(item.category) : t('Удалена из гардероба')}</Text></View>
              {item && <ChevronRight size={19} color={c.muted} />}
            </AppPressable>;
          })}
          {selected.status === 'retry' && <Pill title={t('Проверить результат')} icon={RefreshCw} loading={checkingId === selected.id} haptics={false}
            onPress={() => { const id = selected.id; setCheckingId(id); void store.poll(selected).finally(() => { if (mounted.current) setCheckingId(value => value === id ? null : value); }); }} />}
          {canRepeat && <Pill title={t('Примерить снова')} icon={ArrowUpRight}
            onPress={() => { close(); onTryOn(selected.itemIds); }} />}
        </FormScrollView>}
      </SafeAreaView>
      </StudioBackdrop>
      </SafeAreaProvider>
    </Modal>}
  </>;
}

/** A finished try-on from the history: the same photo, thumbnails and three buttons as every result. A thumbnail opens its piece. */
function HistoryResult({ job, byId, canRepeat, onExpand, onAgain, onOpenItem }: {
  job: TryOnJob; byId: Map<string, WardrobeItem>; canRepeat: boolean; onExpand: () => void; onAgain: () => void; onOpenItem: (id: string) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const { login } = useTryOnJobs();
  const uri = job.result!.imageUri;
  const gallery = useGallerySave(uri);
  const save = useSaveLook(lookFromJob(job));
  const sharing = useShareChoice(login);
  const pieces = job.itemIds.map(id => {
    const item = byId.get(id);
    return { id, item, imageUri: item?.imageUri, name: item?.name || job.garments?.find(g => g.id === id)?.name || (job.itemIds.length === 1 ? job.name : t('Удалённая вещь')) };
  });
  return <View style={styles.resultColumn}>
    <ResultPicture uri={uri} onOpen={onExpand}>
      <ResultPhotoControls onShare={() => sharing.offer({ uri, items: pieces.flatMap(piece => piece.item ? [piece.item] : []), title: job.name })} />
    </ResultPicture>
    {job.error ? <Text accessibilityRole="alert" style={styles.error} numberOfLines={2}>{t(job.error)}</Text> : null}
    {job.result?.warning ? <Text style={styles.muted} numberOfLines={2}>{t(job.result.warning)}</Text> : null}
    <ResultPieces items={pieces} onPress={onOpenItem} />
    <ResultActions gallery={gallery} save={save} againDisabled={!canRepeat} onAgain={onAgain} />
    {sharing.sheet}
  </View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  resultColumn: { flex: 1, gap: RESULT_GAP, paddingHorizontal: 20, paddingBottom: 12, width: '100%', maxWidth: 700, alignSelf: 'center' },
  list: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  content: { paddingBottom: 28 }, columns: { gap: 14 },
  filters: { gap: 14, paddingBottom: 20 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  heading: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20, flexShrink: 1, textAlign: 'center' },
  muted: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 19 },
  error: { ...font('regular'), color: c.danger, fontSize: 13, lineHeight: 18 },
  card: { width: '48%', flexGrow: 0, flexShrink: 1, gap: 8, marginBottom: 22 },
  cardBody: { gap: 3 },
  // Photo frames as in the studio: 24 radius on the soft stage.
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  name: { ...font('medium'), color: c.text, fontSize: 14, lineHeight: 19 },
  date: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 16 },
  status: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 16 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 36, paddingHorizontal: 8 },
  modal: { flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, width: '100%', maxWidth: 700, alignSelf: 'center' },
  detailTitle: { ...font('semibold'), color: c.text, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  detail: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 14, width: '100%', maxWidth: 700, alignSelf: 'center' },
  bare: { backgroundColor: 'transparent' },
  result: { width: '100%', aspectRatio: 3 / 4, backgroundColor: c.surface, borderRadius: RESULT_RADIUS, overflow: 'hidden', justifyContent: 'center' },
  garment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  garmentPhoto: { width: 52, height: 64, backgroundColor: c.stage, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }
});
