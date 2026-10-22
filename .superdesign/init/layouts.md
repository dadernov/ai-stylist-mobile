# Layouts

Framework: React Native 0.8x via Expo SDK 57 (iOS/Android, also renders on web through react-native-web). No CSS/Tailwind: styles are React Native StyleSheet objects built from theme tokens (src/constants/theme.ts) via useThemedStyles(makeStyles). Icons: lucide-react-native. Fonts: Tenor Sans (titles), Onest + system (UI). Language: Russian UI (i18n via t()).

## App shell with bottom tab bar (App.tsx)
Renders the active screen full-height with a docked bottom tab bar of 5 tabs (Гардероб, Примерка, Идеи, Избранное, Профиль): lucide icon above a small label, active tab dark, others muted; an animated indicator slides under the active tab.

### `App.tsx:49:60`

```tsx
// The sections the outfit ideas are built from: their items get a stylist's profile.
const PROFILED_SECTIONS = new Set(['Верх', 'Низ', 'Обувь', 'Верхняя одежда', 'Сумки']);

const TABS: Array<{ key: TabKey; icon: LucideIcon; label: string }> = [
  { key: 'wardrobe', icon: Shirt, label: 'Гардероб' },
  { key: 'builder', icon: ScanLine, label: 'Примерка' },
  { key: 'recommendations', icon: Layers, label: 'Идеи' },
  { key: 'favorites', icon: Heart, label: 'Избранное' },
  { key: 'profile', icon: UserRound, label: 'Профиль' }
];

// Геометрия плавающего таб-бара.
```
### `App.tsx:680:735`

```tsx

  // The tab bar is docked to the bottom edge; the home indicator area is part of it.
  const tabBarBottom = 0;
  const tabBarSpace = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={['left', 'right']}>
      {/* Try-ons run above every screen; the folded window sits over the fitting room's own button. */}
      <GenerationDockProvider items={items} modelUri={modelUri || avatarUri} bottom={tabBarSpace + 76}>
      {accountError ? <Text accessibilityRole="alert" style={{ color: colors.danger, padding: 12 }}>{accountError}</Text> : null}
      <View style={[styles.content, { paddingBottom: tabBarSpace }]}>{screen}</View>

      <View style={[styles.tabBarWrap, { bottom: 0, paddingBottom: insets.bottom }]} pointerEvents="box-none">
        <View style={styles.tabBarClip}>
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
                  <TabIcon size={22} strokeWidth={isActive ? 1.9 : 1.4} color={isActive ? colors.text : colors.muted} />
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
```
### `App.tsx:880:960`

```tsx
    gap: 10
  },
  tipEmojiCircle: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center'
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
  // Docked, flat, a hairline above: the storefront kind of tab bar.
  tabBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: c.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border
  },
  tabBarClip: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    backgroundColor: c.card
  },
  tabRow: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: TAB_INNER_PAD,
    alignItems: 'center'
  },
  // No moving pill behind the active tab: its icon and label turn black instead.
  tabIndicator: {
    display: 'none'
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 4,
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
    fontWeight: '500',
    letterSpacing: 0.2
  },
  tabLabelActive: {
    color: c.text,
    fontWeight: '600'
  },
  // --- Тост ---
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
```
