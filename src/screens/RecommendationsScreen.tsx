import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { FadeInView } from '../components/ui/FadeInView';
import { RADII, SERIF, SHADOWS, TYPE, ThemeColors } from '../constants/theme';
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

// Журнальная заметка: бронзовый номер + eyebrow, серифный заголовок, gold hairline.
type IdeaCard = {
  key: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
};

export function RecommendationsScreen({ looks, context }: RecommendationsProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const hasContext = context?.style && context?.event;
  const beauty = hasContext ? beautyMap[context.event] || beautyMap['Прогулка'] : null;
  const styleCardTips = hasContext ? styleTips[context.style] || [] : [];
  const eventCardTips = hasContext ? eventTips[context.event] || [] : [];

  const cards: IdeaCard[] = [];

  if (hasContext && beauty) {
    cards.push({
      key: 'beauty',
      eyebrow: t('Для: {style} · {event}', { style: t(context.style), event: t(context.event) }),
      title: t('Макияж и укладка'),
      body: (
        <View style={styles.noteBody}>
          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>{t('Макияж')}</Text>
            <Text style={styles.noteText}>{t(beauty.makeup)}</Text>
          </View>
          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>{t('Укладка')}</Text>
            <Text style={styles.noteText}>{t(beauty.hair)}</Text>
          </View>
          {context.weather ? <Text style={styles.weatherNote}>{context.weather}</Text> : null}
        </View>
      )
    });
  }

  if (looks.length) {
    cards.push({
      key: 'looks',
      eyebrow: t('Из генератора'),
      title: t('Последние луки'),
      body: (
        <View style={styles.noteBody}>
          {looks.slice(0, 3).map((look, idx) => (
            <View key={look.id} style={[styles.lookRow, idx > 0 && styles.lookRowDivider]}>
              <Text style={styles.lookTitle}>{look.title}</Text>
              {look.fitReasons?.[0] ? <Text style={styles.lookReason}>{look.fitReasons[0]}</Text> : null}
            </View>
          ))}
        </View>
      )
    });
  }

  if (hasContext && styleCardTips.length) {
    cards.push({
      key: 'style',
      eyebrow: t('Стиль'),
      title: t(context.style),
      body: (
        <View style={styles.noteBody}>
          {styleCardTips.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={styles.tipDash}>—</Text>
              <Text style={styles.tipText}>{t(tip)}</Text>
            </View>
          ))}
        </View>
      )
    });
  }

  if (hasContext && eventCardTips.length) {
    cards.push({
      key: 'event',
      eyebrow: t('Событие'),
      title: t(context.event),
      body: (
        <View style={styles.noteBody}>
          {eventCardTips.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={styles.tipDash}>—</Text>
              <Text style={styles.tipText}>{t(tip)}</Text>
            </View>
          ))}
        </View>
      )
    });
  }

  if (!hasContext) {
    fallbackCards.forEach((card) => {
      cards.push({
        key: card.title,
        eyebrow: t('Совет стилиста'),
        title: t(card.title),
        body: <Text style={styles.noteText}>{t(card.text)}</Text>
      });
    });
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow={t('Журнал стилиста')}
        title={t('Рекомендации')}
        subtitle={t('Макияж, волосы и стилизация под выбранный стиль и событие.')}
      />

      <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
        {cards.map((card, i) => (
          <FadeInView key={card.key} delay={i * 60}>
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardEyebrow} numberOfLines={1}>
                  {card.eyebrow}
                </Text>
                <Text style={styles.cardNumber}>{String(i + 1).padStart(2, '0')}</Text>
              </View>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.hairline} />
              {card.body}
            </View>
          </FadeInView>
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
    gap: 14,
    paddingBottom: 32
  },
  card: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: RADII.lg,
    padding: 18,
    ...SHADOWS.card
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  cardEyebrow: {
    ...TYPE.eyebrow,
    color: c.accentGold,
    flex: 1,
    paddingRight: 12
  },
  cardNumber: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: 24,
    lineHeight: 28,
    color: c.accentGold
  },
  cardTitle: {
    fontFamily: SERIF,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 27,
    color: c.text
  },
  hairline: {
    height: 1,
    backgroundColor: c.goldHairline,
    marginTop: 12,
    marginBottom: 12
  },
  noteBody: {
    gap: 12
  },
  noteBlock: {
    gap: 3
  },
  noteLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: c.accentGold
  },
  noteText: {
    ...TYPE.body,
    color: c.muted
  },
  weatherNote: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: 13.5,
    lineHeight: 19,
    color: c.muted
  },
  tipRow: {
    flexDirection: 'row',
    gap: 8
  },
  tipDash: {
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 22,
    color: c.accentGold
  },
  tipText: {
    ...TYPE.body,
    color: c.muted,
    flex: 1
  },
  lookRow: {
    gap: 3
  },
  lookRowDivider: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 10
  },
  lookTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text
  },
  lookReason: {
    fontSize: 13,
    lineHeight: 18,
    color: c.muted
  }
});
