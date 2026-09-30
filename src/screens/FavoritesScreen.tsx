import { ArrowUpRight } from 'lucide-react-native';
import { FlatList, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { useAppDialog } from '../components/AppDialog';
import { memo, useCallback, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII, SERIF, SHADOWS, SPACING, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { LookPreview } from '../components/LookPreview';
import { AppPressable } from '../components/AppPressable';
import { reanchorTryOnUri } from '../components/AiTryOnPreview';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SectionLabel } from '../components/ui/SectionLabel';
import { EmptyState } from '../components/ui/EmptyState';
import { FadeInView } from '../components/ui/FadeInView';

type FavoritesScreenProps = {
  beautyAdvice: boolean;
  looks: GeneratedLook[];
  items: WardrobeItem[];
  onRemove: (id: string) => void;
  onGoToBuilder?: () => void;
  onTryOn?: (itemIds: string[]) => void;
};

// Дата в нейтральном числовом формате (без локале-зависимых названий месяцев).
function formatDate(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

type FavoriteLookCardProps = {
  beautyAdvice: boolean;
  look: GeneratedLook;
  index: number;
  itemsById: Record<string, WardrobeItem>;
  onRemove: (id: string) => void;
  onPreview: (uri: string) => void;
  onTryOn?: (itemIds: string[]) => void;
};

// Мемоизировано по той же причине, что и карточка вещи в гардеробе: без этого
// каждая карточка (с примеркой и превью-картинкой) перерисовывалась при любом
// несвязанном обновлении экрана.
const FavoriteLookCard = memo(function FavoriteLookCard({ look, index, itemsById, onRemove, onPreview, onTryOn, beautyAdvice }: FavoriteLookCardProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const lookItems = look.itemIds.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
  const tryOnUri = reanchorTryOnUri(look.tryOnImageUri);
  const metaParts = [t(look.style), t(look.event), look.weather].filter(Boolean);
  const meta = look.tryOnUpdatedAt
    ? [...metaParts, formatDate(look.tryOnUpdatedAt)].join(' · ')
    : metaParts.join(' · ');
  return (
    <FadeInView delay={Math.min(index, 6) * 60}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{look.title.split(' + ').map(part => t(part)).join(' + ')}</Text>
          <AppPressable style={styles.deleteButton} haptics onPress={() => onRemove(look.id)}>
            <Text style={styles.deleteText}>{t('Удалить')}</Text>
          </AppPressable>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.cardMeta}>{meta}</Text>
          {tryOnUri ? (
            <View style={styles.tryOnBadge}>
              <Text style={styles.tryOnBadgeText}>✨ {t('Примерка')}</Text>
            </View>
          ) : null}
        </View>

        <SectionLabel>{t('Образ из вещей')}</SectionLabel>
        <LookPreview items={lookItems} />

        {/* The label belongs to a picture; without one only the button remains. */}
        {tryOnUri || !onTryOn ? <SectionLabel>{t('Сгенерированный образ')}</SectionLabel> : null}
        {tryOnUri ? (
          <AppPressable style={styles.generatedWrap} onPress={() => onPreview(tryOnUri)}>
            <Image source={{ uri: tryOnUri }} style={styles.generatedImage} resizeMode="contain" />
          </AppPressable>
        ) : (
          onTryOn ? null : <View style={styles.generatedPlaceholder}>
            <Text style={styles.generatedPlaceholderText}>{t('Сначала сгенерируй образ в «Конструкторе», затем добавь в избранное.')}</Text>
          </View>
        )}
        {onTryOn ? <PrimaryButton title={t(tryOnUri ? 'Примерить снова' : 'Примерить на себе')} icon={ArrowUpRight} variant={tryOnUri ? 'ghost' : 'gold'}
          onPress={() => onTryOn(look.itemIds.filter(id => itemsById[id]))} /> : null}

        {beautyAdvice && (look.makeup || look.hair) ? (
          <View style={styles.beautyBlock}>
            {look.makeup ? (
              <View style={styles.beautyRow}>
                <View style={styles.beautyIcon}>
                  <Text style={styles.beautyEmoji}>💄</Text>
                </View>
                <View style={styles.beautyBody}>
                  <Text style={styles.beautyTitle}>{t('Макияж')}</Text>
                  <Text style={styles.beautyText}>{t(look.makeup)}</Text>
                </View>
              </View>
            ) : null}
            {look.makeup && look.hair ? <View style={styles.beautyDivider} /> : null}
            {look.hair ? (
              <View style={styles.beautyRow}>
                <View style={styles.beautyIcon}>
                  <Text style={styles.beautyEmoji}>💇‍♀️</Text>
                </View>
                <View style={styles.beautyBody}>
                  <Text style={styles.beautyTitle}>{t('Укладка')}</Text>
                  <Text style={styles.beautyText}>{t(look.hair)}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </FadeInView>
  );
});

export function FavoritesScreen({ looks, items, onRemove, onGoToBuilder, onTryOn, beautyAdvice }: FavoritesScreenProps) {
  const Alert = useAppDialog();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));

  const handleRemove = useCallback(
    (id: string) => {
      Alert.alert(t('Удалить лук?'), t('Действие нельзя отменить.'), [
        { text: t('Отмена'), style: 'cancel' },
        { text: t('Удалить'), style: 'destructive', onPress: () => onRemove(id) }
      ]);
    },
    [onRemove, t]
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.heroTo, colors.heroFrom] as const} style={styles.heroWash} pointerEvents="none" />
      <ScreenHeader
        eyebrow={t('Любимое')}
        title={t('Избранные образы')}
        subtitle={t('Сохраняй лучшие варианты, чтобы быстро их находить.')}
      />

      <FlatList
        data={looks}
        keyExtractor={(look) => look.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listWrap}
        initialNumToRender={4}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <FavoriteLookCard look={item} index={index} itemsById={itemsById} onRemove={handleRemove} onPreview={setPreviewUri} onTryOn={onTryOn} beautyAdvice={beautyAdvice} />
        )}
        ListEmptyComponent={
          <EmptyState
            emoji="🤍"
            title={t('Пока нет избранных образов')}
            hint={t('Сохраняй удачные образы из конструктора — они появятся здесь.')}
            actionLabel={onGoToBuilder ? t('Собрать образ') : undefined}
            onAction={onGoToBuilder}
          />
        }
      />

      <Modal transparent animationType="fade" visible={Boolean(previewUri)} onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : null}
          <AppPressable style={styles.previewClose} haptics onPress={() => setPreviewUri(null)}>
            <Text style={styles.previewCloseText}>{t('Закрыть')}</Text>
          </AppPressable>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
  // Кремовый wash шапки: вытягиваем за паддинги контента App.tsx (16/12),
  // сверху heroTo плавно уходит в heroFrom (= фон экрана) — без видимого шва.
  heroWash: {
    position: 'absolute',
    top: -12,
    left: -16,
    right: -16,
    height: 170
  },
  listWrap: {
    gap: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xxl
  },
  card: {
    backgroundColor: c.card,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: SPACING.lg,
    gap: SPACING.sm,
    ...SHADOWS.card
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm + 2
  },
  cardTitle: {
    color: c.text,
    fontFamily: SERIF,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.3,
    flex: 1
  },
  deleteButton: {
    backgroundColor: c.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6
  },
  deleteText: {
    color: c.danger,
    fontSize: 12,
    fontWeight: '700'
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.xs
  },
  cardMeta: {
    ...TYPE.caption,
    color: c.muted,
    flex: 1
  },
  tryOnBadge: {
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: 999,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 4
  },
  tryOnBadgeText: {
    color: c.accentGold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4
  },
  generatedWrap: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    overflow: 'hidden'
  },
  generatedImage: {
    width: '100%',
    height: 360,
    backgroundColor: c.surface
  },
  generatedPlaceholder: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl
  },
  generatedPlaceholderText: {
    ...TYPE.caption,
    color: c.muted
  },
  beautyBlock: {
    marginTop: SPACING.xs,
    backgroundColor: c.surface,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: SPACING.md,
    gap: SPACING.sm + 2
  },
  beautyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md
  },
  beautyIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    alignItems: 'center',
    justifyContent: 'center'
  },
  beautyEmoji: {
    fontSize: 16
  },
  beautyBody: {
    flex: 1,
    gap: 2
  },
  beautyTitle: {
    color: c.text,
    fontSize: 12.5,
    fontWeight: '700'
  },
  beautyText: {
    ...TYPE.caption,
    color: c.muted
  },
  beautyDivider: {
    height: 1,
    backgroundColor: c.border,
    marginLeft: 34 + SPACING.md
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: SPACING.lg
  },
  previewImage: {
    width: '100%',
    height: '86%'
  },
  previewClose: {
    alignSelf: 'center',
    marginTop: SPACING.md,
    backgroundColor: c.chip,
    borderRadius: 999,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm + 2
  },
  previewCloseText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '700'
  }
});
