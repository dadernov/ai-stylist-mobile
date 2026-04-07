import { Image, StyleSheet, View } from 'react-native';
import { WardrobeItem } from '../data/mock';
import { COLORS } from '../constants/theme';

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
  const sorted = sortBySection(items);
  if (!sorted.length) {
    return <View style={styles.preview} />;
  }

  return (
    <View style={styles.preview}>
      {sorted.map((item, index) => (
        <View key={item.id} style={[styles.previewItem, index > 0 && styles.previewGap]}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : (
            <View style={styles.previewPlaceholder} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 8
  },
  previewItem: {
    width: '100%',
    height: 92,
    alignItems: 'center',
    justifyContent: 'center'
  },
  previewGap: {
    marginTop: 8
  },
  previewImage: {
    width: '100%',
    height: '100%'
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    backgroundColor: '#F3EFE8'
  }
});
