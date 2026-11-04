import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { placeholderDepth, SWEEP_MS, SWEEP_OVERHANG, SWEEP_REST_MS, SWEEP_STOPS, SWEEP_TILT_DEG, sweepColors, sweepTravel } from './generationReveal';

type Props = {
  width: number;
  height: number;
  isDark: boolean;
  /** Sweeping; otherwise a still grey (reduced motion, a page or screen out of sight). */
  running: boolean;
};

/** The picture's place while it is made: a calm grey in its final shape, a soft band of light crossing it on the UI thread. */
export function GenerationPlaceholder({ width, height, isDark, running }: Props) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) { sweep.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.linear, useNativeDriver: true }),
      Animated.delay(SWEEP_REST_MS),
    ]));
    loop.start();
    return () => loop.stop();
  }, [running, sweep]);
  const { bandWidth, from, to } = sweepTravel(width, height);
  return (
    <View pointerEvents="none" style={styles.fill}>
      <LinearGradient colors={placeholderDepth(isDark)} style={StyleSheet.absoluteFill} />
      {running && width > 0 ? (
        <Animated.View style={[styles.band, { width: bandWidth, height: height * SWEEP_OVERHANG, top: -height * (SWEEP_OVERHANG - 1) / 2,
          transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }, { rotate: `${SWEEP_TILT_DEG}deg` }] }]}>
          <LinearGradient colors={sweepColors(isDark)} locations={SWEEP_STOPS} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  band: { position: 'absolute', left: 0 },
});
