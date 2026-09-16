import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { Gender, StylePreferences } from '../types/profile';
import { StylePreferencesFields } from '../components/StylePreferencesFields';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { useT } from '../constants/i18n';

export function PreferencesScreen({ onComplete }: { onComplete: (preferences: StylePreferences) => void }) {
  const t = useT();
  const [gender, setGender] = useState<Gender>();
  const [beautyAdvice, setBeautyAdvice] = useState(false);
  return <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.content}>
      <ScreenHeader eyebrow={t('Знакомство')} title={t('Твои предпочтения')} />
      <StylePreferencesFields gender={gender} beautyAdvice={beautyAdvice} onGenderChange={setGender} onBeautyChange={setBeautyAdvice} />
      <PrimaryButton title={t('Продолжить')} icon={ArrowRight} disabled={!gender} onPress={() => gender && onComplete({ gender, beautyAdvice })} />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24 }
});
