import { useEffect, useMemo, useRef, useState } from 'react';
import { darkColors } from '../constants/theme';
import { Animated, AppState, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Heart, PersonStanding, X } from 'lucide-react-native';
import { SaveLookButton, useSaveLook } from './SaveLook';
import { WardrobeItem } from '../data/mock';
import { useT } from '../constants/i18n';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { DAILY_EVENT, DAILY_STYLE, DailyLookRecord, dayPart, decodeDailyLook, greetingName, localDay, pickDailyLook, skipDailyLook } from '../domain/dailyLook';
import { buildLooks, lookCore, Precipitation } from '../domain/outfits';
import { accountKey } from '../services/accountStorage';
import { loadValidated, saveJson } from '../services/storage';
import { describeWeatherCode, Weather } from '../services/weather';
import { GeneratedLook } from '../types/looks';
import { Gender } from '../types/profile';
import { LookTaste, LookVote, lookExact } from '../domain/lookTaste';
import { LookVoteButtons, VoteHandler, VoteNote } from './LookVote';
import { Glass, Pill } from './studio/Glass';
import { GarmentImage } from './studio/Garment';
import { gridCount, gridLook, gridStageHeight } from './studio/lookLayout';
import { font, useReducedMotion } from './studio/studio';
import { useFavoriteColors } from './useFavoriteColors';

const HERO_STYLE = DAILY_STYLE;
const HERO_EVENT = DAILY_EVENT;
const SWIPE = 90;
// Location can wait on an unanswered permission prompt; the look of the day does not wait for ever.
const WEATHER_PATIENCE = 8000;

/** What the screen says and does about a look: the same words and the same saved form as on the stage below. */
export type DailyAbout = { selection: WardrobeItem[]; title: string; look: GeneratedLook; told: (action: 'favorite' | 'dismiss' | 'tryon') => void };

type Props = {
  items: WardrobeItem[]; gender: Gender; beautyAdvice: boolean; favoriteItemIds: string[]; dismissed: string[];
  login?: string; displayName?: string;
  weather: Weather | null; weatherSettled: boolean; precipitation: Precipitation;
  about: (look: GeneratedLook) => DailyAbout;
  onTryOn: (ids: string[]) => void;
  /** Thumbs: `taste` as it was when the screen opened orders the picks, `votes` are live. */
  taste?: LookTaste; votes: LookVote[]; onVote: VoteHandler;
  /** Swiped away: goes to the same «not now» store as the button in a look's details. */
  onSkip: (core: string) => void;
  /** A sideways drag of the card began or ended: the page holds its vertical scroll meanwhile. */
  onSwiping?: (swiping: boolean) => void;
};

/**
 * «Что надеть сегодня»: one look for today, on the wardrobe's own rules and the weather. It never
 * generates anything: a try-on costs real money, so this only opens the fitting room, on the tap.
 */
export function DailyLookHero({ items, gender, beautyAdvice, favoriteItemIds, dismissed, login, displayName, weather, weatherSettled, precipitation, about, onTryOn, taste, votes, onVote, onSkip, onSwiping }: Props) {
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
  const favoriteColors = useFavoriteColors(login);
  const candidates = useMemo(() => buildLooks(items, HERO_STYLE, HERO_EVENT, temperature === null ? '' : `${temperature}°C`, temperature, gender, beautyAdvice, {
    favoriteItemIds, precipitation, wind: weather?.wind ?? null, dismissed, favoriteColors, taste
  }), [items, temperature, gender, beautyAdvice, favoriteItemIds, precipitation, weather?.wind, dismissed, favoriteColors, taste]);
  // Picked once the weather is known or given up on, so the day's look is not locked in on no weather.
  useEffect(() => {
    // The colour answer counts too: the day's look is not locked in before it is read.
    if (record === undefined || !settled || favoriteColors === undefined) return;
    const next = pickDailyLook(candidates, items, record, day, dismissed);
    if (next !== record) remember(next);
  }, [record, settled, favoriteColors, candidates, items, day, dismissed]);

  const current = record?.day === day && record.lookId ? record : null;
  const look: GeneratedLook | null = useMemo(() => current ? { id: current.lookId, title: '', itemIds: current.itemIds, weather: current.temperature === null ? '' : `${current.temperature}°C`,
    temperature: current.temperature, style: HERO_STYLE, event: HERO_EVENT, makeup: '', hair: '' } : null, [current?.lookId, current?.itemIds.join(',')]);
  const info = look ? about(look) : null;
  // A swipe to the right saves as the button below does, and never takes a saved look away.
  const swipeSave = useSaveLook(info?.look, { onAdded: () => info?.told('favorite') });
  const selection = info?.selection;

  // A look disliked here or on the stage below leaves the hero for the next one. Not through «не сегодня»: it does not go into the hidden list.
  const exact = selection ? lookExact(selection) : '';
  const disliked = Boolean(exact) && votes.some(entry => entry.vote === 'dislike' && entry.exact === exact);
  useEffect(() => {
    if (disliked && current && selection) remember(skipDailyLook(current, lookCore(selection)));
  }, [disliked, current?.lookId]);
  const [note, setNote] = useState<{ id: number; text: string; undo: () => void } | null>(null);
  const vote: VoteHandler = (pieces, kind) => {
    const before = record;
    onVote(pieces, kind);
    if (!kind) { setNote(null); return; }
    setNote({ id: Date.now(), text: t(kind === 'like' ? 'Учту' : 'Учту, этот образ больше не покажу'), undo: () => {
      onVote(pieces, null);
      if (kind === 'dislike' && before) remember(before);
    } });
  };

  const swipe = useRef(new Animated.Value(0)).current;
  const back = () => { if (reduced) swipe.setValue(0); else Animated.spring(swipe, { toValue: 0, damping: 16, stiffness: 180, useNativeDriver: true }).start(); };
  const like = () => { if (!swipeSave.saved) void swipeSave.toggle(); back(); };
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
  const swiping = useRef(onSwiping);
  swiping.current = onSwiping;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy),
    // A sideways drag belongs to the card until released: JS asks the responder to stay here, and the page's
    // scroll is switched off for it (onSwiping), since a native scroll view can take the touch regardless.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => swiping.current?.(true),
    onPanResponderMove: (_, g) => swipe.setValue(g.dx),
    onPanResponderRelease: (_, g) => { swiping.current?.(false); releaseRef.current(g.dx); },
    onPanResponderTerminate: () => { swiping.current?.(false); releaseRef.current(0); }
  })).current;

  const [width, setWidth] = useState(0);
  // Sized for the fullest look a skip can reach, so the page below does not jump when the next look comes in.
  const fullest = useMemo(() => {
    const byItemId = new Map(items.map(item => [item.id, item]));
    return Math.max(0, ...candidates.map(candidate => gridCount(candidate.itemIds.flatMap(id => byItemId.get(id) ?? []))));
  }, [candidates, items]);
  // A skip takes looks out of the candidates: the size reached today stays until tomorrow.
  const selected = selection ? gridCount(selection) : 0;
  const dayStage = useRef({ day, count: 0 });
  dayStage.current = { day, count: Math.max(dayStage.current.day === day ? dayStage.current.count : 0, fullest, selected) };
  const stageHeight = gridStageHeight(dayStage.current.count);
  const placed = selection && width ? gridLook(selection, width, stageHeight) : [];
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
    <Glass radius={28}><Text style={[font('regular'), styles.muted, styles.note]}>{t('Смотрим, что у тебя есть…')}</Text></Glass></View>;
  // Nothing of the look left to show (its pieces are gone): no empty card.
  if (!look || !info || !selected) {
    // Too few things: the state below already explains it. All skipped: a word here, the ideas below still work.
    if (!record?.skipped.length || record.day !== day) return null;
    return <View style={styles.wrap}>{header}
      <Glass radius={28}><Text style={[font('regular'), styles.muted, styles.note]}>{t('На сегодня идеи закончились. Ниже есть ещё варианты.')}</Text></Glass>
      <VoteNote note={note} onUndo={() => { note?.undo(); setNote(null); }} /></View>;
  }

  return <View style={styles.wrap}>
    {header}
    <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: swipe }, { rotate: swipe.interpolate({ inputRange: [-300, 300], outputRange: ['-5deg', '5deg'], extrapolate: 'clamp' }) }] }}>
      <Glass radius={28}>
        <View style={{ height: stageHeight }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          {placed.map(piece => <View key={piece.id} pointerEvents="none" style={{ position: 'absolute', left: piece.x, top: piece.y, width: piece.w, height: piece.h, backgroundColor: darkColors.stage, borderRadius: 18 }}>
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
    <View style={styles.titleRow}>
      <Text style={[font('semibold'), styles.lookTitle, { flex: 1 }]} numberOfLines={2}>{info.title}</Text>
      <LookVoteButtons selection={info.selection} votes={votes} onVote={vote} />
    </View>
    <VoteNote note={note} onUndo={() => { note?.undo(); setNote(null); }} />
    <Text style={[font('regular'), styles.hint]}>{t('Вправо — в избранное, влево — не сегодня')}</Text>
    {/* The same choices as buttons: a swipe is not the only way to them. */}
    <View style={styles.actions}>
      <Pill variant="primary" icon={PersonStanding} title={t('Примерить')} style={{ flex: 1 }} onPress={tryOn} />
      <Pill icon={X} accessibilityLabel={t('Не сегодня')} onPress={skip} />
    </View>
    <SaveLookButton look={info.look} onAdded={() => info.told('favorite')} />
  </View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { gap: 10, marginBottom: 20 },
  head: { gap: 2 },
  title: { color: c.text, fontSize: 24, lineHeight: 29, letterSpacing: -0.6 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  note: { padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lookTitle: { color: c.text, fontSize: 17, lineHeight: 22, letterSpacing: -0.3 },
  hint: { color: c.muted, fontSize: 12, lineHeight: 16, marginTop: -6 },
  actions: { flexDirection: 'row', gap: 8 },
  badge: { position: 'absolute', top: 12, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,20,23,0.7)' }
});
