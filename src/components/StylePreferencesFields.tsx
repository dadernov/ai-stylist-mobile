import { StyleSheet, Switch, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Gender, genderOptions } from '../types/profile';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';

export function StylePreferencesFields({ gender, beautyAdvice, onGenderChange, onBeautyChange }: {
  gender?: Gender;
  beautyAdvice: boolean;
  onGenderChange: (gender: Gender) => void;
  onBeautyChange: (enabled: boolean) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.wrap}>
    <Text style={styles.label}>{t('Пол')}</Text>
    <View accessibilityRole="radiogroup" style={styles.options}>
      {genderOptions.map(option => <AppPressable key={option.value} accessibilityRole="radio" accessibilityLabel={t(option.label)}
        accessibilityState={{ checked: gender === option.value }} onPress={() => onGenderChange(option.value)}
        style={[styles.option, gender === option.value && styles.active]}>
        <Text style={styles.text}>{t(option.label)}</Text>
        <View style={[styles.radio, gender === option.value && { backgroundColor: colors.buttonPrimaryBg }]}>
          {gender === option.value && <Check size={13} color={colors.buttonPrimaryText} />}
        </View>
      </AppPressable>)}
    </View>
    <View style={styles.toggle}>
      <Text style={[styles.text, { flex: 1 }]}>{t('Советы по макияжу и укладке')}</Text>
      <Switch accessibilityLabel={t('Советы по макияжу и укладке')} value={beautyAdvice} onValueChange={onBeautyChange}
        trackColor={{ false: colors.border, true: colors.accentGold }} />
    </View>
  </View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { gap: 14 },
  label: { color: c.text, fontSize: 16, fontWeight: '600' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderWidth: 1, borderColor: c.border, borderRadius: 4 },
  active: { backgroundColor: c.accentGoldSoft, borderColor: c.accentGold },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 }
});
