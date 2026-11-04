import { useMemo, useState } from 'react';
import { Image, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { SPACING, ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { AppPressable } from './AppPressable';
import { Pill } from './studio/Glass';
import { font } from './studio/studio';
import { SheetStrip } from './ui/FormScrollView';

const SLOTS: { section: string; title: string }[] = [
  { section: 'Верх', title: 'Верх' }, { section: 'Низ', title: 'Низ' }, { section: 'Обувь', title: 'Обувь' },
  { section: 'Верхняя одежда', title: 'Верхняя одежда' }, { section: 'Сумки', title: 'Сумка' }
];

/** A favourite's name and pieces, one piece per section. A second layer or an accessory has no row here: it stays in the look as it was. */
export function LookEditor({ title, itemIds, items, onSave, onCancel }: {
  title: string; itemIds: string[]; items: WardrobeItem[]; onSave: (title: string, itemIds: string[]) => void; onCancel: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [name, setName] = useState(title);
  const inLook = useMemo(() => [...new Set(itemIds)].map(id => items.find(item => item.id === id)).filter(Boolean) as WardrobeItem[], [itemIds, items]);
  const firstOf = (section: string) => inLook.find(item => item.section === section);
  const [picked, setPicked] = useState<Record<string, WardrobeItem | undefined>>(() => Object.fromEntries(SLOTS.map(slot => [slot.section, firstOf(slot.section)])));
  const kept = inLook.filter(item => !SLOTS.some(slot => firstOf(slot.section)?.id === item.id));
  const selection = [...SLOTS.flatMap(slot => picked[slot.section] ? [picked[slot.section]!] : []), ...kept];
  return <>
    <Text style={styles.label}>{t('Название')}</Text>
    <TextInput style={styles.input} placeholder={t('Название')} placeholderTextColor={colors.muted} value={name} onChangeText={setName} accessibilityLabel={t('Название')}
      multiline scrollEnabled={false} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={Keyboard.dismiss} />
    {SLOTS.map(slot => {
      const selected = picked[slot.section];
      const list = items.filter(item => item.section === slot.section);
      return <View key={slot.section} style={styles.slot}>
        <View style={styles.slotHeader}>
          <View style={styles.slotInfo}>
            <Text style={styles.slotTitle}>{t(slot.title)}</Text>
            <Text style={[styles.slotValue, !selected && styles.slotEmpty]} numberOfLines={1}>{selected ? selected.name : t('Не выбрано')}</Text>
          </View>
          {selected?.imageUri ? <Image source={{ uri: selected.imageUri }} style={styles.preview} resizeMode="contain" /> : null}
        </View>
        {list.length ? <SheetStrip showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {list.map(item => {
            const active = selected?.id === item.id;
            return <AppPressable key={item.id} haptics accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{ selected: active }} style={[styles.card, active && styles.cardActive]}
              onPress={() => setPicked(current => ({ ...current, [slot.section]: active ? undefined : item }))}>
              {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="contain" /> : null}
              <Text style={[styles.cardLabel, active && styles.cardLabelActive]} numberOfLines={1}>{item.name}</Text>
            </AppPressable>;
          })}
        </SheetStrip> : <Text style={styles.none}>{t('Нет вещей в этой категории')}</Text>}
      </View>;
    })}
    <View style={styles.actions}>
      <Pill variant="primary" title={t('Сохранить')} style={{ flex: 1 }} onPress={() => onSave(name.trim() || title, selection.map(item => item.id))} />
      <Pill title={t('Отмена')} onPress={onCancel} />
    </View>
  </>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  label: { ...font('semibold'), fontSize: 13, color: c.text, marginBottom: -6 },
  input: { ...font('regular'), backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: SPACING.md, paddingVertical: 12, fontSize: 14, color: c.text },
  slot: { backgroundColor: c.surface, borderRadius: 22, padding: SPACING.md },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.sm },
  slotInfo: { flex: 1 },
  slotTitle: { ...font('regular'), fontSize: 12, lineHeight: 16, color: c.muted },
  slotValue: { ...font('semibold'), color: c.text, fontSize: 14, marginTop: 2 },
  slotEmpty: { ...font('regular'), color: c.muted },
  preview: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.stage },
  row: { gap: 8, paddingBottom: 2 },
  card: { width: 108, backgroundColor: c.card, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent', padding: 8 },
  cardActive: { borderColor: c.text },
  image: { width: '100%', height: 64, borderRadius: 12, backgroundColor: c.stage },
  cardLabel: { ...font('medium'), marginTop: 6, color: c.text, fontSize: 12 },
  cardLabelActive: { ...font('semibold') },
  none: { ...font('regular'), fontSize: 13, color: c.muted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 }
});
