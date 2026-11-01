import { StyleSheet, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../constants/ThemeContext';
import { FadeInView } from './FadeInView';
import { Glass, Pill } from '../studio/Glass';
import { font, INK, INK_ON_DARK, inkSoft } from '../studio/studio';

type EmptyStateProps = {
  /** A quiet line icon of what will live here. */
  icon?: LucideIcon;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** An empty place as an invitation, in the studio's glass: what will be here and the one step towards it. Strings arrive through t(). */
export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction }: EmptyStateProps) {
  const { isDark } = useTheme();
  const ink = isDark ? INK_ON_DARK : INK;
  return (
    <FadeInView style={styles.wrap}>
      <Glass radius={30}>
        <View style={styles.card}>
          {Icon ? (
            <View style={[styles.icon, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}>
              <Icon size={22} strokeWidth={1.6} color={ink} />
            </View>
          ) : null}
          <Text style={[styles.title, { color: ink }]}>{title}</Text>
          {hint ? <Text style={[styles.hint, { color: inkSoft(isDark) }]}>{hint}</Text> : null}
          {actionLabel && onAction ? <Pill variant="primary" title={actionLabel} onPress={onAction} style={styles.action} /> : null}
        </View>
      </Glass>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 16 },
  card: { padding: 22, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { ...font('semibold'), fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  hint: { ...font('regular'), fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 320 },
  action: { marginTop: 18 },
});
