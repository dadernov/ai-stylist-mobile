import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WardrobeScreen } from './src/screens/WardrobeScreen';
import { OutfitBuilderScreen } from './src/screens/OutfitBuilderScreen';
import { RecommendationsScreen } from './src/screens/RecommendationsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { COLORS } from './src/constants/theme';
import { WardrobeItem, wardrobeItems } from './src/data/mock';

type TabKey = 'wardrobe' | 'builder' | 'recommendations' | 'profile';

type ProfileState = {
  isAuthenticated: boolean;
  displayName: string;
  contact: string;
  authMethod: string;
  avatarUri?: string;
};

const STORAGE_KEYS = {
  profile: 'profileState',
  wardrobe: 'wardrobeItems'
};

const TABS: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: 'wardrobe', icon: '👗', label: 'Гардероб' },
  { key: 'builder', icon: '✨', label: 'Конструктор' },
  { key: 'recommendations', icon: '💡', label: 'Рекомендации' },
  { key: 'profile', icon: '👤', label: 'Профиль' }
];

function Onboarding({ onClose }: { onClose: () => void }) {
  return (
    <SafeAreaView style={styles.container}>
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

        <Pressable style={styles.primaryButton} onPress={onClose}>
          <Text style={styles.primaryButtonText}>Начать</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('wardrobe');
  const [isOnboardingVisible, setOnboardingVisible] = useState(true);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [displayName, setDisplayName] = useState('Гость');
  const [contact, setContact] = useState('');
  const [authMethod, setAuthMethod] = useState('Не выбран');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<WardrobeItem[]>(wardrobeItems);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const [profileRaw, itemsRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.wardrobe)
        ]);

        if (profileRaw) {
          const profile: ProfileState = JSON.parse(profileRaw);
          setAuthenticated(profile.isAuthenticated);
          setDisplayName(profile.displayName || 'Гость');
          setContact(profile.contact || '');
          setAuthMethod(profile.authMethod || 'Не выбран');
          setAvatarUri(profile.avatarUri);
        }

        if (itemsRaw) {
          const storedItems: WardrobeItem[] = JSON.parse(itemsRaw);
          setItems(storedItems);
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
      avatarUri
    };
    AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile)).catch((error) =>
      console.warn('Failed to save profile', error)
    );
  }, [isReady, isAuthenticated, displayName, contact, authMethod, avatarUri]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEYS.wardrobe, JSON.stringify(items)).catch((error) =>
      console.warn('Failed to save wardrobe', error)
    );
  }, [isReady, items]);

  const screen = useMemo(() => {
    if (activeTab === 'wardrobe') {
      return <WardrobeScreen items={items} onItemsChange={setItems} />;
    }
    if (activeTab === 'builder') return <OutfitBuilderScreen />;
    if (activeTab === 'recommendations') return <RecommendationsScreen />;
    return (
      <ProfileScreen
        displayName={displayName}
        contact={contact}
        authMethod={authMethod}
        avatarUri={avatarUri}
        onAvatarChange={setAvatarUri}
        onLogout={() => {
          setAuthenticated(false);
          setDisplayName('Гость');
          setContact('');
          setAuthMethod('Не выбран');
          setAvatarUri(undefined);
        }}
      />
    );
  }, [activeTab, displayName, contact, authMethod, avatarUri, items]);

  if (!isReady) {
    return (
      <SafeAreaView style={styles.container}>
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
        <AuthScreen
          onLogin={(name, phone, method) => {
            setAuthenticated(true);
            setDisplayName(name);
            setContact(phone);
            setAuthMethod(method);
          }}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>{screen}</View>
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <StatusBar style="dark" />
    </SafeAreaView>
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
    paddingTop: 8,
    paddingBottom: 16,
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
  }
});
