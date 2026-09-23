import AsyncStorage from '@react-native-async-storage/async-storage';
import storage from './keyValueStorage';
import { Gender, isGender } from '../types/profile';
import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { loadValidated } from './storage';
import { reanchorPhoto } from './photos';

export type ProfileState = { displayName: string; authMethod?: string; avatarUri?: string; modelUri?: string; gender?: Gender; beautyAdvice?: boolean };
export const DATA_KEYS = { profile: 'profileState', wardrobe: 'wardrobeItems', favorites: 'favoriteLooks', lastContext: 'lastContext', lastLooks: 'lastLooks', savedLooks: 'savedLooks' };
export const accountKey = (login: string, key: string) => `account:${encodeURIComponent(login)}:${key}`;
const OWNER_KEY = 'legacyWardrobeOwner';
let migration: Promise<unknown> = Promise.resolve();

export function prepareAccountStorage(login: string, claimLegacy = false): Promise<'ready' | 'claim'> {
  const run = async (): Promise<'ready' | 'claim'> => {
    const marker = accountKey(login, 'storageVersion');
    if (await AsyncStorage.getItem(marker) === '1') return 'ready';
    const owner = await AsyncStorage.getItem(OWNER_KEY);
    const legacy = await AsyncStorage.multiGet(Object.values(DATA_KEYS));
    const hasLegacy = legacy.some(([, value]) => value !== null && !['', '[]', '{}', 'null'].includes(value));
    if (!owner && hasLegacy && !claimLegacy) return 'claim';
    if ((owner === login || (!owner && claimLegacy)) && hasLegacy) {
      // Claim before copying. Keep originals as a recovery backup, including malformed data.
      if (!owner) await AsyncStorage.setItem(OWNER_KEY, login);
      for (const [key, value] of legacy) {
        const target = accountKey(login, key);
        if (value !== null && await storage.getItem(target) === null) await storage.setItem(target, value);
      }
    }
    await AsyncStorage.setItem(marker, '1');
    return 'ready';
  };
  const result = migration.then(run, run);
  migration = result.catch(() => {});
  return result;
}

export async function startWithoutLegacy(login: string) {
  await AsyncStorage.setItem(accountKey(login, 'storageVersion'), '1');
}

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored object');
  return value as Record<string, any>;
};
const string = (value: unknown, fallback?: string): string => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Invalid stored string');
  return value;
};
const optionalString = (value: unknown) => value == null ? undefined : string(value);
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) throw new Error('Invalid stored list');
  return value;
};
const array = <T>(value: unknown, decode: (entry: unknown) => T): T[] => {
  if (!Array.isArray(value)) throw new Error('Invalid stored collection');
  return value.map(decode);
};
export function decodeProfile(value: unknown): ProfileState {
  const p = object(value);
  if (p.gender != null && !isGender(p.gender)) throw new Error('Invalid gender');
  if (p.beautyAdvice != null && typeof p.beautyAdvice !== 'boolean') throw new Error('Invalid preferences');
  return { displayName: string(p.displayName, 'Гость'), authMethod: optionalString(p.authMethod),
    avatarUri: reanchorPhoto(optionalString(p.avatarUri)), modelUri: reanchorPhoto(optionalString(p.modelUri)), gender: p.gender, beautyAdvice: p.beautyAdvice === true };
}
export function decodeWardrobe(value: unknown): WardrobeItem[] {
  return array(value, entry => {
    const item = object(entry);
    return { ...item, id: string(item.id), name: string(item.name), category: string(item.category), section: string(item.section),
      color: string(item.color, 'Не определено'), season: string(item.season, 'Круглый год'), pattern: string(item.pattern, 'Не определено'),
      tags: item.tags === undefined ? [] : strings(item.tags), imageUri: reanchorPhoto(optionalString(item.imageUri)), sourceImageUri: reanchorPhoto(optionalString(item.sourceImageUri)),
      size: optionalString(item.size), store: optionalString(item.store), material: optionalString(item.material) };
  });
}
const number = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid stored number');
  return value;
};
const history = (value: unknown): TryOnHistoryItem[] | undefined => value === undefined ? undefined : array(value, entry => {
  const h = object(entry);
  return { id: string(h.id), imageUri: string(h.imageUri), updatedAt: number(h.updatedAt), warning: optionalString(h.warning),
    tuckMode: ['auto', 'tucked', 'untucked'].includes(h.tuckMode) ? h.tuckMode : 'auto', qualityMode: 'quality' };
});
const commonLook = (entry: unknown) => {
  const look = object(entry);
  return { ...look, id: string(look.id), itemIds: look.itemIds === undefined ? [] : strings(look.itemIds),
    fitScore: look.fitScore === undefined ? undefined : number(look.fitScore),
    fitReasons: look.fitReasons === undefined ? undefined : strings(look.fitReasons),
    warnings: look.warnings === undefined ? undefined : strings(look.warnings),
    stylingTips: look.stylingTips === undefined ? undefined : strings(look.stylingTips),
    tuckMode: (['auto', 'tucked', 'untucked'].includes(look.tuckMode) ? look.tuckMode : undefined) as SavedLook['tuckMode'],
    tryOnImageUri: optionalString(look.tryOnImageUri), tryOnWarning: optionalString(look.tryOnWarning),
    tryOnUpdatedAt: look.tryOnUpdatedAt === undefined ? undefined : number(look.tryOnUpdatedAt),
    tryOnQualityMode: 'quality' as const, tryOnHistory: history(look.tryOnHistory) };
};
export const decodeGenerated = (value: unknown): GeneratedLook[] => array(value, entry => {
  const look = commonLook(entry);
  const source = object(entry);
  return { ...look, title: string(source.title, ''), weather: string(source.weather, ''), style: string(source.style, ''),
    event: string(source.event, ''), makeup: string(source.makeup, ''), hair: string(source.hair, '') };
});
export const decodeSaved = (value: unknown): SavedLook[] => array(value, entry => {
  const look = commonLook(entry);
  const source = object(entry);
  return { ...look, name: string(source.name), createdAt: number(source.createdAt) };
});
export const decodeContext = (value: unknown) => {
  const context = object(value);
  return { style: string(context.style, ''), event: string(context.event, ''), weather: string(context.weather, '') };
};

export async function loadAccountData(login: string) {
  const key = (name: keyof typeof DATA_KEYS) => accountKey(login, DATA_KEYS[name]);
  const [profile, wardrobe, favorites, context, looks, saved] = await Promise.all([
    loadValidated(key('profile'), decodeProfile), loadValidated(key('wardrobe'), decodeWardrobe),
    loadValidated(key('favorites'), decodeGenerated), loadValidated(key('lastContext'), decodeContext),
    loadValidated(key('lastLooks'), decodeGenerated), loadValidated(key('savedLooks'), decodeSaved)
  ]);
  const failed = new Set<string>();
  for (const [name, result] of Object.entries({ profile, wardrobe, favorites, lastContext: context, lastLooks: looks, savedLooks: saved })) {
    if (result.failed) failed.add(DATA_KEYS[name as keyof typeof DATA_KEYS]);
  }
  return { profile: profile.value, items: wardrobe.value || [], favorites: favorites.value || [], context: context.value,
    looks: looks.value || [], saved: saved.value || [], failed };
}
