import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenTitle } from '../components/ScreenTitle';
import { COLORS } from '../constants/theme';

const cards = [
  {
    title: 'Макияж под офисный лук',
    text: 'Nude-тон, мягкий контур и аккуратная подводка. Акцент на свежую кожу.'
  },
  {
    title: 'Укладка на совещание',
    text: 'Низкий гладкий хвост или пучок. Чистый силуэт и минимум лишнего объема.'
  },
  {
    title: 'Быстрый вечерний апгрейд',
    text: 'Добавь smoky eyes и текстурные локоны, если после работы идешь на мероприятие.'
  },
  {
    title: 'Капсула на неделю',
    text: 'Собери 6–8 базовых вещей, которые комбинируются между собой. Это экономит время.'
  },
  {
    title: 'Аксессуары без перегруза',
    text: 'Выбери 1 акцент: серьги, сумку или обувь. Так образ остается аккуратным.'
  },
  {
    title: 'Цветовые пары',
    text: 'Бежевый + черный, молочный + деним, оливковый + белый — универсальные сочетания.'
  }
];

export function RecommendationsScreen() {
  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Рекомендации"
        subtitle="Подборки по макияжу, волосам и стилизации. Позже добавим ИИ-блоки."
      />

      <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
        {cards.map((card) => (
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
  }
});
