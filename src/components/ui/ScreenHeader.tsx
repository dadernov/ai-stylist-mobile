import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
};

// Заголовок экрана: одно название шрифтом этикетки, без надписи над ним — экран и так понятен
// по вкладке. Отступы безопасной зоны НЕ включает — их задаёт экран.
export function ScreenHeader({ title, subtitle }: ScreenHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
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
  title: {
    ...TYPE.display,
    color: c.text
  },
  subtitle: {
    ...TYPE.body,
    color: c.muted
  }
});
