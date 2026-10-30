import { useEffect, useMemo, useRef } from 'react';
import { Animated, GestureResponderHandlers, LayoutChangeEvent, PanResponder, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { useT } from '../../constants/i18n';
import { useReducedMotion } from './studio';

type SheetDragOptions = {
  /** The sheet's own close path (state setter / navigation), called once the drag dismisses it. */
  onClose: () => void;
  /** Share of the sheet's height past which a release closes it. */
  threshold?: number;
  /** Downward release speed (px/ms) that closes it regardless of distance. */
  velocity?: number;
  /** Resets the offset when the sheet is shown again. */
  visible?: boolean;
};

export type SheetDrag = {
  /** Spread onto the drag zone (handle + header): never on scrolling content. */
  panHandlers: GestureResponderHandlers;
  /** Put on the sheet container: `transform: [{ translateY }]`. */
  translateY: Animated.Value;
  /** Put on the sheet container so the threshold knows its height. */
  onLayout: (event: LayoutChangeEvent) => void;
};

/**
 * Drag-to-dismiss for a bottom sheet: the zone it is spread on follows the finger downward; a release past
 * `threshold` of the sheet's height or a fast flick calls onClose, anything else springs back (snaps back with
 * reduced motion). Taps inside the zone still reach its buttons: the gesture is claimed only once the finger moves down.
 */
export function useSheetDrag({ onClose, threshold = 0.25, velocity = 0.8, visible }: SheetDragOptions): SheetDrag {
  const reduced = useReducedMotion();
  const translateY = useRef(new Animated.Value(0)).current;
  const height = useRef(400);
  const latest = useRef({ onClose, reduced });
  latest.current = { onClose, reduced };
  useEffect(() => { if (visible !== false) translateY.setValue(0); }, [visible, translateY]);
  const panHandlers = useMemo(() => {
    const back = () => {
      if (latest.current.reduced) translateY.setValue(0);
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 4 }).start();
    };
    const downward = (dx: number, dy: number) => dy > 6 && Math.abs(dy) > Math.abs(dx) * 1.2;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => downward(g.dx, g.dy),
      onMoveShouldSetPanResponderCapture: (_, g) => downward(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > height.current * threshold || (g.vy > velocity && g.dy > 0)) latest.current.onClose();
        else back();
      },
      onPanResponderTerminate: back
    }).panHandlers;
  }, [translateY, threshold, velocity]);
  const onLayout = (event: LayoutChangeEvent) => { height.current = event.nativeEvent.layout.height || height.current; };
  return { panHandlers, translateY, onLayout };
}

/** The sheet's grab bar as a real control: a 44pt target, «Закрыть» for assistive tech; a tap closes too. */
export function SheetHandle({ onClose, color, style }: { onClose: () => void; color: string; style?: ViewStyle }) {
  const t = useT();
  return (
    // A drag is taken over by the zone's pan responder (this one yields), so a release here is a tap.
    <View accessible accessibilityRole="button" accessibilityLabel={t('Закрыть')} accessibilityHint={t('Смахни вниз, чтобы закрыть')}
      onStartShouldSetResponder={() => true} onResponderRelease={onClose} onAccessibilityTap={onClose} style={[styles.hit, style]}>
      <View style={[styles.bar, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', height: 44, marginBottom: -14 },
  bar: { width: 38, height: 5, borderRadius: 3 }
});
