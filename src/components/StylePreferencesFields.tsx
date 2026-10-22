import { useState } from 'react';
import { Switch } from 'react-native';
import { Gender, genderOptions } from '../types/profile';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { INK, INK_ON_DARK } from './studio/studio';
import { ChoiceSheet, SettingsPanel, SettingsRow } from './SettingsRows';

/**
 * Gender and beauty advice as settings rows. On its own it sits on a glass panel;
 * with `bare` it gives just the rows, for a panel that holds more settings.
 */
export function StylePreferencesFields({ gender, beautyAdvice, onGenderChange, onBeautyChange, bare }: {
  gender?: Gender;
  beautyAdvice: boolean;
  onGenderChange: (gender: Gender) => void;
  onBeautyChange: (enabled: boolean) => void;
  bare?: boolean;
}) {
  const t = useT();
  const { isDark } = useTheme();
  const [genderOpen, setGenderOpen] = useState(false);
  const options = genderOptions.map(option => ({ value: option.value, label: t(option.label) }));
  const rows = <>
    <SettingsRow title={t('Пол')} value={options.find(option => option.value === gender)?.label ?? t('Выбрать')} onPress={() => setGenderOpen(true)} />
    <SettingsRow title={t('Советы по макияжу и укладке')} right={
      // Black track when on; on dark ground the track turns light so it stays visible.
      <Switch accessibilityLabel={t('Советы по макияжу и укладке')} value={beautyAdvice} onValueChange={onBeautyChange}
        trackColor={{ false: isDark ? '#3A3D42' : '#D7D9DC', true: isDark ? INK_ON_DARK : INK }}
        thumbColor={beautyAdvice && isDark ? INK : '#FFFFFF'} {...{ activeThumbColor: beautyAdvice && isDark ? INK : '#FFFFFF' }} />
    } />
    <ChoiceSheet visible={genderOpen} title={t('Пол')} options={options} value={gender}
      onChoose={value => { onGenderChange(value); setGenderOpen(false); }} onClose={() => setGenderOpen(false)} />
  </>;
  return bare ? rows : <SettingsPanel>{rows}</SettingsPanel>;
}
