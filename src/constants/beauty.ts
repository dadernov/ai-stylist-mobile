// Советы по макияжу и укладке под событие. Раньше этот же объект был
// побайтово продублирован в OutfitBuilderScreen.tsx и RecommendationsScreen.tsx —
// правка в одном месте не попадала во второе. Вынесен сюда как общий источник.
export type BeautyTip = { makeup: string; hair: string };

export const beautyMap: Record<string, BeautyTip> = {
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

export const pickBeauty = (event: string): BeautyTip => beautyMap[event] || beautyMap['Прогулка'];
