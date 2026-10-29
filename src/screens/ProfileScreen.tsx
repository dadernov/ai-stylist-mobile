import { useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PersonStanding } from 'lucide-react-native';
import { usePhotoPicker } from '../components/usePhotoPicker';
import { useTheme } from '../constants/ThemeContext';
import { LANGUAGES, useLanguage, useT } from '../constants/i18n';
import { AppPressable } from '../components/AppPressable';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { FadeInView } from '../components/ui/FadeInView';
import { Gender } from '../types/profile';
import { StylePreferencesFields } from '../components/StylePreferencesFields';
import { ChoiceSheet, SettingsPanel, SettingsRow } from '../components/SettingsRows';
import { PhotoAdvice } from '../components/PhotoAdvice';
import { PhotoGuide } from '../components/PhotoGuide';
import { ProductHelp } from '../components/ProductHelp';
import { Glass, Pill } from '../components/studio/Glass';
import { font, INK } from '../components/studio/studio';

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
  const t = useT();
  const { mode, setMode, colors: c, isDark } = useTheme();
  const { lang, setLang } = useLanguage();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const { pickPhoto: pickImageFromGallery, cropModal } = usePhotoPicker();

  const handlePickAvatar = async () => {
    const uri = await pickImageFromGallery();
    if (uri) onAvatarChange(uri);
  };

  const handlePickModel = async () => {
    const uri = await pickImageFromGallery();
    if (uri) onModelChange(uri);
  };

  const name = t(displayName);
  const onInk = isDark ? INK : '#FFFFFF';

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('Профиль')} />

      {previewUri ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPreviewUri(null)}>
          <View style={styles.previewBackdrop}>
            <Image source={{ uri: previewUri }} style={styles.previewImageFull} resizeMode="contain" />
            {/* The preview is black in either theme, so its button is fixed light-on-dark. */}
            <AppPressable haptics accessibilityRole="button" accessibilityLabel={t('Закрыть')} style={styles.previewClose} onPress={() => setPreviewUri(null)}>
              <Text style={[font('semibold'), { fontSize: 15, color: '#FFFFFF' }]}>{t('Закрыть')}</Text>
            </AppPressable>
          </View>
        </Modal>
      ) : null}
      <ChoiceSheet visible={languageOpen} title={t('Язык')} options={LANGUAGES.map(item => ({ value: item.code, label: item.label }))} value={lang}
        onChoose={code => { setLang(code); setLanguageOpen(false); }} onClose={() => setLanguageOpen(false)} />
      {helpOpen ? <ProductHelp onClose={() => setHelpOpen(false)} /> : null}
      {cropModal}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeInView delay={0}>
          <View style={styles.account}>
            <AppPressable haptics accessibilityRole="button" accessibilityLabel={t('Фото профиля')} style={styles.avatar} onPress={handlePickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarImage, styles.avatarInitial, { backgroundColor: isDark ? '#FFFFFF' : INK }]}>
                  <Text style={[font('semibold'), { fontSize: 24, color: onInk }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
                </View>
              )}
            </AppPressable>
            <View style={styles.accountInfo}>
              <Text style={[font('semibold'), styles.userName, { color: c.text }]} numberOfLines={1}>{name}</Text>
              <Text style={[font('regular'), styles.userMeta, { color: c.muted }]} numberOfLines={1}>{contact || t('Контакт не указан')}</Text>
              <Text style={[font('regular'), styles.userMeta, { color: c.muted }]} numberOfLines={1}>{t('Вход: {method}', { method: t(authMethod).toLocaleLowerCase() })}</Text>
            </View>
          </View>
        </FadeInView>

        <FadeInView delay={60}>
          <Glass radius={28} style={styles.tryOn}>
            <View style={styles.tryOnRow}>
              {/* The try-on photo is the person every look is put on; the full-length picture opens on tap. */}
              <AppPressable style={styles.photo} onPress={() => (modelUri ? setPreviewUri(modelUri) : handlePickModel())}
                accessibilityRole={modelUri ? 'imagebutton' : 'button'} accessibilityLabel={t(modelUri ? 'Фото для примерки' : '+ Добавить фото модели')}>
                {modelUri ? (
                  <Image source={{ uri: modelUri }} style={styles.photoImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.photoImage, styles.photoEmpty, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}>
                    <PersonStanding size={30} strokeWidth={1.3} color={c.muted} />
                  </View>
                )}
              </AppPressable>
              <View style={styles.tryOnBody}>
                <Text style={[font('semibold'), styles.tryOnTitle, { color: c.text }]}>{t('Фото для примерки')}</Text>
                <Text style={[font('regular'), styles.tryOnHint, { color: c.muted }]}>
                  {t('Встань в полный рост, лицом к камере, руки чуть в стороны. Лучше всего — облегающая одежда: лосины или шорты и топ, спортивная форма. Тогда примерка точно повторит твою фигуру.')}
                </Text>
                <Pill variant="primary" size="sm" title={t(modelUri ? 'Заменить фото' : 'Выбрать из галереи')} onPress={handlePickModel} style={styles.replace} />
              </View>
            </View>
            {modelUri ? null : <View style={styles.guide}><PhotoGuide /></View>}
            <Text style={[font('regular'), styles.privacy, { color: c.muted }]}>
              {t('Хороший свет, без объёмной верхней одежды и сумок. Фото видишь только ты, оно нужно только для примерки.')}
            </Text>
            {modelUri ? <View style={styles.advice}><PhotoAdvice uri={modelUri} /></View> : null}
          </Glass>
        </FadeInView>

        <FadeInView delay={120}>
          <SettingsPanel>
            <StylePreferencesFields bare gender={gender} beautyAdvice={beautyAdvice} onGenderChange={onGenderChange} onBeautyChange={onBeautyChange} />
            <SettingsRow title={t('Язык')} value={LANGUAGES.find(item => item.code === lang)?.label} onPress={() => setLanguageOpen(true)} />
            <SettingsRow title={t('Тема оформления')} value={t(mode === 'dark' ? 'Тёмная' : 'Светлая')} onPress={() => setMode(mode === 'dark' ? 'light' : 'dark')} />
            <SettingsRow title={t('Политика конфиденциальности')} hint={t('Какие данные обрабатываются и где')} onPress={onOpenPrivacy} />
            <SettingsRow title={t('Согласие на обработку фото ИИ')} hint={t('Отозвать разрешение на отправку фото нейросетям')} onPress={onRevokeAiConsent} />
            <SettingsRow danger title={t('Удалить аккаунт')} hint={t('Удалит аккаунт и все данные без возможности восстановления')} onPress={onDeleteAccount} />
          </SettingsPanel>
        </FadeInView>

        <FadeInView delay={180}>
          <View style={styles.actions}>
            <Pill title={t('Как это работает')} style={styles.help} onPress={() => setHelpOpen(true)} />
            <AppPressable haptics accessibilityRole="button" accessibilityLabel={t('Выйти из аккаунта')} onPress={onLogout} style={styles.logout}>
              <Glass>
                <View style={styles.logoutInner}>
                  <Text style={[font('semibold'), { fontSize: 15, color: c.danger }]} numberOfLines={1}>{t('Выйти')}</Text>
                </View>
              </Glass>
            </AppPressable>
          </View>
        </FadeInView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 12, paddingBottom: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  avatar: { borderRadius: 32 },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarInitial: { alignItems: 'center', justifyContent: 'center' },
  accountInfo: { flex: 1, gap: 1 },
  userName: { fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  userMeta: { fontSize: 13, lineHeight: 18 },
  tryOn: { padding: 12 },
  tryOnRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { borderRadius: 18 },
  photoImage: { width: 74, height: 100, borderRadius: 18 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  tryOnBody: { flex: 1 },
  tryOnTitle: { fontSize: 15, lineHeight: 20 },
  tryOnHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  replace: { alignSelf: 'flex-start', marginTop: 8 },
  advice: { marginTop: 12 },
  guide: { marginTop: 14 },
  privacy: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  help: { flex: 1 },
  logout: { borderRadius: 999 },
  logoutInner: { height: 50, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 16 },
  previewImageFull: { width: '100%', height: '86%' },
  previewClose: { alignSelf: 'center', marginTop: 12, height: 44, paddingHorizontal: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' }
});
