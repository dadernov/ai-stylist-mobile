import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { ScreenTitle } from '../components/ScreenTitle';
import { Chip } from '../components/Chip';
import { COLORS } from '../constants/theme';
import { generatedLooks } from '../data/mock';

const stylePresets = ['Кэжуал', 'Спорт-шик', 'Романтичный', 'Бохо', 'Минимализм', 'Офисный'];
const events = ['Свидание', 'Прогулка', 'Совещание', 'Вечеринка', 'Спортзал'];

export function OutfitBuilderScreen() {
  const [activeStyle, setActiveStyle] = useState(stylePresets[0]);
  const [activeEvent, setActiveEvent] = useState(events[2]);

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Конструктор образов"
        subtitle="Выбери стиль и событие, а ИИ соберет луки из твоего гардероба с учетом погоды."
      />

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
        <Text style={styles.weatherTitle}>Погода в Москве</Text>
        <Text style={styles.weatherText}>Сейчас +8°C, облачно, ветер умеренный</Text>
      </View>

      <Pressable
        style={styles.generateButton}
        onPress={() =>
          Alert.alert(
            'Готово',
            `Сгенерировано 3 образа для: ${activeStyle} · ${activeEvent}.`
          )
        }
      >
        <Text style={styles.generateText}>Сгенерировать 3-5 образов</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.looksWrap}>
        {generatedLooks.map((look) => (
          <View key={look.id} style={styles.lookCard}>
            <Text style={styles.lookTitle}>{look.title}</Text>
            <Text style={styles.lookWeather}>{look.weather}</Text>
            {look.items.map((item) => (
              <Text key={item} style={styles.lookItem}>• {item}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
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
  lookTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700'
  },
  lookWeather: {
    color: COLORS.muted,
    fontSize: 12,
    marginBottom: 3
  },
  lookItem: {
    color: COLORS.text,
    fontSize: 13
  }
});
