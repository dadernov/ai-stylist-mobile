import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { deviceLanguage, Lang, LANGUAGES, useLanguage } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { SettingsPanel } from './SettingsRows';
import { Pill } from './studio/Glass';
import { StudioBackdrop } from './studio/StudioBackdrop';
import { font } from './studio/studio';

// Titles are shown in all three languages at once: the person hasn't chosen yet.
const TITLE: Record<Lang, string> = { ru: 'Выберите язык', en: 'Choose your language', zh: '选择语言' };
const CONTINUE: Record<Lang, string> = { ru: 'Продолжить', en: 'Continue', zh: '继续' };
const HINT: Record<Lang, string> = {
  ru: 'Язык можно поменять в любой момент в профиле.',
  en: 'You can change it anytime in your profile.',
  zh: '可随时在个人页中更改。',
};

export function LanguageChooser() {
  const { colors, isDark } = useTheme();
  const { setLang } = useLanguage();
  const [selected, setSelected] = useState<Lang>(deviceLanguage());
  const hairline = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <StudioBackdrop>
      <SafeAreaView style={styles.screen}>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={[font('semibold'), styles.title, { color: colors.text }]}>
            {TITLE[selected]}
          </Text>
          <Text style={[font('regular'), styles.subtitle, { color: colors.muted }]}>
            {LANGUAGES.filter(item => item.code !== selected).map(item => TITLE[item.code]).join(', ')}
          </Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            <SettingsPanel>
              {LANGUAGES.map(item => {
                const active = item.code === selected;
                return (
                  <AppPressable key={item.code} haptics accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => setSelected(item.code)}>
                    <View style={[styles.option, { borderTopColor: hairline }]}>
                      <Text style={[font(active ? 'semibold' : 'regular'), styles.optionText, { color: colors.text }]}>{item.label}</Text>
                      {active ? <Check size={20} strokeWidth={2} color={colors.text} /> : null}
                    </View>
                  </AppPressable>
                );
              })}
            </SettingsPanel>
          </View>
          <Pill variant="primary" title={CONTINUE[selected]} onPress={() => setLang(selected)} />
          <Text style={[font('regular'), styles.hint, { color: colors.muted }]}>{HINT[selected]}</Text>
        </View>
      </SafeAreaView>
    </StudioBackdrop>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 34, lineHeight: 40, letterSpacing: -1 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  options: { marginVertical: 10 },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  optionText: { fontSize: 17, lineHeight: 22 },
  hint: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
