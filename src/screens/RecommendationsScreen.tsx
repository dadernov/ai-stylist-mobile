import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Linking, PanResponder, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowRight, ArrowRightLeft, ChevronDown, ChevronUp, CloudRain, CloudSnow, CloudSun, Heart, Lightbulb, MapPin, PersonStanding, RefreshCw, Shirt, Thermometer, X } from 'lucide-react-native';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { FormScrollView } from '../components/ui/FormScrollView';
import { OptionPicker } from '../components/ui/OptionPicker';
import { AppPressable } from '../components/AppPressable';
import { ChoicePill, Glass, Pill } from '../components/studio/Glass';
import { FloorShadow, GarmentImage } from '../components/studio/Garment';
import { layoutLook } from '../components/studio/lookLayout';
import { StudioSheet } from '../components/studio/StudioSheet';
import { useStudioTint } from '../components/studio/StudioBackdrop';
import { font, studioTint, useReducedMotion } from '../components/studio/studio';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useLanguage, useT } from '../constants/i18n';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { Gender } from '../types/profile';
import { buildLooks, evaluateLook, EVENTS, getOutfitAdvice, getOutfitSwaps, lookCore, OutfitContext, Precipitation, STYLES, wardrobeGaps } from '../domain/outfits';
import { MatchSummary } from '../components/MatchSummary';
import { isLegwear as isTights } from '../domain/legwear';
import { useWeather } from '../components/useWeather';
import { describeWeatherCode } from '../services/weather';
import { useStylistLooks } from '../services/stylistLooks';
import { LookAction, sendLookFeedback } from '../services/ai';
import { hasAiConsent } from '../services/aiConsent';

type Props = {
  items: WardrobeItem[]; gender: Gender; beautyAdvice: boolean; favorites: GeneratedLook[];
  onFavorite: (look: GeneratedLook) => void; onTryOn: (ids: string[]) => void; onWardrobe: () => void;
  // Set from a garment's card: the ideas are then built around that garment.
  anchorRequest?: { id: string; at: number };
  // Looks put aside with "Not now" in the last weeks sink in the ideas.
  dismissed?: string[]; onDismiss?: (core: string) => void;
  // The account the stylist model is asked for; without it only the rule-based ideas are shown.
  login?: string;
};
type PrecipitationChoice = 'auto' | 'none' | 'rain' | 'snow';
type T = ReturnType<typeof useT>;

const onePiece = (item: WardrobeItem) => ['Платье', 'Сарафан', 'Комбинезон'].includes(item.category);

/** Everything said about one look as it stands now (after any swap of a piece). */
function describeLook(look: GeneratedLook, ids: string[], index: number, items: WardrobeItem[], anchorId: string | undefined, precipitation: Precipitation, t: T) {
  const selection = ids.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
  const context: OutfitContext = { style: look.style, event: look.event, temperature: look.temperature ?? null, precipitation };
  const advice = getOutfitAdvice(selection, context, t);
  const match = evaluateLook(selection, context, t);
  const swaps = getOutfitSwaps(selection, items, context, anchorId, t);
  const savedId = `${look.id}:${ids.join(',')}`;
  const palette = [...new Set(selection.map(item => item.color))].filter(color => color && color !== 'Не определено');
  // The stylist's own words hold while the look is as it put it together; after a swap the rules explain it.
  const asComposed = look.source === 'stylist' && ids.join(',') === look.itemIds.join(',');
  const tips = asComposed ? [...(look.why ? [look.why] : []), ...(look.stylingTips || [])] : advice.tips;
  // A rule-made look is named by its pieces, top first: «Свитшот с вышивкой и голубые джинсы».
  const named = selection.filter(item => ['Верх', 'Низ'].includes(item.section) && !isTights(item)).map(item => item.name.trim()).filter(Boolean);
  const title = asComposed && look.title ? look.title
    : named.length ? named.map((name, i) => i ? name.charAt(0).toLocaleLowerCase() + name.slice(1) : name).join(` ${t('и')} `) : t('Образ {number}', { number: index + 1 });
  // The light takes the colour of what is worn on the body: a one-piece, else the top, else the outer layer.
  const main = selection.find(onePiece) || selection.find(item => item.section === 'Верх') || selection.find(item => item.section === 'Верхняя одежда') || selection[0];
  return { selection, advice, match, swaps, savedId, palette, tips, title, main };
}

export function RecommendationsScreen({ items, gender, beautyAdvice, favorites, onFavorite, onTryOn, onWardrobe, anchorRequest, dismissed, onDismiss, login }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [event, setEvent] = useState('Прогулка');
  const [style, setStyle] = useState('Кэжуал');
  const [anchorId, setAnchorId] = useState(anchorRequest?.id || 'any');
  useEffect(() => { if (anchorRequest) { setAnchorId(anchorRequest.id); setAt(0); } }, [anchorRequest?.at]);
  const [weather, setWeather] = useState('');
  const [precipitationChoice, setPrecipitationChoice] = useState<PrecipitationChoice>('auto');
  // Погода подставляется сама, поэтому уточнения живут в листе под кнопкой погоды: образ виден сразу.
  const [tuning, setTuning] = useState(false);
  const { weather: live, error: weatherError, loading: weatherLoading, reload } = useWeather();
  const [hidden, setHidden] = useState<string[]>([]);
  // One look on the stage at a time; pieces swapped in a look are kept while the screen is open.
  const [at, setAt] = useState(0);
  const [swapped, setSwapped] = useState<Record<string, string[]>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  // Saving a look updates its heart without shuffling the list under the user's finger.
  const [favoriteItemIds] = useState(() => [...new Set(favorites.flatMap(look => look.itemIds))]);
  // Read once: a look hidden now leaves the screen at once, and sinks from the next visit.
  const [dismissedAtStart] = useState(() => dismissed || []);
  const manualTemperature = weather.trim() && Number.isFinite(Number(weather.replace(',', '.'))) && Math.abs(Number(weather.replace(',', '.'))) <= 60 ? Number(weather.replace(',', '.')) : null;
  // Ручной ввод главнее, иначе — реальная погода рядом.
  const temperature = manualTemperature ?? (live ? Math.round(live.temperature) : null);
  const precipitation: Precipitation = precipitationChoice === 'auto' ? live?.precipitation ?? null : precipitationChoice === 'none' ? null : precipitationChoice;
  const gaps = useMemo(() => wardrobeGaps(items, { style, event, temperature, precipitation }, t), [items, style, event, temperature, precipitation, t]);
  const liveText = live ? t('Сейчас {temp}°C, {description}', { temp: Math.round(live.temperature), description: t(describeWeatherCode(live.code)) }) + (live.city ? `, ${live.city}` : '')
    : weatherLoading ? t('Определяем погоду…') : weatherError === 'permission' ? t('Разреши доступ к геолокации, чтобы узнать погоду.')
    : weatherError === 'location' ? t('Не удалось определить, где ты. Включи геолокацию или попробуй позже.') : t('Погода недоступна');
  const anchor = items.find(item => item.id === anchorId);
  const ruleLooks = useMemo(() => buildLooks(items, style, event, temperature === null ? '' : `${temperature}°C`, temperature, gender, beautyAdvice, {
    anchorId: anchor?.id, favoriteItemIds, precipitation, wind: manualTemperature === null ? live?.wind ?? null : null, dismissed: dismissedAtStart
  }), [items, style, event, temperature, gender, beautyAdvice, anchor?.id, favoriteItemIds, precipitation, live, manualTemperature, dismissedAtStart]);
  // The stylist model's looks come first; the rule-based ones fill the list after them, and stand
  // in alone while it is off, or when it failed.
  const stylist = useStylistLooks(items, { style, event, gender, temperature, precipitation, anchorId: anchor?.id, avoid: dismissedAtStart.slice(0, 20),
    language: lang, count: 4 }, login);
  const looks = useMemo(() => {
    const known = new Map(items.map(item => [item.id, item]));
    const dismissedCores = new Set(dismissedAtStart);
    const fromStylist: GeneratedLook[] = [];
    for (const look of stylist.looks) {
      const selection = look.itemIds.map(id => known.get(id)).filter(Boolean) as WardrobeItem[];
      const core = lookCore(selection);
      if (!core || dismissedCores.has(core) || fromStylist.some(other => other.id === `ai:${core}`)) continue;
      fromStylist.push({ id: `ai:${core}`, title: look.title, why: look.why, stylingTips: look.tips, source: 'stylist', itemIds: selection.map(item => item.id),
        weather: temperature === null ? '' : `${temperature}°C`, temperature, style, event, makeup: ruleLooks[0]?.makeup || '', hair: ruleLooks[0]?.hair || '' });
    }
    const taken = new Set(fromStylist.map(look => look.id.slice(3)));
    const rest = ruleLooks.filter(look => !taken.has(lookCore(look.itemIds.map(id => known.get(id)).filter(Boolean) as WardrobeItem[])));
    return [...fromStylist, ...rest].slice(0, Math.max(ruleLooks.length, fromStylist.length));
  }, [stylist.looks, ruleLooks, items, dismissedAtStart]);
  const thinking = stylist.status === 'loading';
  const visible = thinking ? [] : looks.filter(look => !hidden.includes(look.id));
  const index = Math.min(at, Math.max(0, visible.length - 1));
  const look = visible[index] as GeneratedLook | undefined;
  const ids = look ? swapped[look.id] || look.itemIds : [];
  const about = look ? describeLook(look, ids, index, items, anchor?.id, precipitation, t) : null;
  const saved = about ? favorites.some(favorite => favorite.id === about.savedId) : false;
  useStudioTint(studioTint(about?.main), 0.42);

  // A new occasion, style, weather or anchor starts again from the first look.
  const fresh = () => { Keyboard.dismiss(); setHidden([]); setAt(0); };
  // What is done with the idea teaches the ideas' order; only with the AI consent given.
  const told = (action: LookAction) => {
    if (login && look && about) { const { selection } = about; const shownAt = index; void hasAiConsent(login).then(ok => { if (ok) sendLookFeedback(action, look, selection, shownAt, precipitation); }); }
  };
  const replace = (from: string, to: string) => { if (look) setSwapped(previous => ({ ...previous, [look.id]: ids.map(id => id === from ? to : id) })); setReplaceId(null); };
  const hide = () => {
    if (!look || !about) return;
    told('dismiss');
    setDetailsOpen(false);
    setHidden(previous => [...previous, look.id]);
    onDismiss?.(lookCore(about.selection));
  };
  const favorite = () => {
    if (!look || !about || saved) return;
    const { advice, savedId, tips, title } = about;
    told('favorite');
    onFavorite({ ...look, title, id: savedId, itemIds: ids, fitReasons: advice.reasons, stylingTips: tips, warnings: advice.warnings, tuckMode: advice.tuckMode });
  };

  // Changing the look: the composition slides out to one side and the next comes in from the other, as in the wardrobe.
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);
  const go = (dir: 1 | -1) => {
    if (busy.current || visible.length < 2) return;
    const target = (index + dir + visible.length) % visible.length;
    setReplaceId(null); setExpanded(false);
    if (reduced) { setAt(target); return; }
    busy.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: -dir, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true })
    ]).start(() => {
      setAt(target);
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
    onPanResponderRelease: (_, g) => { if (Math.abs(g.dx) > 40) goRef.current(g.dx < 0 ? 1 : -1); }
  })).current;

  // The pieces float a little, out of step with each other; still when motion is reduced. While the
  // stylist thinks, the empty stage breathes instead.
  const floatA = useRef(new Animated.Value(0)).current;
  const floatB = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const wave = (value: Animated.Value, duration: number) => Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    ]));
    const loops = [wave(floatA, 2600), wave(floatB, 3100)];
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [reduced]);

  const [stageWidth, setStageWidth] = useState(0);
  const stageHeight = Math.round(Math.min(420, Math.max(280, windowHeight * 0.47)));
  const placed = about && stageWidth ? layoutLook(about.selection, stageWidth, stageHeight) : [];
  const byId = new Map(about?.selection.map(item => [item.id, item]));
  const why = about ? (look?.source === 'stylist' && look.why ? look.why : about.tips[0]) || '' : '';
  const WeatherIcon = precipitation === 'rain' ? CloudRain : precipitation === 'snow' ? CloudSnow : CloudSun;
  const degrees = temperature === null ? t('Погода') : `${temperature > 0 ? '+' : temperature < 0 ? '−' : ''}${Math.abs(temperature)}°`;
  const selectedForSwap = about?.selection.find(item => item.id === replaceId);
  const alternatives = selectedForSwap ? items.filter(item => item.section === selectedForSwap.section && !ids.includes(item.id) && onePiece(item) === onePiece(selectedForSwap)) : [];
  const textFade = { opacity: fade };

  return <FormScrollView contentContainerStyle={styles.content}>
    <ScreenHeader title={t('Что надеть')} right={<Pill size="sm" icon={WeatherIcon} title={degrees} accessibilityLabel={`${t('Погода и основа образа')}: ${degrees}`} onPress={() => { Keyboard.dismiss(); setTuning(true); }} />} />

    {/* Occasion, then the style as quieter words */}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
      {EVENTS.map(value => <ChoicePill key={value} label={t(value)} active={event === value} onPress={() => { setEvent(value); fresh(); }} />)}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.bleed, { marginTop: 12 }]} contentContainerStyle={styles.wordRow} keyboardShouldPersistTaps="handled">
      {STYLES.map(value => <AppPressable key={value} accessibilityRole="button" accessibilityLabel={`${t('Стиль')}: ${t(value)}`} accessibilityState={{ selected: style === value }}
        onPress={() => { setStyle(value); fresh(); }} hitSlop={8}>
        <Text style={[font(style === value ? 'semibold' : 'regular'), styles.word, style === value && { color: c.text }]}>{t(value)}</Text>
      </AppPressable>)}
    </ScrollView>
    {anchor ? <View style={styles.anchor}>
      <Text style={[font('regular'), styles.muted, { flex: 1 }]} numberOfLines={1}>{t('Образы вокруг «{name}»', { name: anchor.name })}</Text>
      <Pill icon={X} size="icon" style={{ transform: [{ scale: 0.8 }] }} accessibilityLabel={t('Без привязки к вещи')} onPress={() => { setAnchorId('any'); fresh(); }} />
    </View> : null}

    {/* The look, composed on the stage: each piece where it is worn */}
    {thinking ? <View style={[styles.stage, { height: stageHeight }]}>
      <Animated.View style={{ opacity: reduced ? 0.5 : floatA.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }}>
        <Shirt size={64} strokeWidth={1} color={c.muted} />
      </Animated.View>
      <Text style={[font('regular'), styles.muted, { marginTop: 14 }]}>{t('Стилист подбирает образы…')}</Text>
    </View> : null}

    {!visible.length && !thinking ? <EmptyState emoji="" title={t(!items.length ? 'Начнём с гардероба' : hidden.length ? 'Все варианты просмотрены' : 'Пока нет подходящих вещей')}
      hint={t(!items.length ? 'Добавь вещи в гардероб, чтобы подобрать сочетания.' : hidden.length ? 'Верни отложенные варианты или выбери другой повод.' : 'Добавь вещи или выбери другой повод и стиль.')}
      actionLabel={t(hidden.length ? 'Вернуть варианты' : 'К гардеробу')} onAction={hidden.length ? () => { setHidden([]); setAt(0); } : onWardrobe} /> : null}

    {look && about ? <>
      <View style={[styles.stage, { height: stageHeight }]} onLayout={e => setStageWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, transform: [
          { translateX: slide.interpolate({ inputRange: [-1, 1], outputRange: [-70, 70] }) },
          { scale: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.92, 1, 0.92] }) }] }]}>
          {/* Shadows first, so a piece lying over another covers its neighbour's shadow */}
          {placed.map(piece => <View key={`shadow-${piece.id}`} pointerEvents="none" style={{ position: 'absolute', left: piece.x + piece.w * 0.15, top: piece.y + piece.h - 14 }}>
            <FloorShadow width={piece.w * 0.7} opacity={0.18} />
          </View>)}
          {placed.map((piece, n) => {
            const float = n % 2 ? floatB : floatA;
            return <Animated.View key={piece.id} pointerEvents="none" style={{ position: 'absolute', left: piece.x, top: piece.y, width: piece.w, height: piece.h,
              transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, n % 2 ? -7 : -9] }) }, { rotate: piece.rotate }] }}>
              <GarmentImage item={byId.get(piece.id)} print printRadius={Math.min(24, piece.w * 0.16)} style={{ width: piece.w, height: piece.h }} />
            </Animated.View>;
          })}
        </Animated.View>
        {visible.length > 1 ? <Animated.Text style={[font('regular'), styles.position, textFade]}>{t('{n} из {count}', { n: index + 1, count: visible.length })}</Animated.Text> : null}
      </View>

      <Animated.View style={textFade}>
        <Text style={[font('semibold'), styles.lookTitle]} numberOfLines={2}>{about.title}</Text>
        <Text style={[font('regular'), styles.why]} numberOfLines={3}>{why}</Text>
        <AppPressable accessibilityRole="button" onPress={() => setDetailsOpen(true)} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
          <Text style={[font('semibold'), styles.link]}>{t('Подробнее')}</Text>
        </AppPressable>
      </Animated.View>

      <View style={styles.actions}>
        <Pill variant="primary" icon={PersonStanding} title={t('Примерить образ')} style={{ flex: 1 }} onPress={() => { told('tryon'); onTryOn(ids); }} />
        <Pill icon={Heart} iconFill={saved} accessibilityLabel={t(saved ? 'Сохранено в избранном' : 'В избранное')} accessibilityState={{ selected: saved }} onPress={favorite} />
        {visible.length > 1 ? <Pill icon={ArrowRight} accessibilityLabel={t('Следующий образ')} onPress={() => go(1)} /> : null}
      </View>
    </> : null}

    {gaps.length && items.length ? <Glass radius={24} style={styles.gaps}>
      <View style={styles.gapsInner}>
        <Lightbulb size={18} strokeWidth={1.8} color={c.muted} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={[font('regular'), styles.body]}>{t('Для точного подбора под «{event}» не хватает: {items}.', { event: t(event).toLocaleLowerCase(), items: gaps.slice(0, 4).join(', ') })}</Text>
          <AppPressable accessibilityRole="button" onPress={onWardrobe} style={{ alignSelf: 'flex-start' }}><Text style={[font('semibold'), styles.link]}>{t('Добавить вещи')}</Text></AppPressable>
        </View>
      </View>
    </Glass> : null}

    {/* Weather, precipitation and the piece to build around */}
    <StudioSheet visible={tuning} title={t('Погода и основа образа')} onClose={() => { Keyboard.dismiss(); setTuning(false); }}>
      <Glass radius={22}>
        <View style={styles.sheetRow}>
          <MapPin size={16} color={c.muted} />
          <Text style={[font('regular'), styles.muted, { flex: 1 }]}>{liveText}</Text>
          {weatherError === 'permission' ? <AppPressable accessibilityRole="button" onPress={() => { void Linking.openSettings().catch(() => {}); }}><Text style={[font('semibold'), styles.link]}>{t('Открыть настройки')}</Text></AppPressable>
            : !weatherLoading ? <AppPressable accessibilityRole="button" accessibilityLabel={t('Обновить погоду')} onPress={() => { void reload(); }} hitSlop={8}><RefreshCw size={16} color={c.text} /></AppPressable> : null}
        </View>
      </Glass>
      <View style={styles.controlRow}>
        <Glass style={styles.temperature}>
          <View style={styles.temperatureInner}>
            <Thermometer size={17} color={c.muted} />
            <TextInput value={weather} onChangeText={value => { setWeather(value); setHidden([]); setAt(0); }}
              accessibilityLabel={t('Температура')} placeholder={live ? String(Math.round(live.temperature)) : '—'} placeholderTextColor={c.muted} keyboardType="numbers-and-punctuation" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={5}
              style={[font('medium'), { flex: 1, minWidth: 0, color: c.text, fontSize: 16 }]} />
            <Text style={[font('regular'), { color: c.muted, fontSize: 14 }]}>°C</Text>
          </View>
        </Glass>
        <Text style={[font('regular'), styles.muted, { flex: 1, alignSelf: 'center' }]}>{t(weather.trim() ? 'Своя температура вместо текущей' : 'Температура подставлена автоматически; можно ввести свою')}</Text>
      </View>
      {weather.trim() && temperature === null ? <Text style={[font('regular'), { color: c.danger, fontSize: 13 }]}>{t('Температура от −60 до +60 °C')}</Text> : null}
      <Text style={[font('semibold'), styles.sheetLabel]}>{t('Осадки')}</Text>
      <View style={styles.wrap}>{([['auto', live ? t('По погоде: {value}', { value: t(live.precipitation === 'rain' ? 'дождь' : live.precipitation === 'snow' ? 'снег' : 'без осадков') }) : t('По погоде')],
        ['none', t('Без осадков')], ['rain', t('Дождь')], ['snow', t('Снег')]] as [PrecipitationChoice, string][]).map(([value, label]) =>
        <ChoicePill key={value} label={label} active={precipitationChoice === value} onPress={() => { setPrecipitationChoice(value); fresh(); }} />)}</View>
      <Text style={[font('semibold'), styles.sheetLabel]}>{t('Вокруг какой вещи')}</Text>
      <OptionPicker options={['any', ...items.map(item => item.id)]} value={anchor?.id || 'any'} labels={Object.fromEntries([['any', t('Без привязки к вещи')], ...items.map(item => [item.id, item.name])])}
        onChange={value => { setAnchorId(value); fresh(); }} label={t('Основа образа')} />
    </StudioSheet>

    {/* The look in detail: its pieces (each can be swapped), how well it fits, the advice, putting it aside */}
    {look && about ? <StudioSheet visible={detailsOpen} title={about.title} onClose={() => { setDetailsOpen(false); setReplaceId(null); }}>
      {/* The pieces; tapping one offers what could replace it (the anchor piece stays) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={styles.pieces}>
        {about.selection.map(item => {
          const swappable = item.id !== anchor?.id;
          const on = replaceId === item.id;
          return <AppPressable key={item.id} disabled={!swappable} accessibilityRole="button" accessibilityLabel={swappable ? t('Заменить {name}', { name: item.name }) : item.name}
            accessibilityState={{ selected: on }} onPress={() => setReplaceId(on ? null : item.id)} style={styles.piece}>
            <Glass radius={22} style={[styles.pieceTile, on && { borderWidth: 1.5, borderColor: c.text }]}>
              <GarmentImage item={item} print printRadius={14} style={{ width: 84, height: 84 }} />
              {swappable ? <View style={[styles.swapBadge, { backgroundColor: on ? c.text : c.card }]}><ArrowRightLeft size={12} strokeWidth={2} color={on ? c.card : c.text} /></View> : null}
            </Glass>
            <Text style={[font('medium'), styles.pieceName]} numberOfLines={2}>{item.name}</Text>
          </AppPressable>;
        })}
      </ScrollView>
      {selectedForSwap ? <Glass radius={22}><View style={{ gap: 8, padding: 14 }}>
        <Text style={[font('semibold'), styles.sheetLabel]}>{t('Вместо «{name}»', { name: selectedForSwap.name })}</Text>
        {alternatives.length ? <OptionPicker options={alternatives.map(item => item.id)} labels={Object.fromEntries(alternatives.map(item => [item.id, item.name]))} value="" label={t('Выбрать замену')} onChange={id => replace(selectedForSwap.id, id)} />
          : <Text style={[font('regular'), styles.muted]}>{t('Других вещей в этой категории нет.')}</Text>}
      </View></Glass> : null}
      <MatchSummary percent={about.match.percent} criteria={about.match.criteria} detailed={expanded} />
      {about.palette.length ? <Text style={[font('regular'), styles.muted]}>{about.palette.map(color => t(color)).join(', ')}</Text> : null}
      {about.tips.slice(0, 1).map(tip => <Text key={tip} style={[font('regular'), styles.body]}>{tip}</Text>)}
      {about.advice.warnings.slice(0, expanded ? undefined : 1).map(warning => <View key={warning} style={styles.warning}><Text style={[font('regular'), styles.body]}>{warning}</Text></View>)}
      {about.swaps.length ? <Glass radius={24}>{about.swaps.map((swap, n) => <AppPressable key={swap.from.id} accessibilityRole="button" onPress={() => replace(swap.from.id, swap.to.id)}
        style={[styles.swap, n > 0 && styles.hairline]}>
        <ArrowRightLeft size={18} strokeWidth={1.8} color={c.text} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font('semibold'), { color: c.text, fontSize: 14 }]}>{swap.to.name}</Text>
          <Text style={[font('regular'), styles.muted]}>{swap.reason}</Text>
          <Text style={[font('regular'), styles.muted]}>{t('Вместо «{name}»', { name: swap.from.name })}</Text>
        </View>
      </AppPressable>)}</Glass> : null}
      {expanded ? <View style={{ gap: 10 }}>{about.tips.slice(1).map(text => <Text key={text} style={[font('regular'), styles.body]}>{text}</Text>)}
        {beautyAdvice ? <Text style={[font('regular'), styles.body]}>{[look.makeup, look.hair].filter(Boolean).map(text => t(text)).join('\n')}</Text> : null}
      </View> : null}
      <AppPressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.details}>
        <Text style={[font('semibold'), styles.link]}>{t(expanded ? 'Свернуть' : 'Почему сочетается')}</Text>
        {expanded ? <ChevronUp size={16} color={c.text} /> : <ChevronDown size={16} color={c.text} />}
      </AppPressable>
      <Pill title={t('Не сейчас')} onPress={hide} />
    </StudioSheet> : null}
  </FormScrollView>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { paddingBottom: 24, width: '100%', maxWidth: 720, alignSelf: 'center' },
  bleed: { marginHorizontal: -16, flexGrow: 0 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 18 },
  word: { fontSize: 13, lineHeight: 18, color: c.muted },
  anchor: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  stage: { marginHorizontal: -16, marginTop: 6, alignItems: 'center', justifyContent: 'center' },
  position: { position: 'absolute', right: 20, bottom: 4, fontSize: 12, color: c.muted },
  lookTitle: { color: c.text, fontSize: 26, lineHeight: 30, letterSpacing: -0.7 },
  why: { color: c.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  link: { color: c.text, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  gaps: { marginTop: 16 },
  gapsInner: { flexDirection: 'row', gap: 10, padding: 14 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  body: { color: c.text, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sheetLabel: { color: c.text, fontSize: 13, lineHeight: 18 },
  controlRow: { flexDirection: 'row', gap: 12 },
  temperature: { width: 132, height: 48 },
  temperatureInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warning: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.danger },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  hairline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  details: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  pieces: { gap: 10, paddingHorizontal: 20 },
  piece: { width: 96, gap: 6 },
  pieceTile: { width: 96, height: 104, alignItems: 'center', justifyContent: 'center' },
  pieceName: { color: c.text, fontSize: 12, lineHeight: 15 },
  swapBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});
