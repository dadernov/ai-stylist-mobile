import { StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
      <LinearGradient
        colors={[colors.accentGoldSoft, colors.surface] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.circle}
      >
        <Text style={styles.emoji}>{emoji}</Text>
      </LinearGradient>
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
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.goldHairline
  },
  emoji: {
    fontSize: 40,
    lineHeight: 48
  },
  title: {
    fontFamily: SERIF,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
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
