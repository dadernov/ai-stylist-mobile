import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, ImageStyle, Modal, StyleProp, ViewStyle, PanResponder, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { CircleHelp, Layers, LayoutGrid, PersonStanding, Plus, Search, Shirt, X } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { Glass, Pill } from './Glass';
import { useStudioTint } from './StudioBackdrop';
import { font, INK, INK_FAINT, INK_SOFT, isCutout, studioTint, useReducedMotion } from './studio';

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

/** The soft floor shadow under a floating piece. */
function FloorShadow({ width }: { width: number }) {
  return (
    <Svg width={width} height={34}>
      <Defs>
        <RadialGradient id="floor" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#121417" stopOpacity={0.32} />
          <Stop offset="1" stopColor="#121417" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={17} rx={width / 2} ry={17} fill="url(#floor)" />
    </Svg>
  );
}

function GarmentImage({ item, style, blur, print }: { item?: WardrobeItem; style: StyleProp<ImageStyle>; blur?: number; print?: boolean }) {
  if (!item?.imageUri) return <View style={[style as StyleProp<ViewStyle>, { alignItems: 'center', justifyContent: 'center' }]}><Shirt size={48} strokeWidth={1} color={INK_FAINT} /></View>;
  // A photo with its own ground becomes a rounded print; a cut-out floats bare.
  if (print && !isCutout(item.imageUri)) {
    return (
      <View style={[style as StyleProp<ViewStyle>, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image source={{ uri: item.imageUri }} resizeMode="cover" blurRadius={blur}
          style={{ width: '84%', height: '92%', borderRadius: 28 }} />
      </View>
    );
  }
  return <Image source={{ uri: item.imageUri }} style={style} resizeMode="contain" blurRadius={blur} />;
}

/**
 * The wardrobe as a photo studio: one piece at a time in the key light, its neighbours soft at the sides;
 * swipe or tap the row below to change it, the light turning to the new piece's colour. «Все вещи» opens the
 * whole wardrobe as a grid with search, for when there are many.
 */
export function WardrobeStudio({ items, sections, onOpen, onAdd, onTryOn, onStyleWith, onHelp, addDisabled }: Props) {
  const t = useT();
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [section, setSection] = useState('Все');
  const [focusId, setFocusId] = useState<string | null>(items[0]?.id ?? null);
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stageHeight, setStageHeight] = useState(0);

  const present = useMemo(() => sections.filter(name => items.some(item => item.section === name)), [items, sections]);
  const list = useMemo(() => section === 'Все' ? items : items.filter(item => item.section === section), [items, section]);
  const index = Math.max(0, list.findIndex(item => item.id === focusId));
  const item = list[index];
  const previous = list.length > 1 ? list[(index - 1 + list.length) % list.length] : undefined;
  const next = list.length > 1 ? list[(index + 1) % list.length] : undefined;
  useEffect(() => { if (!list.some(entry => entry.id === focusId)) setFocusId(list[0]?.id ?? null); }, [list, focusId]);
  useStudioTint(studioTint(item), 0.46);

  // Switching: the piece slides out to one side and the next comes in from the other; text cross-fades.
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);
  const go = (to: number, dir: 1 | -1) => {
    if (busy.current || !list.length) return;
    const target = list[(to + list.length) % list.length];
    if (!target || target.id === item?.id) return;
    if (reduced) { setFocusId(target.id); return; }
    busy.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: -dir, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true })
    ]).start(() => {
      setFocusId(target.id);
      slide.setValue(dir);
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, damping: 18, stiffness: 160, mass: 0.9, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true })
      ]).start(() => { busy.current = false; });
    });
  };
  const goRef = useRef(go);
  goRef.current = go;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderRelease: (_, g) => { if (Math.abs(g.dx) > 40) goRef.current(indexRef.current + (g.dx < 0 ? 1 : -1), g.dx < 0 ? 1 : -1); }
  })).current;
  const indexRef = useRef(index);
  indexRef.current = index;

  // The piece floats a little, as if lit from below; still when motion is reduced.
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced]);

  const heroSize = Math.max(160, Math.min(stageHeight - 44, width - 90));
  // The piece stands in the middle of the stage, its shadow just under it.
  const heroTop = Math.max(4, (stageHeight - heroSize - 26) / 2);
  const facts = item ? [t(item.category), item.profile?.material || item.material, item.season && item.season !== 'Не определено' ? t(item.season).toLocaleLowerCase() : '']
    .filter(Boolean) : [];
  const ink = isDark ? '#F4F5F7' : INK;
  const found = items.filter(entry => `${entry.name} ${entry.category} ${entry.color}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <View style={{ flex: 1 }}>
      {/* Header: the wardrobe and its size, everything at once, adding a piece */}
      <View style={styles.header}>
        <Text style={[font('semibold'), { fontSize: 15, color: ink }]}>{t('Гардероб')} <Text style={[font('regular'), { color: INK_SOFT, fontSize: 13 }]}>{items.length}</Text></Text>
        <View style={styles.headerActions}>
          {onHelp ? <Pill icon={CircleHelp} size="icon" onPress={onHelp} accessibilityLabel={t('Открыть справку')} /> : null}
          <Pill icon={LayoutGrid} title={t('Все вещи')} size="sm" onPress={() => setAllOpen(true)} />
          <Pill icon={Plus} variant="primary" size="icon" onPress={onAdd} disabled={addDisabled} accessibilityLabel={t('Добавить вещь')} />
        </View>
      </View>

      {/* The piece in focus */}
      <Animated.View style={{ opacity: fade, marginTop: 18 }}>
        <Text style={[font('regular'), styles.facts]} numberOfLines={1}>{facts.join(', ')}</Text>
        <Text style={[font('semibold'), styles.name, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item?.name}</Text>
      </Animated.View>

      {/* The stage */}
      <View style={styles.stage} onLayout={event => setStageHeight(event.nativeEvent.layout.height)} {...pan.panHandlers}>
        {previous ? <GarmentImage item={previous} blur={6} style={[styles.side, { left: -width * 0.2, width: width * 0.4, height: heroSize * 0.6 }]} /> : null}
        {next ? <GarmentImage item={next} blur={6} style={[styles.side, { right: -width * 0.2, width: width * 0.42, height: heroSize * 0.62 }]} /> : null}
        <View style={[styles.floor, { top: heroTop + heroSize - 12 }]}><FloorShadow width={heroSize * 0.62} /></View>
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: heroTop, alignItems: 'center', opacity: fade,
          transform: [{ translateX: slide.interpolate({ inputRange: [-1, 1], outputRange: [-70, 70] }) },
            { scale: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.92, 1, 0.92] }) },
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }) }] }}>
          <AppPressable accessibilityRole="button" accessibilityLabel={item ? t('Открыть {name}', { name: item.name }) : undefined} onPress={() => item && onOpen(item)}>
            <GarmentImage item={item} print style={{ width: heroSize, height: heroSize }} />
          </AppPressable>
        </Animated.View>
        {list.length > 1 ? <Text style={[font('regular'), styles.position]}>{t('{n} из {count}', { n: index + 1, count: list.length })}</Text> : null}
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
            <Text style={[font(section === name ? 'semibold' : 'regular'), { fontSize: 13, color: section === name ? ink : INK_SOFT }]}>
              {t(name === 'Все' ? 'Всё' : name)}{name === 'Все' ? <Text style={{ color: INK_FAINT }}> {items.length}</Text> : null}
            </Text>
          </AppPressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 10, marginHorizontal: -16 }} contentContainerStyle={styles.strip}>
        {list.map((entry, n) => {
          const on = entry.id === item?.id;
          return (
            <AppPressable key={entry.id} accessibilityRole="button" accessibilityLabel={entry.name} accessibilityState={{ selected: on }}
              onPress={() => go(n, n > index ? 1 : -1)} style={[styles.thumb, on && styles.thumbOn]}>
              <GarmentImage item={entry} style={{ width: 46, height: 52 }} />
            </AppPressable>
          );
        })}
      </ScrollView>

      {/* Everything at once */}
      <Modal transparent animationType="slide" visible={allOpen} onRequestClose={() => setAllOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <AppPressable feedback={false} accessibilityLabel={t('Закрыть')} onPress={() => setAllOpen(false)} style={StyleSheet.absoluteFill}>
            <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          </AppPressable>
          <View style={[styles.sheet, { backgroundColor: isDark ? 'rgba(24,26,30,0.97)' : 'rgba(250,250,249,0.97)' }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={[font('semibold'), { fontSize: 22, letterSpacing: -0.6, color: ink }]}>{t('Все вещи')}</Text>
              <Pill icon={X} size="icon" onPress={() => setAllOpen(false)} accessibilityLabel={t('Закрыть')} />
            </View>
            <View style={[styles.search, { backgroundColor: isDark ? '#24272C' : '#EFEFED' }]}>
              <Search size={16} color={INK_FAINT} />
              <TextInput value={query} onChangeText={setQuery} placeholder={t('Найти вещь')} placeholderTextColor={INK_FAINT}
                style={[font('regular'), { flex: 1, fontSize: 15, color: ink, height: '100%' }]} returnKeyType="done" accessibilityLabel={t('Найти вещь')} />
            </View>
            <FlatList data={found} numColumns={3} keyExtractor={entry => entry.id} columnWrapperStyle={{ gap: 10 }}
              contentContainerStyle={{ gap: 10, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 14 }} showsVerticalScrollIndicator={false}
              renderItem={({ item: entry }) => (
                <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} style={{ flex: 1 / 3 }}
                  onPress={() => { setSection('Все'); setFocusId(entry.id); setAllOpen(false); }}>
                  <LinearGradient colors={[isDark ? '#2A2D32' : '#FFFFFF', studioTint(entry) || (isDark ? '#22252A' : '#F0F0EE')]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={styles.tile}>
                    <GarmentImage item={entry} style={{ width: '100%', height: 84 }} />
                    <Text style={[font('medium'), { fontSize: 12, lineHeight: 15, color: ink, marginTop: 6 }]} numberOfLines={2}>{entry.name}</Text>
                  </LinearGradient>
                </AppPressable>
              )}
              ListEmptyComponent={<Text style={[font('regular'), { color: INK_SOFT, fontSize: 14, paddingTop: 20 }]}>{t('Ничего не нашлось. Попробуй другое слово.')}</Text>} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  facts: { fontSize: 13, color: INK_SOFT },
  name: { fontSize: 34, lineHeight: 40, letterSpacing: -1, marginTop: 2 },
  stage: { flex: 1, minHeight: 220, marginHorizontal: -16, overflow: 'hidden' },
  side: { position: 'absolute', top: '22%', opacity: 0.45 },
  floor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  position: { position: 'absolute', right: 20, bottom: 4, fontSize: 12, color: INK_SOFT },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  sections: { gap: 16, paddingRight: 16 },
  strip: { gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  thumb: { width: 60, height: 72, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  thumbOn: { backgroundColor: '#FFFFFF', transform: [{ translateY: -8 }], shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  sheet: { height: '86%', borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: '#D5D7DA', marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 14 },
  search: { marginHorizontal: 20, marginTop: 12, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  tile: { borderRadius: 20, padding: 8, paddingBottom: 10 }
});
