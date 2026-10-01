import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Check, X } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { SHADOWS } from '../constants/theme';
import { TryOnJob, tryOnContext } from '../services/tryOnJobs';
import { reanchorTryOnUri } from '../services/tryOnPhotos';
import { saveTryOnToGallery, shareTryOn } from '../services/tryOnExport';
import { useTryOnJobs } from './TryOnJobsContext';
import { useAiConsent } from './AiConsentContext';
import { AppPressable } from './AppPressable';
import { GenerationStage } from './GenerationStage';
import { useOverlay, useOverlayPlace } from './OverlayHost';
import { EXPECTED_TRYON_MS, tryOnStatusLabel } from './tryOnStatus';

type DockApi = { open: (jobId: string) => void };
const DockContext = createContext<DockApi>({ open: () => {} });

/** Opens a try-on in the big generation window; closing it leaves the try-on in the dock. */
export const useGenerationDock = () => useContext(DockContext);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const MINI_WIDTH = 112;
const MINI_HEIGHT = 168;
const resultOf = (job?: TryOnJob) => job?.status === 'succeeded' && job.result ? reanchorTryOnUri(job.result.imageUri) || job.result.imageUri : null;

/**
 * Try-ons live above every screen: "Try on" opens the big window, the cross
 * folds it into a small one in the corner while the look keeps generating,
 * and several looks can run at once and be leafed through there.
 */
export function GenerationDockProvider({ items, modelUri, bottom, children }: {
  items: WardrobeItem[]; modelUri?: string; bottom: number; children: ReactNode;
}) {
  const t = useT();
  const { jobs, store, login } = useTryOnJobs();
  const aiConsent = useAiConsent();
  // Try-ons in the dock, newest first; a finished one stays until it is seen.
  const [docked, setDocked] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  // When this app session first saw each try-on running, for the progress bar and the timer.
  const startedAt = useRef<Record<string, number>>({});
  for (const job of jobs) {
    if (job.status === 'pending') startedAt.current[job.id] ??= Date.now();
    else delete startedAt.current[job.id];
  }

  const open = useCallback((id: string) => {
    setDocked(previous => [id, ...previous.filter(current => current !== id)]);
    setOpenId(id);
    setActionError(null);
  }, []);
  const api = useMemo(() => ({ open }), [open]);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const dockJobs = docked.map(id => byId.get(id)).filter(Boolean) as TryOnJob[];
  const openJob = openId ? byId.get(openId) : undefined;

  const close = () => {
    setOpenId(null);
    // A finished look the user has just seen leaves the dock; a running one stays there.
    if (openJob && openJob.status !== 'pending') setDocked(previous => previous.filter(id => id !== openJob.id));
  };
  const dismiss = (id: string) => setDocked(previous => previous.filter(current => current !== id));

  const again = async (job: TryOnJob) => {
    const garments = job.itemIds.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
    if (!modelUri || !garments.length || garments.length !== job.itemIds.length) {
      setActionError(t('Некоторых вещей из этого образа уже нет в гардеробе.')); return;
    }
    if (!(await aiConsent.ensure())) return;
    setActionError(null);
    dismiss(job.id);
    try {
      const context = await tryOnContext(modelUri, garments);
      // A finished look asks for a new variant; a failed one is simply sent again.
      await store.start({ modelUri, items: garments, context, tuckMode: job.tuckMode, quality: 'quality', fresh: job.status === 'succeeded', onJob: open,
        options: job.options });
    } catch (error: any) {
      setActionError(error?.message || t('Не удалось сгенерировать примерку'));
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

  const failed = openJob && (openJob.status === 'failed' || openJob.status === 'retry');
  // The window opens over the sheet the try-on was started from (OverlayHost):
  // drawn at the app root it would never show on iOS while that sheet is up.
  const stage = openJob ? (
    <GenerationStage
      key={openJob.id}
      title={openJob.garments?.map(garment => garment.name).join(' + ') || openJob.name}
      busy={openJob.status === 'pending'}
      busyLabel={tryOnStatusLabel(openJob.progress, t)}
      startedAt={startedAt.current[openJob.id]}
      photoUri={openJob.progress?.previewUrl || modelUri || null}
      resultUri={resultOf(openJob)}
      error={actionError || (failed ? t(openJob.error || 'Не удалось сгенерировать примерку') : null)}
      warning={openJob.result?.warning ? openJob.result.warning.split(' · ').map(part => t(part)).join(' · ') : null}
      saveState={saveStates[openJob.id] || 'idle'}
      onSave={() => { void save(openJob); }}
      onShare={() => { const uri = resultOf(openJob); if (uri) void shareTryOn(uri, login); }}
      onRegenerate={() => { void again(openJob); }}
      onClose={close}
    />
  ) : null;
  const inline = useOverlay('generation-stage', stage);
  // The folded window floats over whatever is on top too: drawn under the
  // try-on sheet it could be neither seen nor reached until the sheet closed.
  const mini = dockJobs.length > 0 && !openJob ? (
    <GenerationMini jobs={dockJobs} bottom={bottom} modelUri={modelUri} startedAt={startedAt.current} onOpen={open} onDismiss={dismiss} />
  ) : null;
  const miniInline = useOverlay('generation-mini', mini);
  return (
    <DockContext.Provider value={api}>
      {children}
      {miniInline ? mini : null}
      {inline ? stage : null}
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
  mini: { position: 'absolute', right: 16, width: MINI_WIDTH, height: MINI_HEIGHT, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
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
