import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { Glass } from './studio/Glass';
import { font, INK, INK_SOFT } from './studio/studio';

/**
 * A garment's facts set like the label sewn into it: a glass panel of name/value rows parted by hairlines.
 * Rows without a value are left out.
 */
export function GarmentLabel({ rows }: { rows: [string, string | undefined | null][] }) {
  const { isDark } = useTheme();
  const filled = rows.filter(([, value]) => value && value.trim());
  if (!filled.length) return null;
  const hairline = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(18,20,23,0.08)';
  return (
    <Glass radius={24}>
      <View style={styles.label} accessibilityRole="summary">
        {filled.map(([name, value], index) => (
          <View key={name} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline }]}>
            <Text style={[font('regular'), styles.name]}>{name}</Text>
            <Text style={[font('medium'), styles.value, { color: isDark ? '#F4F5F7' : INK }]} numberOfLines={2}>{value}</Text>
          </View>
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: 16, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 12 },
  name: { width: 96, color: INK_SOFT, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, fontSize: 14, lineHeight: 19 }
});
