import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { darkColors } from '../../constants/theme';
import { Animated, Easing, FlatList, Image, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SheetFlatList } from '../ui/FormScrollView';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, G, Image as SvgImage, LinearGradient as SvgLinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';
import { CircleHelp, Layers, LayoutGrid, PersonStanding, Plus, Search } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { selectionHaptic } from '../../services/haptics';
import { AppPressable } from '../AppPressable';
import { Glass, Pill } from './Glass';
import { FloorShadow, GarmentImage, PRINT_RADIUS } from './Garment';
import { centreTick, copyOffset, depthKeyframes, ECHO_DISCARD_MS, echoCounts, fitBox, mod, nearestCopy, nearestPlace, neighbourIndex, offsetToCopy, printRect, railBounds, railWindow, recentred, rubberBand, shortestDelta, showcaseGeometry, showsReflection, snapTarget, nextSpinPhase, SpinPhase, stageFollow, stageSkip, stripLoops, stripMiddle, stripReturn, stripRun, stripShift, stripTick, STRIP_GLIDE_BACK, THUMB_PITCH, WINDOW_RADIUS, windowIndices } from './railMotion';
import { prepareReflectionCopy, useReflectionCopy } from './reflectionCopy';
import { font, INK, INK_FAINT, INK_ON_DARK, inkSoft, isCutout, studioTint, useReducedMotion, useScreenReader } from './studio';
import { StudioSheet } from './StudioSheet';
import { useAspects } from './useAspects';

const NATIVE = Platform.OS !== 'web';
const PERSPECTIVE = 900;
/** How much the centre piece grows under a finger, and how far it drifts up at rest. */
const LIFT = 0.03;
const FLOAT_PX = 2;
const TICK_GAP_MS = 40;
const REFLECTION_FADE_MS = 220;
// A softer mirror: at full strength its flat edge reads as a separate shape under the piece.
const softReflection = (opacity: number) => opacity * 0.6;
/** A cut-out's shape comes in a moment; one that can't be measured stands in a square box after this long. */
const SHAPE_WAIT_MS = 800;
const PIECE_FADE_MS = 140;
/** A little slower than iOS's own 0.998: a hard flick glides on and comes to rest unhurried. */
const STRIP_DECELERATION = 0.8;
/** No scroll event for this long and no finger: the strip has stopped, however it came to. */
const STRIP_IDLE_MS = 140;
/** In native momentum its end is what counts, a slow tail reports rarely; this much silence only guards against an end that never comes. */
const STRIP_MOMENTUM_SILENCE_MS = 1500;
const AUTO_SCROLL_MS = 500;

type Geometry = ReturnType<typeof showcaseGeometry>;
type StripSpin = { shift: number; slip: number; lastPlace: number; lastAt: number; lastSkip: number; speed: number; tickPlace: number; dragging: boolean; aligning: boolean; momentum: boolean; phase: SpinPhase };

const AnimatedNumberList = Animated.FlatList as unknown as typeof FlatList<number>;

/**
 * FLAT_PLANE (`styles.flatPlane`): why the stage's children each stand in a flat clipping view of their own.
 * iOS sorts sibling layers in depth by their real 3D geometry, and cuts them where they cross; RN's zIndex only orders
 * subviews, it sets no layer zPosition. A slot turning about its middle goes through z = 0 along its centre line,
 * and a flat sibling (the light behind it) lies in z = 0: half the piece fell behind the translucent light and half stayed
 * in front, a straight seam down the piece during any swipe, gone at rest when the angle is 0.
 * A layer that clips flattens what is inside it into its own plane, so the planes in the sorted context are all z = 0, in order.
 */

/**
 * The piece mirrored on the floor. A real alpha mask over the backdrop rather than a gradient in the stage's
 * colour: the backdrop is a radial light, no single colour would match it. The same rounded corners as the print.
 */
const Reflection = memo(function Reflection({ id, uri, print, width, boxHeight, height, opacity }: { id: string; uri: string; print: boolean; width: number; boxHeight: number; height: number; opacity: number }) {
  const box = { width, height: boxHeight };
  const picture = print ? printRect(box) : { x: 0, y: 0, ...box };
  const foot = picture.y + picture.height;
  return (
    <Svg width={box.width} height={height}>
      <Defs>
        <SvgLinearGradient id={`${id}-fade`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={height}>
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={opacity} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgLinearGradient>
        <Mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={box.width} height={height}>
          <Rect x={picture.x} y={0} width={picture.width} height={Math.min(picture.height, height + PRINT_RADIUS)} rx={print ? PRINT_RADIUS : 0} ry={print ? PRINT_RADIUS : 0} fill={`url(#${id}-fade)`} />
        </Mask>
      </Defs>
      <G mask={`url(#${id}-mask)`}>
        <G transform={`translate(0 ${foot}) scale(1 -1)`}>
          <SvgImage href={{ uri }} x={picture.x} y={picture.y} width={picture.width} height={picture.height} preserveAspectRatio={print ? 'xMidYMid slice' : 'xMidYMid meet'} />
        </G>
      </G>
    </Svg>
  );
});

/**
 * What stands under a piece: its reflection, from a small copy of the picture, fading in once that exists. Nothing
 * before that; the contact shadow if there can be no copy. Numbers and stable values only, so the depth changing leaves it alone.
 */
const SlotFloor = memo(function SlotFloor({ id, uri, print, side, width, boxHeight, reflection, opacity, down, reduced, fadeIn }: { id: string; uri?: string; print: boolean; side: number; width: number; boxHeight: number; reflection: number; opacity: number; down: Animated.AnimatedMultiplication<number> | null; reduced: boolean; fadeIn: boolean }) {
  const copy = useReflectionCopy(uri);
  const fade = useRef(new Animated.Value(copy && !fadeIn ? 1 : 0)).current;
  const faded = useRef(Boolean(copy) && !fadeIn);
  useEffect(() => {
    if (!copy || faded.current) return;
    faded.current = true;
    if (reduced) fade.setValue(1);
    else Animated.timing(fade, { toValue: 1, duration: REFLECTION_FADE_MS, useNativeDriver: NATIVE }).start();
  }, [copy, reduced]);
  if (copy === undefined) return null;
  if (copy === null) return <View pointerEvents="none" style={{ position: 'absolute', top: side - 17, left: 0, right: 0, alignItems: 'center' }}><FloorShadow width={width * 0.8} opacity={0.22} /></View>;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: side, left: (side - width) / 2, width, height: reflection, opacity: fade, transform: down ? [{ translateY: down }] : [] }}>
      <Reflection id={id} uri={copy} print={print} width={width} boxHeight={boxHeight} height={reflection} opacity={softReflection(opacity)} />
    </Animated.View>
  );
});

/** The piece itself, left alone by the depth too. */
const SlotPiece = memo(function SlotPiece({ at, item, width, height, left, top, up, onPress }: { at: number; item?: WardrobeItem; width: number; height: number; left: number; top: number; up: Animated.AnimatedMultiplication<number> | null; onPress: (at: number) => void }) {
  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left, top, width, height, transform: up ? [{ translateY: up }] : [] }}>
      <AppPressable accessible={false} onPress={() => onPress(at)} style={{ width, height }}>
        <GarmentImage item={item} print style={{ width, height }} />
      </AppPressable>
    </Animated.View>
  );
});

/** The light behind one piece, in the middle of the stage however the piece moves: it is at full only while that piece is. */
const Glow = memo(function Glow({ at, color, position, geometry, opacity }: { at: number; position: Animated.Value; color: string; geometry: Geometry; opacity: number }) {
  const shown = useMemo(() => position.interpolate({ ...depthKeyframes(at, 0, false).light, extrapolate: 'clamp' }), [position, at]);
  const id = `showcase-glow-${at}`;
  // Centred on the piece and dying out at the stage's top: the stage clips, and a cut light would show as a line.
  const height = 2 * geometry.top + geometry.side;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height, opacity: shown }}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%" rx="50%" ry="50%" fx="50%" fy="50%">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="0.55" stopColor={color} stopOpacity={opacity * 0.5} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
});

type SlotProps = {
  at: number;
  item?: WardrobeItem;
  geometry: Geometry;
  position: Animated.Value;
  lift: Animated.Value;
  floatY: Animated.AnimatedInterpolation<number>;
  depth: number;
  reflected: boolean;
  reduced: boolean;
  reflectionOpacity: number;
  fadeIn: boolean;
  onPress: (at: number) => void;
};

/**
 * One place in the showcase. Everything it does between renders is an interpolation of the position on the
 * native side, so a finger moving costs no React work. It turns and scales about its foot, so the piece and its
 * reflection stay joined at the floor; every category does the same.
 *
 * The turning view is the only child of a flat clipping view (see FLAT_PLANE above).
 */
const ShowcaseSlot = memo(function ShowcaseSlot({ at, item, geometry, position, lift, floatY, depth, reflected, reduced, reflectionOpacity, fadeIn, onPress }: SlotProps) {
  const { side, reflection, top, pitch, stageWidth } = geometry;
  const aspects = useAspects(useMemo(() => item ? [item] : undefined, [item]));
  const uri = item?.imageUri;
  const print = Boolean(uri && !isCutout(uri));
  const aspect = item ? aspects[item.id] : undefined;
  const box = print ? { width: side, height: side } : fitBox(aspect, side);
  // A cut-out of a shape not known yet waits out of sight rather than standing square and then jumping.
  const shapePending = Boolean(uri && !print && aspect === undefined);
  const shown = useRef(new Animated.Value(shapePending ? 0 : 1)).current;
  useEffect(() => {
    const appear = () => {
      if (reduced) shown.setValue(1);
      else Animated.timing(shown, { toValue: 1, duration: PIECE_FADE_MS, useNativeDriver: NATIVE }).start();
    };
    if (!shapePending) { appear(); return; }
    shown.setValue(0);
    const timer = setTimeout(appear, SHAPE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [shapePending, uri, reduced]);
  // A print's picture stops short of its box: it stands on the floor by the picture.
  const sink = print ? box.height - (printRect(box).y + printRect(box).height) : 0;
  const height = side + reflection;
  // From the slot's centre to the floor line.
  const pivot = side - height / 2;
  const motion = useMemo(() => {
    const frames = depthKeyframes(at, pitch, reduced);
    const translateX = position.interpolate(frames.translateX);
    const opacity = position.interpolate({ ...frames.opacity, extrapolate: 'clamp' });
    if (!frames.rotateY || !frames.scale || !frames.rise) return { translateX, opacity, deep: null };
    const focus = position.interpolate({ ...frames.focus, extrapolate: 'clamp' });
    const up = Animated.multiply(focus, floatY);
    return {
      translateX, opacity,
      deep: {
        scale: Animated.add(position.interpolate({ ...frames.scale, extrapolate: 'clamp' }), Animated.multiply(focus, lift)),
        rise: position.interpolate({ ...frames.rise, extrapolate: 'clamp' }),
        rotateY: position.interpolate({ ...frames.rotateY, extrapolate: 'clamp' }),
        up, down: Animated.multiply(up, -1)
      }
    };
  }, [at, pitch, reduced, position, lift, floatY]);
  const { deep } = motion;
  const transform = deep
    ? [{ perspective: PERSPECTIVE }, { translateX: motion.translateX }, { translateY: deep.rise }, { translateY: pivot }, { scale: deep.scale }, { rotateY: deep.rotateY }, { translateY: -pivot }]
    : [{ translateX: motion.translateX }];
  return (
    <View collapsable={false} pointerEvents="box-none" style={[styles.flatPlane, { zIndex: depth }]}>
    <Animated.View pointerEvents="box-none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, left: (stageWidth - side) / 2, width: side, height, opacity: motion.opacity, transform }}>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: shown }]}>
        {reflected && reflection > 0
          ? <SlotFloor key={uri ?? ''} id={`showcase-${at}`} uri={uri} print={print} side={side} width={box.width} boxHeight={box.height} reflection={reflection} opacity={reflectionOpacity} down={deep ? deep.down : null} reduced={reduced} fadeIn={fadeIn} />
          : null}
        <SlotPiece at={at} item={item} width={box.width} height={box.height} left={(side - box.width) / 2} top={side - box.height + sink} up={deep ? deep.up : null} onPress={onPress} />
      </Animated.View>
    </Animated.View>
    </View>
  );
});

/**
 * One cell of the strip. In a looping strip how much it is the chosen one comes straight from the scroll offset on the
 * native side: the highlight glides with no React work, however fast the strip goes. A strip that stands still passes a number.
 */
const StripThumb = memo(function StripThumb({ entry, at, on, selected, onPick }: { entry: WardrobeItem; at: number; on: Animated.AnimatedInterpolation<number> | number; selected: boolean; onPick: (at: number) => void }) {
  const raised = useMemo(() => typeof on === 'number' ? -8 * on : on.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }), [on]);
  return (
    <Animated.View style={[styles.thumbCell, { transform: [{ translateY: raised }] }]}>
      <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} accessibilityState={{ selected }}
        onPress={() => onPick(at)} style={styles.thumb}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.thumbOn, { opacity: on }]} />
        <GarmentImage item={entry} style={styles.thumbImage} />
      </AppPressable>
    </Animated.View>
  );
});

const LoopThumb = memo(function LoopThumb({ entry, at, scrollX, viewWidth, selected, onPick }: { entry: WardrobeItem; at: number; scrollX: Animated.Value; viewWidth: number; selected: boolean; onPick: (at: number) => void }) {
  const on = useMemo(() => {
    const centre = copyOffset(at, viewWidth);
    return scrollX.interpolate({ inputRange: [centre - THUMB_PITCH, centre, centre + THUMB_PITCH], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  }, [at, scrollX, viewWidth]);
  return <StripThumb entry={entry} at={at} on={on} selected={selected} onPick={onPick} />;
});

type Props = {
  items: WardrobeItem[];
  sections: string[];
  onOpen: (item: WardrobeItem) => void;
  onAdd: () => void;
  onTryOn: (item: WardrobeItem) => void;
  onStyleWith?: (item: WardrobeItem) => void;
  onHelp?: () => void;
  addDisabled?: boolean;
  /** Something covers the showcase (the piece's card): it stops breathing meanwhile. */
  paused?: boolean;
};

/**
 * The wardrobe as a lit showcase: the piece in focus stands frontal on a glossy floor over its own reflection,
 * its neighbours turn away and recede behind it, and the light behind takes the colour of whichever piece is
 * coming in as you swipe. Tap the row below to go to one. «Все вещи» opens everything as a grid with search.
 *
 * The rail's position is one number in pieces on the native side. `rail.center` is the whole place nearest to
 * it, moved on only when another piece becomes nearest; that and nothing else re-renders this screen in motion.
 */
export function WardrobeStudio({ items, sections, onOpen, onAdd, onTryOn, onStyleWith, onHelp, addDisabled, paused }: Props) {
  const t = useT();
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const screenReader = useScreenReader();
  const [section, setSection] = useState('Все');
  const [rail, setRail] = useState<{ id: string | null; center: number }>({ id: items[0]?.id ?? null, center: 0 });
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stageHeight, setStageHeight] = useState(0);
  // 'fast' strips the stage to the piece and its neighbours; 'tail' has them back but leaves reflections and the row's state for the rest.
  const [spinPhase, setSpinPhase] = useState<SpinPhase>('calm');
  const spinning = spinPhase === 'fast';
  const atRest = spinPhase === 'calm';
  const spunOnce = useRef(false);
  if (spinning) spunOnce.current = true;

  const present = useMemo(() => sections.filter(name => items.some(item => item.section === name)), [items, sections]);
  const list = useMemo(() => section === 'Все' ? items : items.filter(item => item.section === section), [items, section]);
  const count = list.length;
  const center = rail.center;
  // The focused piece gone from the same list: its neighbour steps in, the rail doesn't run back to the first.
  const place = useRef({ section, index: 0 });
  const focused = list.findIndex(item => item.id === rail.id);
  const index = focused >= 0 ? focused : place.current.section === section ? neighbourIndex(place.current.index, count) : 0;
  place.current = { section, index };
  const item = list[index];
  const focusId = item?.id ?? null;
  useEffect(() => { if (focusId !== rail.id) setRail(current => ({ ...current, id: focusId })); }, [focusId, rail.id]);
  // The last piece of a section gone: back to everything rather than to an empty stage with no way to name it.
  useEffect(() => { if (section !== 'Все' && !present.includes(section)) setSection('Все'); }, [present, section]);

  const position = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const floatY = useRef(float.interpolate({ inputRange: [0, 1], outputRange: [0, -FLOAT_PX] })).current;
  const textFade = useRef(new Animated.Value(1)).current;
  const stripRef = useRef<FlatList<number>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const geometry = useMemo(() => showcaseGeometry(stageHeight, width, reduced), [stageHeight, width, reduced]);

  // What gesture handlers, created once, read: updated in place by a move so that the next one, even before
  // React has rendered, already counts from it.
  const live = useRef({
    list, index, center, reduced, pitch: geometry.pitch, onOpen,
    now: 0, staleUntil: 0, target: 0, lastTick: 0, lastTickAt: 0, run: 0,
    drag: null as null | { base: number; grab: number; dx: number; origin: number },
    /** The strip under a finger or in its momentum: it drives the rail, until it rests. */
    spin: null as null | StripSpin,
    width, loops: false, stripCopy: 0, stripX: 0, stripHeld: false, autoUntil: 0, stripTimer: null as null | ReturnType<typeof setTimeout>, tickAt: 0
  }).current;
  live.list = list;
  live.index = index;
  live.center = center;
  live.reduced = reduced;
  live.pitch = geometry.pitch;
  live.onOpen = onOpen;
  live.width = width;

  const bounds = () => railBounds(live.center, live.index, live.list.length);

  // Whichever piece is nearest becomes the focus, and a piece arriving at the centre ticks.
  const arrive = (value: number) => {
    live.now = value;
    if (!live.list.length) return;
    const { min, max } = bounds();
    const nearest = nearestPlace(value, min, max);
    if (nearest !== live.center) {
      const nextIndex = mod(live.index + nearest - live.center, live.list.length);
      live.index = nextIndex;
      live.center = nearest;
      setRail({ id: live.list[nextIndex].id, center: nearest });
    }
    if (live.spin) return;
    const tick = centreTick(Math.min(max, Math.max(min, value)), live.lastTick);
    if (tick !== null) {
      live.lastTick = tick;
      const time = Date.now();
      if (time - live.lastTickAt >= TICK_GAP_MS) { live.lastTickAt = time; selectionHaptic(); }
    }
  };
  // The native side reports a frame or more late: under a finger or right after a jump that would flip the focus back.
  const discardEchoes = () => { live.staleUntil = Date.now() + ECHO_DISCARD_MS; };
  useEffect(() => {
    const id = position.addListener(({ value }) => {
      if (echoCounts({ dragging: live.drag !== null || live.spin !== null, now: Date.now(), staleUntil: live.staleUntil })) arrive(value);
    });
    return () => position.removeListener(id);
  }, []);

  // Hand the values to the native side at once, so the very first drag frame is already drawn there.
  useEffect(() => {
    if (!NATIVE) return;
    Animated.timing(position, { toValue: 0, duration: 0, useNativeDriver: true }).start();
    Animated.timing(lift, { toValue: 0, duration: 0, useNativeDriver: true }).start();
    Animated.timing(float, { toValue: 0, duration: 0, useNativeDriver: true }).start();
  }, []);

  // Under a finger the centre piece comes up a little to meet it, and settles when it lets go.
  const raise = (up: boolean) => {
    if (live.reduced) return;
    Animated.spring(lift, { toValue: up ? LIFT : 0, stiffness: 320, damping: up ? 26 : 20, mass: 1, useNativeDriver: NATIVE }).start();
  };

  const runTo = useCallback((target: number, velocity: number) => {
    live.target = target;
    const animation = live.reduced
      ? Animated.timing(position, { toValue: target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE })
      : Animated.spring(position, { toValue: target, velocity, stiffness: 260, damping: 30, mass: 1, restSpeedThreshold: 0.005, restDisplacementThreshold: 0.001, useNativeDriver: NATIVE });
    animation.start();
  }, []);

  /** Moves along the rail by whole pieces from wherever it is already heading: taps and keys pile up, none is lost. */
  const moveBy = useCallback((delta: number) => {
    if (!live.list.length || !delta) return;
    dropStrip();
    const { min, max } = bounds();
    const target = Math.min(max, Math.max(min, live.target + delta));
    if (target === live.target) return;
    const direction = Math.sign(delta);
    const from = Math.round(live.now);
    if (Math.abs(target - from) <= WINDOW_RADIUS) { runTo(target, 0); return; }
    // Too far to fly past every piece: start two places short of it, the last stretch is the slide people see.
    const landing = mod(live.index + target - live.center, live.list.length);
    const start = mod(landing - 2 * direction, live.list.length);
    discardEchoes();
    position.stopAnimation();
    live.index = start;
    live.center = from;
    live.lastTick = from;
    live.now = from;
    setRail({ id: live.list[start].id, center: from });
    position.setValue(from);
    runTo(from + 2 * direction, 0);
  }, []);

  // A thumbnail tapped: in a looping strip that copy of it, the one the finger is on, whichever way is shorter.
  const pickThumb = useCallback((at: number) => {
    if (live.spin) return;
    const heading = live.target - live.center;
    if (live.loops) moveBy(at - (live.stripCopy + heading));
    else moveBy(shortestDelta(mod(live.index + heading, live.list.length), at, live.list.length));
  }, []);

  const pressSlot = useCallback((at: number) => {
    if (at !== live.center) { moveBy(at - live.target); return; }
    const piece = live.list[live.index];
    if (piece) live.onOpen(piece);
  }, []);

  // A new list (section, added or removed piece) or a piece chosen from the grid: the rail stops where it is
  // and the focused piece is simply there, nothing flies across it.
  const settle = () => {
    endSpin();
    discardEchoes();
    position.stopAnimation();
    position.setValue(live.center);
    // The strip may be anywhere by now: whatever follows it counts from where it really is.
    if (live.loops) live.stripCopy = Math.round(offsetToCopy(live.stripX, live.width));
    live.now = live.target = live.lastTick = live.center;
  };
  const listKey = useMemo(() => list.map(entry => entry.id).join('|'), [list]);
  useLayoutEffect(settle, [listKey]);

  const clearStripTimer = () => { if (live.stripTimer) { clearTimeout(live.stripTimer); live.stripTimer = null; } };
  const endSpin = () => {
    clearStripTimer();
    live.spin = null;
    setSpinPhase('calm');
  };
  const scrollStrip = (copy: number, animated: boolean) => {
    live.stripCopy = copy;
    live.autoUntil = Date.now() + AUTO_SCROLL_MS;
    stripRef.current?.scrollToOffset({ offset: copyOffset(copy, live.width), animated });
  };
  /** The strip goes to whatever the stage has at its centre: the near copy, gliding only if that is a short way. */
  const alignStrip = () => {
    if (!live.loops || !live.list.length) return;
    const { copy, animated, aligned } = stripReturn(offsetToCopy(live.stripX, live.width), mod(live.index + live.target - live.center, live.list.length), live.list.length);
    live.stripCopy = copy;
    if (!aligned) scrollStrip(copy, animated && !live.reduced);
  };
  /** The strip gives way to something else moving the rail. */
  function dropStrip() {
    if (!live.spin) return;
    endSpin();
    live.target = Math.round(live.now);
    alignStrip();
  }
  const beginStrip = () => {
    live.stripHeld = true;
    if (!live.loops || !live.list.length) return;
    clearStripTimer();
    if (live.spin) { live.spin.dragging = true; live.spin.aligning = false; live.spin.momentum = false; return; }
    if (live.drag) return;
    position.stopAnimation();
    const place = offsetToCopy(live.stripX, live.width);
    const shift = stripShift(place, live.now, live.center, live.index, live.list.length);
    live.spin = { shift, slip: live.now - (place + shift), lastPlace: place, lastAt: Date.now(), lastSkip: 0, speed: 0, tickPlace: Math.round(place), dragging: true, aligning: false, momentum: false, phase: 'calm' };
  };
  const finishStrip = () => {
    const spin = live.spin;
    if (!spin || spin.dragging) return;
    clearStripTimer();
    spin.momentum = false;
    const place = Math.round(offsetToCopy(live.stripX, live.width));
    const aligned = Math.abs(copyOffset(place, live.width) - live.stripX) < 0.5;
    // The native snap has it there already; where there is none (the web, a stop under a finger) it is done here.
    if (!aligned && !spin.aligning) {
      spin.aligning = true;
      stripRef.current?.scrollToOffset({ offset: copyOffset(place, live.width), animated: !live.reduced });
      watchStrip();
      return;
    }
    // The stage may be behind a fast strip: what stands next to it becomes what the strip stopped on.
    let target = place + spin.shift;
    const behind = Math.round(target - live.now);
    if (Math.abs(behind) > 1) {
      live.index = mod(live.index + behind, live.list.length);
      target -= behind;
      setRail({ id: live.list[live.index].id, center: live.center });
    }
    endSpin();
    live.stripCopy = place;
    live.lastTick = target;
    discardEchoes();
    runTo(target, 0);
    const home = recentred(place, live.list.length);
    if (home !== place) {
      scrollStrip(home, false);
      live.stripX = copyOffset(home, live.width);
    }
  };
  function watchStrip() {
    clearStripTimer();
    live.stripTimer = setTimeout(() => {
      live.stripTimer = null;
      if (live.spin) finishStrip();
      else if (!live.stripHeld) alignStrip();
    }, live.spin?.momentum ? STRIP_MOMENTUM_SILENCE_MS : STRIP_IDLE_MS);
  }
  const onStripDragEnd = () => {
    live.stripHeld = false;
    if (live.spin) live.spin.dragging = false;
    watchStrip();
  };
  const onStripMomentumBegin = () => {
    if (live.spin) { live.spin.momentum = true; watchStrip(); }
    else clearStripTimer();
  };
  // A scroll that ended with no spin (a piece chosen from the grid mid-glide, a finger here while another held the stage) answers to the stage.
  const onStripMomentumEnd = () => {
    if (live.spin) finishStrip();
    else if (!live.stripHeld) alignStrip();
  };
  const onStripOffset = (x: number) => {
    live.stripX = x;
    if (!live.loops) return;
    const now = Date.now();
    // The web has no drag events for a wheel: a scroll nobody here asked for is the user's.
    if (!live.spin && Platform.OS === 'web' && now >= live.autoUntil && !live.drag) { beginStrip(); if (live.spin) (live.spin as StripSpin).dragging = false; }
    const spin = live.spin;
    if (!spin) return;
    const place = offsetToCopy(x, live.width);
    const dt = Math.max(1, now - spin.lastAt);
    spin.speed = spin.speed * 0.7 + 0.3 * Math.abs(place - spin.lastPlace) * 1000 / dt;
    const tick = stripTick(place, spin.tickPlace, now, live.tickAt);
    if (tick !== null) { spin.tickPlace = tick; live.tickAt = now; selectionHaptic(); }
    const target = place + spin.shift + spin.slip;
    spin.slip *= 0.85;
    const shown = stageFollow(live.now, target, dt);
    const skip = stageSkip(shown, target, now - spin.lastSkip);
    if (skip) {
      spin.shift -= skip;
      spin.lastSkip = now;
      live.index = mod(live.index + skip, live.list.length);
      setRail({ id: live.list[live.index].id, center: live.center });
    }
    spin.lastPlace = place;
    spin.lastAt = now;
    position.setValue(shown);
    arrive(shown);
    if (!live.reduced) {
      const phase = nextSpinPhase(spin.phase, spin.speed);
      if (phase !== spin.phase) { spin.phase = phase; setSpinPhase(phase); }
    }
    if (!spin.dragging) watchStrip();
  };
  const stripEvents = useRef({ onStripOffset }).current;
  stripEvents.onStripOffset = onStripOffset;
  const onStripScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: NATIVE,
    listener: (event: any) => stripEvents.onStripOffset(event.nativeEvent.contentOffset.x)
  })).current;
  useEffect(() => clearStripTimer, []);

  const land = (velocityX: number) => {
    const drag = live.drag;
    live.drag = null;
    if (!drag) return;
    raise(false);
    discardEchoes();
    const { min, max } = bounds();
    const target = snapTarget({ position: Math.min(max, Math.max(min, live.now)), velocityX, anchor: live.target, origin: drag.origin, min, max });
    runTo(target, Math.max(-14, Math.min(14, -velocityX * 1000 / live.pitch)));
  };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_, g) => {
      dropStrip();
      // Take the rail wherever it is, mid-flight included; the native side confirms the exact place a frame later.
      const drag = { base: live.now, grab: g.dx, dx: g.dx, origin: live.now };
      live.drag = drag;
      position.stopAnimation(value => {
        if (live.drag !== drag) return;
        drag.base = value;
        drag.origin = value;
        const { min, max } = bounds();
        const next = rubberBand(value - (drag.dx - drag.grab) / live.pitch, min, max);
        position.setValue(next);
        arrive(next);
      });
      raise(true);
    },
    onPanResponderMove: (_, g) => {
      const drag = live.drag;
      if (!drag) return;
      drag.dx = g.dx;
      const { min, max } = bounds();
      const next = rubberBand(drag.base - (g.dx - drag.grab) / live.pitch, min, max);
      position.setValue(next);
      arrive(next);
    },
    onPanResponderRelease: (_, g) => land(g.vx),
    onPanResponderTerminate: (_, g) => land(g.vx)
  })).current;

  // At rest the centre piece drifts a little. Each round starts where the last one ended, so the loop has no seam.
  useEffect(() => {
    if (reduced) { float.setValue(0); lift.setValue(0); return; }
    if (allOpen || paused) { raise(false); return; }
    float.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, allOpen, paused]);

  // The name changes with the piece, softened rather than cross-faded: fast flicks must not leave it blank.
  useEffect(() => {
    if (reduced || spinning) { textFade.setValue(1); return; }
    textFade.setValue(0.4);
    Animated.timing(textFade, { toValue: 1, duration: 180, useNativeDriver: NATIVE }).start();
  }, [focusId, reduced]);

  // The row: a run of copies when it goes round, the pieces themselves when it fits. A new list starts it afresh, in place.
  const loops = stripLoops(count, width);
  live.loops = loops;
  const stripStart = useMemo(() => {
    const copy = loops ? stripMiddle(index, count) : index;
    live.stripCopy = copy;
    live.stripX = loops ? copyOffset(copy, width) : 0;
    return copy;
  }, [listKey, loops, width]);
  const stripData = useMemo(() => Array.from({ length: loops ? stripRun(count) : count }, (_, at) => at), [loops, count]);
  useLayoutEffect(() => { if (loops) scrollX.setValue(copyOffset(stripStart, width)); }, [stripStart, listKey, loops, width]);
  // The web takes no starting offset from a prop.
  useEffect(() => {
    if (loops && Platform.OS === 'web') { live.autoUntil = Date.now() + AUTO_SCROLL_MS; stripRef.current?.scrollToOffset({ offset: copyOffset(stripStart, width), animated: false }); }
  }, [listKey, loops, width]);

  // Whatever moved the rail other than the strip: the strip comes after it, the short way round. The strip leading is left alone.
  useEffect(() => {
    if (!loops || live.spin) return;
    const copy = nearestCopy(live.stripCopy, index, count);
    if (copy !== live.stripCopy) scrollStrip(copy, !reduced && Math.abs(copy - live.stripCopy) <= STRIP_GLIDE_BACK);
  }, [index, count, loops, reduced]);

  // Pieces beyond the mounted window, fetched ahead when they come from the network (the mounted ones decode by themselves).
  useEffect(() => {
    if (spinning || count <= WINDOW_RADIUS * 2 + 1) return;
    for (const step of [-WINDOW_RADIUS - 1, WINDOW_RADIUS + 1]) {
      const uri = list[mod(index + step, count)]?.imageUri;
      if (uri && /^https?:/i.test(uri)) Image.prefetch(uri).catch(() => {});
    }
  }, [index, count, list, spinning]);

  // Reflections' small copies, ahead of the pieces sliding in: the focused piece's is taken first.
  useEffect(() => {
    if (!atRest) return;
    for (const at of windowIndices(index, count)) {
      const uri = list[at]?.imageUri;
      if (uri) prepareReflectionCopy(uri);
    }
  }, [index, count, list, atRest]);

  // Web: the arrows move the rail, unless someone is typing or a sheet is over it.
  useEffect(() => {
    if (Platform.OS !== 'web' || allOpen) return;
    const doc = (globalThis as any).document;
    const target = (globalThis as any).window;
    if (!doc || !target) return;
    const onKey = (event: { key: string; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; preventDefault: () => void }) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(doc.activeElement?.tagName || '') || doc.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      moveBy(event.key === 'ArrowRight' ? 1 : -1);
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [allOpen]);

  const slots = useMemo(() => {
    // While the strip spins the stage holds only the piece and its two neighbours.
    const places = railWindow(center, index, count, spinning ? 1 : WINDOW_RADIUS);
    return places.length ? places.map(at => ({ at, entry: list[mod(index + at - center, count)] as WardrobeItem | undefined })) : [{ at: center, entry: undefined }];
  }, [center, index, count, list, spinning]);
  // Who is announced as chosen; nothing about the look depends on it in a looping strip, and a spin doesn't re-render the row for it.
  const selectedRef = useRef(focusId);
  if (atRest) selectedRef.current = focusId;
  const selectedId = selectedRef.current;
  const renderThumb = useCallback(({ item: at }: { item: number }) => {
    const entry = list[mod(at, count)];
    if (!entry) return null;
    return loops
      ? <LoopThumb entry={entry} at={at} scrollX={scrollX} viewWidth={width} selected={entry.id === selectedId} onPick={pickThumb} />
      : <StripThumb entry={entry} at={at} on={entry.id === selectedId ? 1 : 0} selected={entry.id === selectedId} onPick={pickThumb} />;
  }, [list, count, loops, width, selectedId, pickThumb]);
  const thumbLayout = useCallback((_: unknown, at: number) => ({ length: THUMB_PITCH, offset: THUMB_PITCH * at, index: at }), []);
  const thumbKey = useCallback((at: number) => String(at), []);
  const stripCells = Math.ceil(width / THUMB_PITCH) + 3;
  const facts = item ? [t(item.category), item.profile?.material || item.material, item.season && item.season !== 'Не определено' ? t(item.season).toLocaleLowerCase() : '']
    .filter(Boolean) : [];
  const ink = isDark ? INK_ON_DARK : INK;
  const soft = inkSoft(isDark);
  const found = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    return items.filter(entry => `${entry.name} ${entry.category} ${entry.color}`.toLocaleLowerCase().includes(wanted));
  }, [items, query]);
  const openLabel = item ? t('Открыть {name}', { name: item.name }) : undefined;
  const placeText = t('{n} из {count}', { n: index + 1, count });

  return (
    <View style={{ flex: 1 }}>
      {/* Header: the wardrobe and its size, everything at once, adding a piece */}
      <View style={styles.header}>
        <Text style={[font('semibold'), { fontSize: 15, color: ink }]}>{t('Гардероб')} <Text style={[font('regular'), { color: soft, fontSize: 13 }]}>{items.length}</Text></Text>
        <View style={styles.headerActions}>
          {onHelp ? <Pill icon={CircleHelp} size="icon" onPress={onHelp} accessibilityLabel={t('Открыть справку')} /> : null}
          <Pill icon={LayoutGrid} title={t('Все вещи')} size="sm" onPress={() => setAllOpen(true)} />
          <Pill icon={Plus} variant="primary" size="icon" onPress={onAdd} disabled={addDisabled} accessibilityLabel={t('Добавить вещь')} />
        </View>
      </View>

      {/* The piece in focus */}
      <Animated.View style={{ opacity: textFade, marginTop: 18 }}>
        <Text style={[font('regular'), styles.facts, { color: soft }]} numberOfLines={1}>{facts.join(', ')}</Text>
        <Text style={[font('semibold'), styles.name, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item?.name}</Text>
      </Animated.View>

      {/* The stage */}
      <View style={styles.stage} onLayout={event => setStageHeight(event.nativeEvent.layout.height)} {...pan.panHandlers}
        onTouchStart={() => raise(true)} onTouchEnd={() => raise(false)} onTouchCancel={() => raise(false)}
        accessible focusable={Platform.OS === 'web'} accessibilityRole={count > 1 ? 'adjustable' : 'button'} accessibilityLabel={openLabel}
        accessibilityValue={count > 1 ? { text: placeText } : undefined}
        accessibilityActions={count > 1 ? [{ name: 'activate' }, { name: 'increment' }, { name: 'decrement' }] : [{ name: 'activate' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') moveBy(1);
          else if (event.nativeEvent.actionName === 'decrement') moveBy(-1);
          else if (item) onOpen(item);
        }}>
        {stageHeight ? <View collapsable={false} pointerEvents="none" style={styles.flatPlane}>
          {slots.filter(({ at, entry }) => entry && showsReflection(at, center)).map(({ at, entry }) => (
            <Glow key={at} at={at} position={position} geometry={geometry} color={studioTint(entry) || '#FFFFFF'} opacity={isDark ? 0.32 : 0.95} />
          ))}
        </View> : null}
        {stageHeight ? slots.map(({ at, entry }) => (
          <ShowcaseSlot key={`${at}:${reduced}`} at={at} item={entry} geometry={geometry} position={position} lift={lift} floatY={floatY}
            depth={3 - Math.abs(at - center)} reflected={atRest && showsReflection(at, center)} reduced={reduced} reflectionOpacity={isDark ? 0.34 : 0.42} fadeIn={spunOnce.current} onPress={pressSlot} />
        )) : null}
        {count > 1 ? <View pointerEvents="none" style={styles.position}><Text style={[font('regular'), { fontSize: 12, color: soft }]}>{placeText}</Text></View> : null}
      </View>

      {/* Actions for the piece in focus */}
      {item ? <View style={styles.actions}>
        <Pill title={t('Примерить')} icon={PersonStanding} variant="primary" style={{ flex: 1 }} onPress={() => onTryOn(item)} />
        {onStyleWith ? <Pill title={t('С чем носить')} icon={Layers} style={{ flex: 1 }} onPress={() => onStyleWith(item)} /> : null}
      </View> : null}

      {/* Sections, then the section as a row; the piece in focus lifted */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 18 }} contentContainerStyle={styles.sections}>
        {['Все', ...present].map(name => (
          <AppPressable key={name} accessibilityRole="button" accessibilityState={{ selected: section === name }} hitSlop={12} onPress={() => setSection(name)}>
            <Text style={[font(section === name ? 'semibold' : 'regular'), { fontSize: 13, color: section === name ? ink : soft }]}>
              {t(name)}{name === 'Все' ? <Text style={{ color: soft }}> {items.length}</Text> : null}
            </Text>
          </AppPressable>
        ))}
      </ScrollView>
      {loops ? (
        // VoiceOver can't get out of an endless row and its focus drags the row off the stage: the stage is adjustable and «Все вещи» lists everything.
        <View collapsable={false} style={styles.stripList} accessibilityElementsHidden={screenReader} importantForAccessibility={screenReader ? 'no-hide-descendants' : 'auto'}>
        <AnimatedNumberList key={`loop:${width}:${listKey}`} ref={stripRef} horizontal data={stripData} keyExtractor={thumbKey} renderItem={renderThumb} extraData={renderThumb} getItemLayout={thumbLayout}
          showsHorizontalScrollIndicator={false} style={styles.stripInner} contentContainerStyle={styles.stripLoop} bounces={false}
          initialScrollIndex={Math.max(0, stripStart - Math.ceil(stripCells / 2))} contentOffset={{ x: copyOffset(stripStart, width), y: 0 }}
          initialNumToRender={stripCells} maxToRenderPerBatch={stripCells} updateCellsBatchingPeriod={16} windowSize={5}
          snapToInterval={THUMB_PITCH} snapToAlignment="center" disableIntervalMomentum={reduced} decelerationRate={reduced ? 'fast' : STRIP_DECELERATION}
          scrollEventThrottle={16} onScroll={onStripScroll} onScrollBeginDrag={beginStrip}
          onScrollEndDrag={onStripDragEnd} onMomentumScrollBegin={onStripMomentumBegin} onMomentumScrollEnd={onStripMomentumEnd} />
        </View>
      ) : (
        <FlatList key="still" horizontal scrollEnabled={false} data={stripData} keyExtractor={thumbKey} renderItem={renderThumb} extraData={renderThumb} getItemLayout={thumbLayout}
          showsHorizontalScrollIndicator={false} style={styles.stripList} contentContainerStyle={styles.stripStill} />
      )}

      {/* Everything at once */}
      <StudioSheet visible={allOpen} title={t('Все вещи')} onClose={() => setAllOpen(false)} height="86%" scroll={false}>
        <View style={[styles.search, { backgroundColor: isDark ? '#24272C' : '#EFEFED' }]}>
          <Search size={16} color={INK_FAINT} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('Найти вещь')} placeholderTextColor={INK_FAINT}
            style={[font('regular'), { flex: 1, fontSize: 15, color: ink, height: '100%' }]} returnKeyType="done" accessibilityLabel={t('Найти вещь')} />
        </View>
        <SheetFlatList data={found} numColumns={3} keyExtractor={entry => entry.id} columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          renderItem={({ item: entry }) => (
            <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} style={{ flex: 1 / 3 }}
              onPress={() => { setSection('Все'); settle(); setRail(current => ({ ...current, id: entry.id })); setAllOpen(false); }}>
              <LinearGradient colors={isDark ? ['#2A2D32', `${studioTint(entry) || '#22252A'}33`] : ['#FFFFFF', studioTint(entry) || '#F0F0EE']} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={styles.tile}>
                <GarmentImage item={entry} style={{ width: '100%', height: 84 }} />
                <Text style={[font('medium'), { fontSize: 12, lineHeight: 15, color: ink, marginTop: 6 }]} numberOfLines={2}>{entry.name}</Text>
              </LinearGradient>
            </AppPressable>
          )}
          ListEmptyComponent={<Text style={[font('regular'), { color: soft, fontSize: 14, paddingTop: 6 }]}>{t('Ничего не нашлось. Попробуй другое слово.')}</Text>} />
      </StudioSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  facts: { fontSize: 13 },
  name: { fontSize: 26, lineHeight: 32, letterSpacing: -0.7, marginTop: 2 },
  flatPlane: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  stage: { flex: 1, minHeight: 220, marginHorizontal: -16, overflow: 'hidden' },
  position: { position: 'absolute', right: 20, bottom: 4, zIndex: 5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  sections: { gap: 16, paddingRight: 16 },
  strip: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  stripList: { flexGrow: 0, marginTop: 10, marginHorizontal: -16 },
  stripInner: { flexGrow: 0 },
  stripLoop: { paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  stripStill: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  // The thumbnail in the middle of its cell: the native snap centres the cell.
  thumbCell: { width: THUMB_PITCH, alignItems: 'center' },
  thumb: { width: 60, height: 72, borderRadius: 18, backgroundColor: darkColors.stage, alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: 46, height: 52 },
  thumbOn: { borderRadius: 18, borderWidth: 1.5, borderColor: INK },
  search: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  tile: { borderRadius: 20, padding: 8, paddingBottom: 10 }
});
