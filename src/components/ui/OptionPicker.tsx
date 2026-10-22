import { useState } from 'react';
import { FlatList, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { useTheme } from '../../constants/ThemeContext';
import { useT } from '../../constants/i18n';
import { StudioSheet } from '../studio/StudioSheet';
import { font, hairline } from '../studio/studio';

/** A choice among many: a field like the form's inputs that opens the options in a studio sheet, with search for long lists. */
export function OptionPicker({ options, value, onChange, label = 'Выбрать', swatches, labels = {} }: {
  options: string[]; value: string; onChange: (value: string) => void; label?: string; swatches?: Record<string, string>; labels?: Record<string, string>;
}) {
  const { colors: c, isDark } = useTheme();
  const t = useT();
  const display = (value: string) => labels[value] || t(value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const swatchEdge = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(18,20,23,0.14)';
  return <>
    <AppPressable accessibilityRole="button" accessibilityLabel={`${t(label)}: ${display(value) || t('Не выбрано')}`} onPress={() => { Keyboard.dismiss(); setSearch(''); setOpen(true); }}
      style={[styles.trigger, { backgroundColor: c.surface }]}>
      {swatches?.[value] && <View style={[styles.swatch, { backgroundColor: swatches[value], borderColor: swatchEdge }]} />}
      <Text style={[font('regular'), styles.value, { color: value ? c.text : c.muted }]} numberOfLines={1}>{display(value) || t(label)}</Text>
      <ChevronDown size={18} strokeWidth={1.8} color={c.muted} />
    </AppPressable>
    <StudioSheet visible={open} title={t(label)} onClose={() => setOpen(false)} closeLabel={t('Закрыть выбор')} scroll={false}>
      {options.length > 8 && <View style={[styles.search, { backgroundColor: c.surface }]}>
        <Search size={16} strokeWidth={1.8} color={c.muted} />
        <TextInput accessibilityLabel={t('Поиск вариантов')} placeholder={t('Поиск')} placeholderTextColor={c.muted} value={search} onChangeText={setSearch}
          returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={[font('regular'), styles.searchInput, { color: c.text }]} />
      </View>}
      <FlatList data={options.filter(option => display(option).toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={item => item}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss} automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false} style={styles.list}
        ListEmptyComponent={<Text style={[font('regular'), styles.empty, { color: c.muted }]}>{t('Ничего не найдено')}</Text>}
        renderItem={({ item, index }) => {
          const checked = value === item;
          return <AppPressable haptics accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={display(item)}
            onPress={() => { Keyboard.dismiss(); onChange(item); setOpen(false); }}
            style={[styles.option, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline(isDark) }]}>
            {swatches?.[item] && <View style={[styles.swatch, { backgroundColor: swatches[item], borderColor: swatchEdge }]} />}
            <Text style={[font(checked ? 'semibold' : 'regular'), styles.value, { color: c.text }]}>{display(item)}</Text>
            {checked && <Check size={18} strokeWidth={2} color={c.text} />}
          </AppPressable>;
        }} />
    </StudioSheet>
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: 18 },
  value: { flex: 1, fontSize: 15, lineHeight: 20 },
  search: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, height: '100%' },
  list: { flexGrow: 0, flexShrink: 1, marginHorizontal: -4 },
  empty: { fontSize: 14, paddingVertical: 16, paddingHorizontal: 4 },
  option: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 }
});
