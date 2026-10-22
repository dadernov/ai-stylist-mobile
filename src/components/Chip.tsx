import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  // Эмодзи-иконка слева от подписи.
  icon?: string;
};

export function Chip({ label, active = false, onPress, icon }: ChipProps) {
  const styles = useThemedStyles(makeStyles);
  const activeProgress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(activeProgress, {
      toValue: active ? 1 : 0,
      duration: 200,
      useNativeDriver: true
    }).start();
  }, [active, activeProgress]);

  return (
    <AppPressable haptics style={styles.chip} onPress={onPress}>
      {/* Выбранный пункт подчёркнут, как раздел в навигации магазина; черта плавно проявляется. */}
      <Animated.View style={[styles.activeLayer, { opacity: activeProgress }]} />
      <View style={styles.content}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      </View>
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // A text tab, not a filled pill: choices read as a store's sections, the chosen one underlined.
  chip: {
    height: 36,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  activeLayer: {
    position: 'absolute', left: 0, right: 0, bottom: 2, height: 1.5,
    pointerEvents: 'none',
    backgroundColor: c.text
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  icon: {
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false
  },
  label: {
    color: c.muted,
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0,
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' as const } : null)
  },
  labelActive: {
    color: c.text
  }
});
