import { StyleSheet, Text, View } from 'react-native';
import { FolderOpen } from 'lucide-react-native';
import { SERIF, ThemeColors, TYPE } from '../../constants/theme';
import { useTheme, useThemedStyles } from '../../constants/ThemeContext';
import { FadeInView } from './FadeInView';
import { PrimaryButton } from './PrimaryButton';

type EmptyStateProps = {
  emoji: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Пустое состояние: эмодзи в мягком градиентном круге, серифный заголовок,
// подсказка и опциональная CTA-кнопка. Все строки приходят уже через t(...).
export function EmptyState({ emoji, title, hint, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <FadeInView style={styles.wrap}>
      <View style={styles.circle}>
        <FolderOpen size={32} strokeWidth={1.2} color={colors.accentGold} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <PrimaryButton title={actionLabel} onPress={onAction} variant="gold" style={styles.action} />
      ) : null}
    </FadeInView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24
  },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface
  },
  emoji: {
    fontSize: 40,
    lineHeight: 48
  },
  title: {
    fontFamily: SERIF,
    fontSize: 19,
    letterSpacing: -0.1,
    color: c.text,
    textAlign: 'center',
    marginTop: 18
  },
  hint: {
    ...TYPE.body,
    color: c.muted,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300
  },
  action: {
    marginTop: 20,
    minWidth: 200
  }
});
