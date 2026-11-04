import { ActivityIndicator, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useShareChoice } from './SharePoster';
import { askReadyNotificationPermission } from '../services/readyNotification';
import { tryOnContext } from '../services/tryOnJobs';
import { useTryOnJobs } from './TryOnJobsContext';
import { useAiConsent } from './AiConsentContext';
import { useGenerationDock } from './GenerationDock';
import { tryOnStatusLabel } from './tryOnStatus';
import { TryOnOptions } from './TryOnOptions';
import { accessorySlot, TRYON_SECTIONS } from '../domain/accessories';
import { FormScrollView, SheetStrip } from './ui/FormScrollView';
import { GarmentOptions } from '../domain/garmentOptions';
export { reanchorTryOnUri } from '../services/tryOnPhotos';
import { GeneratedLook, TryOnHistoryItem } from '../types/looks';
import { lookWithResult } from '../domain/favorites';
import { SaveLookButton, useSaveLook } from './SaveLook';
import { PhotoViewer, ResultActions, ResultPhotoControls, ResultPieces, useGallerySave } from './ResultKit';
import { CARD_CHROME, estimatedViewport, RESULT_GAP, RESULT_RADIUS, resultPhotoHeight } from './studio/resultLayout';
import { useTheme } from '../constants/ThemeContext';
import { useImageAspect } from './studio/useImageAspect';
import { FittedFrame, FittedImage } from './ui/FittedFrame';
import { GenerationView } from './studio/GenerationView';
import { revealLedger } from './studio/generationReveal';
import { pictureFit } from './studio/imageFit';
import { useSheetGestureBlock } from './studio/SheetHandle';

type AiTryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  /** The look on this card: its one button saves it, with the try-on on show if there is one. */
  favoriteLook?: GeneratedLook;
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
  /** Card only: the look's pieces drawn large, until there is a try-on to show; then they are thumbnails under it. */
  preview?: ReactNode;
  /** Card only: more about the look, always under the buttons. */
  details?: ReactNode;
  /** The card is on screen: otherwise its sweep stands still and a finished look's reveal waits. */
  visible?: boolean;
  /** The height of the list the card scrolls in: photo, thumbnails and buttons fit it whole. */
  viewport?: number;
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

export function AiTryOnPreview({
  modelUri,
  items,
  favoriteLook,
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
  onLeave,
  preview,
  details,
  visible = true,
  viewport
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
  // Result and source share the result's rect: the switch between them moves nothing.
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(warningMessage || null);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  useSheetGestureBlock(isPreviewOpen);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [resultImageLoading, setResultImageLoading] = useState(false);
  const [resultImageError, setResultImageError] = useState<string | null>(null);
  const [brokenHistoryUris, setBrokenHistoryUris] = useState<Record<string, boolean>>({});
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
  const busyLabel = tryOnStatusLabel(progress, t);
  // One frame for the result; the running look and its reveal are the one generation view.
  const framedAspect = useImageAspect(resultUri);
  const framedFit = pictureFit(framedAspect);
  // The newest finished look of this card, until its reveal has played here.
  const finishedJob = matchingJobs.find(job => job.status === 'succeeded' && job.result);
  const [revealPlayed, setRevealPlayed] = useState<string>();
  // The ledger settles as the reveal starts: from then on this keeps the placeholder on the card until it has played.
  const [revealingId, setRevealingId] = useState<string>();
  const owedJob = !pendingJob && finishedJob && (revealingId === finishedJob.id || (revealPlayed !== finishedJob.id && revealLedger.owes(finishedJob.id, 'full'))) ? finishedJob : undefined;
  const liveJob = pendingJob || owedJob;
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const photoHeight = resultPhotoHeight({ available: viewport || estimatedViewport(windowHeight, insets.top), chrome: CARD_CHROME, pieces: items.length > 0 });
  // The card's look with the try-on on show; while a reveal plays there is nothing to save yet.
  const shownLook = favoriteLook && resultUri ? lookWithResult(favoriteLook, { imageUri: resultUri, warning: warning || undefined,
    updatedAt: suppliedHistory.find(item => item.imageUri === resultUri)?.updatedAt || controlledUpdatedAt || Date.now(), tuckMode: effectiveTuckMode }) : favoriteLook;
  const favorite = useSaveLook(shownLook);
  const gallery = useGallerySave(resultUri, isDraft);
  const startAgain = () => { if (context) dock.prepare({ items, context, fresh: true, options: garmentOptions }); };
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

  // Поделиться — сразу в мессенджер или сторис, без сохранения в галерею.
  const sharing = useShareChoice(login);
  const shareResult = () => { if (resultUri) sharing.offer({ uri: resultUri, items, title: items.map(item => item.name).join(' + ') }); };

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
    // An older look already on the card stays, unless this one still owes its reveal here: what it sharpens into must then be what stays.
    if (controlledResultUri && latest.createdAt < mountedAt.current && !revealLedger.owes(latest.id, 'full')) return;
    const result = latest.result;
    setResultUri(result.imageUri); setResultQuality(result.qualityMode || 'quality');
    setWarning(result.warning || null); setShowOriginal(false);
    onGenerated?.({ ...result, tuckMode: result.tuckMode || 'auto', qualityMode: result.qualityMode || 'quality' });
  }, [jobs, context]);
  // `fresh` asks for a new variant of the same look: the user disliked the result.
  const run = async (quality: TryOnQualityMode, fresh = false) => {
    if (!canGenerate || isBusy || !context || !modelUri) return;
    if (!(await aiConsent.ensure())) return;
    void askReadyNotificationPermission(t('Готовые образы'));
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
          <SheetStrip showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
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
                    resizeMode="contain"
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
          </SheetStrip>
        </View>
      ) : null;
  const buttonContent = (ink: string) => (
    <View style={[styles.buttonInner, variant !== 'sheet' && { height: 50 }]}>
      {isBusy ? <ActivityIndicator size="small" color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]} numberOfLines={1}>{pendingJob ? t('Открыть генерацию') : isBusy ? busyLabel : !resultUri ? t('Примерить') : t('Примерить снова')}</Text>
    </View>
  );
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
        {/* The sheet's button is its one main action; on the cards of «Образы» each look's button is glass,
            so the screen keeps one black button and no sheen loops on every card. */}
        {variant === 'sheet' ? <PrimarySurface dark={isDark}>{buttonContent(isDark ? INK : '#FFFFFF')}</PrimarySurface>
          : <Glass>{buttonContent(colors.text)}</Glass>}
      </AppPressable>
      {/* The sheet has no frame of its own: the window opens over it, and this line says where the look is meanwhile. */}
      {pendingJob && variant === 'sheet' ? <Text style={styles.hint}>{busyLabel}</Text> : null}
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
  const previewModal = <PhotoViewer uri={isPreviewOpen ? previewUri : null} onClose={() => setPreviewOpen(false)} />;

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

  const hasResult = Boolean(resultUri) && !liveJob;
  const framed = Boolean(liveJob || resultUri || (showSourcePhoto && modelUri));
  const photoStyle = { width: '100%' as const, height: photoHeight };
  return (
    <View style={styles.wrap}>
      {!framed ? preview : null}
      {liveJob ? (
        <GenerationView jobKey={liveJob.id} busy={Boolean(pendingJob)} label={busyLabel} stage={progress?.stage} items={items} sourceUri={liveJob.sourceUri || modelUri}
          photoUri={progress?.previewUrl || modelUri || null} resultUri={pendingJob ? null : reanchorTryOnUri(liveJob.result?.imageUri) || null} radius={RESULT_RADIUS} frameStyle={photoStyle}
          active={visible && !dock.windowUp} onRevealEnd={() => { setRevealPlayed(liveJob.id); setRevealingId(undefined); }} onRevealStart={() => setRevealingId(liveJob.id)}
          renderResult={fit => <Image source={{ uri: reanchorTryOnUri(liveJob.result?.imageUri) || undefined }} resizeMode={fit} style={StyleSheet.absoluteFill} />} />
      ) : resultUri ? (
        <FittedFrame aspect={framedAspect} radius={RESULT_RADIUS} style={photoStyle}>
        <AppPressable style={StyleSheet.absoluteFill} accessibilityRole="imagebutton" accessibilityLabel={t('Открыть во весь экран')} onPress={() => { setPreviewUri(showOriginal && modelUri ? modelUri : resultUri); setPreviewOpen(true); }}>
          <Image
            source={{ uri: showOriginal && modelUri ? modelUri : resultUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={showOriginal && modelUri ? 'contain' : framedFit}
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
        <ResultPhotoControls onShare={shareResult} compare={modelUri ? { before: showOriginal, onToggle: () => setShowOriginal(value => !value) } : undefined} />
        </FittedFrame>
      ) : null}
      {!resultUri && !liveJob && showSourcePhoto && modelUri && <FittedImage uri={modelUri} radius={RESULT_RADIUS} style={photoStyle} accessibilityLabel={t('Фото для примерки')} />}
      {hasResult && !isBusy ? <>
        <ResultPieces items={items.map(item => ({ id: item.id, name: item.name, imageUri: item.imageUri }))} />
        <ResultActions gallery={gallery} save={favorite} againDisabled={!canGenerate} onAgain={startAgain} />
      </> : null}
      {sharing.sheet}
      {errorsBlock}
      {warning ? <Text style={styles.hint}>{warning.split(' · ').map(part => t(part)).join(' · ')}</Text> : null}
      {warningsBlock}
      {details}
      {historyBlock}
      {/* Without a try-on the look can still be saved; with one, the heart among the three buttons does it. */}
      {shownLook && !hasResult && !isBusy && !owedJob ? <SaveLookButton look={shownLook} /> : null}
      {/* With a result «Ещё раз» is the button; before it, and while a try-on runs, this one. Every try-on is the full-quality look (one call, one price). */}
      {!hasResult && !owedJob ? mainButton : null}
      {previewModal}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetWrap: { flex: 1, gap: 12 },
  sheetContent: { gap: 14, paddingBottom: 16 },
  sheetTitle: { ...font('semibold'), color: c.text, fontSize: 15, lineHeight: 20 },
  sheetFooter: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  wrap: { gap: RESULT_GAP },
  imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.72)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  imageErrorText: { ...font('semibold'), color: INK, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  // The main action: the studio's black pill.
  button: { borderRadius: 999 },
  buttonInner: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { ...font('semibold'), fontSize: 16, flexShrink: 1 },
  error: { ...font('regular'), color: c.danger, fontSize: 13, lineHeight: 18 },
  hint: { ...font('regular'), color: c.muted, fontSize: 12, lineHeight: 17 },
  intermediateBadge: { position: 'absolute', bottom: 10, left: 10, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  intermediateBadgeText: { ...font('semibold'), color: c.text, fontSize: 12 },
  qualityCard: { paddingVertical: 4, gap: 6 },
  qualityText: { ...font('regular'), color: c.muted, fontSize: 13, lineHeight: 18 },
  historyWrap: { gap: 10 },
  historyRow: { gap: 10, paddingRight: 4 },
  historyCard: { width: 62, gap: 4 },
  historyImageWrap: { width: 62, height: 84, borderRadius: 16, borderWidth: 2, overflow: 'hidden', position: 'relative', backgroundColor: c.surface },
  historyImage: { width: '100%', height: '100%' },
  historyImageError: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  historyImageErrorText: { ...font('medium'), color: c.muted, fontSize: 9, textAlign: 'center' },
  historyText: { ...font('regular'), color: c.muted, fontSize: 10, textAlign: 'center' },
});
