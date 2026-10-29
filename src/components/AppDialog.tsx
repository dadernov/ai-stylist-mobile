import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Alert as NativeAlert, AlertButton, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Trash2, X } from 'lucide-react-native';
import { SHADOWS } from '../constants/theme';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { FormScrollView } from './ui/FormScrollView';
import { Pill } from './studio/Glass';
import { backdropDim, font, glassEdge, INK, INK_ON_DARK, inkSoft, sheetFill, useReducedMotion } from './studio/studio';

type Dialog = { title: string; message?: string; buttons: AlertButton[] };
type DialogApi = { alert: (title: string, message?: string, buttons?: AlertButton[]) => void; visible: boolean };
const Context = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Dialog[]>([]);
  const [nativeVisible, setNativeVisible] = useState(false);
  const { colors, isDark } = useTheme();
  const reduced = useReducedMotion();
  const t = useT();
  const alert = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    if (Platform.OS !== 'web') {
      setNativeVisible(true);
      NativeAlert.alert(title, message, (buttons?.length ? buttons : [{ text: t('Понятно') }]).map(button => ({ ...button,
        onPress: () => { setNativeVisible(false); button.onPress?.(); }
      })), { cancelable: true, onDismiss: () => setNativeVisible(false) });
      return;
    }
    setQueue(previous => [...previous, { title, message, buttons: buttons?.length ? buttons : [{ text: t('Понятно') }] }]);
  }, [t]);
  const value = useMemo(() => ({ alert, visible: nativeVisible || queue.length > 0 }), [alert, queue.length, nativeVisible]);
  const current = queue[0];
  const close = (button?: AlertButton) => { setQueue(previous => previous.slice(1)); button?.onPress?.(); };
  const cancel = () => close(current?.buttons.find(button => button.style === 'cancel'));
  return <Context.Provider value={value}>
    {children}
    {Platform.OS === 'web' && current && <Modal transparent visible animationType={reduced ? 'none' : 'fade'} onRequestClose={cancel}>
      {current && <View style={styles.backdrop}>
        <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: backdropDim(isDark) }]} />
        <View style={[styles.dialog, SHADOWS.floating, { backgroundColor: sheetFill(isDark), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glassEdge(isDark) }]} accessibilityViewIsModal>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[font('semibold'), styles.title, { color: isDark ? INK_ON_DARK : INK }]}>{current.title}</Text>
            <Pill icon={X} size="icon" accessibilityLabel={t('Закрыть подтверждение')} onPress={cancel} haptics={false} />
          </View>
          <FormScrollView contentContainerStyle={{ gap: 10 }}>
            {current.message ? <Text style={[font('regular'), styles.message, { color: inkSoft(isDark) }]}>{current.message}</Text> : null}
            {current.buttons.map((button, index) => <Pill key={index} title={button.text || t('Понятно')}
              variant={button.style === 'cancel' ? 'glass' : 'primary'} icon={button.style === 'destructive' ? Trash2 : undefined}
              iconColor={button.style === 'destructive' ? colors.danger : undefined}
              onPress={() => close(button)} haptics={false} />)}
          </FormScrollView>
        </View>
      </View>}
    </Modal>}
  </Context.Provider>;
}

export function useAppDialog() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing dialog provider');
  return value;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '85%', borderRadius: 30, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  message: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
});
