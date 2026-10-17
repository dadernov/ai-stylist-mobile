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

/**
 * A stylist's reading of the garment's photo (server stylist.profile): what it
 * is, its colours, fabric and fit, how formal and how warm it is, the styles it
 * belongs to. The outfit ideas read the wardrobe through it; a missing
 * `profile` means the item has not been read yet.
 */
export type GarmentProfile = {
  kind?: string; colors?: string[]; hex?: string | null; pattern?: string; material?: string; fit?: string;
  formality?: number | null; warmth?: number | null; styles?: string[]; occasions?: string[]; seasons?: string[]; notes?: string;
};

export type WardrobeItem = ClothingItem & {
  imageUri?: string;
  sourceImageUri?: string;
  size?: string;
  store?: string;
  material?: string;
  traits?: GarmentTraits;
  profile?: GarmentProfile;
};

export const wardrobeItems: WardrobeItem[] = [];
