import { useMemo, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowRight, ArrowRightLeft, Check, ChevronDown, ChevronUp, Heart, RefreshCw, Thermometer } from 'lucide-react-native';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { FormScrollView } from '../components/ui/FormScrollView';
import { OptionPicker } from '../components/ui/OptionPicker';
import { IconButton } from '../components/ui/IconButton';
import { AppPressable } from '../components/AppPressable';
import { LookPreview } from '../components/LookPreview';
import { Chip } from '../components/Chip';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { Gender } from '../types/profile';
import { buildLooks, getOutfitAdvice, getOutfitSwaps, OutfitContext } from '../domain/outfits';

type Props = {
  items: WardrobeItem[]; gender: Gender; beautyAdvice: boolean; favorites: GeneratedLook[];
  onFavorite: (look: GeneratedLook) => void; onTryOn: (ids: string[]) => void; onWardrobe: () => void;
};
const events = ['Прогулка', 'Совещание', 'Свидание', 'Вечеринка', 'Спортзал'];
const stylesList = ['Кэжуал', 'Минимализм', 'Офисный', 'Спорт-шик', 'Романтичный', 'Бохо'];

export function RecommendationsScreen({ items, gender, beautyAdvice, favorites, onFavorite, onTryOn, onWardrobe }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const [event, setEvent] = useState('Прогулка');
  const [style, setStyle] = useState('Кэжуал');
  const [anchorId, setAnchorId] = useState('any');
  const [weather, setWeather] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  // Saving a look updates its heart without shuffling the list under the user's finger.
  const [favoriteItemIds] = useState(() => [...new Set(favorites.flatMap(look => look.itemIds))]);
  const temperature = weather.trim() && Number.isFinite(Number(weather.replace(',', '.'))) && Math.abs(Number(weather.replace(',', '.'))) <= 60 ? Number(weather.replace(',', '.')) : null;
  const anchor = items.find(item => item.id === anchorId);
  const looks = useMemo(() => buildLooks(items, style, event, temperature === null ? '' : `${temperature}°C`, temperature, gender, beautyAdvice, {
    anchorId: anchor?.id, favoriteItemIds
  }), [items, style, event, temperature, gender, beautyAdvice, anchor?.id, favoriteItemIds]);
  const visible = looks.filter(look => !hidden.includes(look.id));
  return <FormScrollView contentContainerStyle={styles.content}>
    <ScreenHeader eyebrow="Из твоего гардероба" title="Что надеть" />
    <View style={styles.controls}>
      <Text style={styles.label}>Событие</Text>
      <View style={styles.chips}>{events.map(value => <Chip key={value} label={value} active={event === value} onPress={() => { Keyboard.dismiss(); setEvent(value); setHidden([]); }} />)}</View>
      <View style={styles.controlRow}>
        <View style={{ flex: 1, gap: 8 }}><Text style={styles.label}>Настроение</Text><OptionPicker options={stylesList} value={style} onChange={value => { setStyle(value); setHidden([]); }} label="Стиль" /></View>
        <View style={{ width: 114, gap: 8 }}><Text style={styles.label}>На улице</Text><View style={[styles.temperature, { backgroundColor: c.surface }]}>
          <Thermometer size={17} color={c.muted} /><TextInput value={weather} onChangeText={value => { setWeather(value); setHidden([]); }}
            accessibilityLabel="Температура" placeholder="—" placeholderTextColor={c.muted} keyboardType="numbers-and-punctuation" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={5} style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 16 }} />
          <Text style={{ color: c.muted, fontSize: 14 }}>°C</Text>
        </View></View>
      </View>
      {weather.trim() && temperature === null ? <Text style={{ color: c.danger }}>Температура от −60 до +60 °C</Text> : null}
      <Text style={styles.label}>Вокруг какой вещи</Text>
      <OptionPicker options={['any', ...items.map(item => item.id)]} value={anchor?.id || 'any'} labels={Object.fromEntries([['any', 'Без привязки к вещи'], ...items.map(item => [item.id, item.name])])}
        onChange={value => { setAnchorId(value); setHidden([]); }} label="Основа образа" />
    </View>
    <View style={styles.sectionHeading}><Text style={styles.heading}>Твои сочетания</Text><Text style={styles.count}>{String(visible.length).padStart(2, '0')}</Text></View>
    {!visible.length && <View style={styles.empty}>
      <Text style={styles.heading}>{!items.length ? 'Начнём с гардероба' : hidden.length ? 'Все варианты просмотрены' : 'Пока нет подходящих вещей'}</Text>
      <PrimaryButton title={hidden.length ? 'Вернуть варианты' : 'К гардеробу'} icon={hidden.length ? RefreshCw : ArrowRight} onPress={hidden.length ? () => setHidden([]) : onWardrobe} />
    </View>}
    {visible.map((look, index) => <Recommendation key={look.id} look={look} index={index} items={items} anchorId={anchor?.id} beautyAdvice={beautyAdvice}
      favorites={favorites} onFavorite={onFavorite} onTryOn={onTryOn} onHide={() => setHidden(previous => [...previous, look.id])} />)}
  </FormScrollView>;
}

function Recommendation({ look, index, items, anchorId, beautyAdvice, favorites, onFavorite, onTryOn, onHide }: {
  look: GeneratedLook; index: number; items: WardrobeItem[]; anchorId?: string; beautyAdvice: boolean; favorites: GeneratedLook[];
  onFavorite: Props['onFavorite']; onTryOn: Props['onTryOn']; onHide: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const [ids, setIds] = useState(look.itemIds);
  const [expanded, setExpanded] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const selection = ids.map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[];
  const context: OutfitContext = { style: look.style, event: look.event, temperature: look.temperature ?? null };
  const advice = getOutfitAdvice(selection, context);
  const swaps = getOutfitSwaps(selection, items, context, anchorId);
  const savedId = `${look.id}:${ids.join(',')}`;
  const saved = favorites.some(favorite => favorite.id === savedId);
  const selectedForSwap = selection.find(item => item.id === replaceId);
  const onePiece = (item: WardrobeItem) => ['Платье', 'Сарафан', 'Комбинезон'].includes(item.category);
  const alternatives = selectedForSwap ? items.filter(item => item.section === selectedForSwap.section && !ids.includes(item.id) && onePiece(item) === onePiece(selectedForSwap)) : [];
  const replace = (from: string, to: string) => { setIds(previous => previous.map(id => id === from ? to : id)); setReplaceId(null); };
  const palette = [...new Set(selection.map(item => item.color))].filter(color => color && color !== 'Не определено');
  const title = selection.filter(item => ['Верх', 'Низ'].includes(item.section)).map(item => item.category).join(' + ') || look.title;
  return <View style={styles.look}>
    <View style={styles.sectionHeading}>
      <View style={{ flex: 1, gap: 5 }}><Text style={styles.number}>ВАРИАНТ {String(index + 1).padStart(2, '0')}</Text><Text style={styles.lookTitle}>{title}</Text></View>
      <IconButton icon={saved ? Check : Heart} label={saved ? 'Сохранено в избранном' : 'В избранное'} onPress={() => !saved && onFavorite({ ...look, title, id: savedId, itemIds: ids, fitReasons: advice.reasons, stylingTips: advice.tips, warnings: advice.warnings, tuckMode: advice.tuckMode })} />
    </View>
    <LookPreview items={selection} />
    <Text style={styles.muted}>{palette.join(' · ')}</Text>
    <View style={styles.pieces}>{selection.map(item => <View key={item.id} style={styles.piece}>
      <Text style={styles.body}>{item.name}</Text>
      {item.id !== anchorId && <IconButton icon={ArrowRightLeft} label={`Заменить ${item.name}`} onPress={() => setReplaceId(replaceId === item.id ? null : item.id)} />}
    </View>)}</View>
    {selectedForSwap && <View style={{ gap: 8 }}><Text style={styles.label}>{`Вместо «${selectedForSwap.name}»`}</Text>
      {alternatives.length ? <OptionPicker options={alternatives.map(item => item.id)} labels={Object.fromEntries(alternatives.map(item => [item.id, item.name]))} value="" label="Выбрать замену" onChange={id => replace(selectedForSwap.id, id)} /> : <Text style={styles.muted}>Других вещей в этой категории нет.</Text>}
    </View>}
    {advice.tips.slice(0, 1).map(tip => <Text key={tip} style={styles.body}>{tip}</Text>)}
    {advice.warnings.slice(0, expanded ? undefined : 1).map(warning => <View key={warning} style={styles.warning}><Text style={styles.body}>{warning}</Text></View>)}
    {swaps.map(swap => <AppPressable key={swap.from.id} accessibilityRole="button" onPress={() => replace(swap.from.id, swap.to.id)} style={styles.swap}>
      <ArrowRightLeft size={18} color={c.accentGold} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.label}>{swap.to.name}</Text><Text style={styles.muted}>{swap.reason} · вместо {swap.from.name}</Text></View><ArrowRight size={16} color={c.muted} />
    </AppPressable>)}
    {expanded && <View style={{ gap: 10 }}>{[...advice.reasons, ...advice.tips.slice(1)].map(text => <Text key={text} style={styles.body}>{text}</Text>)}
      {beautyAdvice && <Text style={styles.body}>{[look.makeup, look.hair].filter(Boolean).join('\n')}</Text>}
    </View>}
    <AppPressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={styles.details}><Text style={styles.label}>{expanded ? 'Свернуть' : 'Почему сочетается'}</Text>{expanded ? <ChevronUp size={16} color={c.muted} /> : <ChevronDown size={16} color={c.muted} />}</AppPressable>
    <PrimaryButton title="Примерить сочетание" icon={ArrowRight} onPress={() => onTryOn(ids)} />
    <AppPressable accessibilityRole="button" onPress={onHide} style={styles.details}><Text style={styles.muted}>Не сейчас</Text></AppPressable>
  </View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },
  controls: { gap: 12, borderBottomWidth: 1, borderColor: c.border, paddingBottom: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  controlRow: { flexDirection: 'row', gap: 12 },
  temperature: { height: 48, borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { color: c.text, fontSize: 14, fontWeight: '600' },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  body: { color: c.text, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 20 },
  heading: { color: c.text, fontSize: 21, fontWeight: '600' },
  count: { color: c.muted, fontSize: 18 },
  empty: { gap: 20, paddingVertical: 24 },
  look: { gap: 14, paddingBottom: 24, marginBottom: 12, borderBottomWidth: 1, borderColor: c.border },
  number: { color: c.accentGold, fontSize: 10, fontWeight: '700' },
  lookTitle: { color: c.text, fontSize: 22, fontWeight: '600' },
  pieces: { gap: 2 },
  piece: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  warning: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.danger },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
  details: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40 }
});
