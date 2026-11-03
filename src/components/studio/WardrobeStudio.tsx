import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SheetFlatList } from '../ui/FormScrollView';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Path } from 'react-native-svg';
import { CircleHelp, Layers, LayoutGrid, PersonStanding, Plus, Search } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { selectionHaptic } from '../../services/haptics';
import { AppPressable } from '../AppPressable';
import { Glass, Pill } from './Glass';
import { useStudioTint } from './StudioBackdrop';
import { FloorShadow, GarmentImage } from './Garment';
import { centreTick, fitBox, mod, railBounds, railWindow, restingKind, rubberBand, shortestDelta, snapTarget, stripOffset, swingFactor, swingFromVelocity, swingKick, THUMB_PITCH, WINDOW_RADIUS } from './railMotion';
import { font, INK, INK_FAINT, INK_ON_DARK, inkSoft, isCutout, studioTint, useReducedMotion } from './studio';
import { StudioSheet } from './StudioSheet';
import { useAspects } from './useAspects';

const NATIVE = Platform.OS !== 'web';
const RAIL_Y = 12;
/** The hook's top above the rail, and the garment's top below the hook's: the shoulders disappear inside the piece. */
const HOOK_UP = 7;
const HANG_DROP = 24;
const SIDE_SCALE = 0.62;
const SIDE_OPACITY = 0.5;
const MAX_LEAN_DEG = 9;
const IDLE_SWAY = 0.06;
const TICK_GAP_MS = 40;

/** A hanger as one thin line: the hook round the rail, the neck, the shoulders and the bar. */
const Hanger = memo(function Hanger({ width, color }: { width: number; color: string }) {
  const c = width / 2;
  const hook = `M${c} 19 L${c} 14 C${c} 11 ${c + 5} 10 ${c + 5} 5.5 C${c + 5} 2.5 ${c + 2.5} 1 ${c} 1 C${c - 2.5} 1 ${c - 4.6} 2.6 ${c - 5} 5`;
  const body = `M${c} 19 L3 34 Q0.5 37 4 37 L${width - 4} 37 Q${width - 0.5} 37 ${width - 3} 34 Z`;
  return (
    <Svg width={width} height={38}>
      <Path d={`${hook} ${body}`} stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
});

type SlotGeometry = { side: number; shelfSide: number; shelfY: number; pitch: number; stageWidth: number };

type SlotProps = {
  at: number;
  item?: WardrobeItem;
  geometry: SlotGeometry;
  position: Animated.Value;
  angle: Animated.AnimatedAddition<number>;
  front: boolean;
  reduced: boolean;
  line: string;
  onPress: (at: number) => void;
};

/**
 * One place on the rail. Everything it does between renders is an interpolation of the rail's position on the
 * native side, so a finger moving costs no React work. A piece turns and scales about its hook (or its foot on
 * the shelf), which keeps it on the line however far from the centre it is.
 */
const RailSlot = memo(function RailSlot({ at, item, geometry, position, angle, front, reduced, line, onPress }: SlotProps) {
  const { side, shelfSide, shelfY, pitch, stageWidth } = geometry;
  const standing = restingKind(item?.section) === 'stand';
  const aspects = useAspects(useMemo(() => item ? [item] : undefined, [item]));
  const print = Boolean(item?.imageUri && !isCutout(item.imageUri));
  const box = print ? { width: side, height: side } : fitBox(item ? aspects[item.id] : undefined, standing ? shelfSide : side);
  const height = standing ? shelfSide : HANG_DROP + side;
  const width = Math.max(side, box.width);
  const top = standing ? shelfY - shelfSide : RAIL_Y - HOOK_UP;
  // From the slot's centre to the point it turns about: the hook above, the foot below.
  const pivot = standing ? height / 2 : HOOK_UP - height / 2;
  const motion = useMemo(() => {
    const lean = MAX_LEAN_DEG * swingFactor(at);
    const translateX = position.interpolate({ inputRange: [at - 1, at + 1], outputRange: [pitch, -pitch] });
    const scale = position.interpolate({ inputRange: [at - 1, at, at + 1], outputRange: [SIDE_SCALE, 1, SIDE_SCALE], extrapolate: 'clamp' });
    const opacity = position.interpolate({ inputRange: [at - 1, at, at + 1], outputRange: [SIDE_OPACITY, 1, SIDE_OPACITY], extrapolate: 'clamp' });
    const rotate = angle.interpolate({ inputRange: [-1, 1], outputRange: [`${-lean}deg`, `${lean}deg`] });
    return { translateX, scale, opacity, rotate };
  }, [at, pitch, position, angle]);
  const swings = !standing && !reduced;
  const hanger = Math.max(56, Math.min(box.width * 0.72, side * 0.62));
  return (
    <Animated.View pointerEvents="box-none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, left: (stageWidth - width) / 2, width, height, zIndex: front ? 2 : 1, opacity: motion.opacity,
        transform: [{ translateX: motion.translateX }, { translateY: pivot }, { scale: motion.scale },
          ...(swings ? [{ rotate: motion.rotate }] : []), { translateY: -pivot }] }}>
      {standing ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -17, alignItems: 'center' }}><FloorShadow width={box.width * 0.8} opacity={0.22} /></View>
        : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: (width - hanger) / 2, width: hanger }}><Hanger width={hanger} color={line} /></View>}
      <AppPressable accessible={false} onPress={() => onPress(at)}
        style={{ position: 'absolute', left: (width - box.width) / 2, top: standing ? height - box.height : HANG_DROP - (print ? side * 0.04 : 0), width: box.width, height: box.height }}>
        <GarmentImage item={item} print style={{ width: box.width, height: box.height }} />
      </AppPressable>
    </Animated.View>
  );
});

const StripThumb = memo(function StripThumb({ entry, at, on, onPick }: { entry: WardrobeItem; at: number; on: boolean; onPick: (at: number) => void }) {
  return (
    <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} accessibilityState={{ selected: on }}
      onPress={() => onPick(at)} style={[styles.thumb, on && styles.thumbOn]}>
      <GarmentImage item={entry} style={styles.thumbImage} />
    </AppPressable>
  );
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
};

/**
 * The wardrobe as a rail in a photo studio: pieces hang on a thin rail (what does not hang stands on a shelf line)
 * and slide along it under the finger, swinging about their hooks and ticking past the centre; the light turns
 * to the piece that stays. Tap the row below to go to one. «Все вещи» opens everything as a grid with search.
 *
 * The rail's position is one number in pieces on the native side. `rail.center` is the whole place nearest to
 * it, moved on only when another piece becomes nearest; that and nothing else re-renders this screen in motion.
 */
export function WardrobeStudio({ items, sections, onOpen, onAdd, onTryOn, onStyleWith, onHelp, addDisabled }: Props) {
  const t = useT();
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [section, setSection] = useState('Все');
  const [rail, setRail] = useState<{ id: string | null; center: number }>({ id: items[0]?.id ?? null, center: 0 });
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stageHeight, setStageHeight] = useState(0);

  const present = useMemo(() => sections.filter(name => items.some(item => item.section === name)), [items, sections]);
  const list = useMemo(() => section === 'Все' ? items : items.filter(item => item.section === section), [items, section]);
  const count = list.length;
  const center = rail.center;
  const index = Math.max(0, list.findIndex(item => item.id === rail.id));
  const item = list[index];
  const focusId = item?.id ?? null;
  useEffect(() => { if (focusId !== rail.id) setRail(current => ({ ...current, id: focusId })); }, [focusId, rail.id]);
  // The last piece of a section gone: back to everything rather than to an empty stage with no way to name it.
  useEffect(() => { if (section !== 'Все' && !present.includes(section)) setSection('Все'); }, [present, section]);

  // The light follows the piece that stays: a full-screen gradient per piece passed would cost a flick its frames.
  const tint = studioTint(item);
  const [restingTint, setRestingTint] = useState(tint);
  useEffect(() => {
    const timer = setTimeout(() => setRestingTint(tint), 160);
    return () => clearTimeout(timer);
  }, [tint]);
  useStudioTint(restingTint, 0.46);

  const position = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const angle = useRef(Animated.add(swing, sway)).current;
  const textFade = useRef(new Animated.Value(1)).current;
  const shelf = useRef(new Animated.Value(0)).current;
  const stripRef = useRef<FlatList<WardrobeItem>>(null);

  const heroSide = Math.max(150, Math.min(stageHeight - (RAIL_Y - HOOK_UP) - HANG_DROP - 14, width - 90));
  const shelfY = Math.max(RAIL_Y + 120, stageHeight - 20);
  const geometry = useMemo<SlotGeometry>(() => ({
    side: heroSide, shelfSide: Math.max(100, Math.min(heroSide * 0.8, shelfY - RAIL_Y - 30)), shelfY, pitch: width * 0.58, stageWidth: width
  }), [heroSide, shelfY, width]);

  // What gesture handlers, created once, read: updated in place by a move so that the next one, even before
  // React has rendered, already counts from it.
  const live = useRef({
    list, index, center, reduced, pitch: geometry.pitch, onOpen,
    now: 0, target: 0, swing: 0, swingFree: false, lastTick: 0, lastTickAt: 0, run: 0,
    drag: null as null | { base: number; grab: number; dx: number; origin: number }
  }).current;
  live.list = list;
  live.index = index;
  live.center = center;
  live.reduced = reduced;
  live.pitch = geometry.pitch;
  live.onOpen = onOpen;

  const bounds = () => railBounds(live.center, live.index, live.list.length);

  // Whichever piece is nearest becomes the focus, and a piece arriving at the centre ticks.
  useEffect(() => {
    const id = position.addListener(({ value }) => {
      live.now = value;
      if (!live.list.length) return;
      const { min, max } = bounds();
      const nearest = Math.min(max, Math.max(min, Math.round(value)));
      if (nearest !== live.center) {
        const nextIndex = mod(live.index + nearest - live.center, live.list.length);
        live.index = nextIndex;
        live.center = nearest;
        setRail({ id: live.list[nextIndex].id, center: nearest });
      }
      const tick = centreTick(Math.min(max, Math.max(min, value)), live.lastTick);
      if (tick !== null) {
        live.lastTick = tick;
        const time = Date.now();
        if (time - live.lastTickAt >= TICK_GAP_MS) { live.lastTickAt = time; selectionHaptic(); }
      }
    });
    return () => position.removeListener(id);
  }, []);

  // Hand the values to the native side at once, so the very first drag frame is already drawn there.
  useEffect(() => {
    if (!NATIVE) return;
    Animated.timing(position, { toValue: 0, duration: 0, useNativeDriver: true }).start();
    Animated.timing(swing, { toValue: 0, duration: 0, useNativeDriver: true }).start();
  }, []);

  const swingTo = useCallback((velocity: number) => {
    if (live.reduced) return;
    // The spring's start is whatever lean it finds; the push carries on from there, then dies away.
    live.swingFree = true;
    Animated.spring(swing, { toValue: 0, velocity, stiffness: 72, damping: 6, mass: 1, restSpeedThreshold: 0.01, restDisplacementThreshold: 0.002, useNativeDriver: NATIVE })
      .start();
  }, []);

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
    const { min, max } = bounds();
    const target = Math.min(max, Math.max(min, live.target + delta));
    if (target === live.target) return;
    const direction = Math.sign(delta);
    swingTo(direction * -4);
    const from = Math.round(live.now);
    if (Math.abs(target - from) <= WINDOW_RADIUS) { runTo(target, 0); return; }
    // Too far to fly past every piece: start two places short of it, the last stretch is the slide people see.
    const landing = mod(live.index + target - live.center, live.list.length);
    const start = mod(landing - 2 * direction, live.list.length);
    position.stopAnimation();
    live.index = start;
    live.center = from;
    live.lastTick = from;
    live.now = from;
    setRail({ id: live.list[start].id, center: from });
    position.setValue(from);
    runTo(from + 2 * direction, 0);
  }, []);

  const pickIndex = useCallback((to: number) => {
    moveBy(shortestDelta(mod(live.index + live.target - live.center, live.list.length), to, live.list.length));
  }, []);

  const pressSlot = useCallback((at: number) => {
    if (at !== live.center) { moveBy(at - live.target); return; }
    const piece = live.list[live.index];
    if (piece) live.onOpen(piece);
  }, []);

  // A new list (section, added or removed piece) or a piece chosen from the grid: the rail stops where it is
  // and the focused piece is simply there, nothing flies across it.
  const settle = () => {
    position.stopAnimation();
    position.setValue(live.center);
    live.now = live.target = live.lastTick = live.center;
  };
  const listKey = useMemo(() => list.map(entry => entry.id).join('|'), [list]);
  useLayoutEffect(settle, [listKey]);

  const pauseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pauseTimer.current), []);
  const land = (velocityX: number) => {
    const drag = live.drag;
    live.drag = null;
    clearTimeout(pauseTimer.current);
    if (!drag) return;
    const { min, max } = bounds();
    const target = snapTarget({ position: Math.min(max, Math.max(min, live.now)), velocityX, anchor: live.target, origin: drag.origin, min, max });
    runTo(target, Math.max(-14, Math.min(14, -velocityX * 1000 / live.pitch)));
    swingTo(swingKick(velocityX));
  };
  const catchSwing = () => {
    live.swingFree = false;
    swing.stopAnimation(value => { live.swing = value; });
  };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_, g) => {
      // Take the rail wherever it is, mid-flight included; the native side confirms the exact place a frame later.
      const drag = { base: live.now, grab: g.dx, dx: g.dx, origin: live.now };
      live.drag = drag;
      position.stopAnimation(value => {
        if (live.drag !== drag) return;
        drag.base = value;
        drag.origin = value;
        const { min, max } = bounds();
        position.setValue(rubberBand(value - (drag.dx - drag.grab) / live.pitch, min, max));
      });
      catchSwing();
    },
    onPanResponderMove: (_, g) => {
      const drag = live.drag;
      if (!drag) return;
      drag.dx = g.dx;
      const { min, max } = bounds();
      position.setValue(rubberBand(drag.base - (g.dx - drag.grab) / live.pitch, min, max));
      if (live.reduced) return;
      if (live.swingFree) { catchSwing(); return; }
      live.swing += (swingFromVelocity(g.vx) - live.swing) * 0.35;
      swing.setValue(live.swing);
      // A finger that stops sends no events: the piece comes to rest under it by itself.
      clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => { if (live.drag) swingTo(0); }, 90);
    },
    onPanResponderRelease: (_, g) => land(g.vx),
    onPanResponderTerminate: (_, g) => land(g.vx)
  })).current;

  // At rest they breathe a little around the hook; it adds to the swing rather than competing with it.
  useEffect(() => {
    if (reduced) { sway.setValue(0); swing.stopAnimation(); swing.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: IDLE_SWAY, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(sway, { toValue: -IDLE_SWAY, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced]);

  // The name changes with the piece, softened rather than cross-faded: fast flicks must not leave it blank.
  useEffect(() => {
    if (reduced) { textFade.setValue(1); return; }
    textFade.setValue(0.4);
    Animated.timing(textFade, { toValue: 1, duration: 180, useNativeDriver: NATIVE }).start();
  }, [focusId, reduced]);

  // The shelf line comes up only for what stands on it.
  const standing = restingKind(item?.section) === 'stand';
  useEffect(() => {
    Animated.timing(shelf, { toValue: standing ? 1 : 0, duration: reduced ? 0 : 200, useNativeDriver: NATIVE }).start();
  }, [standing, reduced]);

  // The row keeps the piece in focus in view.
  useEffect(() => {
    stripRef.current?.scrollToOffset({ offset: stripOffset(index, count, width), animated: !reduced });
  }, [index, count, width, reduced]);

  // Pieces beyond the mounted window, fetched ahead when they come from the network (the mounted ones decode by themselves).
  useEffect(() => {
    if (count <= WINDOW_RADIUS * 2 + 1) return;
    for (const step of [-WINDOW_RADIUS - 1, WINDOW_RADIUS + 1]) {
      const uri = list[mod(index + step, count)]?.imageUri;
      if (uri && /^https?:/i.test(uri)) Image.prefetch(uri).catch(() => {});
    }
  }, [index, count, list]);

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
    const places = railWindow(center, index, count);
    return places.length ? places.map(at => ({ at, entry: list[mod(index + at - center, count)] as WardrobeItem | undefined })) : [{ at: center, entry: undefined }];
  }, [center, index, count, list]);
  const line = isDark ? 'rgba(244,245,247,0.42)' : 'rgba(18,20,23,0.34)';
  const renderThumb = useCallback(({ item: entry, index: at }: { item: WardrobeItem; index: number }) => (
    <StripThumb entry={entry} at={at} on={entry.id === focusId} onPick={pickIndex} />
  ), [focusId, pickIndex]);
  const thumbLayout = useCallback((_: unknown, at: number) => ({ length: THUMB_PITCH, offset: 16 + THUMB_PITCH * at, index: at }), []);
  const thumbKey = useCallback((entry: WardrobeItem) => entry.id, []);
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
        accessible focusable={Platform.OS === 'web'} accessibilityRole={count > 1 ? 'adjustable' : 'button'} accessibilityLabel={openLabel}
        accessibilityValue={count > 1 ? { text: placeText } : undefined}
        accessibilityActions={count > 1 ? [{ name: 'activate' }, { name: 'increment' }, { name: 'decrement' }] : [{ name: 'activate' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') moveBy(1);
          else if (event.nativeEvent.actionName === 'decrement') moveBy(-1);
          else if (item) onOpen(item);
        }}>
        <View pointerEvents="none" style={{ position: 'absolute', top: RAIL_Y - 1, left: 0 }}>
          <Svg width={width} height={2}><Line x1={0} y1={1} x2={width} y2={1} stroke={line} strokeWidth={1.2} /></Svg>
        </View>
        {stageHeight ? <Animated.View pointerEvents="none" style={{ position: 'absolute', top: shelfY, left: 0, right: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: line, opacity: shelf }} /> : null}
        {stageHeight ? slots.map(({ at, entry }) => (
          <RailSlot key={at} at={at} item={entry} geometry={geometry} position={position} angle={angle} front={at === center} reduced={reduced} line={line} onPress={pressSlot} />
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
          <AppPressable key={name} accessibilityRole="button" accessibilityState={{ selected: section === name }} onPress={() => setSection(name)}>
            <Text style={[font(section === name ? 'semibold' : 'regular'), { fontSize: 13, color: section === name ? ink : soft }]}>
              {t(name === 'Все' ? 'Всё' : name)}{name === 'Все' ? <Text style={{ color: INK_FAINT }}> {items.length}</Text> : null}
            </Text>
          </AppPressable>
        ))}
      </ScrollView>
      <FlatList ref={stripRef} horizontal data={list} keyExtractor={thumbKey} renderItem={renderThumb} extraData={focusId} getItemLayout={thumbLayout}
        showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 10, marginHorizontal: -16 }} contentContainerStyle={styles.strip}
        initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} />

      {/* Everything at once */}
      <StudioSheet visible={allOpen} title={t('Все вещи')} onClose={() => setAllOpen(false)} height="86%" scroll={false}>
        <View style={[styles.search, { backgroundColor: isDark ? '#24272C' : '#EFEFED' }]}>
          <Search size={16} color={INK_FAINT} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('Найти вещь')} placeholderTextColor={INK_FAINT}
            style={[font('regular'), { flex: 1, fontSize: 15, color: ink, height: '100%' }]} returnKeyType="done" accessibilityLabel={t('Найти вещь')} />
        </View>
        <SheetFlatList data={found} numColumns={3} keyExtractor={entry => entry.id} columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}
          renderItem={({ item: entry }) => (
            <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} style={{ flex: 1 / 3 }}
              onPress={() => { setSection('Все'); settle(); setRail(current => ({ ...current, id: entry.id })); setAllOpen(false); }}>
              <LinearGradient colors={[isDark ? '#2A2D32' : '#FFFFFF', studioTint(entry) || (isDark ? '#22252A' : '#F0F0EE')]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={styles.tile}>
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
  name: { fontSize: 34, lineHeight: 40, letterSpacing: -1, marginTop: 2 },
  stage: { flex: 1, minHeight: 220, marginHorizontal: -16, overflow: 'hidden' },
  position: { position: 'absolute', right: 20, bottom: 4, zIndex: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  sections: { gap: 16, paddingRight: 16 },
  strip: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  thumb: { width: 60, height: 72, marginRight: THUMB_PITCH - 60, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: 46, height: 52 },
  thumbOn: { backgroundColor: '#FFFFFF', transform: [{ translateY: -8 }], shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  search: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  tile: { borderRadius: 20, padding: 8, paddingBottom: 10 }
});
