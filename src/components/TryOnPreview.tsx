import { Image, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useMemo, useState } from 'react';
import { WardrobeItem } from '../data/mock';
import { COLORS } from '../constants/theme';
import { TryOnModelResult, TryOnPoint } from '../services/ai';

type TryOnPreviewProps = {
  modelUri?: string;
  items: WardrobeItem[];
  modelLayout?: TryOnModelResult | null;
  isModelLoading?: boolean;
};

type PixelPoint = { x: number; y: number };
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const dist = (a: PixelPoint, b: PixelPoint) => Math.hypot(a.x - b.x, a.y - b.y);

const center = (a: PixelPoint, b: PixelPoint): PixelPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const getContainFrame = (
  containerW: number,
  containerH: number,
  sourceW: number | undefined,
  sourceH: number | undefined
): PixelBox => {
  if (!sourceW || !sourceH || sourceW <= 0 || sourceH <= 0) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }
  const sourceAspect = sourceW / sourceH;
  const containerAspect = containerW / containerH;
  if (sourceAspect > containerAspect) {
    const width = containerW;
    const height = width / sourceAspect;
    return { x: 0, y: (containerH - height) / 2, width, height };
  }
  const height = containerH;
  const width = height * sourceAspect;
  return { x: (containerW - width) / 2, y: 0, width, height };
};

const toPixel = (point: TryOnPoint | undefined, frame: PixelBox, fallback: PixelPoint): PixelPoint => {
  if (!point) return fallback;
  return {
    x: frame.x + clamp(point.x, 0, 1) * frame.width,
    y: frame.y + clamp(point.y, 0, 1) * frame.height
  };
};

const buildLayer = (x: number, y: number, width: number, height: number, rotateDeg: number, zIndex: number): LayerBox => ({
  x,
  y,
  width: Math.max(30, width),
  height: Math.max(28, height),
  rotateDeg,
  zIndex
});

export function TryOnPreview({ modelUri, items, modelLayout, isModelLoading }: TryOnPreviewProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const isAvatarMode = Boolean(modelLayout?.avatarModelBase64);
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
    const frame = getContainFrame(box.width, box.height, modelLayout?.sourceWidth, modelLayout?.sourceHeight);

    const fallbackPoints = {
      ls: { x: frame.x + frame.width * 0.38, y: frame.y + frame.height * 0.2 },
      rs: { x: frame.x + frame.width * 0.62, y: frame.y + frame.height * 0.2 },
      lh: { x: frame.x + frame.width * 0.42, y: frame.y + frame.height * 0.5 },
      rh: { x: frame.x + frame.width * 0.58, y: frame.y + frame.height * 0.5 },
      la: { x: frame.x + frame.width * 0.44, y: frame.y + frame.height * 0.9 },
      ra: { x: frame.x + frame.width * 0.56, y: frame.y + frame.height * 0.9 },
      nose: { x: frame.x + frame.width * 0.5, y: frame.y + frame.height * 0.08 }
    };

    const pose = modelLayout?.pose;
    const ls = toPixel(pose?.leftShoulder, frame, fallbackPoints.ls);
    const rs = toPixel(pose?.rightShoulder, frame, fallbackPoints.rs);
    const lh = toPixel(pose?.leftHip, frame, fallbackPoints.lh);
    const rh = toPixel(pose?.rightHip, frame, fallbackPoints.rh);
    const la = toPixel(pose?.leftAnkle, frame, fallbackPoints.la);
    const ra = toPixel(pose?.rightAnkle, frame, fallbackPoints.ra);
    const nose = toPixel(pose?.nose, frame, fallbackPoints.nose);

    const shoulderCenter = center(ls, rs);
    const hipCenter = center(lh, rh);
    const ankleCenter = center(la, ra);

    const shoulderWidth = Math.max(frame.width * 0.2, dist(ls, rs));
    const hipWidth = Math.max(frame.width * 0.18, dist(lh, rh));
    const torsoLength = Math.max(frame.height * 0.16, dist(shoulderCenter, hipCenter));
    const legLength = Math.max(frame.height * 0.2, dist(hipCenter, ankleCenter));
    const torsoRotate = clamp(modelLayout?.torsoAngleDeg ?? 0, -20, 20);
    const facing = modelLayout?.orientation ?? 'front';
    const sideFactor = facing === 'front' ? 1 : 0.82;

    const topWidth = shoulderWidth * 1.46 * sideFactor;
    const topHeight = torsoLength * 1.58;
    const outerWidth = topWidth * 1.08;
    const outerHeight = topHeight * 1.08;
    const bottomWidth = Math.max(hipWidth * 1.55, shoulderWidth * 1.1) * sideFactor;
    const bottomHeight = legLength * 0.92;
    const shoesWidth = hipWidth * 1.04 * sideFactor;
    const shoesHeight = Math.max(42, legLength * 0.34);
    const bagWidth = shoulderWidth * 0.62;
    const bagHeight = torsoLength * 0.92;
    const bagLeft = facing === 'left' ? shoulderCenter.x - bagWidth * 0.9 : shoulderCenter.x + bagWidth * 0.15;
    const bagTop = hipCenter.y - bagHeight * 0.5;

    const layers: Record<string, LayerBox> = {
      Верх: buildLayer(
        shoulderCenter.x - topWidth / 2,
        shoulderCenter.y - topHeight * 0.18,
        topWidth,
        topHeight,
        torsoRotate,
        4
      ),
      'Верхняя одежда': buildLayer(
        shoulderCenter.x - outerWidth / 2,
        shoulderCenter.y - outerHeight * 0.2,
        outerWidth,
        outerHeight,
        torsoRotate,
        5
      ),
      Низ: buildLayer(
        hipCenter.x - bottomWidth / 2,
        hipCenter.y - bottomHeight * 0.12,
        bottomWidth,
        bottomHeight,
        torsoRotate * 0.55,
        3
      ),
      Обувь: buildLayer(
        ankleCenter.x - shoesWidth / 2,
        ankleCenter.y - shoesHeight * 0.5,
        shoesWidth,
        shoesHeight,
        torsoRotate * 0.2,
        2
      ),
      Сумки: buildLayer(bagLeft, bagTop, bagWidth, bagHeight, torsoRotate * 0.4, 6)
    };

    // If nose is very low, user probably cropped head. Shift overlays down less.
    if (nose.y > frame.y + frame.height * 0.2) {
      layers.Верх.y += 10;
      layers['Верхняя одежда'].y += 8;
    }

    return layers;
  }, [box.height, box.width, modelLayout]);

  if (!modelUri) {
    return (
      <View style={[styles.preview, styles.emptyPreview]}>
        <Text style={styles.emptyTitle}>Нет фото для примерки</Text>
        <Text style={styles.emptyText}>Добавь фото в полный рост в профиле, и образы появятся на тебе.</Text>
      </View>
    );
  }

  return (
    <View style={styles.preview} onLayout={onLayout}>
      <Image source={{ uri: modelUri }} style={styles.modelPhoto} resizeMode="contain" />
      <View style={[styles.overlayShade, isAvatarMode && styles.overlayShadeAvatar]} />
      {isModelLoading ? (
        <View style={styles.loadingBadge}>
          <Text style={styles.loadingText}>{isAvatarMode ? 'Готовим аватар для примерки...' : 'Подстраиваем образ под позу...'}</Text>
        </View>
      ) : null}
      {sorted.map((item) => {
        if (!item.imageUri) return null;
        const layer = layerBySection[item.section];
        if (!layer) return null;
        return (
          <Image
            key={item.id}
            source={{ uri: item.imageUri }}
            resizeMode="contain"
            style={[
              styles.layerItem,
              {
                top: layer.y,
                left: layer.x,
                width: layer.width,
                height: layer.height,
                zIndex: layer.zIndex,
                transform: [{ rotate: `${layer.rotateDeg}deg` }]
              }
            ]}
          />
        );
      })}
      {isAvatarMode ? <Image source={{ uri: modelUri }} style={styles.foregroundAvatar} resizeMode="contain" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 356,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: '#F4F0E8',
    marginBottom: 8
  },
  emptyPreview: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 6
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
    color: COLORS.muted,
    lineHeight: 18
  },
  modelPhoto: {
    ...StyleSheet.absoluteFillObject
  },
  overlayShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.12)'
  },
  overlayShadeAvatar: {
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  foregroundAvatar: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.16
  },
  layerItem: {
    position: 'absolute'
  },
  loadingBadge: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(30,28,25,0.8)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600'
  }
});
