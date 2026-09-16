import { Image, StyleSheet, Text, View } from 'react-native';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';

type LookPreviewProps = {
  items: WardrobeItem[];
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

export function LookPreview({ items }: LookPreviewProps) {
  const styles = useThemedStyles(makeStyles);
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
    backgroundColor: c.surface,
    borderRadius: 6
  },
  previewPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    backgroundColor: c.surface
  },
  caption: { color: c.muted, fontSize: 11, paddingHorizontal: 2 }
});
