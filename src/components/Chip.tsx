import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';
import { Glass } from './studio/Glass';
import { font, INK } from './studio/studio';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  // Эмодзи-иконка слева от подписи.
  icon?: string;
};

export function Chip({ label, active = false, onPress, icon }: ChipProps) {
  const { isDark } = useTheme();
  const activeProgress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(activeProgress, {
      toValue: active ? 1 : 0,
      duration: 200,
      useNativeDriver: true
    }).start();
  }, [active, activeProgress]);

  const activeText = isDark ? INK : '#FFFFFF';
  const idleText = isDark ? '#E4E6EA' : '#3F444B';
  return (
    <AppPressable haptics accessibilityState={{ selected: active }} style={styles.chip} onPress={onPress}>
      <Glass style={StyleSheet.absoluteFill} />
      {/* The black fill fades in over the glass when the chip is chosen. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 999, backgroundColor: isDark ? '#FFFFFF' : INK, opacity: activeProgress }]} />
      <View style={styles.content}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[font('semibold'), styles.label, { color: active ? activeText : idleText }]}>{label}</Text>
      </View>
    </AppPressable>
  );
}

const styles = StyleSheet.create({
  chip: { height: 36, paddingHorizontal: 16, marginRight: 8, borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  icon: { fontSize: 15, lineHeight: 20, includeFontPadding: false },
  label: { fontSize: 13, lineHeight: 18, textAlign: 'center', includeFontPadding: false }
});
