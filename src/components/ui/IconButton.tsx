import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { useTheme } from '../../constants/ThemeContext';
import { Glass } from '../studio/Glass';

export function IconButton({ icon: Icon, label, onPress, danger = false, variant = 'default' }: {
  icon: LucideIcon; label: string; onPress: () => void; danger?: boolean; variant?: 'default' | 'quiet';
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const icon = (size: number, color: string) => <View style={styles.center}><Icon size={size} strokeWidth={1.6} color={danger ? colors.danger : color} /></View>;
  return <View style={styles.wrap}>
    <AppPressable haptics accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={variant === 'quiet' ? styles.quiet : styles.button}>
      {variant === 'quiet' ? icon(24, colors.muted) : <Glass style={styles.button}>{icon(18, colors.text)}</Glass>}
    </AppPressable>
    {hovered && <View pointerEvents="none" style={[styles.tooltip, { backgroundColor: colors.toastBg }]}>
      <Text style={{ color: colors.toastText, fontSize: 11 }}>{label}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 2 },
  button: { width: 40, height: 40, borderRadius: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  quiet: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tooltip: { position: 'absolute', top: 44, right: 0, minWidth: 110, padding: 8, borderRadius: 4, zIndex: 5 }
});
