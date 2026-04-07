import { useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ScreenTitle } from '../components/ScreenTitle';
import { COLORS } from '../constants/theme';
import { AppPressable } from '../components/AppPressable';

type ProfileScreenProps = {
  displayName: string;
  contact: string;
  authMethod: string;
  avatarUri?: string;
  favoritesCount: number;
  onAvatarChange: (uri: string) => void;
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

export function ProfileScreen({
  displayName,
  contact,
  authMethod,
  avatarUri,
  favoritesCount,
  onAvatarChange,
  onLogout
}: ProfileScreenProps) {
  const [bodyType, setBodyType] = useState('Не задано');
  const [colorType, setColorType] = useState('Не задано');
  const [activeModal, setActiveModal] = useState<'body' | 'color' | null>(null);

  const rows = [
    { label: 'Тип фигуры', value: bodyType, key: 'body' as const },
    { label: 'Цветотип', value: colorType, key: 'color' as const },
    { label: 'Избранные образы', value: String(favoritesCount) },
    { label: 'Способ входа', value: authMethod }
  ];

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нужен доступ', 'Разреши доступ к фото, чтобы выбрать аватар.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });

    if (!result.canceled) {
      onAvatarChange(result.assets[0]?.uri ?? '');
    }
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

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Профиль"
        subtitle="Параметры внешности нужны для более точных рекомендаций ИИ."
      />

      {renderModal()}

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

        <AppPressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Выйти из аккаунта</Text>
        </AppPressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    gap: 12,
    paddingBottom: 20
  },
  profileCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  avatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFEAE1',
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
    color: COLORS.muted,
    fontWeight: '600'
  },
  profileInfo: {
    flex: 1
  },
  userName: {
    fontSize: 22,
    color: COLORS.text,
    fontWeight: '700'
  },
  userMeta: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 13
  },
  settingsBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  settingLabel: {
    color: COLORS.muted,
    fontSize: 14
  },
  settingValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600'
  },
  settingValueSelectable: {
    textDecorationLine: 'underline'
  },
  logoutButton: {
    backgroundColor: '#EFEAE1',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12
  },
  logoutText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600'
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
    maxHeight: '70%'
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12
  },
  modalList: {
    gap: 8,
    paddingBottom: 12
  },
  modalOption: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  modalOptionText: {
    color: COLORS.text,
    fontSize: 14
  },
  modalClose: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10
  },
  modalCloseText: {
    color: COLORS.muted,
    fontSize: 14
  }
});
