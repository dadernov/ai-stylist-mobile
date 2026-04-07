import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { ScreenTitle } from '../components/ScreenTitle';
import { COLORS } from '../constants/theme';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { LookPreview } from '../components/LookPreview';
import { AppPressable } from '../components/AppPressable';
import { TryOnPreview } from '../components/TryOnPreview';
import { analyzeTryOnAvatar, analyzeTryOnModel, TryOnModelResult } from '../services/ai';
import { AI_BASE_URL } from '../constants/ai';

type FavoritesScreenProps = {
  looks: GeneratedLook[];
  items: WardrobeItem[];
  modelUri?: string;
  onRemove: (id: string) => void;
};

export function FavoritesScreen({ looks, items, modelUri, onRemove }: FavoritesScreenProps) {
  const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));
  const [tryOnModel, setTryOnModel] = useState<TryOnModelResult | null>(null);
  const [isTryOnLoading, setTryOnLoading] = useState(false);
  const [tryOnError, setTryOnError] = useState<string | null>(null);
  const [tryOnNonce, setTryOnNonce] = useState(0);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (!modelUri) {
        setTryOnModel(null);
        setTryOnError(null);
        return;
      }
      setTryOnLoading(true);
      setTryOnError(null);
      try {
        let analyzed: TryOnModelResult;
        try {
          analyzed = await analyzeTryOnAvatar(modelUri);
        } catch (_avatarError) {
          analyzed = await analyzeTryOnModel(modelUri);
        }
        if (!disposed) setTryOnModel(analyzed);
      } catch (error: any) {
        if (!disposed) {
          setTryOnModel(null);
          const details =
            error?.message && typeof error.message === 'string'
              ? `Детали: ${error.message}`
              : 'Проверь подключение к AI-серверу.';
          setTryOnError(`Не удалось получить аватарную примерку. ${details}`);
        }
      } finally {
        if (!disposed) setTryOnLoading(false);
      }
    };

    run();
    return () => {
      disposed = true;
    };
  }, [modelUri, tryOnNonce]);
  return (
    <View style={styles.container}>
      <ScreenTitle title="Избранные образы" subtitle="Сохраняй лучшие варианты, чтобы быстро их находить." />
      {__DEV__ ? <Text style={styles.debugText}>AI: {AI_BASE_URL}</Text> : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
        {!looks.length ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Пока нет избранных образов</Text>
            <Text style={styles.emptyText}>Добавь лук из конструктора, и он появится здесь.</Text>
          </View>
        ) : null}

        {looks.map((look) => {
          const lookItems = look.itemIds.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
          return (
            <View key={look.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{look.title}</Text>
                <AppPressable style={styles.deleteButton} onPress={() => onRemove(look.id)}>
                  <Text style={styles.deleteText}>Удалить</Text>
                </AppPressable>
              </View>
              <Text style={styles.cardMeta}>{look.weather}</Text>
              <Text style={styles.blockTitle}>Образ из вещей</Text>
              <LookPreview items={lookItems} />
              <Text style={styles.blockTitle}>Образ на тебе</Text>
              {tryOnError ? (
                <View style={styles.tryOnErrorBox}>
                  <Text style={styles.tryOnErrorText}>{tryOnError}</Text>
                  <AppPressable style={styles.tryOnRetryButton} onPress={() => setTryOnNonce((v) => v + 1)}>
                    <Text style={styles.tryOnRetryText}>Повторить</Text>
                  </AppPressable>
                </View>
              ) : null}
              <TryOnPreview
                modelUri={tryOnModel?.avatarModelBase64 || tryOnModel?.neutralModelBase64}
                modelLayout={tryOnModel}
                isModelLoading={isTryOnLoading}
                items={lookItems}
              />
              <View style={styles.beautyBlock}>
                <Text style={styles.beautyTitle}>Макияж</Text>
                <Text style={styles.beautyText}>{look.makeup}</Text>
                <Text style={styles.beautyTitle}>Укладка</Text>
                <Text style={styles.beautyText}>{look.hair}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  listWrap: {
    gap: 10,
    paddingBottom: 20
  },
  debugText: {
    color: COLORS.muted,
    fontSize: 10,
    marginBottom: 6
  },
  emptyState: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 12
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    color: COLORS.text,
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
    color: COLORS.muted,
    fontSize: 12
  },
  blockTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4
  },
  tryOnErrorBox: {
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: '#FBEFEA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9D3C8',
    padding: 10,
    gap: 8
  },
  tryOnErrorText: {
    color: '#7B3A2A',
    fontSize: 12,
    lineHeight: 16
  },
  tryOnRetryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#EBD8CD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  tryOnRetryText: {
    color: '#6B3122',
    fontSize: 12,
    fontWeight: '600'
  },
  beautyBlock: {
    marginTop: 6,
    gap: 4
  },
  beautyTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700'
  },
  beautyText: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  }
});
