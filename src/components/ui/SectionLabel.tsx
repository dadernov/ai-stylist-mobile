import { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type SectionLabelProps = {
  children: ReactNode;
};

// Eyebrow-подпись секции: КАПС, разрядка, шампань-бронза.
export function SectionLabel({ children }: SectionLabelProps) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.label}>{children}</Text>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  label: {
    ...TYPE.eyebrow,
    color: c.accentGold,
    marginBottom: 10
  }
});
