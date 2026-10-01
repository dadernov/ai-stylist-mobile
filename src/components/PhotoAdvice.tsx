import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lightbulb } from 'lucide-react-native';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { checkTryOnPhoto, PhotoIssue } from '../services/ai';

// One check per photo and session: the answer does not change, and a failed
// check is simply retried next time instead of showing anything.
const checked = new Map<string, Promise<PhotoIssue[]>>();

export function usePhotoCheck(uri?: string | null) {
  const [issues, setIssues] = useState<PhotoIssue[]>([]);
  useEffect(() => {
    setIssues([]);
    if (!uri) return;
    let alive = true;
    let pending = checked.get(uri);
    if (!pending) {
      pending = checkTryOnPhoto(uri).catch(() => { checked.delete(uri); return []; });
      checked.set(uri, pending);
    }
    pending.then(found => { if (alive) setIssues(found); });
    return () => { alive = false; };
  }, [uri]);
  return issues;
}

/** Advice on the try-on photo, before a paid try-on shows what went wrong. */
export function PhotoAdvice({ uri }: { uri?: string | null }) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const issues = usePhotoCheck(uri);
  const advice: Record<PhotoIssue, string> = {
    person: t('На фото не нашлось человека. Выбери фото, где ты в полный рост.'),
    people: t('В кадре несколько человек. Оставь на фото только себя.'),
    head: t('Макушка обрезана. Оставь немного места над головой.'),
    face: t('Не видно лица. Выбери фото, где ты в полный рост и лицом к камере, иначе лицо может получиться не твоим.'),
    feet: t('Не видно стоп, поэтому обувь не примерится. Сними себя целиком, с полом под ногами.'),
    arms: t('Рука поднята к голове, поэтому куртки и рубашки могут лечь криво. Лучше опусти руки вдоль тела.'),
    hands: t('Кисти спрятаны в рукавах или карманах, поэтому на примерке их тоже не будет видно. Лучше фото, где руки свободны.'),
    coat: t('На тебе длинная или объёмная верхняя одежда: под ней не видно фигуру, и на примерке ты выйдешь шире, чем есть. Лучше фото в облегающей одежде.'),
    small: t('Ты далеко от камеры. Подойди ближе, чтобы фигура занимала почти весь кадр.'),
  };
  const known = issues.filter(issue => issue in advice);
  if (!known.length) return null;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Lightbulb size={18} color={colors.accentGold} />
      <View style={styles.texts}>
        <Text style={styles.title}>{t('Фото можно улучшить')}</Text>
        {known.map(issue => <Text key={issue} style={styles.text}>{advice[issue]}</Text>)}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: c.accentGoldSoft },
  texts: { flex: 1, gap: 4 },
  title: { color: c.text, fontSize: 14, fontWeight: '600' },
  text: { color: c.text, fontSize: 13, lineHeight: 18 },
});
