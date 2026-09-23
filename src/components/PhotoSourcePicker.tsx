import { useRef } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Camera, ImagePlus, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { IconButton } from './ui/IconButton';

export type PhotoSource = 'gallery' | 'camera';

export function PhotoSourcePicker({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (source: PhotoSource) => void;
}) {
  const { colors: c } = useTheme();
  const t = useT();
  const pending = useRef<PhotoSource | null>(null);
  const choose = (source: PhotoSource) => {
    if (pending.current) return;
    onClose();
    // iOS cannot present the camera until this sheet has dismissed. Web needs the click gesture.
    if (Platform.OS === 'ios') pending.current = source;
    else onSelect(source);
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={() => {
    const source = pending.current;
    pending.current = null;
    if (source) onSelect(source);
  }}>
    <SafeAreaProvider>
      <SafeAreaView style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '600' }}>{t('Добавить фото')}</Text>
            <IconButton icon={X} label={t('Закрыть выбор фото')} onPress={onClose} variant="quiet" />
          </View>
          {([{ source: 'gallery', title: 'Из галереи', icon: ImagePlus }, { source: 'camera', title: 'Снять фото', icon: Camera }] as const).map(({ source, title, icon: Icon }) => (
            <AppPressable key={source} accessibilityRole="button" accessibilityLabel={t(title)} haptics onPress={() => choose(source)}
              style={[styles.option, { borderColor: c.border }]}>
              <Icon size={24} color={c.accentGold} strokeWidth={1.6} />
              <Text style={{ color: c.text, fontSize: 16, flexShrink: 1 }}>{t(title)}</Text>
            </AppPressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  sheet: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, borderRadius: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 16 }
});
