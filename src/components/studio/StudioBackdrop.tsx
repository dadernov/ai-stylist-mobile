import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../constants/ThemeContext';

/**
 * The seamless studio backdrop behind every screen: a soft key light in the middle, tinted by whatever the
 * screen puts in focus (useStudioTint). A new tint fades in over the old one, so the light changes colour
 * rather than jumping.
 */
type TintState = { color: string | null; focusY: number };
const StudioContext = createContext<(tint: TintState) => void>(() => {});

/** Screens call this with the colour of the piece in focus, or null for plain light. */
export function useStudioTint(color: string | null, focusY = 0.44) {
  const set = useContext(StudioContext);
  useEffect(() => { set({ color, focusY }); }, [color, focusY, set]);
  useEffect(() => () => set({ color: null, focusY: 0.44 }), [set]);
}

function Light({ id, color, y, opacity }: { id: string; color: string; y: number; opacity: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy={`${Math.round(y * 100)}%`} rx="62%" ry="36%" fx="50%" fy={`${Math.round(y * 100)}%`}>
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="0.5" stopColor={color} stopOpacity={opacity * 0.5} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function StudioBackdrop({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  const [layers, setLayers] = useState<{ key: number; tint: TintState }[]>([{ key: 0, tint: { color: null, focusY: 0.44 } }]);
  const fade = useRef(new Animated.Value(1)).current;
  const counter = useRef(0);
  const set = useRef((tint: TintState) => {
    setLayers(current => {
      const last = current[current.length - 1];
      if (last.tint.color === tint.color && last.tint.focusY === tint.focusY) return current;
      counter.current += 1;
      return [last, { key: counter.current, tint }];
    });
  }).current;
  useEffect(() => {
    if (layers.length < 2) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 1000, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setLayers(current => current.slice(-1));
    });
  }, [layers.length > 1 ? layers[1].key : 0]);
  const base = isDark ? ['#24272C', '#181A1E', '#101215'] : ['#FFFFFF', '#F2F2F0', '#E4E4E1'];
  return (
    <View style={{ flex: 1, backgroundColor: base[2] }}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="studio-base" cx="50%" cy="44%" rx="80%" ry="50%" fx="50%" fy="44%">
            <Stop offset="0" stopColor={base[0]} />
            <Stop offset="0.6" stopColor={base[1]} />
            <Stop offset="1" stopColor={base[2]} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#studio-base)" />
      </Svg>
      {layers.map((layer, index) => layer.tint.color ? (
        <Animated.View key={layer.key} pointerEvents="none" style={[StyleSheet.absoluteFill, index === layers.length - 1 && layers.length > 1 ? { opacity: fade } : null]}>
          <Light id={`tint-${layer.key}`} color={layer.tint.color} y={layer.tint.focusY} opacity={isDark ? 0.35 : 0.85} />
        </Animated.View>
      ) : null)}
      <StudioContext.Provider value={set}>{children}</StudioContext.Provider>
    </View>
  );
}
