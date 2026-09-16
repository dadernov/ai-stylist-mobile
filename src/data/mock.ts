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
  sourceImageUri?: string;
  size?: string;
  store?: string;
  material?: string;
};

export const wardrobeItems: WardrobeItem[] = [];
