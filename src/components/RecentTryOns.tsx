import { useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Check, RefreshCw, Save, X } from 'lucide-react-native';
import { SavedLook } from '../types/looks';
import { TryOnJob } from '../services/tryOnJobs';
import { useTryOnJobs } from './TryOnJobsContext';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { IconButton } from './ui/IconButton';
import { PrimaryButton } from './ui/PrimaryButton';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export function RecentTryOns({ onSave, onOpenHistory }: { onSave: (look: SavedLook) => void; onOpenHistory: () => void }) {
  const { jobs, store, error } = useTryOnJobs();
  const { colors: c } = useTheme();
  const t = useT();
  const [selected, setSelected] = useState<TryOnJob>();
  const [saved, setSaved] = useState<string[]>([]);
  if (!jobs.length && !error) return null;
  return <View style={{ gap: 12, paddingVertical: 16, borderTopWidth: 1, borderColor: c.border }}>
    <View style={styles.row}><Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{t('Недавние примерки')}</Text>
      <IconButton icon={ArrowRight} label={t('Вся история')} onPress={onOpenHistory} /></View>
    {error ? <Text style={{ color: c.danger }}>{t(error)}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {jobs.slice(0, 12).map(job => <View key={job.id} style={{ width: 128, gap: 6 }}>
        <AppPressable accessibilityRole="button" accessibilityLabel={t('Открыть примерку: {name}', { name: job.name })}
          disabled={!job.result} onPress={() => setSelected(job)} style={[styles.thumb, { backgroundColor: c.surface }]}>
          {job.result ? <Image source={{ uri: job.result.imageUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
            : job.status === 'pending' ? <ActivityIndicator color={c.accentGold} /> : <RefreshCw color={c.muted} size={24} />}
        </AppPressable>
        <Text numberOfLines={2} style={{ color: c.text, fontSize: 12, lineHeight: 17 }}>{job.name}</Text>
        <Text style={{ color: job.error ? c.danger : c.muted, fontSize: 11 }}>{t(job.status === 'pending' ? 'Генерируем образ…' : job.status === 'succeeded' ? 'Готово' : 'Примерка не завершена')}</Text>
        {job.status === 'retry' && <IconButton icon={RefreshCw} label={t('Проверить результат')} onPress={() => void store.poll(job)} />}
        {job.error && <Text style={{ color: c.danger, fontSize: 11, lineHeight: 16 }}>{t(job.error)}</Text>}
      </View>)}
    </ScrollView>
    <Modal visible={Boolean(selected)} presentationStyle="fullScreen" animationType="slide" onRequestClose={() => setSelected(undefined)}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: c.background }}>
      {selected?.result && <SafeAreaView style={{ flex: 1, backgroundColor: c.background, paddingHorizontal: 20, gap: 16 }}>
        <View style={styles.row}><Text numberOfLines={2} style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{selected.name}</Text>
          <IconButton icon={X} label={t('Закрыть примерку')} onPress={() => setSelected(undefined)} /></View>
        <Image source={{ uri: selected.result.imageUri }} style={{ flex: 1, minHeight: 0 }} resizeMode="contain" />
        <PrimaryButton title={t(saved.includes(selected.id) ? 'Сохранено' : 'Сохранить образ')} icon={saved.includes(selected.id) ? Check : Save}
          disabled={saved.includes(selected.id)} onPress={() => {
            const result = selected.result!;
            onSave({ id: `job-${selected.id}`, name: selected.name, itemIds: selected.itemIds, createdAt: selected.createdAt,
              tryOnImageUri: result.imageUri, tryOnUpdatedAt: result.updatedAt, tryOnWarning: result.warning, tuckMode: result.tuckMode,
              tryOnQualityMode: 'quality', tryOnHistory: [result] });
            setSaved(previous => [...previous, selected.id]);
          }} style={{ marginBottom: 16 }} />
      </SafeAreaView>}
      </SafeAreaProvider>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({ thumb: { width: 128, height: 168, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 } });
