import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';
import { font, INK_SOFT } from '../studio/studio';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  // Something at the title's right edge, e.g. a glass icon button.
  right?: ReactNode;
};

// Заголовок экрана: одно название, без надписи над ним. Отступы безопасной зоны НЕ включает — их задаёт экран.
export function ScreenHeader({ title, subtitle, right }: ScreenHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { marginBottom: 14, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { ...font('semibold'), flexShrink: 1, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: c.text },
  right: { flexShrink: 0 },
  subtitle: { ...font('regular'), fontSize: 14, lineHeight: 20, color: INK_SOFT }
});
