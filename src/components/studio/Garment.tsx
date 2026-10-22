import { Image, ImageStyle, StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Shirt } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { INK_FAINT, isCutout } from './studio';

/** The soft floor shadow under a floating piece. */
export function FloorShadow({ width, opacity = 0.32 }: { width: number; opacity?: number }) {
  return (
    <Svg width={width} height={34}>
      <Defs>
        <RadialGradient id="floor" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#121417" stopOpacity={opacity} />
          <Stop offset="1" stopColor="#121417" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={17} rx={width / 2} ry={17} fill="url(#floor)" />
    </Svg>
  );
}

/** A garment on the stage: a cut-out floats bare, a photo with its own ground becomes a rounded print (`print`). */
export function GarmentImage({ item, style, blur, print, printRadius = 28 }: { item?: WardrobeItem; style: StyleProp<ImageStyle>; blur?: number; print?: boolean; printRadius?: number }) {
  if (!item?.imageUri) return <View style={[style as StyleProp<ViewStyle>, { alignItems: 'center', justifyContent: 'center' }]}><Shirt size={48} strokeWidth={1} color={INK_FAINT} /></View>;
  if (print && !isCutout(item.imageUri)) {
    return (
      <View style={[style as StyleProp<ViewStyle>, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image source={{ uri: item.imageUri }} resizeMode="cover" blurRadius={blur}
          style={{ width: '84%', height: '92%', borderRadius: printRadius }} />
      </View>
    );
  }
  return <Image source={{ uri: item.imageUri }} style={style} resizeMode="contain" blurRadius={blur} />;
}
