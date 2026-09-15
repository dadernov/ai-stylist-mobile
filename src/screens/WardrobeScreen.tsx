import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Chip } from '../components/Chip';
import { AppPressable } from '../components/AppPressable';
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
import { analyzeImage } from '../services/ai';

type WardrobeScreenProps = {
  items: WardrobeItem[];
  onItemsChange: (items: WardrobeItem[]) => void;
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
const patternOptions = ['Клетка', 'Полоска', 'Горох', 'Цветочный', 'Однотонный'];

type CropPreset = {
  key: string;
  label: string;
  allowsEditing: boolean;
  aspect?: [number, number];
};

const cropPresets: CropPreset[] = [
  { key: 'nocrop', label: 'Без обрезки (оригинал)', allowsEditing: false },
  { key: 'portrait', label: 'Портрет 3:4 (для человека)', allowsEditing: true, aspect: [3, 4] },
  { key: 'garment', label: 'Вещь 4:5 (для одежды)', allowsEditing: true, aspect: [4, 5] },
  { key: 'square', label: 'Квадрат 1:1', allowsEditing: true, aspect: [1, 1] }
];

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
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export function WardrobeScreen({ items, onItemsChange }: WardrobeScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors } = useTheme();
  const [activeFilter, setActiveFilter] = useState('Все');

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
  const [hasManualDraftCategory, setHasManualDraftCategory] = useState(false);
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

  const chooseCropPreset = () =>
    new Promise<CropPreset | null>((resolve) => {
      Alert.alert(t('Кадрирование'), t('Выбери форму выделенной области.'), [
        ...cropPresets.map((preset) => ({ text: t(preset.label), onPress: () => resolve(preset) })),
        { text: t('Отмена'), style: 'cancel', onPress: () => resolve(null) }
      ]);
    });

  const requestCamera = async (preset: CropPreset) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('Нужен доступ к камере'), t('Разреши доступ, чтобы сфотографировать вещь.'));
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: preset.allowsEditing,
      aspect: preset.aspect,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });

    if (result.canceled) return null;
    return result.assets[0]?.uri ?? null;
  };

  const requestGallery = async (preset: CropPreset) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('Нужен доступ к галерее'), t('Разреши доступ, чтобы выбрать фото вещи.'));
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: preset.allowsEditing,
      aspect: preset.aspect,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });

    if (result.canceled) return null;
    return result.assets[0]?.uri ?? null;
  };

  const choosePhotoSource = () =>
    new Promise<'camera' | 'gallery' | null>((resolve) => {
      Alert.alert(t('Источник фото'), t('Откуда загрузить фото вещи?'), [
        { text: t('Камера'), onPress: () => resolve('camera') },
        { text: t('Галерея'), onPress: () => resolve('gallery') },
        { text: t('Отмена'), style: 'cancel', onPress: () => resolve(null) }
      ]);
    });

  const requestPhoto = async () => {
    const source = await choosePhotoSource();
    if (!source) return null;
    const preset = await chooseCropPreset();
    if (!preset) return null;
    if (source === 'camera') return requestCamera(preset);
    if (source === 'gallery') return requestGallery(preset);
    return null;
  };

  const handleAddItem = async () => {
    const photo = await requestPhoto();
    if (!photo) return;
    setDraftPhoto(photo);
    setDraftName('');
    setDraftColor(colorOptions[0]);
    setDraftColorHex('');
    setDraftPalette([]);
    setDraftCategory(categoryOptions[0]);
    setDraftSeason(seasonOptions[0]);
    setDraftPattern(patternOptions[0]);
    setDraftSize('');
    setDraftStore('');
    setDraftMaterial('');
    setDraftSection(activeFilter === 'Все' ? sectionOptions[0] : activeFilter);
    setHasManualDraftCategory(false);
    setModalVisible(true);
    void applyAi(photo);
  };

  const handleSaveItem = () => {
    if (!draftPhoto || isAnalyzing) return;
    const resolvedSection = draftSection || getSectionByCategory(draftCategory);
    const newItem: WardrobeItem = {
      id: Date.now().toString(),
      name: draftName.trim() || 'Новая вещь',
      category: draftCategory || 'Не определено',
      color: draftColor || 'Не определено',
      season: draftSeason || 'Не определено',
      pattern: draftPattern || 'Не определено',
      section: resolvedSection,
      tags: draftPalette.length ? draftPalette : [],
      imageUri: draftPhoto,
      size: draftSize,
      store: draftStore,
      material: draftMaterial
    };
    onItemsChange([newItem, ...items]);
    setModalVisible(false);
  };

  const handleRetake = async () => {
      const photo = await requestPhoto();
    if (photo) {
      setDraftPhoto(photo);
      setHasManualDraftCategory(false);
      void applyAi(photo);
    }
  };

  const applyAi = async (photoUri: string) => {
    const requestId = ++analysisRequestRef.current;
    try {
      setAnalyzing(true);
      const result = await analyzeImage(photoUri);
      if (analysisRequestRef.current !== requestId) return; // ответ на уже неактуальное фото
      const hex = normalizeHex(result.dominantColor);
      const named = hex ? getClosestColorName(hex) : 'Не определено';
      setDraftColor(named);
      setDraftColorHex(hex);
      const normalizedPalette = (result.palette || []).map((color) => normalizeHex(color)).filter(Boolean);
      const paletteNames = normalizedPalette
        .map((color) => getClosestColorName(color))
        .filter((name) => name && name !== 'Не определено');
      const uniquePalette = Array.from(new Set(paletteNames)).slice(0, 5);
      setDraftPalette(uniquePalette);
      if (result.category && !hasManualDraftCategory) {
        setDraftCategory(result.category);
        setDraftSection(getSectionByCategory(result.category));
      }
      if (result.season) setDraftSeason(result.season);
      if (result.pattern) setDraftPattern(result.pattern);
      if (result.bgRemovedBase64) {
        setDraftPhoto(result.bgRemovedBase64);
      }
    } catch (error: any) {
      if (analysisRequestRef.current !== requestId) return;
      const message = String(error?.message || error || t('Неизвестная ошибка'));
      Alert.alert(t('AI анализ не удался'), message);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!draftPhoto) return;
    await applyAi(draftPhoto);
  };

  const handleEditItem = (item: WardrobeItem) => {
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
  };

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

  const handleDeleteItem = (id: string) => {
    Alert.alert(t('Удалить вещь?'), t('Действие нельзя отменить.'), [
      { text: t('Отмена'), style: 'cancel' },
      {
        text: t('Удалить'),
        style: 'destructive',
        onPress: () => onItemsChange(items.filter((item) => item.id !== id))
      }
    ]);
  };

  const handleRetakeExisting = async (id: string) => {
    const photo = await requestPhoto();
    if (!photo) return;
    onItemsChange(items.map((item) => (item.id === id ? { ...item, imageUri: photo } : item)));
  };

  const handleDraftCategoryChange = (value: string) => {
    setHasManualDraftCategory(true);
    setDraftCategory(value);
    setDraftSection(getSectionByCategory(value));
  };

  const handleEditCategoryChange = (value: string) => {
    setEditCategory(value);
    setEditSection(getSectionByCategory(value));
  };

  const renderChips = (options: string[], selected: string, onSelect: (value: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalChipsRow}>
      {options.map((option) => {
        const isActive = option === selected;
        return (
          <AppPressable
            key={option}
            haptics
            style={[styles.modalChip, isActive && styles.modalChipActive]}
            onPress={() => onSelect(option)}
          >
            <Text style={[styles.modalChipText, isActive && styles.modalChipTextActive]}>{t(option)}</Text>
          </AppPressable>
        );
      })}
    </ScrollView>
  );

  const renderFieldLabel = (label: string) => (
    <View style={styles.fieldLabelWrap}>
      <SectionLabel>{label}</SectionLabel>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow={t('Твоя коллекция')}
        title={t('Гардероб')}
        subtitle={t('Загрузи фото вещи, проверь AI-анализ и при необходимости исправь данные.')}
      />

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
            icon={filterIcons[filter]}
            active={filter === activeFilter}
            onPress={() => setActiveFilter(filter)}
          />
        ))}
      </ScrollView>

      <FadeInView delay={40}>
        <AppPressable haptics style={styles.uploadCard} onPress={handleAddItem}>
          <LinearGradient
            colors={[colors.accentGoldSoft, colors.card] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.uploadGradient}
          />
          <View style={styles.uploadRow}>
            <LinearGradient
              colors={[colors.goldFrom, colors.goldTo] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.uploadPlusCircle}
            >
              <Text style={styles.uploadPlus}>+</Text>
            </LinearGradient>
            <View style={styles.uploadTextBlock}>
              <Text style={styles.uploadTitle}>{t('Добавить вещь')}</Text>
              <Text style={styles.uploadText}>
                {t('Фото на белом фоне или на себе, затем автоматическое вырезание фона.')}
              </Text>
            </View>
          </View>
        </AppPressable>
      </FadeInView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.itemsWrap}>
        {filteredItems.length === 0 ? (
          <EmptyState
            emoji="👗"
            title={t('Здесь пока пусто')}
            hint={
              items.length === 0
                ? t('Сфотографируй первую вещь — AI сам определит категорию, цвет и сезон.')
                : t('В этом разделе пока ничего нет. Попробуй другой фильтр.')
            }
            actionLabel={items.length === 0 ? t('Добавить вещь') : undefined}
            onAction={items.length === 0 ? handleAddItem : undefined}
          />
        ) : (
          filteredItems.map((item, index) => (
            <FadeInView key={item.id} delay={Math.min(index, 6) * 60}>
              <View style={styles.itemCard}>
                {item.imageUri ? (
                  <View style={styles.photoBlock}>
                    <View style={styles.photoFrame}>
                      <Image source={{ uri: item.imageUri }} style={styles.photo} resizeMode="contain" />
                    </View>
                    <View style={styles.photoActions}>
                      <AppPressable haptics style={styles.retakeButton} onPress={() => handleRetakeExisting(item.id)}>
                        <Text style={styles.retakeText}>{t('Переснять')}</Text>
                      </AppPressable>
                      <AppPressable haptics style={styles.deleteButton} onPress={() => handleDeleteItem(item.id)}>
                        <Text style={styles.deleteText}>{t('Удалить')}</Text>
                      </AppPressable>
                    </View>
                  </View>
                ) : null}
                <View style={styles.itemHeader}>
                  <Text style={styles.itemName}>{t(item.name)}</Text>
                  <AppPressable haptics style={styles.editButton} onPress={() => handleEditItem(item)}>
                    <Text style={styles.editButtonText}>{t('Исправить')}</Text>
                  </AppPressable>
                </View>
                <View style={styles.metaRow}>
                  {[item.category, item.color, item.season, item.pattern]
                    .filter((value) => value && value !== 'Не определено')
                    .map((value, metaIndex) => {
                      const hex = normalizeHex(value);
                      return (
                        <View key={`${item.id}-meta-${metaIndex}`} style={styles.metaChip}>
                          {hex ? <View style={[styles.colorSwatch, { backgroundColor: hex }]} /> : null}
                          <Text style={styles.metaChipText}>{hex ? t(getClosestColorName(hex)) : t(value)}</Text>
                        </View>
                      );
                    })}
                </View>
                <View style={styles.tagsRow}>
                  {Array.from(new Set(item.tags.map(tagToLabel))).slice(0, 5).map((label, index) => (
                    <View key={`${label}-${index}`} style={styles.tag}>
                      <Text style={styles.tagText}>{t(label)}</Text>
                    </View>
                  ))}
                </View>
                {!item.imageUri ? (
                  <View style={styles.cardFooterActions}>
                    <AppPressable haptics style={styles.deleteButton} onPress={() => handleDeleteItem(item.id)}>
                      <Text style={styles.deleteText}>{t('Удалить')}</Text>
                    </AppPressable>
                  </View>
                ) : null}
                {(item.size || item.store || item.material) && (
                  <Text style={styles.itemDetails}>
                    {item.size ? t('Размер: {value}', { value: item.size }) : ''}
                    {item.size && item.store ? ' · ' : ''}
                    {item.store ? t('Магазин: {value}', { value: item.store }) : ''}
                    {(item.size || item.store) && item.material ? ' · ' : ''}
                    {item.material ? t('Материал: {value}', { value: item.material }) : ''}
                  </Text>
                )}
              </View>
            </FadeInView>
          ))
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={isModalVisible} onRequestClose={() => setModalVisible(false)}>
        <AppPressable feedback={false} style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <AppPressable feedback={false} style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHandle} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Text style={styles.modalTitle}>{t('Новая вещь')}</Text>
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
                  <Text style={styles.retakePillText}>{t('Переснять фото')}</Text>
                </AppPressable>
                {renderFieldLabel(t('Название вещи'))}
                <AtelierInput
                  placeholder={t('Например, Белая футболка')}
                  value={draftName}
                  onChangeText={setDraftName}
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
                  <Text style={styles.aiHint}>{t('AI цвет: {color}', { color: t(draftColor) })}</Text>
                ) : null}
                {renderFieldLabel(t('Категория'))}
                {renderChips(categoryOptions, draftCategory, handleDraftCategoryChange)}
                {renderFieldLabel(t('Цвет'))}
                {renderChips(colorOptions, draftColor || colorOptions[0], setDraftColor)}
                {renderFieldLabel(t('Сезон'))}
                {renderChips(seasonOptions, draftSeason, setDraftSeason)}
                {renderFieldLabel(t('Паттерн'))}
                {renderChips(patternOptions, draftPattern, setDraftPattern)}
                {renderFieldLabel(t('Раздел'))}
                {renderChips(sectionOptions, draftSection, setDraftSection)}
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
                <PrimaryButton
                  title={t('Сохранить')}
                  onPress={handleSaveItem}
                  variant="gold"
                  size="lg"
                  disabled={isAnalyzing}
                  style={styles.modalSave}
                />
                <PrimaryButton
                  title={t('Отмена')}
                  onPress={() => setModalVisible(false)}
                  variant="ghost"
                  style={styles.modalCancel}
                />
              </ScrollView>
            </KeyboardAvoidingView>
          </AppPressable>
        </AppPressable>
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={isEditModalVisible}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <AppPressable feedback={false} style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <AppPressable feedback={false} style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHandle} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
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
                <PrimaryButton
                  title={t('Сохранить')}
                  onPress={handleSaveEdit}
                  variant="gold"
                  size="lg"
                  style={styles.modalSave}
                />
                <PrimaryButton
                  title={t('Отмена')}
                  onPress={() => setEditModalVisible(false)}
                  variant="ghost"
                  style={styles.modalCancel}
                />
              </ScrollView>
            </KeyboardAvoidingView>
          </AppPressable>
        </AppPressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
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
    minHeight: 48
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
    ...StyleSheet.absoluteFillObject,
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
    letterSpacing: -0.3,
    color: c.text
  },
  uploadText: {
    ...TYPE.caption,
    color: c.muted
  },
  itemsWrap: {
    gap: 14,
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
    letterSpacing: -0.3
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
    maxHeight: '85%'
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
    letterSpacing: -0.4,
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
  modalSave: {
    marginTop: 24
  },
  modalCancel: {
    marginTop: 10
  },
  modalChipsRow: {
    gap: 8,
    paddingBottom: 6
  },
  modalChip: {
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
