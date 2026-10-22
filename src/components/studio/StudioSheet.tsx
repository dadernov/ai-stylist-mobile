import { ReactNode } from 'react';
import { DimensionValue, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../constants/i18n';
import { useTheme } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { OverlayOutlet } from '../OverlayHost';
import { FormScrollView } from '../ui/FormScrollView';
import { Pill } from './Glass';
import { font, INK, INK_ON_DARK, inkSoft } from './studio';

type StudioSheetProps = {
  visible: boolean;
  /** Without a title the sheet has no header row: its content brings its own close button. */
  title?: string;
  /** A line under the title, e.g. what the sheet is about. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** A fixed height (e.g. '92%'); by default the sheet is as tall as its content, up to 88 %. */
  height?: DimensionValue;
  /** false: the children lay themselves out in the sheet (their own list or a pinned footer) instead of one scroll. */
  scroll?: boolean;
  /** false keeps the sheet open on a tap over the studio, e.g. while a form holds unsaved changes; ✕ and back still close it. */
  dismissOnBackdrop?: boolean;
  closeLabel?: string;
};

/**
 * The one bottom sheet of the app: it slides up over the studio, which stays visible, blurred, above it; tapping
 * there closes it. It holds an OverlayOutlet, so the AI consent, the generation window and any window opened from
 * inside it appear over it (iOS shows a modal only from the screen on top).
 */
export function StudioSheet({ visible, title, subtitle, onClose, children, height, scroll = true, dismissOnBackdrop = true, closeLabel }: StudioSheetProps) {
  const t = useT();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 16) + 16;
  // A content-sized sheet rises with the keyboard; a fixed-height one lets its scroll make room instead.
  const lift = Platform.OS === 'ios' && !height;
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={lift ? 'padding' : undefined} style={styles.fill}>
        <AppPressable feedback={false} accessible={dismissOnBackdrop} accessibilityLabel={dismissOnBackdrop ? t('Закрыть') : undefined}
          onPress={dismissOnBackdrop ? onClose : undefined} style={StyleSheet.absoluteFill}>
          <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        </AppPressable>
        <View style={[styles.sheet, height ? { height } : styles.fit, { backgroundColor: isDark ? 'rgba(24,26,30,0.97)' : 'rgba(250,250,249,0.97)' }]}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#3A3D42' : '#D5D7DA' }]} />
          {title ? (
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={[font('semibold'), styles.title, { color: isDark ? INK_ON_DARK : INK }]} numberOfLines={2}>{title}</Text>
                {subtitle ? <Text style={[font('regular'), styles.subtitle, { color: inkSoft(isDark) }]} numberOfLines={1}>{subtitle}</Text> : null}
              </View>
              <Pill icon={X} size="icon" onPress={onClose} accessibilityLabel={closeLabel || t('Закрыть')} />
            </View>
          ) : null}
          {scroll ? (
            <FormScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && !lift}
              contentContainerStyle={[styles.body, { paddingTop: title ? 16 : 12, paddingBottom: bottom }]}>
              {children}
            </FormScrollView>
          ) : (
            <View style={[styles.body, styles.frame, { paddingTop: title ? 16 : 12, paddingBottom: bottom }]}>{children}</View>
          )}
        </View>
      </KeyboardAvoidingView>
      <OverlayOutlet />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' },
  fit: { maxHeight: '88%' },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, marginTop: 14 },
  heading: { flex: 1, gap: 4 },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  body: { gap: 14, paddingHorizontal: 20 },
  frame: { flexShrink: 1, flexGrow: 1 }
});
