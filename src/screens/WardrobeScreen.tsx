import {
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
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { usePhotoPicker } from '../components/usePhotoPicker';
import { PhotoSourcePicker, PhotoSource } from '../components/PhotoSourcePicker';
import { useAppDialog } from '../components/AppDialog';
import { FormScrollView } from '../components/ui/FormScrollView';
import { OptionPicker } from '../components/ui/OptionPicker';
import { Chip } from '../components/Chip';
import { AppPressable } from '../components/AppPressable';
import { DragHandle } from '../components/DragHandle';
import { isAutoItemName, suggestItemName } from '../domain/itemName';
import { useAiConsent } from '../components/AiConsentContext';
import { OverlayOutlet } from '../components/OverlayHost';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SectionLabel } from '../components/ui/SectionLabel';
import { EmptyState } from '../components/ui/EmptyState';
import { FadeInView } from '../components/ui/FadeInView';
import { Skeleton } from '../components/ui/Skeleton';
import { ProgressGlow } from '../components/ui/ProgressGlow';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { RADII, SERIF, SHADOWS, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { analyzeImage, AiResult } from '../services/ai';
import { ImagePlus, Pencil, Plus, Search, Trash2, X, ArrowUpRight, ScanLine, CircleHelp, History, ChevronRight, Sparkles } from 'lucide-react-native';
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

const sectionOptions = ['Верх', 'Низ', 'Обувь', 'Сумки', 'Верхняя одежда'];
const categoryFilters = ['Все', ...sectionOptions];

// Эмодзи-иконки фильтров (не переводятся).
const filterIcons: Record<string, string> = {
  Все: '✨',
  Верх: '👕',
  Низ: '👖',
  Обувь: '👟',
  Сумки: '👜',
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
  'Клатч'
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
  Клатч: 'Сумки'
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

export function WardrobeScreen({ items, onItemsChange, onTryOn, onOpenHistory, onStyleWith, initialDetailId }: WardrobeScreenProps) {
  const Alert = useAppDialog();
  const aiConsent = useAiConsent();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors } = useTheme();
  const [activeFilter, setActiveFilter] = useState('Все');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId || null);
  const { jobs } = useTryOnJobs();
  const historyCount = jobs.filter(job => job.itemIds.includes(detailId || '')).length;
  const detail = items.find(item => item.id === detailId);
  const { width } = useWindowDimensions();
  const columns = width >= 720 ? 3 : 2;

  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState('');
  const [draftStore, setDraftStore] = useState('');
  const [draftMaterial, setDraftMaterial] = useState('');
  const [draftSection, setDraftSection] = useState(sectionOptions[0]);
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
  const closeDraft = () => { Keyboard.dismiss(); analysisRequestRef.current++; setAnalyzing(false); setModalVisible(false); };
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
      material: draftMaterial
    };
    onItemsChange(draftExistingId ? items.map(item => item.id === draftExistingId ? { ...item, ...newItem } : item) : [newItem, ...items]);
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
      const hex = normalizeHex(result.dominantColor || '');
      const named = hex ? getClosestColorName(hex) : 'Не определено';
      if (!manualFields.current.has('color')) setDraftColor(hex ? named : '');
      setDraftColorHex(hex);
      const normalizedPalette = (result.palette || []).map((color) => normalizeHex(color)).filter(Boolean);
      const paletteNames = normalizedPalette
        .map((color) => getClosestColorName(color))
        .filter((name) => name && name !== 'Не определено');
      const uniquePalette = Array.from(new Set(paletteNames)).slice(0, 5);
      if (!manualFields.current.has('color')) setDraftPalette(uniquePalette);
      if (result.category && !manualFields.current.has('category')) {
        setDraftCategory(result.category);
        setCategoryConfirmed(!result.needsReview);
        if (!manualFields.current.has('section')) setDraftSection(getSectionByCategory(result.category));
      }
      if (result.season && !manualFields.current.has('season')) setDraftSeason(result.season);
      if (result.pattern && !manualFields.current.has('pattern')) setDraftPattern(result.pattern);
      if (result.bgRemovedBase64) {
        setDraftPhoto(result.bgRemovedBase64);
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
          onPress: () => { onItemsChange(items.filter((item) => item.id !== id)); setDetailId(null); }
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
    <View style={[styles.modalChipsRow, { flexDirection: 'row', flexWrap: 'wrap' }]}>
      {options.map((option) => {
        const isActive = option === selected;
        return (
          <AppPressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            haptics
            style={[styles.modalChip, isActive && styles.modalChipActive]}
            onPress={() => onSelect(option)}
          >
            {namedColors.some(color => color.name === option) && <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: namedColors.find(color => color.name === option)?.hex }} />}
            <Text style={[styles.modalChipText, isActive && styles.modalChipTextActive]}>{t(option)}</Text>
          </AppPressable>
        );
      })}
    </View>
  );

  const renderFieldLabel = (label: string) => (
    <View style={styles.fieldLabelWrap}>
      <SectionLabel>{label}</SectionLabel>
    </View>
  );

  return (
    <View style={styles.container}>
      {!isModalVisible && cropModal}
      <PhotoSourcePicker visible={photoSourceOpen} onClose={() => setPhotoSourceOpen(false)} onSelect={source => void handleAddItem(source)} />
      <View style={styles.collectionHeader}>
        <View style={{ flex: 1 }}><ScreenHeader eyebrow={t('Личная коллекция')} title={t('Гардероб')} /></View>
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
        <Text style={styles.collectionLabel}>{t(activeFilter === 'Все' ? 'Все вещи' : activeFilter)}</Text>
        <Text style={styles.collectionCount}>{filteredItems.filter(item => `${item.name} ${item.category} ${item.color}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).length}</Text>
      </View>

      <FlatList
        key={columns}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        numColumns={columns}
        columnWrapperStyle={{ gap: 14 }}
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
          <FadeInView delay={Math.min(index, 5) * 40} style={{ flex: 1, maxWidth: columns === 3 ? '32%' : '48.2%' }}>
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

      {helpOpen && <ProductHelp onClose={() => setHelpOpen(false)} />}

      <Modal transparent animationType="slide" visible={Boolean(detail)} onRequestClose={() => setDetailId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.detailSheet}>
            <View style={styles.detailToolbar}>
              <Text style={styles.collectionLabel}>{t('Детали вещи')}</Text>
              <IconButton icon={X} label={t('Закрыть')} onPress={() => setDetailId(null)} />
            </View>
            {detail && <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
              {detail.imageUri && <Image source={{ uri: detail.imageUri }} style={styles.detailPhoto} resizeMode="contain" />}
              <View style={{ gap: 6 }}>
                <Text style={styles.detailTitle}>{detail.name}</Text>
                <Text style={styles.detailMeta}>{[detail.category, detail.color, detail.season, detail.pattern].filter(Boolean).map(value => t(value)).join(' · ')}</Text>
                {(detail.size || detail.store || detail.material) && <Text style={styles.detailMeta}>{[detail.size, detail.store, detail.material].filter(Boolean).join(' · ')}</Text>}
              </View>
              {/* Four labelled actions instead of an edit link and three bare icons. */}
              <View style={styles.detailActions}>
                {[
                  { icon: Pencil, label: 'Изменить', onPress: () => { setDetailId(null); handleEditItem(detail); } },
                  { icon: ScanLine, label: 'AI-анализ', a11y: 'Повторить анализ', onPress: () => { setDetailId(null); reanalyzeExisting(detail); } },
                  { icon: ImagePlus, label: 'Новое фото', a11y: 'Заменить фото', onPress: () => { setDetailId(null); handleRetakeExisting(detail.id); } },
                  { icon: Trash2, label: 'Удалить', danger: true, onPress: () => handleDeleteItem(detail.id) },
                ].map(({ icon: Icon, label, a11y, danger, onPress }) => (
                  <AppPressable key={label} haptics accessibilityRole="button" accessibilityLabel={t(a11y || label)} onPress={onPress}
                    style={[styles.detailAction, danger && { borderColor: colors.dangerSoft, backgroundColor: colors.dangerSoft }]}>
                    <Icon size={18} color={danger ? colors.danger : colors.text} strokeWidth={1.7} />
                    <Text style={[styles.detailActionText, danger && { color: colors.danger }]} numberOfLines={1}>{t(label)}</Text>
                  </AppPressable>
                ))}
              </View>
              {detail.imageUri && ['Верх', 'Низ', 'Обувь', 'Верхняя одежда'].includes(detail.section) && <PrimaryButton title={t('Примерить на себе')} icon={ArrowUpRight} onPress={() => { setDetailId(null); onTryOn(detail); }} />}
              {onStyleWith ? <PrimaryButton title={t('Подобрать образы с этой вещью')} icon={Sparkles} variant="ghost" onPress={() => { setDetailId(null); onStyleWith(detail); }} /> : null}
              <AppPressable accessibilityRole="button" accessibilityLabel={t('История вещи: {count}', { count: historyCount })}
                style={[styles.detailToolbar, { minHeight: 52, gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }]}
                onPress={() => { setDetailId(null); onOpenHistory(detail); }}>
                <History size={20} color={colors.accentGold} />
                <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>{t('История примерок')}</Text>
                <Text style={styles.detailMeta}>{historyCount}</Text><ChevronRight size={18} color={colors.muted} />
              </AppPressable>
            </ScrollView>}
          </View>
        </View>
        <OverlayOutlet />
      </Modal>

      <Modal transparent animationType="slide" visible={isModalVisible} onRequestClose={closeDraft}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <DragHandle onDismiss={closeDraft} />
            <View style={{ flex: 1 }}>
              <FormScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalTitle}>{t(draftExistingId ? 'Анализ вещи' : 'Новая вещь')}</Text>
                {draftPhoto ? (
                  <View style={styles.modalPhotoFrame}>
                    <Image source={{ uri: draftPhoto }} style={styles.modalPhoto} resizeMode="contain" />
                  </View>
                ) : null}
                {isAnalyzing ? (
                  <View style={styles.progressWrap}>
                    <ProgressGlow visible />
                  </View>
                ) : null}
                <AppPressable haptics style={styles.retakePill} onPress={handleRetake}>
                  <Text style={styles.retakePillText}>{t('Заменить фото')}</Text>
                </AppPressable>
                {renderFieldLabel(t('Название вещи'))}
                <AtelierInput
                  placeholder={t('Например, Белая футболка')}
                  value={draftName}
                  onChangeText={value => { manualFields.current.add('name'); setDraftName(value); }}
                />
                <PrimaryButton
                  title={t('AI-анализ')}
                  onPress={handleAnalyze}
                  loading={isAnalyzing}
                  style={styles.aiButton}
                />
                {isAnalyzing ? (
                  <View style={styles.aiStatus}>
                    <Text style={styles.aiStatusText}>{t('AI изучает вещь…')}</Text>
                    <Skeleton width={150} height={11} />
                    <Skeleton width={210} height={11} />
                  </View>
                ) : draftColor ? (
                  <Text style={styles.aiHint}>{t('Цвет: {color}', { color: t(draftColor) })}</Text>
                ) : null}
                {!isAnalyzing && analysisError ? <Text style={styles.aiHint}>{analysisError}</Text> : null}
                {!isAnalyzing && analysis && <View style={{ gap: 10 }}>
                  <Text style={styles.aiStatusText}>{t(categoryConfirmed ? 'Вещь распознана' : 'Подтверди тип вещи')}</Text>
                  {analysis.categoryCandidates?.length ? renderChips(analysis.categoryCandidates.map(candidate => candidate.category), categoryConfirmed ? draftCategory : '', handleDraftCategoryChange) : null}
                  {analysis.warnings?.map(warning => <Text key={warning} style={styles.aiHint}>{warning}</Text>)}
                </View>}
                {renderFieldLabel(t('Категория'))}
                {renderChips(categoryOptions, draftCategory, handleDraftCategoryChange)}
                {renderFieldLabel(t('Цвет'))}
                {renderChips(colorOptions, draftColor, handleDraftColorChange)}
                {renderFieldLabel(t('Сезон'))}
                {renderChips(seasonOptions, draftSeason, manual('season', setDraftSeason))}
                {renderFieldLabel(t('Паттерн'))}
                {renderChips(patternOptions, draftPattern, manual('pattern', setDraftPattern))}
                {renderFieldLabel(t('Раздел'))}
                {renderChips(sectionOptions, draftSection, manual('section', setDraftSection))}
                {renderFieldLabel(t('Размер'))}
                <AtelierInput placeholder={t('Например, M')} value={draftSize} onChangeText={setDraftSize} />
                {renderFieldLabel(t('Бренд / магазин'))}
                <AtelierInput placeholder={t('Например, Zara')} value={draftStore} onChangeText={setDraftStore} />
                {renderFieldLabel(t('Материал'))}
                <AtelierInput
                  placeholder={t('Например, хлопок')}
                  value={draftMaterial}
                  onChangeText={setDraftMaterial}
                />
                <View style={styles.modalActions}>
                  <PrimaryButton
                    title={t('Сохранить')}
                    onPress={() => handleSaveItem()}
                    variant="gold"
                    size="lg"
                    disabled={isAnalyzing || !draftCategory || !categoryConfirmed}
                  />
                  {!draftExistingId ? <PrimaryButton
                    title={t('Сохранить и добавить ещё')}
                    onPress={() => handleSaveItem(true)}
                    variant="primary"
                    disabled={isAnalyzing || !draftCategory || !categoryConfirmed}
                  /> : null}
                  <PrimaryButton title={t('Отмена')} onPress={closeDraft} variant="ghost" />
                </View>
              </FormScrollView>
            </View>
            {isModalVisible && cropModal}
          </View>
        </View>
        <OverlayOutlet />
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={isEditModalVisible}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <DragHandle onDismiss={() => setEditModalVisible(false)} />
            <View style={{ flex: 1 }}>
              <FormScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalTitle}>{t('Редактировать параметры')}</Text>
                {renderFieldLabel(t('Название вещи'))}
                <AtelierInput
                  placeholder={t('Например, Белая футболка')}
                  value={editName}
                  onChangeText={setEditName}
                />
                {renderFieldLabel(t('Категория'))}
                {renderChips(categoryOptions, editCategory, handleEditCategoryChange)}
                {renderFieldLabel(t('Цвет'))}
                {renderChips(colorOptions, editColor, setEditColor)}
                {renderFieldLabel(t('Сезон'))}
                {renderChips(seasonOptions, editSeason, setEditSeason)}
                {renderFieldLabel(t('Паттерн'))}
                {renderChips(patternOptions, editPattern, setEditPattern)}
                {renderFieldLabel(t('Раздел'))}
                {renderChips(sectionOptions, editSection, setEditSection)}
                {renderFieldLabel(t('Размер'))}
                <AtelierInput placeholder={t('Например, M')} value={editSize} onChangeText={setEditSize} />
                {renderFieldLabel(t('Бренд / магазин'))}
                <AtelierInput placeholder={t('Например, Zara')} value={editStore} onChangeText={setEditStore} />
                {renderFieldLabel(t('Материал'))}
                <AtelierInput
                  placeholder={t('Например, хлопок')}
                  value={editMaterial}
                  onChangeText={setEditMaterial}
                />
                <View style={styles.modalActions}>
                  <PrimaryButton title={t('Сохранить')} onPress={handleSaveEdit} variant="gold" size="lg" />
                  <PrimaryButton title={t('Отмена')} onPress={() => setEditModalVisible(false)} variant="ghost" />
                </View>
              </FormScrollView>
            </View>
          </View>
        </View>
        <OverlayOutlet />
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center'
  },
  collectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpSlot: { width: 44, height: 44, marginBottom: 18, zIndex: 3 },
  addButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: c.buttonPrimaryBg, marginBottom: 18 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, backgroundColor: c.surface, paddingHorizontal: 14, height: 46, marginBottom: 16 },
  searchInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 14, height: '100%' },
  collectionMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 16 },
  collectionLabel: { color: c.text, fontSize: 14, fontWeight: '600' },
  collectionCount: { color: c.muted, fontSize: 12 },
  detailSheet: { backgroundColor: c.card, height: '90%', maxWidth: 600, width: '100%', alignSelf: 'center', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  detailToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  detailPhoto: { width: '100%', height: 300, borderRadius: 8, backgroundColor: c.surface },
  detailTitle: { fontFamily: SERIF, fontSize: 26, color: c.text },
  detailMeta: { color: c.muted, fontSize: 13, lineHeight: 21 },
  detailActions: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  detailAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  detailActionText: { fontSize: 12, fontWeight: '600', color: c.text },
  filterRow: {
    paddingBottom: 6,
    marginBottom: 0,
    paddingRight: 12
  },
  filterRowAndroid: {
    paddingBottom: 6,
    marginBottom: 0
  },
  filterScroll: {
    minHeight: 40,
    maxHeight: 40
  },
  uploadCard: {
    backgroundColor: c.card,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: c.goldHairline,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 14,
    ...SHADOWS.card
  },
  uploadGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: RADII.xl - 1,
    pointerEvents: 'none'
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  uploadPlusCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center'
  },
  uploadPlus: {
    color: c.textOnGold,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '600'
  },
  uploadTextBlock: {
    flex: 1,
    gap: 3
  },
  uploadTitle: {
    fontFamily: SERIF,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0,
    color: c.text
  },
  uploadText: {
    ...TYPE.caption,
    color: c.muted
  },
  itemsWrap: {
    gap: 24,
    paddingBottom: 24
  },
  itemCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADII.lg,
    padding: 16,
    gap: 10,
    ...SHADOWS.card
  },
  photoBlock: {
    gap: 10
  },
  photoFrame: {
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: c.goldHairline,
    backgroundColor: c.surface,
    overflow: 'hidden'
  },
  photo: {
    width: '100%',
    height: 190
  },
  photoActions: {
    flexDirection: 'row',
    gap: 8
  },
  retakeButton: {
    alignSelf: 'flex-start',
    backgroundColor: c.chip,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  retakeText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text
  },
  deleteButton: {
    alignSelf: 'flex-start',
    backgroundColor: c.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  deleteText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.danger
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  itemName: {
    flex: 1,
    fontFamily: SERIF,
    color: c.text,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0
  },
  editButton: {
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  editButtonText: {
    color: c.accentGold,
    fontSize: 12,
    fontWeight: '700'
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  colorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6,
    borderWidth: 1,
    borderColor: c.goldHairline
  },
  cardFooterActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text
  },
  itemDetails: {
    ...TYPE.caption,
    color: c.muted
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  tag: {
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  tagText: {
    fontSize: 11.5,
    color: c.muted
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: c.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: c.goldHairline,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    height: '85%'
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.border,
    marginBottom: 12
  },
  modalContent: {
    paddingBottom: 24
  },
  modalTitle: {
    fontFamily: SERIF,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0,
    color: c.text,
    marginBottom: 14
  },
  modalPhotoFrame: {
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: c.goldHairline,
    backgroundColor: c.surface,
    overflow: 'hidden'
  },
  modalPhoto: {
    width: '100%',
    height: 210
  },
  progressWrap: {
    marginTop: 12
  },
  retakePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 12
  },
  retakePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.accentGold
  },
  fieldLabelWrap: {
    marginTop: 18
  },
  modalInput: {
    backgroundColor: c.surface,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text
  },
  modalInputFocused: {
    borderColor: c.accentGold,
    backgroundColor: c.card
  },
  aiButton: {
    marginTop: 16
  },
  aiStatus: {
    marginTop: 12,
    gap: 8
  },
  aiStatusText: {
    ...TYPE.caption,
    color: c.muted
  },
  aiHint: {
    ...TYPE.caption,
    color: c.accentGold,
    marginTop: 10
  },
  // Equal spacing between the save, save-and-add and cancel buttons.
  modalActions: {
    marginTop: 24,
    gap: 10
  },
  modalChipsRow: {
    gap: 8,
    paddingBottom: 6
  },
  modalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8
  },
  modalChipActive: {
    backgroundColor: c.accentGoldSoft,
    borderColor: c.goldHairline
  },
  modalChipText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600'
  },
  modalChipTextActive: {
    color: c.accentGold,
    fontWeight: '700'
  }
});
