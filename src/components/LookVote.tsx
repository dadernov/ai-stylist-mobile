import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { WardrobeItem } from '../data/mock';
import { LookVote, LookVoteKind, voteOf } from '../domain/lookTaste';
import { AppPressable } from './AppPressable';
import { Pill } from './studio/Glass';
import { font } from './studio/studio';

export type VoteHandler = (selection: WardrobeItem[], vote: LookVoteKind | null) => void;

/** The two thumbs. A second tap on the same thumb takes the word back. They teach the choice and save nothing: the heart does that. */
export function LookVoteButtons({ selection, votes, onVote }: { selection: WardrobeItem[]; votes: LookVote[]; onVote: VoteHandler }) {
  const t = useT();
  const current = voteOf(votes, selection);
  return <View style={styles.buttons}>
    <Pill size="sm" icon={ThumbsUp} iconFill={current === 'like'} accessibilityLabel={t('Нравится')} accessibilityState={{ selected: current === 'like' }}
      onPress={() => onVote(selection, current === 'like' ? null : 'like')} />
    <Pill size="sm" icon={ThumbsDown} iconFill={current === 'dislike'} accessibilityLabel={t('Не нравится')} accessibilityState={{ selected: current === 'dislike' }}
      onPress={() => onVote(selection, current === 'dislike' ? null : 'dislike')} />
  </View>;
}

const SHOWN_MS = 8000;

/** The short honest answer to a thumb, with the way back. `id` changes with each new vote; null hides it. */
export function VoteNote({ note, onUndo }: { note: { id: number; text: string } | null; onUndo: () => void }) {
  const t = useT();
  const { colors: c } = useTheme();
  const [shown, setShown] = useState<number | null>(note?.id ?? null);
  useEffect(() => {
    if (!note) { setShown(null); return; }
    setShown(note.id);
    const timer = setTimeout(() => setShown(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [note?.id]);
  if (!note || shown !== note.id) return null;
  return <View accessibilityLiveRegion="polite" style={styles.note}>
    <Text style={[font('regular'), styles.noteText, { color: c.muted }]}>{note.text}</Text>
    <AppPressable accessibilityRole="button" hitSlop={10} onPress={onUndo}>
      <Text style={[font('semibold'), styles.noteText, { color: c.text }]}>{t('Отменить')}</Text>
    </AppPressable>
  </View>;
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteText: { fontSize: 13, lineHeight: 18, flexShrink: 1 }
});
