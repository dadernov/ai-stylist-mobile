import { useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII, SERIF, SHADOWS, SPACING, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useLanguage, useT } from '../constants/i18n';
import { AppPressable } from '../components/AppPressable';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SectionLabel } from '../components/ui/SectionLabel';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { FadeInView } from '../components/ui/FadeInView';
import { Gender } from '../types/profile';
import { StylePreferencesFields } from '../components/StylePreferencesFields';

type ProfileScreenProps = {
  displayName: string;
  contact: string;
  authMethod: string;
  avatarUri?: string;
  modelUri?: string;
  favoritesCount: number;
  onAvatarChange: (uri: string) => void;
  onModelChange: (uri: string) => void;
  onShowGuide: () => void;
  onLogout: () => void;
  gender: Gender;
  beautyAdvice: boolean;
  onGenderChange: (gender: Gender) => void;
  onBeautyChange: (enabled: boolean) => void;
};

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
  onShowGuide,
  onLogout,
  gender,
  beautyAdvice,
  onGenderChange,
  onBeautyChange
}: ProfileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { mode, setMode, colors } = useTheme();
  const { lang, setLang } = useLanguage();
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const chooseCropPreset = () =>
    new Promise<CropPreset | null>((resolve) => {
      Alert.alert(t('Кадрирование фото'), t('Выбери удобный формат выделенной области.'), [
        ...profileCropPresets.map((preset) => ({ text: t(preset.label), onPress: () => resolve(preset) })),
        { text: t('Отмена'), style: 'cancel', onPress: () => resolve(null) }
      ]);
    });

  const pickImageFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('Нужен доступ'), t('Разреши доступ к фото, чтобы выбрать изображение.'));
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

  const renderPreviewModal = () => {
    if (!previewUri) return null;
    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => setPreviewUri(null)}>
        <View style={styles.previewBackdrop}>
          <Image source={{ uri: previewUri }} style={styles.previewImageFull} resizeMode="contain" />
          <AppPressable style={styles.previewClose} onPress={() => setPreviewUri(null)}>
            <Text style={styles.previewCloseText}>{t('Закрыть')}</Text>
          </AppPressable>
        </View>
      </Modal>
    );
  };

  const renderSettingRow = (options: {
    emoji: string;
    title: string;
    hint?: string;
    value?: string;
    danger?: boolean;
    delay: number;
    onPress: () => void;
  }) => (
    <FadeInView delay={options.delay}>
      <AppPressable haptics style={styles.settingCard} onPress={options.onPress}>
        <View style={[styles.settingIconWrap, options.danger && styles.settingIconWrapDanger]}>
          <Text style={styles.settingIcon}>{options.emoji}</Text>
        </View>
        <View style={styles.settingBody}>
          <Text style={[styles.settingTitle, options.danger && styles.settingTitleDanger]}>{options.title}</Text>
          {options.hint ? <Text style={styles.settingHint}>{options.hint}</Text> : null}
        </View>
        {options.value ? <Text style={styles.settingValue}>{options.value}</Text> : null}
        <Text style={[styles.chevron, options.danger && styles.chevronDanger]}>›</Text>
      </AppPressable>
    </FadeInView>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow={t('Личный кабинет')}
        title={t('Профиль')}
        subtitle={t('Фото для примерки, избранные образы и настройки.')}
      />

      {renderPreviewModal()}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeInView delay={0}>
          <View style={styles.profileCard}>
            <View style={styles.profileTopRow}>
              <AppPressable haptics style={styles.avatarPressable} onPress={handlePickAvatar}>
                <LinearGradient
                  colors={[colors.goldFrom, colors.goldTo] as const}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatarRing}
                >
                  <View style={styles.avatarInner}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                    ) : (
                      <Text style={styles.avatarPlaceholder}>+</Text>
                    )}
                  </View>
                </LinearGradient>
              </AppPressable>
              <View style={styles.profileInfo}>
                <Text style={styles.userName}>{t(displayName)}</Text>
                <Text style={styles.userMeta}>{contact || t('Контакт не указан')}</Text>
              </View>
            </View>
            <View style={styles.statsDivider} />
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{String(favoritesCount)}</Text>
                <Text style={styles.statLabel}>{t('Избранные образы')}</Text>
              </View>
              <View style={styles.statsSeparator} />
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{t(authMethod)}</Text>
                <Text style={styles.statLabel}>{t('Способ входа')}</Text>
              </View>
            </View>
          </View>
        </FadeInView>

        <StylePreferencesFields gender={gender} beautyAdvice={beautyAdvice} onGenderChange={onGenderChange} onBeautyChange={onBeautyChange} />

        <FadeInView delay={60}>
          <SectionLabel>{t('Примерка')}</SectionLabel>
          <View style={styles.modelCard}>
            <Text style={styles.modelTitle}>{t('Фото для виртуальной примерки')}</Text>
            <Text style={styles.modelText}>
              {t('Загрузи фото в полный рост на однотонном фоне (можно в обычной облегающей одежде). На него мы будем накладывать избранные образы.')}
            </Text>
            <AppPressable
              style={styles.modelPreview}
              onPress={() => (modelUri ? setPreviewUri(modelUri) : handlePickModel())}
            >
              {modelUri ? (
                <Image source={{ uri: modelUri }} style={styles.modelImage} resizeMode="contain" />
              ) : (
                <View style={styles.modelEmpty}>
                  <LinearGradient
                    colors={[colors.accentGoldSoft, colors.surface] as const}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.modelEmptyCircle}
                  >
                    <Text style={styles.modelEmptyEmoji}>🧍</Text>
                  </LinearGradient>
                  <Text style={styles.modelPlaceholder}>{t('+ Добавить фото модели')}</Text>
                </View>
              )}
            </AppPressable>
            <PrimaryButton
              title={modelUri ? t('Заменить фото') : t('Выбрать из галереи')}
              onPress={handlePickModel}
              variant={modelUri ? 'ghost' : 'gold'}
            />
          </View>
        </FadeInView>

        <FadeInView delay={120} style={styles.settingsLabelWrap}>
          <SectionLabel>{t('Настройки')}</SectionLabel>
        </FadeInView>

        {renderSettingRow({
          emoji: '🌗',
          title: t('Тема оформления'),
          value: t(mode === 'dark' ? 'Тёмная' : 'Светлая'),
          delay: 160,
          onPress: () => setMode(mode === 'dark' ? 'light' : 'dark')
        })}

        {renderSettingRow({
          emoji: '🌐',
          title: t('Язык'),
          value: lang === 'ru' ? 'Русский' : '中文',
          delay: 200,
          onPress: () => setLang(lang === 'ru' ? 'zh' : 'ru')
        })}

        {renderSettingRow({
          emoji: '📖',
          title: t('Как пользоваться приложением'),
          hint: t('Короткая инструкция: фото, гардероб, генерация образов.'),
          delay: 240,
          onPress: onShowGuide
        })}

        {renderSettingRow({
          emoji: '🚪',
          title: t('Выйти из аккаунта'),
          danger: true,
          delay: 280,
          onPress: onLogout
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    gap: SPACING.md,
    paddingBottom: 28
  },
  profileCard: {
    backgroundColor: c.card,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: SPACING.lg,
    ...SHADOWS.card
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg
  },
  avatarPressable: {
    borderRadius: 40
  },
  avatarRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
  userName: {
    fontFamily: SERIF,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: c.text
  },
  userMeta: {
    marginTop: 4,
    color: c.muted,
    fontSize: 13
  },
  statsDivider: {
    height: 1,
    backgroundColor: c.goldHairline,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch'
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 3
  },
  statsSeparator: {
    width: 1,
    backgroundColor: c.border,
    marginHorizontal: SPACING.sm
  },
  statValue: {
    fontFamily: SERIF,
    fontSize: 19,
    fontWeight: '700',
    color: c.accentGold
  },
  statLabel: {
    ...TYPE.caption,
    color: c.muted,
    textAlign: 'center'
  },
  modelCard: {
    backgroundColor: c.card,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: SPACING.lg,
    gap: SPACING.md,
    ...SHADOWS.card
  },
  modelTitle: {
    ...TYPE.title,
    color: c.text
  },
  modelText: {
    ...TYPE.caption,
    color: c.muted
  },
  modelPreview: {
    height: 420,
    borderRadius: RADII.lg,
    overflow: 'hidden',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.goldHairline,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modelImage: {
    width: '100%',
    height: '100%'
  },
  modelEmpty: {
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl
  },
  modelEmptyCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.goldHairline
  },
  modelEmptyEmoji: {
    fontSize: 36,
    lineHeight: 44
  },
  modelPlaceholder: {
    fontSize: 13,
    fontWeight: '600',
    color: c.muted,
    textAlign: 'center'
  },
  settingsLabelWrap: {
    marginTop: SPACING.sm,
    marginBottom: -SPACING.sm
  },
  settingCard: {
    backgroundColor: c.card,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    ...SHADOWS.card
  },
  settingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    alignItems: 'center',
    justifyContent: 'center'
  },
  settingIconWrapDanger: {
    backgroundColor: c.dangerSoft,
    borderColor: c.dangerSoft
  },
  settingIcon: {
    fontSize: 18,
    lineHeight: 24
  },
  settingBody: {
    flex: 1,
    gap: 2
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text
  },
  settingTitleDanger: {
    color: c.danger
  },
  settingHint: {
    ...TYPE.caption,
    color: c.muted
  },
  settingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: c.accentGold
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
    color: c.muted,
    marginTop: -2
  },
  chevronDanger: {
    color: c.danger
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
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 11
  },
  previewCloseText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '700'
  }
});
