import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';

/**
 * A garment's facts set like the label sewn into it: a thin-bordered panel of
 * name/value rows. Rows without a value are left out.
 */
export function GarmentLabel({ rows }: { rows: [string, string | undefined | null][] }) {
  const styles = useThemedStyles(makeStyles);
  const filled = rows.filter(([, value]) => value && value.trim());
  if (!filled.length) return null;
  return (
    <View style={styles.label} accessibilityRole="summary">
      {filled.map(([name, value], index) => (
        <View key={name} style={[styles.row, index > 0 && styles.divided]}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.value} numberOfLines={2}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  label: { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.text, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  name: { width: 96, color: c.muted, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, color: c.text, fontSize: 14, lineHeight: 19 }
});
