import { Component, ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createFrameGovernor, FOG_LEVELS, fogTime, revealAt, Rgb } from './generationFog';
import { FogModule } from './skiaModule';

type Props = {
  fog: FogModule;
  width: number;
  height: number;
  seed: number;
  tints: { a: Rgb; b: Rgb };
  isDark: boolean;
  /** Flowing; otherwise one still frame (reduced motion, a page or screen out of sight). */
  running: boolean;
  /** The reveal plays once this turns true, whatever `running` says. */
  revealing: boolean;
  onCovered: () => void;
  onRevealed: () => void;
};

/**
 * The fog on its canvas. Each frame re-renders only this component, whose whole subtree is one shader fill: the clock runs on
 * the JS thread because Reanimated, which would move it to the UI thread, is not among the app's dependencies.
 */
export function GenerationFog({ fog, width, height, seed, tints, isDark, running, revealing, onCovered, onRevealed }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [level, setLevel] = useState(0);
  const revealStart = useRef<number | null>(null);
  const covered = useRef(false);
  const callbacks = useRef({ onCovered, onRevealed });
  callbacks.current = { onCovered, onRevealed };
  const animate = running || revealing;

  useEffect(() => {
    if (!animate) return;
    const governor = createFrameGovernor();
    let last = 0;
    let handle = requestAnimationFrame(function frame(at) {
      handle = requestAnimationFrame(frame);
      // The interval also keeps a 120 Hz screen at 60.
      if (last && at - last < FOG_LEVELS[governor.level].intervalMs - 2) return;
      if (last) setLevel(governor.tick(at - last));
      last = at;
      setNow(Date.now());
    });
    return () => cancelAnimationFrame(handle);
  }, [animate]);

  if (!revealing) { revealStart.current = null; covered.current = false; }
  // From the wall clock: a fog that stood still has a stale `now`, and the reveal would start already finished.
  else if (revealStart.current === null) revealStart.current = Date.now();
  const reveal = revealStart.current === null ? { cover: 0, open: 0, covered: false, finished: false } : revealAt(now - revealStart.current);
  useEffect(() => {
    if (reveal.covered && !covered.current) { covered.current = true; callbacks.current.onCovered(); }
    if (reveal.finished) callbacks.current.onRevealed();
  }, [reveal.covered, reveal.finished]);

  const scale = FOG_LEVELS[level].scale;
  const canvasWidth = Math.ceil(width * scale);
  const canvasHeight = Math.ceil(height * scale);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, { left: (width - canvasWidth) / 2, top: (height - canvasHeight) / 2, width: canvasWidth, height: canvasHeight, transform: [{ scale: 1 / scale }] }]}>
      <fog.Canvas style={StyleSheet.absoluteFill}>
        <fog.Fill>
          <fog.Shader source={fog.effect} uniforms={{ uSize: [canvasWidth, canvasHeight], uTime: fogTime(now, seed), uCover: reveal.cover, uOpen: reveal.open,
            uDark: isDark ? 1 : 0, uTintA: tints.a, uTintB: tints.b }} />
        </fog.Fill>
      </fog.Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: 'absolute' } });

/** A canvas that fails to mount costs only the fog: the gradient takes over. */
export class FogBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
