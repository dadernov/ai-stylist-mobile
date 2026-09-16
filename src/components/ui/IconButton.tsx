import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { useTheme } from '../../constants/ThemeContext';

export function IconButton({ icon: Icon, label, onPress, danger = false }: {
  icon: LucideIcon; label: string; onPress: () => void; danger?: boolean;
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  return <View style={styles.wrap}>
    <AppPressable haptics accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Icon size={19} strokeWidth={1.6} color={danger ? colors.danger : colors.text} />
    </AppPressable>
    {hovered && <View pointerEvents="none" style={[styles.tooltip, { backgroundColor: colors.toastBg }]}>
      <Text style={{ color: colors.toastText, fontSize: 11 }}>{label}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 2 },
  button: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tooltip: { position: 'absolute', top: 48, right: 0, minWidth: 110, padding: 8, borderRadius: 4, zIndex: 5 }
});
