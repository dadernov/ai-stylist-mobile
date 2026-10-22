---
name: stylist-design
description: The AI Stylist app's own design rules («Студия», React Native). Load before changing any screen, component, copy or style in src/ or App.tsx, alongside frontend-design.
---

# AI Stylist design — «Студия»

The subject is a person's own wardrobe. Each garment is shown the way a fashion photographer would: alone on a
seamless studio backdrop, in one soft key light, floating slightly above its own shadow. Minimal, calm, with
motion that explains what changed. The approved mock-ups live on the Superdesign canvas (`.superdesign/resume.json`).

## Tokens (src/constants/theme.ts — never invent values)
- Backdrop: `StudioBackdrop` — radial #FFFFFF → #F2F2F0 → #E4E4E1, with the key light tinted by the piece in focus
  (`studioTint(item)`, a pale version of the garment's colour, faded in over ~1 s). Dark theme: #121417 → #1C1F23.
- Ink #121417 (text, primary buttons), secondary #6E737B, faint #9A9EA4, danger #C62828.
- Glass: `Glass` (expo-blur, white 55 %, 1 px white inner edge) for secondary buttons, chips, sheets, the tab bar.
- Type: Manrope only. Screen title 34/38 semibold, −1 tracking; item/look title 26–34 semibold; body 14/20;
  secondary 13; small 12. Sentence case everywhere.
- Shapes: pills (999) for buttons and chips; 24–34 radius for photo frames and sheets; garments have no frame.
- Shadows: only under floating garments (soft, blurred floor shadow) and the floating tab bar.

## The one memorable thing
The studio stage: the piece in focus floats in its own tinted light, neighbours blurred at the sides; switching
pieces slides one out with a blur and brings the next in, the light changing colour with it. Do not add other
bold devices next to it.

## Patterns
- Primary action: black pill with the sheen sweep; secondary: glass pill. One primary per screen.
- Choices: pills (black when chosen, glass otherwise). Section filters: plain words, the chosen one semibold.
- Floating glass tab bar: the active tab is a black pill with icon and label, others icon only.
- Lists on glass panels with hairline separators; never a card inside a card.
- Empty states: title, one line saying what to do, one button.

## Banned (they read as generated)
- Labels above every heading; dot-joined meta strings (two facts may sit side by side with a small dot gap);
  numbered markers unless a real sequence; sparkles/✨ or "AI" as decoration; arrows in button text; emoji.
- Big number with a small label as decoration; identical shadowed cards; gradient washes other than the key light.

## Copy
Plain verbs, active voice, the button says what happens ("Примерить", "В гардероб", "Переодеть").
Errors say what happened and how to fix it. No exclamation marks, no "умный", "магия".

## Motion
Motion answers an action (switching a piece, opening a sheet, trying on) or shows waiting (the light beam over a
picture being made). Respect reduced motion: no float or auto effects when it is on.

## Check
Screenshot every changed screen at 390 px wide (scratchpad pw/shots.js against Metro web) and compare with the
Superdesign mock-up before committing.
