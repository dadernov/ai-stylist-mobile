import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';
import { ReactNode, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { usePhotoPicker } from '../components/usePhotoPicker';
import { PhotoSourcePicker, PhotoSource } from '../components/PhotoSourcePicker';
import { useAppDialog } from '../components/AppDialog';
import { FormScrollView } from '../components/ui/FormScrollView';
import { OptionPicker } from '../components/ui/OptionPicker';
import { Chip } from '../components/Chip';
import { AppPressable } from '../components/AppPressable';
import { isAutoItemName, suggestItemName } from '../domain/itemName';
import { useAiConsent } from '../components/AiConsentContext';
import { OverlayOutlet } from '../components/OverlayHost';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { FadeInView } from '../components/ui/FadeInView';
import { SHADOWS, ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { analyzeImage, AiResult, FlatAnalysis, flattenGarment, sendCategoryFeedback } from '../services/ai';
import { categoryFitsSection, mergeFlatReading } from '../domain/flatReading';
import { GarmentLabel } from '../components/GarmentLabel';
import { WardrobeStudio } from '../components/studio/WardrobeStudio';
import { ChoicePill, Glass, Pill } from '../components/studio/Glass';
import { FloorShadow, GarmentImage } from '../components/studio/Garment';
import { StudioBackdrop, useStudioTint } from '../components/studio/StudioBackdrop';
import { font, INK, INK_FAINT, INK_ON_DARK, inkSoft, isCutout, studioTint, useReducedMotion } from '../components/studio/studio';
import { StudioSheet } from '../components/studio/StudioSheet';
import { decodeTraits } from '../domain/garmentTraits';
import { ImagePlus, Pencil, Plus, Search, Trash2, X, ScanLine, CircleHelp, History, ChevronRight, Layers, PersonStanding, SwitchCamera, Wand2, Undo2 } from 'lucide-react-native';
import { useTryOnJobs } from '../components/TryOnJobsContext';
import { GarmentTile } from '../components/GarmentTile';
import { IconButton } from '../components/ui/IconButton';
import { ProductHelp } from '../components/ProductHelp';

type WardrobeScreenProps = {
  items: WardrobeItem[];
  onItemsChange: (items: WardrobeItem[]) => void;
  onTryOn: (item: WardrobeItem) => void;
  onOpenHistory: (item: WardrobeItem) => void;
  // Opens the ideas built around this garment.
  onStyleWith?: (item: WardrobeItem) => void;
  initialDetailId?: string;
};

const sectionOptions = ['Верх', 'Низ', 'Обувь', 'Сумки', 'Аксессуары', 'Верхняя одежда'];
const categoryFilters = ['Все', ...sectionOptions];

// Эмодзи-иконки фильтров (не переводятся).
const filterIcons: Record<string, string> = {
  Все: '✨',
  Верх: '👕',
  Низ: '👖',
  Обувь: '👟',
  Сумки: '👜',
  Аксессуары: '🧣',
  'Верхняя одежда': '🧥'
};

const categoryOptions = [
  'Футболка',
  'Поло',
  'Лонгслив',
  'Рубашка',
  'Блуза',
  'Топ',
  'Майка',
  'Водолазка',
  'Свитер',
  'Худи',
  'Свитшот',
  'Кардиган',
  'Жилет',
  'Пиджак',
  'Бомбер',
  'Куртка',
  'Пальто',
  'Тренч',
  'Плащ',
  'Пуховик',
  'Парка',
  'Платье',
  'Сарафан',
  'Комбинезон',
  'Юбка',
  'Мини-юбка',
  'Миди-юбка',
  'Макси-юбка',
  'Джинсы',
  'Брюки',
  'Шорты',
  'Леггинсы',
  'Колготки',
  'Джоггеры',
  'Обувь',
  'Кроссовки',
  'Кеды',
  'Лоферы',
  'Туфли',
  'Ботинки',
  'Сандалии',
  'Сапоги',
  'Балетки',
  'Сумка',
  'Рюкзак',
  'Клатч',
  'Шапка',
  'Кепка',
  'Шляпа',
  'Шарф',
  'Перчатки'
];
const seasonOptions = ['Лето', 'Зима', 'Демисезон', 'Круглый год'];
const patternOptions = ['Клетка', 'Полоска', 'Горох', 'Цветочный', 'Однотонный', 'Принт'];



const sectionByCategory: Record<string, string> = {
  Футболка: 'Верх',
  Поло: 'Верх',
  Лонгслив: 'Верх',
  Рубашка: 'Верх',
  Блуза: 'Верх',
  Топ: 'Верх',
  Майка: 'Верх',
  Водолазка: 'Верх',
  Свитер: 'Верх',
  Худи: 'Верх',
  Свитшот: 'Верх',
  Кардиган: 'Верх',
  Жилет: 'Верх',
  Пиджак: 'Верхняя одежда',
  Бомбер: 'Верхняя одежда',
  Куртка: 'Верхняя одежда',
  Пальто: 'Верхняя одежда',
  Тренч: 'Верхняя одежда',
  Плащ: 'Верхняя одежда',
  Пуховик: 'Верхняя одежда',
  Парка: 'Верхняя одежда',
  Платье: 'Верх',
  Сарафан: 'Верх',
  Комбинезон: 'Верх',
  Юбка: 'Низ',
  'Мини-юбка': 'Низ',
  'Миди-юбка': 'Низ',
  'Макси-юбка': 'Низ',
  Джинсы: 'Низ',
  Брюки: 'Низ',
  Шорты: 'Низ',
  Леггинсы: 'Низ',
  Колготки: 'Низ',
  Джоггеры: 'Низ',
  Обувь: 'Обувь',
  Кроссовки: 'Обувь',
  Кеды: 'Обувь',
  Лоферы: 'Обувь',
  Туфли: 'Обувь',
  Ботинки: 'Обувь',
  Сандалии: 'Обувь',
  Сапоги: 'Обувь',
  Балетки: 'Обувь',
  Сумка: 'Сумки',
  Рюкзак: 'Сумки',
  Клатч: 'Сумки',
  Шапка: 'Аксессуары',
  Кепка: 'Аксессуары',
  Шляпа: 'Аксессуары',
  Шарф: 'Аксессуары',
  Перчатки: 'Аксессуары'
};

const getSectionByCategory = (category: string) => sectionByCategory[category] || 'Верх';

const namedColors = [
  { name: 'Белый', hex: '#FFFFFF' },
  { name: 'Молочный', hex: '#FFF8E7' },
  { name: 'Кремовый', hex: '#FFF4D6' },
  { name: 'Бежевый', hex: '#F5F5DC' },
  { name: 'Песочный', hex: '#E6D1A3' },
  { name: 'Карамельный', hex: '#CDAA7D' },
  { name: 'Коричневый', hex: '#8B5A2B' },
  { name: 'Черный', hex: '#000000' },
  { name: 'Графит', hex: '#3A3A3A' },
  { name: 'Серый', hex: '#808080' },
  { name: 'Серебристый', hex: '#BFC5C9' },
  { name: 'Синий', hex: '#1E88E5' },
  { name: 'Синий деним', hex: '#2F4B7C' },
  { name: 'Голубой', hex: '#4FC3F7' },
  { name: 'Бирюзовый', hex: '#26C6DA' },
  { name: 'Зеленый', hex: '#43A047' },
  { name: 'Оливковый', hex: '#7D8F3B' },
  { name: 'Хаки', hex: '#6B7B4A' },
  { name: 'Желтый', hex: '#FDD835' },
  { name: 'Горчичный', hex: '#C9A227' },
  { name: 'Оранжевый', hex: '#FB8C00' },
  { name: 'Красный', hex: '#E53935' },
  { name: 'Бордовый', hex: '#7B1E3B' },
  { name: 'Розовый', hex: '#F48FB1' },
  { name: 'Пудровый', hex: '#E5B6C6' },
  { name: 'Фиолетовый', hex: '#8E24AA' },
  { name: 'Лавандовый', hex: '#B39DDB' }
];

const colorOptions = namedColors.map((item) => item.name);

const normalizeHex = (value: string) => {
  if (!value) return '';
  const trimmed = value.trim().toUpperCase();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (withHash.length === 4) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9A-F]{6}$/.test(withHash)) return withHash;
  return '';
};

const hexToRgb = (hex: string) => {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return { r, g, b };
};

const getClosestColorName = (hex: string) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'Не определено';
  let best = namedColors[0];
  let bestDist = Number.POSITIVE_INFINITY;
  namedColors.forEach((candidate) => {
    const c = hexToRgb(candidate.hex);
    if (!c) return;
    const dist = (rgb.r - c.r) ** 2 + (rgb.g - c.g) ** 2 + (rgb.b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  });
  return best.name;
};

const tagToLabel = (tag: string) => {
  const hex = normalizeHex(tag);
  if (hex) return getClosestColorName(hex);
  return tag;
};

type AtelierInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
};

// Поле ввода «Ателье»: скругление, мягкий фон и золотая рамка в фокусе.
function AtelierInput({ value, onChangeText, placeholder }: AtelierInputProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [isFocused, setFocused] = useState(false);
  return (
    <TextInput
      style={[styles.modalInput, isFocused && styles.modalInputFocused]}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      value={value}
      multiline
      scrollEnabled={false}
      maxLength={240}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
      onSubmitEditing={Keyboard.dismiss}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// Clothes crease; shoes, bags and accessories do not, and are not smoothed.
const FLAT_SECTIONS = ['Верх', 'Низ', 'Верхняя одежда'];

export function WardrobeScreen({ items, onItemsChange, onTryOn, onOpenHistory, onStyleWith, initialDetailId }: WardrobeScreenProps) {
  const Alert = useAppDialog();
  const aiConsent = useAiConsent();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors, isDark } = useTheme();
  const reduced = useReducedMotion();
  const ink = isDark ? INK_ON_DARK : INK;
  const soft = inkSoft(isDark);
  const danger = colors.danger;
  const [activeFilter, setActiveFilter] = useState('Все');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId || null);
  const { jobs } = useTryOnJobs();
  const historyCount = jobs.filter(job => job.itemIds.includes(detailId || '')).length;
  const detail = items.find(item => item.id === detailId);
  const { width, height } = useWindowDimensions();
  const columns = width >= 720 ? 3 : 2;

  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  // The smoothed card picture (garment-flat) and the cutout it replaces; the user may keep either.
  const [draftFlat, setDraftFlat] = useState<{ flat: string | null; cutout: string | null; busy: boolean }>({ flat: null, cutout: null, busy: false });
  const [draftSize, setDraftSize] = useState('');
  const [draftStore, setDraftStore] = useState('');
  const [draftMaterial, setDraftMaterial] = useState('');
  const [draftSection, setDraftSection] = useState(sectionOptions[0]);
  // The section as it is now, for a reading that arrives later (the flat picture's) than the render that asked for it.
  const draftSectionRef = useRef(draftSection);
  draftSectionRef.current = draftSection;
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftColorHex, setDraftColorHex] = useState('');
  const [draftPalette, setDraftPalette] = useState<string[]>([]);
  const [draftCategory, setDraftCategory] = useState(categoryOptions[0]);
  const [draftSeason, setDraftSeason] = useState(seasonOptions[0]);
  const [draftPattern, setDraftPattern] = useState(patternOptions[0]);
  const [isAnalyzing, setAnalyzing] = useState(false);
  const [isModalVisible, setModalVisible] = useState(false);
  const manualFields = useRef(new Set<string>());
  const [sourcePhoto, setSourcePhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AiResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [draftExistingId, setDraftExistingId] = useState<string | null>(null);
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  // The latest wardrobe, for answers that arrive after the screen moved on (the flat card picture).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // A flat picture still on its way when its item was saved: analysis request -> the saved item's id.
  // Editing or deleting that item before it arrives cancels it, so it never replaces a newer photo.
  const flatTargets = useRef(new Map<number, string>());
  const forgetFlat = (id: string) => { for (const [request, target] of flatTargets.current) if (target === id) flatTargets.current.delete(request); };
  const putFlat = (id: string, flat: string) => {
    const current = itemsRef.current;
    // A new card picture is read for its style vector again.
    if (current.some(item => item.id === id)) onItemsChange(current.map(item => item.id === id ? { ...item, imageUri: flat, styleVec: undefined } : item));
  };
  // Smoothing an item already in the wardrobe, from its card: the one in progress, and the picture
  // it replaced, which the card offers back until it is closed.
  const [flatBusyId, setFlatBusyId] = useState<string | null>(null);
  const [flatUndo, setFlatUndo] = useState<{ id: string; imageUri: string } | null>(null);
  const flattenExisting = async (item: WardrobeItem) => {
    const photo = item.sourceImageUri || item.imageUri;
    if (!photo || flatBusyId || !(await aiConsent.ensure())) return;
    setFlatBusyId(item.id);
    try {
      // Only the picture changes: what the item was saved as stays the person's.
      const flat = await flattenGarment(photo, item.section);
      if (item.imageUri) setFlatUndo({ id: item.id, imageUri: item.imageUri });
      forgetFlat(item.id);
      putFlat(item.id, flat.image);
    } catch (error: any) {
      Alert.alert(t('Не удалось выровнять фото'), String(error?.message || t('Попробуй ещё раз.')));
    } finally {
      setFlatBusyId(null);
    }
  };
  const closeDraft = () => { Keyboard.dismiss(); analysisRequestRef.current++; setAnalyzing(false); setModalVisible(false); setDraftFlat({ flat: null, cutout: null, busy: false }); };
  const manual = (field: string, setter: (value: string) => void) => (value: string) => {
    manualFields.current.add(field); setter(value);
  };
  // Счётчик текущего запроса AI-анализа: если пользователь пересняёт фото, пока
  // висит предыдущий запрос, устаревший ответ должен быть проигнорирован, а не
  // перезаписать уже новый черновик (см. аудит #34).
  const analysisRequestRef = useRef(0);

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState(categoryOptions[0]);
  const [editColor, setEditColor] = useState(colorOptions[0]);
  const [editSeason, setEditSeason] = useState(seasonOptions[0]);
  const [editPattern, setEditPattern] = useState(patternOptions[0]);
  const [editSection, setEditSection] = useState(sectionOptions[0]);
  const [editName, setEditName] = useState('');
  const [editSize, setEditSize] = useState('');
  const [editStore, setEditStore] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [isEditModalVisible, setEditModalVisible] = useState(false);

  // The draft's detailed fields stay folded under «Изменить» until asked for; opening them scrolls to the card.
  const [draftDetailsOpen, setDraftDetailsOpen] = useState(false);
  useEffect(() => { if (isModalVisible) setDraftDetailsOpen(false); }, [isModalVisible]);
  const draftScroll = useRef<ScrollView>(null);
  const draftCardY = useRef(0);
  useEffect(() => {
    if (!draftDetailsOpen) return;
    const timer = setTimeout(() => draftScroll.current?.scrollTo({ y: Math.max(0, draftCardY.current - 12), animated: !reduced }), 120);
    return () => clearTimeout(timer);
  }, [draftDetailsOpen]);
  const draftFloat = useFloat(reduced, isModalVisible);
  const detailFloat = useFloat(reduced, Boolean(detail));
  const draftStageHeight = Math.round(Math.min(460, Math.max(300, height * 0.5)));

  const filteredItems = useMemo(() => {
    if (activeFilter === 'Все') return items;
    return items.filter((item) => item.section === activeFilter);
  }, [items, activeFilter]);

  const { pickPhoto: requestPhoto, cropModal, isPicking } = usePhotoPicker();
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);
  const openPhotoSources = () => { if (!isPicking) { Keyboard.dismiss(); setPhotoSourceOpen(true); } };
  const showHelp = !helpOpen && !detailId && !isModalVisible && !isEditModalVisible && !isPicking && !photoSourceOpen && !searchFocused && !Alert.visible;

  const lastSource = useRef<PhotoSource>('gallery');
  const handleAddItem = async (source: PhotoSource) => {
    lastSource.current = source;
    const photo = await requestPhoto(source);
    if (!photo) return;
    setDraftPhoto(photo);
    setSourcePhoto(photo);
    setDraftExistingId(null);
    setDraftName('');
    setDraftColor('');
    setDraftColorHex('');
    setDraftPalette([]);
    setDraftCategory('');
    setDraftSeason('');
    setDraftPattern('');
    setDraftSize('');
    setDraftStore('');
    setDraftMaterial('');
    setDraftSection(activeFilter === 'Все' ? sectionOptions[0] : activeFilter);
    manualFields.current.clear();
    setCategoryConfirmed(false);
    setModalVisible(true);
    void applyAi(photo, activeFilter === 'Все' ? undefined : activeFilter);
  };

  // Пока человек не ввёл имя сам, поле показывает то, что определил анализ,
  // и меняется вместе с цветом, типом и узором.
  useEffect(() => {
    if (manualFields.current.has('name')) return;
    setDraftName(suggestItemName({ category: draftCategory, color: draftColor, pattern: draftPattern }));
  }, [draftCategory, draftColor, draftPattern]);

  const handleSaveItem = (addAnother = false) => {
    if (!draftPhoto || isAnalyzing || !draftCategory || !categoryConfirmed) return;
    const resolvedSection = draftSection || getSectionByCategory(draftCategory);
    // What the photo shows (sleeves, length, opening, bulk) stays with the item; a new photo without
    // a reading drops the old one, and the item is read again in the background (App).
    const existing = draftExistingId ? items.find(item => item.id === draftExistingId) : undefined;
    const traits = analysis?.traits ? decodeTraits(analysis.traits)
      : existing && existing.sourceImageUri === (sourcePhoto || draftPhoto) ? existing.traits : undefined;
    // The stylist's profile stays while the photo and the category do; otherwise it is read anew.
    const profile = existing && existing.sourceImageUri === (sourcePhoto || draftPhoto) && existing.category === draftCategory ? existing.profile : undefined;
    const styleVec = existing && existing.imageUri === draftPhoto && existing.category === draftCategory ? existing.styleVec : undefined;
    const newItem: WardrobeItem = {
      id: draftExistingId || Date.now().toString(),
      name: draftName.trim() || suggestItemName({ category: draftCategory, color: draftColor, pattern: draftPattern }) || t(draftCategory),
      category: draftCategory || 'Не определено',
      color: draftColor || 'Не определено',
      season: draftSeason || 'Не определено',
      pattern: draftPattern || 'Не определено',
      section: resolvedSection,
      tags: draftPalette.length ? draftPalette : [],
      imageUri: draftPhoto,
      sourceImageUri: sourcePhoto || draftPhoto,
      size: draftSize,
      store: draftStore,
      material: draftMaterial,
      traits,
      profile,
      styleVec
    };
    onItemsChange(draftExistingId ? items.map(item => item.id === draftExistingId ? { ...item, ...newItem } : item) : [newItem, ...items]);
    forgetFlat(newItem.id);
    // The category the photo was saved under, right or corrected, teaches the recognition (no photo is sent).
    if (analysis?.analysisId && draftCategory) sendCategoryFeedback(analysis.analysisId, draftCategory);
    // Saved before the flat picture came: it goes onto the card when it does, unless the cutout was picked over it.
    if (draftFlat.busy && draftPhoto === draftFlat.cutout) flatTargets.current.set(analysisRequestRef.current, newItem.id);
    closeDraft();
    // Гардероб обычно заполняют пачкой: сразу следующая вещь из того же источника.
    if (addAnother && !draftExistingId) setTimeout(() => { void handleAddItem(lastSource.current); }, 350);
  };

  const handleRetake = async () => {
      const photo = await requestPhoto();
    if (photo) {
      setDraftPhoto(photo);
      setSourcePhoto(photo);
      manualFields.current.clear();
      setDraftCategory(''); setDraftSeason(''); setDraftPattern(''); setDraftColor('');
      setDraftPalette([]); setDraftColorHex('');
      setCategoryConfirmed(false);
      void applyAi(photo);
    }
  };

  // Fills the draft from what recognition read, leaving alone every field the person set by hand.
  const applyReading = (result: FlatAnalysis) => {
    const hex = normalizeHex(result.dominantColor || '');
    const named = hex ? getClosestColorName(hex) : 'Не определено';
    if (!manualFields.current.has('color')) setDraftColor(hex ? named : '');
    if (!manualFields.current.has('color')) setDraftColorHex(hex);
    const normalizedPalette = (result.palette || []).map((color) => normalizeHex(color)).filter(Boolean);
    const paletteNames = normalizedPalette
      .map((color) => getClosestColorName(color))
      .filter((name) => name && name !== 'Не определено');
    const uniquePalette = Array.from(new Set(paletteNames)).slice(0, 5);
    if (!manualFields.current.has('color')) setDraftPalette(uniquePalette);
    const manualSection = manualFields.current.has('section') ? draftSectionRef.current : null;
    if (result.category && !manualFields.current.has('category')
      && categoryFitsSection(result.category, getSectionByCategory(result.category), manualSection)) {
      setDraftCategory(result.category);
      setCategoryConfirmed(!result.needsReview);
      if (!manualFields.current.has('section')) setDraftSection(getSectionByCategory(result.category));
    }
    if (result.season && !manualFields.current.has('season')) setDraftSeason(result.season);
    if (result.pattern && !manualFields.current.has('pattern')) setDraftPattern(result.pattern);
  };

  const applyAi = async (photoUri: string, sectionHint?: string) => {
    const requestId = ++analysisRequestRef.current;
    if (!(await aiConsent.ensure())) {
      if (analysisRequestRef.current === requestId) setAnalysisError(t('ИИ-анализ не запускался: нужно согласие на обработку фото. Заполни поля вручную или нажми «AI-анализ».'));
      return;
    }
    try {
      setAnalyzing(true);
      setAnalysis(null); setAnalysisError('');
      const result = await analyzeImage(photoUri, sectionHint);
      if (analysisRequestRef.current !== requestId) return; // ответ на уже неактуальное фото
      setAnalysis(result);
      applyReading(result);
      if (result.bgRemovedBase64) {
        setDraftPhoto(result.bgRemovedBase64);
      }
      // A smoothed, laid-flat picture for the card, in the background: wrinkles and a crooked shot look neat.
      // Only the card shows it; the try-on goes on using the original photo (sourceImageUri).
      if (result.category && FLAT_SECTIONS.includes(getSectionByCategory(result.category))) {
        const cutout = result.bgRemovedBase64 || photoUri;
        setDraftFlat({ flat: null, cutout, busy: true });
        flattenGarment(photoUri, sectionHint).then(flat => {
          // Saved already: only its picture changes, never what it was saved as.
          const saved = flatTargets.current.get(requestId);
          if (saved) { flatTargets.current.delete(requestId); putFlat(saved, flat.image); return; }
          if (analysisRequestRef.current !== requestId) return;
          setDraftFlat({ flat: flat.image, cutout, busy: false });
          setDraftPhoto(flat.image);
          // The flat and the photo read together are the surer reading; the analysis id stays the photo's.
          // The photo's own reasons for a review (a background it could not remove) and its colour, when the
          // flat has none, stay (domain/flatReading).
          if (flat.analysis) {
            const merged = mergeFlatReading(result, flat.analysis);
            setAnalysis(merged);
            applyReading(merged);
          }
        }).catch(() => { if (analysisRequestRef.current === requestId) setDraftFlat({ flat: null, cutout, busy: false }); });
      }
    } catch (error: any) {
      if (analysisRequestRef.current !== requestId) return;
      const message = String(error?.message || error || t('Неизвестная ошибка'));
      setAnalysisError(message);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!sourcePhoto) return;
    await applyAi(sourcePhoto, manualFields.current.has('section') ? draftSection : undefined);
  };

  const handleEditItem = useCallback((item: WardrobeItem) => {
    setEditItemId(item.id);
    setEditName(item.name || '');
    setEditCategory(item.category || categoryOptions[0]);
    setEditColor(item.color || colorOptions[0]);
    setEditSeason(item.season || seasonOptions[0]);
    setEditPattern(item.pattern || patternOptions[0]);
    setEditSection(item.section || sectionOptions[0]);
    setEditSize(item.size || '');
    setEditStore(item.store || '');
    setEditMaterial(item.material || '');
    setEditModalVisible(true);
  }, []);

  // The edit form differs from the saved piece: a stray tap over the studio must not throw the changes away.
  const editing = items.find(item => item.id === editItemId);
  const editDirty = Boolean(editing) && [
    [editName, editing?.name || ''], [editCategory, editing?.category || categoryOptions[0]], [editColor, editing?.color || colorOptions[0]],
    [editSeason, editing?.season || seasonOptions[0]], [editPattern, editing?.pattern || patternOptions[0]],
    [editSection, editing?.section || sectionOptions[0]], [editSize, editing?.size || ''], [editStore, editing?.store || ''],
    [editMaterial, editing?.material || '']
  ].some(([now, saved]) => now !== saved);

  const handleSaveEdit = () => {
    if (!editItemId) return;
    onItemsChange(
      items.map((item) =>
        item.id === editItemId
          ? {
              ...item,
              name: editName.trim() || item.name,
              category: editCategory,
              color: editColor,
              season: editSeason,
              pattern: editPattern,
              section: editSection,
              size: editSize,
              store: editStore,
              material: editMaterial
            }
          : item
      )
    );
    setEditModalVisible(false);
  };

  const handleDeleteItem = useCallback(
    (id: string) => {
      Alert.alert(t('Удалить вещь?'), t('Действие нельзя отменить.'), [
        { text: t('Отмена'), style: 'cancel' },
        {
          text: t('Удалить'),
          style: 'destructive',
          onPress: () => { forgetFlat(id); onItemsChange(items.filter((item) => item.id !== id)); setDetailId(null); }
        }
      ]);
    },
    [items, onItemsChange, t]
  );

  const handleRetakeExisting = async (id: string) => {
    const photo = await requestPhoto();
    if (!photo) return;
    const item = items.find(item => item.id === id);
    if (item) reanalyzeExisting(item, photo);
  };

  const reanalyzeExisting = (item: WardrobeItem, photo = item.sourceImageUri || item.imageUri) => {
    if (!photo) return;
    setDraftExistingId(item.id); setSourcePhoto(photo); setDraftPhoto(photo);
    setDraftName(item.name); setDraftSize(item.size || ''); setDraftStore(item.store || ''); setDraftMaterial(item.material || '');
    setDraftCategory(''); setDraftColor(''); setDraftSeason(''); setDraftPattern(''); setDraftPalette([]);
    setDraftSection(item.section); setCategoryConfirmed(false); manualFields.current.clear();
    // Имя, придуманное человеком, анализ не перезаписывает; автоимя обновится.
    if (!isAutoItemName(item.name, item.category)) manualFields.current.add('name');
    setModalVisible(true); void applyAi(photo);
  };

  const handleDraftCategoryChange = (value: string) => {
    manualFields.current.add('category');
    setCategoryConfirmed(true);
    setDraftCategory(value);
    setDraftSection(getSectionByCategory(value));
  };

  const handleDraftColorChange = (value: string) => {
    manualFields.current.add('color'); setDraftColor(value); setDraftPalette([value]);
    setDraftColorHex(namedColors.find(color => color.name === value)?.hex || '');
  };

  const handleEditCategoryChange = (value: string) => {
    setEditCategory(value);
    setEditSection(getSectionByCategory(value));
  };

  const renderChips = (options: string[], selected: string, onSelect: (value: string) => void) => options.length > 7 ? (
    <OptionPicker options={options} value={selected} onChange={onSelect} label={options === categoryOptions ? t('Тип вещи') : t('Цвет')} swatches={options === colorOptions ? Object.fromEntries(namedColors.map(color => [color.name, color.hex])) : undefined} />
  ) : (
    <View style={styles.choiceRow}>
      {options.map(option => <ChoicePill key={option} label={t(option)} active={option === selected} onPress={() => onSelect(option)} />)}
    </View>
  );

  const renderField = (label: string, control: ReactNode) => (
    <View style={styles.field}>
      <Text style={[font('medium'), styles.fieldLabel]}>{label}</Text>
      {control}
    </View>
  );

  // What the analysis read, set around the photo as glass tags; each keeps its own place.
  const draftSwatch = draftColorHex || namedColors.find(color => color.name === draftColor)?.hex;
  const draftTags = [
    { key: 'category', label: draftCategory ? t(draftCategory) : '', at: { left: 14, top: 0.15 } },
    { key: 'color', label: draftColor && draftColor !== 'Не определено' ? t(draftColor) : '', swatch: draftSwatch, at: { right: 14, top: 0.27 } },
    { key: 'material', label: draftMaterial.trim(), at: { left: 22, top: 0.53 } },
    { key: 'season', label: draftSeason && draftSeason !== 'Не определено' ? t(draftSeason) : '', at: { right: 26, top: 0.63 } }
  ];
  const saveDisabled = isAnalyzing || !draftCategory || !categoryConfirmed;
  const closeDetail = () => { setDetailId(null); setFlatUndo(null); };

  return (
    <View style={styles.container}>
      {!isModalVisible && cropModal}
      <PhotoSourcePicker visible={photoSourceOpen} onClose={() => setPhotoSourceOpen(false)} onSelect={source => void handleAddItem(source)} />
      {items.length ? (
        // The wardrobe as a studio: one piece at a time in the key light (components/studio/WardrobeStudio).
        <WardrobeStudio items={items} sections={sectionOptions} onOpen={item => setDetailId(item.id)} onAdd={openPhotoSources}
          addDisabled={isPicking || photoSourceOpen} onTryOn={onTryOn} onStyleWith={onStyleWith}
          onHelp={showHelp ? () => { Keyboard.dismiss(); setHelpOpen(true); } : undefined} />
      ) : (
      <View style={{ flex: 1 }}>
      <View style={styles.collectionHeader}>
        <View style={{ flex: 1 }}><ScreenHeader title={t('Гардероб')} /></View>
        <View style={styles.helpSlot}>
          {showHelp && <IconButton icon={CircleHelp} label={t('Открыть справку')} variant="quiet" onPress={() => { Keyboard.dismiss(); setHelpOpen(true); }} />}
        </View>
        <AppPressable accessibilityRole="button" accessibilityLabel={t('Добавить вещь')} disabled={isPicking || photoSourceOpen} haptics style={styles.addButton} onPress={openPhotoSources}>
          <Plus size={23} strokeWidth={1.6} color={colors.buttonPrimaryText} />
        </AppPressable>
      </View>
      <View style={styles.searchBar}>
        <Search size={18} color={colors.muted} strokeWidth={1.5} />
        <TextInput style={styles.searchInput} placeholder={t('Найти в гардеробе')} accessibilityLabel={t('Найти в гардеробе')}
          placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
          onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} />
        {search.length > 0 && <AppPressable accessibilityRole="button" accessibilityLabel={t('Очистить поиск')} onPress={() => setSearch('')} style={{ padding: 8 }}><X size={16} color={colors.muted} /></AppPressable>}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.filterRow, Platform.OS === 'android' && styles.filterRowAndroid]}
        style={styles.filterScroll}
      >
        {categoryFilters.map((filter) => (
          <Chip
            key={filter}
            label={t(filter)}
            active={filter === activeFilter}
            onPress={() => setActiveFilter(filter)}
          />
        ))}
      </ScrollView>

      <View style={styles.collectionMeta}>
        <Text style={styles.collectionCount}>{t('Вещей: {count}', { count: filteredItems.filter(item => `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).length })}</Text>
      </View>

      <FlatList
        key={columns}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        numColumns={columns}
        columnWrapperStyle={{ gap: 4 }}
        data={filteredItems.filter(item => `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.itemsWrap}
        // Рендерим только видимые карточки + небольшой запас — раньше ScrollView
        // держал в памяти и декодировал фото ВСЕХ вещей гардероба сразу.
        initialNumToRender={6}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index, 5) * 40} style={{ flex: 1, maxWidth: columns === 3 ? '32.6%' : '49.2%' }}>
            <GarmentTile item={item} onPress={() => setDetailId(item.id)} />
          </FadeInView>
        )}
        ListEmptyComponent={
          <EmptyState
            emoji="👗"
            title={t('Здесь пока пусто')}
            hint={
              items.length === 0
                ? t('Сфотографируй первую вещь — AI сам определит категорию, цвет и сезон.')
                : t('В этом разделе пока ничего нет. Попробуй другой фильтр.')
            }
            actionLabel={items.length === 0 ? t('Добавить вещь') : undefined}
            onAction={items.length === 0 ? openPhotoSources : undefined}
          />
        }
      />

      </View>
      )}

      {helpOpen && <ProductHelp onClose={() => setHelpOpen(false)} />}

      {/* The item's card: the piece floating in its own light, its label, what can be done with it. */}
      <StudioSheet visible={Boolean(detail)} onClose={closeDetail} height="92%">
        {detail ? <>
          {/* At night the piece's light is only a hint of its colour over the dark studio. */}
          <LinearGradient colors={isDark ? ['#2A2D32', `${studioTint(detail) || '#22252A'}33`] : ['#FFFFFF', studioTint(detail) || '#F0F0EE']}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[styles.detailStage, isDark && { backgroundColor: '#1C1F23' }]}>
            <View style={styles.detailFloor}><FloorShadow width={180} opacity={0.24} /></View>
            <Animated.View style={{ width: '100%', alignItems: 'center', transform: [{ translateY: detailFloat }] }}>
              <GarmentImage item={detail} print style={styles.detailGarment} />
            </Animated.View>
            <Pill icon={X} size="icon" style={styles.detailClose} onPress={closeDetail} accessibilityLabel={t('Закрыть')} />
          </LinearGradient>
          <Text style={[font('semibold'), styles.detailTitle, { color: ink }]}>{detail.name}</Text>
          {detail.imageUri && ['Верх', 'Низ', 'Обувь', 'Верхняя одежда'].includes(detail.section)
            ? <Pill variant="primary" title={t('Примерить на себе')} icon={PersonStanding} onPress={() => { setDetailId(null); onTryOn(detail); }} /> : null}
          {onStyleWith ? <Pill title={t('Подобрать образы с этой вещью')} icon={Layers} onPress={() => { setDetailId(null); onStyleWith(detail); }} /> : null}
          {/* The facts as on the label sewn into the garment; unknown ones are left out. */}
          <GarmentLabel rows={([['Категория', detail.category], ['Цвет', detail.color], ['Сезон', detail.season], ['Рисунок', detail.pattern]] as [string, string][])
            .map(([name, value]): [string, string] => [t(name), value && value !== 'Не определено' && !value.startsWith('#') ? t(value) : ''])
            .concat([[t('Размер'), detail.size || ''], [t('Материал'), detail.material || ''], [t('Магазин'), detail.store || '']])} />
          <View style={styles.detailActions}>
            {[
              { icon: Pencil, label: 'Изменить', onPress: () => { setDetailId(null); handleEditItem(detail); } },
              { icon: ScanLine, label: 'Распознать', a11y: 'Распознать вещь заново', onPress: () => { setDetailId(null); reanalyzeExisting(detail); } },
              { icon: ImagePlus, label: 'Новое фото', a11y: 'Заменить фото', onPress: () => { setDetailId(null); handleRetakeExisting(detail.id); } },
              { icon: Trash2, label: 'Удалить', danger: true, onPress: () => handleDeleteItem(detail.id) },
            ].map(({ icon: Icon, label, a11y, danger: isDanger, onPress }) => (
              <AppPressable key={label} haptics accessibilityRole="button" accessibilityLabel={t(a11y || label)} onPress={onPress} style={styles.detailAction}>
                <Glass>
                  <View style={styles.detailActionInner}>
                    <Icon size={17} strokeWidth={1.8} color={isDanger ? danger : ink} />
                    <Text style={[font('semibold'), styles.detailActionText, { color: isDanger ? danger : ink }]} numberOfLines={1}>{t(label)}</Text>
                  </View>
                </Glass>
              </AppPressable>
            ))}
          </View>
          {flatUndo?.id === detail.id ? (
            <Pill title={t('Вернуть прежнее фото')} icon={Undo2} onPress={() => { putFlat(detail.id, flatUndo.imageUri); setFlatUndo(null); }} />
          ) : (detail.sourceImageUri || detail.imageUri) && FLAT_SECTIONS.includes(detail.section) ? (
            <Pill title={t(flatBusyId === detail.id ? 'Выравниваем фото…' : 'Выровнять фото')} icon={Wand2}
              disabled={Boolean(flatBusyId)} onPress={() => { void flattenExisting(detail); }} />
          ) : null}
          {flatBusyId === detail.id ? <Text style={[font('regular'), styles.note]}>{t('Около 15 секунд. Для примерки останется исходное фото.')}</Text> : null}
          <AppPressable accessibilityRole="button" accessibilityLabel={t('История вещи: {count}', { count: historyCount })}
            onPress={() => { setDetailId(null); onOpenHistory(detail); }} style={{ borderRadius: 24 }}>
            <Glass radius={24}>
              <View style={styles.historyRow}>
                <History size={19} strokeWidth={1.7} color={ink} />
                <Text style={[font('medium'), styles.historyText, { color: ink }]}>{t('История примерок')}</Text>
                <Text style={[font('regular'), styles.historyCount]}>{historyCount}</Text>
                <ChevronRight size={18} color={INK_FAINT} />
              </View>
            </Glass>
          </AppPressable>
        </> : null}
      </StudioSheet>

      {/* Adding a piece (or reading it again): the photo in the studio light, a beam passing over it while it is
          read, what was found set around it, and below a glass card to name it and put it in the wardrobe. */}
      <Modal transparent animationType="slide" visible={isModalVisible} onRequestClose={closeDraft}>
        <SafeAreaProvider>
        <StudioBackdrop>
          <StudioTint color={studioTint({ color: draftColorHex || draftColor })} focusY={0.36} />
          <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <FormScrollView ref={draftScroll} contentContainerStyle={styles.draftContent}>
            <View style={styles.draftHeader}>
              <Pill icon={X} size="icon" onPress={closeDraft} accessibilityLabel={t('Закрыть')} />
              <Text style={[font('semibold'), styles.draftTitle, { color: ink }]} numberOfLines={1}>{t(draftExistingId ? 'Анализ вещи' : 'Новая вещь')}</Text>
              <Pill icon={SwitchCamera} size="icon" onPress={handleRetake} disabled={isPicking} accessibilityLabel={t('Заменить фото')} />
            </View>

            <View style={[styles.draftStage, { height: draftStageHeight }]}>
              {draftPhoto ? (
                <DraftPhoto uri={draftPhoto} float={draftFloat} maxWidth={Math.min(width * 0.7, 320)} maxHeight={draftStageHeight - 70} />
              ) : null}
              {isAnalyzing ? <ScanBeam height={draftStageHeight} reduced={reduced} /> : null}
              {!isAnalyzing ? draftTags.map(({ key, label, swatch, at }, slot) => label ? (
                <RevealTag key={`${key}:${label}`} label={label} swatch={swatch} delay={slot * 250} reduced={reduced} ink={ink}
                  style={{ left: at.left, right: at.right, top: Math.round(at.top * draftStageHeight) }} />
              ) : null) : null}
              {isAnalyzing ? (
                <Glass style={styles.draftStatus}>
                  <View accessibilityLiveRegion="polite" style={styles.draftStatusInner}>
                    <ActivityIndicator size="small" color={ink} />
                    <Text style={[font('semibold'), { fontSize: 13, color: ink }]}>{t('Распознаём вещь…')}</Text>
                  </View>
                </Glass>
              ) : null}
            </View>

            <View style={{ flex: 1 }} />
            <View onLayout={event => { draftCardY.current = event.nativeEvent.layout.y; }}>
              <Glass radius={30}>
                <View style={styles.draftCard}>
                  <View style={styles.nameRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[font('regular'), styles.nameLabel]}>{t('Название')}</Text>
                      <TextInput style={[font('semibold'), styles.nameInput, { color: ink }]} value={draftName}
                        placeholder={t('Например, Белая футболка')} placeholderTextColor={INK_FAINT} accessibilityLabel={t('Название вещи')}
                        // A textarea on the web is two rows high unless told otherwise; native grows with the text.
                        multiline numberOfLines={Platform.OS === 'web' ? 1 : undefined} scrollEnabled={false} maxLength={240} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={Keyboard.dismiss}
                        onChangeText={value => { manualFields.current.add('name'); setDraftName(value); }} />
                    </View>
                    {draftSection ? (
                      <View style={[styles.sectionBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.7)' }]}>
                        <Text style={[font('semibold'), { fontSize: 12, color: ink }]} numberOfLines={1}>{t(draftSection)}</Text>
                      </View>
                    ) : null}
                  </View>

                  {!isAnalyzing && analysisError ? (
                    <View style={styles.cardBlock}>
                      <Text style={[font('regular'), styles.note]}>{analysisError}</Text>
                      {sourcePhoto ? <Pill size="sm" icon={ScanLine} title={t('Распознать')} onPress={handleAnalyze} style={{ alignSelf: 'flex-start' }} /> : null}
                    </View>
                  ) : null}
                  {!isAnalyzing && analysis && !categoryConfirmed ? (
                    <View style={styles.cardBlock}>
                      <Text style={[font('semibold'), { fontSize: 14, color: ink }]}>{t('Подтверди тип вещи')}</Text>
                      {analysis.categoryCandidates?.length ? renderChips(analysis.categoryCandidates.map(candidate => candidate.category), '', handleDraftCategoryChange) : null}
                    </View>
                  ) : null}
                  {!isAnalyzing ? analysis?.warnings?.map(warning => <Text key={warning} style={[font('regular'), styles.note]}>{warning}</Text>) : null}

                  {/* The card picture: the smoothed one or the original cut-out. */}
                  {draftFlat.busy ? (
                    <View style={[styles.flatTrack, styles.flatBusy, { backgroundColor: colors.surface }]}>
                      <ActivityIndicator size="small" color={soft} />
                      <Text style={[font('medium'), styles.flatBusyText]}>{t('Выравниваем фото…')}</Text>
                    </View>
                  ) : draftFlat.flat && draftFlat.cutout ? (
                    <View accessibilityRole="tablist" style={[styles.flatTrack, { backgroundColor: colors.surface }]}>
                      {[[draftFlat.flat, 'Ровное фото'], [draftFlat.cutout, 'Исходное']].map(([uri, label]) => {
                        const on = draftPhoto === uri;
                        return (
                          <AppPressable key={label} haptics accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setDraftPhoto(uri)}
                            style={[styles.flatTab, on && [styles.flatTabOn, { backgroundColor: isDark ? '#3A3D42' : '#FFFFFF' }]]}>
                            {label === 'Ровное фото' ? <Wand2 size={15} strokeWidth={1.8} color={on ? ink : soft} /> : null}
                            <Text style={[font('semibold'), { fontSize: 13, color: on ? ink : soft }]} numberOfLines={1}>{t(label)}</Text>
                          </AppPressable>
                        );
                      })}
                    </View>
                  ) : null}

                  <View style={styles.draftActions}>
                    <Pill variant="primary" title={t(draftExistingId ? 'Сохранить' : 'В гардероб')} style={{ flex: 1 }}
                      onPress={() => handleSaveItem()} disabled={saveDisabled} />
                    <Pill title={t(draftDetailsOpen ? 'Свернуть' : 'Изменить')} onPress={() => { Keyboard.dismiss(); setDraftDetailsOpen(open => !open); }} />
                  </View>

                  {draftDetailsOpen ? (
                    <View style={styles.details}>
                      <Pill size="sm" icon={ScanLine} title={t('Распознать')} onPress={handleAnalyze} disabled={isAnalyzing || !sourcePhoto} style={{ alignSelf: 'flex-start' }} />
                      {renderField(t('Категория'), renderChips(categoryOptions, draftCategory, handleDraftCategoryChange))}
                      {renderField(t('Цвет'), renderChips(colorOptions, draftColor, handleDraftColorChange))}
                      {renderField(t('Сезон'), renderChips(seasonOptions, draftSeason, manual('season', setDraftSeason)))}
                      {renderField(t('Паттерн'), renderChips(patternOptions, draftPattern, manual('pattern', setDraftPattern)))}
                      {renderField(t('Раздел'), renderChips(sectionOptions, draftSection, manual('section', setDraftSection)))}
                      {renderField(t('Размер'), <AtelierInput placeholder={t('Например, M')} value={draftSize} onChangeText={setDraftSize} />)}
                      {renderField(t('Бренд / магазин'), <AtelierInput placeholder={t('Например, Zara')} value={draftStore} onChangeText={setDraftStore} />)}
                      {renderField(t('Материал'), <AtelierInput placeholder={t('Например, хлопок')} value={draftMaterial} onChangeText={setDraftMaterial} />)}
                      {!draftExistingId ? <Pill title={t('Сохранить и добавить ещё')} icon={Plus} onPress={() => handleSaveItem(true)} disabled={saveDisabled} style={{ marginTop: 6 }} /> : null}
                    </View>
                  ) : null}
                </View>
              </Glass>
            </View>
          </FormScrollView>
          </SafeAreaView>
          {isModalVisible && cropModal}
        </StudioBackdrop>
        </SafeAreaProvider>
        <OverlayOutlet />
      </Modal>

      <StudioSheet visible={isEditModalVisible} onClose={() => setEditModalVisible(false)} title={t('Редактировать параметры')} height="88%"
        dismissOnBackdrop={!editDirty}>
        {renderField(t('Название вещи'), <AtelierInput placeholder={t('Например, Белая футболка')} value={editName} onChangeText={setEditName} />)}
        {renderField(t('Категория'), renderChips(categoryOptions, editCategory, handleEditCategoryChange))}
        {renderField(t('Цвет'), renderChips(colorOptions, editColor, setEditColor))}
        {renderField(t('Сезон'), renderChips(seasonOptions, editSeason, setEditSeason))}
        {renderField(t('Паттерн'), renderChips(patternOptions, editPattern, setEditPattern))}
        {renderField(t('Раздел'), renderChips(sectionOptions, editSection, setEditSection))}
        {renderField(t('Размер'), <AtelierInput placeholder={t('Например, M')} value={editSize} onChangeText={setEditSize} />)}
        {renderField(t('Бренд / магазин'), <AtelierInput placeholder={t('Например, Zara')} value={editStore} onChangeText={setEditStore} />)}
        {renderField(t('Материал'), <AtelierInput placeholder={t('Например, хлопок')} value={editMaterial} onChangeText={setEditMaterial} />)}
        <View style={styles.draftActions}>
          <Pill variant="primary" title={t('Сохранить')} style={{ flex: 1 }} onPress={handleSaveEdit} />
          <Pill title={t('Отмена')} onPress={() => setEditModalVisible(false)} />
        </View>
      </StudioSheet>
    </View>
  );
}

/** The piece floats a little in its light while shown; still when motion is reduced. */
function useFloat(reduced: boolean, active: boolean) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    float.setValue(0);
    if (reduced || !active) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, active, float]);
  return float.interpolate({ inputRange: [0, 1], outputRange: [0, -9] });
}

/** Lights the draft's own studio in the colour read from the photo. */
function StudioTint({ color, focusY }: { color: string | null; focusY: number }) {
  useStudioTint(color, focusY);
  return null;
}

/** The photo being read: a band of light with a bright line passes down over it; held still when motion is reduced. */
function ScanBeam({ height, reduced }: { height: number; reduced: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);
  const motion = reduced ? { transform: [{ translateY: height * 0.3 }] } : {
    opacity: sweep.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
    transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, height - 50] }) }]
  };
  return (
    <Animated.View pointerEvents="none" style={[stageStyles.beam, motion]}>
      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']} style={stageStyles.beamBand} />
      <View style={stageStyles.beamLine} />
    </Animated.View>
  );
}

/** One thing the analysis found, set beside the photo: it rises into place after the ones before it. */
function RevealTag({ label, swatch, delay, reduced, ink, style }: { label: string; swatch?: string; delay: number; reduced: boolean; ink: string;
  style: { left?: number; right?: number; top: number } }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { shown.setValue(1); return; }
    Animated.timing(shown, { toValue: 1, duration: 600, delay, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={[stageStyles.tag, style, { opacity: shown, transform: [
      { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
      { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
      <Glass>
        <View style={[stageStyles.tagInner, swatch ? { paddingLeft: 8 } : null]}>
          {swatch ? <View style={[stageStyles.tagSwatch, { backgroundColor: swatch }]} /> : null}
          <Text style={[font('semibold'), stageStyles.tagText, { color: ink }]} numberOfLines={1}>{label}</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

/** The draft photo at its own proportions: a cut-out stands bare, a photo with its ground as a rounded print. */
function DraftPhoto({ uri, maxWidth, maxHeight, float }: { uri: string; maxWidth: number; maxHeight: number; float: Animated.AnimatedInterpolation<number> }) {
  const [ratio, setRatio] = useState(0.8);
  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (w, h) => { if (alive && w > 0 && h > 0) setRatio(w / h); }, () => {});
    return () => { alive = false; };
  }, [uri]);
  const width = Math.min(maxWidth, maxHeight * ratio);
  const cutout = isCutout(uri);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.Image source={{ uri }} resizeMode={cutout ? 'contain' : 'cover'}
        style={{ width, height: width / ratio, borderRadius: cutout ? 0 : 28, transform: [{ translateY: float }] }} />
      <View style={{ marginTop: -10 }}><FloorShadow width={width * 0.7} opacity={0.22} /></View>
    </View>
  );
}

const stageStyles = StyleSheet.create({
  beam: { position: 'absolute', left: 0, right: 0, top: 0, height: 70 },
  beamBand: { position: 'absolute', left: 30, right: 30, top: 0, height: 70 },
  beamLine: { position: 'absolute', left: 40, right: 40, top: 34, height: 1.5, backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  tag: { position: 'absolute', maxWidth: '50%' },
  tagInner: { height: 34, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(18,20,23,0.2)' },
  tagText: { fontSize: 13, flexShrink: 1 }
});

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center'
  },
  collectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpSlot: { width: 44, height: 44, marginBottom: 18, zIndex: 3 },
  addButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.buttonPrimaryBg, marginBottom: 18, ...SHADOWS.button },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 4, backgroundColor: c.surface, paddingHorizontal: 14, height: 46, marginBottom: 16 },
  searchInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 14, height: '100%' },
  collectionMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 12 },
  collectionCount: { color: c.muted, fontSize: 13 },
  filterRow: { paddingBottom: 6, marginBottom: 0, paddingRight: 12 },
  filterRowAndroid: { paddingBottom: 6, marginBottom: 0 },
  filterScroll: { minHeight: 40, maxHeight: 40 },
  itemsWrap: { gap: 24, paddingBottom: 24 },

  // The item's card
  detailStage: { height: 340, borderRadius: 30, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  detailGarment: { width: '100%', height: 270 },
  detailFloor: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  detailClose: { position: 'absolute', top: 12, right: 12 },
  detailTitle: { fontSize: 26, lineHeight: 32, letterSpacing: -0.6, marginTop: 4 },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailAction: { flexGrow: 1, flexBasis: '46%', borderRadius: 999 },
  detailActionInner: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  detailActionText: { fontSize: 14 },
  historyRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  historyText: { flex: 1, fontSize: 15 },
  historyCount: { fontSize: 13, color: c.muted },
  note: { fontSize: 13, lineHeight: 18, color: c.muted },

  // Adding a piece
  draftContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4 },
  draftTitle: { flex: 1, textAlign: 'center', fontSize: 15 },
  draftStage: { marginTop: 12, marginHorizontal: -16, paddingTop: 30, alignItems: 'center', overflow: 'hidden' },
  draftStatus: { position: 'absolute', bottom: 6, alignSelf: 'center' },
  draftStatusInner: { height: 38, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftCard: { padding: 16, gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  nameLabel: { fontSize: 12, color: c.muted },
  nameInput: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5, marginTop: 2, padding: 0, minHeight: 30, textAlignVertical: 'top' },
  sectionBadge: { marginTop: 4, height: 30, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', maxWidth: 140 },
  cardBlock: { gap: 10 },
  flatTrack: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  flatBusy: { height: 40, alignItems: 'center', justifyContent: 'center', gap: 8 },
  flatBusyText: { fontSize: 13, color: c.muted },
  flatTab: { flex: 1, height: 34, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  flatTabOn: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  draftActions: { flexDirection: 'row', gap: 8 },
  details: { gap: 4, paddingTop: 6 },

  // Fields, in the draft and in editing
  field: { gap: 8, marginTop: 10 },
  fieldLabel: { fontSize: 13, color: c.muted },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalInput: {
    ...font('regular'),
    backgroundColor: c.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 15,
    color: c.text
  },
  modalInputFocused: {
    borderColor: c.muted
  }
});
