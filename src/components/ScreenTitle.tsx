import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';

export function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
    gap: 4
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700'
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
