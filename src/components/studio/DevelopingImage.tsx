import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useReducedMotion } from './studio';
import { GenerationPlaceholder } from './GenerationPlaceholder';
import { PREFETCH_LIMIT_MS, placeholderFill, REVEAL_BLUR_IN_MS, REVEAL_SHARPEN_DELAY_MS, REVEAL_SHARPEN_MS, REVEAL_WATCHDOG_MS, RevealSurface, revealLedger, revealStrips, stripOpacity } from './generationReveal';

type Props = {
  /** The photo being dressed: shown only where nothing is running (a failed try-on, one waiting for a retry). */
  photoUri: string | null;
  /** The finished look; when it arrives it comes out of a blur, sharpening top to bottom. */
  resultUri: string | null;
  developing: boolean;
  isDark: boolean;
  /** The sharp result once revealed (e.g. a zoomable image). */
  children?: React.ReactNode;
  /** The view is the one on screen: the sweep pauses otherwise, and a look that finished meanwhile waits to be revealed until it is seen. */
  active?: boolean;
  /** The photo the look was made from, for the before/after wipe; without it there is no comparison. */
  beforeUri?: string | null;
  /** The user asks to see the photo before the try-on. */
  showBefore?: boolean;
  /** The sharp reveal of a look that just finished begins (not a look reopened later). */
  onRevealStart?: () => void;
  /** The look stands revealed, played or already seen. */
  onRevealEnd?: () => void;
  /** The try-on's id: its reveal played once per surface wherever it finished. */
  revealKey?: string;
  /** 'mini': the small window, the same placeholder and reveal without the peek. */
  surface?: RevealSurface;
  /** How the result sits in this frame, the same as `children`, so nothing moves when they take over. */
  fit?: 'contain' | 'cover';
};

const BLUR = 20;
// The automatic peek at the source photo: there, a look, and back, about 1.5 s in all.
const WIPE_MS = 520;
const WIPE_HOLD_MS = 460;

/**
 * The one picture of a try-on being made, in every window: a grey placeholder in the picture's shape with light crossing it;
 * then the look fades in deeply blurred and sharpens from the top down, band after band, on the UI thread. A slider then wipes to the source photo and back.
 * With reduced motion the placeholder stands still, the look crossfades, and the peek is skipped.
 * Nothing here is native-only: the web draws the same.
 */
export function DevelopingImage({ photoUri, resultUri, developing, isDark, children, active = true, beforeUri, showBefore = false, onRevealStart, onRevealEnd, revealKey, surface = 'full', fit = 'contain' }: Props) {
  const reduced = useReducedMotion();
  const done = Boolean(resultUri) && !developing;
  // Seen running: its reveal is owed here, even if it finishes while nobody is looking.
  if (revealKey && !done) revealLedger.track(revealKey);
  const owedAtMount = useRef(done && Boolean(revealKey) && revealLedger.owes(revealKey!, surface)).current;
  const haze = useRef(new Animated.Value(0)).current;
  const sharpen = useRef(new Animated.Value(0)).current;
  const wipe = useRef(new Animated.Value(showBefore ? 1 : 0)).current;
  const [tall, setTall] = useState(0);
  const [wide, setWide] = useState(0);
  // Set when a reveal plays: the peek belongs to it, not to a finished look reopened later.
  const ceremony = useRef(false);
  const peekRunning = useRef<(() => void) | null>(null);
  const showBeforeRef = useRef(showBefore);
  showBeforeRef.current = showBefore;
  const revealStart = useRef(onRevealStart);
  revealStart.current = onRevealStart;
  const revealEnd = useRef(onRevealEnd);
  revealEnd.current = onRevealEnd;
  const [revealed, setRevealed] = useState(done && !owedAtMount);
  const blurLoaded = useRef<(() => void) | null>(null);
  const playing = useRef(false);
  const blurSeen = useRef(false);
  // Neither running nor finished (a failed try-on, one waiting for a retry): just the photo, still and whole.
  const inPlaceholder = developing || done;

  useEffect(() => {
    if (!done) { playing.current = false; blurSeen.current = false; haze.stopAnimation(); sharpen.stopAnimation(); haze.setValue(0); sharpen.setValue(0); setRevealed(false); return; }
    if (revealed || !active || playing.current) return;
    // Played on another screen meanwhile: the look just stands here.
    if (revealKey && !revealLedger.owes(revealKey, surface)) { setRevealed(true); return; }
    if (revealKey) revealLedger.settle(revealKey, surface);
    revealStart.current?.();
    playing.current = true;
    if (reduced) {
      Animated.timing(haze, { toValue: 1, duration: 300, useNativeDriver: true }).start(({ finished }) => { if (finished) setRevealed(true); });
      return;
    }
    if (surface === 'full') ceremony.current = true;
    let begun = false;
    const play = () => {
      if (begun) return;
      begun = true;
      clearTimeout(limit);
      Animated.parallel([
        Animated.timing(haze, { toValue: 1, duration: REVEAL_BLUR_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(sharpen, { toValue: 1, duration: REVEAL_SHARPEN_MS, delay: REVEAL_SHARPEN_DELAY_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setRevealed(true); });
    };
    // Both pictures at hand, or a slow network has had its time. Once begun it plays on even if the screen is left.
    const limit = setTimeout(play, PREFETCH_LIMIT_MS);
    let waiting = blurSeen.current ? 1 : 2;
    const arrived = () => { if (--waiting === 0) play(); };
    blurLoaded.current = () => { blurLoaded.current = null; arrived(); };
    void (resultUri && /^https?:/i.test(resultUri) ? Image.prefetch(resultUri).catch(() => false) : Promise.resolve(true)).then(arrived);
  }, [done, active]);

  // Whatever happens, a finished look on screen does not stay behind the placeholder.
  const showNow = () => { haze.stopAnimation(); sharpen.stopAnimation(); setRevealed(true); };
  useEffect(() => {
    if (!done || !active || revealed) return;
    const watchdog = setTimeout(showNow, REVEAL_WATCHDOG_MS);
    return () => clearTimeout(watchdog);
  }, [done, active, revealed]);

  useEffect(() => { if (revealed) revealEnd.current?.(); }, [revealed]);

  // After the reveal: the peek. Leafing away ends it and puts the look back.
  useEffect(() => {
    if (!revealed || !active || !ceremony.current || reduced) return;
    ceremony.current = false;
    if (!beforeUri || showBeforeRef.current) return;
    const peekRun = Animated.sequence([
      Animated.timing(wipe, { toValue: 1, duration: WIPE_MS, delay: 200, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.delay(WIPE_HOLD_MS),
      Animated.timing(wipe, { toValue: 0, duration: WIPE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]);
    peekRunning.current = () => peekRun.stop();
    peekRun.start();
    return () => { peekRun.stop(); wipe.setValue(showBeforeRef.current ? 1 : 0); };
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
  const strips = revealStrips(tall);
  const neutral = placeholderFill(isDark);
  const revealing = done && !revealed && wide > 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={measure}>
      {done ? <View pointerEvents={revealed ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>{children}</View> : null}
      {!inPlaceholder && photoUri ? <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      {inPlaceholder && !revealed ? (
        // With reduced motion the whole placeholder dissolves off the look; otherwise the look builds over it.
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, reduced ? { opacity: haze.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) } : null]}>
          <GenerationPlaceholder width={wide} height={tall} isDark={isDark} running={active && !reduced && developing} />
        </Animated.View>
      ) : null}
      {revealing && !reduced ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.Image source={{ uri: resultUri! }} blurRadius={BLUR} resizeMode={fit} onLoadEnd={() => { blurSeen.current = true; blurLoaded.current?.(); }} style={[StyleSheet.absoluteFill, { opacity: haze }]} />
          {strips.map((strip, index) => (
            <Animated.View key={strip.top} style={[styles.strip, { top: strip.top, height: strip.height, opacity: sharpen.interpolate(stripOpacity(index, strips.length)) }]}>
              <Image source={{ uri: resultUri! }} resizeMode={fit} style={{ position: 'absolute', left: 0, top: -strip.top, width: wide, height: tall }} />
            </Animated.View>
          ))}
        </View>
      ) : null}
      {/* Before/after: the source photo slides over the look from the left edge, its edge a thin bright line. */}
      {revealed && beforeUri && wide ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.before, { width: wipe.interpolate({ inputRange: [0, 1], outputRange: [0, wide] }) }]}>
            {/* The look's own rect: the photo whole in it, centred, the neutral grey around it only if the shapes differ. */}
            <View style={{ width: wide, height: tall, backgroundColor: neutral }}>
              <Image source={{ uri: beforeUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
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
  strip: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  before: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  wipeEdge: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: '#FFFFFF' },
});
