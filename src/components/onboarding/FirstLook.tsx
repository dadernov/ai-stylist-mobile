import { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, ImagePlus } from 'lucide-react-native';
import { WardrobeItem } from '../../data/mock';
import { useTheme } from '../../constants/ThemeContext';
import { useT } from '../../constants/i18n';
import { analyzeImage, AiResult, prepareGarmentPhoto, sendCategoryFeedback } from '../../services/ai';
import { accountKey, decodeTraits } from '../../services/accountStorage';
import { saveJson } from '../../services/storage';
import { closetHasContent } from '../../services/closetSync';
import { Session } from '../../services/auth';
import { tryOnContext } from '../../services/tryOnJobs';
import { suggestItemName } from '../../domain/itemName';
import { readingColourName } from '../../domain/flatReading';
import { colorOptions, getClosestColorName, getSectionByCategory, normalizeHex } from '../../screens/WardrobeScreen';
import { useAiConsent } from '../AiConsentContext';
import { useTryOnJobs } from '../TryOnJobsContext';
import { usePhotoPicker } from '../usePhotoPicker';
import { PhotoGuide } from '../PhotoGuide';
import { PhotoAdvice } from '../PhotoAdvice';
import { tryOnStatusLabel } from '../tryOnStatus';
import { StudioBackdrop } from '../studio/StudioBackdrop';
import { DevelopingImage } from '../studio/DevelopingImage';
import { ChoicePill, Glass, Pill } from '../studio/Glass';
import { font, INK, INK_ON_DARK, inkSoft, isCutout, useReducedMotion } from '../studio/studio';
import { canTryOn, firstLookDecision, FirstLookStep, magicView, nextStep, QUESTIONS, QuestionId } from './firstLookLogic';

export type FirstLookExit = 'wardrobe' | 'recommendations';
type Source = 'camera' | 'gallery';

/**
 * Whether the flow opens for this account (firstLookDecision). Decided once and kept: the flow's own photo and
 * garment must not close it halfway. An app closed halfway has data on the next launch and goes straight to the app.
 */
export function useFirstLookGate({ pending, ready, local, unreadable, session, onRemember }: {
  pending: boolean; ready: boolean; local: boolean; unreadable: boolean; session: Session; onRemember: () => void;
}): 'checking' | 'show' | 'hide' {
  const [state, setState] = useState<'checking' | 'show' | 'hide'>('checking');
  const asked = useRef(false);
  useEffect(() => {
    if (!pending || !ready || asked.current) return;
    asked.current = true;
    const settle = (remote: boolean | null) => {
      const decision = firstLookDecision({ unreadable, local, remote });
      if (decision === 'hide-and-remember') onRemember();
      setState(decision === 'show' ? 'show' : 'hide');
    };
    if (local || unreadable) settle(null);
    else closetHasContent(session).then(settle, () => settle(null));
  }, [pending, ready, local, unreadable]);
  return pending ? state : 'hide';
}

export function FirstLook({ login, items, modelUri, onProfilePhoto, onAddItem, onPreference, onDone }: {
  login: string;
  items: WardrobeItem[];
  modelUri?: string;
  onProfilePhoto: (uri: string) => void;
  onAddItem: (item: WardrobeItem) => void;
  onPreference: (field: 'style' | 'event', value: string) => void;
  onDone: (exit: FirstLookExit) => void;
}) {
  const t = useT();
  const { isDark } = useTheme();
  const [step, setStep] = useState<FirstLookStep>('you');
  const [garment, setGarment] = useState<WardrobeItem | null>(null);
  const go = (from: FirstLookStep, hasGarment: boolean) => {
    const next = nextStep(from, { hasPhoto: Boolean(modelUri), hasGarment });
    if (next === 'app') onDone('wardrobe'); else setStep(next);
  };
  return <StudioBackdrop>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[font('medium'), styles.counter, { color: inkSoft(isDark) }]}>
          {t('Шаг {step} из {total}', { step: step === 'you' ? 1 : step === 'garment' ? 2 : 3, total: 3 })}
        </Text>
        {step === 'you' ? <YouStep modelUri={modelUri} onPhoto={onProfilePhoto} onNext={() => go('you', false)} /> : null}
        {step === 'garment' ? <GarmentStep hasPhoto={Boolean(modelUri)} garment={garment}
          onAddItem={item => { onAddItem(item); setGarment(item); }} onNext={() => go('garment', true)} onSkip={() => onDone('wardrobe')} /> : null}
        {step === 'magic' && garment && modelUri ? <MagicStep login={login} modelUri={modelUri}
          garment={items.find(item => item.id === garment.id) || garment} onPreference={onPreference} onDone={onDone} /> : null}
      </ScrollView>
    </SafeAreaView>
  </StudioBackdrop>;
}

function Heading({ title, text }: { title: string; text: string }) {
  const { isDark } = useTheme();
  return <View style={styles.heading}>
    <Text accessibilityRole="header" style={[font('semibold'), styles.title, { color: isDark ? INK_ON_DARK : INK }]}>{title}</Text>
    <Text style={[font('regular'), styles.text, { color: inkSoft(isDark) }]}>{text}</Text>
  </View>;
}

function Note({ children }: { children: string }) {
  const { isDark } = useTheme();
  return <Text accessibilityRole="alert" style={[font('regular'), styles.text, { color: inkSoft(isDark) }]}>{children}</Text>;
}

function SourceButtons({ onPick, disabled, secondary }: { onPick: (source: Source) => void; disabled: boolean; secondary?: boolean }) {
  const t = useT();
  return <View style={styles.actions}>
    <Pill variant={secondary ? 'glass' : 'primary'} icon={Camera} title={t('Снять фото')} disabled={disabled} haptics={false} onPress={() => onPick('camera')} />
    <Pill icon={ImagePlus} title={t('Из галереи')} disabled={disabled} haptics={false} onPress={() => onPick('gallery')} />
  </View>;
}

function YouStep({ modelUri, onPhoto, onNext }: { modelUri?: string; onPhoto: (uri: string) => void; onNext: () => void }) {
  const t = useT();
  const aiConsent = useAiConsent();
  const { pickPhoto, cropModal, isPicking } = usePhotoPicker();
  // The photo check sends the photo to the server, so the advice waits for the consent.
  const [adviceAllowed, setAdviceAllowed] = useState(false);
  const pick = async (source: Source) => {
    const uri = await pickPhoto(source);
    if (!uri) return;
    onPhoto(uri);
    setAdviceAllowed(await aiConsent.ensure());
  };
  return <>
    <Heading title={t('Начнём с тебя')} text={t('Нужно фото в полный рост: на нём ты будешь примерять вещи. Подойдёт и снимок из галереи.')} />
    {modelUri ? <Image source={{ uri: modelUri }} resizeMode="cover" style={styles.preview} accessibilityLabel={t('Твоё фото')} /> : <PhotoGuide />}
    {adviceAllowed ? <PhotoAdvice uri={modelUri} /> : null}
    {modelUri ? <Pill variant="primary" title={t('Дальше')} haptics={false} onPress={onNext} /> : null}
    <SourceButtons onPick={source => void pick(source)} disabled={isPicking} secondary={Boolean(modelUri)} />
    {!modelUri ? <Pill title={t('Пропустить')} haptics={false} onPress={onNext} /> : null}
    {cropModal}
  </>;
}

function GarmentStep({ hasPhoto, garment, onAddItem, onNext, onSkip }: {
  hasPhoto: boolean; garment: WardrobeItem | null; onAddItem: (item: WardrobeItem) => void; onNext: () => void; onSkip: () => void;
}) {
  const t = useT();
  const aiConsent = useAiConsent();
  const { pickPhoto, cropModal, isPicking } = usePhotoPicker();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [review, setReview] = useState<{ photo: string; result: AiResult; category: string } | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current = -1; }, []);

  // As the wardrobe's draft saves it, from the same reading (WardrobeScreen: applyReading, handleSaveItem).
  const save = (photo: string, result: AiResult, category: string) => {
    const hex = normalizeHex(result.dominantColor || '');
    const color = readingColourName({ colorName: result.colorName, dominantColor: hex }, getClosestColorName, colorOptions);
    const palette = [color, ...(result.palette || []).map(normalizeHex).filter(Boolean).map(getClosestColorName)]
      .filter(name => name && name !== 'Не определено');
    const pattern = result.pattern || '';
    const item: WardrobeItem = {
      id: Date.now().toString(),
      name: suggestItemName({ category, color, pattern }) || t(category),
      category, color: color || 'Не определено', season: result.season || 'Не определено', pattern: pattern || 'Не определено',
      section: getSectionByCategory(category), tags: Array.from(new Set(palette)).slice(0, 5),
      imageUri: result.bgRemovedBase64 || photo, sourceImageUri: photo, size: '', store: '', material: '',
      traits: result.traits ? decodeTraits(result.traits) : undefined,
    };
    if (result.analysisId) sendCategoryFeedback(result.analysisId, category);
    onAddItem(item);
    setReview(null);
    if (canTryOn(item)) onNext();
    else setNote(t('Вещь уже в гардеробе, но такое пока нельзя примерить. Сними что-то из одежды или обуви, или загляни в приложение.'));
  };

  const add = async (source: Source) => {
    setNote(''); setReview(null);
    const photo = await pickPhoto(source);
    if (!photo) return;
    const id = ++request.current;
    if (!(await aiConsent.ensure())) {
      if (request.current === id) setNote(t('Без согласия не получится распознать вещь и примерить её. Можно передумать или пойти дальше без этого.'));
      return;
    }
    if (request.current !== id) return;
    setBusy(true);
    try {
      const upload = await prepareGarmentPhoto(photo);
      const result = await analyzeImage(upload);
      if (request.current !== id) return;
      if (!result.category) setNote(t('Не получилось разглядеть вещь. Попробуй снять её при свете, на однотонном фоне.'));
      else if (result.needsReview) setReview({ photo, result, category: result.category });
      else save(photo, result, result.category);
    } catch {
      if (request.current === id) setNote(t('Не получилось обработать фото. Проверь интернет и попробуй ещё раз.'));
    } finally {
      if (request.current === id) setBusy(false);
    }
  };

  return <>
    <Heading title={t('Теперь одна вещь')} text={hasPhoto ? t('Сфоткай что-нибудь рядом с тобой: футболку, джинсы, кроссовки. Мы вырежем фон и сразу примерим на тебя.')
      : t('Сфоткай что-нибудь рядом с тобой: футболку, джинсы, кроссовки. Мы вырежем фон и положим вещь в гардероб.')} />
    {garment?.imageUri ? <Image source={{ uri: garment.imageUri }} resizeMode={isCutout(garment.imageUri) ? 'contain' : 'cover'} style={styles.garment} accessibilityLabel={garment.name} /> : null}
    {busy ? <Pill loading title={t('Разглядываем вещь…')} haptics={false} /> : null}
    {note ? <Note>{note}</Note> : null}
    {review ? <Glass radius={24}><View style={styles.card}>
      <Note>{t('Похоже, это {category}. Всё верно?', { category: t(review.category) })}</Note>
      <Pill variant="primary" title={t('Да, верно')} haptics={false} onPress={() => save(review.photo, review.result, review.category)} />
    </View></Glass> : null}
    {!busy ? <SourceButtons onPick={source => void add(source)} disabled={isPicking} secondary={Boolean(review || garment)} /> : null}
    <Pill title={garment ? t('В приложение') : t('Сейчас нечего снять, пойдём дальше')} haptics={false} onPress={() => { request.current++; onSkip(); }} />
    {cropModal}
  </>;
}

function MagicStep({ login, modelUri, garment, onPreference, onDone }: {
  login: string; modelUri: string; garment: WardrobeItem; onPreference: (field: 'style' | 'event', value: string) => void; onDone: (exit: FirstLookExit) => void;
}) {
  const t = useT();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const aiConsent = useAiConsent();
  const { store, jobs } = useTryOnJobs();
  const [jobId, setJobId] = useState<string>();
  const [declined, setDeclined] = useState(false);
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [asked, setAsked] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Fixed at the first send: photos move to their folder meanwhile, and a retry must find the same job, not pay for a second.
  const inputs = useRef({ modelUri, garment });

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setStarting(true); setStartError(''); setDeclined(false);
    try {
      if (!(await aiConsent.ensure())) { if (alive.current) setDeclined(true); return; }
      const { modelUri: model, garment: item } = inputs.current;
      const context = await tryOnContext(model, [item]);
      await store.start({ modelUri: model, items: [item], context, tuckMode: 'auto', quality: 'quality', onJob: id => { if (alive.current) setJobId(id); } });
    } catch (error: any) {
      if (alive.current) setStartError(error?.message ? t(String(error.message)) : t('Не удалось сгенерировать примерку'));
    } finally {
      busy.current = false;
      if (alive.current) setStarting(false);
    }
  };
  useEffect(() => { void start(); }, []);

  const job = jobs.find(candidate => candidate.id === jobId);
  const view = declined ? 'declined' : magicView(job, Boolean(startError));
  const resultUri = job?.result?.imageUri || null;
  useEffect(() => {
    if (view !== 'ready') { setRevealed(false); return; }
    // DevelopingImage sharpens over about 1.3 s; with reduced motion it simply crossfades.
    const timer = setTimeout(() => setRevealed(true), reduced ? 0 : 1400);
    return () => clearTimeout(timer);
  }, [view, reduced]);

  const question = QUESTIONS[asked];
  const answer = (id: QuestionId, value: string) => {
    if (id === 'colors') void saveJson(accountKey(login, 'favoriteColors'), value).catch(() => {});
    else onPreference(id, value);
    setAsked(index => index + 1);
  };

  if (view === 'declined') return <>
    <Heading title={t('Нужно твоё согласие')} text={t('Для примерки фото уходят в нейросеть, поэтому без согласия мы их не отправим. Вещь уже в гардеробе.')} />
    <Pill variant="primary" title={t('Спросить ещё раз')} haptics={false} disabled={starting} onPress={() => void start()} />
    <Pill title={t('В приложение')} haptics={false} onPress={() => onDone('wardrobe')} />
  </>;
  if (view === 'failed') return <>
    <Heading title={t('Примерка не получилась')} text={t('Так бывает, и дело не в тебе. Вещь и фото уже сохранены, можно попробовать ещё раз или вернуться к этому позже.')} />
    {job?.error || startError ? <Note>{job?.error ? t(String(job.error)) : startError}</Note> : null}
    <Pill variant="primary" title={t('Попробовать ещё раз')} haptics={false} loading={starting} onPress={() => void start()} />
    <Pill title={t('В приложение')} haptics={false} onPress={() => onDone('wardrobe')} />
  </>;
  const ready = view === 'ready';
  const ink = isDark ? INK_ON_DARK : INK;
  return <>
    <Heading title={ready ? t('Вот и ты!') : t('Примеряем на тебя')} text={ready ? t('Твоя первая примерка готова. Дальше будет только интереснее.') : t('Это займёт около минуты. А пока расскажи немного о себе.')} />
    <View style={styles.frame} accessible accessibilityLabel={ready ? t('Готовая примерка') : t('Примерка готовится')}>
      <DevelopingImage photoUri={modelUri} resultUri={resultUri} developing={!ready} isDark={isDark}>
        {resultUri ? <Image source={{ uri: resultUri }} resizeMode="contain" style={StyleSheet.absoluteFill} /> : null}
      </DevelopingImage>
    </View>
    {!ready ? <Text accessibilityLiveRegion="polite" style={[font('regular'), styles.status, { color: inkSoft(isDark) }]}>{tryOnStatusLabel(job?.progress, t)}</Text> : null}
    {!ready ? <Glass radius={24}><View style={styles.card}>
      {question ? <>
        <Text style={[font('semibold'), styles.question, { color: ink }]}>{t(question.title)}</Text>
        <View style={styles.choices}>
          {question.options.map(option => <ChoicePill key={option.value} label={t(option.label)} active={false} onPress={() => answer(question.id, option.value)} />)}
        </View>
        <Pill size="sm" title={t('Пропустить вопрос')} haptics={false} onPress={() => setAsked(index => index + 1)} />
      </> : <Text style={[font('medium'), styles.question, { color: ink }]}>{t('Спасибо! Осталось чуть-чуть.')}</Text>}
    </View></Glass> : null}
    {!ready ? <Pill title={t('Подождать в приложении')} haptics={false} onPress={() => onDone('wardrobe')} /> : null}
    {ready && job?.result?.warning ? <Note>{t(String(job.result.warning))}</Note> : null}
    {ready && revealed ? <>
      <Pill variant="primary" title={t('Добавить ещё вещи')} haptics={false} onPress={() => onDone('wardrobe')} />
      <Pill title={t('Смотреть идеи')} haptics={false} onPress={() => onDone('recommendations')} />
    </> : null}
  </>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', gap: 16, padding: 24, width: '100%', maxWidth: 480, alignSelf: 'center' },
  counter: { fontSize: 13 },
  heading: { gap: 8 },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  text: { fontSize: 15, lineHeight: 22 },
  actions: { gap: 10 },
  preview: { width: '60%', aspectRatio: 3 / 4, alignSelf: 'center', borderRadius: 24 },
  garment: { width: 140, height: 140, alignSelf: 'center', borderRadius: 20 },
  frame: { width: '100%', aspectRatio: 3 / 4, borderRadius: 28, overflow: 'hidden' },
  status: { fontSize: 13, textAlign: 'center' },
  card: { gap: 12, padding: 16 },
  question: { fontSize: 16, lineHeight: 22 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
