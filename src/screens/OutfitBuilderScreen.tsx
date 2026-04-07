import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { ScreenTitle } from '../components/ScreenTitle';
import { Chip } from '../components/Chip';
import { LookPreview } from '../components/LookPreview';
import { AppPressable } from '../components/AppPressable';
import { COLORS } from '../constants/theme';
import { WardrobeItem } from '../data/mock';
import { GeneratedLook, SavedLook } from '../types/looks';

const stylePresets = ['Кэжуал', 'Спорт-шик', 'Романтичный', 'Бохо', 'Минимализм', 'Офисный'];
const events = ['Свидание', 'Прогулка', 'Совещание', 'Вечеринка', 'Спортзал'];

type OutfitBuilderProps = {
  items: WardrobeItem[];
  savedLooks: SavedLook[];
  onSavedLooksChange: (looks: SavedLook[]) => void;
  onLooksGenerated: (looks: GeneratedLook[], context: { style: string; event: string; weather: string }) => void;
  onFavoriteAdd: (look: GeneratedLook) => void;
};

const colorGroups: Record<string, 'neutral' | 'warm' | 'cool'> = {
  Белый: 'neutral',
  Молочный: 'neutral',
  Кремовый: 'neutral',
  Бежевый: 'neutral',
  Песочный: 'neutral',
  Карамельный: 'neutral',
  Коричневый: 'neutral',
  Черный: 'neutral',
  Графит: 'neutral',
  Серый: 'neutral',
  Серебристый: 'neutral',
  Синий: 'cool',
  'Синий деним': 'cool',
  Голубой: 'cool',
  Бирюзовый: 'cool',
  Зеленый: 'cool',
  Оливковый: 'cool',
  Хаки: 'cool',
  Желтый: 'warm',
  Горчичный: 'warm',
  Оранжевый: 'warm',
  Красный: 'warm',
  Бордовый: 'warm',
  Розовый: 'warm',
  Пудровый: 'warm',
  Фиолетовый: 'cool',
  Лавандовый: 'cool'
};

const patternPreferences: Record<string, string[]> = {
  Минимализм: ['Однотонный'],
  Офисный: ['Однотонный', 'Полоска'],
  Романтичный: ['Цветочный', 'Горох'],
  Бохо: ['Цветочный', 'Клетка'],
  'Спорт-шик': ['Однотонный', 'Полоска'],
  Кэжуал: ['Однотонный', 'Клетка']
};

const beautyMap: Record<string, { makeup: string; hair: string }> = {
  Совещание: {
    makeup: 'Nude-тон, мягкая подводка и аккуратные брови.',
    hair: 'Низкий хвост или гладкий пучок.'
  },
  Вечеринка: {
    makeup: 'Smoky eyes или сияющие тени, акцент на губы.',
    hair: 'Объемные локоны или высокий хвост.'
  },
  Свидание: {
    makeup: 'Мягкий румянец и сияние, легкий акцент на губы.',
    hair: 'Распущенные локоны или полупучок.'
  },
  Прогулка: {
    makeup: 'Легкий BB/CC тон, бальзам и тушь.',
    hair: 'Свободные волны или коса.'
  },
  Спортзал: {
    makeup: 'Минимум: SPF и прозрачный бальзам.',
    hair: 'Высокий хвост или пучок.'
  }
};

const weatherCodeMap: Record<number, string> = {
  0: 'ясно',
  1: 'переменная облачность',
  2: 'облачно',
  3: 'пасмурно',
  45: 'туман',
  48: 'изморозь',
  51: 'морось',
  61: 'дождь',
  71: 'снег',
  80: 'ливень',
  95: 'гроза'
};

const getColorGroup = (color: string) => colorGroups[color] || 'neutral';

const scoreColors = (colors: string[]) => {
  const groups = new Set(colors.map(getColorGroup));
  if (groups.size === 1) return 2;
  if (groups.has('neutral')) return 1;
  return -1;
};

const seasonScore = (item: WardrobeItem, temp: number | null) => {
  if (temp === null) return 0;
  if (item.season === 'Круглый год') return 1;
  if (temp <= 5 && item.season === 'Зима') return 2;
  if (temp <= 5 && item.season === 'Демисезон') return 1;
  if (temp >= 18 && item.season === 'Лето') return 2;
  if (temp >= 18 && item.season === 'Демисезон') return 1;
  if (temp >= 18 && item.season === 'Зима') return -2;
  if (temp <= 5 && item.season === 'Лето') return -2;
  return 0;
};

const styleScore = (items: WardrobeItem[], style: string) => {
  const preferred = patternPreferences[style] || [];
  let score = 0;
  items.forEach((item) => {
    if (preferred.includes(item.pattern)) score += 1;
    if (style === 'Минимализм' && getColorGroup(item.color) === 'neutral') score += 1;
    if (style === 'Офисный' && ['Юбка', 'Пальто', 'Джинсы'].includes(item.category)) score += 1;
    if (style === 'Романтичный' && ['Розовый', 'Пудровый', 'Лавандовый'].includes(item.color)) score += 1;
    if (style === 'Бохо' && ['Оливковый', 'Коричневый', 'Бежевый'].includes(item.color)) score += 1;
  });
  return score;
};

const eventScore = (items: WardrobeItem[], event: string) => {
  let score = 0;
  items.forEach((item) => {
    if (event === 'Совещание' && item.pattern === 'Цветочный') score -= 1;
    if (event === 'Вечеринка' && getColorGroup(item.color) === 'warm') score += 1;
    if (event === 'Спортзал' && ['Пальто', 'Юбка'].includes(item.category)) score -= 1;
  });
  return score;
};

const pickBeauty = (event: string) => beautyMap[event] || beautyMap['Прогулка'];

const buildLooks = (
  items: WardrobeItem[],
  style: string,
  event: string,
  weatherText: string,
  temp: number | null
) => {
  const tops = items.filter((item) => item.section === 'Верх');
  const bottoms = items.filter((item) => item.section === 'Низ');
  const shoes = items.filter((item) => item.section === 'Обувь');
  const outer = items.filter((item) => item.section === 'Верхняя одежда');
  const bags = items.filter((item) => item.section === 'Сумки');

  const safeTops = tops.length ? tops : items;
  const safeBottoms = bottoms.length ? bottoms : items;
  const safeShoes = shoes.length ? shoes : items;
  const safeOuter = outer.length ? outer : [null];
  const safeBags = bags.length ? bags : [null];

  const combos: { items: WardrobeItem[]; score: number }[] = [];

  const uniqueById = (list: WardrobeItem[]) =>
    Array.from(new Map(list.map((item) => [item.id, item])).values());

  safeTops.forEach((top) => {
    safeBottoms.forEach((bottom) => {
      safeShoes.forEach((shoe) => {
        safeOuter.forEach((outerwear) => {
          safeBags.forEach((bag) => {
            const selectionRaw = [top, bottom, shoe, outerwear, bag].filter(Boolean) as WardrobeItem[];
            const selection = uniqueById(selectionRaw);
            const colors = selection.map((item) => item.color);
            const score =
              scoreColors(colors) +
              selection.reduce((sum, item) => sum + seasonScore(item, temp), 0) +
              styleScore(selection, style) +
              eventScore(selection, event);
            combos.push({ items: selection, score });
          });
        });
      });
    });
  });

  combos.sort((a, b) => b.score - a.score);
  const selected = combos.slice(0, 5).map((combo, index) => {
    const beauty = pickBeauty(event);
    return {
      id: `look-${Date.now()}-${index}`,
      title: `Лук ${index + 1} · ${style}`,
      itemIds: uniqueById(combo.items).map((item) => item.id),
      weather: weatherText || 'Погода недоступна',
      style,
      event,
      makeup: beauty.makeup,
      hair: beauty.hair
    };
  });

  return selected.length ? selected : [];
};

export function OutfitBuilderScreen({
  items,
  savedLooks,
  onSavedLooksChange,
  onLooksGenerated,
  onFavoriteAdd
}: OutfitBuilderProps) {
  const [activeTab, setActiveTab] = useState<'builder' | 'looks'>('builder');
  const [activeStyle, setActiveStyle] = useState(stylePresets[0]);
  const [activeEvent, setActiveEvent] = useState(events[2]);
  const [weatherText, setWeatherText] = useState('Определяем погоду…');
  const [temperature, setTemperature] = useState<number | null>(null);
  const [looks, setLooks] = useState<GeneratedLook[]>([]);

  const [selectedTop, setSelectedTop] = useState<WardrobeItem | null>(null);
  const [selectedBottom, setSelectedBottom] = useState<WardrobeItem | null>(null);
  const [selectedShoes, setSelectedShoes] = useState<WardrobeItem | null>(null);
  const [selectedOuter, setSelectedOuter] = useState<WardrobeItem | null>(null);
  const [selectedBag, setSelectedBag] = useState<WardrobeItem | null>(null);
  const [manualName, setManualName] = useState('');

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

  const getLookItems = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.map((id) => itemsById[id]).filter(Boolean) as WardrobeItem[];
  };

  useEffect(() => {
    if (!selectedTop && tops.length) setSelectedTop(tops[0]);
    if (!selectedBottom && bottoms.length) setSelectedBottom(bottoms[0]);
    if (!selectedShoes && shoes.length) setSelectedShoes(shoes[0]);
  }, [tops, bottoms, shoes, selectedTop, selectedBottom, selectedShoes]);

  useEffect(() => {
    const loadWeather = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setWeatherText('Разреши доступ к геолокации, чтобы узнать погоду.');
          return;
        }
        const location = await Location.getCurrentPositionAsync({});
        const geo = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });
        const city = geo[0]?.city || 'твоем городе';
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${location.coords.latitude}` +
          `&longitude=${location.coords.longitude}&current=temperature_2m,weathercode,wind_speed_10m&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const temp = data?.current?.temperature_2m;
        const code = data?.current?.weathercode;
        const wind = data?.current?.wind_speed_10m;
        const description = weatherCodeMap[code] || 'переменная облачность';
        setTemperature(typeof temp === 'number' ? temp : null);
        setWeatherText(`Сейчас ${temp ?? '--'}°C, ${description}, ветер ${wind ?? '--'} м/с (${city})`);
      } catch (error) {
        setWeatherText('Не удалось получить погоду. Проверь интернет.');
      }
    };

    loadWeather();
  }, []);

  const handleGenerateLooks = () => {
    if (!items.length) {
      Alert.alert('Нет вещей', 'Добавь хотя бы 3 вещи в гардероб.');
      return;
    }
    const generated = buildLooks(items, activeStyle, activeEvent, weatherText, temperature);
    if (!generated.length) {
      Alert.alert('Не удалось собрать лук', 'Добавь больше вещей разных категорий.');
      return;
    }
    setLooks(generated);
    onLooksGenerated(generated, { style: activeStyle, event: activeEvent, weather: weatherText });
  };

  const handleSaveManualLook = () => {
    const selectedItems = [selectedTop, selectedBottom, selectedShoes, selectedOuter, selectedBag].filter(
      Boolean
    ) as WardrobeItem[];
    if (selectedItems.length < 3) {
      Alert.alert('Недостаточно вещей', 'Добавь хотя бы верх, низ и обувь.');
      return;
    }
    const name = manualName.trim() || `Лук ${savedLooks.length + 1}`;
    const newLook: SavedLook = {
      id: Date.now().toString(),
      name,
      itemIds: selectedItems.map((item) => item.id),
      createdAt: Date.now()
    };
    onSavedLooksChange([newLook, ...savedLooks]);
    setManualName('');
    setActiveTab('looks');
  };

  const handleSaveGeneratedLook = (look: GeneratedLook) => {
    const name = look.title || `Лук ${savedLooks.length + 1}`;
    const newLook: SavedLook = {
      id: Date.now().toString(),
      name,
      itemIds: look.itemIds,
      createdAt: Date.now()
    };
    onSavedLooksChange([newLook, ...savedLooks]);
    setActiveTab('looks');
  };

  const openEditLook = (look: SavedLook) => {
    const lookItems = getLookItems(look.itemIds);
    const pickSection = (section: string, fallback: WardrobeItem[]) =>
      lookItems.find((item) => item.section === section) || fallback[0] || null;
    setEditLookId(look.id);
    setEditName(look.name);
    setEditTop(pickSection('Верх', tops));
    setEditBottom(pickSection('Низ', bottoms));
    setEditShoes(pickSection('Обувь', shoes));
    setEditOuter(pickSection('Верхняя одежда', outer));
    setEditBag(pickSection('Сумки', bags));
    setEditModalVisible(true);
  };

  const handleSaveEditedLook = () => {
    if (!editLookId) return;
    const selection = [editTop, editBottom, editShoes, editOuter, editBag].filter(Boolean) as WardrobeItem[];
    if (selection.length < 3) {
      Alert.alert('Недостаточно вещей', 'Добавь хотя бы верх, низ и обувь.');
      return;
    }
    const updated = savedLooks.map((look) =>
      look.id === editLookId
        ? {
            ...look,
            name: editName.trim() || look.name,
            itemIds: selection.map((item) => item.id)
          }
        : look
    );
    onSavedLooksChange(updated);
    setEditModalVisible(false);
  };

  const handleDeleteLook = (id: string) => {
    Alert.alert('Удалить лук?', 'Действие нельзя отменить.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => onSavedLooksChange(savedLooks.filter((look) => look.id !== id))
      }
    ]);
  };

  const renderPicker = (
    title: string,
    list: WardrobeItem[],
    selected: WardrobeItem | null,
    onSelect: (item: WardrobeItem) => void
  ) => (
    <View style={styles.selectorBlock}>
      <Text style={styles.selectorTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>
        {list.map((item) => {
          const active = selected?.id === item.id;
          return (
            <AppPressable
              key={item.id}
              style={[styles.selectorCard, active && styles.selectorCardActive]}
              onPress={() => onSelect(item)}
            >
              {item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={styles.selectorImage} resizeMode="cover" />
              ) : null}
              <Text style={styles.selectorLabel} numberOfLines={1}>
                {item.name}
              </Text>
            </AppPressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}>
        <ScreenTitle
          title="Конструктор образов"
          subtitle="Выбери стиль и событие, а ИИ соберет луки из твоего гардероба с учетом погоды."
        />

        <View style={styles.segment}>
          <AppPressable
            style={[styles.segmentTab, activeTab === 'builder' && styles.segmentTabActive]}
            onPress={() => setActiveTab('builder')}
          >
            <Text style={[styles.segmentText, activeTab === 'builder' && styles.segmentTextActive]}>
              Конструктор
            </Text>
          </AppPressable>
          <AppPressable
            style={[styles.segmentTab, activeTab === 'looks' && styles.segmentTabActive]}
            onPress={() => setActiveTab('looks')}
          >
            <Text style={[styles.segmentText, activeTab === 'looks' && styles.segmentTextActive]}>Луки</Text>
          </AppPressable>
        </View>

        {activeTab === 'builder' ? (
          <>
            <Text style={styles.groupTitle}>Стиль</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {stylePresets.map((preset) => (
                <Chip
                  key={preset}
                  label={preset}
                  active={preset === activeStyle}
                  onPress={() => setActiveStyle(preset)}
                />
              ))}
            </ScrollView>

            <Text style={styles.groupTitle}>Мероприятие</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipsRow, Platform.OS === 'android' && styles.chipsRowAndroid]}
              style={styles.chipsScroll}
            >
              {events.map((event) => (
                <Chip
                  key={event}
                  label={event}
                  active={event === activeEvent}
                  onPress={() => setActiveEvent(event)}
                />
              ))}
            </ScrollView>

            <View style={styles.weatherCard}>
              <Text style={styles.weatherTitle}>Погода рядом с тобой</Text>
              <Text style={styles.weatherText}>{weatherText}</Text>
            </View>

            <AppPressable style={styles.generateButton} onPress={handleGenerateLooks}>
              <Text style={styles.generateText}>Сгенерировать 3-5 образов</Text>
            </AppPressable>

            <View style={styles.manualWrap}>
              <Text style={styles.manualTitle}>Собери образ вручную</Text>
              {renderPicker('Верх', tops, selectedTop, setSelectedTop)}
              {renderPicker('Низ', bottoms, selectedBottom, setSelectedBottom)}
              {renderPicker('Обувь', shoes, selectedShoes, setSelectedShoes)}
              {renderPicker('Верхняя одежда', outer, selectedOuter, setSelectedOuter)}
              {renderPicker('Сумка', bags, selectedBag, setSelectedBag)}

              <Text style={styles.manualLabel}>Название образа</Text>
              <TextInput
                style={styles.manualInput}
                placeholder="Например, Оранжевый кэжуал"
                placeholderTextColor={COLORS.muted}
                value={manualName}
                onChangeText={setManualName}
              />

              <AppPressable style={styles.addLookButton} onPress={handleSaveManualLook}>
                <Text style={styles.addLookText}>Добавить в образы</Text>
              </AppPressable>

              <View style={styles.manualResult}>
                <Text style={styles.manualResultTitle}>Текущий образ</Text>
                {[selectedTop, selectedBottom, selectedShoes, selectedOuter, selectedBag]
                  .filter(Boolean)
                  .map((item) => (
                    <Text key={(item as WardrobeItem).id} style={styles.manualItem}>
                      • {(item as WardrobeItem).name}
                    </Text>
                  ))}
              </View>
            </View>

            <View style={styles.looksWrap}>
              {looks.map((look) => {
                const lookItems = getLookItems(look.itemIds);
                return (
                  <View key={look.id} style={styles.lookCard}>
                    <View style={styles.lookHeader}>
                      <Text style={styles.lookTitle}>{look.title}</Text>
                      <View style={styles.lookActions}>
                        <AppPressable style={styles.secondaryButton} onPress={() => handleSaveGeneratedLook(look)}>
                          <Text style={styles.secondaryButtonText}>В луки</Text>
                        </AppPressable>
                        <AppPressable style={styles.favoriteButton} onPress={() => onFavoriteAdd(look)}>
                          <Text style={styles.favoriteText}>В избранное</Text>
                        </AppPressable>
                      </View>
                    </View>
                    <Text style={styles.lookWeather}>{look.weather}</Text>
                    <LookPreview items={lookItems} />
                    {lookItems.map((item) => (
                      <Text key={item.id} style={styles.lookItem}>
                        • {item.name}
                      </Text>
                    ))}
                    <View style={styles.beautyBlock}>
                      <Text style={styles.beautyTitle}>Макияж</Text>
                      <Text style={styles.beautyText}>{look.makeup}</Text>
                      <Text style={styles.beautyTitle}>Укладка</Text>
                      <Text style={styles.beautyText}>{look.hair}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.looksWrap}>
            {!savedLooks.length ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Пока нет сохраненных образов</Text>
                <Text style={styles.emptyText}>Собери лук вручную и добавь его в образы.</Text>
              </View>
            ) : null}
            {savedLooks.map((look) => {
              const lookItems = getLookItems(look.itemIds);
              return (
                <View key={look.id} style={styles.lookCard}>
                  <View style={styles.lookHeader}>
                    <Text style={styles.lookTitle}>{look.name}</Text>
                    <View style={styles.lookActions}>
                      <AppPressable style={styles.secondaryButton} onPress={() => openEditLook(look)}>
                        <Text style={styles.secondaryButtonText}>Изменить</Text>
                      </AppPressable>
                      <AppPressable style={styles.deleteButton} onPress={() => handleDeleteLook(look.id)}>
                        <Text style={styles.deleteButtonText}>Удалить</Text>
                      </AppPressable>
                    </View>
                  </View>
                  <LookPreview items={lookItems} />
                  {lookItems.map((item) => (
                    <Text key={item.id} style={styles.lookItem}>
                      • {item.name}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={isEditModalVisible} onRequestClose={() => setEditModalVisible(false)}>
        <AppPressable feedback={false} style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
          <AppPressable feedback={false} style={styles.modalCard} onPress={() => undefined}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>Редактировать лук</Text>
                <Text style={styles.modalLabel}>Название</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Название"
                  placeholderTextColor={COLORS.muted}
                  value={editName}
                  onChangeText={setEditName}
                />
                {renderPicker('Верх', tops, editTop, setEditTop)}
                {renderPicker('Низ', bottoms, editBottom, setEditBottom)}
                {renderPicker('Обувь', shoes, editShoes, setEditShoes)}
                {renderPicker('Верхняя одежда', outer, editOuter, setEditOuter)}
                {renderPicker('Сумка', bags, editBag, setEditBag)}
                <AppPressable style={styles.modalSave} onPress={handleSaveEditedLook}>
                  <Text style={styles.modalSaveText}>Сохранить</Text>
                </AppPressable>
                <AppPressable style={styles.modalClose} onPress={() => setEditModalVisible(false)}>
                  <Text style={styles.modalCloseText}>Отмена</Text>
                </AppPressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </AppPressable>
        </AppPressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  pageContent: {
    paddingBottom: 24
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#EFEAE1',
    borderRadius: 14,
    padding: 4,
    marginBottom: 12
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center'
  },
  segmentTabActive: {
    backgroundColor: COLORS.text
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text
  },
  segmentTextActive: {
    color: '#FFFFFF'
  },
  groupTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4
  },
  chipsRow: {
    paddingBottom: 6,
    marginBottom: 16,
    paddingRight: 12
  },
  chipsRowAndroid: {
    paddingBottom: 10,
    marginBottom: 20
  },
  chipsScroll: {
    minHeight: 48
  },
  weatherCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12
  },
  weatherTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700'
  },
  weatherText: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4
  },
  generateButton: {
    backgroundColor: COLORS.text,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 12
  },
  generateText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  manualWrap: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 12
  },
  manualTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  manualLabel: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 6
  },
  manualInput: {
    backgroundColor: '#FBFAF8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text
  },
  addLookButton: {
    marginTop: 10,
    backgroundColor: COLORS.text,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center'
  },
  addLookText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  selectorBlock: {
    marginBottom: 10
  },
  selectorTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  selectorRow: {
    gap: 8,
    paddingBottom: 6
  },
  selectorCard: {
    width: 120,
    backgroundColor: '#FBFAF8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 8
  },
  selectorCardActive: {
    borderColor: COLORS.text
  },
  selectorImage: {
    width: '100%',
    height: 70,
    borderRadius: 8,
    backgroundColor: '#F3EFE8'
  },
  selectorLabel: {
    marginTop: 6,
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'
  },
  manualResult: {
    marginTop: 8
  },
  manualResultTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4
  },
  manualItem: {
    color: COLORS.muted,
    fontSize: 12
  },
  looksWrap: {
    gap: 10,
    paddingBottom: 20
  },
  lookCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 4
  },
  lookHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  lookTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1
  },
  favoriteButton: {
    backgroundColor: '#EFEAE1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  favoriteText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'
  },
  lookActions: {
    flexDirection: 'row',
    gap: 6
  },
  secondaryButton: {
    backgroundColor: '#F1ECE2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'
  },
  deleteButton: {
    backgroundColor: '#FBEAEA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  deleteButtonText: {
    color: '#9B2C2C',
    fontSize: 12,
    fontWeight: '600'
  },
  lookWeather: {
    color: COLORS.muted,
    fontSize: 12,
    marginBottom: 3
  },
  lookItem: {
    color: COLORS.text,
    fontSize: 13
  },
  beautyBlock: {
    marginTop: 6,
    gap: 4
  },
  beautyTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700'
  },
  beautyText: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  emptyState: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 12
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: '85%'
  },
  modalContent: {
    paddingBottom: 24
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#FBFAF8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 8
  },
  modalSave: {
    marginTop: 12,
    backgroundColor: COLORS.text,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  modalClose: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 8
  },
  modalCloseText: {
    color: COLORS.muted,
    fontSize: 13
  }
});
