# Extractable components

#### Layout Components
## TabBar
- Source: `App.tsx` (lines 680-735, styles 906-960)
- Category: layout
- Description: Docked bottom tab bar, 5 tabs with lucide icons and labels
- Extractable props: activeItem (string, default: "wardrobe")
- Hardcoded: tab labels Гардероб/Примерка/Идеи/Избранное/Профиль, icons Shirt/ScanLine/Layers/Heart/UserRound

## ScreenHeader
- Source: `src/components/ui/ScreenHeader.tsx`
- Category: layout
- Description: Screen title in Tenor Sans, optional subtitle
- Extractable props: title (string)
- Hardcoded: typography

#### Basic Components
## GarmentTile
- Source: `src/components/GarmentTile.tsx`
- Category: basic
- Description: 3:4 garment photo on a grey stage with a corner action, name below
- Extractable props: name (string), imageUrl (string)
- Hardcoded: stage colour, badge

## Chip
- Source: `src/components/Chip.tsx`
- Category: basic
- Description: text tab, underlined when active
- Extractable props: label (string), active (boolean, default: false)
