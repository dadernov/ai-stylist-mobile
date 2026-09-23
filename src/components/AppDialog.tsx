import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Alert as NativeAlert, AlertButton, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Trash2, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { PrimaryButton } from './ui/PrimaryButton';
import { IconButton } from './ui/IconButton';
import { FormScrollView } from './ui/FormScrollView';

type Dialog = { title: string; message?: string; buttons: AlertButton[] };
type DialogApi = { alert: (title: string, message?: string, buttons?: AlertButton[]) => void; visible: boolean };
const Context = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Dialog[]>([]);
  const [nativeVisible, setNativeVisible] = useState(false);
  const { colors } = useTheme();
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
    {Platform.OS === 'web' && current && <Modal transparent visible animationType="fade" onRequestClose={cancel}>
      {current && <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: colors.card }]} accessibilityViewIsModal>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={{ flex: 1, color: colors.text, fontSize: 20, fontWeight: '600' }}>{current.title}</Text>
            <IconButton icon={X} label={t('Закрыть подтверждение')} onPress={cancel} variant="quiet" />
          </View>
          <FormScrollView contentContainerStyle={{ gap: 20 }}>
            {current.message ? <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>{current.message}</Text> : null}
            {current.buttons.map((button, index) => <PrimaryButton key={index} title={button.text || t('Понятно')}
              variant={button.style === 'cancel' ? 'ghost' : 'primary'} icon={button.style === 'destructive' ? Trash2 : undefined}
              onPress={() => close(button)} />)}
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
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 400, maxHeight: '85%', borderRadius: 8, padding: 20, gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
