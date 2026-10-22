import { ArrowUpRight, Palette, Scissors, Shirt, Trash2 } from 'lucide-react-native';
import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppDialog } from '../components/AppDialog';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { AppPressable } from '../components/AppPressable';
import { reanchorTryOnUri } from '../components/AiTryOnPreview';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { FadeInView } from '../components/ui/FadeInView';
import { Glass, Pill } from '../components/studio/Glass';
import { GarmentImage } from '../components/studio/Garment';
import { layoutLook } from '../components/studio/lookLayout';
import { StudioSheet } from '../components/studio/StudioSheet';
import { font, INK_FAINT, studioTint } from '../components/studio/studio';

type FavoritesScreenProps = {
  beautyAdvice: boolean;
  looks: GeneratedLook[];
  items: WardrobeItem[];
  onRemove: (id: string) => void;
  onGoToBuilder?: () => void;
  onTryOn?: (itemIds: string[]) => void;
};

type Filter = 'all' | 'tried';

// Дата в нейтральном числовом формате (без локале-зависимых названий месяцев).
function formatDate(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Card heights from the mock-up, so the two columns step against each other.
const HEIGHTS = [[250, 210, 236], [210, 250, 224]];
const GAP = 12;
const CAPTION_ROOM = 62;
const RIGHT_OFFSET = 32;

const lookTitle = (look: GeneratedLook, t: (key: string) => string) => look.title.split(' + ').map(part => t(part)).join(' + ');

type CardProps = {
  look: GeneratedLook;
  height: number;
  width: number;
  index: number;
  itemsById: Record<string, WardrobeItem>;
  onOpen: (id: string) => void;
};

// Memoised like the wardrobe's item card: a card with a try-on picture should not redraw on unrelated updates.
const FavoriteCard = memo(function FavoriteCard({ look, height, width, index, itemsById, onOpen }: CardProps) {
  const t = useT();
  const { colors: c, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const lookItems = useMemo(() => look.itemIds.map(id => itemsById[id]).filter(Boolean) as WardrobeItem[], [look.itemIds, itemsById]);
  const tryOnUri = reanchorTryOnUri(look.tryOnImageUri);
  const placed = useMemo(() => (tryOnUri || !width ? [] : layoutLook(lookItems, width, height - CAPTION_ROOM)), [tryOnUri, lookItems, width, height]);
  const byId = new Map(lookItems.map(item => [item.id, item]));
  const tint = studioTint(lookItems.find(item => item.id === placed[0]?.id));
  const title = lookTitle(look, t);
  return (
    <FadeInView delay={Math.min(index, 6) * 70}>
      <AppPressable accessibilityRole="button" accessibilityLabel={title} onPress={() => onOpen(look.id)} style={[styles.card, { height }]}>
        {tryOnUri ? (
          <Image source={{ uri: tryOnUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <>
            <LinearGradient colors={isDark ? ['#2A2D32', '#1C1F23'] : ['#FFFFFF', tint || '#E4E4E1']} style={StyleSheet.absoluteFill} />
            {placed.length ? placed.map(piece => (
              <View key={piece.id} pointerEvents="none" style={{ position: 'absolute', left: piece.x, top: piece.y, width: piece.w, height: piece.h, transform: [{ rotate: piece.rotate }] }}>
                <GarmentImage item={byId.get(piece.id)} print printRadius={Math.min(16, piece.w * 0.14)} style={{ width: piece.w, height: piece.h }} />
              </View>
            )) : <View style={[styles.emptyPieces, { bottom: CAPTION_ROOM }]}><Shirt size={40} strokeWidth={1} color={INK_FAINT} /></View>}
          </>
        )}
        <Glass radius={18} style={styles.caption}>
          <View style={styles.captionText}>
            <Text style={[font('semibold'), styles.captionTitle]} numberOfLines={2}>{title}</Text>
            <Text style={[font('regular'), styles.captionEvent, { color: isDark ? '#D0D3D8' : '#4F555C' }]} numberOfLines={1}>{t(look.event)}</Text>
          </View>
        </Glass>
      </AppPressable>
    </FadeInView>
  );
});

export function FavoritesScreen({ looks, items, onRemove, onGoToBuilder, onTryOn, beautyAdvice }: FavoritesScreenProps) {
  const Alert = useAppDialog();
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const itemsById = useMemo(() => Object.fromEntries(items.map(item => [item.id, item])), [items]);

  const shown = useMemo(() => (filter === 'tried' ? looks.filter(look => reanchorTryOnUri(look.tryOnImageUri)) : looks), [filter, looks]);
  const columnWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP) / 2) : 0;
  const columns = [0, 1].map(col => shown.map((look, index) => ({ look, index })).filter(({ index }) => index % 2 === col));
  const current = looks.find(look => look.id === openId) || null;
  // The sheet keeps the look it showed while it slides out (also after the look was deleted or the list emptied).
  const lastOpen = useRef<GeneratedLook | null>(null);
  if (current) lastOpen.current = current;
  const open = current || lastOpen.current;

  const handleRemove = useCallback(
    (id: string) => {
      Alert.alert(t('Удалить лук?'), t('Действие нельзя отменить.'), [
        { text: t('Отмена'), style: 'cancel' },
        { text: t('Удалить'), style: 'destructive', onPress: () => { setOpenId(null); onRemove(id); } }
      ]);
    },
    [onRemove, t]
  );

  const header = (
    <ScreenHeader
      title={t('Избранное')}
      right={looks.length ? <Text style={[font('regular'), styles.count]}>{t('Образов: {count}', { count: shown.length })}</Text> : undefined}
    />
  );

  const openItems = open ? (open.itemIds.map(id => itemsById[id]).filter(Boolean) as WardrobeItem[]) : [];
  const openTryOn = open ? reanchorTryOnUri(open.tryOnImageUri) : undefined;
  const meta = open
    ? [t(open.event), t(open.style).toLocaleLowerCase(), open.weather, open.tryOnUpdatedAt ? formatDate(open.tryOnUpdatedAt) : ''].filter(Boolean)
    : [];

  return (
    <View style={styles.container}>
      {header}

      {!looks.length ? (
        <EmptyState
          emoji=""
          title={t('Пока нет избранных образов')}
          hint={t('Сохрани образ сердцем в «Идеях» или после примерки, и он будет здесь.')}
          actionLabel={onGoToBuilder ? t('Собрать образ') : undefined}
          onAction={onGoToBuilder}
        />
      ) : <>
      <View style={styles.filters}>
        {(['all', 'tried'] as Filter[]).map(value => (
          <AppPressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} hitSlop={8} onPress={() => setFilter(value)}>
            <Text style={[font(filter === value ? 'semibold' : 'regular'), styles.word, filter === value && { color: c.text }]}>{t(value === 'all' ? 'Все' : 'С примеркой')}</Text>
          </AppPressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {!shown.length ? (
          <EmptyState emoji="" title={t('Нет образов с примеркой')} hint={t('Примерь образ на себе, и он появится здесь.')} />
        ) : (
          <View style={styles.grid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
            {columns.map((column, col) => (
              <View key={col} style={[styles.column, col === 1 && { paddingTop: RIGHT_OFFSET }]}>
                {column.map(({ look, index }, k) => (
                  <FavoriteCard key={look.id} look={look} index={index} width={columnWidth} height={HEIGHTS[col][k % 3]} itemsById={itemsById} onOpen={setOpenId} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      </>}

      <StudioSheet visible={Boolean(current)} title={open ? lookTitle(open, t) : ''} onClose={() => setOpenId(null)}>
        {open ? (
          <>
            <Text style={[font('regular'), styles.meta]}>{meta.join(', ')}</Text>

            {openTryOn ? (
              <AppPressable accessibilityRole="button" accessibilityLabel={t('Примерка')} style={styles.picture} onPress={() => setPreviewUri(openTryOn)}>
                <Image source={{ uri: openTryOn }} style={styles.pictureImage} resizeMode="contain" />
              </AppPressable>
            ) : !onTryOn ? (
              <Text style={[font('regular'), styles.meta]}>{t('Сначала сгенерируй образ в «Конструкторе», затем добавь в избранное.')}</Text>
            ) : null}

            {openItems.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.pieces}>
                {openItems.map(item => (
                  <View key={item.id} style={styles.piece}>
                    <View style={styles.pieceStage}>
                      <GarmentImage item={item} print printRadius={14} style={styles.pieceImage} />
                    </View>
                    <Text style={[font('regular'), styles.pieceName]} numberOfLines={1}>{item.name}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {beautyAdvice && (open.makeup || open.hair) ? (
              <View style={styles.beauty}>
                {open.makeup ? (
                  <View style={styles.beautyRow}>
                    <Palette size={19} strokeWidth={1.6} color={c.muted} />
                    <View style={styles.beautyBody}>
                      <Text style={[font('semibold'), styles.beautyTitle]}>{t('Макияж')}</Text>
                      <Text style={[font('regular'), styles.beautyText]}>{t(open.makeup)}</Text>
                    </View>
                  </View>
                ) : null}
                {open.makeup && open.hair ? <View style={styles.hairline} /> : null}
                {open.hair ? (
                  <View style={styles.beautyRow}>
                    <Scissors size={19} strokeWidth={1.6} color={c.muted} />
                    <View style={styles.beautyBody}>
                      <Text style={[font('semibold'), styles.beautyTitle]}>{t('Укладка')}</Text>
                      <Text style={[font('regular'), styles.beautyText]}>{t(open.hair)}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              {onTryOn ? (
                <Pill variant="primary" icon={ArrowUpRight} title={t(openTryOn ? 'Примерить снова' : 'Примерить на себе')}
                  onPress={() => { setOpenId(null); onTryOn(open.itemIds.filter(id => itemsById[id])); }} />
              ) : null}
              <Pill icon={Trash2} title={t('Удалить')} iconColor={c.danger} onPress={() => handleRemove(open.id)} />
            </View>
          </>
        ) : null}
      </StudioSheet>

      <Modal transparent animationType="fade" visible={Boolean(previewUri)} onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Pill title={t('Закрыть')} style={styles.previewClose} onPress={() => setPreviewUri(null)} />
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  count: { fontSize: 13, color: c.muted },
  filters: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  word: { fontSize: 13, lineHeight: 18, color: c.muted },
  scroll: { paddingBottom: 32 },
  grid: { flexDirection: 'row', gap: GAP, alignItems: 'flex-start' },
  column: { flex: 1, gap: GAP },
  card: {
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: c.surface,
    shadowColor: '#14191E',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 }
  },
  emptyPieces: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  caption: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  captionText: { paddingHorizontal: 12, paddingVertical: 8 },
  captionTitle: { fontSize: 13, lineHeight: 17, color: c.text },
  captionEvent: { fontSize: 11, lineHeight: 15 },
  meta: { fontSize: 13, lineHeight: 19, color: c.muted },
  picture: { borderRadius: 24, overflow: 'hidden', backgroundColor: c.surface },
  pictureImage: { width: '100%', height: 360 },
  bleed: { marginHorizontal: -20 },
  pieces: { gap: 12, paddingHorizontal: 20 },
  piece: { width: 96, gap: 6 },
  pieceStage: { width: 96, height: 120, borderRadius: 18, backgroundColor: c.stage, overflow: 'hidden' },
  pieceImage: { width: 96, height: 120 },
  pieceName: { fontSize: 11, lineHeight: 15, color: c.muted },
  beauty: { gap: 12 },
  beautyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  beautyBody: { flex: 1, gap: 2 },
  beautyTitle: { fontSize: 14, lineHeight: 20, color: c.text },
  beautyText: { fontSize: 13, lineHeight: 19, color: c.muted },
  hairline: { height: StyleSheet.hairlineWidth * 2, backgroundColor: c.border, marginLeft: 33 },
  actions: { gap: 10, marginTop: 4 },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 16 },
  previewImage: { width: '100%', height: '86%' },
  previewClose: { alignSelf: 'center', marginTop: 12 }
});
