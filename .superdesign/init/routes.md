# Routes

No URL router: App.tsx switches screens by `activeTab` state (a bottom tab bar). Mobile only (390×844 reference).

| Tab | Screen file | Renders |
|---|---|---|
| wardrobe (Гардероб) | src/screens/WardrobeScreen.tsx | Title, add (+) button, search, section filter tabs (Все/Верх/Низ/Обувь/Сумки/Аксессуары), item count, 2-column grid of garment photo tiles; item detail bottom sheet (photo, name, garment label table, actions, try-on button); add-item sheet (photo, recognition, fields) |
| builder (Примерка) | src/screens/OutfitBuilderScreen.tsx | "Примерочная": tabs Примерка/Подбор/Образы/История, the user's full-body photo, item picker grid, try-on generation with result |
| recommendations (Идеи) | src/screens/RecommendationsScreen.tsx | "Что надеть": event and style tabs, weather row, outfit ideas each with title, item photos, reason, try-on button |
| favorites (Избранное) | src/screens/FavoritesScreen.tsx | Saved looks with try-on picture |
| profile (Профиль) | src/screens/ProfileScreen.tsx | Avatar, name, gender, preferences, try-on photo, language, account |

Key flow: add a garment by photo → it appears in the wardrobe → ideas combine wardrobe items for an occasion and weather → virtual try-on shows the look on the user's own photo.
