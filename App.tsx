import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { WardrobeScreen } from './src/screens/WardrobeScreen';
import { OutfitBuilderScreen } from './src/screens/OutfitBuilderScreen';
import { RecommendationsScreen } from './src/screens/RecommendationsScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { deleteAccount, readStoredSession, signOut, verifySession, forgetStoredSession, Session } from './src/services/auth';
import { privacyUrl } from './src/constants/ai';
import { RADII, SERIF, SHADOWS, TYPE, ThemeColors } from './src/constants/theme';
import { ThemeProvider, useTheme, useThemedStyles } from './src/constants/ThemeContext';
import { LanguageProvider, localeFor, translate, useLanguage, useT } from './src/constants/i18n';
import { LanguageChooser } from './src/components/LanguageChooser';
import { isAutoItemName, suggestItemName } from './src/domain/itemName';
import { WardrobeItem } from './src/data/mock';
import { loadJson, loadRaw, saveJson } from './src/services/storage';
import { persistPhoto, accountPhotoDirectory, removeUnusedPhotos } from './src/services/photos';
import { accountKey, DATA_KEYS, loadAccountData, prepareAccountStorage, purgeAccountData, startWithoutLegacy, ProfileState } from './src/services/accountStorage';
import { GeneratedLook, SavedLook } from './src/types/looks';
import { AppPressable } from './src/components/AppPressable';
import { PrimaryButton } from './src/components/ui/PrimaryButton';
import { SectionLabel } from './src/components/ui/SectionLabel';
import { FadeInView } from './src/components/ui/FadeInView';
import { Skeleton } from './src/components/ui/Skeleton';
import { Shirt, ScanLine, Sparkles, Heart, UserRound, LucideIcon } from 'lucide-react-native';
import { Gender } from './src/types/profile';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { TryOnJobsProvider, useTryOnJobs } from './src/components/TryOnJobsContext';
import { GenerationDockProvider } from './src/components/GenerationDock';
import { useClosetSync } from './src/components/useClosetSync';
import { AppDialogProvider } from './src/components/AppDialog';
import { AiConsentProvider, useAiConsent } from './src/components/AiConsentContext';

type TabKey = 'wardrobe' | 'builder' | 'recommendations' | 'favorites' | 'profile';

const STORAGE_KEYS = DATA_KEYS;
const DISMISS_DAYS = 14;

const TABS: Array<{ key: TabKey; icon: LucideIcon; label: string }> = [
  { key: 'wardrobe', icon: Shirt, label: 'Гардероб' },
  { key: 'builder', icon: ScanLine, label: 'Примерка' },
  { key: 'recommendations', icon: Sparkles, label: 'Идеи' },
  { key: 'favorites', icon: Heart, label: 'Избранное' },
  { key: 'profile', icon: UserRound, label: 'Профиль' }
];

// Геометрия плавающего таб-бара.
const TAB_BAR_RADIUS = 16;
const TAB_BAR_HEIGHT = 62;
const TAB_BAR_SIDE_MARGIN = 16;
const TAB_INNER_PAD = 8;

const textWithDefaults = Text as unknown as { defaultProps?: { allowFontScaling?: boolean } };
textWithDefaults.defaultProps = textWithDefaults.defaultProps || {};
textWithDefaults.defaultProps.allowFontScaling = false;

const LEGACY_DEFAULT_ITEM_SIGNATURES = new Set([
  '1|Белая футболка oversize|Футболка|Верх',
  '2|Синие джинсы mom-fit|Джинсы|Низ',
  '3|Черный жакет|Пиджак|Верхняя одежда',
  '4|Бежевые лоферы|Обувь|Обувь'
]);

const isLegacyDefaultItem = (item: WardrobeItem) =>
  LEGACY_DEFAULT_ITEM_SIGNATURES.has(`${item.id}|${item.name}|${item.category}|${item.section}`);

// Заставка на время гидрации: серифный логотип с мягким пульсом и скелетон-строчки.
function LoadingScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.loadingWrap}>
      <LinearGradient colors={[colors.heroFrom, colors.heroTo] as const} style={StyleSheet.absoluteFill} />
      <Animated.Text
        style={[
          styles.loadingLogo,
          { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }
        ]}
      >
        {t('AI Стилист')}
      </Animated.Text>
      <View style={styles.loadingHairline} />
      <Skeleton width={148} height={10} radius={5} />
      <Skeleton width={92} height={10} radius={5} style={styles.loadingSkeletonGap} />
    </View>
  );
}

function Onboarding({ onClose }: { onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();

  const steps = [
    t('В профиле добавь фото в полный рост. Чем ровнее свет и поза, тем лучше примерка.'),
    t('В гардеробе сфоткай вещи по одной: верх, низ, обувь. Лучше на однотонном фоне.'),
    t('В конструкторе выбери стиль и событие. Мы покажем только подходящие луки.'),
    t('Нажми генерацию, выбери вариант посадки верха и сохрани удачный образ в избранное.')
  ];

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.heroFrom, colors.heroTo] as const} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.onboardingSafe} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.onboardingWrap} showsVerticalScrollIndicator={false}>
          <FadeInView>
            <Text style={styles.eyebrow}>{t('AI СТИЛИСТ')}</Text>
            <Text style={styles.heroTitle}>{t('Собери гардероб и примеряй луки на себе')}</Text>
            <Text style={styles.heroSubtitle}>
              {t('Приложение подбирает образы из твоих вещей, учитывает стиль, мероприятие, погоду и показывает сгенерированную примерку.')}
            </Text>
          </FadeInView>

          <FadeInView delay={80} style={styles.stepsBlock}>
            <SectionLabel>{t('Как начать')}</SectionLabel>
            {steps.map((step, index) => (
              <View key={index} style={styles.stepCard}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </FadeInView>

          <FadeInView delay={180}>
            <View style={styles.tipCard}>
              <View style={styles.tipHeader}>
                <View style={styles.tipEmojiCircle}>
                  <Text style={styles.tipEmoji}>💡</Text>
                </View>
                <Text style={styles.tipTitle}>{t('Для лучшего результата')}</Text>
              </View>
              <Text style={styles.tipText}>
                {t('Результаты остаются в недавних примерках, даже если сменить вкладку. Для нового варианта используй перегенерацию.')}
              </Text>
            </View>
          </FadeInView>

          <FadeInView delay={260}>
            <PrimaryButton
              title={t('Понятно, начать')}
              onPress={onClose}
              variant="gold"
              size="lg"
              style={styles.onboardingCta}
            />
          </FadeInView>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SessionGate() {
  const language = useLanguage();
  const { isDark, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [claim, setClaim] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const activate = async (next: Session, confirmed = false) => {
    setReady(false); setError('');
    try {
      if (await prepareAccountStorage(next.login, confirmed) === 'claim') setClaim(next);
      else { setClaim(null); setSession(next); }
    } catch { setError(t('Не удалось прочитать данные на устройстве. Попробуй ещё раз.')); }
    finally { setReady(true); }
  };
  useEffect(() => {
    void Promise.all([readStoredSession(), loadRaw('onboardingSeen')]).then(async ([stored, seen]) => {
      setOnboarding(seen.value !== 'true');
      if (stored) await activate(stored);
      else setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void verifySession(session).then(async live => {
      if (!active || live) return;
      await forgetStoredSession(session);
      if (active) setSession(current => current?.token === session.token ? null : current);
    }).catch(() => {});
    return () => { active = false; };
  }, [session?.token]);
  const logout = async () => {
    try {
      await signOut(session);
      setSession(null);
    } catch { setError(t('Не удалось завершить выход. Попробуй ещё раз.')); }
  };
  const removeAccount = async () => {
    if (!session) return;
    try {
      await deleteAccount(session);
      await purgeAccountData(session.login);
      setSession(null);
    } catch (e: any) { setError(e?.message || t('Не удалось удалить аккаунт. Проверь соединение и попробуй ещё раз.')); }
  };
  if (!ready || !language.ready) return <LoadingScreen />;
  if (!language.chosen) return <LanguageChooser />;
  if (onboarding) return <Onboarding onClose={() => {
    setOnboarding(false);
    void AsyncStorage.setItem('onboardingSeen', 'true').catch(() => {});
  }} />;
  if (session) return <TryOnJobsProvider key={session.login} session={session}><AiConsentProvider login={session.login}><AppContent session={session} onLogout={() => void logout()} onDeleteAccount={() => void removeAccount()} accountError={error} /></AiConsentProvider></TryOnJobsProvider>;
  return <SafeAreaView style={styles.container}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    {claim ? <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '600' }}>{t('Гардероб на устройстве')}</Text>
      <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{t('Перенести прежние вещи и образы в аккаунт {login}? Подтверди, только если это твой гардероб.', { login: claim.login })}</Text>
      <PrimaryButton title={t('Перенести мой гардероб')} onPress={() => void activate(claim, true)} />
      <PrimaryButton title={t('Начать без переноса')} variant="ghost" onPress={() => {
        void startWithoutLegacy(claim.login).then(() => activate(claim)).catch(() => setError(t('Не удалось сохранить выбор. Попробуй ещё раз.')));
      }} />
    </View> : <AuthScreen onAuthenticated={next => void activate(next)} />}
    {error ? <Text accessibilityRole="alert" style={{ padding: 20, color: colors.danger }}>{error}</Text> : null}
  </SafeAreaView>;
}

function AppContent({ session, onLogout, onDeleteAccount, accountError }: { session: Session; onLogout: () => void; onDeleteAccount: () => void; accountError: string }) {
  const aiConsent = useAiConsent();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('wardrobe');
  const [tryOnItemId, setTryOnItemId] = useState<string | undefined>();
  const [tryOnItemIds, setTryOnItemIds] = useState<string[] | undefined>();
  // A garment card asks the ideas to be built around that garment.
  const [ideasAnchor, setIdeasAnchor] = useState<{ id: string; at: number } | undefined>();
  const [builderEntry, setBuilderEntry] = useState<'fitting' | 'builder' | 'history'>('fitting');
  const [historyItemId, setHistoryItemId] = useState<string>();
  const [wardrobeDetailId, setWardrobeDetailId] = useState<string>();
  const { store: jobsStore, ready: jobsReady } = useTryOnJobs();
  const [displayName, setDisplayName] = useState(session.displayName || session.login);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const photoDirectory = accountPhotoDirectory(session.login);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [modelUri, setModelUri] = useState<string | undefined>(undefined);
  const [gender, setGender] = useState<Gender>();
  const [beautyAdvice, setBeautyAdvice] = useState(false);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  // Ключи, которые не удалось прочитать: в них запрещено писать, иначе
  // состояние по умолчанию затрёт данные, которые, возможно, ещё спасаемы.
  const unreadableKeys = useRef<Set<string>>(new Set());
  const reportedSaveFailures = useRef<Set<string>>(new Set());
  const [favoriteLooks, setFavoriteLooks] = useState<GeneratedLook[]>([]);
  const [lastLooks, setLastLooks] = useState<GeneratedLook[]>([]);
  const [lastContext, setLastContext] = useState<{ style: string; event: string; weather: string }>({
    style: '',
    event: '',
    weather: ''
  });
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);
  // Looks put aside with "Not now": they sink in the ideas for two weeks.
  const [dismissedLooks, setDismissedLooks] = useState<{ core: string; at: number }[]>([]);
  const [isReady, setReady] = useState(false);
  useEffect(() => {
    if (isReady && jobsReady) void jobsStore.importLooks([...savedLooks, ...favoriteLooks, ...lastLooks], items).catch(() => {});
  }, [isReady, jobsReady, jobsStore, savedLooks, favoriteLooks, lastLooks, items]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Плавающий индикатор активной вкладки.
  const [tabRowWidth, setTabRowWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(TAB_INNER_PAD)).current;
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.key === activeTab));
  const segmentWidth = tabRowWidth > 0 ? (tabRowWidth - TAB_INNER_PAD * 2) / TABS.length : 0;

  useEffect(() => {
    if (segmentWidth <= 0) return;
    Animated.spring(indicatorX, {
      toValue: TAB_INNER_PAD + activeIndex * segmentWidth,
      speed: 18,
      bounciness: 7,
      useNativeDriver: true
    }).start();
  }, [activeIndex, segmentWidth, indicatorX]);

  useEffect(() => {
    const hydrate = async () => {
      const data = await loadAccountData(session.login);
      if (!alive.current) return;
      unreadableKeys.current = data.failed;
      const profile = data.profile;
      if (profile) {
        setDisplayName(profile.displayName || session.displayName || session.login);
        setAvatarUri(profile.avatarUri); setModelUri(profile.modelUri);
        setGender(profile.gender); setBeautyAdvice(profile.beautyAdvice === true);
      }
      // Вещи с заглушкой вместо имени («Новая вещь…», голая категория) получают имя по анализу.
      const cleanedItems = data.items.filter(item => !isLegacyDefaultItem(item)).map(item => {
        if (!isAutoItemName(item.name, item.category)) return item;
        const name = suggestItemName(item);
        return name && name !== item.name ? { ...item, name } : item;
      });
      setItems(cleanedItems); setFavoriteLooks(data.favorites); setLastLooks(data.looks); setSavedLooks(data.saved);
      if (data.context) setLastContext(data.context);
      const dismissed = await loadJson<{ core: string; at: number }[]>(accountKey(session.login, 'dismissedLooks'));
      if (!alive.current) return;
      if (Array.isArray(dismissed.value)) setDismissedLooks(dismissed.value.filter(entry => entry && typeof entry.core === 'string'
        && Number.isFinite(entry.at) && entry.at > Date.now() - DISMISS_DAYS * 86_400_000));
      if (data.failed.size) {
        showToast('Часть сохранённых данных не читается. Она сохранена как есть и не перезаписывается.');
      }
      setReady(true);

      // Файлы, на которые больше никто не ссылается, удаляются один раз при
      // запуске — иначе уборку пришлось бы дублировать в каждом месте, откуда
      // вещь можно удалить.
      const referenced = [
        ...cleanedItems.flatMap((item) => [item.imageUri, item.sourceImageUri]),
        profile?.avatarUri, profile?.modelUri
      ];
      if (!data.failed.size) {
        removeUnusedPhotos(referenced, session.login).catch((error) => console.warn('Failed to clean photo folder', error));
      }

      // Перенос для тех, кто уже пользуется приложением: их фото лежат в
      // AsyncStorage как base64 и занимают там всё место. Разово переписываем
      // такие вещи файлами — иначе лимит хранилища остаётся исчерпанным.
      if (!data.failed.has(STORAGE_KEYS.wardrobe)) {
        void movePhotosToFiles(cleanedItems);
      }
      const legacyAvatar = profile?.avatarUri;
      if (legacyAvatar && !legacyAvatar.startsWith(photoDirectory)) {
        storeProfilePhoto(legacyAvatar, (stored) => setAvatarUri((current) => (current === legacyAvatar ? stored : current)));
      }
      const legacyModel = profile?.modelUri;
      if (legacyModel && !legacyModel.startsWith(photoDirectory)) {
        storeProfilePhoto(legacyModel, (stored) => setModelUri((current) => (current === legacyModel ? stored : current)));
      }
    };

    hydrate().catch((error) => {
      console.warn('Failed to load local state', error);
      unreadableKeys.current = new Set(Object.values(STORAGE_KEYS));
      if (!alive.current) return;
      showToast(t('Не удалось прочитать данные на устройстве. Попробуй ещё раз.'));
      setReady(true);
    });
  }, []);

  // Молчаливая потеря записи — это потерянная вещь, о которой пользователь
  // узнает только после перезапуска. Поэтому о неудаче сообщаем, но один раз
  // на ключ: иначе каждое нажатие вызывало бы новый тост.
  const persist = (key: string, value: unknown, label: string) => {
    if (!isReady || unreadableKeys.current.has(key)) return;
    saveJson(accountKey(session.login, key), value)
      .then(() => reportedSaveFailures.current.delete(key))
      .catch((error) => {
        console.warn(`Failed to save ${key}`, error);
        if (reportedSaveFailures.current.has(key)) return;
        reportedSaveFailures.current.add(key);
        showToast(translate('Не удалось сохранить {label}. Освободи место на устройстве.', { label: translate(label) }));
      });
  };

  // Фото приходят с экранов как data-URL (вырез от сервера) или как путь в
  // кеше ImagePicker. И то и другое нельзя хранить: первое раздувает
  // AsyncStorage до отказа, второе система вправе удалить в любой момент.
  // Поэтому состояние сначала обновляется как есть — чтобы картинка появилась
  // сразу, — а файл переезжает к нам следом, и путь подменяется.
  const movePhotosToFiles = async (next: WardrobeItem[]) => {
    for (const item of next) {
      const updates: Partial<WardrobeItem> = {};
      try {
        if (item.imageUri && !item.imageUri.startsWith(photoDirectory)) {
          updates.imageUri = await persistPhoto(item.imageUri, session.login);
        }
        if (item.sourceImageUri && !item.sourceImageUri.startsWith(photoDirectory)) {
          updates.sourceImageUri = await persistPhoto(item.sourceImageUri, session.login);
        }
      } catch (error) {
        console.warn('Failed to store item photo', error);
        continue;
      }
      if (!alive.current) return;
      if (!Object.keys(updates).length) continue;
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? { ...candidate,
          imageUri: candidate.imageUri === item.imageUri ? updates.imageUri || candidate.imageUri : candidate.imageUri,
          sourceImageUri: candidate.sourceImageUri === item.sourceImageUri ? updates.sourceImageUri || candidate.sourceImageUri : candidate.sourceImageUri } : candidate))
      );
    }
  };

  const handleItemsChange = (next: WardrobeItem[]) => {
    setItems(next);
    void movePhotosToFiles(next);
  };

  const storeProfilePhoto = (uri: string, apply: (stored: string) => void) => {
    persistPhoto(uri, session.login)
      .then((stored) => {
        if (alive.current && stored && stored !== uri) apply(stored);
      })
      .catch((error) => console.warn('Failed to store profile photo', error));
  };

  useEffect(() => {
    const profile: ProfileState = {
      displayName,
      avatarUri,
      modelUri,
      gender,
      beautyAdvice
    };
    persist(STORAGE_KEYS.profile, profile, 'профиль');
  }, [isReady, displayName, avatarUri, modelUri, gender, beautyAdvice]);

  useEffect(() => {
    persist(STORAGE_KEYS.wardrobe, items, 'гардероб');
  }, [isReady, items]);

  useEffect(() => {
    persist(STORAGE_KEYS.favorites, favoriteLooks, 'избранное');
  }, [isReady, favoriteLooks]);

  // The wardrobe and the try-on photo also live on the server, so they survive
  // the phone and appear on another device (services/closetSync.ts).
  useClosetSync({
    session, ready: isReady, items, setItems,
    blocked: () => unreadableKeys.current.has(STORAGE_KEYS.wardrobe) || unreadableKeys.current.has(STORAGE_KEYS.profile),
    profile: { gender, beautyAdvice, modelUri, avatarUri },
    applyProfile: next => {
      setGender(next.gender); setBeautyAdvice(next.beautyAdvice === true);
      setModelUri(next.modelUri); setAvatarUri(next.avatarUri);
    }
  });

  useEffect(() => {
    persist(STORAGE_KEYS.lastContext, lastContext, 'настройки подбора');
  }, [isReady, lastContext]);

  useEffect(() => {
    persist(STORAGE_KEYS.lastLooks, lastLooks, 'подобранные образы');
  }, [isReady, lastLooks]);

  useEffect(() => {
    persist(STORAGE_KEYS.savedLooks, savedLooks, 'сохранённые образы');
  }, [isReady, savedLooks]);

  useEffect(() => {
    persist('dismissedLooks', dismissedLooks, 'скрытые образы');
  }, [isReady, dismissedLooks]);

  useEffect(() => {
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);

  const showToast = (message: string) => {
    // Russian source strings are keys; translated text passes through unchanged.
    setToastMessage(translate(message));
    toastAnim.stopAnimation();
    toastAnim.setValue(0);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    toastTimeout.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        setToastMessage(null);
      });
    }, 1400);
  };

  const screen = (() => {
    const tryOnModelUri = modelUri || avatarUri;
    const favoriteLookIds = new Set(favoriteLooks.map((look) => look.id));
    if (activeTab === 'wardrobe') {
      return <WardrobeScreen items={items} onItemsChange={handleItemsChange} initialDetailId={wardrobeDetailId}
        onOpenHistory={item => { setTryOnItemId(undefined); setTryOnItemIds(undefined); setHistoryItemId(item.id); setBuilderEntry('history'); setActiveTab('builder'); }}
        onTryOn={item => { setTryOnItemIds(undefined); setTryOnItemId(item.id); setBuilderEntry('fitting'); setActiveTab('builder'); }}
        onStyleWith={item => { setIdeasAnchor({ id: item.id, at: Date.now() }); setActiveTab('recommendations'); }} />;
    }
    if (activeTab === 'builder')
      return (
        <OutfitBuilderScreen
          items={items}
          modelUri={tryOnModelUri}
          initialItemId={tryOnItemId}
          initialItemIds={tryOnItemIds}
          initialTab={builderEntry}
          initialHistoryItemId={historyItemId}
          onOpenItem={id => { setWardrobeDetailId(id); setActiveTab('wardrobe'); }}
          gender={gender || 'unspecified'}
          beautyAdvice={beautyAdvice}
          onProfile={() => setActiveTab('profile')}
          onModelChange={uri => {
            setModelUri(uri);
            storeProfilePhoto(uri, stored => setModelUri(current => (current === uri ? stored : current)));
          }}
          onWardrobe={() => { setWardrobeDetailId(undefined); setActiveTab('wardrobe'); }}
          savedLooks={savedLooks}
          onSavedLooksChange={setSavedLooks}
          favoriteLookIds={favoriteLookIds}
          onLooksGenerated={(looks, context) => {
            setLastLooks(looks);
            setLastContext(context);
            showToast(t('Образы готовы'));
          }}
          onFavoriteAdd={(look) => {
            // Повторное нажатие на ту же карточку (до перегенерации) даёт тот же
            // look.id — без дедупа это создавало дубликаты с общим React key и
            // общим id, которые onRemove стирал разом (аудит #22, #37).
            let alreadyAdded = false;
            setFavoriteLooks((prev) => {
              if (prev.some((existing) => existing.id === look.id)) {
                alreadyAdded = true;
                return prev;
              }
              return [look, ...prev];
            });
            if (!alreadyAdded) showToast(t('Добавлено в избранное'));
          }}
        />
      );
    if (activeTab === 'recommendations')
      return <RecommendationsScreen items={items} anchorRequest={ideasAnchor} gender={gender || 'unspecified'} beautyAdvice={beautyAdvice} favorites={favoriteLooks}
        dismissed={dismissedLooks.map(entry => entry.core)}
        onDismiss={core => setDismissedLooks(previous => [{ core, at: Date.now() }, ...previous.filter(entry => entry.core !== core)].slice(0, 60))}
        onFavorite={look => { setFavoriteLooks(previous => previous.some(item => item.id === look.id) ? previous : [look, ...previous]); showToast(t('Добавлено в избранное')); }}
        onWardrobe={() => setActiveTab('wardrobe')} onTryOn={ids => { setTryOnItemId(undefined); setTryOnItemIds(ids); setBuilderEntry('fitting'); setActiveTab('builder'); }} />;
    if (activeTab === 'favorites')
      return (
        <FavoritesScreen
          looks={favoriteLooks}
          beautyAdvice={beautyAdvice}
          items={items}
          onRemove={(id) => setFavoriteLooks((prev) => prev.filter((look) => look.id !== id))}
          onGoToBuilder={() => setActiveTab('builder')}
          onTryOn={ids => { setTryOnItemId(undefined); setTryOnItemIds(ids); setBuilderEntry('fitting'); setActiveTab('builder'); }}
        />
      );
    return (
      <ProfileScreen
        displayName={displayName}
        contact={session?.login || ''}
        authMethod={t('Логин и пароль')}
        avatarUri={avatarUri}
        modelUri={modelUri}
        favoritesCount={favoriteLooks.length}
        gender={gender || 'unspecified'}
        beautyAdvice={beautyAdvice}
        onGenderChange={setGender}
        onBeautyChange={setBeautyAdvice}
        onAvatarChange={(uri) => {
          setAvatarUri(uri);
          setModelUri((prev) => prev || uri);
          storeProfilePhoto(uri, (stored) => {
            setAvatarUri((current) => (current === uri ? stored : current));
            setModelUri((current) => (current === uri ? stored : current));
          });
        }}
        onModelChange={(uri) => {
          setModelUri(uri);
          storeProfilePhoto(uri, (stored) => setModelUri((current) => (current === uri ? stored : current)));
        }}
        onLogout={onLogout}
        onOpenPrivacy={() => { void Linking.openURL(privacyUrl()).catch(() => {}); }}
        onRevokeAiConsent={() => Alert.alert(t('Отозвать согласие?'), t('ИИ-анализ вещей и примерка будут снова спрашивать разрешение перед отправкой фото.'), [
          { text: t('Отмена'), style: 'cancel' },
          { text: t('Отозвать'), style: 'destructive', onPress: () => { void aiConsent.revoke(); } }
        ])}
        onDeleteAccount={() => Alert.alert(t('Удалить аккаунт?'), t('Аккаунт, история примерок на сервере и все данные приложения на этом устройстве будут удалены. Это действие нельзя отменить.'), [
          { text: t('Отмена'), style: 'cancel' },
          { text: t('Удалить'), style: 'destructive', onPress: onDeleteAccount }
        ])}
      />
    );
  })();

  if (!isReady) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <LoadingScreen />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  if (!gender) {
    return <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
      <PreferencesScreen onComplete={preferences => { setGender(preferences.gender); setBeautyAdvice(preferences.beautyAdvice); }} />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>;
  }

  const tabBarBottom = Math.max(insets.bottom, 12);
  const tabBarSpace = TAB_BAR_HEIGHT + tabBarBottom + 10;

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
      {/* Try-ons run above every screen; the folded window sits over the fitting room's own button. */}
      <GenerationDockProvider items={items} modelUri={modelUri || avatarUri} bottom={tabBarSpace + 76}>
      {accountError ? <Text accessibilityRole="alert" style={{ color: colors.danger, padding: 12 }}>{accountError}</Text> : null}
      <View style={[styles.content, { paddingBottom: tabBarSpace }]}>{screen}</View>

      <View style={[styles.tabBarWrap, { bottom: tabBarBottom }]} pointerEvents="box-none">
        <View style={styles.tabBarClip}>
          {Platform.OS !== 'android' ? (
            <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : null}
          <View
            style={styles.tabRow}
            onLayout={(event) => setTabRowWidth(event.nativeEvent.layout.width)}
          >
            {segmentWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.tabIndicator, { width: segmentWidth, transform: [{ translateX: indicatorX }] }]}
              />
            ) : null}
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              const TabIcon = tab.icon;
              return (
                <AppPressable
                  key={tab.key}
                  haptics
                  style={styles.tabItem}
                  accessibilityRole="tab"
                  accessibilityLabel={t(tab.label)}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => { setTryOnItemId(undefined); setTryOnItemIds(undefined); setHistoryItemId(undefined); setWardrobeDetailId(undefined); setBuilderEntry('fitting'); setActiveTab(tab.key); }}
                >
                  <TabIcon size={21} strokeWidth={isActive ? 1.9 : 1.5} color={isActive ? colors.accentGold : colors.muted} />
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t(tab.label)}</Text>
                </AppPressable>
              );
            })}
          </View>
        </View>
      </View>

      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0]
                  })
                }
              ],
              bottom: tabBarBottom + TAB_BAR_HEIGHT + 14
            }
          ]}
        >
          <View style={styles.toastIconCircle}>
            <Text style={styles.toastIcon}>✓</Text>
          </View>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      ) : null}
      </GenerationDockProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LanguageProvider>
          <AppDialogProvider><SessionGate /></AppDialogProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12
  },
  // --- Заставка ---
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32
  },
  loadingLogo: {
    fontFamily: SERIF,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: c.text
  },
  loadingHairline: {
    width: 44,
    height: 1,
    backgroundColor: c.goldHairline,
    marginTop: 18,
    marginBottom: 20
  },
  loadingSkeletonGap: {
    marginTop: 8
  },
  // --- Онбординг ---
  onboardingSafe: {
    flex: 1
  },
  onboardingWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 18
  },
  eyebrow: {
    ...TYPE.eyebrow,
    color: c.accentGold,
    marginBottom: 10
  },
  heroTitle: {
    ...TYPE.display,
    fontSize: 34,
    lineHeight: 40,
    color: c.text,
    marginBottom: 10
  },
  heroSubtitle: {
    ...TYPE.body,
    fontSize: 16,
    color: c.muted
  },
  stepsBlock: {
    gap: 10
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: c.card,
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: 14,
    ...SHADOWS.card
  },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.accentGoldSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.goldHairline,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepBadgeText: {
    fontFamily: SERIF,
    fontSize: 15,
    fontWeight: '700',
    color: c.accentGold
  },
  stepText: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    color: c.text
  },
  tipCard: {
    backgroundColor: c.accentGoldSoft,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: c.goldHairline,
    padding: 16,
    gap: 10
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  tipEmojiCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tipEmoji: {
    fontSize: 14
  },
  tipTitle: {
    ...TYPE.title,
    fontSize: 15,
    color: c.text
  },
  tipText: {
    ...TYPE.caption,
    fontSize: 13,
    lineHeight: 19,
    color: c.muted
  },
  onboardingCta: {
    marginTop: 6
  },
  // --- Плавающий таб-бар ---
  tabBarWrap: {
    position: 'absolute',
    width: '92%',
    maxWidth: 600,
    alignSelf: 'center',
    borderRadius: TAB_BAR_RADIUS,
    ...SHADOWS.floating,
    backgroundColor: c.card
  },
  tabBarClip: {
    borderRadius: TAB_BAR_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.goldHairline,
    backgroundColor: Platform.OS === 'android' ? c.card : c.goldTransparent
  },
  tabRow: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: TAB_INNER_PAD,
    alignItems: 'center'
  },
  tabIndicator: {
    position: 'absolute',
    left: 0,
    top: TAB_INNER_PAD,
    bottom: TAB_INNER_PAD,
    borderRadius: RADII.lg,
    backgroundColor: c.accentGoldSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.goldHairline
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: RADII.lg,
    overflow: Platform.OS === 'android' ? 'hidden' : 'visible'
  },
  tabIcon: {
    fontSize: 18,
    opacity: 0.72
  },
  tabIconActive: {
    opacity: 1
  },
  tabLabel: {
    fontSize: 10,
    color: c.muted,
    fontWeight: '600',
    letterSpacing: 0
  },
  tabLabelActive: {
    color: c.accentGold,
    fontWeight: '700'
  },
  // --- Тост ---
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: RADII.xl,
    backgroundColor: c.toastBg,
    ...SHADOWS.floating
  },
  toastIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.goldHairline,
    alignItems: 'center',
    justifyContent: 'center'
  },
  toastIcon: {
    color: c.toastText,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13
  },
  toastText: {
    color: c.toastText,
    fontSize: 14,
    fontWeight: '600'
  }
});
