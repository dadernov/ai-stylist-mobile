import { ActivityIndicator, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { SHADOWS, ThemeColors } from '../../constants/theme';
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

/**
 * The main button: a flat black rectangle with its icon before the title, as on
 * fashion storefronts. `ghost` is the quieter one beside it: white with a thin
 * black outline. 'gold' is kept for older callers and draws as 'primary'.
 */
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
  const filled = variant !== 'ghost';
  const contentColor = filled ? colors.buttonPrimaryText : colors.text;

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
        filled ? styles.filled : styles.ghost,
        blocked && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <>
          {Icon ? <Icon size={18} strokeWidth={1.8} color={contentColor} /> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={[styles.text, size === 'lg' && styles.textLg, { color: contentColor }]}>
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
    gap: 10,
    borderRadius: 4
  },
  md: {
    height: 52,
    paddingHorizontal: 24
  },
  lg: {
    height: 56,
    paddingHorizontal: 28
  },
  filled: {
    backgroundColor: c.buttonPrimaryBg,
    ...SHADOWS.button
  },
  ghost: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.text
  },
  disabled: {
    opacity: 0.45
  },
  text: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0
  },
  textLg: {
    fontSize: 16
  }
});
