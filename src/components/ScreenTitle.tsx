import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';

export function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    marginBottom: 14,
    gap: 4
  },
  title: {
    color: c.text,
    fontSize: 28,
    fontWeight: '700'
  },
  subtitle: {
    color: c.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
