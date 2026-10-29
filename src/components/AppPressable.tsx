import { ReactNode, useCallback, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleSheet
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from './studio/studio';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type AppPressableProps = PressableProps & {
  children: ReactNode;
  feedback?: boolean;
  // Лёгкая хаптика при нажатии (по умолчанию выключена).
  haptics?: boolean;
};

export function AppPressable({
  style,
  feedback = true,
  haptics = false,
  android_ripple,
  onPressIn,
  onPressOut,
  children,
  ...props
}: AppPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  // Reduced motion: no springy scale, the opacity dip alone shows the press.
  const reduced = useReducedMotion();
  const animate = feedback && !reduced;

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setPressed(true);
      if (animate) {
        Animated.spring(scale, {
          toValue: 0.97,
          speed: 50,
          bounciness: 4,
          useNativeDriver: true
        }).start();
      }
      if (haptics && Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      onPressIn?.(event);
    },
    [animate, haptics, onPressIn, scale]
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      setPressed(false);
      if (animate) {
        Animated.spring(scale, {
          toValue: 1,
          speed: 40,
          bounciness: 7,
          useNativeDriver: true
        }).start();
      }
      onPressOut?.(event);
    },
    [animate, onPressOut, scale]
  );

  const ripple = android_ripple ?? (feedback ? { color: 'rgba(0,0,0,0.08)' } : undefined);

  return (
    <AnimatedPressable
      {...props}
      android_ripple={ripple}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        typeof style === 'function' ? style({ pressed }) : style,
        animate ? { transform: [{ scale }] } : null,
        feedback && pressed ? styles.pressed : null
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.9
  }
});
