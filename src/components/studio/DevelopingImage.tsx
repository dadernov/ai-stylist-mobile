import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from './studio';
import { FogBoundary, GenerationFog } from './GenerationFog';
import { fogPalette, fogSeed, PREFETCH_LIMIT_MS, REVEAL_WATCHDOG_MS, RevealSurface, revealLedger } from './generationFog';
import { loadFog } from './skiaModule';

type Props = {
  /** The photo being dressed: shown deeply blurred while the look "develops". */
  photoUri: string | null;
  /** The finished look; when it arrives it comes through the fog, top to bottom. */
  resultUri: string | null;
  developing: boolean;
  isDark: boolean;
  /** The sharp result once revealed (e.g. a zoomable image). */
  children?: React.ReactNode;
  /** The view is the one on screen: the fog pauses otherwise, and a look that finished meanwhile waits to be revealed until it is seen. */
  active?: boolean;
  /** The photo the look was made from, for the before/after wipe; without it there is no comparison. */
  beforeUri?: string | null;
  /** The user asks to see the photo before the try-on. */
  showBefore?: boolean;
  /** The sharp reveal of a look that just finished begins (not a look reopened later). */
  onRevealStart?: () => void;
  /** The look stands revealed, played or already seen. */
  onRevealEnd?: () => void;
  /** The try-on's id: the same fog in every window, and its reveal played once per surface wherever it finished. */
  revealKey?: string;
  /** 'mini': the small window, the same fog and reveal without the glint and the peek. */
  surface?: RevealSurface;
  /** The look's garments, tinting the fog. */
  items?: { color?: string; tags?: string[] }[];
};

const REVEAL_MS = 1200;
const FEATHER = 90;
const GLINT_MS = 700;
// The automatic peek at the source photo: there, a look, and back, about 1.5 s in all.
const WIPE_MS = 520;
const WIPE_HOLD_MS = 460;

/**
 * The one picture of a try-on being made, in every window: the photo dissolved under a volume of drifting light (GenerationFog),
 * then the fog thickens and parts from the top, and the finished look comes through it.
 * A soft glint crosses the finished look, then a slider wipes to the source photo and back.
 * With reduced motion the fog is one still frame, the look simply crossfades, and the glint and the peek are skipped.
 * Without Skia (web, an old build) a drifting gradient and a sharpening band stand in.
 */
export function DevelopingImage({ photoUri, resultUri, developing, isDark, children, active = true, beforeUri, showBefore = false, onRevealStart, onRevealEnd, revealKey, surface = 'full', items }: Props) {
  const reduced = useReducedMotion();
  const [fogFailed, setFogFailed] = useState(false);
  const fog = fogFailed ? null : loadFog();
  const done = Boolean(resultUri) && !developing;
  // Seen running: its reveal is owed here, even if it finishes while nobody is looking.
  if (revealKey && !done) revealLedger.track(revealKey);
  const drift = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const owedAtMount = useRef(done && Boolean(revealKey) && revealLedger.owes(revealKey!, surface)).current;
  const haze = useRef(new Animated.Value(done && !owedAtMount ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(done && !owedAtMount ? 1 : 0)).current;
  const glint = useRef(new Animated.Value(0)).current;
  const wipe = useRef(new Animated.Value(showBefore ? 1 : 0)).current;
  const [tall, setTall] = useState(0);
  const [wide, setWide] = useState(0);
  // Set when a reveal plays: the glint and the peek belong to it, not to a finished look reopened later.
  const ceremony = useRef(false);
  const peekRunning = useRef<(() => void) | null>(null);
  const showBeforeRef = useRef(showBefore);
  showBeforeRef.current = showBefore;
  const revealStart = useRef(onRevealStart);
  revealStart.current = onRevealStart;
  const revealEnd = useRef(onRevealEnd);
  revealEnd.current = onRevealEnd;
  const [revealed, setRevealed] = useState(done && !owedAtMount);
  const [fogRevealing, setFogRevealing] = useState(false);
  // The fog has closed over the photo: only the fog and the look under it are left.
  const [covered, setCovered] = useState(false);
  const useFog = Boolean(fog) && !reduced;
  // Neither running nor finished (a failed try-on, one waiting for a retry): just the photo, still and sharp.
  const inFog = developing || done;
  const seed = useMemo(() => fogSeed(revealKey), [revealKey]);
  const tintKey = (items || []).map(item => `${item.color}|${(item.tags || []).join()}`).join(';');
  const tints = useMemo(() => fogPalette(items || [], isDark), [tintKey, isDark]);

  // The stand-in's drift; the fog has its own clock.
  useEffect(() => {
    if (!developing || reduced || fog || !active) return;
    const a = Animated.loop(Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [developing, reduced, drift, breathe, Boolean(fog), active]);

  useEffect(() => {
    if (!done) { haze.setValue(0); sweep.setValue(0); setRevealed(false); setFogRevealing(false); setCovered(false); return; }
    if (revealed || !active) return;
    // Played on another screen meanwhile: the look just stands here.
    if (revealKey && !revealLedger.owes(revealKey, surface)) { haze.setValue(1); sweep.setValue(1); setRevealed(true); return; }
    if (revealKey) revealLedger.settle(revealKey, surface);
    revealStart.current?.();
    if (reduced) {
      Animated.timing(haze, { toValue: 1, duration: 300, useNativeDriver: false }).start(({ finished }) => { if (finished) setRevealed(true); });
      sweep.setValue(1);
      return;
    }
    if (surface === 'full') ceremony.current = true;
    if (useFog) {
      let cancelled = false;
      const go = () => { if (!cancelled) setFogRevealing(true); };
      const limit = setTimeout(go, PREFETCH_LIMIT_MS);
      void (resultUri && /^https?:/i.test(resultUri) ? Image.prefetch(resultUri).catch(() => false) : Promise.resolve(true)).then(() => { clearTimeout(limit); go(); });
      return () => { cancelled = true; clearTimeout(limit); };
    }
    Animated.parallel([
      Animated.timing(haze, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(sweep, { toValue: 1, duration: REVEAL_MS, delay: 120, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]).start(({ finished }) => { if (finished) setRevealed(true); });
  }, [done, active, fogFailed]);

  // Whatever happens to the fog, a finished look on screen does not stay behind it.
  const showNow = () => { haze.stopAnimation(); sweep.stopAnimation(); haze.setValue(1); sweep.setValue(1); setRevealed(true); };
  useEffect(() => {
    if (!done || !active || revealed) return;
    const watchdog = setTimeout(showNow, REVEAL_WATCHDOG_MS);
    return () => clearTimeout(watchdog);
  }, [done, active, revealed]);

  useEffect(() => { if (revealed) revealEnd.current?.(); }, [revealed]);

  // After the reveal: the glint, then the peek. Leafing away ends them and puts the look back.
  useEffect(() => {
    if (!revealed || !active || !ceremony.current || reduced) return;
    ceremony.current = false;
    glint.setValue(0);
    const peek = beforeUri && !showBeforeRef.current ? [
      Animated.timing(wipe, { toValue: 1, duration: WIPE_MS, delay: 200, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.delay(WIPE_HOLD_MS),
      Animated.timing(wipe, { toValue: 0, duration: WIPE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ] : [];
    const glintRun = Animated.timing(glint, { toValue: 1, duration: GLINT_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const peekRun = Animated.sequence(peek);
    let cancelled = false;
    peekRunning.current = () => { cancelled = true; peekRun.stop(); };
    glintRun.start(({ finished }) => { if (finished && !cancelled) peekRun.start(); });
    return () => { cancelled = true; glintRun.stop(); peekRun.stop(); glint.setValue(1); wipe.setValue(showBeforeRef.current ? 1 : 0); };
  }, [revealed, active]);

  // The manual before/after: it takes over from the peek wherever that is.
  const firstCompare = useRef(true);
  useEffect(() => {
    if (firstCompare.current) { firstCompare.current = false; return; }
    peekRunning.current?.();
    wipe.stopAnimation();
    if (reduced) wipe.setValue(showBefore ? 1 : 0);
    else Animated.timing(wipe, { toValue: showBefore ? 1 : 0, duration: 360, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
  }, [showBefore]);

  const measure = (event: LayoutChangeEvent) => { setTall(event.nativeEvent.layout.height); setWide(event.nativeEvent.layout.width); };
  const glow = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)';
  const tint = isDark ? 'rgba(160,170,190,0.16)' : 'rgba(200,190,230,0.28)';
  const shiftX = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-40, 40, -40] });
  const shiftY = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [30, -30, 30] });
  // The sharp band of the stand-in: grows from the top, with a feathered lower edge.
  const clip = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, tall + FEATHER] });
  const photo = photoUri ? <Image source={{ uri: photoUri }} blurRadius={inFog ? 28 : 0} style={[StyleSheet.absoluteFill, { opacity: inFog ? 0.85 : 1 }]} resizeMode="cover" /> : null;
  // Reduced motion keeps the still fog with the crossfade; once revealed nothing of the fog is left.
  const showFog = Boolean(fog) && inFog && !revealed && wide > 0;
  const fogLayer = showFog && fog ? (
    <FogBoundary onError={() => { setFogFailed(true); if (done) showNow(); }}>
      <GenerationFog fog={fog} width={wide} height={tall} seed={seed} tints={tints} isDark={isDark}
        running={active && !reduced && developing} revealing={fogRevealing}
        onCovered={() => setCovered(true)} onRevealed={() => setRevealed(true)} />
    </FogBoundary>
  ) : null;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={measure}>
      {useFog && resultUri && done ? (
        // The look waits under the photo and the fog; the fog closes over the photo, the photo goes, the fog parts.
        <View pointerEvents={revealed ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>{children}</View>
      ) : null}
      {/* The developing field: the photo dissolved into colour, light drifting over it. */}
      {useFog && done && (covered || revealed) ? null : photo}
      {!fog && inFog && !revealed ? (
        <Animated.View pointerEvents="none" style={[styles.field, { opacity: reduced ? 0.7 : breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [{ translateX: shiftX }, { translateY: shiftY }] }]}>
          <LinearGradient colors={[glow, tint, glow, tint]} locations={[0, 0.35, 0.65, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {useFog ? fogLayer : (
        <>
          {reduced ? fogLayer : null}
          {resultUri ? (
            <>
              {/* First the look arrives as a soft blur … */}
              {!revealed && !reduced ? <Animated.Image source={{ uri: resultUri }} blurRadius={22} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: haze }]} /> : null}
              {/* … then sharpens from the top down. */}
              {revealed || reduced ? (
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: reduced && !revealed ? haze : 1 }]}>{children}</Animated.View>
              ) : (
                <Animated.View pointerEvents="none" style={[styles.band, { height: clip }]}>
                  <View style={{ height: tall }}>{children}</View>
                  <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', isDark ? 'rgba(30,32,36,0.6)' : 'rgba(255,255,255,0.6)']}
                    style={[styles.feather, { top: undefined, bottom: 0 }]} />
                </Animated.View>
              )}
            </>
          ) : null}
        </>
      )}
      {/* The glint, above the look and never in the way of its gestures. */}
      {revealed && !reduced && wide ? (
        <Animated.View pointerEvents="none" style={[styles.glint, { width: wide * 0.45, opacity: glint.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateX: glint.interpolate({ inputRange: [0, 1], outputRange: [-wide * 0.6, wide * 1.15] }) }, { rotate: '14deg' }] }]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {/* Before/after: the source photo slides over the look from the left edge, its edge a thin bright line. */}
      {revealed && beforeUri && wide ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.before, { width: wipe.interpolate({ inputRange: [0, 1], outputRange: [0, wide] }) }]}>
            {/* The look's own rect, filled: if the shapes differ the photo is cropped, never framed, so the wipe lines up. */}
            <View style={{ width: wide, height: tall }}>
              <Image source={{ uri: beforeUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
            </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.wipeEdge, { left: wipe.interpolate({ inputRange: [0, 1], outputRange: [0, wide] }),
            opacity: wipe.interpolate({ inputRange: [0, 0.02, 0.98, 1], outputRange: [0, 1, 1, 0] }) }]} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { position: 'absolute', top: -60, bottom: -60, left: -60, right: -60 },
  band: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  glint: { position: 'absolute', top: '-15%', bottom: '-15%', left: 0 },
  before: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  wipeEdge: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: '#FFFFFF' },
  feather: { position: 'absolute', left: 0, right: 0, height: FEATHER },
});
