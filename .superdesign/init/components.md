# Shared UI components

Framework: React Native 0.8x via Expo SDK 57 (iOS/Android, also renders on web through react-native-web). No CSS/Tailwind: styles are React Native StyleSheet objects built from theme tokens (src/constants/theme.ts) via useThemedStyles(makeStyles). Icons: lucide-react-native. Fonts: Tenor Sans (titles), Onest + system (UI). Language: Russian UI (i18n via t()).

## ScreenHeader

### `src/components/ui/ScreenHeader.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
};

// Заголовок экрана: одно название шрифтом этикетки, без надписи над ним — экран и так понятен
// по вкладке. Отступы безопасной зоны НЕ включает — их задаёт экран.
export function ScreenHeader({ title, subtitle }: ScreenHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    marginBottom: 14,
    gap: 4
  },
  title: {
    ...TYPE.display,
    color: c.text
  },
  subtitle: {
    ...TYPE.body,
    color: c.muted
  }
});

```

## PrimaryButton

### `src/components/ui/PrimaryButton.tsx`

```tsx
import { ActivityIndicator, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { SHADOWS, ThemeColors } from '../../constants/theme';
import { useTheme, useThemedStyles } from '../../constants/ThemeContext';
import { AppPressable } from '../AppPressable';
import { LucideIcon } from 'lucide-react-native';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'gold' | 'ghost';
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  icon?: LucideIcon;
};

/**
 * The main button: a flat black rectangle with its icon before the title, as on
 * fashion storefronts. `ghost` is the quieter one beside it: white with a thin
 * black outline. 'gold' is kept for older callers and draws as 'primary'.
 */
export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  style,
  icon: Icon
}: PrimaryButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const blocked = disabled || loading;
  const filled = variant !== 'ghost';
  const contentColor = filled ? colors.buttonPrimaryText : colors.text;

  return (
    <AppPressable
      haptics
      disabled={blocked}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        filled ? styles.filled : styles.ghost,
        blocked && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <>
          {Icon ? <Icon size={18} strokeWidth={1.8} color={contentColor} /> : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={[styles.text, size === 'lg' && styles.textLg, { color: contentColor }]}>
            {title}
          </Text>
        </>
      )}
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderRadius: 4
  },
  md: {
    height: 52,
    paddingHorizontal: 24
  },
  lg: {
    height: 56,
    paddingHorizontal: 28
  },
  filled: {
    backgroundColor: c.buttonPrimaryBg,
    ...SHADOWS.button
  },
  ghost: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.text
  },
  disabled: {
    opacity: 0.45
  },
  text: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0
  },
  textLg: {
    fontSize: 16
  }
});

```

## IconButton

### `src/components/ui/IconButton.tsx`

```tsx
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { useTheme } from '../../constants/ThemeContext';

export function IconButton({ icon: Icon, label, onPress, danger = false, variant = 'default' }: {
  icon: LucideIcon; label: string; onPress: () => void; danger?: boolean; variant?: 'default' | 'quiet';
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  return <View style={styles.wrap}>
    <AppPressable haptics accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border }, variant === 'quiet' && styles.quiet]}>
      <Icon size={variant === 'quiet' ? 24 : 19} strokeWidth={1.6} color={danger ? colors.danger : variant === 'quiet' ? colors.muted : colors.text} />
    </AppPressable>
    {hovered && <View pointerEvents="none" style={[styles.tooltip, { backgroundColor: colors.toastBg }]}>
      <Text style={{ color: colors.toastText, fontSize: 11 }}>{label}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 2 },
  button: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quiet: { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 4 },
  tooltip: { position: 'absolute', top: 48, right: 0, minWidth: 110, padding: 8, borderRadius: 4, zIndex: 5 }
});

```

## EmptyState

### `src/components/ui/EmptyState.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { SERIF, ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';
import { FadeInView } from './FadeInView';
import { PrimaryButton } from './PrimaryButton';

type EmptyStateProps = {
  emoji: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Пустое состояние — приглашение к действию: заголовок, одна строка подсказки и кнопка,
// выровненные по левому краю, как весь экран; без декоративной иконки. Строки уже через t(...).
export function EmptyState({ emoji, title, hint, actionLabel, onAction }: EmptyStateProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <FadeInView style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <PrimaryButton title={actionLabel} onPress={onAction} variant="gold" style={styles.action} />
      ) : null}
    </FadeInView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    paddingVertical: 28
  },
  emoji: {
    fontSize: 40,
    lineHeight: 48
  },
  title: {
    fontFamily: SERIF,
    fontSize: 22,
    lineHeight: 28,
    color: c.text
  },
  hint: {
    ...TYPE.body,
    color: c.muted,
    marginTop: 6,
    maxWidth: 320
  },
  action: {
    marginTop: 20,
    minWidth: 200
  }
});

```

## SectionLabel

### `src/components/ui/SectionLabel.tsx`

```tsx
import { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { ThemeColors, TYPE } from '../../constants/theme';
import { useThemedStyles } from '../../constants/ThemeContext';

type SectionLabelProps = {
  children: ReactNode;
};

// Eyebrow-подпись секции: КАПС, разрядка, шампань-бронза.
export function SectionLabel({ children }: SectionLabelProps) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.label}>{children}</Text>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  label: {
    ...TYPE.eyebrow,
    color: c.accentGold,
    marginBottom: 10
  }
});

```

## OptionPicker

### `src/components/ui/OptionPicker.tsx`

```tsx
import { useState } from 'react';
import { FlatList, Keyboard, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import { AppPressable } from '../AppPressable';
import { IconButton } from './IconButton';
import { useTheme } from '../../constants/ThemeContext';
import { useT } from '../../constants/i18n';

export function OptionPicker({ options, value, onChange, label = 'Выбрать', swatches, labels = {} }: {
  options: string[]; value: string; onChange: (value: string) => void; label?: string; swatches?: Record<string, string>; labels?: Record<string, string>;
}) {
  const { colors: c } = useTheme();
  const t = useT();
  const display = (value: string) => labels[value] || t(value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  return <>
    <AppPressable accessibilityRole="button" accessibilityLabel={`${t(label)}: ${display(value) || t('Не выбрано')}`} onPress={() => { Keyboard.dismiss(); setSearch(''); setOpen(true); }}
      style={[styles.trigger, { backgroundColor: c.surface, borderColor: c.border }]}>
      {swatches?.[value] && <View style={[styles.swatch, { backgroundColor: swatches[value], borderColor: c.border }]} />}
      <Text style={{ flex: 1, color: value ? c.text : c.muted, fontSize: 15 }}>{display(value) || t(label)}</Text><ChevronDown size={18} color={c.muted} />
    </AppPressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={styles.row}><Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '600' }}>{t(label)}</Text><IconButton icon={X} label={t('Закрыть выбор')} onPress={() => setOpen(false)} /></View>
          {options.length > 8 && <View style={[styles.trigger, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Search size={18} color={c.muted} /><TextInput accessibilityLabel={t('Поиск вариантов')} placeholder={t('Поиск')} placeholderTextColor={c.muted} style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 16 }} value={search} onChangeText={setSearch} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
          </View>}
          <FlatList data={options.filter(option => display(option).toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={item => item}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss} automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingBottom: 24 }} ListEmptyComponent={<Text style={{ color: c.muted, paddingVertical: 20 }}>{t('Ничего не найдено')}</Text>}
            renderItem={({ item }) => <AppPressable accessibilityRole="radio" accessibilityState={{ checked: value === item }} accessibilityLabel={display(item)}
              onPress={() => { Keyboard.dismiss(); onChange(item); setOpen(false); }} style={[styles.option, { borderBottomColor: c.border }]}>
              {swatches?.[item] && <View style={[styles.swatch, { backgroundColor: swatches[item], borderColor: c.border }]} />}
              <Text style={{ color: c.text, flex: 1, fontSize: 15 }}>{display(item)}</Text>{value === item && <Check color={c.accentGold} size={20} />}
            </AppPressable>} />
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  trigger: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 4 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', minHeight: 280, width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 16 },
  option: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 }
});

```

## Chip

### `src/components/Chip.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  // Эмодзи-иконка слева от подписи.
  icon?: string;
};

export function Chip({ label, active = false, onPress, icon }: ChipProps) {
  const styles = useThemedStyles(makeStyles);
  const activeProgress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(activeProgress, {
      toValue: active ? 1 : 0,
      duration: 200,
      useNativeDriver: true
    }).start();
  }, [active, activeProgress]);

  return (
    <AppPressable haptics style={styles.chip} onPress={onPress}>
      {/* Выбранный пункт подчёркнут, как раздел в навигации магазина; черта плавно проявляется. */}
      <Animated.View style={[styles.activeLayer, { opacity: activeProgress }]} />
      <View style={styles.content}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      </View>
    </AppPressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // A text tab, not a filled pill: choices read as a store's sections, the chosen one underlined.
  chip: {
    height: 36,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  activeLayer: {
    position: 'absolute', left: 0, right: 0, bottom: 2, height: 1.5,
    pointerEvents: 'none',
    backgroundColor: c.text
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  icon: {
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false
  },
  label: {
    color: c.muted,
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0,
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' as const } : null)
  },
  labelActive: {
    color: c.text
  }
});

```

## GarmentTile

### `src/components/GarmentTile.tsx`

```tsx
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Check, ImageOff, MoreHorizontal, Plus, Shirt } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { useT } from '../constants/i18n';
import { AppPressable } from './AppPressable';

export const GarmentTile = memo(function GarmentTile({ item, selected, disabled, status, onPress }: {
  item: WardrobeItem;
  selected?: boolean;
  disabled?: boolean;
  status?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(item.imageUri));
  useEffect(() => { setFailed(false); setLoading(Boolean(item.imageUri)); }, [item.imageUri]);
  const SelectionIcon = selected ? Check : Plus;
  return (
    <AppPressable haptics onPress={onPress} disabled={disabled} accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityLabel={item.name} accessibilityState={{ checked: selected, disabled }} style={styles.tile}>
      <View style={[styles.photoStage, selected && styles.photoSelected]}>
        {item.imageUri && !failed ? (
          <Image source={{ uri: item.imageUri }} resizeMode="contain" style={styles.photo}
            onLoadEnd={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />
        ) : <View style={styles.missing}>
          {failed ? <ImageOff size={32} strokeWidth={1} color={colors.muted} /> : <Shirt size={40} strokeWidth={1} color={colors.muted} />}
          <Text style={styles.missingText}>{t(failed ? 'Фото недоступно' : 'Нет фото')}</Text>
        </View>}
        {loading && !failed && <ActivityIndicator style={styles.loading} size="small" color={colors.muted} />}
        {!disabled && <View style={[styles.badge, selected && styles.badgeSelected]}>
          {selected === undefined ? <MoreHorizontal size={18} color={STAGE_INK} strokeWidth={1.6} />
            : <SelectionIcon size={16} color={selected ? '#FFFFFF' : STAGE_INK} strokeWidth={1.8} />}
        </View>}
        {status && <View style={styles.status}><Text style={styles.statusText}>{status}</Text></View>}
      </View>
      {/* The name says what it is; category and colour live on the item's label (its card), not under every photo. */}
      <View style={styles.caption}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {item.size ? <Text style={styles.detail} numberOfLines={1}>{t('Размер {size}', { size: item.size })}</Text> : null}
      </View>
    </AppPressable>
  );
});

// Marks drawn on the light photo stage, the same in both themes.
const STAGE_INK = '#000000';

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // A storefront card: a 3:4 photo on a light stage with square corners, the text left-aligned under it.
  tile: { width: '100%', gap: 6 },
  photoStage: { width: '100%', aspectRatio: 0.75, backgroundColor: c.stage, borderRadius: 0, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  photoSelected: { borderColor: STAGE_INK },
  photo: { width: '100%', height: '100%', borderWidth: 12, borderColor: 'transparent' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingText: { fontSize: 11, color: c.muted },
  loading: { position: 'absolute', bottom: 12, left: 12 },
  badge: { position: 'absolute', right: 6, top: 6, width: 30, height: 30, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  badgeSelected: { backgroundColor: STAGE_INK },
  status: { position: 'absolute', left: 6, bottom: 6, right: 6, backgroundColor: c.card, padding: 6, borderRadius: 4 },
  statusText: { color: c.muted, fontSize: 10, textAlign: 'center' },
  caption: { gap: 1, paddingHorizontal: 2, paddingBottom: 10 },
  name: { color: c.text, fontSize: 14, lineHeight: 19, fontWeight: '400', minHeight: 19 },
  detail: { color: c.muted, fontSize: 12, lineHeight: 16 }
});

```

## GarmentLabel

### `src/components/GarmentLabel.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';

/**
 * A garment's facts set like the label sewn into it: a thin-bordered panel of
 * name/value rows. Rows without a value are left out.
 */
export function GarmentLabel({ rows }: { rows: [string, string | undefined | null][] }) {
  const styles = useThemedStyles(makeStyles);
  const filled = rows.filter(([, value]) => value && value.trim());
  if (!filled.length) return null;
  return (
    <View style={styles.label} accessibilityRole="summary">
      {filled.map(([name, value], index) => (
        <View key={name} style={[styles.row, index > 0 && styles.divided]}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.value} numberOfLines={2}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  label: { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.text, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  name: { width: 96, color: c.muted, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, color: c.text, fontSize: 14, lineHeight: 19 }
});

```

## LookPreview

### `src/components/LookPreview.tsx`

```tsx
import { Image, StyleSheet, Text, View } from 'react-native';
import { ArrowRightLeft } from 'lucide-react-native';
import { WardrobeItem } from '../data/mock';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from './AppPressable';

type LookPreviewProps = {
  items: WardrobeItem[];
  /** Puts a swap button on each photo, except where `canSwap` says no. */
  onSwap?: (item: WardrobeItem) => void;
  canSwap?: (item: WardrobeItem) => boolean;
  swapLabel?: (item: WardrobeItem) => string;
  /** The item whose replacements are open, highlighted. */
  swappingId?: string | null;
};

const sectionOrder = ['Аксессуары', 'Верхняя одежда', 'Верх', 'Низ', 'Обувь', 'Сумки'];

const sortBySection = (items: WardrobeItem[]) => {
  const order = new Map(sectionOrder.map((value, index) => [value, index]));
  return [...items].sort((a, b) => {
    const aIndex = order.has(a.section) ? order.get(a.section)! : sectionOrder.length;
    const bIndex = order.has(b.section) ? order.get(b.section)! : sectionOrder.length;
    return aIndex - bIndex;
  });
};

export function LookPreview({ items, onSwap, canSwap, swapLabel, swappingId }: LookPreviewProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const sorted = sortBySection(items);
  if (!sorted.length) {
    return <View style={styles.preview} />;
  }

  return (
    <View style={styles.preview}>
      {sorted.map((item, index) => (
        <View key={item.id} style={[styles.previewItem, sorted.length === 1 && { width: '100%' }]}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : (
            <View style={styles.previewPlaceholder} />
          )}
          {onSwap && (!canSwap || canSwap(item)) ? (
            <AppPressable accessibilityRole="button" accessibilityLabel={swapLabel?.(item)} accessibilityState={{ selected: swappingId === item.id }}
              hitSlop={6} onPress={() => onSwap(item)}
              style={[styles.swap, { backgroundColor: swappingId === item.id ? c.buttonPrimaryBg : c.card, borderColor: c.border }]}>
              <ArrowRightLeft size={15} color={swappingId === item.id ? c.buttonPrimaryText : c.text} />
            </AppPressable>
          ) : null}
          <Text style={styles.caption} numberOfLines={1}>{item.name}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  preview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 12
  },
  previewItem: {
    width: '48%',
    gap: 6
  },
  previewGap: {
    marginTop: 8
  },
  previewImage: {
    width: '100%',
    height: 160,
    backgroundColor: c.stage,
    borderRadius: 4
  },
  previewPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 4,
    backgroundColor: c.stage
  },
  caption: { color: c.muted, fontSize: 11, paddingHorizontal: 2 },
  swap: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
});

```

## MatchSummary

### `src/components/MatchSummary.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { Check, Minus, X, HelpCircle } from 'lucide-react-native';
import { useTheme } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { Criterion, CRITERION_LABELS } from '../domain/outfits';

// Процент совпадения и пять проверок одним взглядом; в развёрнутом виде —
// объяснение по каждой проверке. Та же оценка, по которой отсортированы образы.
export function MatchSummary({ percent, criteria, detailed = false }: { percent: number; criteria: Criterion[]; detailed?: boolean }) {
  const { colors } = useTheme();
  const t = useT();
  const tone = (status: Criterion['status']) => status === 'good' ? colors.accentGold : status === 'ok' ? colors.muted : status === 'bad' ? colors.danger : colors.muted;
  const Icon = (status: Criterion['status']) => status === 'good' ? Check : status === 'ok' ? Minus : status === 'bad' ? X : HelpCircle;
  const verdict = percent >= 85 ? 'Отлично подходит' : percent >= 70 ? 'Хорошо подходит' : percent >= 55 ? 'Подходит с оговорками' : 'Слабое совпадение';
  return (
    <View style={styles.wrap} accessibilityLabel={t('Совпадение {percent}%', { percent })}>
      <View style={styles.head}>
        <Text style={[styles.percent, { color: percent >= 70 ? colors.accentGold : percent >= 55 ? colors.text : colors.danger }]}>{percent}%</Text>
        <Text style={[styles.verdict, { color: colors.muted }]}>{t(verdict)}</Text>
      </View>
      <View style={styles.chips}>
        {criteria.map(criterion => {
          const Glyph = Icon(criterion.status);
          return (
            <View key={criterion.key} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Glyph size={13} strokeWidth={2.4} color={tone(criterion.status)} />
              <Text style={[styles.chipText, { color: colors.text }]}>{t(CRITERION_LABELS[criterion.key])}</Text>
            </View>
          );
        })}
      </View>
      {detailed ? <View style={styles.notes}>
        {criteria.map(criterion => {
          const Glyph = Icon(criterion.status);
          return (
            <View key={criterion.key} style={styles.note}>
              <Glyph size={15} strokeWidth={2.2} color={tone(criterion.status)} style={{ marginTop: 3 }} />
              <Text style={[styles.noteText, { color: colors.text }]}>
                <Text style={{ fontWeight: '700' }}>{t(CRITERION_LABELS[criterion.key])}. </Text>{criterion.note}
              </Text>
            </View>
          );
        })}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  percent: { fontSize: 28, fontWeight: '700' },
  verdict: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: '600' },
  notes: { gap: 8 },
  note: { flexDirection: 'row', gap: 8 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21 },
});

```

## AppPressable

### `src/components/AppPressable.tsx`

```tsx
import { ReactNode, useCallback, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleSheet
} from 'react-native';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type AppPressableProps = PressableProps & {
  children: ReactNode;
  feedback?: boolean;
  // Лёгкая хаптика при нажатии (по умолчанию выключена).
  haptics?: boolean;
};

export function AppPressable({
  style,
  feedback = true,
  haptics = false,
  android_ripple,
  onPressIn,
  onPressOut,
  children,
  ...props
}: AppPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setPressed(true);
      if (feedback) {
        Animated.spring(scale, {
          toValue: 0.97,
          speed: 50,
          bounciness: 4,
          useNativeDriver: true
        }).start();
      }
      if (haptics && Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      onPressIn?.(event);
    },
    [feedback, haptics, onPressIn, scale]
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      setPressed(false);
      if (feedback) {
        Animated.spring(scale, {
          toValue: 1,
          speed: 40,
          bounciness: 7,
          useNativeDriver: true
        }).start();
      }
      onPressOut?.(event);
    },
    [feedback, onPressOut, scale]
  );

  const ripple = android_ripple ?? (feedback ? { color: 'rgba(0,0,0,0.08)' } : undefined);

  return (
    <AnimatedPressable
      {...props}
      android_ripple={ripple}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        typeof style === 'function' ? style({ pressed }) : style,
        feedback ? { transform: [{ scale }] } : null,
        feedback && pressed ? styles.pressed : null
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.9
  }
});

```
