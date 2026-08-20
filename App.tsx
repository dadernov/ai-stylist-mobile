import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { RADII, SERIF, SHADOWS, TYPE, ThemeColors } from './src/constants/theme';
import { ThemeProvider, useTheme, useThemedStyles } from './src/constants/ThemeContext';
import { LanguageProvider, useT } from './src/constants/i18n';
import { WardrobeItem } from './src/data/mock';
import { GeneratedLook, SavedLook } from './src/types/looks';
import { AppPressable } from './src/components/AppPressable';
import { PrimaryButton } from './src/components/ui/PrimaryButton';
import { SectionLabel } from './src/components/ui/SectionLabel';
import { FadeInView } from './src/components/ui/FadeInView';
import { Skeleton } from './src/components/ui/Skeleton';

type TabKey = 'wardrobe' | 'builder' | 'recommendations' | 'favorites' | 'profile';

type ProfileState = {
  isAuthenticated: boolean;
  displayName: string;
  contact: string;
  authMethod: string;
  avatarUri?: string;
  modelUri?: string;
};

const STORAGE_KEYS = {
  profile: 'profileState',
  wardrobe: 'wardrobeItems',
  favorites: 'favoriteLooks',
  lastContext: 'lastContext',
  lastLooks: 'lastLooks',
  savedLooks: 'savedLooks',
  onboardingSeen: 'onboardingSeen'
};

const TABS: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: 'wardrobe', icon: '👗', label: 'Гардероб' },
  { key: 'builder', icon: '✨', label: 'Конструктор' },
  { key: 'recommendations', icon: '💡', label: 'Идеи' },
  { key: 'favorites', icon: '⭐️', label: 'Избранное' },
  { key: 'profile', icon: '👤', label: 'Профиль' }
];

// Геометрия плавающего таб-бара.
const TAB_BAR_RADIUS = 28;
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

const normalizeGeneratedLook = (look: GeneratedLook): GeneratedLook => ({
  ...look,
  itemIds: look.itemIds ?? [],
  fitScore: typeof look.fitScore === 'number' ? look.fitScore : undefined,
  fitReasons: Array.isArray(look.fitReasons) ? look.fitReasons.filter((item) => typeof item === 'string') : undefined,
  tuckMode:
    look.tuckMode === 'tucked' || look.tuckMode === 'untucked' || look.tuckMode === 'auto'
      ? look.tuckMode
      : undefined,
  tryOnImageUri: typeof look.tryOnImageUri === 'string' ? look.tryOnImageUri : undefined,
  tryOnWarning: typeof look.tryOnWarning === 'string' ? look.tryOnWarning : undefined,
  tryOnUpdatedAt: typeof look.tryOnUpdatedAt === 'number' ? look.tryOnUpdatedAt : undefined,
  tryOnQualityMode: look.tryOnQualityMode === 'fast' || look.tryOnQualityMode === 'quality' ? look.tryOnQualityMode : undefined,
  tryOnHistory: Array.isArray(look.tryOnHistory)
    ? look.tryOnHistory.filter((item) => typeof item?.imageUri === 'string' && typeof item?.updatedAt === 'number')
    : undefined
});

const normalizeSavedLook = (look: SavedLook): SavedLook => ({
  ...look,
  itemIds: look.itemIds ?? [],
  fitScore: typeof look.fitScore === 'number' ? look.fitScore : undefined,
  fitReasons: Array.isArray(look.fitReasons) ? look.fitReasons.filter((item) => typeof item === 'string') : undefined,
  tuckMode:
    look.tuckMode === 'tucked' || look.tuckMode === 'untucked' || look.tuckMode === 'auto'
      ? look.tuckMode
      : undefined,
  tryOnImageUri: typeof look.tryOnImageUri === 'string' ? look.tryOnImageUri : undefined,
  tryOnWarning: typeof look.tryOnWarning === 'string' ? look.tryOnWarning : undefined,
  tryOnUpdatedAt: typeof look.tryOnUpdatedAt === 'number' ? look.tryOnUpdatedAt : undefined,
  tryOnQualityMode: look.tryOnQualityMode === 'fast' || look.tryOnQualityMode === 'quality' ? look.tryOnQualityMode : undefined,
  tryOnHistory: Array.isArray(look.tryOnHistory)
    ? look.tryOnHistory.filter((item) => typeof item?.imageUri === 'string' && typeof item?.updatedAt === 'number')
    : undefined
});

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
                {t('Не закрывай приложение во время генерации. Если вещь сложная, перегенерация может дать заметно лучший вариант.')}
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

function AppContent() {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('wardrobe');
  const [isOnboardingVisible, setOnboardingVisible] = useState(true);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [displayName, setDisplayName] = useState('Гость');
  const [contact, setContact] = useState('');
  const [authMethod, setAuthMethod] = useState('Не выбран');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [modelUri, setModelUri] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [favoriteLooks, setFavoriteLooks] = useState<GeneratedLook[]>([]);
  const [lastLooks, setLastLooks] = useState<GeneratedLook[]>([]);
  const [lastContext, setLastContext] = useState<{ style: string; event: string; weather: string }>({
    style: '',
    event: '',
    weather: ''
  });
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);
  const [isReady, setReady] = useState(false);
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
      try {
        const [profileRaw, itemsRaw, favoritesRaw, contextRaw, looksRaw, savedRaw, onboardingSeenRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.wardrobe),
          AsyncStorage.getItem(STORAGE_KEYS.favorites),
          AsyncStorage.getItem(STORAGE_KEYS.lastContext),
          AsyncStorage.getItem(STORAGE_KEYS.lastLooks),
          AsyncStorage.getItem(STORAGE_KEYS.savedLooks),
          AsyncStorage.getItem(STORAGE_KEYS.onboardingSeen)
        ]);

        setOnboardingVisible(onboardingSeenRaw !== 'true');

        if (profileRaw) {
          const profile: ProfileState = JSON.parse(profileRaw);
          setAuthenticated(profile.isAuthenticated);
          setDisplayName(profile.displayName || 'Гость');
          setContact(profile.contact || '');
          setAuthMethod(profile.authMethod || 'Не выбран');
          setAvatarUri(profile.avatarUri);
          setModelUri(profile.modelUri);
        }

        if (itemsRaw) {
          const storedItems: WardrobeItem[] = JSON.parse(itemsRaw);
          const cleanedItems = (Array.isArray(storedItems) ? storedItems : []).filter(
            (item) => !isLegacyDefaultItem(item)
          );
          setItems(cleanedItems);
        }

        if (favoritesRaw) {
          const storedFavorites: GeneratedLook[] = JSON.parse(favoritesRaw);
          const normalizedFavorites = (Array.isArray(storedFavorites) ? storedFavorites : []).map(
            normalizeGeneratedLook
          );
          setFavoriteLooks(normalizedFavorites);
        }

        if (contextRaw) {
          const storedContext: { style: string; event: string; weather: string } = JSON.parse(contextRaw);
          setLastContext(storedContext);
        }

        if (looksRaw) {
          const storedLooks: GeneratedLook[] = JSON.parse(looksRaw);
          const normalized = (Array.isArray(storedLooks) ? storedLooks : []).map(normalizeGeneratedLook);
          setLastLooks(normalized);
        }

        if (savedRaw) {
          const storedSaved: SavedLook[] = JSON.parse(savedRaw);
          setSavedLooks((Array.isArray(storedSaved) ? storedSaved : []).map(normalizeSavedLook));
        }
      } catch (error) {
        console.warn('Failed to load local state', error);
      } finally {
        setReady(true);
      }
    };

    hydrate();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const profile: ProfileState = {
      isAuthenticated,
      displayName,
      contact,
      authMethod,
      avatarUri,
      modelUri
    };
    AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile)).catch((error) =>
      console.warn('Failed to save profile', error)
    );
  }, [isReady, isAuthenticated, displayName, contact, authMethod, avatarUri, modelUri]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.wardrobe, JSON.stringify(items)).catch((error) =>
      console.warn('Failed to save wardrobe', error)
    );
  }, [isReady, items]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favoriteLooks)).catch((error) =>
      console.warn('Failed to save favorites', error)
    );
  }, [isReady, favoriteLooks]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.lastContext, JSON.stringify(lastContext)).catch((error) =>
      console.warn('Failed to save last context', error)
    );
  }, [isReady, lastContext]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.lastLooks, JSON.stringify(lastLooks)).catch((error) =>
      console.warn('Failed to save last looks', error)
    );
  }, [isReady, lastLooks]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.savedLooks, JSON.stringify(savedLooks)).catch((error) =>
      console.warn('Failed to save saved looks', error)
    );
  }, [isReady, savedLooks]);

  useEffect(() => {
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
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

  const closeOnboarding = () => {
    setOnboardingVisible(false);
    AsyncStorage.setItem(STORAGE_KEYS.onboardingSeen, 'true').catch((error) =>
      console.warn('Failed to save onboarding state', error)
    );
  };

  const screen = (() => {
    const tryOnModelUri = modelUri || avatarUri;
    if (activeTab === 'wardrobe') {
      return <WardrobeScreen items={items} onItemsChange={setItems} />;
    }
    if (activeTab === 'builder')
      return (
        <OutfitBuilderScreen
          items={items}
          modelUri={tryOnModelUri}
          savedLooks={savedLooks}
          onSavedLooksChange={setSavedLooks}
          onLooksGenerated={(looks, context) => {
            setLastLooks(looks);
            setLastContext(context);
            showToast(t('Образы готовы'));
          }}
          onFavoriteAdd={(look) => {
            setFavoriteLooks((prev) => [look, ...prev]);
            showToast(t('Добавлено в избранное'));
          }}
        />
      );
    if (activeTab === 'recommendations')
      return <RecommendationsScreen looks={lastLooks} context={lastContext} />;
    if (activeTab === 'favorites')
      return (
        <FavoritesScreen
          looks={favoriteLooks}
          items={items}
          onRemove={(id) => setFavoriteLooks((prev) => prev.filter((look) => look.id !== id))}
        />
      );
    return (
      <ProfileScreen
        displayName={displayName}
        contact={contact}
        authMethod={authMethod}
        avatarUri={avatarUri}
        modelUri={modelUri}
        favoritesCount={favoriteLooks.length}
        onAvatarChange={(uri) => {
          setAvatarUri(uri);
          setModelUri((prev) => prev || uri);
        }}
        onModelChange={setModelUri}
        onShowGuide={() => setOnboardingVisible(true)}
        onLogout={() => {
          setAuthenticated(false);
          setDisplayName('Гость');
          setContact('');
          setAuthMethod('Не выбран');
          setAvatarUri(undefined);
          setModelUri(undefined);
        }}
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

  if (isOnboardingVisible) {
    return (
      <>
        <Onboarding onClose={closeOnboarding} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
          <AuthScreen
            onLogin={(name, phone, method) => {
              setAuthenticated(true);
              setDisplayName(name);
              setContact(phone);
              setAuthMethod(method);
            }}
          />
        </SafeAreaView>
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </>
    );
  }

  const tabBarBottom = Math.max(insets.bottom, 12);
  const tabBarSpace = TAB_BAR_HEIGHT + tabBarBottom + 10;

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
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
              return (
                <AppPressable
                  key={tab.key}
                  haptics
                  style={styles.tabItem}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{tab.icon}</Text>
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
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LanguageProvider>
          <AppContent />
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
    left: TAB_BAR_SIDE_MARGIN,
    right: TAB_BAR_SIDE_MARGIN,
    borderRadius: TAB_BAR_RADIUS,
    ...SHADOWS.floating,
    backgroundColor: Platform.OS === 'android' ? c.card : c.goldTransparent
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
    letterSpacing: 0.2
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
