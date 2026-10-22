import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Check, ImageOff, MoreHorizontal, Plus, Shirt } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';

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
      {/* The name says what it is; category and colour live on the item's label (its card), not under every photo. */}
      <View style={styles.caption}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {item.size ? <Text style={styles.detail} numberOfLines={1}>{t('Размер {size}', { size: item.size })}</Text> : null}
      </View>
    </AppPressable>
  );
});

// Marks drawn on the light photo stage, the same in both themes.
const STAGE_INK = '#000000';

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // A storefront card: a 3:4 photo on a light stage with square corners, the text left-aligned under it.
  tile: { width: '100%', gap: 6 },
  photoStage: { width: '100%', aspectRatio: 0.75, backgroundColor: c.stage, borderRadius: 0, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  photoSelected: { borderColor: STAGE_INK },
  photo: { width: '100%', height: '100%', borderWidth: 12, borderColor: 'transparent' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingText: { fontSize: 11, color: c.muted },
  loading: { position: 'absolute', bottom: 12, left: 12 },
  badge: { position: 'absolute', right: 6, top: 6, width: 30, height: 30, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  badgeSelected: { backgroundColor: STAGE_INK },
  status: { position: 'absolute', left: 6, bottom: 6, right: 6, backgroundColor: c.card, padding: 6, borderRadius: 4 },
  statusText: { color: c.muted, fontSize: 10, textAlign: 'center' },
  caption: { gap: 1, paddingHorizontal: 2, paddingBottom: 10 },
  name: { color: c.text, fontSize: 14, lineHeight: 19, fontWeight: '400', minHeight: 19 },
  detail: { color: c.muted, fontSize: 12, lineHeight: 16 }
});
