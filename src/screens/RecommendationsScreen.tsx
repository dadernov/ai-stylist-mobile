import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenTitle } from '../components/ScreenTitle';
import { ThemeColors } from '../constants/theme';
import { useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
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

const styleTips: Record<string, string[]> = {
  Кэжуал: ['Сочетай 1 базовую и 1 акцентную вещь.', 'Лучше работают однотонные и клетчатые сочетания.'],
  'Спорт-шик': ['Добавляй чистые спортивные силуэты.', 'Избегай строгих туфель и перегруженных фактур.'],
  Романтичный: ['Ставь в центр мягкие ткани и плавные линии.', 'Лучше смотрятся светлые и теплые оттенки.'],
  Бохо: ['Комбинируй фактуры: хлопок, деним, трикотаж.', 'Используй естественные и приглушенные тона.'],
  Минимализм: ['Держи палитру в 2-3 оттенках.', 'Максимум один акцентный элемент в луке.'],
  Офисный: ['Выбирай структурный верх и чистый низ.', 'Палитра нейтральная или холодная: белый, графит, синий.']
};

const eventTips: Record<string, string[]> = {
  Свидание: ['Силуэт должен быть аккуратным и не перегруженным.', 'Добавь одну более выразительную вещь по цвету.'],
  Прогулка: ['Ставка на комфорт: кеды/кроссовки и дышащие ткани.', 'Можно больше свободы в слоях и фактурах.'],
  Совещание: ['Лучше однотонный или полосатый верх.', 'Избегай спортивных и слишком расслабленных категорий.'],
  Вечеринка: ['Разрешен более контрастный верх или низ.', 'Лучше выбрать более выразительную обувь.'],
  Спортзал: ['Фокус на функциональности и удобной посадке.', 'Лучше спортивная обувь и простой однотонный верх.']
};

export function RecommendationsScreen({ looks, context }: RecommendationsProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const hasContext = context?.style && context?.event;
  const beauty = hasContext ? beautyMap[context.event] || beautyMap['Прогулка'] : null;
  const styleCardTips = hasContext ? styleTips[context.style] || [] : [];
  const eventCardTips = hasContext ? eventTips[context.event] || [] : [];

  return (
    <View style={styles.container}>
      <ScreenTitle
        title={t('Рекомендации')}
        subtitle={t('Макияж, волосы и стилизация под выбранный стиль и событие.')}
      />

      <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
        {hasContext && beauty ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Для: {style} · {event}', { style: t(context.style), event: t(context.event) })}</Text>
            <Text style={styles.cardText}>{t('Макияж: {value}', { value: t(beauty.makeup) })}</Text>
            <Text style={styles.cardText}>{t('Укладка: {value}', { value: t(beauty.hair) })}</Text>
            {context.weather ? <Text style={styles.cardHint}>{context.weather}</Text> : null}
          </View>
        ) : null}

        {looks.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Последние луки')}</Text>
            {looks.slice(0, 3).map((look) => (
              <View key={look.id} style={styles.lookReasonRow}>
                <Text style={styles.cardText}>• {look.title}</Text>
                {look.fitReasons?.[0] ? <Text style={styles.cardHint}>↳ {look.fitReasons[0]}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {hasContext && styleCardTips.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Под стиль: {style}', { style: t(context.style) })}</Text>
            {styleCardTips.map((tip) => (
              <Text key={tip} style={styles.cardText}>
                • {t(tip)}
              </Text>
            ))}
          </View>
        ) : null}

        {hasContext && eventCardTips.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Под событие: {event}', { event: t(context.event) })}</Text>
            {eventCardTips.map((tip) => (
              <Text key={tip} style={styles.cardText}>
                • {t(tip)}
              </Text>
            ))}
          </View>
        ) : null}

        {(hasContext ? [] : fallbackCards).map((card) => (
          <View key={card.title} style={styles.card}>
            <Text style={styles.cardTitle}>{t(card.title)}</Text>
            <Text style={styles.cardText}>{t(card.text)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1
  },
  cardsWrap: {
    gap: 10,
    paddingBottom: 20
  },
  card: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    padding: 14,
    gap: 6
  },
  cardTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '700'
  },
  cardText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 18
  },
  cardHint: {
    color: c.muted,
    fontSize: 12,
    marginTop: 4
  },
  lookReasonRow: {
    gap: 2
  }
});
