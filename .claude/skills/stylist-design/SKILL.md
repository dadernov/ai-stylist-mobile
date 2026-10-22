---
name: stylist-design
description: The AI Stylist app's own design rules (React Native). Load before changing any screen, component, copy or style in src/ or App.tsx, alongside frontend-design.
---

# AI Stylist design

The subject is a person's own wardrobe: they open the closet, decide what to wear, see it on themselves.
The clothes bring the colour; the interface is white, black and a light grey stage under the photos.

## Tokens (src/constants/theme.ts — never invent values)
- Colour: `background` #FFFFFF, `text` #000000, `muted` #6B6B6B, `border` #E5E5E5, `stage` #F2F2F2 (under
  garment photos, both themes), `danger` #D0021B. Dark theme mirrors these. No cream, no gradients, no accent hue.
- Type: titles in Tenor Sans (`LABEL_FACE`, aliases SERIF/DISPLAY), one weight, no letterSpacing tweaks:
  screen 30/36, item 26/32, look 22/28. Interface text: system/Onest, 15 body, 13 secondary, 12 small.
  Weight 400 by default; 600 only where a word must stand out. Sentence case everywhere — no caps labels.
- Radii 4 (photos 0); sheets 16–28. No shadows except floating windows.

## The one memorable thing
A garment's facts are shown as the label sewn into it: `GarmentLabel` — thin black frame, name/value rows on
hairlines. Do not add other bold devices next to it; keep everything else quiet.

## Patterns
- Choices and filters are text tabs with an underline (`Chip`, the fitting room's tabs), not filled pills.
- Lists are rows on hairlines, not boxed cards; never a card inside a card.
- Empty states: left-aligned title, one line saying what to do, one button. No icon in a circle.
- Garment tiles: photo on the stage, the name under it, size if known. Nothing else.

## Banned (they read as generated)
- A label above every heading ("Личная коллекция", "Из твоего гардероба").
- Strings joined with middle dots ("Футболка · Белый · Круглый год") — use a label table or plain commas.
- Numbered markers ("ВАРИАНТ 01", "04") unless the content is a real sequence.
- Sparkles/✨ or "AI" to mean smart; arrows "→" appended to link or button text; emoji in the UI.
- Big number with a small label as decoration; identical cards with the same shadow.
- Filler subtitles that restate the title.

## Copy
Plain verbs, active voice, the button says what happens ("Распознать", "Выровнять фото", "Примерить").
Errors say what happened and how to fix it. No exclamation marks, no "умный", "магия".

## Check
Screenshot every changed screen at 390 px wide (scratchpad pw/shots.js against Metro web), light and dark,
and compare with the rules above before committing.
