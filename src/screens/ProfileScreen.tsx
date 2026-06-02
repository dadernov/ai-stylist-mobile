import { useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ScreenTitle } from '../components/ScreenTitle';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from '../components/AppPressable';

type ProfileScreenProps = {
  displayName: string;
  contact: string;
  authMethod: string;
  avatarUri?: string;
  modelUri?: string;
  favoritesCount: number;
  onAvatarChange: (uri: string) => void;
  onModelChange: (uri: string) => void;
  onLogout: () => void;
};

const bodyTypes = [
  'Песочные часы',
  'Груша',
  'Яблоко',
  'Прямоугольник',
  'Перевернутый треугольник'
];

const colorTypes = [
  'Тёплая весна',
  'Светлая весна',
  'Холодное лето',
  'Мягкое лето',
  'Глубокая осень',
  'Тёплая осень',
  'Глубокая зима',
  'Холодная зима'
];

type CropPreset = {
  key: string;
  label: string;
  allowsEditing: boolean;
  aspect?: [number, number];
};

const profileCropPresets: CropPreset[] = [
  { key: 'nocrop', label: 'Без обрезки (оригинал)', allowsEditing: false },
  { key: 'fullbody', label: 'Полный рост 3:4', allowsEditing: true, aspect: [3, 4] },
  { key: 'tight', label: 'Плотный кадр 4:5', allowsEditing: true, aspect: [4, 5] },
  { key: 'square', label: 'Квадрат 1:1', allowsEditing: true, aspect: [1, 1] }
];

export function ProfileScreen({
  displayName,
  contact,
  authMethod,
  avatarUri,
  modelUri,
  favoritesCount,
  onAvatarChange,
  onModelChange,
  onLogout
}: ProfileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { mode, setMode } = useTheme();
  const [bodyType, setBodyType] = useState('Не задано');
  const [colorType, setColorType] = useState('Не задано');
  const [activeModal, setActiveModal] = useState<'body' | 'color' | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const rows = [
    { label: 'Тип фигуры', value: bodyType, key: 'body' as const },
    { label: 'Цветотип', value: colorType, key: 'color' as const },
    { label: 'Избранные образы', value: String(favoritesCount) },
    { label: 'Способ входа', value: authMethod }
  ];

  const chooseCropPreset = () =>
    new Promise<CropPreset | null>((resolve) => {
      Alert.alert('Кадрирование фото', 'Выбери удобный формат выделенной области.', [
        ...profileCropPresets.map((preset) => ({ text: preset.label, onPress: () => resolve(preset) })),
        { text: 'Отмена', style: 'cancel', onPress: () => resolve(null) }
      ]);
    });

  const pickImageFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нужен доступ', 'Разреши доступ к фото, чтобы выбрать изображение.');
      return null;
    }

    const preset = await chooseCropPreset();
    if (!preset) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: preset.allowsEditing,
      aspect: preset.aspect,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });

    if (result.canceled) return null;
    return result.assets[0]?.uri ?? null;
  };

  const handlePickAvatar = async () => {
    const uri = await pickImageFromGallery();
    if (uri) onAvatarChange(uri);
  };

  const handlePickModel = async () => {
    const uri = await pickImageFromGallery();
    if (uri) onModelChange(uri);
  };

  const renderModal = () => {
    if (!activeModal) return null;
    const options = activeModal === 'body' ? bodyTypes : colorTypes;
    return (
      <Modal transparent animationType="slide" visible onRequestClose={() => setActiveModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {activeModal === 'body' ? 'Выберите тип фигуры' : 'Выберите цветотип'}
            </Text>
            <ScrollView contentContainerStyle={styles.modalList}>
              {options.map((option) => (
                <AppPressable
                  key={option}
                  style={styles.modalOption}
                  onPress={() => {
                    if (activeModal === 'body') setBodyType(option);
                    if (activeModal === 'color') setColorType(option);
                    setActiveModal(null);
                  }}
                >
                  <Text style={styles.modalOptionText}>{option}</Text>
                </AppPressable>
              ))}
            </ScrollView>
            <AppPressable style={styles.modalClose} onPress={() => setActiveModal(null)}>
              <Text style={styles.modalCloseText}>Закрыть</Text>
            </AppPressable>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPreviewModal = () => {
    if (!previewUri) return null;
    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          <Image source={{ uri: previewUri }} style={styles.previewImageFull} resizeMode="contain" />
          <AppPressable style={styles.previewClose} onPress={() => setPreviewUri(null)}>
            <Text style={styles.previewCloseText}>Закрыть</Text>
          </AppPressable>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Профиль"
        subtitle="Параметры внешности нужны для более точных рекомендаций ИИ."
      />

      {renderModal()}
      {renderPreviewModal()}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <AppPressable style={styles.avatarWrap} onPress={handlePickAvatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarPlaceholder}>+</Text>
            )}
          </AppPressable>
          <View style={styles.profileInfo}>
            <Text style={styles.userName}>{displayName}</Text>
            <Text style={styles.userMeta}>{contact || 'Контакт не указан'}</Text>
          </View>
        </View>

        <View style={styles.modelCard}>
          <Text style={styles.modelTitle}>Фото для виртуальной примерки</Text>
          <Text style={styles.modelText}>
            Загрузи фото в полный рост на однотонном фоне (можно в обычной облегающей одежде). На него мы будем
            накладывать избранные образы.
          </Text>
          <AppPressable style={styles.modelPreview} onPress={() => (modelUri ? setPreviewUri(modelUri) : handlePickModel())}>
            {modelUri ? (
              <Image source={{ uri: modelUri }} style={styles.modelImage} resizeMode="contain" />
            ) : (
              <Text style={styles.modelPlaceholder}>+ Добавить фото модели</Text>
            )}
          </AppPressable>
          <AppPressable style={styles.modelButton} onPress={handlePickModel}>
            <Text style={styles.modelButtonText}>{modelUri ? 'Заменить фото' : 'Выбрать из галереи'}</Text>
          </AppPressable>
        </View>

        <View style={styles.settingsBlock}>
          {rows.map((row) => {
            const isSelectable = row.key === 'body' || row.key === 'color';
            return (
              <AppPressable
                key={row.label}
                style={styles.settingRow}
                onPress={() => {
                  if (row.key === 'body') setActiveModal('body');
                  if (row.key === 'color') setActiveModal('color');
                }}
              >
                <Text style={styles.settingLabel}>{row.label}</Text>
                <Text style={[styles.settingValue, isSelectable && styles.settingValueSelectable]}>{row.value}</Text>
              </AppPressable>
            );
          })}
        </View>

        <View style={styles.themeCard}>
          <Text style={styles.themeTitle}>Тема оформления</Text>
          <View style={styles.themeRow}>
            {([
              { key: 'light' as const, label: 'Светлая' },
              { key: 'dark' as const, label: 'Тёмная' }
            ]).map((option) => {
              const active = mode === option.key;
              return (
                <AppPressable
                  key={option.key}
                  style={[styles.themeOption, active && styles.themeOptionActive]}
                  onPress={() => setMode(option.key)}
                >
                  <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>{option.label}</Text>
                </AppPressable>
              );
            })}
          </View>
        </View>

        <AppPressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Выйти из аккаунта</Text>
        </AppPressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    gap: 12,
    paddingBottom: 20
  },
  profileCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  avatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: c.chip,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  avatarImage: {
    width: '100%',
    height: '100%'
  },
  avatarPlaceholder: {
    fontSize: 28,
    color: c.muted,
    fontWeight: '600'
  },
  profileInfo: {
    flex: 1
  },
  modelCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 8
  },
  modelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text
  },
  modelText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 17
  },
  modelPreview: {
    height: 420,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modelImage: {
    width: '100%',
    height: '100%'
  },
  modelPlaceholder: {
    fontSize: 13,
    fontWeight: '600',
    color: c.muted
  },
  modelButton: {
    backgroundColor: c.chip,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10
  },
  modelButtonText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600'
  },
  userName: {
    fontSize: 22,
    color: c.text,
    fontWeight: '700'
  },
  userMeta: {
    marginTop: 4,
    color: c.muted,
    fontSize: 13
  },
  settingsBlock: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border
  },
  settingLabel: {
    color: c.muted,
    fontSize: 14
  },
  settingValue: {
    color: c.text,
    fontSize: 14,
    fontWeight: '600'
  },
  settingValueSelectable: {
    textDecorationLine: 'underline'
  },
  themeCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 10
  },
  themeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10
  },
  themeOption: {
    flex: 1,
    backgroundColor: c.chip,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  themeOptionActive: {
    backgroundColor: c.buttonPrimaryBg
  },
  themeOptionText: {
    color: c.text,
    fontSize: 14,
    fontWeight: '600'
  },
  themeOptionTextActive: {
    color: c.buttonPrimaryText
  },
  logoutButton: {
    backgroundColor: c.chip,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12
  },
  logoutText: {
    color: c.text,
    fontSize: 14,
    fontWeight: '600'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: c.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: '70%'
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginBottom: 12
  },
  modalList: {
    gap: 8,
    paddingBottom: 12
  },
  modalOption: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  modalOptionText: {
    color: c.text,
    fontSize: 14
  },
  modalClose: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10
  },
  modalCloseText: {
    color: c.muted,
    fontSize: 14
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: 16
  },
  previewImageFull: {
    width: '100%',
    height: '86%'
  },
  previewClose: {
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: c.chip,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  previewCloseText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '700'
  }
});
