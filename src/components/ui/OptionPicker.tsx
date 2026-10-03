import { useState } from 'react';
import { FlatList, Keyboard, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { IconButton } from './IconButton';
import { useTheme } from '../../constants/ThemeContext';
import { useT } from '../../constants/i18n';

export function OptionPicker({ options, value, onChange, label = 'Выбрать', swatches, labels = {} }: {
  options: string[]; value: string; onChange: (value: string) => void; label?: string; swatches?: Record<string, string>; labels?: Record<string, string>;
}) {
  const { colors: c } = useTheme();
  const t = useT();
  const display = (value: string) => labels[value] || t(value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  return <>
    <AppPressable accessibilityRole="button" accessibilityLabel={`${t(label)}: ${display(value) || t('Не выбрано')}`} onPress={() => { Keyboard.dismiss(); setSearch(''); setOpen(true); }}
      style={[styles.trigger, { backgroundColor: c.surface, borderColor: c.border }]}>
      {swatches?.[value] && <View style={[styles.swatch, { backgroundColor: swatches[value], borderColor: c.border }]} />}
      <Text style={{ flex: 1, color: value ? c.text : c.muted, fontSize: 15 }}>{display(value) || t(label)}</Text><ChevronDown size={18} color={c.muted} />
    </AppPressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={styles.row}><Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '600' }}>{t(label)}</Text><IconButton icon={X} label={t('Закрыть выбор')} onPress={() => setOpen(false)} /></View>
          {options.length > 8 && <View style={[styles.trigger, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Search size={18} color={c.muted} /><TextInput accessibilityLabel={t('Поиск вариантов')} placeholder={t('Поиск')} placeholderTextColor={c.muted} style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 16 }} value={search} onChangeText={setSearch} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
          </View>}
          <FlatList data={options.filter(option => display(option).toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={item => item}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss} automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingBottom: 24 }} ListEmptyComponent={<Text style={{ color: c.muted, paddingVertical: 20 }}>{t('Ничего не найдено')}</Text>}
            renderItem={({ item }) => <AppPressable accessibilityRole="radio" accessibilityState={{ checked: value === item }} accessibilityLabel={display(item)}
              onPress={() => { Keyboard.dismiss(); onChange(item); setOpen(false); }} style={[styles.option, { borderBottomColor: c.border }]}>
              {swatches?.[item] && <View style={[styles.swatch, { backgroundColor: swatches[item], borderColor: c.border }]} />}
              <Text style={{ color: c.text, flex: 1, fontSize: 15 }}>{display(item)}</Text>{value === item && <Check color={c.accentGold} size={20} />}
            </AppPressable>} />
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  trigger: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 0 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', minHeight: 280, width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 0, borderTopRightRadius: 0, padding: 22, gap: 16 },
  option: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 }
});
