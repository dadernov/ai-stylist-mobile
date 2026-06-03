import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { ScreenTitle } from '../components/ScreenTitle';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { LookPreview } from '../components/LookPreview';
import { AppPressable } from '../components/AppPressable';
import { reanchorTryOnUri } from '../components/AiTryOnPreview';

type FavoritesScreenProps = {
  looks: GeneratedLook[];
  items: WardrobeItem[];
  onRemove: (id: string) => void;
};

export function FavoritesScreen({ looks, items, onRemove }: FavoritesScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));
  return (
    <View style={styles.container}>
      <ScreenTitle title={t('Избранные образы')} subtitle={t('Сохраняй лучшие варианты, чтобы быстро их находить.')} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
        {!looks.length ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('Пока нет избранных образов')}</Text>
            <Text style={styles.emptyText}>{t('Добавь лук из конструктора, и он появится здесь.')}</Text>
          </View>
        ) : null}

        {looks.map((look) => {
          const lookItems = look.itemIds.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
          const tryOnUri = reanchorTryOnUri(look.tryOnImageUri);
          return (
            <View key={look.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{look.title}</Text>
                <AppPressable style={styles.deleteButton} onPress={() => onRemove(look.id)}>
                  <Text style={styles.deleteText}>{t('Удалить')}</Text>
                </AppPressable>
              </View>
              <Text style={styles.cardMeta}>{look.weather}</Text>
              <Text style={styles.blockTitle}>{t('Образ из вещей')}</Text>
              <LookPreview items={lookItems} />
              <Text style={styles.blockTitle}>{t('Сгенерированный образ')}</Text>
              {tryOnUri ? (
                <AppPressable style={styles.generatedWrap} onPress={() => setPreviewUri(tryOnUri)}>
                  <Image source={{ uri: tryOnUri }} style={styles.generatedImage} resizeMode="contain" />
                </AppPressable>
              ) : (
                <View style={styles.generatedPlaceholder}>
                  <Text style={styles.generatedPlaceholderText}>{t('Сначала сгенерируй образ в «Конструкторе», затем добавь в избранное.')}</Text>
                </View>
              )}
              <View style={styles.beautyBlock}>
                <Text style={styles.beautyTitle}>{t('Макияж')}</Text>
                <Text style={styles.beautyText}>{t(look.makeup)}</Text>
                <Text style={styles.beautyTitle}>{t('Укладка')}</Text>
                <Text style={styles.beautyText}>{t(look.hair)}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal transparent animationType="fade" visible={Boolean(previewUri)} onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : null}
          <AppPressable style={styles.previewClose} onPress={() => setPreviewUri(null)}>
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
  listWrap: {
    gap: 10,
    paddingBottom: 20
  },
  emptyState: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 16
  },
  emptyTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4
  },
  emptyText: {
    color: c.muted,
    fontSize: 12
  },
  card: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 6
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  cardTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1
  },
  deleteButton: {
    backgroundColor: '#FBEAEA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  deleteText: {
    color: '#9B2C2C',
    fontSize: 12,
    fontWeight: '600'
  },
  cardMeta: {
    color: c.muted,
    fontSize: 12
  },
  blockTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4
  },
  generatedWrap: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  generatedImage: {
    width: '100%',
    height: 360,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface
  },
  generatedPlaceholder: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    paddingVertical: 20
  },
  generatedPlaceholderText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  beautyBlock: {
    marginTop: 6,
    gap: 4
  },
  beautyTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700'
  },
  beautyText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: 16
  },
  previewImage: {
    width: '100%',
    height: '86%'
  },
  previewClose: {
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: c.chip,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  previewCloseText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '700'
  }
});
