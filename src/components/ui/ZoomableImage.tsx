import { useContext, useState } from 'react';
import { Image, Platform, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SheetGestureContext } from '../studio/SheetHandle';
import { isZoomed } from '../studio/sheetGesture';

/**
 * A try-on result that can be pinched up to 4x, to look at a seam or a print
 * the way the full-size picture has it. A tall photo leaves the look a narrow
 * strip on the phone; without zoom its detail was out of reach. iOS zooms a
 * ScrollView natively; elsewhere the picture is shown as it is. At its normal size
 * the photo doesn't pan or bounce at all: a drag on it belongs to the sheet or pager
 * around it. Pinching works regardless, it isn't the ScrollView's pan.
 */
export function ZoomableImage({ uri, style, accessibilityLabel }: { uri: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomed, setZoomed] = useState(false);
  const hub = useContext(SheetGestureContext);
  if (Platform.OS !== 'ios') {
    return <Image source={{ uri }} style={[styles.fill, style as object]} resizeMode="contain" accessibilityLabel={accessibilityLabel} />;
  }
  return (
    <View style={[styles.fill, style]} onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      {size.width > 0 ? (
        <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={size} maximumZoomScale={4} minimumZoomScale={1}
          bouncesZoom centerContent pinchGestureEnabled showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
          scrollEnabled={zoomed} bounces={zoomed} alwaysBounceVertical={false} alwaysBounceHorizontal={false} scrollEventThrottle={16}
          onScroll={event => { const next = isZoomed(event.nativeEvent.zoomScale); if (next !== zoomed) setZoomed(next); }}
          onTouchStart={() => { if (zoomed) hub?.touchInert(); }}>
          <Image source={{ uri }} style={size} resizeMode="contain" accessibilityLabel={accessibilityLabel} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 }
});
