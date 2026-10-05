import { useState } from 'react';
import { Image, Platform, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

/**
 * A try-on result that can be pinched up to 4x, to look at a seam or a print
 * the way the full-size picture has it. A tall photo leaves the look a narrow
 * strip on the phone; without zoom its detail was out of reach. iOS zooms a
 * ScrollView natively; elsewhere the picture is shown as it is.
 */
export function ZoomableImage({ uri, style, accessibilityLabel }: { uri: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  if (Platform.OS !== 'ios') {
    return <Image source={{ uri }} style={[styles.fill, style as object]} resizeMode="contain" accessibilityLabel={accessibilityLabel} />;
  }
  return (
    <View style={[styles.fill, style]} onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      {size.width > 0 ? (
        <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={size} maximumZoomScale={4} minimumZoomScale={1}
          bouncesZoom centerContent pinchGestureEnabled showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
          <Image source={{ uri }} style={size} resizeMode="contain" accessibilityLabel={accessibilityLabel} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 }
});
