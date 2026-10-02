import { useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePhotoPicker } from '../components/usePhotoPicker';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII, SERIF, SHADOWS, SPACING, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { LANGUAGES, useLanguage, useT } from '../constants/i18n';
import { AppPressable } from '../components/AppPressable';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SectionLabel } from '../components/ui/SectionLabel';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { FadeInView } from '../components/ui/FadeInView';
import { Gender } from '../types/profile';
import { StylePreferencesFields } from '../components/StylePreferencesFields';
import { PhotoAdvice } from '../components/PhotoAdvice';
import { Bot, ChevronRight, Globe, LockKeyhole, LogOut, LucideIcon, Moon, PersonStanding, Sun, Trash2 } from 'lucide-react-native';

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
  onDeleteAccount: () => void;
  onOpenPrivacy: () => void;
  onRevokeAiConsent: () => void;
  gender: Gender;
  beautyAdvice: boolean;
  onGenderChange: (gender: Gender) => void;
  onBeautyChange: (enabled: boolean) => void;
};



export function ProfileScreen({
  displayName,
  contact,
  authMethod,
  avatarUri,
  modelUri,
  favoritesCount,
  onAvatarChange,
  onModelChange,
  onLogout,
  onDeleteAccount,
  onOpenPrivacy,
  onRevokeAiConsent,
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
  const [languageOpen, setLanguageOpen] = useState(false);

  const { pickPhoto: pickImageFromGallery, cropModal } = usePhotoPicker();

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
    icon: LucideIcon;
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
          <options.icon size={18} strokeWidth={1.6} color={options.danger ? colors.danger : colors.text} />
        </View>
        <View style={styles.settingBody}>
          <Text style={[styles.settingTitle, options.danger && styles.settingTitleDanger]}>{options.title}</Text>
          {options.hint ? <Text style={styles.settingHint}>{options.hint}</Text> : null}
        </View>
        {options.value ? <Text style={styles.settingValue}>{options.value}</Text> : null}
        <ChevronRight size={18} strokeWidth={1.6} color={options.danger ? colors.danger : colors.muted} />
      </AppPressable>
    </FadeInView>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow={t('Личный кабинет')}
        title={t('Профиль')}
      />

      {renderPreviewModal()}
      <Modal transparent animationType="fade" visible={languageOpen} onRequestClose={() => setLanguageOpen(false)}>
        <AppPressable style={styles.previewBackdrop} onPress={() => setLanguageOpen(false)} accessibilityLabel={t('Закрыть')}>
          <View style={[styles.languageSheet, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityRole="radiogroup">
            <Text style={[styles.settingTitle, { marginBottom: 6 }]}>{t('Язык')}</Text>
            {LANGUAGES.map(item => (
              <AppPressable key={item.code} haptics accessibilityRole="radio" accessibilityState={{ checked: item.code === lang }}
                style={[styles.languageOption, item.code === lang && { borderColor: colors.accentGold, backgroundColor: colors.accentGoldSoft }]}
                onPress={() => { setLang(item.code); setLanguageOpen(false); }}>
                <Text style={[styles.settingTitle, item.code === lang && { color: colors.accentGold }]}>{item.label}</Text>
              </AppPressable>
            ))}
          </View>
        </AppPressable>
      </Modal>
      {cropModal}

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
                <Text style={styles.statText} numberOfLines={1}>{t(authMethod)}</Text>
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
              {t('Фото в полный рост, от макушки до стоп, руки опущены. Фон любой, вырезать его не нужно. Лучше в облегающей одежде. На это фото мы надеваем образы.')}
            </Text>
            {/* The try-on photo is shown full length: it is the person every look is put on. */}
            <AppPressable style={styles.modelPreview} onPress={() => (modelUri ? setPreviewUri(modelUri) : handlePickModel())}
              accessibilityRole={modelUri ? 'imagebutton' : 'button'} accessibilityLabel={t(modelUri ? 'Фото для примерки' : '+ Добавить фото модели')}>
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
                    <PersonStanding size={34} strokeWidth={1.3} color={colors.accentGold} />
                  </LinearGradient>
                  <Text style={styles.modelPlaceholder}>{t('+ Добавить фото модели')}</Text>
                </View>
              )}
            </AppPressable>
            {modelUri ? <PhotoAdvice uri={modelUri} /> : null}
            <PrimaryButton title={t(modelUri ? 'Заменить фото' : 'Выбрать из галереи')} onPress={handlePickModel} variant={modelUri ? 'ghost' : 'gold'} />
          </View>
        </FadeInView>

        <FadeInView delay={120} style={styles.settingsLabelWrap}>
          <SectionLabel>{t('Настройки')}</SectionLabel>
        </FadeInView>

        {renderSettingRow({
          icon: mode === 'dark' ? Moon : Sun,
          title: t('Тема оформления'),
          value: t(mode === 'dark' ? 'Тёмная' : 'Светлая'),
          delay: 160,
          onPress: () => setMode(mode === 'dark' ? 'light' : 'dark')
        })}

        {renderSettingRow({
          icon: Globe,
          title: t('Язык'),
          value: LANGUAGES.find(item => item.code === lang)?.label,
          delay: 200,
          onPress: () => setLanguageOpen(true)
        })}

        {renderSettingRow({
          icon: LockKeyhole,
          title: t('Политика конфиденциальности'),
          hint: t('Какие данные обрабатываются и где'),
          delay: 240,
          onPress: onOpenPrivacy
        })}

        {renderSettingRow({
          icon: Bot,
          title: t('Согласие на обработку фото ИИ'),
          hint: t('Отозвать разрешение на отправку фото нейросетям'),
          delay: 260,
          onPress: onRevokeAiConsent
        })}

        {renderSettingRow({
          icon: LogOut,
          title: t('Выйти из аккаунта'),
          danger: true,
          delay: 280,
          onPress: onLogout
        })}

        {renderSettingRow({
          icon: Trash2,
          title: t('Удалить аккаунт'),
          hint: t('Удалит аккаунт и все данные без возможности восстановления'),
          danger: true,
          delay: 320,
          onPress: onDeleteAccount
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  languageSheet: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10 },
  languageOption: { borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
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
    width: 72,
    height: 72,
    borderRadius: 36,
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
    fontSize: 28,
    letterSpacing: -0.2,
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
    fontSize: 24,
    color: c.accentGold
  },
  statText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text
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
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center'
  },
  settingIconWrapDanger: {
    backgroundColor: c.dangerSoft
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
