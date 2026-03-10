import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { ScreenTitle } from '../components/ScreenTitle';
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {stylePresets.map((preset) => {
          const isActive = preset === activeStyle;
          return (
            <Pressable
              key={preset}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => setActiveStyle(preset)}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{preset}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.groupTitle}>Мероприятие</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {events.map((event) => {
          const isActive = event === activeEvent;
          return (
            <Pressable
              key={event}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => setActiveEvent(event)}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{event}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.weatherCard}>
        <Text style={styles.weatherTitle}>Погода в Москве</Text>
        <Text style={styles.weatherText}>Сейчас +8°C, облачно, ветер умеренный</Text>
        <Text style={styles.weatherHint}>ИИ не предложит легкие босоножки и летние ткани.</Text>
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
    gap: 10,
    paddingBottom: 10,
    marginBottom: 8
  },
  chip: {
    backgroundColor: COLORS.chip,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 96
  },
  chipActive: {
    backgroundColor: COLORS.text
  },
  chipText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20
  },
  chipTextActive: {
    color: '#FFFFFF'
  },
  weatherCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10
  },
  weatherTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700'
  },
  weatherText: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 4
  },
  weatherHint: {
    marginTop: 8,
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '600'
  },
  generateButton: {
    backgroundColor: COLORS.text,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginBottom: 12
  },
  generateText: {
    color: '#FFFFFF',
    fontSize: 16,
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
