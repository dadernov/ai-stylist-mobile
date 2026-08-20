import { useEffect, useRef } from 'react';
import { Animated, DimensionValue, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { RADII, ThemeColors } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

// Пульсирующий плейсхолдер загрузки.
export function Skeleton({ width = '100%', height = 16, radius = RADII.sm, style }: SkeletonProps) {
  const styles = useThemedStyles(makeStyles);
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true })
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius: radius, opacity: pulse }, style]}
    />
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  base: {
    backgroundColor: c.skeleton
  }
});
