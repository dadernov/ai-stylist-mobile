import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, PanResponder, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CircleHelp, Layers, LayoutGrid, PersonStanding, Plus, Search } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { Glass, Pill } from './Glass';
import { useStudioTint } from './StudioBackdrop';
import { FloorShadow, GarmentImage } from './Garment';
import { font, INK, INK_FAINT, INK_ON_DARK, inkSoft, studioTint, useReducedMotion } from './studio';
import { StudioSheet } from './StudioSheet';

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
  const ink = isDark ? INK_ON_DARK : INK;
  const soft = inkSoft(isDark);
  const found = items.filter(entry => `${entry.name} ${entry.category} ${entry.color}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

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
      <Animated.View style={{ opacity: fade, marginTop: 18 }}>
        <Text style={[font('regular'), styles.facts, { color: soft }]} numberOfLines={1}>{facts.join(', ')}</Text>
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
        {list.length > 1 ? <Text style={[font('regular'), styles.position, { color: soft }]}>{t('{n} из {count}', { n: index + 1, count: list.length })}</Text> : null}
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
      <StudioSheet visible={allOpen} title={t('Все вещи')} onClose={() => setAllOpen(false)} height="86%" scroll={false}>
        <View style={[styles.search, { backgroundColor: isDark ? '#24272C' : '#EFEFED' }]}>
          <Search size={16} color={INK_FAINT} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('Найти вещь')} placeholderTextColor={INK_FAINT}
            style={[font('regular'), { flex: 1, fontSize: 15, color: ink, height: '100%' }]} returnKeyType="done" accessibilityLabel={t('Найти вещь')} />
        </View>
        <FlatList data={found} numColumns={3} keyExtractor={entry => entry.id} columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}
          renderItem={({ item: entry }) => (
            <AppPressable accessibilityRole="button" accessibilityLabel={entry.name} style={{ flex: 1 / 3 }}
              onPress={() => { setSection('Все'); setFocusId(entry.id); setAllOpen(false); }}>
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
  side: { position: 'absolute', top: '22%', opacity: 0.45 },
  floor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  position: { position: 'absolute', right: 20, bottom: 4, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  sections: { gap: 16, paddingRight: 16 },
  strip: { gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  thumb: { width: 60, height: 72, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  thumbOn: { backgroundColor: '#FFFFFF', transform: [{ translateY: -8 }], shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  search: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  tile: { borderRadius: 20, padding: 8, paddingBottom: 10 }
});
