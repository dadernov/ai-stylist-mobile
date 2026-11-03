import { ReactNode, useState } from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { fitRect, heldHeight, MeasuredAspect } from '../studio/imageFit';
import { useImageAspect } from '../studio/useImageAspect';

type FrameProps = {
  /** The picture's shape; while it is `undefined` nothing is drawn, an empty frame least of all. */
  aspect: MeasuredAspect;
  radius: number;
  /** The space available: invisible, it only places the picture. */
  style?: StyleProp<ViewStyle>;
  /** The available height may only shrink, so changes around it do not resize the picture. */
  holdHeight?: boolean;
  /** Only for when there is no picture to show. */
  fill?: string;
  children?: ReactNode;
};

/** A rounded container exactly the size of the picture on screen, centred in the space, so the corners are the picture's. */
export function FittedFrame({ aspect, radius, style, holdHeight, fill, children }: FrameProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const rect = fitRect(aspect, box.width, box.height);
  return (
    <View style={[styles.box, style]} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      setBox(prev => {
        const next = holdHeight && prev.width === width ? heldHeight(prev.height, height) : height;
        return prev.width === width && prev.height === next ? prev : { width, height: next };
      });
    }}>
      {aspect !== undefined && rect.width ? (
        <View style={{ width: rect.width, height: rect.height, borderRadius: radius, overflow: 'hidden', backgroundColor: fill }}>{children}</View>
      ) : null}
    </View>
  );
}

/** A still picture with truly rounded corners: it fills its own rect, so the cover fit crops nothing. */
export function FittedImage({ uri, radius, style, accessibilityLabel }: { uri: string; radius: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const aspect = useImageAspect(uri);
  return (
    <FittedFrame aspect={aspect} radius={radius} style={style}>
      <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityLabel={accessibilityLabel} />
    </FittedFrame>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' }
});
