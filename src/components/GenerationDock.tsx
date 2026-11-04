import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Image, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Check, X } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { SHADOWS } from '../constants/theme';
import { TryOnJob, tryOnContext } from '../services/tryOnJobs';
import { TuckMode } from '../services/ai';
import { GarmentOptions } from '../domain/garmentOptions';
import { isRemoteUri, reanchorTryOnUri } from '../services/tryOnPhotos';
import { useShareChoice } from './SharePoster';
import { askReadyNotificationPermission, notifyLookReady } from '../services/readyNotification';
import { useTryOnJobs } from './TryOnJobsContext';
import { useAiConsent } from './AiConsentContext';
import { hasAiConsent } from '../services/aiConsent';
import { AppPressable } from './AppPressable';
import { GenerationStage, StagePage } from './GenerationStage';
import { FavoritesProvider, useFavorites } from './SaveLook';
import { lookFromJob, plainLook } from '../domain/favorites';
import { accessorySlot, TRYON_SECTIONS } from '../domain/accessories';
import { ReadyBanner } from './ReadyBanner';
import { useOverlay, useOverlayPlace } from './OverlayHost';
import { DevelopingImage } from './studio/DevelopingImage';
import { revealLedger } from './studio/generationReveal';
import { font, glassEdge, glassFill, useReducedMotion, SHEET_CLOSE_MS } from './studio/studio';
import { tryOnStatusLabel } from './tryOnStatus';

/** A look about to be tried on: the window first asks how to wear each garment. */
type TryOnSetup = { items: WardrobeItem[]; context: string | null; fresh: boolean; options: GarmentOptions; name: string };
type DockApi = {
  open: (jobId: string) => void;
  /** The setup step for these garments, or the try-on of them already running. Nothing is sent before its «Примерить». */
  prepare: (items: WardrobeItem[], preset?: { options?: GarmentOptions; name?: string }) => void;
  /** A finished look was looked at elsewhere (the recent try-ons): it leaves the small window. */
  viewed: (jobId: string) => void;
  /** The big window is up: what is under it is out of sight, its sweep pauses and its reveal waits. */
  windowUp: boolean;
  /** The look shown in full on the screen itself: the corner window and the «ready» banner leave it alone. */
  showingInline: (id: string | null) => void;
};
const DockContext = createContext<DockApi>({ open: () => {}, prepare: () => {}, viewed: () => {}, windowUp: false, showingInline: () => {} });

/** Opens a try-on in the big generation window, or a new one at its setup step; closing leaves a running try-on in the dock. */
export const useGenerationDock = () => useContext(DockContext);

const MINI_WIDTH = 112;
const MINI_HEIGHT = 168;
const resultOf = (job?: TryOnJob) => job?.status === 'succeeded' && job.result ? reanchorTryOnUri(job.result.imageUri) || job.result.imageUri : null;
const garmentsName = (items: { name: string }[]) => items.map(item => item.name).join(' + ');
const titleOf = (job: TryOnJob) => job.name || garmentsName(job.garments || []);

/**
 * Try-ons live above every screen: "Try on" opens the big window, the cross
 * folds it into a small one in the corner while the look keeps generating,
 * and several looks can run at once and be leafed through, in the small
 * window and in the big one alike, the first look first. The moment a look
 * is ready a green banner says so, wherever the user is.
 */
export function GenerationDockProvider({ items, modelUri, bottom, initialDocked, children }: {
  items: WardrobeItem[]; modelUri?: string; bottom: number;
  /** The try-on of the first minute the user went on waiting for in the app. If it finished meanwhile it still shows here, ready to open. */
  initialDocked?: string;
  children: ReactNode;
}) {
  const t = useT();
  const { jobs, store, login, ready: jobsReady, readOnly, error: journalError } = useTryOnJobs();
  const aiConsent = useAiConsent();
  // Try-ons in the dock, the first started first; a finished one stays until it is seen.
  const [docked, setDocked] = useState<string[]>(() => initialDocked ? [initialDocked] : []);
  // The big window: leafing through the docked try-ons, on `initialPage` when it opens.
  const [windowOpen, setWindowOpen] = useState(false);
  const [initialPage, setInitialPage] = useState(0);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ page: number; at: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The look being prepared in the window, before its try-on exists.
  const [setup, setSetup] = useState<TryOnSetup | null>(null);
  const [starting, setStarting] = useState(false);
  // One window for setup and try-ons: the key changes only when a new window opens.
  const [windowKey, setWindowKey] = useState(0);
  const [ready, setReady] = useState<{ id: string; title: string; uri: string | null; at: number } | null>(null);
  // When this app session first saw each try-on running, for the progress bar and the timer.
  const startedAt = useRef<Record<string, number>>({});
  for (const job of jobs) {
    // Seen running in this session: its reveal is owed, wherever the user is when it finishes.
    if (job.status === 'pending') { startedAt.current[job.id] ??= Date.now(); revealLedger.track(job.id); }
    else delete startedAt.current[job.id];
  }
  // Finished looks the user has looked at in the window: they leave the dock when it closes.
  const seen = useRef(new Set<string>());

  const dock = useCallback((id: string) => setDocked(previous => previous.includes(id) ? previous : [...previous, id]), []);
  const openWindow = useCallback((page: number | string) => {
    setSetup(null);
    setActionError(null);
    setInitialPage(typeof page === 'number' ? page : -1);
    setVisibleId(typeof page === 'string' ? page : null);
    setWindowOpen(true);
  }, []);
  // The same try-on when its id came only after the app had opened.
  useEffect(() => { if (initialDocked) dock(initialDocked); }, [initialDocked, dock]);
  const open = useCallback((id: string) => {
    setWindowKey(key => key + 1);
    dock(id);
    openWindow(id);
  }, [dock, openWindow]);
  // A try-on that just started joins the dock at the end; the window shows the first look, the new one a swipe away.
  const started = useCallback((id: string) => {
    dock(id);
    openWindow(0);
  }, [dock, openWindow]);
  const prepare = useCallback((garments: WardrobeItem[], preset?: { options?: GarmentOptions; name?: string }) => {
    void (async () => {
      // Asked before the window, not from its button: iOS would not show a window opened beside it, and the button would wait for ever.
      const asked = !(await hasAiConsent(login));
      if (!(await aiConsent.ensure())) return;
      // The closing consent window is out of the way first: iOS takes down one modal at a time.
      if (asked) await new Promise(resolve => setTimeout(resolve, 400));
      const context = await tryOnContext(modelUri || '', garments).catch(() => null);
      const known = store.getSnapshot().jobs.filter(job => job.context === context);
      const running = known.find(job => job.status === 'pending');
      if (running) { open(running.id); return; }
      setWindowKey(key => key + 1);
      setWindowOpen(false);
      setActionError(null);
      // Tried on before: the server is asked for a new variant, not the layers it kept.
      setSetup({ items: garments, context, fresh: known.some(job => job.status === 'succeeded'), options: preset?.options || {}, name: preset?.name || '' });
    })();
  }, [modelUri, store, open, aiConsent.ensure, login]);
  // A try-on that finished while the app slept is fetched as it wakes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') for (const job of store.getSnapshot().jobs) if (job.status === 'retry') void store.poll(job);
    });
    return () => subscription.remove();
  }, [store]);
  const viewed = useCallback((id: string) => { revealLedger.forget(id); setDocked(previous => previous.filter(current => current !== id)); }, []);
  const windowUp = windowOpen || Boolean(setup);
  const [inlineId, setInlineId] = useState<string | null>(null);
  const inlineRef = useRef<string | null>(null);
  const showingInline = useCallback((id: string | null) => { inlineRef.current = id; setInlineId(id); }, []);
  const api = useMemo(() => ({ open, prepare, viewed, windowUp, showingInline }), [open, prepare, viewed, windowUp, showingInline]);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const dockJobs = docked.map(id => byId.get(id)).filter(Boolean) as TryOnJob[];
  // A page asked for by its look (the small window, "Open the generation") becomes a number once the look is docked.
  const firstPage = initialPage >= 0 ? initialPage : Math.max(0, dockJobs.findIndex(job => job.id === visibleId));
  // The page on screen: named by a swipe or a look, else the first the window opened on.
  const shownId = visibleId || dockJobs[firstPage]?.id || null;
  const visibleJob = shownId ? byId.get(shownId) : undefined;
  useEffect(() => {
    if (windowOpen && visibleJob && visibleJob.status !== 'pending') seen.current.add(visibleJob.id);
  }, [windowOpen, visibleJob?.id, visibleJob?.status]);

  // "The look is ready" the moment a running try-on's picture is in.
  const lastStatus = useRef(new Map<string, TryOnJob['status']>());
  useEffect(() => {
    for (const job of jobs) {
      const before = lastStatus.current.get(job.id);
      lastStatus.current.set(job.id, job.status);
      const uri = resultOf(job);
      if (before !== 'pending' || job.status !== 'succeeded' || !uri) continue;
      void notifyLookReady(t('Образ готов'), t('Загляни посмотреть, как получилось.'));
      // It is revealing right there on the screen: nothing lands on top of that moment.
      if (inlineRef.current === job.id) continue;
      const show = () => setReady({ id: job.id, title: titleOf(job), uri, at: Date.now() });
      if (isRemoteUri(uri)) void Image.prefetch(uri).catch(() => false).then(show); else show();
    }
  }, [jobs]);

  const close = () => {
    setSetup(null);
    setWindowOpen(false);
    // Finished looks the user has seen leave the dock; running ones and those not seen yet stay there.
    const done = new Set([...seen.current].filter(id => byId.get(id)?.status !== 'pending'));
    seen.current.clear();
    setDocked(previous => previous.filter(id => !done.has(id)));
  };
  const dismiss = (id: string) => setDocked(previous => previous.filter(current => current !== id));
  const focus = (id: string) => {
    const page = dockJobs.findIndex(job => job.id === id);
    if (windowOpen && page >= 0) setScrollTo({ page, at: Date.now() });
    // Over the setup step the finished look opens in its place (the setup's choices are not lost: «Ещё вариант» brings
    // them back); only while a try-on is being started from it does the tap wait for that one.
    else if (!starting) open(id);
  };

  // "Another variant" goes back to the setup step in the same window, with the choices of this one.
  const again = async (job: TryOnJob) => {
    const garments = job.itemIds.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
    if (!modelUri || !garments.length || garments.length !== job.itemIds.length) {
      setActionError(t('Некоторых вещей из этого образа уже нет в гардеробе.')); return;
    }
    const context = await tryOnContext(modelUri, garments);
    if (job.status !== 'pending') dismiss(job.id);
    setActionError(null);
    // A finished look asks for a new variant; a failed one is simply sent again.
    setSetup({ items: garments, context, fresh: job.status === 'succeeded', options: job.options || {}, name: job.name === garmentsName(garments) ? '' : job.name });
  };

  const generate = async () => {
    if (!setup || !setup.context || !modelUri || starting) return;
    // Withdrawn since the step opened: the consent window can't show beside this one, so it steps aside and comes back after the answer.
    if (!(await hasAiConsent(login))) {
      const { items: garments, options, name } = setup;
      setSetup(null);
      setTimeout(() => prepare(garments, { options, name }), SHEET_CLOSE_MS);
      return;
    }
    void askReadyNotificationPermission(t('Готовые образы'));
    setStarting(true);
    setActionError(null);
    const base = setup.items.find(item => item.section === 'Верх' && item.imageUri);
    const tuckMode: TuckMode = (base && setup.options[base.id]?.tuck) || 'auto';
    try {
      // The window stays and turns into the try-ons the moment the job exists.
      await store.start({ modelUri, items: setup.items, context: setup.context, tuckMode, quality: 'quality', fresh: setup.fresh,
        options: setup.options, name: setup.name.trim() || undefined, onJob: id => started(id) });
    } catch (error: any) {
      setActionError(error?.message ? t(String(error.message)) : t('Примерка не получилась. Попробуй ещё раз.'));
    } finally {
      setStarting(false);
    }
  };

  const sharing = useShareChoice(login);
  // The root outlet draws the window above the favourites' provider: they are handed on to it.
  const favorites = useFavorites();
  // The share sheet lives in the window: a request left behind would pop up when the window next opens.
  const showsPages = windowOpen && !setup;
  useEffect(() => { if (!showsPages) sharing.clear(); }, [showsPages]);
  const pageOf = (job: TryOnJob): StagePage => {
    const failed = job.status === 'failed' || job.status === 'retry';
    return {
      key: job.id,
      title: titleOf(job),
      busy: job.status === 'pending',
      busyLabel: tryOnStatusLabel(job.progress, t),
      stage: job.progress?.stage,
      items: job.itemIds.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[],
      sourceUri: job.sourceUri || null,
      startedAt: startedAt.current[job.id],
      photoUri: job.progress?.previewUrl || modelUri || null,
      resultUri: resultOf(job),
      error: (job.id === shownId && actionError) || (failed ? t(job.error || 'Примерка не получилась. Попробуй ещё раз.') : null),
      warning: job.result?.warning ? job.result.warning.split(' · ').map(part => t(part)).join(' · ') : null,
      favorite: job.result && job.status !== 'pending' ? lookFromJob(job) : null,
      onCheck: job.status === 'retry' ? () => { void store.poll(job); } : undefined,
      onShare: () => { const uri = resultOf(job); if (uri) sharing.offer({ uri, title: titleOf(job), items: job.itemIds.flatMap(id => items.filter(item => item.id === id)) }); },
      onRegenerate: () => { void again(job); },
    };
  };
  const banner = ready ? (
    <ReadyBanner key={ready.at} title={ready.title} imageUri={ready.uri} onPress={() => focus(ready.id)} onHide={() => setReady(null)} />
  ) : null;
  // The window opens over the sheet the try-on was started from (OverlayHost):
  // drawn at the app root it would never show on iOS while that sheet is up.
  const setupName = setup ? garmentsName(setup.items) : '';
  const fits = (item: WardrobeItem) => Boolean(item.imageUri) && TRYON_SECTIONS.includes(item.section) && (item.section !== 'Аксессуары' || Boolean(accessorySlot(item)));
  const stage = setup ? (
    <FavoritesProvider value={favorites}><GenerationStage
      key={windowKey}
      pages={[]}
      onClose={close}
      banner={banner}
      setup={{ title: setupName, items: setup.items, options: setup.options, starting, error: actionError || (journalError ? t(journalError) : null),
        // What stands in the way is said here: the button below stays dim until it is solved.
        warnings: [
          !modelUri ? t('Добавь фото в полный рост в профиле.') : null,
          !setup.items.some(fits) ? t('Выбери вещь с фото для примерки.') : null,
          setup.items.some(item => !item.imageUri) ? t('Вещи без фото не участвуют в примерке.') : null,
          setup.items.some(item => item.imageUri && !fits(item)) ? t('Эту вещь пока нельзя примерить.') : null
        ].filter(Boolean) as string[],
        canGenerate: Boolean(modelUri && setup.context && jobsReady && !readOnly && setup.items.some(fits)),
        name: setup.name, namePlaceholder: setup.items.length === 1 ? setup.items[0].name : t('Название образа'),
        onName: name => setSetup(current => current && { ...current, name }),
        // Saved before any try-on: the pieces alone, under the name given here.
        look: plainLook(`fitting-${setup.items.map(item => item.id).join('-')}`, setup.name.trim() || setupName, setup.items.map(item => item.id)),
        onOptions: options => setSetup(current => current && { ...current, options }), onGenerate: () => { void generate(); } }}
    /></FavoritesProvider>
  ) : windowOpen && dockJobs.length ? (
    <FavoritesProvider value={favorites}><GenerationStage
      key={windowKey}
      pages={dockJobs.map(pageOf)}
      initialPage={firstPage}
      scrollTo={scrollTo}
      onPageChange={page => { setVisibleId(dockJobs[page]?.id || null); setActionError(null); }}
      onClose={close}
      // Inside the window's modal, as the banner: iOS shows a sheet only from the screen on top.
      banner={<>{banner}{sharing.sheet}</>}
    /></FavoritesProvider>
  ) : null;
  const inline = useOverlay('generation-stage', stage);
  // The folded window floats over whatever is on top too: drawn under the
  // try-on sheet it could be neither seen nor reached until the sheet closed.
  const miniJobs = dockJobs.filter(job => job.id !== inlineId);
  const mini = miniJobs.length > 0 && !stage ? (
    <GenerationMini jobs={miniJobs} items={items} bottom={bottom} modelUri={modelUri} startedAt={startedAt.current} onOpen={id => open(id)} onDismiss={dismiss} />
  ) : null;
  const miniInline = useOverlay('generation-mini', mini);
  // Over the screens the banner comes through the overlay host too; over the window, inside it.
  const toast = stage ? null : banner;
  const toastInline = useOverlay('generation-ready', toast);
  return (
    <DockContext.Provider value={api}>
      {children}
      {miniInline ? mini : null}
      {inline ? stage : null}
      {toastInline ? toast : null}
    </DockContext.Provider>
  );
}

function GenerationMini({ jobs, items, bottom, modelUri, startedAt, onOpen, onDismiss }: {
  jobs: TryOnJob[]; items: WardrobeItem[]; bottom: number; modelUri?: string; startedAt: Record<string, number>;
  onOpen: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  // Over the screens it sits above the tab bar; over a sheet, at the sheet's own bottom.
  const offset = useOverlayPlace() === 'root' ? bottom : insets.bottom + 24;
  const [page, setPage] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) appear.setValue(1);
    else Animated.spring(appear, { toValue: 1, damping: 16, stiffness: 190, mass: 0.8, useNativeDriver: true }).start();
  }, [appear, reduced]);
  useEffect(() => { if (page > jobs.length - 1) setPage(Math.max(0, jobs.length - 1)); }, [jobs.length, page]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(event.nativeEvent.contentOffset.x / MINI_WIDTH));
  return (
    <Animated.View style={[styles.mini, SHADOWS.floating, { bottom: offset, backgroundColor: glassFill(isDark), borderColor: glassEdge(isDark), opacity: appear,
      transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32}>
        {jobs.map((job, index) => <MiniPage key={job.id} job={job} items={items} visible={index === page} modelUri={modelUri} startedAt={startedAt[job.id]} onOpen={onOpen} onDismiss={onDismiss} />)}
      </ScrollView>
      {jobs.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {jobs.map((job, index) => <View key={job.id} style={[styles.dot, index === page && styles.dotActive]} />)}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** The small window: the same placeholder and the same reveal, with the status cut down to its clock. */
function MiniPage({ job, items, visible, modelUri, startedAt, onOpen, onDismiss }: {
  job: TryOnJob; items: WardrobeItem[]; visible: boolean; modelUri?: string; startedAt?: number; onOpen: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const t = useT();
  const { isDark } = useTheme();
  const pending = job.status === 'pending';
  const result = resultOf(job);
  const failed = !pending && !result;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const label = pending
    ? job.progress?.stage === 'queue' ? t('Очередь: {position}', { position: job.progress.position || 1 })
      : job.progress?.stage === 'upload' ? t('Отправка…') : clock
    : result ? t('Готово') : t('Не вышло');
  const photo = job.progress?.previewUrl || modelUri || null;
  return (
    <AppPressable accessibilityRole="button" accessibilityLabel={t('Развернуть примерку: {name}', { name: job.name })}
      onPress={() => onOpen(job.id)} style={styles.page}>
      <DevelopingImage surface="mini" revealKey={job.id} photoUri={photo} resultUri={result} developing={pending} isDark={isDark} active={visible}>
        {result ? <Image source={{ uri: result }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      </DevelopingImage>
      <View style={styles.footer} pointerEvents="none">
        {pending ? <ActivityIndicator size={12} color="#FFFFFF" />
          : result ? <Check size={14} color="#FFFFFF" /> : <AlertCircle size={14} color="#FFFFFF" />}
        <Text style={styles.footerText} numberOfLines={1}>{label}</Text>
      </View>
      {!pending ? (
        <AppPressable accessibilityRole="button" accessibilityLabel={t('Убрать из списка')} hitSlop={8}
          onPress={() => onDismiss(job.id)} style={[styles.dismiss, failed && styles.dismissFailed]}>
          <X size={12} color="#FFFFFF" />
        </AppPressable>
      ) : null}
    </AppPressable>
  );
}

const styles = StyleSheet.create({
  // A photo frame of the studio: 24 radius, glass ground and its light edge.
  mini: { position: 'absolute', right: 16, width: MINI_WIDTH, height: MINI_HEIGHT, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  page: { width: MINI_WIDTH, height: MINI_HEIGHT, overflow: 'hidden' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingTop: 16, paddingBottom: 11, backgroundColor: 'rgba(18,20,23,0.5)' },
  footerText: { ...font('semibold'), color: '#FFFFFF', fontSize: 12, lineHeight: 16, flexShrink: 1 },
  dismiss: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(18,20,23,0.5)', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'rgba(255,255,255,0.35)' },
  dismissFailed: { backgroundColor: 'rgba(166,61,47,0.85)' },
  dots: { position: 'absolute', top: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 12 },
});
