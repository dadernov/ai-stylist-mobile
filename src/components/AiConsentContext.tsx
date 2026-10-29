import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { ShieldCheck } from 'lucide-react-native';
import { SHADOWS } from '../constants/theme';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { privacyUrl } from '../constants/ai';
import { hasAiConsent, saveAiConsent } from '../services/aiConsent';
import { Pill } from './studio/Glass';
import { backdropDim, font, glassEdge, INK, INK_ON_DARK, inkSoft, sheetFill, useReducedMotion } from './studio/studio';
import { AppPressable } from './AppPressable';
import { useOverlay } from './OverlayHost';

type Api = { ensure: () => Promise<boolean>; revoke: () => Promise<void> };
const Context = createContext<Api | null>(null);

export function AiConsentProvider({ login, children }: { login: string; children: ReactNode }) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  const t = useT();
  const [open, setOpen] = useState(false);
  const pending = useRef<((granted: boolean) => void)[]>([]);
  const ensure = useCallback(async () => {
    if (await hasAiConsent(login)) return true;
    return new Promise<boolean>(resolve => { pending.current.push(resolve); setOpen(true); });
  }, [login]);
  const answer = async (granted: boolean) => {
    if (granted) await saveAiConsent(login, true).catch(() => {});
    setOpen(false);
    const waiting = pending.current; pending.current = [];
    waiting.forEach(resolve => resolve(granted));
  };
  const revoke = useCallback(() => saveAiConsent(login, false), [login]);
  const value = useMemo(() => ({ ensure, revoke }), [ensure, revoke]);
  const points = [
    t('Фото вещей отправляются на сервер приложения: нейросеть определяет тип, цвет и вырезает фон. Снимок не сохраняется после ответа.'),
    t('Для примерки твоё фото в полный рост и фото выбранных вещей передаются сервису fal.ai (США), где изображение создаёт нейросеть Seedream компании ByteDance. fal.ai не сохраняет фото, результат хранится на нашем сервере не дольше 24 часов.'),
    t('Загружай только свои фото или фото людей, которые на это согласились.'),
    t('Данные не используются для рекламы и не продаются. Согласие можно отозвать в профиле.'),
  ];
  // Consent is asked from inside sheets (try-on, item editor): the window is
  // drawn in the topmost one, or iOS would never show it (OverlayHost).
  const prompt = open ? <Modal transparent visible animationType={reduced ? 'none' : 'fade'} onRequestClose={() => void answer(false)}>
      <View style={styles.backdrop}>
        <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: backdropDim(isDark) }]} />
        <View style={[styles.card, SHADOWS.floating, { backgroundColor: sheetFill(isDark), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glassEdge(isDark) }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <ShieldCheck size={28} color={ink} strokeWidth={1.6} />
            <Text accessibilityRole="header" style={[font('semibold'), styles.title, { color: ink }]}>{t('Обработка фото нейросетями')}</Text>
            {points.map(point => <Text key={point} style={[font('regular'), styles.point, { color: inkSoft(isDark) }]}>• {point}</Text>)}
            <AppPressable accessibilityRole="link" onPress={() => { void Linking.openURL(privacyUrl()).catch(() => {}); }}>
              <Text style={[font('semibold'), styles.link, { color: ink }]}>{t('Политика конфиденциальности')}</Text>
            </AppPressable>
            <View style={styles.actions}>
              <Pill title={t('Согласен, продолжить')} variant="primary" onPress={() => void answer(true)} haptics={false} />
              <Pill title={t('Не сейчас')} onPress={() => void answer(false)} haptics={false} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal> : null;
  const inline = useOverlay('ai-consent', prompt);
  return <Context.Provider value={value}>
    {children}
    {inline ? prompt : null}
  </Context.Provider>;
}

export function useAiConsent() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing AI consent provider');
  return value;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 30, maxHeight: '88%', overflow: 'hidden' },
  body: { gap: 14, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  point: { fontSize: 14, lineHeight: 21 },
  link: { fontSize: 14, paddingVertical: 4, textDecorationLine: 'underline' },
  actions: { gap: 10, marginTop: 6 },
});
