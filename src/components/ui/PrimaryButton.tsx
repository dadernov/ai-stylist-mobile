import { ActivityIndicator, StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { LucideIcon } from 'lucide-react-native';
import { Glass, PrimarySurface } from '../studio/Glass';
import { font, INK } from '../studio/studio';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'gold' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  icon?: LucideIcon;
};

/**
 * The main button as the studio draws it: a black pill with the sheen. `ghost` is the quieter
 * one beside it: a glass pill. 'gold' is kept for older callers and draws as 'primary'.
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
  const { isDark } = useTheme();
  const blocked = disabled || loading;
  const filled = variant !== 'ghost';
  const ink = filled ? (isDark ? INK : '#FFFFFF') : (isDark ? '#FFFFFF' : INK);
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : 50;

  const content = (
    <View style={{ height, paddingHorizontal: size === 'sm' ? 16 : 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      {loading ? (
        <ActivityIndicator size="small" color={ink} />
      ) : (
        <>
          {Icon ? <Icon size={18} strokeWidth={1.8} color={ink} /> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={[font('semibold'), { flexShrink: 1, color: ink, fontSize: size === 'lg' ? 16 : size === 'sm' ? 13 : 15 }]}>
            {title}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <AppPressable
      haptics
      disabled={blocked}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={[{ borderRadius: 999, opacity: blocked ? 0.45 : 1 }, style]}
    >
      {filled ? <PrimarySurface dark={isDark}>{content}</PrimarySurface> : <Glass>{content}</Glass>}
    </AppPressable>
  );
}
