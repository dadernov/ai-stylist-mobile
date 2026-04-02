export type GeneratedLook = {
  id: string;
  title: string;
  itemIds: string[];
  weather: string;
  style: string;
  event: string;
  makeup: string;
  hair: string;
};

export type SavedLook = {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
};
