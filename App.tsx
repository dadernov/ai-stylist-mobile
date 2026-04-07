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
import { COLORS } from './src/constants/theme';
import { WardrobeItem, wardrobeItems } from './src/data/mock';
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
  savedLooks: 'savedLooks'
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

function Onboarding({ onClose }: { onClose: () => void }) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.onboardingWrap}>
        <Text style={styles.eyebrow}>AI СТИЛИСТ</Text>
        <Text style={styles.heroTitle}>Подберем образ за 60 секунд</Text>
        <Text style={styles.heroSubtitle}>
          Загружай вещи, выбирай стиль и мероприятие, получай готовые луки с учетом погоды.
        </Text>

        <View style={styles.stepsCard}>
          <Text style={styles.stepItem}>1. Добавь фото вещей в гардероб</Text>
          <Text style={styles.stepItem}>2. Укажи стиль и формат мероприятия</Text>
          <Text style={styles.stepItem}>3. Получи 3-5 готовых образов</Text>
        </View>

        <AppPressable style={styles.primaryButton} onPress={onClose}>
          <Text style={styles.primaryButtonText}>Начать</Text>
        </AppPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('wardrobe');
  const [isOnboardingVisible, setOnboardingVisible] = useState(true);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [displayName, setDisplayName] = useState('Гость');
  const [contact, setContact] = useState('');
  const [authMethod, setAuthMethod] = useState('Не выбран');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [modelUri, setModelUri] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<WardrobeItem[]>(wardrobeItems);
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
        const [profileRaw, itemsRaw, favoritesRaw, contextRaw, looksRaw, savedRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.wardrobe),
          AsyncStorage.getItem(STORAGE_KEYS.favorites),
          AsyncStorage.getItem(STORAGE_KEYS.lastContext),
          AsyncStorage.getItem(STORAGE_KEYS.lastLooks),
          AsyncStorage.getItem(STORAGE_KEYS.savedLooks)
        ]);

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
          setItems(storedItems);
        }

        if (favoritesRaw) {
          const storedFavorites: GeneratedLook[] = JSON.parse(favoritesRaw);
          const normalizedFavorites = storedFavorites.map((look) => ({
            ...look,
            itemIds: look.itemIds ?? []
          }));
          setFavoriteLooks(normalizedFavorites);
        }

        if (contextRaw) {
          const storedContext: { style: string; event: string; weather: string } = JSON.parse(contextRaw);
          setLastContext(storedContext);
        }

        if (looksRaw) {
          const storedLooks: GeneratedLook[] = JSON.parse(looksRaw);
          const normalized = storedLooks.map((look) => ({
            ...look,
            itemIds: look.itemIds ?? []
          }));
          setLastLooks(normalized);
        }

        if (savedRaw) {
          const storedSaved: SavedLook[] = JSON.parse(savedRaw);
          setSavedLooks(storedSaved);
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

  const screen = (() => {
    const tryOnModelUri = modelUri || avatarUri;
    if (activeTab === 'wardrobe') {
      return <WardrobeScreen items={items} onItemsChange={setItems} />;
    }
    if (activeTab === 'builder')
      return (
        <OutfitBuilderScreen
          items={items}
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
          modelUri={tryOnModelUri}
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
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  if (isOnboardingVisible) {
    return (
      <>
        <Onboarding onClose={() => setOnboardingVisible(false)} />
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
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
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
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
    color: COLORS.muted
  },
  onboardingWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14
  },
  eyebrow: {
    color: COLORS.muted,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700'
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700'
  },
  heroSubtitle: {
    color: COLORS.muted,
    fontSize: 16,
    lineHeight: 22
  },
  stepsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    gap: 10
  },
  stepItem: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 21
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: COLORS.text,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600'
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#E9E5DC',
    backgroundColor: COLORS.background
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: 12
  },
  tabItemActive: {
    backgroundColor: '#EDE8DD'
  },
  tabIcon: {
    fontSize: 18
  },
  tabLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '600'
  },
  tabLabelActive: {
    color: COLORS.text
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#1E1C19',
    alignItems: 'center'
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  }
});
