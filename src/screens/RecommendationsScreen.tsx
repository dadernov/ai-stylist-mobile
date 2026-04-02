import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenTitle } from '../components/ScreenTitle';
import { COLORS } from '../constants/theme';
import { GeneratedLook } from '../types/looks';

type RecommendationsProps = {
  looks: GeneratedLook[];
  context: { style: string; event: string; weather: string };
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

const fallbackCards = [
  {
    title: 'Универсальный нюд',
    text: 'Легкий тон, аккуратная тушь, бальзам или тинт. Подходит для большинства ситуаций.'
  },
  {
    title: 'Быстрая укладка',
    text: 'Низкий хвост, легкие локоны или пучок — идеально, когда мало времени.'
  },
  {
    title: 'Цветовые пары',
    text: 'Бежевый + черный, молочный + деним, оливковый + белый.'
  }
];

export function RecommendationsScreen({ looks, context }: RecommendationsProps) {
  const hasContext = context?.style && context?.event;
  const beauty = hasContext ? beautyMap[context.event] || beautyMap['Прогулка'] : null;

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Рекомендации"
        subtitle="Макияж, волосы и стилизация под выбранный стиль и событие."
      />

      <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
        {hasContext && beauty ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Для: {context.style} · {context.event}</Text>
            <Text style={styles.cardText}>Макияж: {beauty.makeup}</Text>
            <Text style={styles.cardText}>Укладка: {beauty.hair}</Text>
            {context.weather ? <Text style={styles.cardHint}>{context.weather}</Text> : null}
          </View>
        ) : null}

        {looks.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Последние луки</Text>
            {looks.slice(0, 3).map((look) => (
              <Text key={look.id} style={styles.cardText}>
                • {look.title}
              </Text>
            ))}
          </View>
        ) : null}

        {fallbackCards.map((card) => (
          <View key={card.title} style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardText}>{card.text}</Text>
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
  cardsWrap: {
    gap: 10,
    paddingBottom: 20
  },
  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    gap: 6
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700'
  },
  cardText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18
  },
  cardHint: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4
  }
});
