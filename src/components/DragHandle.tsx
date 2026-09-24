import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';

type DragHandleProps = { onDismiss: () => void; style?: ViewStyle };

// A sheet handle that actually works: a short downward swipe on the bar closes
// the sheet. The decorative bar alone used to promise a gesture it did not have.
export function DragHandle({ onDismiss, style }: DragHandleProps) {
  const { colors } = useTheme();
  const t = useT();
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => { if (gesture.dy > 40 || gesture.vy > 0.45) latest.current(); }
  }), []);
  return (
    <View {...responder.panHandlers} style={[styles.hitArea, style]} accessibilityRole="button" accessibilityLabel={t('Закрыть')} accessibilityHint={t('Смахни вниз, чтобы закрыть')}>
      <View style={[styles.bar, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 4, paddingBottom: 12 },
  bar: { width: 44, height: 5, borderRadius: 3 }
});
