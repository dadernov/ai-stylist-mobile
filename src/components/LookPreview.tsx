import { Image, StyleSheet, Text, View } from 'react-native';
import { ArrowRightLeft } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';

type LookPreviewProps = {
  items: WardrobeItem[];
  /** Puts a swap button on each photo, except where `canSwap` says no. */
  onSwap?: (item: WardrobeItem) => void;
  canSwap?: (item: WardrobeItem) => boolean;
  swapLabel?: (item: WardrobeItem) => string;
  /** The item whose replacements are open, highlighted. */
  swappingId?: string | null;
};

const sectionOrder = ['Верхняя одежда', 'Верх', 'Низ', 'Обувь', 'Сумки'];

const sortBySection = (items: WardrobeItem[]) => {
  const order = new Map(sectionOrder.map((value, index) => [value, index]));
  return [...items].sort((a, b) => {
    const aIndex = order.has(a.section) ? order.get(a.section)! : sectionOrder.length;
    const bIndex = order.has(b.section) ? order.get(b.section)! : sectionOrder.length;
    return aIndex - bIndex;
  });
};

export function LookPreview({ items, onSwap, canSwap, swapLabel, swappingId }: LookPreviewProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const sorted = sortBySection(items);
  if (!sorted.length) {
    return <View style={styles.preview} />;
  }

  return (
    <View style={styles.preview}>
      {sorted.map((item, index) => (
        <View key={item.id} style={[styles.previewItem, sorted.length === 1 && { width: '100%' }]}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : (
            <View style={styles.previewPlaceholder} />
          )}
          {onSwap && (!canSwap || canSwap(item)) ? (
            <AppPressable accessibilityRole="button" accessibilityLabel={swapLabel?.(item)} accessibilityState={{ selected: swappingId === item.id }}
              hitSlop={6} onPress={() => onSwap(item)}
              style={[styles.swap, { backgroundColor: swappingId === item.id ? c.buttonPrimaryBg : c.card, borderColor: c.border }]}>
              <ArrowRightLeft size={15} color={swappingId === item.id ? c.buttonPrimaryText : c.text} />
            </AppPressable>
          ) : null}
          <Text style={styles.caption} numberOfLines={1}>{item.name}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  preview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 12
  },
  previewItem: {
    width: '48%',
    gap: 6
  },
  previewGap: {
    marginTop: 8
  },
  previewImage: {
    width: '100%',
    height: 160,
    backgroundColor: c.stage,
    borderRadius: 0
  },
  previewPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 0,
    backgroundColor: c.stage
  },
  caption: { color: c.muted, fontSize: 11, paddingHorizontal: 2 },
  swap: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
});
