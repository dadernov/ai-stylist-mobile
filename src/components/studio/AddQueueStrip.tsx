import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, Check, CircleHelp, RefreshCw, X } from 'lucide-react-native';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { AddEntry, queueSummary, canRetry } from '../../domain/addQueue';
import { AppPressable } from '../AppPressable';
import { Glass, Pill } from './Glass';
import { font, INK, INK_ON_DARK, inkSoft } from './studio';

const TILE = 56;

/** The batch as a strip of little photos, each with its state. Tap: a failed photo tries again, a finished one opens its item. */
export function AddQueueStrip({ queue, onCancel, onRetry, onOpen, onClose, onConsent }: {
  queue: AddEntry[]; onCancel: () => void; onRetry: (id: string) => void; onOpen: (itemId: string) => void; onClose: () => void; onConsent: () => void;
}) {
  const t = useT();
  const { isDark, colors } = useTheme();
  const ink = isDark ? INK_ON_DARK : INK;
  const visible = queue.filter(entry => entry.stage !== 'cancelled');
  if (!visible.length) return null;
  const summary = queueSummary(queue);
  const consent = visible.some(entry => entry.error === 'consent');
  const head = summary.active ? t('Добавляем вещи: {n} из {count}', { n: summary.landed, count: summary.total })
    : summary.retryable ? t('Добавлено {n} из {count}, остальное можно повторить', { n: summary.landed, count: summary.total })
    : summary.failed ? t('Добавлено {n} из {count}', { n: summary.landed, count: summary.total })
    : t('Готово, новых вещей в гардеробе: {n}', { n: summary.landed });
  const note = consent ? t('Нужно согласие на обработку фото.')
    : visible.some(entry => entry.error === 'tooLarge') ? t('Фото слишком большое, выбери другое.')
    : summary.review ? t('Проверь отмеченные вещи: в них мы не уверены.')
    : summary.active ? t('Пока приложение свёрнуто, очередь ждёт.') : '';
  const stateLabel = (entry: AddEntry) => entry.stage === 'waiting' ? t('В очереди') : entry.stage === 'analyzing' ? t('Распознаём') : entry.stage === 'flat' ? t('Выравниваем фото…')
    : entry.error === 'tooLarge' ? t('Фото слишком большое, выбери другое.')
    : entry.stage === 'failed' ? t('Не вышло, нажми, чтобы повторить') : entry.review ? t('Проверь вещь') : t('Готово');
  return <Glass radius={22} style={styles.wrap}>
    <View style={styles.inner}>
      <View style={styles.head}>
        <Text style={[font('semibold'), styles.title, { color: ink }]} numberOfLines={2}>{head}</Text>
        {summary.active ? <Pill size="sm" title={t('Отменить')} onPress={onCancel} />
          : <Pill size="sm" icon={X} accessibilityLabel={t('Закрыть')} onPress={onClose} />}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {visible.map((entry, index) => {
          const press = canRetry(entry) ? () => (entry.error === 'consent' ? onConsent() : onRetry(entry.id)) : entry.itemId ? () => onOpen(entry.itemId as string) : undefined;
          return <AppPressable key={entry.id} disabled={!press} onPress={press} accessibilityRole={press ? 'button' : undefined}
            accessibilityLabel={`${t('Фото {n} из {count}', { n: index + 1, count: visible.length })}: ${stateLabel(entry)}`} style={styles.tile}>
            <Image source={{ uri: entry.uri }} style={[styles.photo, entry.stage === 'waiting' && { opacity: 0.45 }]} />
            <View style={[styles.badge, { backgroundColor: entry.stage === 'failed' ? colors.danger : 'rgba(18,20,23,0.72)' }]}>
              {entry.stage === 'analyzing' || entry.stage === 'flat' ? <ActivityIndicator size="small" color="#FFFFFF" style={{ transform: [{ scale: 0.6 }] }} />
                : entry.stage === 'failed' ? (entry.error === 'consent' || entry.error === 'tooLarge' ? <AlertCircle size={12} color="#FFFFFF" /> : <RefreshCw size={12} color="#FFFFFF" />)
                : entry.stage === 'done' ? (entry.review ? <CircleHelp size={12} color="#FFFFFF" /> : <Check size={12} color="#FFFFFF" />) : null}
            </View>
          </AppPressable>;
        })}
      </ScrollView>
      {note ? <Text style={[font('regular'), styles.note, { color: inkSoft(isDark) }]}>{note}</Text> : null}
    </View>
  </Glass>;
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginBottom: 8 },
  inner: { padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 14, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 8 },
  tile: { width: TILE, height: TILE, borderRadius: 14, overflow: 'hidden' },
  photo: { width: TILE, height: TILE },
  badge: { position: 'absolute', right: 3, bottom: 3, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, lineHeight: 17 }
});
