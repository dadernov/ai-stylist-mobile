export type GeneratedLook = {
  id: string;
  title: string;
  itemIds: string[];
  weather: string;
  style: string;
  event: string;
  makeup: string;
  hair: string;
  temperature?: number | null;
  stylingTips?: string[];
  warnings?: string[];
  fitScore?: number;
  /** Процент совпадения по пяти критериям (evaluateLook). */
  matchPercent?: number;
  fitReasons?: string[];
  tuckMode?: 'auto' | 'tucked' | 'untucked';
  /** Put together by the stylist model (server /looks) rather than the rules; `why` is its idea of the look. */
  source?: 'stylist' | 'rules';
  why?: string;
  tryOnImageUri?: string;
  /** The server link the kept picture came from: the look on screen may still hold it, and is the same favourite. */
  tryOnSourceUri?: string;
  tryOnWarning?: string;
  tryOnUpdatedAt?: number;
  tryOnQualityMode?: 'fast' | 'quality';
  tryOnHistory?: TryOnHistoryItem[];
  /** This try-on joined a favourite saved without one; what to give back when it is unsaved. */
  joined?: { tuckMode?: 'auto' | 'tucked' | 'untucked' };
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
