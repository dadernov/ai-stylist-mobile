import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
};

// Editorial-заголовок экрана: eyebrow капсом + крупный серифный display.
// Отступы сафе-арии НЕ включает — их задаёт экран.
export function ScreenHeader({ eyebrow, title, subtitle }: ScreenHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    marginBottom: 14,
    gap: 4
  },
  eyebrow: {
    ...TYPE.eyebrow,
    color: c.muted
  },
  title: {
    ...TYPE.display,
    color: c.text
  },
  subtitle: {
    ...TYPE.body,
    color: c.muted
  }
});
