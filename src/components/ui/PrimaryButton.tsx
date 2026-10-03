import { ActivityIndicator, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeColors } from '../../constants/theme';
import { useTheme, useThemedStyles } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { LucideIcon } from 'lucide-react-native';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'gold' | 'ghost';
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  icon?: LucideIcon;
};

export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  style,
  icon: Icon
}: PrimaryButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const blocked = disabled || loading;
  const radius = 999;

  const contentColor =
    variant === 'primary' ? colors.buttonPrimaryText : variant === 'gold' ? colors.textOnGold : colors.text;

  return (
    <AppPressable
      haptics
      disabled={blocked}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        variant === 'primary' && styles.primary,
        variant === 'gold' && styles.gold,
        variant === 'ghost' && styles.ghost,
        blocked && styles.disabled,
        style
      ]}
    >
      {variant === 'gold' ? (
        <LinearGradient
          colors={[colors.goldFrom, colors.goldTo] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, pointerEvents: 'none' }]}
        />
      ) : null}
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <>
        {Icon && <Icon size={18} strokeWidth={1.7} color={contentColor} />}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.text, size === 'lg' && styles.textLg, { color: contentColor }, styles.label]}>
          {title}
        </Text>
        </>
      )}
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10
  },
  md: {
    height: 52,
    borderRadius: 0,
    paddingHorizontal: 26
  },
  lg: {
    height: 58,
    borderRadius: 0,
    paddingHorizontal: 32
  },
  primary: {
    backgroundColor: c.buttonPrimaryBg
  },
  gold: {
    backgroundColor: c.accentGold
  },
  ghost: {
    backgroundColor: c.surface
  },
  disabled: {
    opacity: 0.5
  },
  text: {
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  textLg: {
    fontSize: 13
  },
  label: {
    flexShrink: 1
  }
});
