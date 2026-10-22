import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Gender, genderOptions } from '../types/profile';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { ChoicePill } from './studio/Glass';
import { font, INK, INK_ON_DARK } from './studio/studio';
import { ChoiceSheet, SettingsPanel, SettingsRow } from './SettingsRows';

/**
 * Gender and beauty advice. On its own (onboarding) the gender, the one required choice, shows as pills in
 * plain sight above a glass panel with the advice switch; with `bare` both are settings rows, for a panel
 * that holds more settings.
 */
export function StylePreferencesFields({ gender, beautyAdvice, onGenderChange, onBeautyChange, bare }: {
  gender?: Gender;
  beautyAdvice: boolean;
  onGenderChange: (gender: Gender) => void;
  onBeautyChange: (enabled: boolean) => void;
  bare?: boolean;
}) {
  const t = useT();
  const { colors: c, isDark } = useTheme();
  const [genderOpen, setGenderOpen] = useState(false);
  const options = genderOptions.map(option => ({ value: option.value, label: t(option.label) }));
  const beauty = (
    <SettingsRow title={t('Советы по макияжу и укладке')} right={
      // Black track when on; on dark ground the track turns light so it stays visible.
      <Switch accessibilityLabel={t('Советы по макияжу и укладке')} value={beautyAdvice} onValueChange={onBeautyChange}
        trackColor={{ false: isDark ? '#3A3D42' : '#D7D9DC', true: isDark ? INK_ON_DARK : INK }}
        thumbColor={beautyAdvice && isDark ? INK : '#FFFFFF'} {...{ activeThumbColor: beautyAdvice && isDark ? INK : '#FFFFFF' }} />
    } />
  );
  if (!bare) return (
    <View style={styles.wrap}>
      <View style={styles.gender}>
        <Text style={[font('semibold'), styles.label, { color: c.text }]}>{t('Пол')}</Text>
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {options.map(option => <ChoicePill key={option.value} label={option.label} active={option.value === gender} onPress={() => onGenderChange(option.value)} />)}
        </View>
      </View>
      <SettingsPanel>{beauty}</SettingsPanel>
    </View>
  );
  return <>
    <SettingsRow title={t('Пол')} value={options.find(option => option.value === gender)?.label ?? t('Выбрать')} onPress={() => setGenderOpen(true)} />
    {beauty}
    <ChoiceSheet visible={genderOpen} title={t('Пол')} options={options} value={gender}
      onChoose={value => { onGenderChange(value); setGenderOpen(false); }} onClose={() => setGenderOpen(false)} />
  </>;
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  gender: { gap: 10 },
  label: { fontSize: 15, lineHeight: 20 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
