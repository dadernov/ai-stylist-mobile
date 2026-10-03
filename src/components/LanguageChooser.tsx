import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Globe } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { deviceLanguage, Lang, LANGUAGES, useLanguage } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { PrimaryButton } from './ui/PrimaryButton';

// Titles are shown in all three languages at once: the person hasn't chosen yet.
const TITLE: Record<Lang, string> = { ru: 'Выберите язык', en: 'Choose your language', zh: '选择语言' };
const CONTINUE: Record<Lang, string> = { ru: 'Продолжить', en: 'Continue', zh: '继续' };
const HINT: Record<Lang, string> = {
  ru: 'Язык можно поменять в любой момент в профиле.',
  en: 'You can change it anytime in your profile.',
  zh: '可随时在个人页中更改。',
};

export function LanguageChooser() {
  const { colors } = useTheme();
  const { setLang } = useLanguage();
  const [selected, setSelected] = useState<Lang>(deviceLanguage());
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        <Globe size={34} color={colors.accentGold} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {TITLE[selected]}
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {LANGUAGES.filter(item => item.code !== selected).map(item => TITLE[item.code]).join(' · ')}
        </Text>
        <View style={styles.options} accessibilityRole="radiogroup">
          {LANGUAGES.map(item => {
            const active = item.code === selected;
            return (
              <AppPressable key={item.code} haptics accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[styles.option, { borderColor: active ? colors.accentGold : colors.border, backgroundColor: active ? colors.accentGoldSoft : colors.card }]}
                onPress={() => setSelected(item.code)}>
                <Text style={[styles.optionText, { color: active ? colors.accentGold : colors.text }]}>{item.label}</Text>
                {active ? <Check size={20} color={colors.accentGold} /> : null}
              </AppPressable>
            );
          })}
        </View>
        <PrimaryButton title={CONTINUE[selected]} variant="gold" size="lg" onPress={() => setLang(selected)} />
        <Text style={[styles.hint, { color: colors.muted }]}>{HINT[selected]}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 14 },
  options: { gap: 10, marginVertical: 12 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 0, paddingHorizontal: 18, paddingVertical: 16 },
  optionText: { fontSize: 17, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center' },
});
