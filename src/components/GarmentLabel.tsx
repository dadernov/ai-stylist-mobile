import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { Glass } from './studio/Glass';
import { font, hairline, INK, INK_ON_DARK, inkSoft } from './studio/studio';

/**
 * A garment's facts set like the label sewn into it: a glass panel of name/value rows parted by hairlines.
 * Rows without a value are left out.
 */
export function GarmentLabel({ rows }: { rows: [string, string | undefined | null][] }) {
  const { isDark } = useTheme();
  const filled = rows.filter(([, value]) => value && value.trim());
  if (!filled.length) return null;
  return (
    <Glass radius={24}>
      <View style={styles.label} accessibilityRole="summary">
        {filled.map(([name, value], index) => (
          <View key={name} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline(isDark) }]}>
            <Text style={[font('regular'), styles.name, { color: inkSoft(isDark) }]}>{name}</Text>
            <Text style={[font('medium'), styles.value, { color: isDark ? INK_ON_DARK : INK }]} numberOfLines={2}>{value}</Text>
          </View>
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: 16, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 12 },
  name: { width: 96, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, fontSize: 14, lineHeight: 19 }
});
