import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useMemo, useState } from 'react';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { TryOnModelResult } from '../services/ai';

type TryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  modelLayout?: TryOnModelResult | null;
  isModelLoading?: boolean;
};

type PixelBox = { x: number; y: number; width: number; height: number };
type LayerBox = PixelBox & { rotateDeg: number; zIndex: number };

const sectionOrder = ['Верхняя одежда', 'Верх', 'Низ', 'Обувь', 'Сумки'];

const sortBySection = (items: WardrobeItem[]) => {
  const order = new Map(sectionOrder.map((value, index) => [value, index]));
  return [...items].sort((a, b) => {
    const aIndex = order.has(a.section) ? order.get(a.section)! : sectionOrder.length;
    const bIndex = order.has(b.section) ? order.get(b.section)! : sectionOrder.length;
    return aIndex - bIndex;
  });
};

const buildLayer = (x: number, y: number, width: number, height: number, rotateDeg: number, zIndex: number): LayerBox => ({
  x,
  y,
  width: Math.max(30, width),
  height: Math.max(28, height),
  rotateDeg,
  zIndex
});

export function TryOnPreview({ modelUri: _modelUri, items, modelLayout: _modelLayout, isModelLoading }: TryOnPreviewProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const sorted = useMemo(() => {
    const uniqueItems = Array.from(new Map(items.map((item) => [item.id, item])).values());
    return sortBySection(uniqueItems);
  }, [items]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox({ width, height });
  };

  const layerBySection = useMemo(() => {
    if (!box.width || !box.height) return {} as Record<string, LayerBox>;
    const frame = {
      x: box.width * 0.23,
      y: box.height * 0.07,
      width: box.width * 0.54,
      height: box.height * 0.88
    };

    return {
      Верх: buildLayer(frame.x + frame.width * 0.1, frame.y + frame.height * 0.2, frame.width * 0.8, frame.height * 0.26, 0, 4),
      'Верхняя одежда': buildLayer(frame.x + frame.width * 0.06, frame.y + frame.height * 0.17, frame.width * 0.88, frame.height * 0.31, 0, 5),
      Низ: buildLayer(frame.x + frame.width * 0.16, frame.y + frame.height * 0.49, frame.width * 0.68, frame.height * 0.3, 0, 3),
      Обувь: buildLayer(frame.x + frame.width * 0.15, frame.y + frame.height * 0.82, frame.width * 0.7, frame.height * 0.12, 0, 2),
      Сумки: buildLayer(frame.x + frame.width * 0.72, frame.y + frame.height * 0.41, frame.width * 0.24, frame.height * 0.18, 0, 6)
    } as Record<string, LayerBox>;
  }, [box.height, box.width]);

  const bySection = useMemo(() => {
    const result: Record<string, WardrobeItem> = {};
    for (const item of sorted) {
      if (!result[item.section]) result[item.section] = item;
    }
    return result;
  }, [sorted]);

  const colorFromLabel = (label: string): string => {
    const normalized = label.toLowerCase();
    if (normalized.includes('черн')) return '#2F2F2F';
    if (normalized.includes('бел')) return '#F1EEE6';
    if (normalized.includes('беж')) return '#D8C5A7';
    if (normalized.includes('син')) return '#4A618E';
    if (normalized.includes('голуб')) return '#7EA6D9';
    if (normalized.includes('сер')) return '#9C9A94';
    if (normalized.includes('корич')) return '#8B6647';
    if (normalized.includes('зел')) return '#667D4A';
    if (normalized.includes('крас')) return '#B8564E';
    if (normalized.includes('роз')) return '#C98B93';
    if (normalized.includes('оранж')) return '#CD7A3A';
    return '#B6AAA0';
  };

  return (
    <View style={styles.preview} onLayout={onLayout}>
      <View style={styles.mannequinFrame}>
        <View style={styles.head} />
        <View style={styles.torso} />
        <View style={[styles.arm, styles.armLeft]} />
        <View style={[styles.arm, styles.armRight]} />
        <View style={[styles.leg, styles.legLeft]} />
        <View style={[styles.leg, styles.legRight]} />
      </View>
      {isModelLoading ? (
        <View style={styles.loadingBadge}>
          <Text style={styles.loadingText}>{t('Собираем образ на манекене...')}</Text>
        </View>
      ) : null}
      {Object.entries(bySection).map(([section, item]) => {
        const layer = layerBySection[section];
        if (!layer) return null;
        return (
          <View
            key={`${section}-${item.id}`}
            style={[
              styles.layerItem,
              {
                top: layer.y,
                left: layer.x,
                width: layer.width,
                height: layer.height,
                zIndex: layer.zIndex,
                transform: [{ rotate: `${layer.rotateDeg}deg` }],
                backgroundColor: colorFromLabel(item.color),
                borderColor: '#C8BCAF'
              }
            ]}
          >
            <Text style={styles.layerLabel} numberOfLines={1}>
              {t(item.category)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  preview: {
    height: 356,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
    backgroundColor: c.surface,
    marginBottom: 8
  },
  mannequinFrame: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0
  },
  head: {
    position: 'absolute',
    top: '8%',
    left: '44%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E5DBCC',
    borderWidth: 1,
    borderColor: '#D8CBB8'
  },
  torso: {
    position: 'absolute',
    top: '23%',
    left: '35%',
    width: '30%',
    height: '33%',
    borderRadius: 0,
    backgroundColor: '#ECE3D6',
    borderWidth: 1,
    borderColor: '#D8CBB8'
  },
  arm: {
    position: 'absolute',
    top: '27%',
    width: '8.5%',
    height: '30%',
    borderRadius: 0,
    backgroundColor: '#E8DECF',
    borderWidth: 1,
    borderColor: '#D8CBB8'
  },
  armLeft: {
    left: '28%'
  },
  armRight: {
    right: '28%'
  },
  leg: {
    position: 'absolute',
    top: '56%',
    width: '12%',
    height: '34%',
    borderRadius: 0,
    backgroundColor: '#E8DECF',
    borderWidth: 1,
    borderColor: '#D8CBB8'
  },
  legLeft: {
    left: '38%'
  },
  legRight: {
    right: '38%'
  },
  layerItem: {
    position: 'absolute',
    borderRadius: 0,
    borderWidth: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  layerLabel: {
    fontSize: 10,
    color: '#312B24',
    fontWeight: '700'
  },
  loadingBadge: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(30,28,25,0.8)',
    borderRadius: 0,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600'
  }
});
