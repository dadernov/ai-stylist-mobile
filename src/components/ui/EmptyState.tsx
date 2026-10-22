import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';
import { FadeInView } from './FadeInView';
import { PrimaryButton } from './PrimaryButton';
import { font } from '../studio/studio';

type EmptyStateProps = {
  emoji: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Пустое состояние — приглашение к действию: заголовок, одна строка подсказки и кнопка,
// выровненные по левому краю, как весь экран; без декоративной иконки. Строки уже через t(...).
export function EmptyState({ emoji, title, hint, actionLabel, onAction }: EmptyStateProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <FadeInView style={styles.wrap}>
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
    alignItems: 'flex-start',
    paddingVertical: 28
  },
  emoji: {
    fontSize: 40,
    lineHeight: 48
  },
  title: {
    ...font('semibold'),
    fontSize: 22,
    lineHeight: 28,
    color: c.text
  },
  hint: {
    ...font('regular'),
    fontSize: 14,
    lineHeight: 20,
    color: c.muted,
    marginTop: 6,
    maxWidth: 320
  },
  action: {
    marginTop: 20,
    minWidth: 200
  }
});
