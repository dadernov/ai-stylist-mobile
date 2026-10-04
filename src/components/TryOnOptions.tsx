import { Image, StyleSheet, Text, View } from 'react-native';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { canFasten, canTuck, FastenChoice, GarmentOption, GarmentOptions, TuckChoice } from '../domain/garmentOptions';
import { AppPressable } from './AppPressable';

const TUCK: { value: TuckChoice; label: string }[] = [
  { value: 'auto', label: 'Авто' }, { value: 'tucked', label: 'Заправить' }, { value: 'untucked', label: 'Навыпуск' },
];
const FASTEN: { value: FastenChoice; label: string }[] = [
  { value: 'auto', label: 'Авто' }, { value: 'closed', label: 'Застегнуть' }, { value: 'open', label: 'Расстегнуть' },
];

const WEARABLE = ['Верх', 'Низ', 'Обувь', 'Верхняя одежда'];

/**
 * The garments of the look and how each is worn, chosen per garment where it
 * means something: a top to tuck into the trousers, a shirt or a coat to button
 * up or open. The rest are listed too, so it is clear what goes on.
 */
export function TryOnOptions({ items, options, onChange, disabled }: {
  items: WardrobeItem[]; options: GarmentOptions; onChange: (options: GarmentOptions) => void; disabled?: boolean;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const rows = items.filter(item => WEARABLE.includes(item.section));
  const adjustable = rows.some(item => canTuck(item, items) || canFasten(item));
  const set = (item: WardrobeItem, change: GarmentOption) => onChange({ ...options, [item.id]: { ...options[item.id], ...change } });
  return (
    <View style={styles.list}>
      {!adjustable ? <Text style={styles.muted}>{t('Эти вещи надеваются как есть: заправлять и застёгивать здесь нечего.')}</Text> : null}
      {rows.map(item => (
        <View key={item.id} style={styles.row}>
          <View style={styles.head}>
            {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.thumb} resizeMode="contain" /> : <View style={styles.thumb} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.muted} numberOfLines={1}>{t(item.category)}</Text>
            </View>
          </View>
          {canTuck(item, items) ? <Segmented label={t('Заправка')} choices={TUCK} value={options[item.id]?.tuck || 'auto'} disabled={disabled}
            onChange={tuck => set(item, { tuck })} /> : null}
          {canFasten(item) ? <Segmented label={t('Застёжка')} choices={FASTEN} value={options[item.id]?.fasten || 'auto'} disabled={disabled}
            onChange={fasten => set(item, { fasten })} /> : null}
        </View>
      ))}
    </View>
  );
}

function Segmented<T extends string>({ label, choices, value, onChange, disabled }: {
  label: string; choices: { value: T; label: string }[]; value: T; onChange: (value: T) => void; disabled?: boolean;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.segmentLabel}>{label}</Text>
      <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {choices.map(choice => {
          const active = choice.value === value;
          return (
            <AppPressable key={choice.value} haptics accessibilityRole="radio" accessibilityState={{ checked: active, disabled }}
              aria-checked={active} accessibilityLabel={`${label}: ${t(choice.label)}`} disabled={disabled}
              onPress={() => onChange(choice.value)} style={[styles.choice, active && styles.choiceActive]}>
              <Text style={[styles.choiceText, active && styles.choiceTextActive]} numberOfLines={1}>{t(choice.label)}</Text>
            </AppPressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  list: { gap: 10 },
  row: { gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.stage },
  name: { color: c.text, fontSize: 14, fontWeight: '700' },
  muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
  segmentRow: { gap: 6 },
  segmentLabel: { color: c.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  // Options as pills; the chosen one is filled.
  segment: { flexDirection: 'row', gap: 6 },
  choice: { flex: 1, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  choiceActive: { borderColor: c.buttonPrimaryBg, backgroundColor: c.buttonPrimaryBg },
  choiceText: { color: c.muted, fontSize: 11, fontWeight: '600', letterSpacing: .6, textTransform: 'uppercase' },
  choiceTextActive: { color: c.buttonPrimaryText, fontWeight: '700' },
});
