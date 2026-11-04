import { Animated, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { GenerationHistory } from '../components/GenerationHistory';
import { FittingRoom } from '../components/FittingRoom';
import { FormScrollView } from '../components/ui/FormScrollView';
import { AppPressable } from '../components/AppPressable';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SPACING, ThemeColors } from '../constants/theme';
import { Glass, Pill } from '../components/studio/Glass';
import { font } from '../components/studio/studio';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { ArrowUpRight } from 'lucide-react-native';

// The floating «К примерке» and the air around it.
const FLOATING_CTA_ROOM = 50 + 12 + 8;
type Part = 'fitting' | 'history';

type Props = {
  items: WardrobeItem[];
  modelUri?: string;
  onProfile: () => void;
  onModelChange?: (uri: string) => void;
  onWardrobe: () => void;
  initialItemId?: string;
  initialItemIds?: string[];
  initialTab?: Part;
  initialHistoryItemId?: string;
  onOpenItem: (id: string) => void;
};

/** The «Примерка» tab: picking garments and the last try-on, and the whole journal of them. */
export function FittingScreen({ items, modelUri, onProfile, onModelChange, onWardrobe, initialItemId, initialItemIds, initialTab = 'fitting', initialHistoryItemId, onOpenItem }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [activeTab, setActiveTab] = useState<Part>(initialTab);
  const [historyItemId, setHistoryItemId] = useState(initialHistoryItemId);
  const [repeatSelection, setRepeatSelection] = useState<{ ids: string[]; key: number }>();
  // "Try on" for the garments picked in the fitting room, pinned above the tab bar.
  const [fittingCta, setFittingCta] = useState<{ count: number; open: () => void } | null>(null);
  // The list's own height, measured: a result, its thumbnails and its buttons fit it whole.
  const [viewport, setViewport] = useState(0);
  const segmentAnim = useRef(new Animated.Value(initialTab === 'history' ? 1 : 0)).current;
  const [segmentWidth, setSegmentWidth] = useState(0);
  useEffect(() => {
    Animated.spring(segmentAnim, { toValue: activeTab === 'history' ? 1 : 0, friction: 9, tension: 90, useNativeDriver: true }).start();
  }, [activeTab, segmentAnim]);
  const segmentThumbWidth = segmentWidth > 0 ? (segmentWidth - 6) / 2 : 0;
  const part = (value: Part, label: string) => (
    <AppPressable haptics accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: activeTab === value }} style={styles.segmentTab} onPress={() => setActiveTab(value)}>
      <Text style={[styles.segmentText, activeTab === value && styles.segmentTextActive]}>{label}</Text>
    </AppPressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <ScreenHeader title={t('Примерка')} />
        {/* A glass track with the open part as a black pill sliding along it. */}
        <Glass style={styles.segmentGlass}>
          <View accessibilityRole="tablist" style={styles.segment} onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width)}>
            {segmentThumbWidth > 0 ? (
              <Animated.View pointerEvents="none" style={[styles.segmentThumb, { width: segmentThumbWidth,
                transform: [{ translateX: segmentAnim.interpolate({ inputRange: [0, 1], outputRange: [0, segmentThumbWidth] }) }] }]} />
            ) : null}
            {part('fitting', t('Примерить'))}
            {part('history', t('История'))}
          </View>
        </Glass>
      </View>
      {activeTab === 'history' && <GenerationHistory items={items} itemId={historyItemId}
        onFilter={setHistoryItemId} onOpenItem={onOpenItem}
        onTryOn={ids => { setRepeatSelection(previous => ({ ids, key: (previous?.key || 0) + 1 })); setActiveTab('fitting'); }} />}
      <FormScrollView style={activeTab === 'history' && { display: 'none' }} onLayout={event => setViewport(event.nativeEvent.layout.height)}
        contentContainerStyle={[styles.pageContent, activeTab === 'fitting' && fittingCta ? { paddingBottom: 96 } : null]}>
        <FittingRoom key={repeatSelection?.key || 0} visible={activeTab === 'fitting'} viewport={viewport ? viewport - (fittingCta ? FLOATING_CTA_ROOM : 0) : undefined} items={items} modelUri={modelUri}
          initialItemId={repeatSelection ? undefined : initialItemId} initialItemIds={repeatSelection?.ids || initialItemIds} onProfile={onProfile} onModelChange={onModelChange} onWardrobe={onWardrobe}
          onOpenHistory={() => { setHistoryItemId(undefined); setActiveTab('history'); }}
          onSelectionCta={setFittingCta} />
      </FormScrollView>
      {activeTab === 'fitting' && fittingCta ? (
        <View style={styles.floatingCta} pointerEvents="box-none">
          <Pill variant="primary" title={t('К примерке ({count})', { count: fittingCta.count })} icon={ArrowUpRight} onPress={fittingCta.open} />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // Transparent: the studio backdrop shows through.
  container: { flex: 1 },
  floatingCta: { position: 'absolute', left: SPACING.lg, right: SPACING.lg, bottom: SPACING.md },
  pageContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: SPACING.xl },
  pageHeader: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  segmentGlass: { marginBottom: SPACING.lg },
  segment: { flexDirection: 'row', padding: 3, height: 44 },
  segmentThumb: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 999, backgroundColor: c.text },
  segmentTab: { flex: 1, flexBasis: 0, minWidth: 0, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  segmentText: { ...font('semibold'), fontSize: 13, color: c.text, opacity: 0.78 },
  segmentTextActive: { color: c.background, opacity: 1 }
});
