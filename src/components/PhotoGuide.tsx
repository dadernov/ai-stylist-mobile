import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { font } from './studio/studio';

// Simple figures, no photos of people: what the try-on can read (fitted clothes, arms a little away
// from the body, the whole figure in the frame) and what it has to guess at (a bulky coat, a bag).
function Fitted({ ink }: { ink: string }) {
  return (
    <Svg width={44} height={72} viewBox="0 0 44 72">
      <Circle cx={22} cy={8} r={5.5} fill={ink} />
      <Path d="M15 16h14l-1 22h-12z" fill={ink} />
      <Path d="M15 17l-6 19M29 17l6 19" stroke={ink} strokeWidth={3} strokeLinecap="round" />
      <Path d="M17 38l-1 30M27 38l1 30" stroke={ink} strokeWidth={4.5} strokeLinecap="round" />
    </Svg>
  );
}

function Bulky({ ink }: { ink: string }) {
  return (
    <Svg width={44} height={72} viewBox="0 0 44 72">
      <Circle cx={22} cy={8} r={5.5} fill={ink} />
      <Path d="M10 17q12 -4 24 0l3 38h-30z" fill={ink} />
      <Rect x={33} y={34} width={9} height={11} rx={2} fill={ink} opacity={0.55} />
      <Path d="M18 55v13M26 55v13" stroke={ink} strokeWidth={4.5} strokeLinecap="round" />
    </Svg>
  );
}

export function PhotoGuide() {
  const t = useT();
  const { colors: c } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={t('Хорошее фото: облегающая одежда, полный рост, руки чуть в стороны. Неудачное: объёмная куртка или пальто, сумка в руках.')}>
      <View style={styles.cell}>
        <Fitted ink={c.text} />
        <View style={styles.caption}>
          <Check size={13} strokeWidth={2.2} color={c.text} />
          <Text style={[font('medium'), styles.text, { color: c.text }]}>{t('Облегающее')}</Text>
        </View>
      </View>
      <View style={styles.cell}>
        <Bulky ink={c.muted} />
        <View style={styles.caption}>
          <X size={13} strokeWidth={2.2} color={c.muted} />
          <Text style={[font('medium'), styles.text, { color: c.muted }]}>{t('Пуховик, сумка')}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 40, paddingVertical: 4 },
  cell: { alignItems: 'center', gap: 6 },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 12, lineHeight: 16 },
});
