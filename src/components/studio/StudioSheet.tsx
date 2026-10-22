import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { Pill } from './Glass';
import { font, INK } from './studio';

/** A sheet that slides up over the studio, which stays visible, blurred, above it; tapping there closes it. */
export function StudioSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <AppPressable feedback={false} accessibilityLabel={t('Закрыть')} onPress={onClose} style={StyleSheet.absoluteFill}>
          <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        </AppPressable>
        <View style={[styles.sheet, { backgroundColor: isDark ? 'rgba(24,26,30,0.97)' : 'rgba(250,250,249,0.97)' }]}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#3A3D42' : '#D5D7DA' }]} />
          <View style={styles.header}>
            <Text style={[font('semibold'), styles.title, { color: isDark ? '#F4F5F7' : INK }]} numberOfLines={2}>{title}</Text>
            <Pill icon={X} size="icon" onPress={onClose} accessibilityLabel={t('Закрыть')} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '88%', borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, marginTop: 14 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  body: { gap: 14, paddingHorizontal: 20, paddingTop: 16 }
});
