import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Check, ImageOff, MoreHorizontal, Plus, Shirt } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';

const colorSwatches: Record<string, string> = {
  Белый: '#FFFFFF', Молочный: '#F5F4E9', Черный: '#262626', Серый: '#9A9D9B',
  Бежевый: '#CDBBA1', Синий: '#344F78', 'Синий деним': '#537A9B', Голубой: '#ABCDDF',
  Зеленый: '#62826A', Оливковый: '#858465', Хаки: '#777C5F', Красный: '#B54749',
  Розовый: '#DCA7B6', Бордовый: '#733548', Коричневый: '#886A55', Желтый: '#DEC677'
};

export const GarmentTile = memo(function GarmentTile({ item, selected, disabled, status, onPress }: {
  item: WardrobeItem;
  selected?: boolean;
  disabled?: boolean;
  status?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(item.imageUri));
  useEffect(() => { setFailed(false); setLoading(Boolean(item.imageUri)); }, [item.imageUri]);
  const swatch = /^#[\da-f]{6}$/i.test(item.color) ? item.color : colorSwatches[item.color];
  const SelectionIcon = selected ? Check : Plus;
  return (
    <AppPressable haptics onPress={onPress} disabled={disabled} accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityLabel={item.name} accessibilityState={{ checked: selected, disabled }} style={styles.tile}>
      <View style={[styles.photoStage, selected && styles.photoSelected]}>
        {item.imageUri && !failed ? (
          <Image source={{ uri: item.imageUri }} resizeMode="contain" style={styles.photo}
            onLoadEnd={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />
        ) : <View style={styles.missing}>
          {failed ? <ImageOff size={32} strokeWidth={1} color={colors.muted} /> : <Shirt size={40} strokeWidth={1} color={colors.muted} />}
          <Text style={styles.missingText}>{t(failed ? 'Фото недоступно' : 'Нет фото')}</Text>
        </View>}
        {loading && !failed && <ActivityIndicator style={styles.loading} size="small" color={colors.muted} />}
        {!disabled && <View style={[styles.badge, selected && styles.badgeSelected]}>
          {selected === undefined ? <MoreHorizontal size={18} color={STAGE_INK} strokeWidth={1.6} />
            : <SelectionIcon size={16} color={selected ? '#FFFFFF' : STAGE_INK} strokeWidth={1.8} />}
        </View>}
        {status && <View style={styles.status}><Text style={styles.statusText}>{status}</Text></View>}
      </View>
      <View style={styles.caption}>
        <Text style={styles.category} numberOfLines={1}>{t(item.category)}</Text>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <View style={styles.details}>
          {swatch && <View style={[styles.swatch, { backgroundColor: swatch }]} />}
          <Text style={styles.detail} numberOfLines={1}>{[item.color.startsWith('#') ? '' : t(item.color), item.size].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
    </AppPressable>
  );
});

// Marks drawn on the light photo stage, the same in both themes.
const STAGE_INK = '#000000';

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tile: { width: '100%', gap: 10 },
  photoStage: { width: '100%', aspectRatio: 0.78, backgroundColor: c.stage, borderRadius: 0, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  photoSelected: { borderColor: STAGE_INK },
  photo: { width: '100%', height: '100%', borderWidth: 12, borderColor: 'transparent' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingText: { fontSize: 11, color: c.muted },
  loading: { position: 'absolute', bottom: 12, left: 12 },
  badge: { position: 'absolute', right: 6, top: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  badgeSelected: { backgroundColor: STAGE_INK },
  status: { position: 'absolute', left: 8, bottom: 8, right: 8, backgroundColor: c.card, padding: 6, borderRadius: 0 },
  statusText: { color: c.muted, fontSize: 10, textAlign: 'center' },
  caption: { gap: 4, paddingHorizontal: 2 },
  category: { color: c.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  name: { color: c.text, fontSize: 14, lineHeight: 19, fontWeight: '700', minHeight: 19 },
  details: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 16 },
  detail: { color: c.muted, fontSize: 11, flexShrink: 1 },
  swatch: { width: 10, height: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: c.muted }
});
