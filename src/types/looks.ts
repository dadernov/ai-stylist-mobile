export type GeneratedLook = {
  id: string;
  title: string;
  itemIds: string[];
  weather: string;
  style: string;
  event: string;
  makeup: string;
  hair: string;
  fitScore?: number;
  fitReasons?: string[];
  tuckMode?: 'auto' | 'tucked' | 'untucked';
  tryOnImageUri?: string;
  tryOnWarning?: string;
  tryOnUpdatedAt?: number;
  tryOnQualityMode?: 'fast' | 'quality';
  tryOnHistory?: TryOnHistoryItem[];
};

export type SavedLook = {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
  fitScore?: number;
  fitReasons?: string[];
  tuckMode?: 'auto' | 'tucked' | 'untucked';
  tryOnImageUri?: string;
  tryOnWarning?: string;
  tryOnUpdatedAt?: number;
  tryOnQualityMode?: 'fast' | 'quality';
  tryOnHistory?: TryOnHistoryItem[];
};

export type TryOnHistoryItem = {
  id: string;
  imageUri: string;
  warning?: string;
  updatedAt: number;
  tuckMode?: 'auto' | 'tucked' | 'untucked';
  qualityMode?: 'fast' | 'quality';
};
