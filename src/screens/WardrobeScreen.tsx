import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator
} from 'react-native';
import { useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ScreenTitle } from '../components/ScreenTitle';
import { Chip } from '../components/Chip';
import { COLORS } from '../constants/theme';
import { WardrobeItem } from '../data/mock';
import { analyzeImage } from '../services/ai';

type WardrobeScreenProps = {
  items: WardrobeItem[];
  onItemsChange: (items: WardrobeItem[]) => void;
};

const sectionOptions = ['Верх', 'Низ', 'Обувь', 'Сумки', 'Верхняя одежда'];
const categoryFilters = ['Все', ...sectionOptions];

const categoryOptions = ['Платье', 'Юбка', 'Джинсы', 'Футболка', 'Пальто', 'Обувь', 'Сумка'];
const seasonOptions = ['Лето', 'Зима', 'Демисезон', 'Круглый год'];
const patternOptions = ['Клетка', 'Полоска', 'Горох', 'Цветочный', 'Однотонный'];

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

export function WardrobeScreen({ items, onItemsChange }: WardrobeScreenProps) {
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

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState(categoryOptions[0]);
  const [editColor, setEditColor] = useState(colorOptions[0]);
  const [editSeason, setEditSeason] = useState(seasonOptions[0]);
  const [editPattern, setEditPattern] = useState(patternOptions[0]);
  const [editName, setEditName] = useState('');
  const [editSize, setEditSize] = useState('');
  const [editStore, setEditStore] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [isEditModalVisible, setEditModalVisible] = useState(false);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'Все') return items;
    return items.filter((item) => item.section === activeFilter);
  }, [items, activeFilter]);

  const requestCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нужен доступ к камере', 'Разреши доступ, чтобы сфотографировать вещь.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });

    if (result.canceled) return null;
    return result.assets[0]?.uri ?? null;
  };

  const handleAddItem = async () => {
    const photo = await requestCamera();
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
    setModalVisible(true);
    void applyAi(photo);
  };

  const handleSaveItem = () => {
    if (!draftPhoto) return;
    const newItem: WardrobeItem = {
      id: Date.now().toString(),
      name: draftName.trim() || 'Новая вещь',
      category: draftCategory || 'Не определено',
      color: draftColor || 'Не определено',
      season: draftSeason || 'Не определено',
      pattern: draftPattern || 'Не определено',
      section: draftSection,
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
    const photo = await requestCamera();
    if (photo) {
      setDraftPhoto(photo);
      void applyAi(photo);
    }
  };

  const applyAi = async (photoUri: string) => {
    try {
      setAnalyzing(true);
      const result = await analyzeImage(photoUri);
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
      if (result.category) setDraftCategory(result.category);
      if (result.season) setDraftSeason(result.season);
      if (result.pattern) setDraftPattern(result.pattern);
      if (result.bgRemovedBase64) {
        setDraftPhoto(result.bgRemovedBase64);
      }
    } catch (error) {
      Alert.alert('AI анализ не удался', 'Проверь, что AI сервер запущен.');
    } finally {
      setAnalyzing(false);
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
    Alert.alert('Удалить вещь?', 'Действие нельзя отменить.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => onItemsChange(items.filter((item) => item.id !== id))
      }
    ]);
  };

  const handleRetakeExisting = async (id: string) => {
    const photo = await requestCamera();
    if (!photo) return;
    onItemsChange(items.map((item) => (item.id === id ? { ...item, imageUri: photo } : item)));
  };

  const renderChips = (options: string[], selected: string, onSelect: (value: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalChipsRow}>
      {options.map((option) => {
        const isActive = option === selected;
        return (
          <Pressable
            key={option}
            style={[styles.modalChip, isActive && styles.modalChipActive]}
            onPress={() => onSelect(option)}
          >
            <Text style={[styles.modalChipText, isActive && styles.modalChipTextActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Гардероб"
        subtitle="Загрузи фото вещи, проверь AI-анализ и при необходимости исправь данные."
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
            label={filter}
            active={filter === activeFilter}
            onPress={() => setActiveFilter(filter)}
          />
        ))}
      </ScrollView>

      <Pressable style={styles.uploadCard} onPress={handleAddItem}>
        <Text style={styles.uploadTitle}>+ Добавить вещь</Text>
        <Text style={styles.uploadText}>Фото на белом фоне или на себе, затем автоматическое вырезание фона.</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.itemsWrap}>
        {filteredItems.map((item) => (
          <View key={item.id} style={styles.itemCard}>
            {item.imageUri ? (
              <View style={styles.photoBlock}>
                <Image source={{ uri: item.imageUri }} style={styles.photo} resizeMode="contain" />
                <View style={styles.photoActions}>
                  <Pressable style={styles.retakeButton} onPress={() => handleRetakeExisting(item.id)}>
                    <Text style={styles.retakeText}>Переснять</Text>
                  </Pressable>
                  <Pressable style={styles.deleteButton} onPress={() => handleDeleteItem(item.id)}>
                    <Text style={styles.deleteText}>Удалить</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.deleteButton} onPress={() => handleDeleteItem(item.id)}>
                <Text style={styles.deleteText}>Удалить</Text>
              </Pressable>
            )}
            <View style={styles.itemHeader}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Pressable style={styles.editButton} onPress={() => handleEditItem(item)}>
                <Text style={styles.editButtonText}>Исправить</Text>
              </Pressable>
            </View>
            <Text style={styles.itemMeta}>AI: {item.category} · {item.color} · {item.season} · {item.pattern}</Text>
            <View style={styles.tagsRow}>
              {Array.from(new Set(item.tags.map(tagToLabel))).slice(0, 5).map((label, index) => (
                <View key={`${label}-${index}`} style={styles.tag}>
                  <Text style={styles.tagText}>{label}</Text>
                </View>
              ))}
            </View>
            {(item.size || item.store || item.material) && (
              <Text style={styles.itemDetails}>
                {item.size ? `Размер: ${item.size}` : ''}
                {item.size && item.store ? ' · ' : ''}
                {item.store ? `Магазин: ${item.store}` : ''}
                {(item.size || item.store) && item.material ? ' · ' : ''}
                {item.material ? `Материал: ${item.material}` : ''}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>

      <Modal transparent animationType="slide" visible={isModalVisible} onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Text style={styles.modalTitle}>Новая вещь</Text>
                {draftPhoto ? (
                  <Image source={{ uri: draftPhoto }} style={styles.modalPhoto} resizeMode="contain" />
                ) : null}
                <Pressable style={styles.retakeButton} onPress={handleRetake}>
                  <Text style={styles.retakeText}>Переснять фото</Text>
                </Pressable>
                <Text style={styles.modalLabel}>Название вещи</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, Белая футболка"
                  placeholderTextColor={COLORS.muted}
                  value={draftName}
                  onChangeText={setDraftName}
                />
                <Pressable style={styles.aiButton} onPress={handleAnalyze} disabled={isAnalyzing}>
                  {isAnalyzing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.aiButtonText}>AI-анализ</Text>
                  )}
                </Pressable>
                {draftColor ? (
                  <Text style={styles.aiHint}>AI цвет: {draftColor}</Text>
                ) : null}
                <Text style={styles.modalLabel}>Категория</Text>
                {renderChips(categoryOptions, draftCategory, setDraftCategory)}
                <Text style={styles.modalLabel}>Цвет</Text>
                {renderChips(colorOptions, draftColor || colorOptions[0], setDraftColor)}
                <Text style={styles.modalLabel}>Сезон</Text>
                {renderChips(seasonOptions, draftSeason, setDraftSeason)}
                <Text style={styles.modalLabel}>Паттерн</Text>
                {renderChips(patternOptions, draftPattern, setDraftPattern)}
                <Text style={styles.modalLabel}>Раздел</Text>
                {renderChips(sectionOptions, draftSection, setDraftSection)}
                <Text style={styles.modalLabel}>Размер</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, M"
                  placeholderTextColor={COLORS.muted}
                  value={draftSize}
                  onChangeText={setDraftSize}
                />
                <Text style={styles.modalLabel}>Бренд / магазин</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, Zara"
                  placeholderTextColor={COLORS.muted}
                  value={draftStore}
                  onChangeText={setDraftStore}
                />
                <Text style={styles.modalLabel}>Материал</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, хлопок"
                  placeholderTextColor={COLORS.muted}
                  value={draftMaterial}
                  onChangeText={setDraftMaterial}
                />
                <Pressable style={styles.modalSave} onPress={handleSaveItem}>
                  <Text style={styles.modalSaveText}>Сохранить</Text>
                </Pressable>
                <Pressable style={styles.modalClose} onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalCloseText}>Отмена</Text>
                </Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={isEditModalVisible}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Text style={styles.modalTitle}>Редактировать параметры</Text>
                <Text style={styles.modalLabel}>Название вещи</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, Белая футболка"
                  placeholderTextColor={COLORS.muted}
                  value={editName}
                  onChangeText={setEditName}
                />
                <Text style={styles.modalLabel}>Категория</Text>
                {renderChips(categoryOptions, editCategory, setEditCategory)}
                <Text style={styles.modalLabel}>Цвет</Text>
                {renderChips(colorOptions, editColor, setEditColor)}
                <Text style={styles.modalLabel}>Сезон</Text>
                {renderChips(seasonOptions, editSeason, setEditSeason)}
                <Text style={styles.modalLabel}>Паттерн</Text>
                {renderChips(patternOptions, editPattern, setEditPattern)}
                <Text style={styles.modalLabel}>Размер</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, M"
                  placeholderTextColor={COLORS.muted}
                  value={editSize}
                  onChangeText={setEditSize}
                />
                <Text style={styles.modalLabel}>Бренд / магазин</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, Zara"
                  placeholderTextColor={COLORS.muted}
                  value={editStore}
                  onChangeText={setEditStore}
                />
                <Text style={styles.modalLabel}>Материал</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Например, хлопок"
                  placeholderTextColor={COLORS.muted}
                  value={editMaterial}
                  onChangeText={setEditMaterial}
                />
                <Pressable style={styles.modalSave} onPress={handleSaveEdit}>
                  <Text style={styles.modalSaveText}>Сохранить</Text>
                </Pressable>
                <Pressable style={styles.modalClose} onPress={() => setEditModalVisible(false)}>
                  <Text style={styles.modalCloseText}>Отмена</Text>
                </Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 12
  },
  uploadTitle: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '700',
    marginBottom: 4
  },
  uploadText: {
    color: COLORS.text,
    opacity: 0.85,
    fontSize: 13,
    lineHeight: 18
  },
  itemsWrap: {
    gap: 10,
    paddingBottom: 20
  },
  itemCard: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
    gap: 8
  },
  photoBlock: {
    gap: 8
  },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#F3EFE8'
  },
  photoActions: {
    flexDirection: 'row',
    gap: 8
  },
  retakeButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFEAE1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  retakeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text
  },
  deleteButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#FBEAEA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  deleteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9B2C2C'
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  itemName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600'
  },
  editButton: {
    backgroundColor: '#F1ECE2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  editButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'
  },
  itemMeta: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18
  },
  itemDetails: {
    color: COLORS.muted,
    fontSize: 12
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  tag: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#FBFAF8'
  },
  tagText: {
    fontSize: 12,
    color: COLORS.muted
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: '85%'
  },
  modalContent: {
    paddingBottom: 24
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12
  },
  modalPhoto: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: '#F3EFE8'
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 10,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#FBFAF8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text
  },
  aiButton: {
    marginTop: 10,
    backgroundColor: COLORS.text,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center'
  },
  aiButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  aiHint: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.muted
  },
  modalSave: {
    marginTop: 14,
    backgroundColor: COLORS.text,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  modalClose: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 8
  },
  modalCloseText: {
    color: COLORS.muted,
    fontSize: 13
  },
  modalChipsRow: {
    gap: 8,
    paddingBottom: 6
  },
  modalChip: {
    backgroundColor: COLORS.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  modalChipActive: {
    backgroundColor: COLORS.text
  },
  modalChipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600'
  },
  modalChipTextActive: {
    color: '#FFFFFF'
  }
});
