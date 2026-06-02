import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WardrobeScreen } from './src/screens/WardrobeScreen';
import { OutfitBuilderScreen } from './src/screens/OutfitBuilderScreen';
import { RecommendationsScreen } from './src/screens/RecommendationsScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ThemeColors } from './src/constants/theme';
import { ThemeProvider, useTheme, useThemedStyles } from './src/constants/ThemeContext';
import { WardrobeItem } from './src/data/mock';
import { GeneratedLook, SavedLook } from './src/types/looks';
import { AppPressable } from './src/components/AppPressable';

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

function Onboarding({ onClose }: { onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.onboardingWrap}>
        <Text style={styles.eyebrow}>AI СТИЛИСТ</Text>
        <Text style={styles.heroTitle}>Собери гардероб и примеряй луки на себе</Text>
        <Text style={styles.heroSubtitle}>
          Приложение подбирает образы из твоих вещей, учитывает стиль, мероприятие, погоду и показывает
          сгенерированную примерку.
        </Text>

        <View style={styles.stepsCard}>
          <Text style={styles.stepTitle}>Как начать</Text>
          <Text style={styles.stepItem}>1. В профиле добавь фото в полный рост. Чем ровнее свет и поза, тем лучше примерка.</Text>
          <Text style={styles.stepItem}>2. В гардеробе сфоткай вещи по одной: верх, низ, обувь. Лучше на однотонном фоне.</Text>
          <Text style={styles.stepItem}>3. В конструкторе выбери стиль и событие. Мы покажем только подходящие луки.</Text>
          <Text style={styles.stepItem}>4. Нажми генерацию, выбери вариант посадки верха и сохрани удачный образ в избранное.</Text>
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>Для лучшего результата</Text>
          <Text style={styles.tipText}>Не закрывай приложение во время генерации. Если вещь сложная, перегенерация может дать заметно лучший вариант.</Text>
        </View>

        <AppPressable style={styles.primaryButton} onPress={onClose}>
          <Text style={styles.primaryButtonText}>Понятно, начать</Text>
        </AppPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
            showToast('Образы готовы');
          }}
          onFavoriteAdd={(look) => {
            setFavoriteLooks((prev) => [look, ...prev]);
            showToast('Добавлено в избранное');
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
      <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Загрузка…</Text>
        </View>
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

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
      <View style={styles.content}>{screen}</View>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <AppPressable
              key={tab.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </AppPressable>
          );
        })}
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
              bottom: Math.max(insets.bottom, 8) + 56
            }
          ]}
        >
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
        <AppContent />
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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: {
    fontSize: 16,
    color: c.muted
  },
  onboardingWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14
  },
  eyebrow: {
    color: c.muted,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700'
  },
  heroTitle: {
    color: c.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700'
  },
  heroSubtitle: {
    color: c.muted,
    fontSize: 16,
    lineHeight: 22
  },
  stepsCard: {
    backgroundColor: c.card,
    borderRadius: 14,
    padding: 16,
    gap: 10
  },
  stepTitle: {
    color: c.text,
    fontSize: 16,
    fontWeight: '700'
  },
  stepItem: {
    color: c.text,
    fontSize: 15,
    lineHeight: 21
  },
  tipCard: {
    backgroundColor: c.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 6
  },
  tipTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700'
  },
  tipText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 18
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: c.buttonPrimaryText,
    fontSize: 16,
    fontWeight: '600'
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: c.tabBarBorder,
    backgroundColor: c.background
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: 12
  },
  tabItemActive: {
    backgroundColor: c.tabActiveBg
  },
  tabIcon: {
    fontSize: 18
  },
  tabLabel: {
    fontSize: 11,
    color: c.muted,
    fontWeight: '600'
  },
  tabLabelActive: {
    color: c.text
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: c.toastBg,
    alignItems: 'center'
  },
  toastText: {
    color: c.toastText,
    fontSize: 14,
    fontWeight: '600'
  }
});
