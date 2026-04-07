import { Pressable, PressableProps, StyleSheet } from 'react-native';
import { ReactNode } from 'react';

type AppPressableProps = PressableProps & {
  children: ReactNode;
  feedback?: boolean;
};

export function AppPressable({ style, feedback = true, android_ripple, children, ...props }: AppPressableProps) {
  const ripple = android_ripple ?? (feedback ? { color: 'rgba(0,0,0,0.08)' } : undefined);
  return (
    <Pressable
      {...props}
      android_ripple={ripple}
      style={({ pressed }) => [
        typeof style === 'function' ? style({ pressed }) : style,
        feedback && pressed && styles.pressed
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.65
  }
});
