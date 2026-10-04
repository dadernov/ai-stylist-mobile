import { StyleSheet, Text, View } from 'react-native';
import { Check, Minus, X, HelpCircle } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { Criterion, CRITERION_LABELS } from '../domain/outfits';

// Процент совпадения и пять проверок одним взглядом; в развёрнутом виде —
// объяснение по каждой проверке. Та же оценка, по которой отсортированы образы.
export function MatchSummary({ percent, criteria, detailed = false }: { percent: number; criteria: Criterion[]; detailed?: boolean }) {
  const { colors } = useTheme();
  const t = useT();
  const tone = (status: Criterion['status']) => status === 'good' ? colors.accentGold : status === 'ok' ? colors.muted : status === 'bad' ? colors.danger : colors.muted;
  const Icon = (status: Criterion['status']) => status === 'good' ? Check : status === 'ok' ? Minus : status === 'bad' ? X : HelpCircle;
  const verdict = percent >= 85 ? 'Отлично подходит' : percent >= 70 ? 'Хорошо подходит' : percent >= 55 ? 'Подходит с оговорками' : 'Слабое совпадение';
  return (
    <View style={styles.wrap} accessibilityLabel={t('Совпадение {percent}%', { percent })}>
      <View style={styles.head}>
        <Text style={[styles.percent, { color: percent >= 70 ? colors.accentGold : percent >= 55 ? colors.text : colors.danger }]}>{percent}%</Text>
        <Text style={[styles.verdict, { color: colors.muted }]}>{t(verdict)}</Text>
      </View>
      <View style={styles.chips}>
        {criteria.map(criterion => {
          const Glyph = Icon(criterion.status);
          return (
            <View key={criterion.key} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Glyph size={13} strokeWidth={2.4} color={tone(criterion.status)} />
              <Text style={[styles.chipText, { color: colors.text }]}>{t(CRITERION_LABELS[criterion.key])}</Text>
            </View>
          );
        })}
      </View>
      {detailed ? <View style={styles.notes}>
        {criteria.map(criterion => {
          const Glyph = Icon(criterion.status);
          return (
            <View key={criterion.key} style={styles.note}>
              <Glyph size={15} strokeWidth={2.2} color={tone(criterion.status)} style={{ marginTop: 3 }} />
              <Text style={[styles.noteText, { color: colors.text }]}>
                <Text style={{ fontWeight: '700' }}>{t(CRITERION_LABELS[criterion.key])}. </Text>{criterion.note}
              </Text>
            </View>
          );
        })}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  percent: { fontSize: 28, fontWeight: '700' },
  verdict: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: '600' },
  notes: { gap: 8 },
  note: { flexDirection: 'row', gap: 8 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21 },
});
