import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { LookPreview } from '../components/LookPreview';
import { ThemeColors, SERIF } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { GeneratedLook } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { getOutfitAdvice } from '../domain/outfits';
import { pickBeauty } from '../constants/beauty';

type RecommendationsProps = {
  looks: GeneratedLook[];
  context: { style: string; event: string; weather: string };
  items: WardrobeItem[];
  beautyAdvice: boolean;
  onGoToBuilder: () => void;
};

export function RecommendationsScreen({ looks, context, items, beautyAdvice, onGoToBuilder }: RecommendationsProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const byId = new Map(items.map(item => [item.id, item]));
  const usableLooks = looks.filter(look => look.itemIds.some(id => byId.has(id)));
  const missing = ['Верх', 'Низ', 'Обувь'].filter(section => !items.some(item => item.section === section || (section === 'Низ' && ['Платье', 'Сарафан', 'Комбинезон'].includes(item.category))));
  const beauty = pickBeauty(context.event, beautyAdvice);
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <ScreenHeader eyebrow={t('Твой гардероб')} title={t('Советы по образам')} />
    {!usableLooks.length && <View style={styles.section}>
      <Text style={styles.title}>{t(items.length ? 'С чего начать' : 'Пока нет вещей')}</Text>
      <Text style={styles.body}>{t(items.length ? 'Подбери образ для своего события, чтобы получить советы по выбранным вещам.' : 'Добавь вещи в гардероб — советы будут опираться на них.')}</Text>
      {items.length > 0 && missing.length > 0 && <Text style={styles.body}>{t('Для полного комплекта пока не хватает: {items}.', { items: missing.map(section => t(section).toLocaleLowerCase()).join(', ') })}</Text>}
    </View>}
    {usableLooks.map(look => {
      const selection = look.itemIds.map(id => byId.get(id)).filter(Boolean) as WardrobeItem[];
      const advice = getOutfitAdvice(selection, { style: look.style, event: look.event, temperature: look.temperature ?? null });
      return <View key={look.id} style={styles.section}>
        <Text style={styles.meta}>{[t(look.style), t(look.event)].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.title}>{look.title}</Text>
        <LookPreview items={selection} />
        {advice.reasons.map(reason => <Text key={reason} style={styles.body}>{reason}</Text>)}
        {advice.tips.length > 0 && <Text style={styles.label}>{t('Как носить')}</Text>}
        {advice.tips.map(tip => <Text key={tip} style={styles.body}>{tip}</Text>)}
        {advice.warnings.length > 0 && <Text style={styles.label}>{t('На что обратить внимание')}</Text>}
        {advice.warnings.map(warning => <Text key={warning} style={styles.body}>{warning}</Text>)}
        {selection.length < new Set(look.itemIds).size && <Text style={styles.body}>{t('Часть вещей этого образа удалена из гардероба. Подбери новый вариант.')}</Text>}
      </View>;
    })}
    {beautyAdvice && context.event && <View style={styles.section}>
      <Text style={styles.title}>{t('Макияж и укладка')}</Text>
      <Text style={styles.body}>{t(beauty.makeup)}</Text>
      <Text style={styles.body}>{t(beauty.hair)}</Text>
    </View>}
    <PrimaryButton title={t('К подбору образов')} icon={ArrowUpRight} onPress={onGoToBuilder} />
  </ScrollView>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  content: { paddingBottom: 24, width: '100%', maxWidth: 760, alignSelf: 'center' },
  section: { gap: 12, borderBottomWidth: 1, borderColor: c.border, paddingBottom: 24, marginBottom: 24 },
  title: { color: c.text, fontFamily: SERIF, fontSize: 24 },
  body: { color: c.muted, fontSize: 14, lineHeight: 21 },
  meta: { color: c.accentGold, fontSize: 12 },
  label: { color: c.text, fontSize: 14, fontWeight: '600', marginTop: 6 }
});
