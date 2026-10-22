import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';
import { Glass } from './studio/Glass';
import { StudioSheet } from './studio/StudioSheet';
import { font, hairline } from './studio/studio';

/** Settings on one glass panel: every row draws a hairline above itself, and the panel hides the first one. */
export function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <Glass radius={24}>
      <View style={{ marginTop: -StyleSheet.hairlineWidth }}>{children}</View>
    </Glass>
  );
}

type RowProps = {
  title: string;
  hint?: string;
  value?: string;
  /** A control at the row's right edge, e.g. a switch; replaces the value and chevron. */
  right?: ReactNode;
  danger?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** A row of the settings panel: title, an optional value with a chevron, or a control. */
export function SettingsRow({ title, hint, value, right, danger, onPress, accessibilityLabel }: RowProps) {
  const { colors: c, isDark } = useTheme();
  const body = (
    <View style={[styles.row, { borderTopColor: hairline(isDark) }]}>
      <View style={styles.body}>
        <Text style={[font('regular'), styles.title, { color: danger ? c.danger : c.text }]}>{title}</Text>
        {hint ? <Text style={[font('regular'), styles.hint, { color: c.muted }]}>{hint}</Text> : null}
      </View>
      {right ?? (onPress && !danger ? (
        <View style={styles.valueWrap}>
          {value ? <Text style={[font('regular'), styles.value, { color: c.muted }]} numberOfLines={1}>{value}</Text> : null}
          <ChevronRight size={16} strokeWidth={1.8} color={c.muted} />
        </View>
      ) : null)}
    </View>
  );
  if (!onPress) return body;
  return <AppPressable haptics accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} onPress={onPress}>{body}</AppPressable>;
}

/** A single choice among a few, in a sheet: radio rows on hairlines, the chosen one ticked. */
export function ChoiceSheet<T extends string>({ visible, title, options, value, onChoose, onClose }: {
  visible: boolean; title: string; options: { value: T; label: string }[]; value?: T; onChoose: (value: T) => void; onClose: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  return (
    <StudioSheet visible={visible} title={title} onClose={onClose}>
      <View accessibilityRole="radiogroup">
        {options.map(option => {
          const checked = option.value === value;
          return (
            <AppPressable key={option.value} haptics accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked }}
              onPress={() => onChoose(option.value)}>
              <View style={[styles.row, { borderTopColor: hairline(isDark) }]}>
                <Text style={[font(checked ? 'semibold' : 'regular'), styles.title, { color: c.text, flex: 1 }]}>{option.label}</Text>
                {checked ? <Check size={18} strokeWidth={2} color={c.text} /> : null}
              </View>
            </AppPressable>
          );
        })}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 15, lineHeight: 20 },
  hint: { fontSize: 12, lineHeight: 17 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  value: { fontSize: 15, lineHeight: 20, flexShrink: 1 }
});
