import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { saveTryOnToGallery, shareTryOn } from '../services/tryOnExport';
import { useTryOnJobs } from './TryOnJobsContext';
import { useAiConsent } from './AiConsentContext';
import { AppPressable } from './AppPressable';
import { GenerationStage, StagePage } from './GenerationStage';
import { ReadyBanner } from './ReadyBanner';
import { useOverlay, useOverlayPlace } from './OverlayHost';
import { EXPECTED_TRYON_MS, tryOnStatusLabel } from './tryOnStatus';

/** A look about to be tried on: the window first asks how to wear each garment. */
export type TryOnRequest = { items: WardrobeItem[]; context: string; fresh: boolean; options?: GarmentOptions };
/**
 * `leave` closes the screen the window was opened over (the try-on sheet), so
 * closing the window lands on the main screen with the small one in the corner.
 */
type DockApi = {
  open: (jobId: string, leave?: () => void) => void;
  prepare: (request: TryOnRequest) => void;
  started: (jobId: string, leave?: () => void) => void;
  /** A finished look was looked at elsewhere (the recent try-ons): it leaves the small window. */
  viewed: (jobId: string) => void;
};
const DockContext = createContext<DockApi>({ open: () => {}, prepare: () => {}, started: () => {}, viewed: () => {} });

/** Opens a try-on in the big generation window, or a new one at its setup step; closing leaves a running try-on in the dock. */
export const useGenerationDock = () => useContext(DockContext);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const MINI_WIDTH = 112;
const MINI_HEIGHT = 168;
const resultOf = (job?: TryOnJob) => job?.status === 'succeeded' && job.result ? reanchorTryOnUri(job.result.imageUri) || job.result.imageUri : null;
const titleOf = (job: TryOnJob) => job.garments?.map(garment => garment.name).join(' + ') || job.name;

/**
 * Try-ons live above every screen: "Try on" opens the big window, the cross
 * folds it into a small one in the corner while the look keeps generating,
 * and several looks can run at once and be leafed through, in the small
 * window and in the big one alike, the first look first. The moment a look
 * is ready a green banner says so, wherever the user is.
 */
export function GenerationDockProvider({ items, modelUri, bottom, children }: {
  items: WardrobeItem[]; modelUri?: string; bottom: number; children: ReactNode;
}) {
  const t = useT();
  const { jobs, store, login } = useTryOnJobs();
  const aiConsent = useAiConsent();
  // Try-ons in the dock, the first started first; a finished one stays until it is seen.
  const [docked, setDocked] = useState<string[]>([]);
  // The big window: leafing through the docked try-ons, on `initialPage` when it opens.
  const [windowOpen, setWindowOpen] = useState(false);
  const [initialPage, setInitialPage] = useState(0);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ page: number; at: number } | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  // The look being prepared in the window, before its try-on exists.
  const [setup, setSetup] = useState<(TryOnRequest & { options: GarmentOptions }) | null>(null);
  const [starting, setStarting] = useState(false);
  // One window for setup and try-ons: the key changes only when a new window opens.
  const [windowKey, setWindowKey] = useState(0);
  const [ready, setReady] = useState<{ id: string; title: string; uri: string | null; at: number } | null>(null);
  // When this app session first saw each try-on running, for the progress bar and the timer.
  const startedAt = useRef<Record<string, number>>({});
  for (const job of jobs) {
    if (job.status === 'pending') startedAt.current[job.id] ??= Date.now();
    else delete startedAt.current[job.id];
  }
  // Finished looks the user has looked at in the window: they leave the dock when it closes.
  const seen = useRef(new Set<string>());
  // Closes the sheet the window was opened over.
  const leave = useRef<(() => void) | null>(null);

  const dock = useCallback((id: string) => setDocked(previous => previous.includes(id) ? previous : [...previous, id]), []);
  const openWindow = useCallback((page: number | string, from?: () => void) => {
    if (from) leave.current = from;
    setSetup(null);
    setActionError(null);
    setInitialPage(typeof page === 'number' ? page : -1);
    setVisibleId(typeof page === 'string' ? page : null);
    setWindowOpen(true);
  }, []);
  const open = useCallback((id: string, from?: () => void) => {
    setWindowKey(key => key + 1);
    dock(id);
    openWindow(id, from);
  }, [dock, openWindow]);
  // A try-on that just started joins the dock at the end; the window shows the first look, the new one a swipe away.
  const started = useCallback((id: string, from?: () => void) => {
    dock(id);
    openWindow(0, from);
  }, [dock, openWindow]);
  const prepare = useCallback((request: TryOnRequest) => {
    setWindowKey(key => key + 1);
    setWindowOpen(false);
    setActionError(null);
    setSetup({ ...request, options: request.options || {} });
  }, []);
  const viewed = useCallback((id: string) => setDocked(previous => previous.filter(current => current !== id)), []);
  const api = useMemo(() => ({ open, prepare, started, viewed }), [open, prepare, started, viewed]);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const dockJobs = docked.map(id => byId.get(id)).filter(Boolean) as TryOnJob[];
  // A page asked for by its look (the small window, "Open the generation") becomes a number once the look is docked.
  const firstPage = initialPage >= 0 ? initialPage : Math.max(0, dockJobs.findIndex(job => job.id === visibleId));
  const visibleJob = visibleId ? byId.get(visibleId) : undefined;
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
      const show = () => setReady({ id: job.id, title: titleOf(job), uri, at: Date.now() });
      if (isRemoteUri(uri)) void Image.prefetch(uri).catch(() => false).then(show); else show();
    }
  }, [jobs]);

  const close = () => {
    const from = leave.current;
    leave.current = null;
    setSetup(null);
    setWindowOpen(false);
    // Finished looks the user has seen leave the dock; running ones and those not seen yet stay there.
    const done = new Set([...seen.current].filter(id => byId.get(id)?.status !== 'pending'));
    seen.current.clear();
    setDocked(previous => previous.filter(id => !done.has(id)));
    // The sheet closes once the window is gone: iOS takes down one modal at a time.
    if (from) setTimeout(from, 80);
  };
  const dismiss = (id: string) => setDocked(previous => previous.filter(current => current !== id));
  const focus = (id: string) => {
    const page = dockJobs.findIndex(job => job.id === id);
    if (windowOpen && page >= 0) setScrollTo({ page, at: Date.now() });
    else if (!setup) open(id);
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
    setSetup({ items: garments, context, fresh: job.status === 'succeeded', options: job.options || {} });
  };

  const generate = async () => {
    if (!setup || !modelUri || starting) return;
    if (!(await aiConsent.ensure())) return;
    setStarting(true);
    setActionError(null);
    const base = setup.items.find(item => item.section === 'Верх' && item.imageUri);
    const tuckMode: TuckMode = (base && setup.options[base.id]?.tuck) || 'auto';
    try {
      // The window stays and turns into the try-ons the moment the job exists.
      await store.start({ modelUri, items: setup.items, context: setup.context, tuckMode, quality: 'quality', fresh: setup.fresh,
        options: setup.options, onJob: id => started(id) });
    } catch (error: any) {
      setActionError(error?.message || t('Не удалось сгенерировать примерку'));
    } finally {
      setStarting(false);
    }
  };

  const save = async (job: TryOnJob) => {
    const uri = resultOf(job);
    if (!uri) return;
    setSaveStates(states => ({ ...states, [job.id]: 'saving' }));
    try {
      await saveTryOnToGallery(uri, login);
      setSaveStates(states => ({ ...states, [job.id]: 'saved' }));
    } catch (error: any) {
      setSaveStates(states => ({ ...states, [job.id]: 'error' }));
      setActionError(error?.message || t('Не удалось сохранить в галерею'));
    }
  };

  const pageOf = (job: TryOnJob): StagePage => {
    const failed = job.status === 'failed' || job.status === 'retry';
    return {
      key: job.id,
      title: titleOf(job),
      busy: job.status === 'pending',
      busyLabel: tryOnStatusLabel(job.progress, t),
      startedAt: startedAt.current[job.id],
      photoUri: job.progress?.previewUrl || modelUri || null,
      resultUri: resultOf(job),
      error: (job.id === visibleId && actionError) || (failed ? t(job.error || 'Не удалось сгенерировать примерку') : null),
      warning: job.result?.warning ? job.result.warning.split(' · ').map(part => t(part)).join(' · ') : null,
      saveState: saveStates[job.id] || 'idle',
      onSave: () => { void save(job); },
      onShare: () => { const uri = resultOf(job); if (uri) void shareTryOn(uri, login); },
      onRegenerate: () => { void again(job); },
    };
  };
  const banner = ready ? (
    <ReadyBanner key={ready.at} title={ready.title} imageUri={ready.uri} onPress={() => focus(ready.id)} onHide={() => setReady(null)} />
  ) : null;
  // The window opens over the sheet the try-on was started from (OverlayHost):
  // drawn at the app root it would never show on iOS while that sheet is up.
  const stage = setup ? (
    <GenerationStage
      key={windowKey}
      pages={[]}
      onClose={close}
      banner={banner}
      setup={{ title: setup.items.map(item => item.name).join(' + '), items: setup.items, options: setup.options, starting, error: actionError,
        onOptions: options => setSetup(current => current && { ...current, options }), onGenerate: () => { void generate(); } }}
    />
  ) : windowOpen && dockJobs.length ? (
    <GenerationStage
      key={windowKey}
      pages={dockJobs.map(pageOf)}
      initialPage={firstPage}
      scrollTo={scrollTo}
      onPageChange={page => { setVisibleId(dockJobs[page]?.id || null); setActionError(null); }}
      onClose={close}
      banner={banner}
    />
  ) : null;
  const inline = useOverlay('generation-stage', stage);
  // The folded window floats over whatever is on top too: drawn under the
  // try-on sheet it could be neither seen nor reached until the sheet closed.
  const mini = dockJobs.length > 0 && !stage ? (
    <GenerationMini jobs={dockJobs} bottom={bottom} modelUri={modelUri} startedAt={startedAt.current} onOpen={id => open(id)} onDismiss={dismiss} />
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

function GenerationMini({ jobs, bottom, modelUri, startedAt, onOpen, onDismiss }: {
  jobs: TryOnJob[]; bottom: number; modelUri?: string; startedAt: Record<string, number>;
  onOpen: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  // Over the screens it sits above the tab bar; over a sheet, at the sheet's own bottom.
  const offset = useOverlayPlace() === 'root' ? bottom : insets.bottom + 24;
  const [page, setPage] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, damping: 16, stiffness: 190, mass: 0.8, useNativeDriver: true }).start();
  }, [appear]);
  useEffect(() => { if (page > jobs.length - 1) setPage(Math.max(0, jobs.length - 1)); }, [jobs.length, page]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(event.nativeEvent.contentOffset.x / MINI_WIDTH));
  return (
    <Animated.View style={[styles.mini, SHADOWS.floating, { bottom: offset, backgroundColor: c.card, borderColor: c.border, opacity: appear,
      transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32}>
        {jobs.map(job => <MiniPage key={job.id} job={job} modelUri={modelUri} startedAt={startedAt[job.id]} onOpen={onOpen} onDismiss={onDismiss} />)}
      </ScrollView>
      {jobs.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {jobs.map((job, index) => <View key={job.id} style={[styles.dot, index === page && styles.dotActive]} />)}
        </View>
      ) : null}
    </Animated.View>
  );
}

function MiniPage({ job, modelUri, startedAt, onOpen, onDismiss }: {
  job: TryOnJob; modelUri?: string; startedAt?: number; onOpen: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const t = useT();
  const pending = job.status === 'pending';
  const result = resultOf(job);
  const failed = !pending && !result;
  const [now, setNow] = useState(Date.now());
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pending) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { loop.stop(); clearInterval(timer); };
  }, [pending, pulse]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const label = pending
    ? job.progress?.stage === 'queue' ? t('Очередь: {position}', { position: job.progress.position || 1 })
      : job.progress?.stage === 'upload' ? t('Отправка…') : clock
    : result ? t('Готово') : t('Ошибка');
  const share = startedAt ? Math.min(0.95, 1 - Math.exp(-2.2 * (now - startedAt) / EXPECTED_TRYON_MS)) : 0.05;
  const photo = result || job.progress?.previewUrl || modelUri;
  return (
    <AppPressable accessibilityRole="button" accessibilityLabel={t('Развернуть примерку: {name}', { name: job.name })}
      onPress={() => onOpen(job.id)} style={styles.page}>
      {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {pending ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil,
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }) }]} /> : null}
      <View style={styles.footer} pointerEvents="none">
        {pending ? <ActivityIndicator size={12} color="#FFFFFF" />
          : result ? <Check size={14} color="#FFFFFF" /> : <AlertCircle size={14} color="#FFFFFF" />}
        <Text style={styles.footerText} numberOfLines={1}>{label}</Text>
      </View>
      {pending ? <View style={styles.track} pointerEvents="none"><View style={[styles.bar, { width: `${Math.round(share * 100)}%` }]} /></View> : null}
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
  mini: { position: 'absolute', right: 16, width: MINI_WIDTH, height: MINI_HEIGHT, borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  page: { width: MINI_WIDTH, height: MINI_HEIGHT, overflow: 'hidden' },
  veil: { backgroundColor: '#FFFFFF' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 7, paddingTop: 16, paddingBottom: 10, backgroundColor: 'rgba(17,19,23,0.55)' },
  footerText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  bar: { height: 3, backgroundColor: '#FFFFFF' },
  dismiss: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(17,19,23,0.55)' },
  dismissFailed: { backgroundColor: 'rgba(166,61,47,0.85)' },
  dots: { position: 'absolute', top: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 12 },
});
