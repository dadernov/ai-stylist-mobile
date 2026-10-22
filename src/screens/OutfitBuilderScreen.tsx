import { Animated, Image, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View, Linking } from 'react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chip } from '../components/Chip';
import { LookPreview } from '../components/LookPreview';
import { AiTryOnPreview } from '../components/AiTryOnPreview';
import { FittingRoom } from '../components/FittingRoom';
import { GenerationHistory } from '../components/GenerationHistory';
import { useAppDialog } from '../components/AppDialog';
import { FormScrollView } from '../components/ui/FormScrollView';
import { AppPressable } from '../components/AppPressable';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { ProgressGlow } from '../components/ui/ProgressGlow';
import { EmptyState } from '../components/ui/EmptyState';
import { FadeInView } from '../components/ui/FadeInView';
import { SPACING, ThemeColors } from '../constants/theme';
import { Glass, Pill } from '../components/studio/Glass';
import { font } from '../components/studio/studio';
import { StudioSheet } from '../components/studio/StudioSheet';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT, translate } from '../constants/i18n';
import { WardrobeItem } from '../data/mock';
import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';
import { TryOnQualityMode, TuckMode } from '../services/ai';
import { buildLooks, evaluateLook, EVENTS, STYLES } from '../domain/outfits';
import { describeWeatherCode } from '../services/weather';
import { useWeather } from '../components/useWeather';
import { MatchSummary } from '../components/MatchSummary';
import { ArrowUpRight, ChevronDown, ChevronUp, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, LucideIcon, Sun } from 'lucide-react-native';
import { Gender } from '../types/profile';

const stylePresets = STYLES;
const events = EVENTS;

// Погода линейной иконкой, без эмодзи: WMO-код → иконка.
const weatherIcon = (code: number | null): LucideIcon => {
  if (code === null) return CloudSun;
  if (code === 0) return Sun;
  if (code <= 2) return CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return CloudRain;
};

type OutfitBuilderProps = {
  items: WardrobeItem[];
  modelUri?: string;
  savedLooks: SavedLook[];
  onSavedLooksChange: (looks: SavedLook[]) => void;
  onLooksGenerated: (looks: GeneratedLook[], context: { style: string; event: string; weather: string }) => void;
  onFavoriteAdd: (look: GeneratedLook) => void;
  favoriteLookIds?: Set<string>;
  onProfile: () => void;
  onModelChange?: (uri: string) => void;
  onWardrobe: () => void;
  initialItemId?: string;
  initialItemIds?: string[];
  initialTab?: 'fitting' | 'builder' | 'looks' | 'history';
  initialHistoryItemId?: string;
  onOpenItem: (id: string) => void;
  gender: Gender;
  beautyAdvice: boolean;
};

const mergeTryOnHistory = (nextItem: TryOnHistoryItem, history: TryOnHistoryItem[] = []) => {
  const nextKey = nextItem.id || `${nextItem.updatedAt}-${nextItem.tuckMode || 'auto'}-${nextItem.qualityMode || 'quality'}`;
  return [
    nextItem,
    ...history.filter((item) => {
      const itemKey = item.id || `${item.updatedAt}-${item.tuckMode || 'auto'}-${item.qualityMode || 'quality'}`;
      return itemKey !== nextKey && item.imageUri !== nextItem.imageUri;
    })
  ].slice(0, 8);
};




// Чистая функция без зависимостей от состояния экрана — вынесена из компонента,
// чтобы карточка сохранённого лука могла мемоизироваться (см. SavedLookCard).
const savedLookToGeneratedLook = (look: SavedLook): GeneratedLook => ({
  id: look.id,
  title: look.name,
  itemIds: look.itemIds,
  weather: '',
  style: '',
  event: '',
  makeup: '',
  hair: '',
  fitScore: look.fitScore,
  fitReasons: look.fitReasons,
  tuckMode: look.tuckMode,
  tryOnImageUri: look.tryOnImageUri,
  tryOnWarning: look.tryOnWarning,
  tryOnUpdatedAt: look.tryOnUpdatedAt,
  tryOnQualityMode: look.tryOnQualityMode,
  tryOnHistory: look.tryOnHistory
});

const renderFitBadge = (score: number | undefined, styles: ReturnType<typeof makeStyles>) => {
  if (typeof score !== 'number') return null;
  return (
    <View style={styles.fitBadge}>
      <Text style={styles.fitBadgeText}>{`${Math.round(score)}%`}</Text>
    </View>
  );
};

const renderFitReasons = (
  reasons: string[] | undefined,
  styles: ReturnType<typeof makeStyles>,
  t: (source: string, vars?: Record<string, string | number>) => string
) => {
  if (!reasons?.length) return null;
  return (
    <View style={styles.reasonBlock}>
      <Text style={styles.reasonTitle}>{t('Почему этот лук подходит')}</Text>
      {reasons.map((reason, index) => (
        <Text key={`${reason}-${index}`} style={styles.reasonText}>
          • {reason}
        </Text>
      ))}
    </View>
  );
};

/** A quiet action on a look: a small glass pill; `danger` for the one that deletes. */
function CardAction({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <AppPressable haptics disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled }}
      style={{ borderRadius: 999, opacity: disabled ? 0.5 : 1 }}>
      <Glass>
        <View style={{ height: 34, paddingHorizontal: 14, justifyContent: 'center' }}>
          <Text style={[font('semibold'), { fontSize: 13, color: danger ? colors.danger : colors.text }]}>{label}</Text>
        </View>
      </Glass>
    </AppPressable>
  );
}

type GeneratedLookCardProps = {
  beautyAdvice: boolean;
  look: GeneratedLook;
  index: number;
  modelUri?: string;
  itemsById: Record<string, WardrobeItem>;
  favoriteLookIds?: Set<string>;
  onSaveToLooks: (look: GeneratedLook) => void;
  onFavoriteAdd: (look: GeneratedLook) => void;
  onTryOnGenerated: (
    lookId: string,
    payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
  ) => void;
};

// Мемоизировано: карточка лука несёт LookPreview + AiTryOnPreview (своя история
// генераций, состояние загрузки) — без этого весь список перерисовывался при
// любом несвязанном изменении экрана (смена стиля, тик тоста и т.д.), что на
// реальном устройстве ощущается как тормозящий скролл и залипающий интерфейс.
const GeneratedLookCard = memo(function GeneratedLookCard({
  beautyAdvice,
  look,
  index,
  modelUri,
  itemsById,
  favoriteLookIds,
  onSaveToLooks,
  onFavoriteAdd,
  onTryOnGenerated
}: GeneratedLookCardProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const lookItems = useMemo(
    () => Array.from(new Set(look.itemIds)).map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[],
    [look.itemIds, itemsById]
  );
  const isFavorited = favoriteLookIds?.has(look.id);
  const { colors } = useTheme();
  // The card shows what matters at a glance; the reasoning opens on demand.
  const [details, setDetails] = useState(false);
  const match = useMemo(() => look.event ? evaluateLook(lookItems, { style: look.style, event: look.event, temperature: look.temperature ?? null }, t) : null,
    [lookItems, look.style, look.event, look.temperature, t]);
  return (
    <FadeInView delay={index * 60}>
      <Glass radius={28} style={styles.lookCard}>
        <View style={styles.lookHeader}>
          <View style={styles.lookTitleWrap}>
            <Text style={styles.lookTitle}>{look.title}</Text>
            {/* With a match summary below, the percent would show twice. */}
            {match ? null : renderFitBadge(look.matchPercent, styles)}
          </View>
          <View style={styles.lookActions}>
            <CardAction label={t('В луки')} onPress={() => onSaveToLooks(look)} />
            <CardAction label={isFavorited ? t('Добавлено') : t('В избранное')} disabled={isFavorited} onPress={() => onFavoriteAdd(look)} />
          </View>
        </View>
        {look.weather ? <Text style={styles.lookWeather}>{look.weather}</Text> : null}
        <LookPreview items={lookItems} />
        {match ? <MatchSummary {...match} detailed={details} /> : null}
        <AppPressable style={styles.detailsToggle} accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(open => !open)}>
          <Text style={styles.detailsToggleText}>{t(details ? 'Свернуть' : 'Почему сочетается')}</Text>
          {details ? <ChevronUp size={16} color={colors.text} /> : <ChevronDown size={16} color={colors.text} />}
        </AppPressable>
        {details ? <>
          {renderFitReasons(look.fitReasons, styles, t)}
          {look.stylingTips?.length ? <View style={styles.beautyBlock}>
            <Text style={styles.beautyTitle}>{t('Как носить')}</Text>
            {look.stylingTips.map(tip => <Text key={tip} style={styles.beautyText}>{tip}</Text>)}
          </View> : null}
          {look.warnings?.map(warning => <Text key={warning} style={styles.beautyText}>{warning}</Text>)}
          {beautyAdvice && (look.makeup || look.hair) ? <View style={styles.beautyBlock}>
            <Text style={styles.beautyTitle}>{t('Макияж')}</Text>
            <Text style={styles.beautyText}>{t(look.makeup)}</Text>
            <Text style={styles.beautyTitle}>{t('Укладка')}</Text>
            <Text style={styles.beautyText}>{t(look.hair)}</Text>
          </View> : null}
        </> : null}
        <AiTryOnPreview
          modelUri={modelUri}
          items={lookItems}
          tuckMode={look.tuckMode}
          resultUri={look.tryOnImageUri}
          warningMessage={look.tryOnWarning}
          updatedAt={look.tryOnUpdatedAt}
          qualityMode={look.tryOnQualityMode}
          history={look.tryOnHistory}
          onGenerated={(payload) => onTryOnGenerated(look.id, payload)}
          onSelectHistory={payload => onTryOnGenerated(look.id, { ...payload, tuckMode: payload.tuckMode || 'auto', qualityMode: payload.qualityMode || 'quality' })}
        />
      </Glass>
    </FadeInView>
  );
});

type SavedLookCardProps = {
  look: SavedLook;
  index: number;
  modelUri?: string;
  itemsById: Record<string, WardrobeItem>;
  favoriteLookIds?: Set<string>;
  onEdit: (look: SavedLook) => void;
  onFavoriteAdd: (look: GeneratedLook) => void;
  onDelete: (id: string) => void;
  onTryOnGenerated: (
    lookId: string,
    payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
  ) => void;
};

const SavedLookCard = memo(function SavedLookCard({
  look,
  index,
  modelUri,
  itemsById,
  favoriteLookIds,
  onEdit,
  onFavoriteAdd,
  onDelete,
  onTryOnGenerated
}: SavedLookCardProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const lookItems = useMemo(
    () => Array.from(new Set(look.itemIds)).map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[],
    [look.itemIds, itemsById]
  );
  const isFavorited = favoriteLookIds?.has(look.id);
  return (
    <FadeInView delay={index * 60}>
      <Glass radius={28} style={styles.lookCard}>
        <View style={styles.lookHeader}>
          <View style={styles.lookTitleWrap}>
            <Text style={styles.lookTitle}>{look.name}</Text>
          </View>
          <View style={styles.lookActions}>
            <CardAction label={t('Изменить')} onPress={() => onEdit(look)} />
            <CardAction label={isFavorited ? t('Добавлено') : t('В избранное')} disabled={isFavorited} onPress={() => onFavoriteAdd(savedLookToGeneratedLook(look))} />
            <CardAction label={t('Удалить')} danger onPress={() => onDelete(look.id)} />
          </View>
        </View>
        <LookPreview items={lookItems} />
        <AiTryOnPreview
          modelUri={modelUri}
          items={lookItems}
          tuckMode={look.tuckMode}
          resultUri={look.tryOnImageUri}
          warningMessage={look.tryOnWarning}
          updatedAt={look.tryOnUpdatedAt}
          qualityMode={look.tryOnQualityMode}
          history={look.tryOnHistory}
          onGenerated={(payload) => onTryOnGenerated(look.id, payload)}
          onSelectHistory={payload => onTryOnGenerated(look.id, { ...payload, tuckMode: payload.tuckMode || 'auto', qualityMode: payload.qualityMode || 'quality' })}
        />
        {renderFitReasons(look.fitReasons, styles, t)}
      </Glass>
    </FadeInView>
  );
});

export function OutfitBuilderScreen({
  items,
  modelUri,
  savedLooks,
  onSavedLooksChange,
  onLooksGenerated,
  onFavoriteAdd,
  favoriteLookIds,
  onProfile,
  onModelChange,
  onWardrobe,
  initialItemId,
  initialItemIds,
  initialTab = 'fitting',
  initialHistoryItemId,
  onOpenItem,
  gender,
  beautyAdvice
}: OutfitBuilderProps) {
  const Alert = useAppDialog();
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'fitting' | 'builder' | 'looks' | 'history'>(initialTab);
  const [historyItemId, setHistoryItemId] = useState(initialHistoryItemId);
  const [repeatSelection, setRepeatSelection] = useState<{ ids: string[]; key: number }>();
  // "Try on" for the garments picked in the fitting room, pinned above the tab bar.
  const [fittingCta, setFittingCta] = useState<{ count: number; open: () => void } | null>(null);
  const [activeStyle, setActiveStyle] = useState(stylePresets[0]);
  const [activeEvent, setActiveEvent] = useState(events[2]);
  const { weather: liveWeather, error: weatherError, loading: weatherLoading, reload: loadWeather } = useWeather(activeTab === 'builder');
  const weatherReady = Boolean(liveWeather);
  const temperature = liveWeather ? liveWeather.temperature : null;
  const weatherCode = liveWeather?.code ?? null;
  const weatherText = liveWeather
    ? (liveWeather.wind === null
      ? t('Сейчас {temp}°C, {description}', { temp: Math.round(liveWeather.temperature), description: t(describeWeatherCode(liveWeather.code)) })
      : t('Сейчас {temp}°C, {description}, ветер {wind} м/с', {
        temp: Math.round(liveWeather.temperature), description: t(describeWeatherCode(liveWeather.code)), wind: Math.round(liveWeather.wind) }))
      + (liveWeather.city ? ` · ${liveWeather.city}` : '')
    : weatherLoading ? t('Определяем погоду…')
    : weatherError === 'permission' ? t('Разреши доступ к геолокации, чтобы узнать погоду.')
    : weatherError === 'location' ? t('Не удалось определить, где ты. Включи геолокацию или попробуй позже.') : t('Не удалось получить погоду. Проверь интернет.');
  const [looks, setLooks] = useState<GeneratedLook[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Сегмент-контрол: плавная подложка под активной вкладкой.
  const segmentAnim = useRef(new Animated.Value(0)).current;
  const [segmentWidth, setSegmentWidth] = useState(0);

  useEffect(() => {
    Animated.spring(segmentAnim, {
      toValue: activeTab === 'history' ? 3 : activeTab === 'looks' ? 2 : activeTab === 'builder' ? 1 : 0,
      friction: 9,
      tension: 90,
      useNativeDriver: true
    }).start();
  }, [activeTab, segmentAnim]);

  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [editLookId, setEditLookId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTop, setEditTop] = useState<WardrobeItem | null>(null);
  const [editBottom, setEditBottom] = useState<WardrobeItem | null>(null);
  const [editShoes, setEditShoes] = useState<WardrobeItem | null>(null);
  const [editOuter, setEditOuter] = useState<WardrobeItem | null>(null);
  const [editBag, setEditBag] = useState<WardrobeItem | null>(null);

  const tops = useMemo(() => items.filter((item) => item.section === 'Верх'), [items]);
  const bottoms = useMemo(() => items.filter((item) => item.section === 'Низ'), [items]);
  const shoes = useMemo(() => items.filter((item) => item.section === 'Обувь'), [items]);
  const outer = useMemo(() => items.filter((item) => item.section === 'Верхняя одежда'), [items]);
  const bags = useMemo(() => items.filter((item) => item.section === 'Сумки'), [items]);
  const itemsById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items]
  );


  const handleGenerateLooks = () => {
    if (isGenerating) return;
    if (!items.length) {
      Alert.alert(t('Нет вещей'), t('Добавь вещи в гардероб, чтобы подобрать сочетания.'));
      return;
    }
    setIsGenerating(true);
    // Служебный текст («Определяем погоду…» / ошибка) не должен попасть в лук —
    // только реально полученная погода, иначе он навсегда осядет в сохранённых
    // и избранных образах (аудит #42).
    const weatherForLook = weatherReady ? weatherText : '';
    // Короткая пауза, чтобы показать прогресс подбора (сам подбор синхронный).
    setTimeout(() => {
      const generated = buildLooks(items, activeStyle, activeEvent, weatherForLook, temperature, gender, beautyAdvice, {
        precipitation: liveWeather?.precipitation ?? null, wind: liveWeather?.wind ?? null, t
      });
      setIsGenerating(false);
      if (!generated.length) {
        Alert.alert(t('Не удалось собрать лук'), t('Добавь больше вещей разных категорий.'));
        return;
      }
      setLooks(generated);
      onLooksGenerated(generated, { style: activeStyle, event: activeEvent, weather: weatherForLook });
    }, 650);
  };

  const handleSaveGeneratedLook = useCallback(
    (look: GeneratedLook) => {
      const name = (look.title && look.title.split(' + ').map(part => t(part)).join(' + ')) || t('Лук {n}', { n: savedLooks.length + 1 });
      const newLook: SavedLook = {
        id: Date.now().toString(),
        name,
        itemIds: look.itemIds,
        createdAt: Date.now(),
        fitScore: look.fitScore,
        fitReasons: look.fitReasons,
        tuckMode: look.tuckMode,
        tryOnImageUri: look.tryOnImageUri,
        tryOnWarning: look.tryOnWarning,
        tryOnUpdatedAt: look.tryOnUpdatedAt,
        tryOnQualityMode: look.tryOnQualityMode,
        tryOnHistory: look.tryOnHistory
      };
      onSavedLooksChange([newLook, ...savedLooks]);
      setActiveTab('looks');
    },
    [savedLooks, onSavedLooksChange, t]
  );

  const updateSavedLookTryOn = useCallback(
    (
      lookId: string,
      payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
    ) => {
      onSavedLooksChange(
        savedLooks.map((look) => {
          if (look.id !== lookId) return look;
          const historyItem: TryOnHistoryItem = {
            id: `${payload.updatedAt}-${payload.tuckMode}-${payload.qualityMode}`,
            imageUri: payload.imageUri,
            updatedAt: payload.updatedAt,
            tuckMode: payload.tuckMode,
            qualityMode: payload.qualityMode
          };
          if (payload.warning) historyItem.warning = payload.warning;
          return {
            ...look,
            tuckMode: payload.tuckMode,
            tryOnImageUri: payload.imageUri,
            tryOnWarning: payload.warning,
            tryOnUpdatedAt: payload.updatedAt,
            tryOnQualityMode: payload.qualityMode,
            tryOnHistory: mergeTryOnHistory(historyItem, look.tryOnHistory)
          };
        })
      );
    },
    [savedLooks, onSavedLooksChange]
  );

  const updateGeneratedLookTryOn = useCallback(
    (
      lookId: string,
      payload: { imageUri: string; warning?: string; updatedAt: number; tuckMode: TuckMode; qualityMode: TryOnQualityMode }
    ) => {
      setLooks((prev) =>
        prev.map((look) => {
          if (look.id !== lookId) return look;
          const historyItem: TryOnHistoryItem = {
            id: `${payload.updatedAt}-${payload.tuckMode}-${payload.qualityMode}`,
            imageUri: payload.imageUri,
            updatedAt: payload.updatedAt,
            tuckMode: payload.tuckMode,
            qualityMode: payload.qualityMode
          };
          if (payload.warning) historyItem.warning = payload.warning;
          return {
            ...look,
            tuckMode: payload.tuckMode,
            tryOnImageUri: payload.imageUri,
            tryOnWarning: payload.warning,
            tryOnUpdatedAt: payload.updatedAt,
            tryOnQualityMode: payload.qualityMode,
            tryOnHistory: mergeTryOnHistory(historyItem, look.tryOnHistory)
          };
        })
      );
    },
    []
  );

  const openEditLook = useCallback(
    (look: SavedLook) => {
      const lookItems = Array.from(new Set(look.itemIds)).map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
      const pickSection = (section: string) =>
        lookItems.find((item) => item.section === section) || null;
      setEditLookId(look.id);
      setEditName(look.name);
      setEditTop(pickSection('Верх'));
      setEditBottom(pickSection('Низ'));
      setEditShoes(pickSection('Обувь'));
      setEditOuter(pickSection('Верхняя одежда'));
      setEditBag(pickSection('Сумки'));
      setEditModalVisible(true);
    },
    [itemsById]
  );

  const handleSaveEditedLook = () => {
    if (!editLookId) return;
    const selection = [editTop, editBottom, editShoes, editOuter, editBag].filter(Boolean) as WardrobeItem[];
    if (!selection.length) {
      Alert.alert(t('Нет вещей'), t('Выбери хотя бы одну вещь.'));
      return;
    }
    const updated = savedLooks.map((look) =>
      look.id === editLookId
        ? {
            ...look,
            name: editName.trim() || look.name,
            itemIds: selection.map((item) => item.id),
            fitScore: undefined,
            fitReasons: undefined,
            tuckMode: undefined,
            tryOnImageUri: undefined,
            tryOnWarning: undefined,
            tryOnUpdatedAt: undefined,
            tryOnQualityMode: undefined,
            tryOnHistory: undefined
          }
        : look
    );
    onSavedLooksChange(updated);
    setEditModalVisible(false);
  };

  const handleDeleteLook = useCallback(
    (id: string) => {
      Alert.alert(t('Удалить лук?'), t('Действие нельзя отменить.'), [
        { text: t('Отмена'), style: 'cancel' },
        {
          text: t('Удалить'),
          style: 'destructive',
          onPress: () => onSavedLooksChange(savedLooks.filter((look) => look.id !== id))
        }
      ]);
    },
    [savedLooks, onSavedLooksChange, t]
  );

  const renderPicker = (
    title: string,
    list: WardrobeItem[],
    selected: WardrobeItem | null,
    onSelect: (item: WardrobeItem | null) => void
  ) => (
    <View style={styles.slotCard}>
      <View style={styles.slotHeader}>
        <View style={styles.slotEmojiCircle}>
          <Text style={styles.slotInitial}>{t(title).slice(0, 1)}</Text>
        </View>
        <View style={styles.slotInfo}>
          <Text style={styles.slotTitle}>{t(title)}</Text>
          <Text style={[styles.slotValue, !selected && styles.slotValueEmpty]} numberOfLines={1}>
            {selected ? selected.name : t('Не выбрано')}
          </Text>
        </View>
        {selected?.imageUri ? (
          <Image source={{ uri: selected.imageUri }} style={styles.slotPreview} resizeMode="cover" />
        ) : null}
      </View>
      {list.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>
          {list.map((item) => {
            const active = selected?.id === item.id;
            return (
              <AppPressable
                key={item.id}
                haptics
                style={[styles.selectorCard, active && styles.selectorCardActive]}
                onPress={() => onSelect(active ? null : item)}
              >
                {item.imageUri ? (
                  <Image source={{ uri: item.imageUri }} style={styles.selectorImage} resizeMode="cover" />
                ) : null}
                <Text style={[styles.selectorLabel, active && styles.selectorLabelActive]} numberOfLines={1}>
                  {item.name}
                </Text>
              </AppPressable>
            );
          })}
        </ScrollView>
      ) : (
        <Text style={styles.slotEmptyText}>{t('Нет вещей в этой категории')}</Text>
      )}
    </View>
  );

  const WeatherIcon = weatherIcon(weatherCode);
  const segmentThumbWidth = segmentWidth > 0 ? (segmentWidth - 6) / 4 : 0;

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <ScreenHeader title={t('Примерка')} />

        {/* A glass track with the open part as a black pill sliding along it. */}
        <Glass style={styles.segmentGlass}>
        <View accessibilityRole="tablist" style={styles.segment} onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width)}>
          {segmentThumbWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.segmentThumb,
                {
                  width: segmentThumbWidth,
                  transform: [
                    {
                      translateX: segmentAnim.interpolate({
                        inputRange: [0, 1, 2, 3],
                        outputRange: [0, segmentThumbWidth, segmentThumbWidth * 2, segmentThumbWidth * 3]
                      })
                    }
                  ]
                }
              ]}
            />
          ) : null}
          <AppPressable haptics accessibilityRole="tab" accessibilityLabel={t('Примерка')} accessibilityState={{ selected: activeTab === 'fitting' }} style={styles.segmentTab} onPress={() => setActiveTab('fitting')}>
            <Text style={[styles.segmentText, activeTab === 'fitting' && styles.segmentTextActive]}>{t('Примерка')}</Text>
          </AppPressable>
          <AppPressable haptics accessibilityRole="tab" accessibilityState={{ selected: activeTab === 'builder' }} style={styles.segmentTab} onPress={() => setActiveTab('builder')}>
            <Text style={[styles.segmentText, activeTab === 'builder' && styles.segmentTextActive]}>
              {t('Подбор')}
            </Text>
          </AppPressable>
          <AppPressable haptics accessibilityRole="tab" accessibilityLabel={t('Образы')} accessibilityState={{ selected: activeTab === 'looks' }} style={styles.segmentTab} onPress={() => setActiveTab('looks')}>
            <Text style={[styles.segmentText, activeTab === 'looks' && styles.segmentTextActive]}>{t('Образы')}</Text>
          </AppPressable>
          <AppPressable haptics accessibilityRole="tab" accessibilityState={{ selected: activeTab === 'history' }} style={styles.segmentTab} onPress={() => setActiveTab('history')}>
            <Text style={[styles.segmentText, activeTab === 'history' && styles.segmentTextActive]}>{t('История')}</Text>
          </AppPressable>
        </View>
        </Glass>
      </View>
      {activeTab === 'history' && <GenerationHistory items={items} savedLooks={savedLooks} itemId={historyItemId}
        onFilter={setHistoryItemId} onOpenItem={onOpenItem}
        onSave={look => onSavedLooksChange([look, ...savedLooks.filter(existing => existing.id !== look.id)])}
        onTryOn={ids => { setRepeatSelection(previous => ({ ids, key: (previous?.key || 0) + 1 })); setActiveTab('fitting'); }} />}
      <FormScrollView style={activeTab === 'history' && { display: 'none' }}
        contentContainerStyle={[styles.pageContent, activeTab === 'fitting' && fittingCta ? { paddingBottom: 96 } : null]}>
        <View style={activeTab !== 'fitting' && { display: 'none' }}>
          <FittingRoom key={repeatSelection?.key || 0} items={items} modelUri={modelUri}
            initialItemId={repeatSelection ? undefined : initialItemId} initialItemIds={repeatSelection?.ids || initialItemIds} onProfile={onProfile} onModelChange={onModelChange} onWardrobe={onWardrobe}
            onOpenHistory={() => { setHistoryItemId(undefined); setActiveTab('history'); }}
            onSelectionCta={setFittingCta}
            onSave={look => onSavedLooksChange([look, ...savedLooks.filter(existing => existing.id !== look.id)])} />
        </View>
        {activeTab === 'builder' ? (
          <>
            <Text style={styles.sectionTitle}>{t('Стиль')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {stylePresets.map((preset) => (
                <Chip
                  key={preset}
                  label={t(preset)}
                  active={preset === activeStyle}
                  onPress={() => setActiveStyle(preset)}
                />
              ))}
            </ScrollView>

            <Text style={styles.sectionTitle}>{t('Мероприятие')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {events.map((event) => (
                <Chip
                  key={event}
                  label={t(event)}
                  active={event === activeEvent}
                  onPress={() => setActiveEvent(event)}
                />
              ))}
            </ScrollView>

            <Glass radius={24} style={styles.weatherCard}>
              <View style={styles.weatherEmojiCircle}>
                <WeatherIcon size={26} strokeWidth={1.5} color={themeColors.text} />
              </View>
              <View style={styles.weatherInfo}>
                {typeof temperature === 'number' ? (
                  <Text style={styles.weatherTemp}>{`${Math.round(temperature)}°`}</Text>
                ) : null}
                <Text style={styles.weatherTitle}>{t('Погода рядом с тобой')}</Text>
                <Text style={styles.weatherText}>{weatherText}</Text>
                {!weatherReady && !weatherLoading ? (
                  <Pill size="sm" title={t(weatherError === 'permission' ? 'Открыть настройки' : 'Повторить')} style={styles.weatherRetry}
                    onPress={() => { if (weatherError === 'permission') void Linking.openSettings().catch(() => {}); else void loadWeather(); }} />
                ) : null}
              </View>
            </Glass>

            <PrimaryButton
              title={t('Сгенерировать образы')}
              onPress={handleGenerateLooks}
              variant="gold"
              size="lg"
              loading={isGenerating}
              style={styles.generateButton}
            />
            {isGenerating ? (
              <View style={styles.generatingWrap}>
                <ProgressGlow visible={isGenerating} />
                <Text style={styles.generatingText}>{t('Подбираем сочетания под погоду и событие…')}</Text>
              </View>
            ) : (
              <Text style={styles.generateHint}>{t('Покажем только те варианты, которые реально подходят под стиль и событие.')}</Text>
            )}

            <View style={styles.looksWrap}>
              {looks.map((look, index) => (
                <GeneratedLookCard
                  key={look.id}
                  look={look}
                  index={index}
                  beautyAdvice={beautyAdvice}
                  modelUri={modelUri}
                  itemsById={itemsById}
                  favoriteLookIds={favoriteLookIds}
                  onSaveToLooks={handleSaveGeneratedLook}
                  onFavoriteAdd={onFavoriteAdd}
                  onTryOnGenerated={updateGeneratedLookTryOn}
                />
              ))}
            </View>
          </>
        ) : activeTab === 'looks' ? (
          <View style={styles.looksWrap}>
            {!savedLooks.length ? (
              <EmptyState
                emoji="👗"
                title={t('Пока нет сохраненных образов')}
                hint={t('Собери лук вручную и добавь его в образы.')}
                actionLabel={t('Собрать образ')}
                onAction={() => setActiveTab('fitting')}
              />
            ) : null}
            {savedLooks.map((look, index) => (
              <SavedLookCard
                key={look.id}
                look={look}
                index={index}
                modelUri={modelUri}
                itemsById={itemsById}
                favoriteLookIds={favoriteLookIds}
                onEdit={openEditLook}
                onFavoriteAdd={onFavoriteAdd}
                onDelete={handleDeleteLook}
                onTryOnGenerated={updateSavedLookTryOn}
              />
            ))}
          </View>
        ) : null}
      </FormScrollView>
      {activeTab === 'fitting' && fittingCta ? (
        <View style={styles.floatingCta} pointerEvents="box-none">
          <PrimaryButton title={t('К примерке ({count})', { count: fittingCta.count })} icon={ArrowUpRight} onPress={fittingCta.open} size="lg" />
        </View>
      ) : null}

      <StudioSheet visible={isEditModalVisible} title={t('Редактировать лук')} onClose={() => setEditModalVisible(false)} height="88%">
        <Text style={styles.modalLabel}>{t('Название')}</Text>
        <TextInput
          style={styles.modalInput}
          placeholder={t('Название')}
          placeholderTextColor={themeColors.muted}
          value={editName}
          onChangeText={setEditName}
          multiline
          scrollEnabled={false}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={Keyboard.dismiss}
        />
        {renderPicker('Верх', tops, editTop, setEditTop)}
        {renderPicker('Низ', bottoms, editBottom, setEditBottom)}
        {renderPicker('Обувь', shoes, editShoes, setEditShoes)}
        {renderPicker('Верхняя одежда', outer, editOuter, setEditOuter)}
        {renderPicker('Сумка', bags, editBag, setEditBag)}
        <View style={styles.modalActions}>
          <Pill variant="primary" title={t('Сохранить')} style={{ flex: 1 }} onPress={handleSaveEditedLook} />
          <Pill title={t('Отмена')} onPress={() => setEditModalVisible(false)} />
        </View>
      </StudioSheet>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // Transparent: the studio backdrop shows through.
  container: { flex: 1 },
  floatingCta: { position: 'absolute', left: SPACING.lg, right: SPACING.lg, bottom: SPACING.md },
  pageContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: SPACING.xl },
  pageHeader: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  // The fitting room's parts on a glass track; the open one is a black pill sliding along it.
  segmentGlass: { marginBottom: SPACING.lg },
  segment: { flexDirection: 'row', padding: 3, height: 44 },
  segmentThumb: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 999, backgroundColor: c.text },
  segmentTab: { flex: 1, flexBasis: 0, minWidth: 0, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  segmentText: { ...font('semibold'), fontSize: 13, color: c.text, opacity: 0.78 },
  segmentTextActive: { color: c.background, opacity: 1 },
  sectionTitle: { ...font('semibold'), fontSize: 15, lineHeight: 20, color: c.text, marginBottom: 10 },
  chipsRow: { paddingBottom: 6, marginBottom: 16, paddingRight: 12 },
  chipsRowAndroid: { paddingBottom: 10, marginBottom: 20 },
  chipsScroll: { minHeight: 48 },
  weatherCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, marginBottom: SPACING.lg },
  weatherEmojiCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  weatherInfo: { flex: 1, gap: 2 },
  weatherTemp: { ...font('semibold'), fontSize: 32, lineHeight: 36, letterSpacing: -1, color: c.text },
  weatherTitle: { ...font('semibold'), fontSize: 14, lineHeight: 19, color: c.text },
  weatherText: { ...font('regular'), fontSize: 13, lineHeight: 18, color: c.muted },
  weatherRetry: { marginTop: 8, alignSelf: 'flex-start' },
  generateButton: { marginBottom: SPACING.sm },
  generatingWrap: { gap: SPACING.sm, marginTop: 4, marginBottom: SPACING.lg },
  generatingText: { ...font('regular'), fontSize: 13, lineHeight: 18, color: c.muted, textAlign: 'center' },
  generateHint: { ...font('regular'), fontSize: 13, lineHeight: 18, color: c.muted, textAlign: 'center', marginBottom: SPACING.lg },
  slotCard: { backgroundColor: c.surface, borderRadius: 22, padding: SPACING.md },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.sm },
  slotEmojiCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  slotInitial: { ...font('semibold'), fontSize: 16, color: c.text },
  slotInfo: { flex: 1 },
  slotTitle: { ...font('regular'), fontSize: 12, lineHeight: 16, color: c.muted },
  slotValue: { ...font('semibold'), color: c.text, fontSize: 14, marginTop: 2 },
  slotValueEmpty: { ...font('regular'), color: c.muted },
  slotPreview: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.stage },
  slotEmptyText: { ...font('regular'), fontSize: 13, color: c.muted },
  selectorRow: { gap: 8, paddingBottom: 2 },
  selectorCard: { width: 108, backgroundColor: c.card, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent', padding: 8 },
  selectorCardActive: { borderColor: c.text },
  selectorImage: { width: '100%', height: 64, borderRadius: 12, backgroundColor: c.stage },
  selectorLabel: { ...font('medium'), marginTop: 6, color: c.text, fontSize: 12 },
  selectorLabelActive: { ...font('semibold') },
  looksWrap: { gap: SPACING.md, paddingBottom: 20 },
  lookCard: { padding: SPACING.lg, gap: 8 },
  lookHeader: { gap: 10 },
  lookTitleWrap: { flex: 1, gap: 6, alignItems: 'flex-start' },
  lookTitle: { ...font('semibold'), fontSize: 22, lineHeight: 28, letterSpacing: -0.6, color: c.text },
  fitBadge: { backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  fitBadgeText: { ...font('semibold'), color: c.text, fontSize: 12 },
  lookActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  detailsToggleText: { ...font('semibold'), color: c.text, fontSize: 14 },
  lookWeather: { ...font('regular'), fontSize: 13, lineHeight: 18, color: c.muted, marginBottom: 3 },
  // Inside the look's glass panel: hairline-separated, never a card in a card.
  reasonBlock: { marginTop: 6, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, gap: 4 },
  reasonTitle: { ...font('semibold'), fontSize: 13, lineHeight: 18, color: c.text },
  reasonText: { ...font('regular'), fontSize: 13, lineHeight: 19, color: c.muted },
  beautyBlock: { marginTop: 6, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, gap: 4 },
  beautyTitle: { ...font('semibold'), fontSize: 13, lineHeight: 18, color: c.text },
  beautyText: { ...font('regular'), fontSize: 13, lineHeight: 19, color: c.muted },
  modalLabel: { ...font('semibold'), fontSize: 13, color: c.text, marginBottom: -6 },
  modalInput: { ...font('regular'), backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: SPACING.md, paddingVertical: 12, fontSize: 14, color: c.text },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 }
});
