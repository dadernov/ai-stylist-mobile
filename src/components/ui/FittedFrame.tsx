import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, LayoutAnimation, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { fitRect, heldAspect, heldHeight, MeasuredAspect, pictureFit } from '../studio/imageFit';
import { useReducedMotion } from '../studio/studio';
import { useImageAspect } from '../studio/useImageAspect';

/** Measuring usually takes less: only a wait that lasts gets a spinner. */
const LOADER_DELAY_MS = 400;
const GROW = { duration: 280, update: { type: LayoutAnimation.Types.easeInEaseOut } };

type FrameProps = {
  /** The picture's shape; while it is `undefined` the last known one stays, and nothing is drawn if there was none. */
  aspect: MeasuredAspect;
  radius: number;
  /** The space available: invisible, it only places the picture. */
  style?: StyleProp<ViewStyle>;
  /** The available height may only shrink, so changes around it do not resize the picture. Let go, the picture grows smoothly to the space. */
  holdHeight?: boolean;
  /** Only for when there is no picture to show. */
  fill?: string;
  children?: ReactNode;
};

/** A rounded container exactly the size of the picture on screen, centred in the space, so the corners are the picture's. */
export function FittedFrame({ aspect, radius, style, holdHeight, fill, children }: FrameProps) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const space = useRef(box);
  const held = useRef(false);
  const lastAspect = useRef<MeasuredAspect>(undefined);
  lastAspect.current = heldAspect(lastAspect.current, aspect);
  const shown = lastAspect.current;
  const rect = fitRect(shown, box.width, box.height);

  const [slow, setSlow] = useState(false);
  const measuring = aspect === undefined;
  useEffect(() => {
    if (!measuring) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [measuring]);

  // A hold once let go: the room it held back is taken in one calm move, whichever comes first, the release or the new layout.
  const growTo = (next: { width: number; height: number }) => {
    if (box.width === next.width && box.height === next.height) return;
    if (held.current && !reduced && box.height > 0 && box.width === next.width && next.height > box.height) LayoutAnimation.configureNext(GROW);
    setBox(next);
  };
  useEffect(() => {
    if (holdHeight) held.current = true;
    else if (held.current) growTo(space.current);
  }, [holdHeight]);

  return (
    <View style={[styles.box, style]} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      space.current = { width, height };
      if (!holdHeight) { growTo(space.current); return; }
      setBox(prev => {
        const next = prev.width === width ? heldHeight(prev.height, height) : height;
        return prev.width === width && prev.height === next ? prev : { width, height: next };
      });
    }}>
      {shown !== undefined && rect.width ? (
        <View style={{ width: rect.width, height: rect.height, borderRadius: radius, overflow: 'hidden', backgroundColor: fill }}>{children}</View>
      ) : null}
      {measuring && slow ? <View pointerEvents="none" style={styles.loader}><ActivityIndicator /></View> : null}
    </View>
  );
}

/** A still picture with truly rounded corners: it fills its own rect, so the cover fit crops nothing; of an unknown shape it is shown whole. */
export function FittedImage({ uri, radius, style, accessibilityLabel }: { uri: string; radius: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const aspect = useImageAspect(uri);
  return (
    <FittedFrame aspect={aspect} radius={radius} style={style}>
      <Image source={{ uri }} resizeMode={pictureFit(aspect)} style={StyleSheet.absoluteFill} accessibilityLabel={accessibilityLabel} />
    </FittedFrame>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  loader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }
});
