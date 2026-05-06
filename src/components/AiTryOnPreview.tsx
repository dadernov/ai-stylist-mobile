import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { WardrobeItem } from '../data/mock';
import { COLORS } from '../constants/theme';
import { AppPressable } from './AppPressable';
import { analyzeTryOnGenerateLook, TryOnQualityMode, TuckMode } from '../services/ai';
import { TryOnHistoryItem } from '../types/looks';

type AiTryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  resultUri?: string;
  warningMessage?: string;
  tuckMode?: TuckMode;
  qualityMode?: TryOnQualityMode;
  history?: TryOnHistoryItem[];
  onGenerated?: (payload: {
    imageUri: string;
    warning?: string;
    updatedAt: number;
    tuckMode: TuckMode;
    qualityMode: TryOnQualityMode;
  }) => void;
};
type VariantMode = 'tucked' | 'untucked';

const pickTopGarment = (items: WardrobeItem[]) =>
  items.find((item) => item.section === 'Верх' && item.imageUri) ||
  items.find((item) => item.section === 'Верхняя одежда' && item.imageUri);

const pickBottomGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Низ' && item.imageUri);
const pickShoesGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Обувь' && item.imageUri);

const shortDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function AiTryOnPreview({
  modelUri,
  items,
  resultUri: controlledResultUri,
  warningMessage,
  tuckMode: controlledTuckMode = 'auto',
  qualityMode: controlledQualityMode = 'quality',
  history = [],
  onGenerated
}: AiTryOnPreviewProps) {
  const [isLoading, setLoading] = useState(false);
  const [resultUri, setResultUri] = useState<string | null>(controlledResultUri || null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(warningMessage || null);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [selectedTuckMode, setSelectedTuckMode] = useState<TuckMode>(controlledTuckMode);
  const [selectedQualityMode, setSelectedQualityMode] = useState<TryOnQualityMode>(controlledQualityMode);
  const [isComparing, setComparing] = useState(false);
  const [compareVariants, setCompareVariants] = useState<Partial<Record<VariantMode, string>> | null>(null);
  const [compareWarnings, setCompareWarnings] = useState<Partial<Record<VariantMode, string>> | null>(null);

  const topGarment = useMemo(() => pickTopGarment(items), [items]);
  const bottomGarment = useMemo(() => pickBottomGarment(items), [items]);
  const shoesGarment = useMemo(() => pickShoesGarment(items), [items]);
  const canGenerate = Boolean(modelUri && (topGarment?.imageUri || bottomGarment?.imageUri || shoesGarment?.imageUri));
  const canCompare = Boolean(modelUri && topGarment?.imageUri && bottomGarment?.imageUri);
  const isBusy = isLoading || isComparing;
  const missingSections = [
    !topGarment?.imageUri ? 'верх' : null,
    !bottomGarment?.imageUri ? 'низ' : null,
    !shoesGarment?.imageUri ? 'обувь' : null
  ].filter(Boolean) as string[];
  const readinessWarnings = [
    !modelUri ? 'Добавь фото в полный рост в профиле.' : null,
    !topGarment?.imageUri && !bottomGarment?.imageUri ? 'Нужна хотя бы вещь с фото: верх или низ.' : null,
    missingSections.length ? `Не хватает фото для: ${missingSections.join(', ')}.` : null,
    modelUri && missingSections.length === 0 ? 'Фото готовы. Для финального результата лучше режим «Качество».' : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    setResultUri(controlledResultUri || null);
  }, [controlledResultUri]);

  useEffect(() => {
    setWarning(warningMessage || null);
  }, [warningMessage]);

  useEffect(() => {
    setSelectedTuckMode(controlledTuckMode);
  }, [controlledTuckMode]);

  useEffect(() => {
    setSelectedQualityMode(controlledQualityMode);
  }, [controlledQualityMode]);

  const runGenerate = async (mode: TuckMode, compareMode = false) => {
    const generated = await analyzeTryOnGenerateLook(
      modelUri!,
      topGarment?.imageUri,
      bottomGarment?.imageUri,
      shoesGarment?.imageUri,
      mode,
      compareMode,
      selectedQualityMode
    );
    if (!generated.outputUrl) {
      throw new Error(generated.error || 'FASHN не вернул итоговую картинку');
    }
    return { imageUri: generated.outputUrl, warning: generated.warning || undefined };
  };

  const run = async () => {
    if (!modelUri) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const generated = await runGenerate(selectedTuckMode);
      const updatedAt = Date.now();
      setResultUri(generated.imageUri);
      setWarning(generated.warning || null);
      setCompareVariants(null);
      setCompareWarnings(null);
      onGenerated?.({
        imageUri: generated.imageUri,
        warning: generated.warning,
        updatedAt,
        tuckMode: selectedTuckMode,
        qualityMode: selectedQualityMode
      });
    } catch (e: any) {
      setError(e?.message || 'Не удалось сгенерировать примерку');
    } finally {
      setLoading(false);
    }
  };

  const runCompare = async () => {
    if (!canCompare) return;
    setComparing(true);
    setError(null);
    setWarning(null);
    try {
      const variants: Partial<Record<VariantMode, string>> = {};
      const warnings: Partial<Record<VariantMode, string>> = {};
      const errors: string[] = [];
      const compareModes: VariantMode[] = ['untucked', 'tucked'];
      const generationResults = await Promise.allSettled(
        compareModes.map(async (mode) => ({ mode, generated: await runGenerate(mode, true) }))
      );
      generationResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { mode, generated } = result.value;
          variants[mode] = generated.imageUri;
          if (generated.warning) warnings[mode] = generated.warning;
          return;
        }
        const mode = compareModes[index];
        const modeLabel = mode === 'tucked' ? 'Заправленный' : 'Расправленный';
        const reason = (result as PromiseRejectedResult).reason;
        errors.push(`${modeLabel}: ${reason?.message || 'ошибка'}`);
      });

      if (!variants.tucked && !variants.untucked) {
        throw new Error(errors.join(' | ') || 'Не удалось собрать варианты');
      }

      setCompareVariants(variants);
      setCompareWarnings(warnings);
      if (errors.length) {
        setWarning(`Частично готово: ${errors.join(' · ')}`);
      } else {
        setWarning('Сравни варианты и выбери лучший.');
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось сгенерировать варианты');
    } finally {
      setComparing(false);
    }
  };

  const pickVariant = (mode: VariantMode) => {
    const imageUri = compareVariants?.[mode];
    if (!imageUri) return;
    const warningByMode = compareWarnings?.[mode];
    const updatedAt = Date.now();
    setResultUri(imageUri);
    setSelectedTuckMode(mode);
    setWarning(warningByMode || null);
    setCompareVariants(null);
    setCompareWarnings(null);
    onGenerated?.({ imageUri, warning: warningByMode, updatedAt, tuckMode: mode, qualityMode: selectedQualityMode });
  };

  return (
    <View style={styles.wrap}>
      {resultUri ? (
        <AppPressable style={styles.imageWrap} onPress={() => { setPreviewUri(resultUri); setPreviewOpen(true); }}>
          <Image source={{ uri: resultUri }} style={styles.image} resizeMode="contain" />
        </AppPressable>
      ) : null}
      {!resultUri ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>ИИ примерка пока не сгенерирована</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {warning ? <Text style={styles.hint}>{warning}</Text> : null}
      <View style={styles.qualityCard}>
        <Text style={styles.qualityTitle}>Проверка перед генерацией</Text>
        {readinessWarnings.map((item) => (
          <Text key={item} style={styles.qualityText}>• {item}</Text>
        ))}
      </View>
      <View style={styles.tuckControls}>
        <Text style={styles.tuckLabel}>Режим</Text>
        <View style={styles.tuckButtons}>
          <AppPressable
            style={[styles.tuckButton, selectedQualityMode === 'fast' && styles.tuckButtonActive]}
            onPress={() => setSelectedQualityMode('fast')}
            disabled={isBusy}
          >
            <Text style={[styles.tuckButtonText, selectedQualityMode === 'fast' && styles.tuckButtonTextActive]}>
              Быстро
            </Text>
          </AppPressable>
          <AppPressable
            style={[styles.tuckButton, selectedQualityMode === 'quality' && styles.tuckButtonActive]}
            onPress={() => setSelectedQualityMode('quality')}
            disabled={isBusy}
          >
            <Text style={[styles.tuckButtonText, selectedQualityMode === 'quality' && styles.tuckButtonTextActive]}>
              Качество
            </Text>
          </AppPressable>
        </View>
      </View>
      <View style={styles.tuckControls}>
        <Text style={styles.tuckLabel}>Посадка верха</Text>
        <View style={styles.tuckButtons}>
          <AppPressable
            style={[styles.tuckButton, selectedTuckMode === 'untucked' && styles.tuckButtonActive]}
            onPress={() => setSelectedTuckMode('untucked')}
            disabled={isBusy}
          >
            <Text style={[styles.tuckButtonText, selectedTuckMode === 'untucked' && styles.tuckButtonTextActive]}>
              Расправленный
            </Text>
          </AppPressable>
          <AppPressable
            style={[styles.tuckButton, selectedTuckMode === 'tucked' && styles.tuckButtonActive]}
            onPress={() => setSelectedTuckMode('tucked')}
            disabled={isBusy}
          >
            <Text style={[styles.tuckButtonText, selectedTuckMode === 'tucked' && styles.tuckButtonTextActive]}>
              Заправленный
            </Text>
          </AppPressable>
          <AppPressable
            style={[styles.tuckButton, selectedTuckMode === 'auto' && styles.tuckButtonActive]}
            onPress={() => setSelectedTuckMode('auto')}
            disabled={isBusy}
          >
            <Text style={[styles.tuckButtonText, selectedTuckMode === 'auto' && styles.tuckButtonTextActive]}>
              Авто
            </Text>
          </AppPressable>
        </View>
      </View>
      <AppPressable
        style={[styles.compareButton, (!canCompare || isBusy) && styles.buttonDisabled]}
        onPress={runCompare}
        disabled={!canCompare || isBusy}
      >
        <Text style={styles.compareButtonText}>
          {isComparing ? 'Генерируем 2 варианта…' : 'Сгенерировать 2 варианта'}
        </Text>
      </AppPressable>
      {!canCompare ? <Text style={styles.hint}>Для сравнения нужны фото и верха, и низа.</Text> : null}
      {compareVariants?.untucked || compareVariants?.tucked ? (
        <View style={styles.compareWrap}>
          <Text style={styles.compareTitle}>Выбери вариант</Text>
          <View style={styles.compareGrid}>
            {compareVariants.untucked ? (
              <View style={styles.compareCard}>
                <AppPressable onPress={() => { setPreviewUri(compareVariants.untucked || null); setPreviewOpen(true); }}>
                  <Image source={{ uri: compareVariants.untucked }} style={styles.compareImage} resizeMode="contain" />
                </AppPressable>
                <AppPressable style={styles.pickButton} onPress={() => pickVariant('untucked')}>
                  <Text style={styles.pickButtonText}>Выбрать «Расправленный»</Text>
                </AppPressable>
              </View>
            ) : null}
            {compareVariants.tucked ? (
              <View style={styles.compareCard}>
                <AppPressable onPress={() => { setPreviewUri(compareVariants.tucked || null); setPreviewOpen(true); }}>
                  <Image source={{ uri: compareVariants.tucked }} style={styles.compareImage} resizeMode="contain" />
                </AppPressable>
                <AppPressable style={styles.pickButton} onPress={() => pickVariant('tucked')}>
                  <Text style={styles.pickButtonText}>Выбрать «Заправленный»</Text>
                </AppPressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {history.length ? (
        <View style={styles.historyWrap}>
          <Text style={styles.compareTitle}>История генераций</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
            {history.slice(0, 8).map((item) => (
              <AppPressable
                key={item.id}
                style={styles.historyCard}
                onPress={() => {
                  setResultUri(item.imageUri);
                  setWarning(item.warning || null);
                  setSelectedTuckMode(item.tuckMode || 'auto');
                  setSelectedQualityMode(item.qualityMode || 'quality');
                  setPreviewUri(item.imageUri);
                  setPreviewOpen(true);
                }}
              >
                <Image source={{ uri: item.imageUri }} style={styles.historyImage} resizeMode="cover" />
                <Text style={styles.historyText}>{shortDateTime(item.updatedAt)}</Text>
              </AppPressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <AppPressable
        style={[styles.button, (!canGenerate || isBusy) && styles.buttonDisabled]}
        onPress={run}
        disabled={!canGenerate || isBusy}
      >
        <Text style={styles.buttonText}>
          {isLoading ? 'Генерируем полный образ 60-120 сек…' : resultUri ? 'Перегенерировать образ' : 'Сгенерировать полный образ'}
        </Text>
      </AppPressable>

      <Modal transparent animationType="fade" visible={isPreviewOpen} onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImageFull} resizeMode="contain" /> : null}
          <AppPressable style={styles.previewClose} onPress={() => setPreviewOpen(false)}>
            <Text style={styles.previewCloseText}>Закрыть</Text>
          </AppPressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginTop: 6,
    marginBottom: 4
  },
  image: {
    width: '100%',
    height: 420,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#EEE8DC'
  },
  imageWrap: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  placeholder: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F5F1EA',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14
  },
  placeholderText: {
    color: COLORS.muted,
    fontSize: 12
  },
  button: {
    backgroundColor: '#201C19',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  error: {
    color: '#7B3A2A',
    fontSize: 12
  },
  hint: {
    color: COLORS.muted,
    fontSize: 11
  },
  qualityCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F7F3EC',
    padding: 10,
    gap: 3
  },
  qualityTitle: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700'
  },
  qualityText: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14
  },
  compareButton: {
    backgroundColor: '#EEE7DA',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center'
  },
  compareButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700'
  },
  compareWrap: {
    gap: 6
  },
  compareTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700'
  },
  compareGrid: {
    flexDirection: 'row',
    gap: 8
  },
  compareCard: {
    flex: 1,
    gap: 6
  },
  compareImage: {
    width: '100%',
    height: 210,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F2ECE1'
  },
  pickButton: {
    backgroundColor: '#1F1B18',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center'
  },
  pickButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  },
  historyWrap: {
    gap: 6
  },
  historyRow: {
    gap: 8,
    paddingRight: 4
  },
  historyCard: {
    width: 86,
    gap: 4
  },
  historyImage: {
    width: 86,
    height: 108,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F2ECE1'
  },
  historyText: {
    color: COLORS.muted,
    fontSize: 9,
    textAlign: 'center'
  },
  tuckControls: {
    gap: 6
  },
  tuckLabel: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700'
  },
  tuckButtons: {
    flexDirection: 'row',
    gap: 6
  },
  tuckButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#F7F3EC'
  },
  tuckButtonActive: {
    backgroundColor: '#1F1B18',
    borderColor: '#1F1B18'
  },
  tuckButtonText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700'
  },
  tuckButtonTextActive: {
    color: '#FFFFFF'
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: 16
  },
  previewImageFull: {
    width: '100%',
    height: '86%'
  },
  previewClose: {
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: '#EFEAE1',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  previewCloseText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700'
  }
});
