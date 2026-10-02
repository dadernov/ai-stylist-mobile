import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { privacyUrl } from '../constants/ai';
import { hasAiConsent, saveAiConsent } from '../services/aiConsent';
import { PrimaryButton } from './ui/PrimaryButton';
import { AppPressable } from './AppPressable';
import { useOverlay } from './OverlayHost';

type Api = { ensure: () => Promise<boolean>; revoke: () => Promise<void> };
const Context = createContext<Api | null>(null);

export function AiConsentProvider({ login, children }: { login: string; children: ReactNode }) {
  const { colors } = useTheme();
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
  const prompt = open ? <Modal transparent visible animationType="fade" onRequestClose={() => void answer(false)}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <ShieldCheck size={28} color={colors.accentGold} />
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('Обработка фото нейросетями')}</Text>
            {points.map(point => <Text key={point} style={[styles.point, { color: colors.muted }]}>• {point}</Text>)}
            <AppPressable accessibilityRole="link" onPress={() => { void Linking.openURL(privacyUrl()).catch(() => {}); }}>
              <Text style={[styles.link, { color: colors.accentGold }]}>{t('Политика конфиденциальности')}</Text>
            </AppPressable>
            <PrimaryButton title={t('Согласен, продолжить')} variant="gold" onPress={() => void answer(true)} />
            <PrimaryButton title={t('Не сейчас')} variant="ghost" onPress={() => void answer(false)} />
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
  backdrop: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { borderRadius: 20, borderWidth: 1, padding: 20, maxHeight: '88%' },
  title: { fontSize: 20, fontWeight: '700' },
  point: { fontSize: 14, lineHeight: 21 },
  link: { fontSize: 14, fontWeight: '600', paddingVertical: 4 },
});
