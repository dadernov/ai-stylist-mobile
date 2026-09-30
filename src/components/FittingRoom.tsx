import { usePhotoPicker } from './usePhotoPicker';
import { useMemo, useState } from 'react';
import { Image, Keyboard, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowUpRight, Check, Pencil, Save, Search, UserRound, X } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { SavedLook, TryOnHistoryItem } from '../types/looks';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { AiTryOnPreview } from './AiTryOnPreview';
import { PrimaryButton } from './ui/PrimaryButton';
import { GarmentTile } from './GarmentTile';
import { IconButton } from './ui/IconButton';
import { Chip } from './Chip';
import { FormScrollView } from './ui/FormScrollView';
import { RecentTryOns } from './RecentTryOns';

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
};

const supportedSections = ['Верх', 'Низ', 'Обувь', 'Верхняя одежда'];
const onePiece = new Set(['Платье', 'Сарафан', 'Комбинезон']);

// How many garments of a section one look can layer.
// Two tops under one outer layer: more upper layers an editor does not keep.
const LAYERS: Record<string, number> = { 'Верх': 2 };

export function FittingRoom({ items, modelUri, onProfile, onModelChange, onWardrobe, onSave, onOpenHistory, initialItemId, initialItemIds }: Props) {
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
  const visibleItems = items.filter(item => (section === 'Все' || item.section === section)
    && `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  // The session belongs to these exact photos, including the profile photo.
  const sessionKey = JSON.stringify([modelUri, selection.map(item => [item.id, item.imageUri, item.section])]);

  const toggle = (item: WardrobeItem) => {
    setSelectedIds(previous => {
      if (previous.includes(item.id)) return previous.filter(id => id !== item.id);
      // Two tops can be chosen; the server layers them in their natural order.
      // One more of a full section replaces the oldest of it.
      const layers = LAYERS[item.section] || 1;
      const sameSection = previous.filter(id => items.find(candidate => candidate.id === id)?.section === item.section);
      const dropped = new Set(sameSection.slice(0, Math.max(0, sameSection.length - layers + 1)));
      return [...previous.filter(id => {
        const current = items.find(candidate => candidate.id === id);
        if (!current || dropped.has(id)) return false;
        if (onePiece.has(item.category) && ['Верх', 'Низ'].includes(current.section) && current.id !== item.id) return false;
        if (onePiece.has(current.category) && ['Верх', 'Низ'].includes(item.section)) return false;
        return true;
      }), item.id];
    });
  };

  return (
    <View style={styles.content}>
      <View style={styles.profileRow}>
        {modelUri ? <Image source={{ uri: modelUri }} style={styles.person} resizeMode="contain" accessibilityLabel={t('Фото для примерки')} />
          : <View style={styles.personEmpty}><UserRound size={26} strokeWidth={1.2} color={colors.muted} /></View>}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.heading}>{t('Моё фото')}</Text>
          <Text style={styles.muted}>{t(modelUri ? 'Из профиля' : 'Фото ещё не добавлено')}</Text>
        </View>
        <IconButton icon={modelUri ? Pencil : ArrowUpRight} label={t(modelUri ? 'Заменить фото' : 'Добавить фото')} onPress={() => { void pickModel(); }} />
      </View>
      <View style={styles.row}>
        <Text style={styles.heading}>{t('Вещи для примерки')}</Text>
        <Text style={styles.muted}>{t('Выбрано: {count}', { count: selection.length })}</Text>
      </View>
      <View style={styles.searchBar}>
        <Search size={17} strokeWidth={1.5} color={colors.muted} />
        <TextInput accessibilityLabel={t('Найти вещь')} placeholder={t('Найти вещь')} placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} style={styles.searchInput} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
        {search.length > 0 && <AppPressable accessibilityLabel={t('Очистить поиск')} onPress={() => setSearch('')} style={{ padding: 8 }}><X size={16} color={colors.muted} /></AppPressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {['Все', ...Array.from(new Set(items.map(item => item.section)))].map(value => (
          <Chip key={value} label={t(value)} active={section === value} onPress={() => setSection(value)} />
        ))}
      </ScrollView>
      {selection.length > 0 && (
        <View style={styles.selected}>
          {selection.map(item => (
            <AppPressable key={item.id} onPress={() => toggle(item)} accessibilityRole="button" accessibilityLabel={t('Убрать {name}', { name: item.name })} style={styles.selectedItem}>
              {item.imageUri && <Image source={{ uri: item.imageUri }} style={styles.selectedPhoto} resizeMode="contain" />}
              <Text style={styles.selectedName} numberOfLines={1}>{item.name}</Text>
              <X size={14} color={colors.muted} />
            </AppPressable>
          ))}
          <AppPressable onPress={() => setSelectedIds([])}><Text style={styles.link}>{t('Очистить')}</Text></AppPressable>
        </View>
      )}
      {selection.filter(item => item.section === 'Верх').length > 1 && (
        <Text style={styles.layerHint}>{t('Два слоя верха надеваются в естественном порядке: например, футболка окажется под лонгсливом.')}</Text>
      )}
      {selection.length > 0 && <PrimaryButton title={t('К примерке')} icon={ArrowUpRight} onPress={() => setPreviewOpen(true)} />}
      <View style={styles.grid}>
        {visibleItems.map(item => {
          const supported = supportedSections.includes(item.section);
          const available = supported && Boolean(item.imageUri);
          const selected = selection.some(candidate => candidate.id === item.id);
          return (
            <View key={item.id} style={[styles.item, width >= 720 && { width: '32%' }]}>
              <GarmentTile item={item} selected={selected} disabled={!available} onPress={() => toggle(item)}
                status={!supported ? t('Примерка недоступна') : !item.imageUri ? t('Нет фото') : undefined} />
            </View>
          );
        })}
      </View>
      {!visibleItems.length && <Text style={styles.muted}>{t(items.length ? 'Ничего не найдено' : 'Гардероб пока пуст')}</Text>}
      {!items.length && <PrimaryButton title={t('Добавить вещи')} onPress={onWardrobe} variant="ghost" />}
      <RecentTryOns onSave={onSave} onOpenHistory={onOpenHistory} />
      {selection.length > 0 && <FittingSession key={sessionKey} items={selection} modelUri={modelUri} onSave={onSave} visible={previewOpen} onClose={() => setPreviewOpen(false)} />}
      {cropModal}
    </View>
  );
}

function FittingSession({ items, modelUri, onSave, visible, onClose }: Pick<Props, 'items' | 'modelUri' | 'onSave'> & { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [name, setName] = useState('');
  const [history, setHistory] = useState<TryOnHistoryItem[]>([]);
  const [selected, setSelected] = useState<TryOnHistoryItem>();
  const [saved, setSaved] = useState(false);
  const latest = selected || history[0];
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{t('Примерка')}</Text>
            <Text style={styles.muted} numberOfLines={1}>{items.map(item => item.name).join(' + ')}</Text>
          </View>
          <IconButton icon={X} label={t('Закрыть примерку')} onPress={onClose} />
        </View>
        <FormScrollView contentContainerStyle={styles.content}>
    <AiTryOnPreview modelUri={modelUri} items={items} history={history} showSourcePhoto resultUri={latest?.imageUri}
      updatedAt={latest?.updatedAt} warningMessage={latest?.warning} qualityMode={latest?.qualityMode} onGenerated={payload => {
      const entry = { ...payload, id: String(payload.updatedAt) };
      setHistory(previous => [entry, ...previous.filter(item => item.imageUri !== entry.imageUri)].slice(0, 8));
      setSelected(entry);
      setSaved(false);
    }} onSelectHistory={entry => {
      setSelected(entry); setSaved(false);
      setHistory(previous => [entry, ...previous.filter(item => item.imageUri !== entry.imageUri)]
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
    }} />
    <TextInput style={styles.search} accessibilityLabel={t('Название образа')} placeholder={items.length === 1 ? items[0].name : t('Название образа')} value={name} onChangeText={value => { setName(value); setSaved(false); }} multiline scrollEnabled={false} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={Keyboard.dismiss} />
    <PrimaryButton title={t(saved ? 'Сохранено' : 'Сохранить образ')} icon={saved ? Check : Save} disabled={saved} variant="ghost" onPress={() => {
      onSave({
        id: `fitting-${Date.now()}`, name: name.trim() || items.map(item => item.name).join(' + '),
        itemIds: items.map(item => item.id), createdAt: Date.now(),
        tryOnImageUri: latest?.imageUri, tryOnWarning: latest?.warning, tryOnUpdatedAt: latest?.updatedAt,
        tuckMode: latest?.tuckMode, tryOnQualityMode: latest?.qualityMode, tryOnHistory: history
      });
      setSaved(true);
    }} />
        </FormScrollView>
      </View>
    </View>
  </Modal>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { gap: 16, paddingBottom: 20 },
  backdrop: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { height: '92%', width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  heading: { color: c.text, fontSize: 16, fontWeight: '600' },
  text: { color: c.text, fontSize: 14 },
  muted: { color: c.muted, fontSize: 12 },
  link: { color: c.accentGold, fontSize: 14, paddingVertical: 8 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: c.border },
  person: { width: 68, height: 88, backgroundColor: c.surface, borderRadius: 6 },
  personEmpty: { width: 68, height: 88, backgroundColor: c.surface, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  search: { color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, fontSize: 14 },
  searchBar: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.surface, borderRadius: 8, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 14, height: '100%' },
  filters: { gap: 0 },
  filter: { padding: 10, borderRadius: 6 },
  layerHint: { color: c.muted, fontSize: 13, lineHeight: 18 },
  selected: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  selectedItem: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 6 },
  selectedPhoto: { width: 32, height: 38, backgroundColor: c.surface, borderRadius: 3 },
  selectedName: { color: c.text, fontSize: 12, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catalog: { maxHeight: 360 },
  item: { width: '48%' },
  activeItem: { borderColor: c.accentGold, backgroundColor: c.accentGoldSoft },
  unavailable: { opacity: 0.55 },
  garment: { width: '100%', aspectRatio: 1, backgroundColor: c.surface, borderRadius: 4 },
  itemName: { color: c.text, fontSize: 14, fontWeight: '600', minHeight: 36 }
});
