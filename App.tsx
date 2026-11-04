import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useFonts, Onest_700Bold, Onest_800ExtraBold, Onest_900Black } from '@expo-google-fonts/onest';
import { TenorSans_400Regular } from '@expo-google-fonts/tenor-sans';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { StudioBackdrop } from './src/components/studio/StudioBackdrop';
import { Glass, Pill } from './src/components/studio/Glass';
import { font, INK, INK_ON_DARK, inkSoft } from './src/components/studio/studio';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { WardrobeScreen } from './src/screens/WardrobeScreen';
import { FittingScreen } from './src/screens/FittingScreen';
import { RecommendationsScreen } from './src/screens/RecommendationsScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { deleteAccount, readStoredSession, signOut, verifySession, forgetStoredSession, Session } from './src/services/auth';
import { privacyUrl } from './src/constants/ai';
import { DISPLAY, RADII, SERIF, SHADOWS, TYPE, ThemeColors } from './src/constants/theme';
import { ThemeProvider, useTheme, useThemedStyles } from './src/constants/ThemeContext';
import { LanguageProvider, localeFor, translate, useLanguage, useT } from './src/constants/i18n';
import { LanguageChooser } from './src/components/LanguageChooser';
import { isAutoItemName, suggestItemName } from './src/domain/itemName';
import { WardrobeItem } from './src/data/mock';
import { loadJson, loadRaw, saveJson } from './src/services/storage';
import { persistPhoto, accountPhotoDirectory, removeUnusedPhotos } from './src/services/photos';
import { accountKey, DATA_KEYS, decodeTraits, loadAccountData, migrateSavedLooks, prepareAccountStorage, purgeAccountData, startWithoutLegacy, ProfileState } from './src/services/accountStorage';
import { readGarmentProfile, readGarmentStyle, readGarmentTraits } from './src/services/ai';
import { decodeGarmentProfile } from './src/domain/garmentTraits';
import { hasAiConsent } from './src/services/aiConsent';
import { GeneratedLook } from './src/types/looks';
import { AppPressable } from './src/components/AppPressable';
import { FadeInView } from './src/components/ui/FadeInView';
import { Skeleton } from './src/components/ui/Skeleton';
import { Shirt, PersonStanding, Layers, Heart, UserRound, Lightbulb, LucideIcon } from 'lucide-react-native';
import { Gender } from './src/types/profile';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { TryOnJobsProvider, useTryOnJobs } from './src/components/TryOnJobsContext';
import { GenerationDockProvider } from './src/components/GenerationDock';
import { FavoritesProvider } from './src/components/SaveLook';
import { editFavorite, removeFavorite } from './src/domain/favorites';
import { OverlayProvider } from './src/components/OverlayHost';
import { useClosetSync } from './src/components/useClosetSync';
import { AppDialogProvider } from './src/components/AppDialog';
import { FirstLook, useFirstLookGate } from './src/components/onboarding/FirstLook';
import { hasLocalHistory } from './src/components/onboarding/firstLookLogic';
import { AiConsentProvider, useAiConsent } from './src/components/AiConsentContext';

type TabKey = 'wardrobe' | 'fitting' | 'recommendations' | 'favorites' | 'profile';

const STORAGE_KEYS = DATA_KEYS;
const DISMISS_DAYS = 14;
// The sections the outfit ideas are built from: their items get a stylist's profile.
const PROFILED_SECTIONS = new Set(['Верх', 'Низ', 'Обувь', 'Верхняя одежда', 'Сумки']);

const TABS: Array<{ key: TabKey; icon: LucideIcon; label: string }> = [
  { key: 'wardrobe', icon: Shirt, label: 'Гардероб' },
  { key: 'fitting', icon: PersonStanding, label: 'Примерка' },
  { key: 'recommendations', icon: Layers, label: 'Идеи' },
  { key: 'favorites', icon: Heart, label: 'Избранное' },
  { key: 'profile', icon: UserRound, label: 'Профиль' }
];

// The floating glass tab bar: its height and the gap under it.
const TAB_BAR_RADIUS = 31;
const TAB_BAR_HEIGHT = 62;
const TAB_BAR_GAP = 12;
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
      else {
        // Per account: another account on this phone has its own first minute. useFirstLookGate still hides it for anyone with data.
        const seen = await loadRaw(accountKey(next.login, ONBOARDING_SEEN));
        setOnboarding(seen.value !== 'true');
        setClaim(null); setSession(next);
      }
    } catch { setError(t('Не удалось прочитать данные на устройстве. Попробуй ещё раз.')); }
    finally { setReady(true); }
  };
  useEffect(() => {
    void Promise.all([readStoredSession(), loadRaw(ONBOARDING_SEEN)]).then(async ([stored, legacy]) => {
      // The old flag was one per device: it now belongs to the account signed in when it is met, once.
      if (legacy.value === 'true') {
        if (stored) await AsyncStorage.setItem(accountKey(stored.login, ONBOARDING_SEEN), 'true').catch(() => {});
        await AsyncStorage.removeItem(ONBOARDING_SEEN).catch(() => {});
      }
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
  const finishFirstLook = () => {
    setOnboarding(false);
    if (session) void AsyncStorage.setItem(accountKey(session.login, ONBOARDING_SEEN), 'true').catch(() => {});
  };
  // App-wide windows (consent, generation) are drawn in the topmost sheet: see OverlayHost.
  if (session) return <TryOnJobsProvider key={session.login} session={session}><OverlayProvider><AiConsentProvider login={session.login}><AppContent session={session} firstLookPending={onboarding} onFirstLookDone={finishFirstLook} onLogout={() => void logout()} onDeleteAccount={() => void removeAccount()} accountError={error} /></AiConsentProvider></OverlayProvider></TryOnJobsProvider>;
  // The studio fills the whole screen; only the content keeps inside the safe area.
  return <StudioBackdrop><SafeAreaView style={{ flex: 1 }}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    {claim ? <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
      <Text style={[font('semibold'), { color: isDark ? INK_ON_DARK : INK, fontSize: 24 }]}>{t('Гардероб на устройстве')}</Text>
      <Text style={[font('regular'), { color: inkSoft(isDark), fontSize: 16, lineHeight: 24 }]}>{t('Перенести прежние вещи и образы в аккаунт {login}? Подтверди, только если это твой гардероб.', { login: claim.login })}</Text>
      <Pill variant="primary" title={t('Перенести мой гардероб')} haptics={false} onPress={() => void activate(claim, true)} />
      <Pill title={t('Начать без переноса')} haptics={false} onPress={() => {
        void startWithoutLegacy(claim.login).then(() => activate(claim)).catch(() => setError(t('Не удалось сохранить выбор. Попробуй ещё раз.')));
      }} />
    </View> : <AuthScreen onAuthenticated={next => void activate(next)} />}
    {error ? <Text accessibilityRole="alert" style={[font('regular'), { padding: 20, color: colors.danger }]}>{error}</Text> : null}
  </SafeAreaView></StudioBackdrop>;
}

const ONBOARDING_SEEN = 'onboardingSeen';

function AppContent({ session, firstLookPending, onFirstLookDone, onLogout, onDeleteAccount, accountError }: { session: Session; firstLookPending: boolean; onFirstLookDone: () => void; onLogout: () => void; onDeleteAccount: () => void; accountError: string }) {
  const aiConsent = useAiConsent();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('wardrobe');
  // The first try-on the user chose to wait for in the app: the small window takes it over.
  const [firstLookJob, setFirstLookJob] = useState<string | undefined>();
  const [tryOnItemId, setTryOnItemId] = useState<string | undefined>();
  const [tryOnItemIds, setTryOnItemIds] = useState<string[] | undefined>();
  // A garment card asks the ideas to be built around that garment.
  const [ideasAnchor, setIdeasAnchor] = useState<{ id: string; at: number } | undefined>();
  const [builderEntry, setBuilderEntry] = useState<'fitting' | 'history'>('fitting');
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
  // Looks of the retired «Подбор», as they were stored: only their try-ons are of use, to the journal.
  const [lastLooks, setLastLooks] = useState<GeneratedLook[]>([]);
  const [lastContext, setLastContext] = useState<{ style: string; event: string; weather: string }>({
    style: '',
    event: '',
    weather: ''
  });
  // Looks still waiting in the retired list (it could not be moved into the favourites yet): the account is not new.
  const [savedWaiting, setSavedWaiting] = useState(0);
  // Looks put aside with "Not now": they sink in the ideas for two weeks.
  const [dismissedLooks, setDismissedLooks] = useState<{ core: string; at: number }[]>([]);
  const [isReady, setReady] = useState(false);
  useEffect(() => {
    if (isReady && jobsReady) void jobsStore.importLooks([...favoriteLooks, ...lastLooks], items).catch(() => {});
  }, [isReady, jobsReady, jobsStore, favoriteLooks, lastLooks, items]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);


  useEffect(() => {
    const hydrate = async () => {
      const data = await loadAccountData(session.login);
      // Before anything is shown or written: the old list of looks joins the favourites.
      const moved = await migrateSavedLooks(session.login, data);
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
      setItems(cleanedItems); setFavoriteLooks(moved.favorites); setLastLooks(data.looks); setSavedWaiting(moved.pending);
      if (data.context) setLastContext(data.context);
      const dismissed = await loadJson<{ core: string; at: number }[]>(accountKey(session.login, 'dismissedLooks'));
      if (!alive.current) return;
      if (Array.isArray(dismissed.value)) setDismissedLooks(dismissed.value.filter(entry => entry && typeof entry.core === 'string'
        && Number.isFinite(entry.at) && entry.at > Date.now() - DISMISS_DAYS * 86_400_000));
      if (data.failed.size) {
        showToast('Часть сохранённых данных не читается. Она сохранена как есть и не перезаписывается.');
      } else if (moved.pending) {
        showToast('Не удалось перенести образы в избранное. Они целы: попробуем при следующем запуске.');
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

  // Items the server has not read yet get its reading once, in the background: the traits
  // (sleeves, length, front opening, bulk) for the try-on, and the stylist's profile (kind,
  // fabric, fit, formality, warmth, styles) for the outfit ideas. Only with the AI consent already
  // given; one item every couple of seconds; an item that could not be read is tried again on the
  // next launch.
  const traitsAsked = useRef(new Set<string>());
  const profileAsked = useRef(new Set<string>());
  const styleAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!isReady) return;
    const photo = (item: WardrobeItem) => item.sourceImageUri || item.imageUri;
    const needsTraits = (item: WardrobeItem) => !item.traits && ['Верх', 'Верхняя одежда'].includes(item.section) && !traitsAsked.current.has(item.id);
    const needsProfile = (item: WardrobeItem) => !item.profile && PROFILED_SECTIONS.has(item.section) && !profileAsked.current.has(item.id);
    // The style vector reads the card picture (cut out or smoothed), close to the product photos it learned from.
    const needsStyle = (item: WardrobeItem) => !item.styleVec && item.imageUri && PROFILED_SECTIONS.has(item.section) && !styleAsked.current.has(`${item.id}:${item.imageUri.length}`);
    const pending = items.filter(item => photo(item) && (needsTraits(item) || needsProfile(item) || needsStyle(item)));
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      if (!(await hasAiConsent(session.login))) return;
      for (const item of pending) {
        if (cancelled || !alive.current) return;
        if (needsTraits(item)) {
          traitsAsked.current.add(item.id);
          try {
            const traits = decodeTraits(await readGarmentTraits(photo(item) || '', item.category));
            if (traits && alive.current) {
              setItems(current => current.map(candidate => candidate.id === item.id && !candidate.traits ? { ...candidate, traits } : candidate));
            }
          } catch { /* offline or busy: read again on the next launch */ }
        }
        if (needsProfile(item)) {
          profileAsked.current.add(item.id);
          try {
            const profile = decodeGarmentProfile(await readGarmentProfile(photo(item) || '', item.category));
            if (profile && alive.current) {
              setItems(current => current.map(candidate => candidate.id === item.id && !candidate.profile ? { ...candidate, profile } : candidate));
            }
          } catch { /* the same: again on the next launch */ }
        }
        if (needsStyle(item) && item.imageUri) {
          const card = item.imageUri;
          styleAsked.current.add(`${item.id}:${card.length}`);
          try {
            const styleVec = await readGarmentStyle(card, item.category, item.section);
            if (styleVec && alive.current) {
              setItems(current => current.map(candidate => candidate.id === item.id && candidate.imageUri === card ? { ...candidate, styleVec } : candidate));
            }
          } catch { /* the same */ }
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    })();
    return () => { cancelled = true; };
  }, [isReady, items]);

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

  const changeAvatar = (uri: string) => {
    setAvatarUri(uri);
    setModelUri((prev) => prev || uri);
    storeProfilePhoto(uri, (stored) => {
      setAvatarUri((current) => (current === uri ? stored : current));
      setModelUri((current) => (current === uri ? stored : current));
    });
  };

  // Decided on what this account already has, before the flow adds anything of its own.
  const firstLook = useFirstLookGate({
    pending: firstLookPending, ready: isReady && jobsReady, session, onRemember: onFirstLookDone,
    unreadable: unreadableKeys.current.size > 0,
    local: hasLocalHistory({ items: items.length, photo: Boolean(modelUri || avatarUri), jobs: jobsStore.getSnapshot().jobs.length, looks: favoriteLooks.length + savedWaiting }),
  });

  const favoritesApi = useMemo(() => ({ favorites: favoriteLooks, setFavorites: setFavoriteLooks, login: session.login, notify: showToast }), [favoriteLooks, session.login]);

  const screen = (() => {
    const tryOnModelUri = modelUri || avatarUri;
    if (activeTab === 'wardrobe') {
      return <WardrobeScreen items={items} onItemsChange={handleItemsChange} initialDetailId={wardrobeDetailId}
        onOpenHistory={item => { setTryOnItemId(undefined); setTryOnItemIds(undefined); setHistoryItemId(item.id); setBuilderEntry('history'); setActiveTab('fitting'); }}
        onTryOn={item => { setTryOnItemIds(undefined); setTryOnItemId(item.id); setBuilderEntry('fitting'); setActiveTab('fitting'); }}
        onStyleWith={item => { setIdeasAnchor({ id: item.id, at: Date.now() }); setActiveTab('recommendations'); }} />;
    }
    if (activeTab === 'fitting')
      return (
        <FittingScreen
          items={items}
          modelUri={tryOnModelUri}
          initialItemId={tryOnItemId}
          initialItemIds={tryOnItemIds}
          initialTab={builderEntry}
          initialHistoryItemId={historyItemId}
          onOpenItem={id => { setWardrobeDetailId(id); setActiveTab('wardrobe'); }}
          onProfile={() => setActiveTab('profile')}
          onModelChange={uri => {
            setModelUri(uri);
            storeProfilePhoto(uri, stored => setModelUri(current => (current === uri ? stored : current)));
          }}
          onWardrobe={() => { setWardrobeDetailId(undefined); setActiveTab('wardrobe'); }}
        />
      );
    if (activeTab === 'recommendations')
      return <RecommendationsScreen items={items} login={session.login} displayName={displayName} initialStyle={lastContext.style} initialEvent={lastContext.event} anchorRequest={ideasAnchor} gender={gender || 'unspecified'} beautyAdvice={beautyAdvice}
        dismissed={dismissedLooks.map(entry => entry.core)}
        onContext={({ style, event }) => setLastContext(current => current.style === style && current.event === event ? current : { ...current, style, event })}
        onDismiss={core => setDismissedLooks(previous => [{ core, at: Date.now() }, ...previous.filter(entry => entry.core !== core)].slice(0, 60))}
        onWardrobe={() => setActiveTab('wardrobe')} onTryOn={ids => { setTryOnItemId(undefined); setTryOnItemIds(ids); setBuilderEntry('fitting'); setActiveTab('fitting'); }} />;
    if (activeTab === 'favorites')
      return (
        <FavoritesScreen
          looks={favoriteLooks}
          beautyAdvice={beautyAdvice}
          items={items}
          modelUri={tryOnModelUri}
          onRemove={(id) => setFavoriteLooks((prev) => removeFavorite(prev, id))}
          onEdit={(id, change) => setFavoriteLooks((prev) => editFavorite(prev, id, change))}
          onGoToBuilder={() => { setTryOnItemId(undefined); setTryOnItemIds(undefined); setBuilderEntry('fitting'); setActiveTab('fitting'); }}
          onTryOn={ids => { setTryOnItemId(undefined); setTryOnItemIds(ids); setBuilderEntry('fitting'); setActiveTab('fitting'); }}
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
        onAvatarChange={changeAvatar}
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

  if (firstLook === 'checking' && firstLookPending) {
    return <SafeAreaView style={styles.container} edges={['left', 'right']}><LoadingScreen /></SafeAreaView>;
  }
  if (firstLook === 'show') {
    return <FavoritesProvider value={favoritesApi}><FirstLook login={session.login} items={items} modelUri={modelUri || avatarUri} onProfilePhoto={changeAvatar}
      onAddItem={item => handleItemsChange([item, ...items])}
      onPreference={(field, value) => setLastContext(current => ({ ...current, [field]: value }))}
      onLateJob={setFirstLookJob}
      onDone={(exit, jobId) => { setActiveTab(exit); if (jobId) setFirstLookJob(jobId); onFirstLookDone(); }} /></FavoritesProvider>;
  }

  // Screens leave this much room at the bottom so the floating bar never covers their last row.
  const tabBarSpace = TAB_BAR_HEIGHT + TAB_BAR_GAP + Math.max(insets.bottom, 14) + 8;

  return (
    <StudioBackdrop>
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
      {/* Try-ons run above every screen; the folded window sits over the fitting room's own button. */}
      <FavoritesProvider value={favoritesApi}>
      <GenerationDockProvider items={items} modelUri={modelUri || avatarUri} bottom={tabBarSpace + 76} initialDocked={firstLookJob}>
      {accountError ? <Text accessibilityRole="alert" style={{ color: colors.danger, padding: 12 }}>{accountError}</Text> : null}
      <View style={[styles.content, { paddingBottom: tabBarSpace }]}>{screen}</View>

      {/* The floating glass tab bar: the active tab is a black pill with its label, the others icons only. */}
      <View style={[styles.tabBarWrap, { bottom: Math.max(insets.bottom, 14) }]} pointerEvents="box-none">
        <Glass radius={TAB_BAR_RADIUS} intensity={50} style={styles.tabBarClip}>
          <View style={styles.tabRow}>
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              const TabIcon = tab.icon;
              return (
                <AppPressable
                  key={tab.key}
                  haptics
                  style={[styles.tabItem, isActive && styles.tabItemActive]}
                  accessibilityRole="tab"
                  accessibilityLabel={t(tab.label)}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => { setTryOnItemId(undefined); setTryOnItemIds(undefined); setHistoryItemId(undefined); setWardrobeDetailId(undefined); setBuilderEntry('fitting'); setActiveTab(tab.key); }}
                >
                  <TabIcon size={isActive ? 19 : 22} strokeWidth={1.8} color={isActive ? '#FFFFFF' : '#4A4F57'} />
                  {isActive ? <Text style={styles.tabLabelActive} numberOfLines={1}>{t(tab.label)}</Text> : null}
                </AppPressable>
              );
            })}
          </View>
        </Glass>
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
              bottom: tabBarSpace + 12
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
      </FavoritesProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>
    </StudioBackdrop>
  );
}

export default function App() {
  // The display serif of every title; shown before it loads, the titles would jump.
  const [fontsReady, fontError] = useFonts({ Onest_700Bold, Onest_800ExtraBold, Onest_900Black, TenorSans_400Regular, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  const scheme = useColorScheme();
  if (!fontsReady && !fontError) return <View style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#000000' : '#FFFFFF' }} />;
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
  // The studio backdrop (StudioBackdrop) shows through every screen.
  container: {
    flex: 1,
    backgroundColor: 'transparent'
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
    fontFamily: DISPLAY,
    fontSize: 38,
    letterSpacing: -1,
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
  // --- Плавающий таб-бар ---
  // Docked, flat, a hairline above: the storefront kind of tab bar.
  tabBarWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center'
  },
  tabBarClip: {
    width: '100%',
    maxWidth: 520,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  tabRow: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: TAB_INNER_PAD,
    alignItems: 'center',
    justifyContent: 'space-around'
  },
  tabItem: {
    height: 46,
    minWidth: 46,
    borderRadius: 23,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  tabItemActive: {
    backgroundColor: INK,
    paddingHorizontal: 16
  },
  tabLabelActive: {
    ...font('semibold'),
    color: '#FFFFFF',
    fontSize: 13
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
    borderRadius: 4,
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
