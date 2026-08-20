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
      {/* Слой активного состояния: плавно проявляется поверх базового фона. */}
      <Animated.View style={[styles.activeLayer, { opacity: activeProgress }]} />
      <View style={styles.content}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      </View>
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip: {
    backgroundColor: c.chip,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 22,
    height: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
    marginRight: 12
  },
  activeLayer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: 21
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
    color: c.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' as const } : null)
  },
  labelActive: {
    fontWeight: '700'
  }
});
