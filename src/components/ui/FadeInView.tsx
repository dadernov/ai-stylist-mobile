import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, ViewStyle } from 'react-native';

type FadeInViewProps = {
  // Задержка старта в мс — для стаггера списков: delay={index * 60}.
  delay?: number;
  // Начальное смещение вниз в pt.
  dy?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// Входная анимация fade + translateY при маунте (нативный драйвер).
export function FadeInView({ delay = 0, dy = 14, style, children }: FadeInViewProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    anim.start();
    return () => anim.stop();
  }, [delay, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
