import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { formatMorningTime } from '../domain/morningLook';
import { useAppDialog } from './AppDialog';
import { SettingsRow } from './SettingsRows';
import { ChoicePill, Pill } from './studio/Glass';
import { StudioSheet } from './studio/StudioSheet';
import { font, INK, INK_ON_DARK } from './studio/studio';
import { MorningControl } from './useMorningLook';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 15, 30, 45];

/** Settings rows: the switch, and once it is on, the time. The phone's question comes only when the switch is turned on. */
export function MorningLookSettings({ morning }: { morning: MorningControl }) {
  const t = useT();
  const Alert = useAppDialog();
  const { colors: c, isDark } = useTheme();
  const { settings, permissionLost } = morning;
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState({ hour: settings.hour, minute: settings.minute });
  const [asking, setAsking] = useState(false);
  const toggle = async (next: boolean) => {
    if (!next) { morning.turnOff(); return; }
    setAsking(true);
    const answer = await morning.turnOn();
    setAsking(false);
    if (answer === 'denied') Alert.alert(t('Уведомления выключены'), t('Разреши уведомления в настройках телефона, и образ дня будет приходить утром.'), [
      { text: t('Отмена'), style: 'cancel' }, { text: t('Открыть настройки'), onPress: () => { void Linking.openSettings().catch(() => {}); } }]);
    else if (answer === 'unavailable') Alert.alert(t('Уведомления недоступны'), t('На этом устройстве не получается включить уведомления.'));
  };
  const on = settings.enabled;
  return <>
    <SettingsRow title={t('Образ дня утром')}
      hint={permissionLost && on ? t('Уведомления выключены в настройках телефона, поэтому пока ничего не придёт.') : t('Напоминание с идеей, что надеть. Погоду оно не знает: её покажем в приложении.')}
      right={<Switch accessibilityLabel={t('Образ дня утром')} value={on} disabled={asking} onValueChange={next => { void toggle(next); }}
        trackColor={{ false: isDark ? '#3A3D42' : '#D7D9DC', true: isDark ? INK_ON_DARK : INK }}
        thumbColor={on && isDark ? INK : '#FFFFFF'} {...{ activeThumbColor: on && isDark ? INK : '#FFFFFF' }} />} />
    {on ? <SettingsRow title={t('Время')} value={formatMorningTime(settings)} onPress={() => { setDraft({ hour: settings.hour, minute: settings.minute }); setPicking(true); }} /> : null}
    <StudioSheet visible={picking} title={t('Время')} onClose={() => setPicking(false)}>
      <Text style={[font('regular'), styles.label, { color: c.muted }]}>{t('Часы')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} contentOffset={{ x: Math.max(0, settings.hour - 2) * 58, y: 0 }}>
        {HOURS.map(hour => <ChoicePill key={hour} label={String(hour)} active={draft.hour === hour} onPress={() => setDraft(previous => ({ ...previous, hour }))} />)}
      </ScrollView>
      <Text style={[font('regular'), styles.label, { color: c.muted }]}>{t('Минуты')}</Text>
      <View style={styles.row}>
        {[...new Set([...MINUTES, draft.minute])].sort((a, b) => a - b).map(minute => <ChoicePill key={minute} label={String(minute).padStart(2, '0')} active={draft.minute === minute} onPress={() => setDraft(previous => ({ ...previous, minute }))} />)}
      </View>
      <Pill variant="primary" title={`${t('Готово')}: ${formatMorningTime(draft)}`} style={{ marginTop: 16 }} onPress={() => { morning.setTime(draft.hour, draft.minute); setPicking(false); }} />
    </StudioSheet>
  </>;
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginTop: 10, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 }
});
