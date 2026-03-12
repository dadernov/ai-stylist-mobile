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
  View
} from 'react-native';
import { useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ScreenTitle } from '../components/ScreenTitle';
import { Chip } from '../components/Chip';
import { COLORS } from '../constants/theme';
import { WardrobeItem } from '../data/mock';

type WardrobeScreenProps = {
  items: WardrobeItem[];
  onItemsChange: (items: WardrobeItem[]) => void;
};

const sectionOptions = ['Верх', 'Низ', 'Обувь', 'Сумки', 'Верхняя одежда'];
const categoryFilters = ['Все', ...sectionOptions];

const categoryOptions = ['Платье', 'Юбка', 'Джинсы', 'Футболка', 'Пальто', 'Обувь', 'Сумка'];
const colorOptions = ['Белый', 'Черный', 'Бежевый', 'Синий деним', 'Серый', 'Красный', 'Зеленый'];
const seasonOptions = ['Лето', 'Зима', 'Демисезон', 'Круглый год'];
const patternOptions = ['Клетка', 'Полоска', 'Горох', 'Цветочный', 'Однотонный'];

export function WardrobeScreen({ items, onItemsChange }: WardrobeScreenProps) {
  const [activeFilter, setActiveFilter] = useState('Все');

  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState('');
  const [draftStore, setDraftStore] = useState('');
  const [draftMaterial, setDraftMaterial] = useState('');
  const [draftSection, setDraftSection] = useState(sectionOptions[0]);
  const [draftName, setDraftName] = useState('');
  const [isModalVisible, setModalVisible] = useState(false);

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState(categoryOptions[0]);
  const [editColor, setEditColor] = useState(colorOptions[0]);
  const [editSeason, setEditSeason] = useState(seasonOptions[0]);
  const [editPattern, setEditPattern] = useState(patternOptions[0]);
  const [editName, setEditName] = useState('');
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
    setDraftSize('');
    setDraftStore('');
    setDraftMaterial('');
    setDraftSection(activeFilter === 'Все' ? sectionOptions[0] : activeFilter);
    setModalVisible(true);
  };

  const handleSaveItem = () => {
    if (!draftPhoto) return;
    const newItem: WardrobeItem = {
      id: Date.now().toString(),
      name: draftName.trim() || 'Новая вещь',
      category: 'Не определено',
      color: 'Не определено',
      season: 'Не определено',
      pattern: 'Не определено',
      section: draftSection,
      tags: [],
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
    if (photo) setDraftPhoto(photo);
  };

  const handleEditItem = (item: WardrobeItem) => {
    setEditItemId(item.id);
    setEditName(item.name || '');
    setEditCategory(item.category || categoryOptions[0]);
    setEditColor(item.color || colorOptions[0]);
    setEditSeason(item.season || seasonOptions[0]);
    setEditPattern(item.pattern || patternOptions[0]);
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
              pattern: editPattern
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
                <Image source={{ uri: item.imageUri }} style={styles.photo} />
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
              {item.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
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
                {draftPhoto ? <Image source={{ uri: draftPhoto }} style={styles.modalPhoto} /> : null}
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
                <Text style={styles.modalLabel}>Магазин</Text>
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
    marginBottom: 16,
    paddingRight: 12
  },
  filterRowAndroid: {
    paddingBottom: 10,
    marginBottom: 20
  },
  filterScroll: {
    minHeight: 48
  },
  uploadCard: {
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 12,
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
