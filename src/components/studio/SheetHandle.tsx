import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, GestureResponderEvent, GestureResponderHandlers, LayoutChangeEvent, PanResponder, Platform, ScrollViewProps, StyleSheet, TextInput, View, ViewProps, ViewStyle } from 'react-native';
import { useT } from '../../constants/i18n';
import { addSample, dragFree, dragOffset, grabOffset, isTap, releaseCloses, releaseVelocity, scrollAtTop, springVelocity, startTrack, stepTrack, VelocitySample } from './sheetGesture';
import { useReducedMotion } from './studio';

type SheetDragOptions = {
  /** The sheet's own close path (state setter / navigation), called once the sheet has left the screen. */
  onClose: () => void;
  /** Share of the sheet's height past which a release closes it. */
  threshold?: number;
  /** Downward release speed (px/ms) that closes it regardless of distance. */
  velocity?: number;
  /** Resets the offset when the sheet is shown again. */
  visible?: boolean;
  /** false: a drag only rubber-bands and springs back (e.g. unsaved changes); onDismissBlocked is told instead. */
  canDismiss?: boolean;
  onDismissBlocked?: () => void;
  /** The value to drive, when the sheet animates its own entrance with it. */
  value?: Animated.Value;
  /** How far the sheet travels to leave the screen; its height by default. */
  dismissDistance?: number;
  /** false: only the zone marked with grabHandlers drags, until a scroller in the body reports to the hub. */
  body?: boolean;
};

export type SheetDrag = {
  /** Spread onto the sheet container: the whole sheet is the drag zone. */
  panHandlers: GestureResponderHandlers & Pick<ViewProps, 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'>;
  /** Spread onto the handle and header: they drag even when the body doesn't. */
  grabHandlers: Pick<ViewProps, 'onTouchStart'>;
  /** Put on the sheet container: `transform: [{ translateY }]`. */
  translateY: Animated.Value;
  /** Put on the backdrop: fades out as the sheet is pulled away. */
  dim: Animated.AnimatedInterpolation<number>;
  /** Put on the sheet container so the threshold knows its height. */
  onLayout: (event: LayoutChangeEvent) => void;
  /** Wrap the body in <SheetGestureContext.Provider value={hub}>: its scrollers and photos report to the drag. */
  hub: SheetGestureHub;
  /** Slides the sheet away from where it is, then calls onClose: the sheet's close button and the drag share one animation. */
  dismiss: (pxPerMs?: number) => void;
};

/** What the content of a sheet tells its drag: which scroller the touch is on, what must keep the touch for itself. */
export type SheetGestureHub = {
  addScroller: () => () => void;
  /** Called by a scroller as a touch starts on it: the drag asks it whether it is at the top. */
  touchScroller: (atTop: () => boolean) => void;
  /** Called as a touch starts on something that keeps it (a zoomed photo). */
  touchInert: () => void;
  /** While it is held, the sheet doesn't drag at all: a window opened from it is on top. */
  block: () => () => void;
  /** Scrollers stop while the sheet follows the finger, or the content would move along with it. */
  subscribeLock: (listener: () => void) => () => void;
  isLocked: () => boolean;
};

export const SheetGestureContext = createContext<SheetGestureHub | null>(null);

const noSubscribe = () => () => {};
const notLocked = () => false;

/** True while the sheet around follows the finger: for a pager, which must not slide along. */
export function useSheetScrollLock() {
  const hub = useContext(SheetGestureContext);
  return useSyncExternalStore(hub?.subscribeLock ?? noSubscribe, hub?.isLocked ?? notLocked, hub?.isLocked ?? notLocked);
}

/** A window opened from inside a sheet (touches reach the sheet through the React tree): the sheet below stays put. */
export function useSheetGestureBlock(active: boolean) {
  const hub = useContext(SheetGestureContext);
  useEffect(() => (active && hub ? hub.block() : undefined), [active, hub]);
}

/** The same for a window drawn inside a sheet by the screen that renders that sheet. */
export function SheetGestureBlock({ active }: { active: boolean }) {
  useSheetGestureBlock(active);
  return null;
}

type ScrollerProps = Pick<ScrollViewProps, 'onScroll' | 'onTouchStart' | 'scrollEventThrottle' | 'bounces' | 'scrollEnabled'>;

/**
 * Makes a vertical list a part of its sheet: it scrolls as usual, at the top it doesn't bounce down, and the pull goes
 * to the sheet. Outside a sheet the props pass through untouched.
 */
export function useSheetScroller<P extends ScrollerProps>(props: P, horizontal = false): P {
  const hub = useContext(SheetGestureContext);
  const active = hub && !horizontal ? hub : null;
  const atTop = useRef(true);
  const [top, setTop] = useState(true);
  const locked = useSheetScrollLock();
  useEffect(() => active?.addScroller(), [active]);
  if (!active) return props;
  return {
    ...props,
    scrollEventThrottle: props.scrollEventThrottle ?? 16,
    bounces: top ? false : props.bounces,
    scrollEnabled: !locked && props.scrollEnabled !== false,
    onScroll: event => {
      atTop.current = scrollAtTop(event.nativeEvent.contentOffset.y);
      if (atTop.current !== top) setTop(atTop.current);
      props.onScroll?.(event);
    },
    onTouchStart: event => {
      active.touchScroller(() => atTop.current);
      props.onTouchStart?.(event);
    }
  };
}

const NATIVE = Platform.OS !== 'web';
const SETTLE = { damping: 28, stiffness: 300, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.5, restSpeedThreshold: 20, useNativeDriver: NATIVE };

/**
 * Drag-to-dismiss for a bottom sheet, as on iOS: a downward drag anywhere on it moves the sheet 1:1 from where it was
 * grabbed. A release past `threshold` of its height or a fast flick carries on off the screen at the finger's speed, then
 * calls onClose; anything else springs back at that speed (snaps with reduced motion).
 *
 * A vertical UIScrollView keeps panning under a JS responder (Fabric doesn't stop it), so its hub props stop it instead.
 * It also refuses to give up the responder once scrolling, so the finger is read from the touch events as well: they
 * reach the sheet whoever holds the responder, which is what makes the list-to-sheet handoff work within one gesture.
 */
export function useSheetDrag({ onClose, threshold = 0.25, velocity = 0.8, visible, canDismiss = true, onDismissBlocked, value, dismissDistance, body = true }: SheetDragOptions): SheetDrag {
  const reduced = useReducedMotion();
  const own = useRef(new Animated.Value(0)).current;
  const translateY = value ?? own;
  const [measured, setMeasured] = useState(400);
  const height = useRef(400);
  const latest = useRef({ onClose, reduced, canDismiss, onDismissBlocked, threshold, velocity, visible, dismissDistance, body });
  latest.current = { onClose, reduced, canDismiss, onDismissBlocked, threshold, velocity, visible, dismissDistance, body };
  const closing = useRef(false);
  useLayoutEffect(() => { if (visible === true) { closing.current = false; translateY.setValue(0); } }, [visible, translateY]);

  const { panHandlers, grabHandlers, hub, dismiss } = useMemo(() => {
    let scrollers = 0, blocks = 0, locked = false;
    const listeners = new Set<() => void>();
    const setLocked = (next: boolean) => {
      if (next === locked) return;
      locked = next;
      listeners.forEach(listener => listener());
    };
    // The touch in progress.
    let track = startTrack(0, 0), touchId: string | undefined;
    let atTop: (() => boolean) | null = null, inert = false, grabbed = false, focused = false;
    // The drag in progress.
    let active = false, grabY = 0, base = 0, raw = 0, samples: VelocitySample[] = [];

    const hub: SheetGestureHub = {
      addScroller: () => { scrollers += 1; return () => { scrollers -= 1; }; },
      touchScroller: check => { atTop = check; },
      touchInert: () => { inert = true; },
      block: () => { blocks += 1; return () => { blocks -= 1; }; },
      subscribeLock: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      isLocked: () => locked
    };

    const back = (pxPerMs = 0) => {
      if (latest.current.reduced) translateY.setValue(0);
      else Animated.spring(translateY, { ...SETTLE, toValue: 0, velocity: springVelocity(pxPerMs) }).start();
    };
    const dismiss = (pxPerMs = 0) => {
      if (closing.current) return;
      closing.current = true;
      const finish = () => {
        closing.current = false;
        latest.current.onClose();
        // A close path that kept the sheet open (it asked first) must not leave it off the screen.
        if (latest.current.visible === true) setTimeout(() => { if (latest.current.visible === true && !closing.current) back(); }, 400);
      };
      if (latest.current.reduced) { finish(); return; }
      const toValue = latest.current.dismissDistance ?? height.current + 40;
      Animated.spring(translateY, { ...SETTLE, toValue, velocity: Math.max(0, springVelocity(pxPerMs)) }).start(finish);
    };
    const begin = (y: number) => {
      active = true;
      grabY = y;
      raw = 0;
      samples = [];
      // Caught while still settling: the sheet carries on from where it is.
      base = 0;
      translateY.stopAnimation(at => { base = at; });
      setLocked(true);
    };
    const finishDrag = (released: boolean) => {
      if (!active) return;
      active = false;
      setLocked(false);
      if (!released) { back(); return; }
      const { canDismiss: allowed, threshold: share, velocity: flick, onDismissBlocked: blocked } = latest.current;
      const vy = releaseVelocity(samples, Date.now());
      const gesture = { dy: raw, vy, height: height.current, threshold: share, velocity: flick };
      if (releaseCloses({ ...gesture, canDismiss: allowed })) { dismiss(vy); return; }
      back(vy);
      if (!allowed && releaseCloses({ ...gesture, canDismiss: true })) blocked?.();
    };
    const touchBegins = (event: GestureResponderEvent) => {
      const { pageX, pageY, touches, identifier } = event.nativeEvent;
      if (touches.length > 1) { track = { ...track, multi: true }; return false; }
      track = startTrack(pageX, pageY);
      touchId = identifier;
      atTop = null; inert = false; grabbed = false;
      const input = TextInput.State.currentlyFocusedInput?.();
      focused = Boolean(input) && input === (event.target as unknown);
      return false;
    };
    const observe = (event: GestureResponderEvent) => {
      const { pageX, pageY, touches, identifier } = event.nativeEvent;
      // A second finger: a pinch, or a stray touch during a drag, which goes on following the first.
      if (identifier !== touchId) { if (touches.length > 1) track = { ...track, multi: true }; return active; }
      if (active) {
        raw = grabOffset(pageY, grabY, base);
        samples = addSample(samples, { t: Date.now(), y: pageY });
        translateY.setValue(dragOffset(raw, latest.current.canDismiss));
        return true;
      }
      if (closing.current) return false;
      const free = dragFree({
        blocked: blocks > 0, inert: inert || focused,
        body: latest.current.body || scrollers > 0, grabbed,
        scrollerAtTop: atTop ? atTop() : true
      });
      const step = stepTrack(track, { x: pageX, y: pageY, touches: touches.length, free });
      track = step.track;
      if (step.claim) begin(pageY);
      return step.claim;
    };
    const responder = PanResponder.create({
      onStartShouldSetPanResponderCapture: touchBegins,
      onMoveShouldSetPanResponderCapture: observe,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: event => { observe(event); },
      onPanResponderRelease: () => finishDrag(true),
      onPanResponderTerminate: () => finishDrag(false)
    });
    return {
      hub, dismiss,
      grabHandlers: { onTouchStart: () => { grabbed = true; } },
      panHandlers: {
        ...responder.panHandlers,
        // A scrolling list holds the responder and won't give it up: the handoff from it runs on these alone.
        onTouchMove: (event: GestureResponderEvent) => { observe(event); },
        onTouchEnd: (event: GestureResponderEvent) => { if (event.nativeEvent.touches.length === 0) finishDrag(true); },
        onTouchCancel: () => finishDrag(false)
      }
    };
  }, [translateY]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next && next !== height.current) { height.current = next; setMeasured(next); }
  };
  const dim = useMemo(() => translateY.interpolate({ inputRange: [0, dismissDistance ?? measured], outputRange: [1, 0], extrapolate: 'clamp' }), [translateY, dismissDistance, measured]);
  return { panHandlers, grabHandlers, translateY, dim, onLayout, hub, dismiss };
}

/** The sheet's grab bar as a real control: a 44pt target, «Закрыть» for assistive tech; a tap closes too. */
export function SheetHandle({ onClose, color, style, canDismiss = true, onDismissBlocked }:
  { onClose: () => void; color: string; style?: ViewStyle; canDismiss?: boolean; onDismissBlocked?: () => void }) {
  const t = useT();
  const start = useRef({ x: 0, y: 0, at: 0 });
  const press = () => { if (canDismiss) onClose(); else onDismissBlocked?.(); };
  return (
    // Only a real tap (small movement, short press) closes: a sideways or diagonal drag released here does not.
    <View accessible accessibilityRole="button" accessibilityLabel={t('Закрыть')} accessibilityHint={canDismiss ? t('Смахни вниз, чтобы закрыть') : undefined} accessibilityState={{ disabled: !canDismiss }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={e => { start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() }; }}
      onResponderRelease={e => {
        const s0 = start.current;
        if (isTap(e.nativeEvent.pageX - s0.x, e.nativeEvent.pageY - s0.y, Date.now() - s0.at)) press();
      }}
      onAccessibilityTap={press} style={[styles.hit, style]}>
      <View style={[styles.bar, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', height: 44, marginBottom: -14 },
  bar: { width: 38, height: 5, borderRadius: 3 }
});
