import { Platform, StyleSheet, Text } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
};

export function Chip({ label, active = false, onPress }: ChipProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <AppPressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip: {
    backgroundColor: c.chip,
    borderRadius: 22,
    height: 44,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
    marginRight: 12
  },
  chipActive: {
    backgroundColor: c.buttonPrimaryBg
  },
  chipText: {
    color: c.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' } : null)
  },
  chipTextActive: {
    color: c.buttonPrimaryText
  }
});
