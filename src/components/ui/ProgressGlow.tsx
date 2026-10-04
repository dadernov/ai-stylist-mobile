import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeColors } from '../../constants/theme';
import { useTheme, useThemedStyles } from '../../constants/ThemeContext';

type ProgressGlowProps = {
  visible: boolean;
};

// Индетерминированный тонкий прогресс-бар: по треку бежит бронзовый блик.
export function ProgressGlow({ visible }: ProgressGlowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || trackWidth <= 0) {
      return;
    }
    progress.setValue(0);
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true
      })
    );
    anim.start();
    return () => anim.stop();
  }, [visible, trackWidth, progress]);

  if (!visible) {
    return null;
  }

  const glowWidth = Math.max(trackWidth * 0.38, 56);
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-glowWidth, trackWidth]
  });

  return (
    <View
      style={styles.track}
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      {trackWidth > 0 ? (
        <Animated.View style={[styles.glow, { width: glowWidth, transform: [{ translateX }] }]}>
          <LinearGradient
            colors={[colors.goldTransparent, colors.accentGold, colors.goldTransparent] as const}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: c.accentGoldSoft,
    overflow: 'hidden',
    alignSelf: 'stretch'
  },
  glow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0
  }
});
