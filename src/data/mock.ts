export type ClothingItem = {
  id: string;
  name: string;
  category: string;
  color: string;
  season: string;
  pattern: string;
  section: string;
  tags: string[];
};

export type WardrobeItem = ClothingItem & {
  imageUri?: string;
  size?: string;
  store?: string;
  material?: string;
};

export const wardrobeItems: WardrobeItem[] = [
  {
    id: '1',
    name: 'Белая футболка oversize',
    category: 'Футболка',
    color: 'Белый',
    season: 'Демисезон',
    pattern: 'Однотонный',
    section: 'Верх',
    tags: ['Cotton', 'Mango', 'M']
  },
  {
    id: '2',
    name: 'Синие джинсы mom-fit',
    category: 'Джинсы',
    color: 'Синий деним',
    season: 'Круглый год',
    pattern: 'Однотонный',
    section: 'Низ',
    tags: ['Levis', '28']
  },
  {
    id: '3',
    name: 'Черный жакет',
    category: 'Пиджак',
    color: 'Черный',
    season: 'Демисезон',
    pattern: 'Однотонный',
    section: 'Верхняя одежда',
    tags: ['Zara', 'S']
  },
  {
    id: '4',
    name: 'Бежевые лоферы',
    category: 'Обувь',
    color: 'Бежевый',
    season: 'Весна/Осень',
    pattern: 'Однотонный',
    section: 'Обувь',
    tags: ['Кожа']
  }
];

export const generatedLooks = [
  {
    id: 'l1',
    title: 'Лук 1 · Офисный минимализм',
    weather: '+8°C, облачно',
    items: ['Белая футболка oversize', 'Черный жакет', 'Синие джинсы mom-fit', 'Бежевые лоферы']
  },
  {
    id: 'l2',
    title: 'Лук 2 · Smart casual',
    weather: '+8°C, облачно',
    items: ['Белая футболка oversize', 'Синие джинсы mom-fit', 'Бежевые лоферы']
  },
  {
    id: 'l3',
    title: 'Лук 3 · Романтичный с акцентом',
    weather: '+8°C, облачно',
    items: ['Белая футболка oversize', 'Черный жакет', 'Бежевые лоферы']
  }
];
