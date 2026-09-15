import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT, translate } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { analyzeTryOnGenerateLook, TryOnQualityMode, TuckMode } from '../services/ai';
import { TryOnHistoryItem } from '../types/looks';

type AiTryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  resultUri?: string;
  warningMessage?: string;
  updatedAt?: number;
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

const TRY_ON_DIR = `${FileSystem.documentDirectory || ''}try-ons/`;

const pickTopGarment = (items: WardrobeItem[]) =>
  items.find((item) => item.section === 'Верх' && item.imageUri);

const pickOuterGarment = (items: WardrobeItem[]) =>
  items.find((item) => item.section === 'Верхняя одежда' && item.imageUri);

const pickBottomGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Низ' && item.imageUri);
const pickShoesGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Обувь' && item.imageUri);

const shortDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const isRemoteUri = (uri: string) => /^https?:\/\//i.test(uri);
const isDataImageUri = (uri: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(uri);

const inferImageExtension = (uri: string) => {
  if (isDataImageUri(uri)) {
    const mime = uri.slice(5, uri.indexOf(';')).toLowerCase();
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    return '.jpg';
  }
  const path = uri.split('?')[0].toLowerCase();
  const match = path.match(/\.(jpg|jpeg|png|webp)$/);
  return match ? `.${match[1]}` : '.jpg';
};

const mergeMessages = (...messages: Array<string | null | undefined>) =>
  messages.filter(Boolean).join(' · ') || undefined;

// Локальные файлы примерки хранятся по абсолютному пути documentDirectory.
// При обновлении приложения контейнерный префикс пути может смениться, поэтому
// старый абсолютный путь перестаёт указывать на файл. Здесь мы синхронно
// «перепривязываем» путь к актуальной папке try-ons по имени файла. Это не
// делает запросов к ФС (никаких ложных ошибок) — для обычного перезапуска
// возвращается тот же путь, а сам <Image> остаётся источником правды о том,
// можно ли реально отрисовать картинку.
export const reanchorTryOnUri = (uri?: string | null): string | null => {
  if (!uri) return null;
  if (isRemoteUri(uri) || isDataImageUri(uri)) return uri;
  const marker = '/try-ons/';
  const idx = uri.lastIndexOf(marker);
  if (idx === -1 || !FileSystem.documentDirectory) return uri;
  const fileName = uri.slice(idx + marker.length);
  if (!fileName) return uri;
  return `${TRY_ON_DIR}${fileName}`;
};

const cacheTryOnImage = async (sourceUri: string, timestamp: number) => {
  if (!FileSystem.documentDirectory) {
    return { imageUri: sourceUri };
  }

  if (isDataImageUri(sourceUri)) {
    try {
      await FileSystem.makeDirectoryAsync(TRY_ON_DIR, { intermediates: true });
      const fileName = `try-on-${timestamp}-${Math.random().toString(36).slice(2, 8)}${inferImageExtension(sourceUri)}`;
      const targetUri = `${TRY_ON_DIR}${fileName}`;
      await FileSystem.writeAsStringAsync(targetUri, sourceUri.split(',')[1], {
        encoding: FileSystem.EncodingType.Base64
      });
      return { imageUri: targetUri };
    } catch (error) {
      console.warn('Failed to persist base64 try-on image', error);
      return { imageUri: sourceUri };
    }
  }

  if (!isRemoteUri(sourceUri)) {
    return { imageUri: sourceUri };
  }

  try {
    await FileSystem.makeDirectoryAsync(TRY_ON_DIR, { intermediates: true });
    const fileName = `try-on-${timestamp}-${Math.random().toString(36).slice(2, 8)}${inferImageExtension(sourceUri)}`;
    const targetUri = `${TRY_ON_DIR}${fileName}`;
    const downloaded = await FileSystem.downloadAsync(sourceUri, targetUri);
    if (downloaded.status >= 200 && downloaded.status < 300) {
      return { imageUri: downloaded.uri };
    }
    throw new Error(`download failed (${downloaded.status})`);
  } catch (error) {
    console.warn('Failed to cache try-on image', error);
    return {
      imageUri: sourceUri,
      warning: translate('Картинка пока хранится по временной ссылке. Если позже не откроется, перегенерируй образ.')
    };
  }
};

export function AiTryOnPreview({
  modelUri,
  items,
  resultUri: controlledResultUri,
  warningMessage,
  updatedAt: controlledUpdatedAt,
  tuckMode,
  qualityMode,
  history = [],
  onGenerated
}: AiTryOnPreviewProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [isLoading, setLoading] = useState(false);
  const [resultUri, setResultUri] = useState<string | null>(reanchorTryOnUri(controlledResultUri));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(warningMessage || null);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [resultImageLoading, setResultImageLoading] = useState(false);
  const [resultImageError, setResultImageError] = useState<string | null>(null);
  const [brokenHistoryUris, setBrokenHistoryUris] = useState<Record<string, boolean>>({});
  // Рекомендация конструктора (tuckMode/qualityMode props) применяется по умолчанию;
  // пользователь может переопределить выбор вручную через пилюли ниже.
  const [tuckOverride, setTuckOverride] = useState<TuckMode | null>(null);
  const [qualityOverride, setQualityOverride] = useState<TryOnQualityMode | null>(null);
  const effectiveTuckMode: TuckMode = tuckOverride ?? tuckMode ?? 'auto';
  const effectiveQualityMode: TryOnQualityMode = qualityOverride ?? qualityMode ?? 'fast';
  const cachedRemoteUris = useRef<Record<string, boolean>>({});

  const topRawGarment = useMemo(() => pickTopGarment(items), [items]);
  const outerRawGarment = useMemo(() => pickOuterGarment(items), [items]);
  // Если есть и рубашка («Верх»), и верхняя одежда — рубашка идёт нижним слоем (top),
  // куртка надевается сверху (outer). Если рубашки нет, одиночная куртка едет как top.
  const topGarment = topRawGarment || outerRawGarment;
  const outerGarment = topRawGarment ? outerRawGarment : undefined;
  const bottomGarment = useMemo(() => pickBottomGarment(items), [items]);
  const shoesGarment = useMemo(() => pickShoesGarment(items), [items]);
  const canGenerate = Boolean(modelUri && (topGarment?.imageUri || bottomGarment?.imageUri || shoesGarment?.imageUri));
  const isBusy = isLoading;
  const missingSections = [
    !topGarment?.imageUri ? 'верх' : null,
    !bottomGarment?.imageUri ? 'низ' : null,
    !shoesGarment?.imageUri ? 'обувь' : null
  ].filter(Boolean) as string[];
  const readinessWarnings = [
    !modelUri ? t('Добавь фото в полный рост в профиле.') : null,
    !topGarment?.imageUri && !bottomGarment?.imageUri ? t('Нужна хотя бы вещь с фото: верх или низ.') : null,
    missingSections.length ? t('Не хватает фото для: {list}.', { list: missingSections.map((s) => t(s)).join(', ') }) : null,
    modelUri && missingSections.length === 0 ? t('Фото готовы. Можно генерировать образ.') : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    setResultUri(reanchorTryOnUri(controlledResultUri));
    setResultImageError(null);
    setResultImageLoading(false);
  }, [controlledResultUri]);

  useEffect(() => {
    setWarning(warningMessage || null);
  }, [warningMessage]);

  useEffect(() => {
    if (!controlledResultUri || !isRemoteUri(controlledResultUri) || cachedRemoteUris.current[controlledResultUri]) {
      return;
    }

    cachedRemoteUris.current[controlledResultUri] = true;
    let cancelled = false;
    const timestamp = controlledUpdatedAt || Date.now();

    cacheTryOnImage(controlledResultUri, timestamp).then((cached) => {
      if (cancelled || cached.imageUri === controlledResultUri) return;
      const nextWarning = mergeMessages(warningMessage, cached.warning);
      setResultUri(cached.imageUri);
      setWarning(nextWarning || null);
      onGenerated?.({
        imageUri: cached.imageUri,
        warning: nextWarning,
        updatedAt: timestamp,
        tuckMode: effectiveTuckMode,
        qualityMode: effectiveQualityMode
      });
    });

    return () => {
      cancelled = true;
    };
  }, [controlledResultUri, controlledUpdatedAt, warningMessage]);

  // Страховка от «вечного» спиннера для протухших удалённых ссылок FASHN,
  // которые могут «зависнуть» и не вызвать ни onLoadEnd, ни onError. Для
  // локальных файлов спиннер не трогаем по таймеру: там onLoadEnd/onError
  // срабатывают надёжно, а ложная ошибка на медленной декодировке не нужна.
  useEffect(() => {
    if (!resultImageLoading) return;
    const current = resultUri;
    const timeout = setTimeout(() => {
      setResultImageLoading(false);
      if (current && isRemoteUri(current)) {
        setResultImageError(t('Не удалось загрузить картинку по временной ссылке. Перегенерируй образ — новая версия сохранится локально.'));
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, [resultImageLoading, resultUri]);

  const runGenerate = async () => {
    const generated = await analyzeTryOnGenerateLook(
      modelUri!,
      topGarment?.imageUri,
      bottomGarment?.imageUri,
      shoesGarment?.imageUri,
      effectiveTuckMode,
      false,
      effectiveQualityMode,
      outerGarment?.imageUri
    );
    if (!generated.outputUrl) {
      throw new Error(generated.error || t('FASHN не вернул итоговую картинку'));
    }
    return { imageUri: generated.outputUrl, warning: generated.warning || undefined };
  };

  const run = async () => {
    if (!modelUri) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const generated = await runGenerate();
      const updatedAt = Date.now();
      const cached = await cacheTryOnImage(generated.imageUri, updatedAt);
      const nextWarning = mergeMessages(generated.warning, cached.warning);
      setResultUri(cached.imageUri);
      setWarning(nextWarning || null);
      onGenerated?.({
        imageUri: cached.imageUri,
        warning: nextWarning,
        updatedAt,
        tuckMode: effectiveTuckMode,
        qualityMode: effectiveQualityMode
      });
    } catch (e: any) {
      setError(e?.message || t('Не удалось сгенерировать примерку'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {resultUri ? (
        <AppPressable style={styles.imageWrap} onPress={() => { setPreviewUri(resultUri); setPreviewOpen(true); }}>
          <Image
            source={{ uri: resultUri }}
            style={styles.image}
            resizeMode="contain"
            onLoadStart={() => {
              // Локальные файлы примерки уже на диске — рисуются мгновенно.
              // Полупрозрачный оверлей загрузки снимается только по onLoadEnd,
              // который на iOS для file:// иногда не приходит, из-за чего картинка
              // ~15 секунд (до сработки таймера-страховки) висит блёклой под
              // оверлеем. Поэтому оверлей показываем только для удалённых ссылок.
              if (resultUri && isRemoteUri(resultUri)) {
                setResultImageLoading(true);
              }
              setResultImageError(null);
            }}
            onLoadEnd={() => setResultImageLoading(false)}
            onError={() => {
              setResultImageLoading(false);
              setResultImageError(t('Эта старая картинка больше недоступна. Перегенерируй образ, новая версия сохранится локально.'));
            }}
          />
          {resultImageLoading && !resultImageError ? (
            <View style={styles.imageOverlay}>
              <ActivityIndicator color="#1F1D1A" />
            </View>
          ) : null}
          {resultImageError ? (
            <View style={styles.imageOverlay}>
              <Text style={styles.imageErrorText}>{resultImageError}</Text>
            </View>
          ) : null}
        </AppPressable>
      ) : null}
      {!resultUri ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>{t('ИИ примерка пока не сгенерирована')}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {warning ? <Text style={styles.hint}>{warning}</Text> : null}
      {topGarment?.imageUri ? (
        <View style={styles.qualityCard}>
          <Text style={styles.qualityTitle}>{t('Посадка верха')}</Text>
          <View style={styles.optionsRow}>
            {(['auto', 'tucked', 'untucked'] as TuckMode[]).map((mode) => {
              const active = effectiveTuckMode === mode;
              const label = mode === 'auto' ? 'Авто' : mode === 'tucked' ? 'Заправить' : 'Навыпуск';
              return (
                <AppPressable
                  key={mode}
                  haptics
                  style={[styles.optionPill, active && styles.optionPillActive]}
                  onPress={() => setTuckOverride(mode)}
                >
                  <Text style={[styles.optionPillText, active && styles.optionPillTextActive]}>{t(label)}</Text>
                </AppPressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <View style={styles.qualityCard}>
        <Text style={styles.qualityTitle}>{t('Качество примерки')}</Text>
        <View style={styles.optionsRow}>
          {(['fast', 'quality'] as TryOnQualityMode[]).map((mode) => {
            const active = effectiveQualityMode === mode;
            const label = mode === 'fast' ? 'Быстро' : 'Качество';
            return (
              <AppPressable
                key={mode}
                haptics
                style={[styles.optionPill, active && styles.optionPillActive]}
                onPress={() => setQualityOverride(mode)}
              >
                <Text style={[styles.optionPillText, active && styles.optionPillTextActive]}>{t(label)}</Text>
              </AppPressable>
            );
          })}
        </View>
      </View>
      <View style={styles.qualityCard}>
        <Text style={styles.qualityTitle}>{t('Проверка перед генерацией')}</Text>
        {readinessWarnings.map((item) => (
          <Text key={item} style={styles.qualityText}>• {item}</Text>
        ))}
      </View>
      {history.length ? (
        <View style={styles.historyWrap}>
          <Text style={styles.compareTitle}>{t('История генераций')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
            {history.slice(0, 8).map((item) => (
              <AppPressable
                key={item.id}
                style={styles.historyCard}
                onPress={() => {
                  const anchored = reanchorTryOnUri(item.imageUri) || item.imageUri;
                  setResultUri(anchored);
                  setWarning(item.warning || null);
                  setResultImageError(null);
                  setPreviewUri(anchored);
                  setPreviewOpen(true);
                }}
              >
                <View style={styles.historyImageWrap}>
                  <Image
                    source={{ uri: reanchorTryOnUri(item.imageUri) || item.imageUri }}
                    style={styles.historyImage}
                    resizeMode="cover"
                    onError={() => setBrokenHistoryUris((prev) => ({ ...prev, [item.imageUri]: true }))}
                  />
                  {brokenHistoryUris[item.imageUri] ? (
                    <View style={styles.historyImageError}>
                      <Text style={styles.historyImageErrorText}>{t('Недоступно')}</Text>
                    </View>
                  ) : null}
                </View>
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
          {isLoading
            ? t('Генерируем образ…')
            : resultUri
              ? t('Перегенерировать')
              : t('Сгенерировать')}
        </Text>
      </AppPressable>

      <Modal transparent animationType="fade" visible={isPreviewOpen} onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImageFull} resizeMode="contain" /> : null}
          <AppPressable style={styles.previewClose} onPress={() => setPreviewOpen(false)}>
            <Text style={styles.previewCloseText}>{t('Закрыть')}</Text>
          </AppPressable>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
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
    borderColor: c.border,
    backgroundColor: c.surface
  },
  imageWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative'
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245,241,234,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18
  },
  imageErrorText: {
    color: '#1F1D1A',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '700'
  },
  placeholder: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14
  },
  placeholderText: {
    color: c.muted,
    fontSize: 12
  },
  button: {
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: c.buttonPrimaryText,
    fontSize: 12,
    fontWeight: '700'
  },
  error: {
    color: '#7B3A2A',
    fontSize: 12
  },
  hint: {
    color: c.muted,
    fontSize: 11
  },
  qualityCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    padding: 10,
    gap: 3
  },
  qualityTitle: {
    color: c.text,
    fontSize: 11,
    fontWeight: '700'
  },
  qualityText: {
    color: c.muted,
    fontSize: 10,
    lineHeight: 14
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2
  },
  optionPill: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  optionPillActive: {
    backgroundColor: c.accentGoldSoft,
    borderColor: c.goldHairline
  },
  optionPillText: {
    color: c.text,
    fontSize: 11,
    fontWeight: '600'
  },
  optionPillTextActive: {
    color: c.accentGold,
    fontWeight: '700'
  },
  compareTitle: {
    color: c.text,
    fontSize: 12,
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
  historyImageWrap: {
    width: 86,
    height: 108,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative'
  },
  historyImage: {
    width: 86,
    height: 108,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface
  },
  historyImageError: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: c.surface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6
  },
  historyImageErrorText: {
    color: c.muted,
    fontSize: 9,
    textAlign: 'center',
    fontWeight: '700'
  },
  historyText: {
    color: c.muted,
    fontSize: 9,
    textAlign: 'center'
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
