# Pages (dependency trees)

## Гардероб (wardrobe tab)
Entry: src/screens/WardrobeScreen.tsx (render: lines 655-790; styles 950-1010)
- src/components/ui/ScreenHeader.tsx
- src/components/ui/IconButton.tsx
- src/components/Chip.tsx
- src/components/GarmentTile.tsx
- src/components/GarmentLabel.tsx
- src/components/ui/PrimaryButton.tsx
- src/components/ui/EmptyState.tsx
- src/components/AppPressable.tsx
- src/constants/theme.ts
- App.tsx (tab bar: 680-735, styles 880-960)

## Идеи (recommendations tab)
Entry: src/screens/RecommendationsScreen.tsx
- src/components/ui/ScreenHeader.tsx
- src/components/Chip.tsx
- src/components/LookPreview.tsx
- src/components/MatchSummary.tsx
- src/components/ui/PrimaryButton.tsx
- src/components/ui/IconButton.tsx
- src/components/ui/OptionPicker.tsx

## Примерочная (builder tab)
Entry: src/screens/OutfitBuilderScreen.tsx (render 600-800)
- src/components/FittingRoom.tsx
- src/components/GarmentTile.tsx
- src/components/Chip.tsx
- src/components/AiTryOnPreview.tsx
- src/components/GenerationHistory.tsx

## Избранное
Entry: src/screens/FavoritesScreen.tsx
- src/components/LookPreview.tsx
- src/components/ui/EmptyState.tsx

## Профиль
Entry: src/screens/ProfileScreen.tsx
- src/components/StylePreferencesFields.tsx
- src/components/LanguageChooser.tsx
