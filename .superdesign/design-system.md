# AI Стилист — design system & product context

## Product
A personal wardrobe app for iPhone/Android (Russian UI, Cyrillic everywhere). People photograph their own
clothes; the app cuts each garment out, recognises its category, colour and season, and keeps it in a digital
wardrobe. From that wardrobe it suggests outfits for an occasion and the weather ("Что надеть"), and shows a
virtual try-on: the chosen outfit generated on the user's own full-body photo.

Audience: Russian-speaking women and men 18–35, fashion-curious, not professionals. They open the app in the
morning to decide what to wear, and while shopping to see what goes with what they own.

Jobs: see what I own at a glance; find a piece; get an outfit for today; see it on me; keep the looks I liked.

## Screens (tabs)
1. Гардероб — my clothes: add by photo, search, sections (Верх, Низ, Обувь, Верхняя одежда, Сумки, Аксессуары),
   a grid of garment photos; an item's card with its facts (category, colour, season, pattern, size, fabric, store).
2. Примерка (Примерочная) — my full-body photo + pick items → AI try-on picture.
3. Идеи (Что надеть) — choose occasion (Прогулка, Работа, Свидание, Театр…) and style; outfit ideas from my
   wardrobe with a short stylist's reason.
4. Избранное — saved looks with their try-on pictures.
5. Профиль — me, my try-on photo, preferences.

## Content facts
- Garment photos are cut-outs (background removed) or smoothed flat-lay pictures on a neutral light ground.
- Real item names: «Белая футболка», «Худи оверсайз», «Зелёный кардиган», «Твидовое пальто», «Голубые джинсы»,
  «Джинсовая юбка», «Белые кеды», «Свитшот с вышивкой».

## Current visual style (being replaced)
White background, black text and buttons, light grey photo stage, titles in Tenor Sans, UI in Onest/system,
underlined text tabs, thin-framed "garment label" fact table. Clean but generic.

## Direction for this round
The owner wants a design with soul that could only belong to a wardrobe app — a concept drawn from the world of
clothes and closets, not a generic shop or SaaS look. Each variation explores ONE such concept fully (layout,
materials, typography, motion idea). Constraints that hold for every concept:
- Mobile, 390×844 viewport, safe areas, a bottom tab bar with the 5 tabs above (labels may be restyled).
- Cyrillic-capable fonts only (e.g. Tenor Sans, Onest, Golos Text, Manrope, Unbounded, Forum, Prata, Cormorant,
  PT Serif/Sans, Literata, Jost) — no Latin-only display faces.
- Garment photos stay the hero and stay legible; the concept frames them, never hides them.
- Russian copy, sentence case, no emoji, no "AI" sparkles, no labels above every heading, no dot-joined meta strings.
- Avoid the generic AI-design defaults: warm cream background with terracotta accent, near-black with an acid
  accent, identical rounded cards with soft grey shadows, gradient washes.
