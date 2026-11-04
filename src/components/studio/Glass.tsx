import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { font, glassEdge, glassFill, INK, useReducedMotion } from './studio';

/** Frosted glass: the studio shows through, softened; a thin light edge keeps its shape on light ground. */
export function Glass({ children, style, radius = 999, intensity = 40 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; intensity?: number }) {
  const { isDark } = useTheme();
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: glassFill(isDark),
        borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glassEdge(isDark) }]} />
      {children}
    </View>
  );
}

/** A light that sweeps across the primary button now and then, so the main action reads as alive. */
type PillProps = { title?: string; icon?: LucideIcon; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>;
  variant?: 'primary' | 'glass'; size?: 'md' | 'sm' | 'icon'; accessibilityLabel?: string; iconColor?: string;
  /** Fills the icon with its own colour, e.g. a saved heart. */ iconFill?: boolean;
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean };
  /** Work in progress: a spinner takes the icon slot and presses are ignored, without dimming the pill. */ loading?: boolean;
  /** Announced as busy to screen readers (implied by `loading`). */ busy?: boolean;
  /** A light tap on press (on by default). */ haptics?: boolean };

/** The studio's buttons: a black pill for the one main action, glass pills for the rest. */
export function Pill({ title, icon: Icon, onPress, disabled, style, variant = 'glass', size = 'md', accessibilityLabel, iconColor, iconFill, accessibilityState, loading, busy, haptics = true }: PillProps) {
  const { isDark } = useTheme();
  const height = size === 'md' ? 50 : size === 'sm' ? 38 : 44;
  const primary = variant === 'primary';
  // A heart (any filled icon) pops the moment it fills.
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const wasFilled = useRef(iconFill);
  useEffect(() => {
    if (iconFill && !wasFilled.current && !reduced) {
      pop.setValue(0.7);
      Animated.spring(pop, { toValue: 1, damping: 7, stiffness: 320, mass: 0.6, useNativeDriver: true }).start();
    }
    wasFilled.current = iconFill;
  }, [iconFill, reduced, pop]);
  const ink = primary ? (isDark ? INK : '#FFFFFF') : (isDark ? '#FFFFFF' : INK);
  const content = (
    <View style={{ height, minWidth: height, paddingHorizontal: size === 'icon' || !title ? 0 : size === 'sm' ? 14 : 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {loading ? <View style={{ width: size === 'md' ? 19 : 17, height: size === 'md' ? 19 : 17, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={iconColor || ink} style={{ transform: [{ scale: size === 'md' ? 0.9 : 0.8 }] }} />
      </View> : Icon ? <Animated.View style={{ transform: [{ scale: pop }] }}><Icon size={size === 'md' ? 19 : 17} strokeWidth={1.8} color={iconColor || ink} fill={iconFill ? iconColor || ink : 'none'} /></Animated.View> : null}
      {title ? <Text style={[font('semibold'), { color: ink, fontSize: size === 'sm' ? 13 : 15 }]} numberOfLines={1}>{title}</Text> : null}
    </View>
  );
  return (
    <AppPressable haptics={haptics} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled || loading || accessibilityState?.disabled), busy: Boolean(loading || busy || accessibilityState?.busy) }}
      disabled={disabled || loading} onPress={onPress}
      style={[{ borderRadius: 999, opacity: disabled ? 0.45 : 1 }, style]}>
      {primary ? (
        <PrimarySurface dark={isDark}>{content}</PrimarySurface>
      ) : <Glass>{content}</Glass>}
    </AppPressable>
  );
}

export function PrimarySurface({ children, dark }: { children: ReactNode; dark: boolean }) {
  const [w, setW] = useState(0);
  return (
    <View onLayout={(event: LayoutChangeEvent) => setW(event.nativeEvent.layout.width)}
      style={{ borderRadius: 999, overflow: 'hidden', backgroundColor: dark ? '#FFFFFF' : INK }}>
      {children}
    </View>
  );
}

/** A choice among several: black when chosen, glass otherwise. */
export function ChoicePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { isDark } = useTheme();
  const inner = <View style={{ height: 36, paddingHorizontal: 16, justifyContent: 'center' }}>
    <Text style={[font('semibold'), { fontSize: 13, color: active ? (isDark ? INK : '#FFFFFF') : (isDark ? '#E4E6EA' : '#3F444B') }]}>{label}</Text>
  </View>;
  return (
    <AppPressable haptics accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={{ borderRadius: 999 }}>
      {active ? <View style={{ borderRadius: 999, backgroundColor: isDark ? '#FFFFFF' : INK }}>{inner}</View> : <Glass>{inner}</Glass>}
    </AppPressable>
  );
}
