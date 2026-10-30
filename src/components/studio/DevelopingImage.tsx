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
};

const REVEAL_MS = 1200;
const FEATHER = 90;

/**
 * A picture that develops like a photograph, after ChatGPT's image generation:
 * a soft blurred field of the photo with slowly drifting light while it works,
 * then the finished look sharpens in a band that travels from top to bottom.
 * With reduced motion the field stays still and the look simply crossfades.
 */
export function DevelopingImage({ photoUri, resultUri, developing, isDark, children }: Props) {
  const reduced = useReducedMotion();
  const drift = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const haze = useRef(new Animated.Value(resultUri && !developing ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(resultUri && !developing ? 1 : 0)).current;
  const [tall, setTall] = useState(0);
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
    if (revealed) return;
    if (reduced) {
      Animated.timing(haze, { toValue: 1, duration: 300, useNativeDriver: false }).start();
      sweep.setValue(1);
      setRevealed(true);
      return;
    }
    Animated.parallel([
      Animated.timing(haze, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(sweep, { toValue: 1, duration: REVEAL_MS, delay: 120, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]).start(({ finished }) => { if (finished) setRevealed(true); });
  }, [done]);

  const measure = (event: LayoutChangeEvent) => setTall(event.nativeEvent.layout.height);
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
          {!revealed ? <Animated.Image source={{ uri: resultUri }} blurRadius={22} resizeMode="contain" style={[StyleSheet.absoluteFill, { opacity: haze }]} /> : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  field: { position: 'absolute', top: -60, bottom: -60, left: -60, right: -60 },
  band: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  feather: { position: 'absolute', left: 0, right: 0, height: FEATHER },
});
