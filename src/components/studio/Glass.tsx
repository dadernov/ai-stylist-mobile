import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { font, INK, useReducedMotion } from './studio';

/** Frosted glass: the studio shows through, softened; a thin light edge keeps its shape on light ground. */
export function Glass({ children, style, radius = 999, intensity = 40 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; intensity?: number }) {
  const { isDark } = useTheme();
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: isDark ? 'rgba(40,43,48,0.55)' : 'rgba(255,255,255,0.55)',
        borderWidth: StyleSheet.hairlineWidth * 2, borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)' }]} />
      {children}
    </View>
  );
}

/** A light that sweeps across the primary button now and then, so the main action reads as alive. */
function Sheen({ width }: { width: number }) {
  const x = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !width) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 2700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, width]);
  if (reduced || !width) return null;
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, width: width * 0.45,
    backgroundColor: 'rgba(255,255,255,0.16)', transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width * 1.2] }) }, { skewX: '-18deg' }] }} />;
}

type PillProps = { title?: string; icon?: LucideIcon; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>;
  variant?: 'primary' | 'glass'; size?: 'md' | 'sm' | 'icon'; accessibilityLabel?: string; iconColor?: string;
  /** Fills the icon with its own colour, e.g. a saved heart. */ iconFill?: boolean;
  accessibilityState?: { selected?: boolean; disabled?: boolean } };

/** The studio's buttons: a black pill for the one main action, glass pills for the rest. */
export function Pill({ title, icon: Icon, onPress, disabled, style, variant = 'glass', size = 'md', accessibilityLabel, iconColor, iconFill, accessibilityState }: PillProps) {
  const { isDark } = useTheme();
  const height = size === 'md' ? 50 : size === 'sm' ? 38 : 44;
  const primary = variant === 'primary';
  const ink = primary ? (isDark ? INK : '#FFFFFF') : (isDark ? '#FFFFFF' : INK);
  const content = (
    <View style={{ height, minWidth: height, paddingHorizontal: size === 'icon' || !title ? 0 : size === 'sm' ? 14 : 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {Icon ? <Icon size={size === 'md' ? 19 : 17} strokeWidth={1.8} color={iconColor || ink} fill={iconFill ? iconColor || ink : 'none'} /> : null}
      {title ? <Text style={[font('semibold'), { color: ink, fontSize: size === 'sm' ? 13 : 15 }]} numberOfLines={1}>{title}</Text> : null}
    </View>
  );
  return (
    <AppPressable haptics accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={accessibilityState} disabled={disabled} onPress={onPress}
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
      <Sheen width={w} />
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
