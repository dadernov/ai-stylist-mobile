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

/**
 * What the garment's own photo shows, read by the server's local model
 * (clothing_analysis): a polo or a dress may be short- or long-sleeved, a coat
 * short or long, a hoodie may zip open. null where the photo left it unsure;
 * a missing `traits` means the item has not been read yet.
 */
export type GarmentTraits = {
  sleeves?: 'long' | 'short' | 'none' | null;
  length?: 'cropped' | 'hip' | 'long' | null;
  opening?: 'front' | 'none' | null;
  bulk?: 'bulky' | 'thin' | null;
};

export type WardrobeItem = ClothingItem & {
  imageUri?: string;
  sourceImageUri?: string;
  size?: string;
  store?: string;
  material?: string;
  traits?: GarmentTraits;
};

export const wardrobeItems: WardrobeItem[] = [];
