import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, View, Platform, Share } from 'react-native';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { Glass, PrimarySurface } from './studio/Glass';
import { font, INK } from './studio/studio';
import { useThemedStyles } from '../constants/ThemeContext';
import { localeFor, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { TryOnQualityMode, TuckMode } from '../services/ai';
import { cacheTryOnImage, isRemoteUri, reanchorTryOnUri } from '../services/tryOnPhotos';
import { saveTryOnToGallery } from '../services/tryOnExport';
import { tryOnContext } from '../services/tryOnJobs';
import { useTryOnJobs } from './TryOnJobsContext';
import { useAiConsent } from './AiConsentContext';
import { useGenerationDock } from './GenerationDock';
import { tryOnStatusLabel } from './tryOnStatus';
import { TryOnOptions } from './TryOnOptions';
import { accessorySlot, TRYON_SECTIONS } from '../domain/accessories';
import { FormScrollView } from './ui/FormScrollView';
import { GarmentOptions } from '../domain/garmentOptions';
export { reanchorTryOnUri } from '../services/tryOnPhotos';
import { TryOnHistoryItem } from '../types/looks';
import { Check, Download, X, Share2 } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { ZoomableImage } from './ui/ZoomableImage';

type AiTryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  resultUri?: string;
  warningMessage?: string;
  updatedAt?: number;
  tuckMode?: TuckMode;
  qualityMode?: TryOnQualityMode;
  history?: TryOnHistoryItem[];
  showSourcePhoto?: boolean;
  // 'sheet': the try-on sheet of the fitting room - how each garment is worn
  // on top, the button pinned at the bottom, the look itself in the generation window.
  variant?: 'card' | 'sheet';
  /** Sheet only: more content under the options, and actions next to the button. */
  sheetContent?: ReactNode;
  sheetFooter?: ReactNode;
  onSelectHistory?: (payload: TryOnHistoryItem) => void;
  /** Closes the sheet this preview sits in: closing the generation window then lands on the main screen. */
  onLeave?: () => void;
  onGenerated?: (payload: {
    imageUri: string;
    warning?: string;
    updatedAt: number;
    tuckMode: TuckMode;
    qualityMode: TryOnQualityMode;
  }) => void;
};

const pickTopGarment = (items: WardrobeItem[]) =>
  items.find((item) => item.section === 'Верх' && item.imageUri);

const pickOuterGarment = (items: WardrobeItem[]) =>
  items.find((item) => item.section === 'Верхняя одежда' && item.imageUri);

const pickBottomGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Низ' && item.imageUri);
const pickShoesGarment = (items: WardrobeItem[]) => items.find((item) => item.section === 'Обувь' && item.imageUri);

const shortDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString(localeFor(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const mergeMessages = (...messages: Array<string | null | undefined>) =>
  messages.filter(Boolean).join(' · ') || undefined;

// Server stage names map onto wardrobe sections, so progress can name the garment itself.
const STAGE_SECTIONS: Record<string, string> = { bottom: 'Низ', shoes: 'Обувь', top: 'Верх', outer: 'Верхняя одежда' };

export function AiTryOnPreview({
  modelUri,
  items,
  resultUri: controlledResultUri,
  warningMessage,
  updatedAt: controlledUpdatedAt,
  tuckMode,
  qualityMode,
  history: suppliedHistory = [],
  showSourcePhoto = false,
  variant = 'card',
  sheetContent,
  sheetFooter,
  onGenerated,
  onSelectHistory,
  onLeave
}: AiTryOnPreviewProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors, isDark } = useTheme();
  const { jobs, store, ready: jobsReady, readOnly, error: journalError, login } = useTryOnJobs();
  const aiConsent = useAiConsent();
  const dock = useGenerationDock();
  const [context, setContext] = useState<string | null>(null);
  const contextPhotos = JSON.stringify([modelUri, items.map(i => [i.id, i.imageUri, i.sourceImageUri, i.section, i.category])]);
  useEffect(() => {
    let active = true;
    setContext(null);
    void tryOnContext(modelUri || '', items).then(key => { if (active) setContext(key); }).catch(() => {});
    return () => { active = false; };
  }, [contextPhotos]);
  const matchingJobs = jobs.filter(job => job.context === context);
  const pendingJob = matchingJobs.find(job => job.status === 'pending');
  const history = [...new Map([...suppliedHistory, ...matchingJobs.flatMap(job => job.result ? [job.result] : [])]
    .sort((a, b) => b.updatedAt - a.updatedAt).map(item => [item.imageUri, item])).values()].slice(0, 8);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [resultUri, setResultUri] = useState<string | null>(reanchorTryOnUri(controlledResultUri));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(warningMessage || null);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [resultImageLoading, setResultImageLoading] = useState(false);
  const [resultImageError, setResultImageError] = useState<string | null>(null);
  const [brokenHistoryUris, setBrokenHistoryUris] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // How each garment is worn (tucked, buttoned), by item id; the base top's tuck
  // also goes as the look's tuck mode, as before these options existed.
  const baseTop = items.find(item => item.section === 'Верх' && item.imageUri);
  const [garmentOptions, setGarmentOptions] = useState<GarmentOptions>(() =>
    baseTop && tuckMode && tuckMode !== 'auto' ? { [baseTop.id]: { tuck: tuckMode } } : {});
  const effectiveTuckMode: TuckMode = (baseTop && garmentOptions[baseTop.id]?.tuck) || 'auto';
  // What the shown picture is: a cheap draft ('fast') or the final ('quality').
  // Results saved before drafts existed carry no mode and were finals.
  const [resultQuality, setResultQuality] = useState<TryOnQualityMode>(qualityMode || 'quality');
  const isDraft = resultQuality === 'fast';
  const cachedRemoteUris = useRef<Record<string, boolean>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Каждая вещь едет своим слотом, включая одинокую куртку. Раньше она
  // подменялась слотом «верх», и сервер считал, что менялся только торс, —
  // пальто до колена при этом обрезалось по линии бедра.
  const topGarment = useMemo(() => pickTopGarment(items), [items]);
  const outerGarment = useMemo(() => pickOuterGarment(items), [items]);
  const bottomGarment = useMemo(() => pickBottomGarment(items), [items]);
  const shoesGarment = useMemo(() => pickShoesGarment(items), [items]);
  const accessory = items.find(item => item.imageUri && accessorySlot(item));
  const canGenerate = Boolean(modelUri && context && jobsReady && !readOnly && (topGarment?.imageUri || outerGarment?.imageUri || bottomGarment?.imageUri || shoesGarment?.imageUri || accessory));
  const isBusy = isLoading || Boolean(pendingJob);
  const progress = pendingJob?.progress;
  const stageLabel = (stage: string) => {
    const section = STAGE_SECTIONS[stage];
    const garment = section ? items.find(item => item.section === section && item.imageUri) : undefined;
    return garment?.name || (section ? t(section) : stage);
  };
  const listStages = (stages: string[]) => stages.map(stageLabel).join(', ');
  const busyLabel = tryOnStatusLabel(progress, t, stageLabel);
  const intermediateUri = isBusy && progress?.previewUrl ? progress.previewUrl : null;
  const intermediateHint = !progress || ['outfit', 'queue', 'upload'].includes(progress.stage || '') ? null
    : progress.stage === 'layers' ? t('Базовый образ готов, надеваем верхние слои. Лицо и фон восстановятся в финальной версии.')
    : progress.pending.length || (progress.stage && progress.stage !== 'composite')
      ? t('Уже надето: {done}. Осталось: {pending}. Лицо и фон восстановятся в финальной версии.', {
        done: listStages(progress.done) || '—', pending: listStages([...(progress.stage && progress.stage !== 'composite' ? [progress.stage] : []), ...progress.pending]) })
      : t('Все вещи надеты. Восстанавливаем лицо и фон…');
  const readinessWarnings = [
    !modelUri ? t('Добавь фото в полный рост в профиле.') : null,
    !topGarment && !outerGarment && !bottomGarment && !shoesGarment && !accessory ? t('Выбери вещь с фото для примерки.') : null,
    items.some(item => !item.imageUri) ? t('Вещи без фото не участвуют в примерке.') : null,
    items.some(item => !TRYON_SECTIONS.includes(item.section) || (item.section === 'Аксессуары' && !accessorySlot(item))) ? t('Эту вещь пока нельзя примерить.') : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    setResultUri(reanchorTryOnUri(controlledResultUri));
    setResultQuality(qualityMode || 'quality');
    setResultImageError(null);
    setResultImageLoading(false);
  }, [controlledResultUri]);

  useEffect(() => { setSaveState('idle'); setSaveMessage(null); }, [resultUri]);

  // Поделиться — сразу в мессенджер или сторис, без сохранения в галерею.
  const shareResult = async () => {
    if (!resultUri) return;
    try {
      const fileUri = isRemoteUri(resultUri) || resultUri.startsWith('data:')
        ? (await cacheTryOnImage(resultUri, `share-${Date.now()}`, login)).imageUri : resultUri;
      await Share.share(Platform.OS === 'ios' ? { url: fileUri } : { message: fileUri, url: fileUri });
    } catch { /* The share sheet was dismissed or unavailable. */ }
  };

  const saveToGallery = async () => {
    if (!resultUri || saveState === 'saving' || isBusy) return;
    setSaveState('saving'); setSaveMessage(null);
    try {
      // One way to the gallery for the whole app (tryOnExport): the full-size file, never a preview.
      await saveTryOnToGallery(resultUri, login);
      if (!mounted.current) return;
      setSaveState('saved'); setSaveMessage(t(isDraft ? 'Черновик сохранён в галерею' : 'Сохранено в галерею в полном качестве'));
    } catch (e: any) {
      if (!mounted.current) return;
      setSaveState('error'); setSaveMessage(e?.message || t('Не удалось сохранить в галерею'));
    }
  };

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

    cacheTryOnImage(controlledResultUri, String(timestamp), login).then((cached) => {
      if (cancelled || cached.imageUri === controlledResultUri) return;
      const nextWarning = mergeMessages(warningMessage, cached.warning);
      setResultUri(cached.imageUri);
      setWarning(nextWarning || null);
      setShowOriginal(false);
      onGenerated?.({
        imageUri: cached.imageUri,
        warning: nextWarning,
        updatedAt: timestamp,
        tuckMode: effectiveTuckMode,
        qualityMode: qualityMode || 'quality'
      });
    }).catch(() => { if (!cancelled) setWarning(t('Не удалось сохранить фото на устройстве. Освободи место и повтори загрузку результата.')); });

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

  const seenJobs = useRef(new Set<string>());
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    const latest = matchingJobs.find(job => job.status === 'succeeded' && job.result);
    if (!latest?.result || seenJobs.current.has(latest.id)) return;
    seenJobs.current.add(latest.id);
    if (controlledResultUri && latest.createdAt < mountedAt.current) return;
    const result = latest.result;
    setResultUri(result.imageUri); setResultQuality(result.qualityMode || 'quality');
    setWarning(result.warning || null); setShowOriginal(false);
    onGenerated?.({ ...result, tuckMode: result.tuckMode || 'auto', qualityMode: result.qualityMode || 'quality' });
  }, [jobs, context]);
  // `fresh` asks for a new variant of the same look: the user disliked the result.
  const run = async (quality: TryOnQualityMode, fresh = false) => {
    if (!canGenerate || isBusy || !context || !modelUri) return;
    if (!(await aiConsent.ensure())) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      // The try-on opens in the app-wide generation window, which can fold into the corner.
      await store.start({ modelUri, items, context, tuckMode: effectiveTuckMode, quality, fresh, onJob: id => dock.started(id, onLeave), options: garmentOptions });
    } catch (e: any) {
      if (mounted.current) setError(e?.message || t('Не удалось сгенерировать примерку'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const historyBlock = history.length ? (
        <View style={styles.historyWrap}>
          <Text style={styles.sheetTitle}>{t('История генераций')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
            {history.slice(0, 8).map((item) => (
              <AppPressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={t('Примерка от {date}', { date: shortDateTime(item.updatedAt) })}
                accessibilityState={{ selected: (reanchorTryOnUri(item.imageUri) || item.imageUri) === resultUri }}
                style={styles.historyCard}
                onPress={() => {
                  const anchored = reanchorTryOnUri(item.imageUri) || item.imageUri;
                  setResultUri(anchored);
                  setResultQuality(item.qualityMode || 'quality');
                  setWarning(item.warning || null);
                  setResultImageError(null);
                  setShowOriginal(false);
                  onSelectHistory?.(item);
                  setPreviewUri(anchored);
                  setPreviewOpen(true);
                }}
              >
                <View style={[styles.historyImageWrap, { borderColor: (reanchorTryOnUri(item.imageUri) || item.imageUri) === resultUri ? colors.text : 'transparent' }]}>
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
                {item.qualityMode === 'fast' ? <Text style={styles.historyText}>{t('черновик')}</Text> : null}
              </AppPressable>
            ))}
          </ScrollView>
        </View>
      ) : null;
  const mainButton = <>
      {/* While the look generates the button brings its window back: the window
          may have been folded away, and this is the way to it from here. */}
      <AppPressable
        haptics
        style={[styles.button, ((!canGenerate && !pendingJob) || isLoading) && styles.buttonDisabled]}
        onPress={() => pendingJob ? dock.open(pendingJob.id, onLeave)
          // The sheet already shows the choices; anywhere else the window opens on them first.
          : variant === 'sheet' ? void run('quality', Boolean(resultUri))
          : context ? dock.prepare({ items, context, fresh: Boolean(resultUri), options: garmentOptions }) : undefined}
        disabled={pendingJob ? false : !canGenerate || isBusy}
        accessibilityRole="button"
        accessibilityState={{ disabled: pendingJob ? false : !canGenerate || isBusy, busy: isBusy }}
      >
        <PrimarySurface dark={isDark}>
          <View style={styles.buttonInner}>
            {isBusy ? <ActivityIndicator size="small" color={isDark ? INK : '#FFFFFF'} /> : null}
            <Text style={[styles.buttonText, { color: isDark ? INK : '#FFFFFF' }]} numberOfLines={1}>{pendingJob ? t('Открыть генерацию') : isBusy ? busyLabel : !resultUri ? t('Примерить') : t('Перегенерировать')}</Text>
          </View>
        </PrimarySurface>
      </AppPressable>
      {pendingJob ? <Text style={styles.hint}>{busyLabel}</Text> : null}
  </>;
  const warningsBlock = readinessWarnings.length > 0 ? <View style={styles.qualityCard}>
    {readinessWarnings.map((item) => (
      <Text key={item} style={styles.qualityText}>{item}</Text>
    ))}
  </View> : null;
  const errorsBlock = <>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {journalError || matchingJobs[0]?.error ? <Text style={styles.error}>{t(journalError || matchingJobs[0].error || '')}</Text> : null}
  </>;
  const previewModal = <>
      <Modal transparent animationType="fade" visible={isPreviewOpen} onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.previewBackdrop}>
          {previewUri ? <ZoomableImage uri={previewUri} style={styles.previewImageFull} /> : null}
          <AppPressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} style={styles.previewClose} onPress={() => setPreviewOpen(false)}>
            <Glass style={styles.previewCloseGlass}><View style={styles.center}><X size={22} color={isDark ? '#FFFFFF' : INK} /></View></Glass>
          </AppPressable>
        </View>
      </Modal>
  </>;

  if (variant === 'sheet') {
    // The sheet asks how to wear the look and leaves the look itself to the
    // generation window: no profile photo here, and the button never scrolls away.
    return (
      <View style={styles.sheetWrap}>
        <FormScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetContent}>
          <Text style={styles.sheetTitle}>{t('Как надеть')}</Text>
          <TryOnOptions items={items} options={garmentOptions} onChange={setGarmentOptions} disabled={isBusy} />
          {warningsBlock}
          {errorsBlock}
          {historyBlock}
          {sheetContent}
        </FormScrollView>
        <View style={styles.sheetFooter}>
          {mainButton}
          {sheetFooter}
        </View>
        {previewModal}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {resultUri && modelUri && !intermediateUri && <Glass><View style={styles.comparison} accessibilityRole="tablist">
        {[false, true].map(original => <AppPressable key={String(original)} haptics accessibilityRole="tab" accessibilityState={{ selected: showOriginal === original }}
          style={[styles.compareTab, showOriginal === original && styles.compareTabActive]} onPress={() => setShowOriginal(original)}>
          <Text style={[styles.compareTitle, showOriginal === original && styles.compareTitleActive]}>{t(original ? 'Исходное фото' : 'Результат')}</Text>
        </AppPressable>)}
      </View></Glass>}
      {intermediateUri ? (
        <View style={styles.imageWrap} accessibilityLabel={t('Промежуточный результат')}>
          <Image source={{ uri: intermediateUri }} style={styles.image} resizeMode="contain" />
          <Glass style={styles.intermediateBadge}><Text style={styles.intermediateBadgeText}>{t('Промежуточный результат')}</Text></Glass>
        </View>
      ) : null}
      {intermediateHint && isBusy ? <Text style={styles.hint}>{intermediateHint}</Text> : null}
      {resultUri && !intermediateUri ? (
        <AppPressable style={styles.imageWrap} onPress={() => { setPreviewUri(showOriginal && modelUri ? modelUri : resultUri); setPreviewOpen(true); }}>
          <Image
            source={{ uri: showOriginal && modelUri ? modelUri : resultUri }}
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
          {isDraft && !showOriginal ? (
            <Glass style={styles.intermediateBadge}><Text style={styles.intermediateBadgeText}>{t('Черновик')}</Text></Glass>
          ) : null}
          {resultImageLoading && !resultImageError ? (
            <View style={styles.imageOverlay}>
              <ActivityIndicator color={INK} />
            </View>
          ) : null}
          {resultImageError ? (
            <View style={styles.imageOverlay}>
              <Text style={styles.imageErrorText}>{resultImageError}</Text>
            </View>
          ) : null}
        </AppPressable>
      ) : null}
      {!resultUri && !intermediateUri && showSourcePhoto && modelUri && <Image source={{ uri: modelUri }} style={styles.image} resizeMode="contain" accessibilityLabel={t('Фото для примерки')} />}
      {resultUri && !isBusy ? (<View style={styles.resultActions}>
        <AppPressable haptics style={{ flex: 1, borderRadius: 999 }} onPress={saveToGallery} disabled={saveState === 'saving'}
          accessibilityRole="button" accessibilityState={{ disabled: saveState === 'saving', busy: saveState === 'saving' }}>
          <Glass><View style={styles.secondaryButton}>
          {saveState === 'saving' ? <ActivityIndicator size="small" color={colors.text} />
            : saveState === 'saved' ? <Check size={17} strokeWidth={1.8} color={colors.text} /> : <Download size={17} strokeWidth={1.6} color={colors.text} />}
          <Text style={styles.secondaryButtonText}>{t(saveState === 'saving' ? 'Сохраняем…' : saveState === 'saved' ? 'Сохранено в галерею'
            : isDraft ? 'Сохранить черновик в галерею' : 'Сохранить в галерею')}</Text>
          </View></Glass>
        </AppPressable>
        {Platform.OS !== 'web' ? <AppPressable haptics style={styles.shareButton} onPress={() => { void shareResult(); }} accessibilityRole="button" accessibilityLabel={t('Поделиться')}>
          <Glass style={styles.shareButton}><View style={styles.center}><Share2 size={17} strokeWidth={1.6} color={colors.text} /></View></Glass>
        </AppPressable> : null}
      </View>) : null}
      {saveMessage ? <Text style={saveState === 'error' ? styles.error : styles.hint}>{saveMessage}</Text> : null}
      {errorsBlock}
      {warning ? <Text style={styles.hint}>{warning.split(' · ').map(part => t(part)).join(' · ')}</Text> : null}
      {warningsBlock}
      {historyBlock}
      {mainButton}
      {/* One button: every try-on is the full-quality look (one call, one price).
          Drafts made earlier stay labelled in the history. */}


      {previewModal}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetWrap: { flex: 1, gap: 12 },
  sheetContent: { gap: 14, paddingBottom: 16 },
  sheetTitle: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20 },
  sheetFooter: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  wrap: { gap: 14, marginTop: 6, marginBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The look on the person: a rounded print, like the fitting room's frame.
  image: { width: '100%', height: 420, borderRadius: 28, backgroundColor: c.surface },
  imageWrap: { borderRadius: 28, overflow: 'hidden', position: 'relative' },
  imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.72)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  imageErrorText: { ...font('semibold'), color: INK, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  // The main action: the studio's black pill.
  button: { borderRadius: 999 },
  buttonInner: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { ...font('semibold'), fontSize: 16, flexShrink: 1 },
  error: { ...font('regular'), color: c.danger, fontSize: 13, lineHeight: 18 },
  hint: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 17 },
  intermediateBadge: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  intermediateBadgeText: { ...font('semibold'), color: c.text, fontSize: 12 },
  resultActions: { flexDirection: 'row', gap: 8 },
  shareButton: { width: 46, height: 46, borderRadius: 23 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, paddingHorizontal: 16 },
  secondaryButtonText: { ...font('semibold'), color: c.text, fontSize: 14, flexShrink: 1 },
  qualityCard: { paddingVertical: 4, gap: 6 },
  qualityText: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 18 },
  compareTitle: { ...font('semibold'), color: c.text, fontSize: 13, opacity: 0.78 },
  compareTitleActive: { color: c.background, opacity: 1 },
  comparison: { flexDirection: 'row', padding: 3 },
  compareTab: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  compareTabActive: { backgroundColor: c.text },
  historyWrap: { gap: 10 },
  historyRow: { gap: 10, paddingRight: 4 },
  historyCard: { width: 62, gap: 4 },
  historyImageWrap: { width: 62, height: 84, borderRadius: 16, borderWidth: 2, overflow: 'hidden', position: 'relative', backgroundColor: c.surface },
  historyImage: { width: '100%', height: '100%' },
  historyImageError: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  historyImageErrorText: { ...font('medium'), color: c.muted, fontSize: 9, textAlign: 'center' },
  historyText: { ...font('regular'), color: c.muted, fontSize: 10, textAlign: 'center' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 16 },
  previewImageFull: { width: '100%', height: '86%', flex: 0 },
  previewClose: { alignSelf: 'center', marginTop: 12, borderRadius: 22 },
  previewCloseGlass: { width: 44, height: 44 }
});
