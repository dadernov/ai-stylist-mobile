import { useRef } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Camera, ChevronRight, ImagePlus, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { Pill } from './studio/Glass';
import { font, hairline, INK, INK_ON_DARK, sheetFill } from './studio/studio';

export type PhotoSource = 'gallery' | 'camera';

/** Where the photo comes from: a small studio card over the blurred screen, two rows on hairlines. */
export function PhotoSourcePicker({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (source: PhotoSource) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const t = useT();
  const pending = useRef<PhotoSource | null>(null);
  const choose = (source: PhotoSource) => {
    if (pending.current) return;
    onClose();
    // iOS cannot present the camera until this sheet has dismissed. Web needs the click gesture.
    if (Platform.OS === 'ios') pending.current = source;
    else onSelect(source);
  };
  const ink = isDark ? INK_ON_DARK : INK;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={() => {
    const source = pending.current;
    pending.current = null;
    if (source) onSelect(source);
  }}>
    <SafeAreaProvider>
      <AppPressable feedback={false} accessibilityLabel={t('Закрыть выбор фото')} onPress={onClose} style={StyleSheet.absoluteFill}>
        <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      </AppPressable>
      <SafeAreaView pointerEvents="box-none" style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: sheetFill(isDark) }]}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[font('semibold'), styles.title, { color: ink }]}>{t('Добавить фото')}</Text>
            <Pill icon={X} size="icon" accessibilityLabel={t('Закрыть выбор фото')} onPress={onClose} />
          </View>
          {([{ source: 'gallery', title: 'Из галереи', icon: ImagePlus }, { source: 'camera', title: 'Снять фото', icon: Camera }] as const).map(({ source, title, icon: Icon }) => (
            <AppPressable key={source} accessibilityRole="button" accessibilityLabel={t(title)} haptics onPress={() => choose(source)}
              style={[styles.option, { borderTopColor: hairline(isDark) }]}>
              <Icon size={22} color={ink} strokeWidth={1.6} />
              <Text style={[font('medium'), styles.optionText, { color: ink }]}>{t(title)}</Text>
              <ChevronRight size={16} strokeWidth={1.8} color={c.muted} />
            </AppPressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 12 },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6, borderRadius: 30 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  optionText: { flex: 1, fontSize: 16 }
});
