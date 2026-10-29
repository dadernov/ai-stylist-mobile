import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, BookOpen, Camera, ChevronRight, Footprints, Heart, Images, LucideIcon, ScanLine, ShieldCheck, Shirt, SlidersHorizontal, Sparkles, Wrench, X } from 'lucide-react-native';
import { helpTopics, HELP_INTRO, HelpTopic } from '../data/help';
import { helpTopicsZh, HELP_INTRO_ZH } from '../data/help.zh';
import { helpTopicsEn, HELP_INTRO_EN } from '../data/help.en';
import { useTheme } from '../constants/ThemeContext';
import { useLanguage, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { Pill } from './studio/Glass';
import { StudioBackdrop } from './studio/StudioBackdrop';
import { font, glassEdge, glassFill, hairline, INK, INK_ON_DARK, inkSoft, useReducedMotion } from './studio/studio';

const icons: Record<string, LucideIcon> = {
  start: BookOpen, shoes: Footprints, person: Camera, garments: Shirt, wardrobe: Images,
  fitting: ScanLine, ideas: Sparkles, saved: Heart, settings: SlidersHorizontal, problems: Wrench, data: ShieldCheck,
};

export function ProductHelp({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  const soft = inkSoft(isDark);
  const line = hairline(isDark);
  const t = useT();
  const { lang } = useLanguage();
  const topics = lang === 'zh' ? helpTopicsZh : lang === 'en' ? helpTopicsEn : helpTopics;

  return <Modal visible presentationStyle="fullScreen" animationType={reduced ? 'none' : 'slide'} onRequestClose={() => topic ? setTopic(null) : onClose()}>
    {/* Native modals need a provider in their own window to measure system insets. */}
    <SafeAreaProvider style={styles.screen}>
      <StudioBackdrop>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.content}>
          <View style={[styles.toolbar, { borderColor: line }]}>
            {topic ? <Pill icon={ArrowLeft} size="icon" accessibilityLabel={t('К разделам справки')} onPress={() => setTopic(null)} haptics={false} />
              : <BookOpen size={23} color={ink} strokeWidth={1.6} />}
            <Text accessibilityRole="header" style={[font('semibold'), styles.toolbarTitle, { color: ink }]}>{t('Справка')}</Text>
            <Pill icon={X} size="icon" accessibilityLabel={t('Закрыть справку')} onPress={onClose} haptics={false} />
          </View>
          <ScrollView key={topic?.id || 'contents'} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {topic ? <>
              <Text accessibilityRole="header" style={[font('bold'), styles.title, { color: ink }]}>{t(topic.title)}</Text>
              <Text style={[font('regular'), styles.summary, { color: soft }]}>{t(topic.summary)}</Text>
              {topic.sections.map(section => <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" style={[font('semibold'), styles.sectionTitle, { color: ink }]}>{t(section.title)}</Text>
                {section.paragraphs.map(paragraph => <Text key={paragraph} selectable style={[font('regular'), styles.paragraph, { color: ink }]}>{t(paragraph)}</Text>)}
              </View>)}
              <AppPressable accessibilityRole="button" onPress={() => setTopic(null)} style={[styles.backLink, { borderColor: line }]}>
                <ArrowLeft size={18} color={ink} strokeWidth={1.8} />
                <Text style={[font('semibold'), styles.backText, { color: ink }]}>{t('Все разделы справки')}</Text>
              </AppPressable>
            </> : <>
              <Text accessibilityRole="header" style={[font('bold'), styles.title, { color: ink }]}>{t('AI Стилист')}</Text>
              <Text style={[font('regular'), styles.intro, { color: soft }]}>{lang === 'zh' ? HELP_INTRO_ZH : lang === 'en' ? HELP_INTRO_EN : HELP_INTRO}</Text>
              <View style={[styles.topics, { backgroundColor: glassFill(isDark), borderColor: glassEdge(isDark) }]}>
                {topics.map((item, index) => {
                  const Icon = icons[item.id] || BookOpen;
                  return <AppPressable key={item.id} accessibilityRole="button" accessibilityLabel={t(item.title)}
                    onPress={() => setTopic(item)} style={[styles.topic, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: line }]}>
                    <Icon size={22} color={ink} strokeWidth={1.6} />
                    <View style={styles.topicText}>
                      <Text style={[font('semibold'), styles.topicTitle, { color: ink }]}>{t(item.title)}</Text>
                      <Text style={[font('regular'), styles.topicSummary, { color: soft }]}>{t(item.summary)}</Text>
                    </View>
                    <ChevronRight size={16} strokeWidth={1.8} color={soft} />
                  </AppPressable>;
                })}
              </View>
            </>}
          </ScrollView>
        </View>
      </SafeAreaView>
      </StudioBackdrop>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth },
  toolbarTitle: { flex: 1, minWidth: 0, fontSize: 17, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },
  intro: { fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 24 },
  summary: { fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 8 },
  topics: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 16, overflow: 'hidden' },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, minHeight: 78 },
  topicText: { flex: 1, minWidth: 0, gap: 4 },
  topicTitle: { fontSize: 15, lineHeight: 21 },
  topicSummary: { fontSize: 12, lineHeight: 18 },
  section: { paddingTop: 26, gap: 10 },
  sectionTitle: { fontSize: 18, lineHeight: 24, letterSpacing: -0.3 },
  paragraph: { fontSize: 15, lineHeight: 25 },
  backLink: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48, marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  backText: { flexShrink: 1, fontSize: 14, lineHeight: 21 },
});
