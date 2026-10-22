# «Студия» on every screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the approved «Студия» design from the wardrobe to every other screen of the app: shared primitives, «Что надеть», «Примерка», adding an item and its card, «Избранное», «Профиль».

**Architecture:** The foundation already exists in `src/components/studio/` (StudioBackdrop + `useStudioTint`, `Glass`, `Pill`, `ChoicePill`, `font()`, ink colours, `studioTint`, `isCutout`, `useReducedMotion`) and the wardrobe uses it (`WardrobeStudio.tsx` is the reference implementation). Each task restyles one area to match its HTML mock-up in `docs/superpowers/mockups/`, keeping every existing feature, action and accessibility label reachable. Screens become transparent so the studio backdrop shows through.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, expo-blur, expo-linear-gradient, react-native-svg, lucide-react-native, Manrope (loaded in App.tsx as `Manrope_400Regular/500Medium/600SemiBold/700Bold`). No reanimated: use RN `Animated` (native driver where possible) and `PanResponder`.

**Spec:** the mock-ups `docs/superpowers/mockups/{studio,ideas,fitting,add,saved,profile}.html` (open them in a browser at 390×844; they are the visual source of truth) and the design rules in `.claude/skills/stylist-design/SKILL.md`.

## Global Constraints

- Visual values come from the mock-ups and `src/components/studio/studio.ts`: ink `INK` #121417, secondary `INK_SOFT` #6E737B, faint `INK_FAINT` #9A9EA4, danger #C62828; Manrope via `font('regular'|'medium'|'semibold'|'bold')` (never `fontWeight` with Manrope); screen title 34/40 semibold, letterSpacing −1; pills radius 999; photo frames 24–34 radius.
- Primary action = `<Pill variant="primary">` (black, sheen). Secondary = `<Pill>` (glass). Choices = `<ChoicePill>`. Panels = `<Glass radius={24..30}>`.
- Every screen root is transparent (no `backgroundColor: c.background` and no hero gradient washes) so `StudioBackdrop` shows; sheets/modals keep an opaque or glass surface.
- Keep every feature, handler, accessibility label and i18n key that exists today; new visible strings go through `t()` and must be added to `src/constants/translations.ts` (zh) and `src/constants/translations.en.ts` (en) — `node tests/i18n-coverage.cjs` must pass.
- Banned: labels above headings, dot-joined meta strings (two facts may sit side by side separated by a 3 px dot `View`), "ВАРИАНТ 01"-style numbering, sparkles/✨ icons, arrows in button text, emoji in the UI.
- Motion only answers an action or shows waiting; respect `useReducedMotion()` (no float/loop animations when true).
- Content leaves room for the floating tab bar: App already pads screens by `tabBarSpace`; do not add a second bottom padding.
- Verification for every task: `PATH=/opt/node22/bin:$PATH npx tsc --noEmit -p .` clean; `PATH=/opt/node22/bin:$PATH npm test` passes; screenshots via the harness `node /tmp/claude-0/-root/6094b43c-07b7-4694-91b7-5951b3c5be38/scratchpad/pw/shots.js <prefix>` (Metro web at http://127.0.0.1:8081 serves this checkout; shots land in `../shots/<prefix>-*.png`) compared side by side with the mock-up rendered by `node .../pw/prev.js file:///root/ai-stylist-mobile/docs/superpowers/mockups/<name>.html <out.png>`.
- Commit on branch `studio-screens` with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

- A wardrobe of 0 or 1 items: every screen must still render (empty states, no division by zero in position text, no crash on missing images).
- Items without `imageUri` or with a JPEG photo (not a cut-out): show the placeholder / rounded print, never a broken image.
- Dark theme (`ThemeContext` mode 'dark'): text stays legible on the dark backdrop; glass uses the dark tint.
- Long Russian names ("Свитшот с вышивкой и капюшоном оверсайз"): single-line titles shrink or ellipsize, never overflow under buttons.
- The try-on in progress and failed states in «Примерка» keep their messages and retry actions.

---

### Task 1: Shared primitives speak «Студия»

**Files:**
- Modify: `src/components/ui/ScreenHeader.tsx`, `src/components/ui/PrimaryButton.tsx`, `src/components/ui/IconButton.tsx`, `src/components/ui/EmptyState.tsx`, `src/components/Chip.tsx`, `src/constants/theme.ts`

**Interfaces:**
- Consumes: `Pill`, `ChoicePill`, `Glass` from `src/components/studio/Glass.tsx`; `font`, `INK`, `INK_SOFT` from `src/components/studio/studio.ts`.
- Produces: the same component APIs as today (no prop removed), restyled; `ScreenHeader` gains optional `right?: ReactNode` rendered at the title's right edge.

- [ ] **Step 1:** `ScreenHeader`: title `font('semibold')` 34/40, letterSpacing −1, colour `c.text`; subtitle 14/20 `INK_SOFT`; optional `right` slot in a row with the title.
- [ ] **Step 2:** `PrimaryButton`: keep props (`title`, `icon`, `onPress`, `loading`, `disabled`, `variant`, `size`, `style`); render the default/`gold` variants as the black studio pill (same look as `<Pill variant="primary">`, including the sheen) and `ghost`/secondary variants as the glass pill; heights 50 (default), 56 (`size="lg"`), 40 (`size="sm"`); `loading` shows a small ActivityIndicator in the ink colour of the variant.
- [ ] **Step 3:** `IconButton`: a 40×40 glass circle (`<Glass>`), icon 18 in `c.text`; keep `variant="quiet"` as icon without glass.
- [ ] **Step 4:** `Chip`: render as a pill — active black (`INK`, white `font('semibold')` 13), inactive glass with `#3F444B` text — height 36, paddingHorizontal 16, marginRight 8; keep its animated fade between states.
- [ ] **Step 5:** `EmptyState`: title `font('semibold')` 22/28, hint 14/20 `INK_SOFT`, action as `PrimaryButton`; left-aligned as today.
- [ ] **Step 6:** `theme.ts` light palette: `text` '#121417', `muted` '#6E737B', `buttonPrimaryBg` '#121417', `surface` 'rgba(255,255,255,0.6)', `background` stays '#FFFFFF' (sheets use it). Dark palette unchanged except `buttonPrimaryBg` '#FFFFFF' (already).
- [ ] **Step 7:** Verify: tsc clean, `npm test` passes, screenshots of wardrobe (detail sheet open) and «Избранное» empty state show pills/glass with Manrope.
- [ ] **Step 8:** Commit `design: shared primitives in the studio style`.

### Task 2: «Что надеть» as looks composed in the studio

**Files:**
- Create: `src/components/studio/lookLayout.ts`, `tests/look-layout.cjs`
- Modify: `src/screens/RecommendationsScreen.tsx`, `package.json` (add `node tests/look-layout.cjs` to the `test` script)

**Interfaces:**
- Consumes: `buildLooks`, `useStylistLooks`, `getOutfitAdvice`, `getOutfitSwaps`, `lookCore`, `sendLookFeedback` as used today in `RecommendationsScreen.tsx`; studio primitives; `useStudioTint`.
- Produces: `layoutLook(items: WardrobeItem[], width: number, height: number): { id: string; x: number; y: number; w: number; rotate: string }[]` in `lookLayout.ts`.

- [ ] **Step 1: Write the failing test** `tests/look-layout.cjs` (load TS like `tests/outfits.cjs` does) asserting for a stage 390×400: a look of top + bottom + shoes places the top in the upper-left half (`y < 140`, `x < 195`), the bottom to the right of the top's left edge and below its top (`y > top.y`), shoes in the bottom third (`y > 260`), every piece fully inside the stage (`x >= 0`, `x + w <= 390`), outerwear (section 'Верхняя одежда') larger than a T-shirt (`w` greater), a one-piece (category 'Платье') centred (`|x + w/2 − 195| < 40`), tights (category 'Колготки') omitted, and an empty list returns `[]`.
- [ ] **Step 2:** Run `node tests/look-layout.cjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `layoutLook` with slots by section like the mock (`ideas.html` LOOKS positions scaled to the stage): outer/one-piece large left-centre, top upper-left, bottom right, shoes lower-right, bag lower-left; small rotations −6°…3°.
- [ ] **Step 4:** Run → PASS; add it to `npm test`.
- [ ] **Step 5:** Restyle `RecommendationsScreen` to `ideas.html`: header «Что надеть» 34 with a glass weather pill on the right (temperature; tapping opens the existing weather/precipitation/anchor tuning, moved into a glass sheet or expanding glass panel); occasion `ChoicePill` row (events) and a quieter style row; ONE look at a time on a studio stage (pieces from `layoutLook`, cut-outs bare, photos as rounded prints, gentle float unless reduced motion, tint = `studioTint` of the look's main top/one-piece); look title 26 semibold + the stylist's `why` (or the rules' first tip) 14/20; actions: primary «Примерить образ», glass heart (favourite), glass «следующий» (arrow icon, accessibilityLabel «Следующий образ»); «n из m» position; swipe left/right changes look with the slide-out/slide-in used in `WardrobeStudio`; «Не сейчас» (dismiss + feedback) and «Почему сочетается» details (advice tips, warnings, swaps, MatchSummary, beauty) stay reachable in a «Подробнее» glass sheet; wardrobe gaps hint and empty states keep working; the stylist loading state shows a quiet studio placeholder with «Стилист подбирает образы…».
- [ ] **Step 6:** Verify (tsc, npm test, screenshots vs `ideas.html`), commit `design: «Что надеть» as looks composed in the studio`.

### Task 3: «Примерка»

**Files:**
- Modify: `src/screens/OutfitBuilderScreen.tsx` (header, segment, layout styles), `src/components/FittingRoom.tsx`, `src/components/AiTryOnPreview.tsx` (result presentation only)

**Interfaces:**
- Consumes: studio primitives; existing try-on job flow (`useTryOnJobs`, `GenerationDock`) unchanged.
- Produces: no new exports.

- [ ] **Step 1:** Header «Примерка» 34 (keep the screen's tabs Примерка / Подбор / Образы / История as a glass segmented control: glass track, black sliding knob, white label on the knob, existing animation kept).
- [ ] **Step 2:** `FittingRoom`: the user's photo / result in a 34-radius frame with a soft shadow (as `fitting.html`); when a result exists, a glass «До / В образе» switch at the frame's top-left cross-fades the photo and the result (opacity + slight scale, 700 ms), a glass heart top-right, and a glass caption panel at the bottom with the look's pieces as 40 px circles and the title; actions under the frame: primary «Примерить» / «Сохранить» per current state, glass «Переодеть»; item picking keeps its current function in the studio style (glass tiles, cut-outs bare).
- [ ] **Step 3:** While a try-on runs: a translucent veil over the frame with a looping light beam (Animated translateY, 1.8 s) and a glass pill «Примеряем, обычно около минуты» (keep the existing status text source); failures keep their message and retry.
- [ ] **Step 4:** «Недавние примерки» row (62×84 rounded thumbnails, the current one ringed in ink) from the existing try-on history, tapping opens that result as today.
- [ ] **Step 5:** Подбор / Образы / История tabs: same primitives (ChoicePill, Glass panels, PrimaryButton); no layout rewrite beyond styling.
- [ ] **Step 6:** Verify (tsc, npm test incl. `tests/account-jobs.cjs`, screenshots vs `fitting.html`), commit `design: the fitting room in the studio`.

### Task 4: Adding an item and its card

**Files:**
- Modify: `src/screens/WardrobeScreen.tsx` (the add/edit draft modal, the item detail sheet, their styles)

**Interfaces:**
- Consumes: studio primitives, `GarmentLabel` (restyle allowed), `isCutout`.
- Produces: no new exports.

- [ ] **Step 1:** Draft (add/re-analyse) modal as `add.html`: full studio sheet; header glass ✕, «Новая вещь» / «Анализ вещи», glass retake; the photo large in the middle; while `isAnalyzing`, a light line + beam sweep over it (Animated, looped while analysing; static when reduced motion); when the analysis arrives, glass tags appear one by one around the photo (category, colour with its swatch dot, material if known, season) with a short rise; the bottom glass card: «Название» + editable name, the section pill, the «Ровное фото / Исходное» switch (existing `draftFlat` logic) as a glass segmented switch, primary «В гардероб» (save) and glass «Изменить» (reveals the existing detailed fields: category, colour, season, pattern, size, store, material, «Добавить ещё»).
- [ ] **Step 2:** Item detail sheet: studio sheet with the item floating on a tinted stage (`useStudioTint` is screen-level; inside the sheet use a local `LinearGradient` from white to `studioTint(item)`), name 26 semibold, `GarmentLabel` restyled as a glass panel with hairline rows, actions as glass pills (Изменить, Распознать, Новое фото, Удалить in danger), primary «Примерить на себе», glass «Подобрать образы с этой вещью», «Выровнять фото»/«Вернуть прежнее фото», «История примерок» row.
- [ ] **Step 3:** Verify (tsc, npm test, screenshots of the detail sheet and the draft modal mid-analysis and after), commit `design: adding an item and its card in the studio`.

### Task 5: «Избранное»

**Files:**
- Modify: `src/screens/FavoritesScreen.tsx`

- [ ] **Step 1:** As `saved.html`: header «Избранное» with the count on the right («6 образов» via `t('Образов: {count}')`), filter words Все / С примеркой; two-column staggered masonry (right column offset 32) of 24–26-radius cards: try-on picture if present, else the look's pieces composed on a tinted gradient; a glass caption (title 13 semibold + event 11); tap opens the existing preview/actions (try-on, delete, beauty); empty state via `EmptyState`.
- [ ] **Step 2:** Verify (tsc, npm test, screenshots with seeded favourites and empty), commit `design: favourites in the studio`.

### Task 6: «Профиль»

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`, `src/components/StylePreferencesFields.tsx`, `src/components/LanguageChooser.tsx` (styling only)

- [ ] **Step 1:** As `profile.html`: header «Профиль»; avatar 64 circle (photo or initial on ink) + name 20 semibold + sign-in line; glass panel «Фото для примерки» (74×100 rounded photo, hint, black «Заменить»); glass panel with gender, beauty switch (black track when on), language, consent and every other existing setting as hairline rows with values and chevrons; «Как это работает» and «Выйти» (danger) as glass pills; account deletion and other existing actions stay reachable; the screen scrolls.
- [ ] **Step 2:** Verify (tsc, npm test, screenshots vs `profile.html`), commit `design: profile in the studio`.
