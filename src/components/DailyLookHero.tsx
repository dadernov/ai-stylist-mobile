import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Heart, PersonStanding, X } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useT } from '../constants/i18n';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { DailyLookRecord, dayPart, decodeDailyLook, greetingName, localDay, pickDailyLook, skipDailyLook } from '../domain/dailyLook';
import { buildLooks, lookCore, Precipitation } from '../domain/outfits';
import { accountKey } from '../services/accountStorage';
import { loadValidated, saveJson } from '../services/storage';
import { describeWeatherCode, Weather } from '../services/weather';
import { GeneratedLook } from '../types/looks';
import { Gender } from '../types/profile';
import { Glass, Pill } from './studio/Glass';
import { GarmentImage } from './studio/Garment';
import { layoutLook } from './studio/lookLayout';
import { font, useReducedMotion } from './studio/studio';
import { useAspects } from './studio/useAspects';

// The everyday base of the hero: the choices on the screen below do not change the look of the day.
const HERO_STYLE = 'Кэжуал';
const HERO_EVENT = 'Прогулка';
const STAGE_HEIGHT = 190;
const SWIPE = 90;
// Location can wait on an unanswered permission prompt; the look of the day does not wait for ever.
const WEATHER_PATIENCE = 8000;

/** What the screen says and does about a look: the same words and the same saved form as on the stage below. */
export type DailyAbout = { selection: WardrobeItem[]; title: string; saved: boolean; favorite: () => void; told: (action: 'dismiss' | 'tryon') => void };

type Props = {
  items: WardrobeItem[]; gender: Gender; beautyAdvice: boolean; favoriteItemIds: string[]; dismissed: string[];
  login?: string; displayName?: string;
  weather: Weather | null; weatherSettled: boolean; precipitation: Precipitation;
  about: (look: GeneratedLook) => DailyAbout;
  onTryOn: (ids: string[]) => void;
  /** Swiped away: goes to the same «not now» store as the button in a look's details. */
  onSkip: (core: string) => void;
};

/**
 * «Что надеть сегодня»: one look for today, on the wardrobe's own rules and the weather. It never
 * generates anything: a try-on costs real money, so this only opens the fitting room, on the tap.
 */
export function DailyLookHero({ items, gender, beautyAdvice, favoriteItemIds, dismissed, login, displayName, weather, weatherSettled, precipitation, about, onTryOn, onSkip }: Props) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setNow(new Date()); });
    return () => subscription.remove();
  }, []);
  const day = localDay(now);
  // undefined until the stored choice is read: nothing is picked before that.
  const [record, setRecord] = useState<DailyLookRecord | null | undefined>(login ? undefined : null);
  const key = login ? accountKey(login, 'dailyLook') : null;
  useEffect(() => {
    if (!key) return;
    let active = true;
    void loadValidated(key, decodeDailyLook).then(result => { if (active) setRecord(result.value); }).catch(() => { if (active) setRecord(null); });
    return () => { active = false; };
  }, [key]);
  const remember = (next: DailyLookRecord) => { setRecord(next); if (key) void saveJson(key, next).catch(() => {}); };

  const [patient, setPatient] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setPatient(false), WEATHER_PATIENCE); return () => clearTimeout(timer); }, []);
  const settled = weatherSettled || !patient;
  const temperature = weather ? Math.round(weather.temperature) : null;
  const candidates = useMemo(() => buildLooks(items, HERO_STYLE, HERO_EVENT, temperature === null ? '' : `${temperature}°C`, temperature, gender, beautyAdvice, {
    favoriteItemIds, precipitation, wind: weather?.wind ?? null, dismissed
  }), [items, temperature, gender, beautyAdvice, favoriteItemIds, precipitation, weather?.wind, dismissed]);
  // Picked once the weather is known or given up on, so the day's look is not locked in on no weather.
  useEffect(() => {
    if (record === undefined || !settled) return;
    const next = pickDailyLook(candidates, items, record, day, dismissed);
    if (next !== record) remember(next);
  }, [record, settled, candidates, items, day, dismissed]);

  const current = record?.day === day && record.lookId ? record : null;
  const look: GeneratedLook | null = useMemo(() => current ? { id: current.lookId, title: '', itemIds: current.itemIds, weather: current.temperature === null ? '' : `${current.temperature}°C`,
    temperature: current.temperature, style: HERO_STYLE, event: HERO_EVENT, makeup: '', hair: '' } : null, [current?.lookId, current?.itemIds.join(',')]);
  const info = look ? about(look) : null;
  const selection = info?.selection;

  const swipe = useRef(new Animated.Value(0)).current;
  const back = () => { if (reduced) swipe.setValue(0); else Animated.spring(swipe, { toValue: 0, damping: 16, stiffness: 180, useNativeDriver: true }).start(); };
  const like = () => { info?.favorite(); back(); };
  const skip = () => {
    if (!current || !selection || !info) return;
    const core = lookCore(selection);
    info.told('dismiss');
    onSkip(core);
    remember(skipDailyLook(current, core));
    swipe.setValue(0);
  };
  const tryOn = () => { if (current && info) { info.told('tryon'); onTryOn(current.itemIds); } };
  const release = (dx: number) => {
    if (dx > SWIPE) like();
    else if (dx < -SWIPE) {
      if (reduced) skip();
      else Animated.timing(swipe, { toValue: -420, duration: 180, useNativeDriver: true }).start(skip);
    } else back();
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy),
    // A sideways drag belongs to the card until released: the page's vertical scroll does not take it over.
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => swipe.setValue(g.dx),
    onPanResponderRelease: (_, g) => releaseRef.current(g.dx),
    onPanResponderTerminate: () => releaseRef.current(0)
  })).current;

  const [width, setWidth] = useState(0);
  const aspects = useAspects(selection);
  const placed = selection && width ? layoutLook(selection, width, STAGE_HEIGHT, aspects) : [];
  const byId = new Map(selection?.map(item => [item.id, item]));

  const part = dayPart(now.getHours());
  const hello = t(part === 'morning' ? 'Доброе утро' : part === 'day' ? 'Добрый день' : part === 'evening' ? 'Добрый вечер' : 'Доброй ночи');
  const name = greetingName(displayName, login);
  const degrees = temperature === null ? '' : `${temperature > 0 ? '+' : temperature < 0 ? '−' : ''}${Math.abs(temperature)}°`;
  const weatherLine = weather ? `${degrees}, ${t(describeWeatherCode(weather.code))}` : settled ? t('Погоду пока не вижу, так что образ на любой день') : '';
  const header = <View style={styles.head}>
    <Text style={[font('regular'), styles.muted]} numberOfLines={1}>{name ? `${hello}, ${name}` : hello}</Text>
    <Text accessibilityRole="header" style={[font('semibold'), styles.title]}>{t('Что надеть сегодня')}</Text>
    {weatherLine ? <Text style={[font('regular'), styles.muted]} numberOfLines={2}>{weatherLine}</Text> : null}
  </View>;

  // An empty wardrobe has nothing to wait for: the state below explains it.
  if (!items.length && !current) return null;
  // Still reading or waiting for the weather: the place is kept, nothing jumps later.
  if (record === undefined || (!settled && !current)) return <View style={styles.wrap}>{header}
    <Glass radius={28}><Text style={[font('regular'), styles.muted, styles.note]}>{t('Смотрю, что у тебя есть…')}</Text></Glass></View>;
  if (!look || !info) {
    // Too few things: the state below already explains it. All skipped: a word here, the ideas below still work.
    if (!record?.skipped.length || record.day !== day) return null;
    return <View style={styles.wrap}>{header}
      <Glass radius={28}><Text style={[font('regular'), styles.muted, styles.note]}>{t('На сегодня идеи закончились. Ниже есть ещё варианты.')}</Text></Glass></View>;
  }

  return <View style={styles.wrap}>
    {header}
    <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: swipe }, { rotate: swipe.interpolate({ inputRange: [-300, 300], outputRange: ['-5deg', '5deg'], extrapolate: 'clamp' }) }] }}>
      <Glass radius={28}>
        <View style={{ height: STAGE_HEIGHT }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          {placed.map(piece => <View key={piece.id} pointerEvents="none" style={{ position: 'absolute', left: piece.x, top: piece.y, width: piece.w, height: piece.h, transform: [{ rotate: piece.rotate }] }}>
            <GarmentImage item={byId.get(piece.id)} print printRadius={Math.min(18, piece.w * 0.16)} style={{ width: piece.w, height: piece.h }} />
          </View>)}
          <Animated.View pointerEvents="none" style={[styles.badge, { left: 12, opacity: swipe.interpolate({ inputRange: [20, SWIPE], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
            <Heart size={20} strokeWidth={1.8} color="#FFFFFF" fill="#FFFFFF" />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.badge, { right: 12, opacity: swipe.interpolate({ inputRange: [-SWIPE, -20], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
            <X size={20} strokeWidth={1.8} color="#FFFFFF" />
          </Animated.View>
        </View>
      </Glass>
    </Animated.View>
    <Text style={[font('semibold'), styles.lookTitle]} numberOfLines={2}>{info.title}</Text>
    <Text style={[font('regular'), styles.hint]}>{t('Вправо — нравится, влево — не сегодня')}</Text>
    {/* The same choices as buttons: a swipe is not the only way to them. */}
    <View style={styles.actions}>
      <Pill variant="primary" icon={PersonStanding} title={t('Примерить')} style={{ flex: 1 }} onPress={tryOn} />
      <Pill icon={Heart} iconFill={info.saved} accessibilityLabel={t(info.saved ? 'Сохранено в избранном' : 'В избранное')} accessibilityState={{ selected: info.saved }} onPress={like} />
      <Pill icon={X} accessibilityLabel={t('Не сегодня')} onPress={skip} />
    </View>
  </View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { gap: 10, marginBottom: 20 },
  head: { gap: 2 },
  title: { color: c.text, fontSize: 24, lineHeight: 29, letterSpacing: -0.6 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  note: { padding: 16 },
  lookTitle: { color: c.text, fontSize: 17, lineHeight: 22, letterSpacing: -0.3 },
  hint: { color: c.muted, fontSize: 12, lineHeight: 16, marginTop: -6 },
  actions: { flexDirection: 'row', gap: 8 },
  badge: { position: 'absolute', top: 12, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,20,23,0.7)' }
});
