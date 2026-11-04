import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { useT } from '../../constants/i18n';
import { WardrobeItem } from '../../data/mock';
import { lookComments } from '../../domain/lookComments';
import { selectionHaptic, successHaptic } from '../../services/haptics';
import { FittedFrame } from '../ui/FittedFrame';
import { DevelopingImage } from './DevelopingImage';
import { font, glassEdge, glassFill, INK, INK_ON_DARK, inkSoft, useReducedMotion } from './studio';
import { useFrameAspect } from './useImageAspect';

type StatusProps = {
  /** What the try-on is doing, in words (tryOnStatusLabel). */
  label: string;
  /** The running try-on's stage: a new one is felt as well as read. */
  stage?: string | null;
  items: WardrobeItem[];
  active?: boolean;
  /** One calm line under the comments. */
  note?: string;
};

/** Under the fog in every window: one calm status line, the stylist's remarks on this very look, and its pieces. */
export function GenerationStatus({ label, stage, items, active = true, note }: StatusProps) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  // The status line changes calmly: the old words fade out, the new ones in.
  const [shown, setShown] = useState(label);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (label === shown) return;
    if (reduced) { setShown(label); return; }
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setShown(label);
      Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
  }, [label]);

  // Each new stage of the try-on on screen is a small tick under the thumb.
  const lastStage = useRef(stage);
  useEffect(() => {
    if (stage === lastStage.current) return;
    lastStage.current = stage;
    if (stage && active) selectionHaptic();
  }, [stage, active]);

  return (
    <View style={styles.status}>
      <Animated.Text style={[styles.statusText, { color: ink, opacity: fade }]} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityLiveRegion="polite">{shown}</Animated.Text>
      <StylistWhile items={items} active={active} />
      {note ? <Text maxFontSizeMultiplier={1.3} style={[styles.note, { color: inkSoft(isDark) }]}>{note}</Text> : null}
    </View>
  );
}

const COMMENT_MS = 8000;

/** While the look is put on: what the stylist thinks of this very look, one remark every few seconds, and its pieces. */
function StylistWhile({ items, active }: { items: WardrobeItem[]; active: boolean }) {
  const t = useT();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  // On a small screen the photo needs the room more than the thumbnails do.
  const { height } = useWindowDimensions();
  const comments = useMemo(() => lookComments(items, t), [items.map(item => item.id).join(), t]);
  const [at, setAt] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || comments.length < 2) return;
    const timer = setInterval(() => {
      if (reduced) { setAt(index => index + 1); return; }
      Animated.timing(fade, { toValue: 0, duration: 240, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setAt(index => index + 1);
        Animated.timing(fade, { toValue: 1, duration: 360, useNativeDriver: true }).start();
      });
    }, COMMENT_MS);
    return () => { clearInterval(timer); fade.stopAnimation(); fade.setValue(1); };
  }, [active, comments.length, reduced, fade]);
  const pictured = items.filter(item => item.imageUri).slice(0, 6);
  return (
    <>
      <Animated.Text style={[styles.comment, { color: inkSoft(isDark), opacity: fade }]} numberOfLines={3} maxFontSizeMultiplier={1.3}>{comments[at % comments.length]}</Animated.Text>
      {pictured.length && height >= 700 ? (
        <View style={styles.thumbs}>
          {pictured.map(item => (
            <View key={item.id} style={[styles.thumb, { backgroundColor: glassFill(isDark), borderColor: glassEdge(isDark) }]}>
              <Image source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={item.name} />
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

type Props = {
  /** The try-on's id: its fog, and its reveal owed once, wherever it finished. */
  jobKey?: string;
  busy: boolean;
  label: string;
  stage?: string | null;
  items: WardrobeItem[];
  /** The photo the look started from; it gives the frame its shape while running. */
  sourceUri?: string | null;
  /** The photo being dressed, or the intermediate frame once there is one. */
  photoUri: string | null;
  resultUri: string | null;
  active?: boolean;
  radius?: number;
  frameStyle?: StyleProp<ViewStyle>;
  showBefore?: boolean;
  /** The sharp look under the fog; `fit` is how it fills the frame. */
  renderResult: (fit: 'contain' | 'cover') => ReactNode;
  /** Over the frame (the before/after pill). */
  overlay?: ReactNode;
  note?: string;
  onRevealEnd?: () => void;
};

/**
 * THE generation view: every window a try-on is watched in shows this, big or small, staying or coming back.
 * The frame of fog over the photo, the look coming through it, and the status under it while it runs.
 */
export function GenerationView({ jobKey, busy, label, stage, items, sourceUri, photoUri, resultUri, active = true, radius = 30, frameStyle, showBefore = false, renderResult, overlay, note, onRevealEnd }: Props) {
  const { isDark } = useTheme();
  const done = Boolean(resultUri) && !busy;
  // The frame is the picture's own rect: in the source photo's shape from the start, the result's once it is known.
  const { aspect, settling, fit } = useFrameAspect(sourceUri || photoUri, resultUri, busy);
  return (
    <>
      <FittedFrame aspect={aspect} radius={radius} holdHeight={!done || settling} style={frameStyle} fill={photoUri || resultUri ? undefined : glassFill(isDark)}>
        <DevelopingImage photoUri={photoUri} resultUri={resultUri} developing={busy || settling} isDark={isDark} active={active} beforeUri={sourceUri} showBefore={showBefore}
          revealKey={jobKey} items={items} onRevealStart={successHaptic} onRevealEnd={onRevealEnd}>
          {resultUri ? renderResult(fit) : null}
        </DevelopingImage>
        {overlay}
      </FittedFrame>
      {busy ? <GenerationStatus label={label} stage={stage} items={items} active={active} note={note} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  status: { paddingTop: 14, gap: 10, minHeight: 20 },
  statusText: { ...font('medium'), fontSize: 15, lineHeight: 20, textAlign: 'center' },
  comment: { ...font('regular'), fontSize: 14, lineHeight: 20, minHeight: 60, textAlign: 'center' },
  thumbs: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  thumb: { width: 44, height: 56, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  note: { ...font('regular'), fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
