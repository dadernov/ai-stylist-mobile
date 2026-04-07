import { Platform, StyleSheet, Text } from 'react-native';
import { COLORS } from '../constants/theme';
import { AppPressable } from './AppPressable';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
};

export function Chip({ label, active = false, onPress }: ChipProps) {
  return (
    <AppPressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </AppPressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: COLORS.chip,
    borderRadius: 22,
    height: 44,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
    marginRight: 12
  },
  chipActive: {
    backgroundColor: COLORS.text
  },
  chipText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' } : null)
  },
  chipTextActive: {
    color: '#FFFFFF'
  }
});
