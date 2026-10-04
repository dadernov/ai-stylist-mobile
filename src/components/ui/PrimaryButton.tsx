import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
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
 * The main button: a filled pill that stands off the page with its own shadow,
 * its icon in a round badge at the end. `ghost` is the quieter one beside it:
 * an outlined pill. 'gold' is kept for older callers and draws as 'primary'.
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
        filled && Icon ? styles.withBadge : null,
        blocked && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <>
          {Icon && !filled ? <Icon size={18} strokeWidth={1.8} color={contentColor} /> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={[styles.text, size === 'lg' && styles.textLg, { color: contentColor }]}>
            {title}
          </Text>
          {Icon && filled ? (
            <View style={[styles.badge, size === 'lg' && styles.badgeLg, { backgroundColor: contentColor }]}>
              <Icon size={size === 'lg' ? 19 : 17} strokeWidth={2} color={colors.buttonPrimaryBg} />
            </View>
          ) : null}
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
    borderRadius: 999
  },
  md: {
    height: 56,
    paddingHorizontal: 28
  },
  lg: {
    height: 60,
    paddingHorizontal: 32
  },
  filled: {
    backgroundColor: c.buttonPrimaryBg,
    ...SHADOWS.button
  },
  // The badge sits at the end; the title stays centred on the whole button.
  withBadge: {
    paddingHorizontal: 58
  },
  ghost: {
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.text
  },
  disabled: {
    opacity: 0.45
  },
  text: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.1
  },
  textLg: {
    fontSize: 17
  },
  badge: {
    position: 'absolute',
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeLg: {
    right: 9,
    width: 42,
    height: 42,
    borderRadius: 21
  }
});
