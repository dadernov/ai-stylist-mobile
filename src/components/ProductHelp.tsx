import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, BookOpen, Camera, ChevronRight, Footprints, Heart, Images, LucideIcon, ScanLine, ShieldCheck, Shirt, SlidersHorizontal, Sparkles, Wrench, X } from 'lucide-react-native';
import { helpTopics, HELP_INTRO, HelpTopic } from '../data/help';
import { helpTopicsZh, HELP_INTRO_ZH } from '../data/help.zh';
import { helpTopicsEn, HELP_INTRO_EN } from '../data/help.en';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useLanguage, useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';
import { IconButton } from './ui/IconButton';

const icons: Record<string, LucideIcon> = {
  start: BookOpen, shoes: Footprints, person: Camera, garments: Shirt, wardrobe: Images,
  fitting: ScanLine, ideas: Sparkles, saved: Heart, settings: SlidersHorizontal, problems: Wrench, data: ShieldCheck,
};

export function ProductHelp({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { lang } = useLanguage();
  const topics = lang === 'zh' ? helpTopicsZh : lang === 'en' ? helpTopicsEn : helpTopics;

  return <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={() => topic ? setTopic(null) : onClose()}>
    {/* Native modals need a provider in their own window to measure system insets. */}
    <SafeAreaProvider style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.content}>
          <View style={styles.toolbar}>
            {topic ? <IconButton icon={ArrowLeft} label={t('К разделам справки')} onPress={() => setTopic(null)} variant="quiet" />
              : <BookOpen size={23} color={colors.accentGold} strokeWidth={1.6} />}
            <Text accessibilityRole="header" style={styles.toolbarTitle}>{t('Справка')}</Text>
            <IconButton icon={X} label={t('Закрыть справку')} onPress={onClose} variant="quiet" />
          </View>
          <ScrollView key={topic?.id || 'contents'} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {topic ? <>
              <Text accessibilityRole="header" style={styles.title}>{t(topic.title)}</Text>
              <Text style={styles.summary}>{t(topic.summary)}</Text>
              {topic.sections.map(section => <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t(section.title)}</Text>
                {section.paragraphs.map(paragraph => <Text key={paragraph} selectable style={styles.paragraph}>{t(paragraph)}</Text>)}
              </View>)}
              <AppPressable accessibilityRole="button" onPress={() => setTopic(null)} style={styles.backLink}>
                <ArrowLeft size={18} color={colors.accentGold} />
                <Text style={styles.backText}>{t('Все разделы справки')}</Text>
              </AppPressable>
            </> : <>
              <Text accessibilityRole="header" style={styles.title}>{t('AI Стилист')}</Text>
              <Text style={styles.intro}>{lang === 'zh' ? HELP_INTRO_ZH : lang === 'en' ? HELP_INTRO_EN : HELP_INTRO}</Text>
              <View style={styles.topics}>
                {topics.map(item => {
                  const Icon = icons[item.id] || BookOpen;
                  return <AppPressable key={item.id} accessibilityRole="button" accessibilityLabel={t(item.title)}
                    onPress={() => setTopic(item)} style={styles.topic}>
                    <Icon size={22} color={colors.accentGold} strokeWidth={1.5} />
                    <View style={styles.topicText}>
                      <Text style={styles.topicTitle}>{t(item.title)}</Text>
                      <Text style={styles.topicSummary}>{t(item.summary)}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.muted} />
                  </AppPressable>;
                })}
              </View>
            </>}
          </ScrollView>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 68, borderBottomWidth: 1, borderColor: c.border },
  toolbarTitle: { flex: 1, minWidth: 0, color: c.text, fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32 },
  title: { color: c.text, fontSize: 26, lineHeight: 33, fontWeight: '700' },
  intro: { color: c.muted, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 28 },
  summary: { color: c.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 8 },
  topics: { borderTopWidth: 1, borderColor: c.border },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, minHeight: 82, borderBottomWidth: 1, borderColor: c.border },
  topicText: { flex: 1, minWidth: 0, gap: 5 },
  topicTitle: { color: c.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  topicSummary: { color: c.muted, fontSize: 12, lineHeight: 18 },
  section: { paddingTop: 26, gap: 10 },
  sectionTitle: { color: c.text, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  paragraph: { color: c.text, fontSize: 15, lineHeight: 25 },
  backLink: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48, marginTop: 28, borderTopWidth: 1, borderColor: c.border, paddingTop: 16 },
  backText: { flexShrink: 1, color: c.accentGold, fontSize: 14, lineHeight: 21, fontWeight: '600' },
});
