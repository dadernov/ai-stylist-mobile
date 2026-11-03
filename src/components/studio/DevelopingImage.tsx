import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from './studio';

type Props = {
  /** The photo being dressed: shown deeply blurred while the look "develops". */
  photoUri: string | null;
  /** The finished look; when it arrives it resolves from blur to sharp, top to bottom. */
  resultUri: string | null;
  developing: boolean;
  isDark: boolean;
  /** The sharp result once revealed (e.g. a zoomable image). */
  children?: React.ReactNode;
  /** The page is the one on screen: a look that finished on another page waits to be revealed until it is leafed to. */
  active?: boolean;
  /** The photo the look was made from, for the before/after wipe; without it there is no comparison. */
  beforeUri?: string | null;
  /** The user asks to see the photo before the try-on. */
  showBefore?: boolean;
  /** The sharp reveal of a look that just finished begins (not a look reopened later). */
  onRevealStart?: () => void;
};

const REVEAL_MS = 1200;
const FEATHER = 90;
const GLINT_MS = 700;
// The automatic peek at the source photo: there, a look, and back, about 1.5 s in all.
const WIPE_MS = 520;
const WIPE_HOLD_MS = 460;

/**
 * A picture that develops like a photograph, after ChatGPT's image generation:
 * a soft blurred field of the photo with slowly drifting light while it works,
 * then the finished look sharpens in a band that travels from top to bottom.
 * A soft glint crosses the finished look, then a slider wipes to the source photo and back.
 * With reduced motion the field stays still, the look simply crossfades, and the glint and the peek are skipped.
 */
export function DevelopingImage({ photoUri, resultUri, developing, isDark, children, active = true, beforeUri, showBefore = false, onRevealStart }: Props) {
  const reduced = useReducedMotion();
  const drift = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const haze = useRef(new Animated.Value(resultUri && !developing ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(resultUri && !developing ? 1 : 0)).current;
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
  const [revealed, setRevealed] = useState(Boolean(resultUri) && !developing);
  const done = Boolean(resultUri) && !developing;

  useEffect(() => {
    if (!developing || reduced) return;
    const a = Animated.loop(Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [developing, reduced, drift, breathe]);

  useEffect(() => {
    if (!done) { haze.setValue(0); sweep.setValue(0); setRevealed(false); return; }
    if (revealed || !active) return;
    revealStart.current?.();
    if (reduced) {
      Animated.timing(haze, { toValue: 1, duration: 300, useNativeDriver: false }).start();
      sweep.setValue(1);
      setRevealed(true);
      return;
    }
    ceremony.current = true;
    Animated.parallel([
      Animated.timing(haze, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(sweep, { toValue: 1, duration: REVEAL_MS, delay: 120, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]).start(({ finished }) => { if (finished) setRevealed(true); });
  }, [done, active]);

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
  // The sharp band: grows from the top, with a feathered lower edge.
  const clip = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, tall + FEATHER] });

  return (
    <View style={StyleSheet.absoluteFill} onLayout={measure}>
      {/* The developing field: the photo dissolved into colour, light drifting over it. */}
      {photoUri ? <Image source={{ uri: photoUri }} blurRadius={28} style={[StyleSheet.absoluteFill, { opacity: 0.85 }]} resizeMode="cover" /> : null}
      {!revealed ? (
        <Animated.View pointerEvents="none" style={[styles.field, { opacity: reduced ? 0.7 : breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [{ translateX: shiftX }, { translateY: shiftY }] }]}>
          <LinearGradient colors={[glow, tint, glow, tint]} locations={[0, 0.35, 0.65, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {resultUri ? (
        <>
          {/* First the look arrives as a soft blur … */}
          {!revealed ? <Animated.Image source={{ uri: resultUri }} blurRadius={22} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: haze }]} /> : null}
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
