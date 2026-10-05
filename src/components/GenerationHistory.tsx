import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Keyboard, Modal, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight, Check, ChevronRight, Clock3, History, RefreshCw, Save, Shirt, X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WardrobeItem } from '../data/mock';
import { SavedLook } from '../types/looks';
import { TryOnJob } from '../services/tryOnJobs';
import { useTryOnJobs } from './TryOnJobsContext';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { localeFor, useLanguage, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { FormScrollView } from './ui/FormScrollView';
import { IconButton } from './ui/IconButton';
import { OptionPicker } from './ui/OptionPicker';
import { PrimaryButton } from './ui/PrimaryButton';
import { ZoomableImage } from './ui/ZoomableImage';

type Props = {
  items: WardrobeItem[];
  savedLooks: SavedLook[];
  itemId?: string;
  onFilter: (id?: string) => void;
  onOpenItem: (id: string) => void;
  onTryOn: (ids: string[]) => void;
  onSave: (look: SavedLook) => void;
};

export function GenerationHistory({ items, savedLooks, itemId, onFilter, onOpenItem, onTryOn, onSave }: Props) {
  const { jobs, ready, error, store } = useTryOnJobs();
  const { colors: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { lang } = useLanguage();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = jobs.find(job => job.id === selectedId);
  const [checking, setChecking] = useState(false);
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
  const saved = !!selected?.result && savedLooks.some(look => look.id === `job-${selected.id}` || look.tryOnImageUri === selected.result?.imageUri);
  const canRepeat = !!selected?.itemIds.length && selected.itemIds.every(id => {
    const item = byId.get(id);
    return item?.imageUri && ['Верх', 'Низ', 'Обувь', 'Верхняя одежда'].includes(item.section);
  });
  const close = () => { setExpanded(false); setSelectedId(undefined); };
  return <>
    <FlatList key={itemId || 'all'} data={filtered} numColumns={2} keyExtractor={job => job.id}
      style={styles.list} contentContainerStyle={styles.content} columnWrapperStyle={styles.columns}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      ListHeaderComponent={<View style={styles.filters}>
        <View style={styles.row}><Text accessibilityRole="header" style={styles.heading}>{t('История генераций')}</Text>
          <Text style={styles.muted}>{filtered.length}</Text></View>
        <OptionPicker label="Вещь в образе" options={Object.keys(labels)} labels={labels} value={itemId || ''}
          onChange={id => onFilter(id || undefined)} />
        {error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{t(error)}</Text>}
      </View>}
      ListEmptyComponent={<View style={styles.empty}>
        {ready ? <History size={36} strokeWidth={1.3} color={c.muted} /> : <ActivityIndicator color={c.accentGold} />}
        <Text style={styles.heading}>{t(!ready ? 'История ещё загружается.' : itemId ? 'С этой вещью пока нет примерок' : 'Пока нет генераций')}</Text>
        {ready && <PrimaryButton title={t(itemId && byId.has(itemId) ? 'Примерить вещь' : 'К примерке')} icon={ArrowUpRight}
          onPress={() => onTryOn(itemId && byId.has(itemId) ? [itemId] : [])} />}
      </View>}
      renderItem={({ item: job }) => <AppPressable accessibilityRole="button"
        accessibilityLabel={t('Открыть генерацию: {name}', { name: job.name })} onPress={() => setSelectedId(job.id)} style={styles.card}>
        <View style={styles.photo}>
          {job.result ? <Image source={{ uri: job.result.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
            : job.status === 'pending' ? <ActivityIndicator size="large" color={c.accentGold} /> : <Clock3 size={32} color={c.muted} strokeWidth={1.3} />}
        </View>
        <Text numberOfLines={2} style={styles.name}>{job.name}</Text>
        <Text style={styles.date}>{date(job)}</Text>
        <Text style={[styles.status, job.status === 'failed' && { color: c.danger }]}>{status(job)}</Text>
      </AppPressable>} />
    {selected && <Modal presentationStyle="fullScreen" animationType="slide" onRequestClose={close}>
      <SafeAreaProvider style={styles.modal}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.toolbar}><View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={styles.heading}>{selected.name}</Text><Text style={styles.muted}>{date(selected)}</Text>
        </View><IconButton icon={X} label={t('Закрыть генерацию')} onPress={close} /></View>
        {expanded && selected.result ? <>
          <ZoomableImage uri={selected.result.imageUri} />
          <PrimaryButton title={t('К деталям')} variant="ghost" onPress={() => setExpanded(false)} style={{ margin: 16 }} />
        </> : <FormScrollView contentContainerStyle={styles.detail}>
          <AppPressable disabled={!selected.result} accessibilityRole="button" accessibilityLabel={t('Увеличить результат')}
            style={styles.result} onPress={() => setExpanded(true)}>
            {selected.result ? <Image source={{ uri: selected.result.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
              : <View style={styles.empty}>{selected.status === 'pending' && <ActivityIndicator color={c.accentGold} />}<Text style={styles.heading}>{status(selected)}</Text></View>}
          </AppPressable>
          {selected.error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{t(selected.error)}</Text>}
          {selected.result?.warning && <Text style={styles.muted}>{t(selected.result.warning)}</Text>}
          <Text style={styles.heading}>{t('Вещи в образе')}</Text>
          {selected.itemIds.map(id => {
            const item = byId.get(id);
            const name = item?.name || selected.garments?.find(g => g.id === id)?.name || (selected.itemIds.length === 1 ? selected.name : t('Удалённая вещь'));
            return <AppPressable key={id} disabled={!item} accessibilityRole={item ? 'button' : undefined}
              accessibilityLabel={item ? t('Открыть вещь: {name}', { name }) : undefined} style={styles.garment}
              onPress={() => { close(); onOpenItem(id); }}>
              {item?.imageUri ? <Image source={{ uri: item.imageUri }} resizeMode="contain" style={styles.garmentPhoto} />
                : <View style={styles.garmentPhoto}><Shirt color={c.muted} size={22} /></View>}
              <View style={{ flex: 1, gap: 4 }}><Text style={styles.name}>{name}</Text>
                <Text style={styles.muted}>{item ? t(item.category) : t('Удалена из гардероба')}</Text></View>
              {item && <ChevronRight size={19} color={c.muted} />}
            </AppPressable>;
          })}
          {selected.status === 'retry' && <PrimaryButton title={t('Проверить результат')} icon={RefreshCw} loading={checking}
            onPress={() => { setChecking(true); void store.poll(selected).finally(() => setChecking(false)); }} />}
          {selected.result && <PrimaryButton title={t(saved ? 'Сохранено' : 'Сохранить образ')} icon={saved ? Check : Save} disabled={saved}
            onPress={() => {
              const result = selected.result!;
              onSave({ id: `job-${selected.id}`, name: selected.name, itemIds: selected.itemIds, createdAt: selected.createdAt,
                tryOnImageUri: result.imageUri, tryOnUpdatedAt: result.updatedAt, tryOnWarning: result.warning, tuckMode: result.tuckMode,
                tryOnQualityMode: 'quality', tryOnHistory: [result] });
            }} />}
          {canRepeat && <PrimaryButton title={t('Примерить снова')} variant="ghost" icon={ArrowUpRight}
            onPress={() => { close(); onTryOn(selected.itemIds); }} />}
        </FormScrollView>}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>}
  </>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  list: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  content: { paddingBottom: 28 }, columns: { gap: 14 },
  filters: { gap: 14, paddingBottom: 20 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { color: c.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 }, muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  card: { width: '48%', flexGrow: 0, flexShrink: 1, gap: 5, marginBottom: 22 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14, overflow: 'hidden', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  name: { color: c.text, fontSize: 14, fontWeight: '500', lineHeight: 20 }, date: { color: c.muted, fontSize: 11, lineHeight: 16 },
  status: { color: c.accentGold, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 36, paddingHorizontal: 8 },
  modal: { flex: 1, backgroundColor: c.background }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, width: '100%', maxWidth: 700, alignSelf: 'center' },
  detail: { padding: 16, paddingBottom: 32, gap: 16, width: '100%', maxWidth: 700, alignSelf: 'center' },
  result: { width: '100%', aspectRatio: 3 / 4, backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
  garment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  garmentPhoto: { width: 52, height: 64, backgroundColor: c.stage, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }
});
