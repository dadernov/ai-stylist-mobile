import AsyncStorage from '@react-native-async-storage/async-storage';
import storage from './keyValueStorage';
import { Gender, isGender } from '../types/profile';
import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';
import { WardrobeItem } from '../data/mock';
import { decodeGarmentProfile, decodeStyleVec, decodeTraits } from '../domain/garmentTraits';
export { decodeTraits } from '../domain/garmentTraits';
import { loadRaw, loadValidated, saveJson } from './storage';
import { mergeSavedLooks, settleTryOnLinks } from '../domain/favorites';
import { reanchorPhoto, removeUnusedPhotos } from './photos';

export type ProfileState = { displayName: string; authMethod?: string; avatarUri?: string; modelUri?: string; gender?: Gender; beautyAdvice?: boolean };
export const DATA_KEYS = { profile: 'profileState', wardrobe: 'wardrobeItems', favorites: 'favoriteLooks', lastContext: 'lastContext', lastLooks: 'lastLooks', savedLooks: 'savedLooks' };
export const accountKey = (login: string, key: string) => `account:${encodeURIComponent(login)}:${key}`;
const OWNER_KEY = 'legacyWardrobeOwner';
let migration: Promise<unknown> = Promise.resolve();

export function prepareAccountStorage(login: string, claimLegacy = false): Promise<'ready' | 'claim'> {
  purged.delete(login); // Registered again under the login: a new account.
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
      size: optionalString(item.size), store: optionalString(item.store), material: optionalString(item.material), traits: decodeTraits(item.traits),
      profile: decodeGarmentProfile(item.profile), styleVec: decodeStyleVec(item.styleVec) };
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
    tryOnQualityMode: 'quality' as const, tryOnHistory: history(look.tryOnHistory),
    joined: look.joined && typeof look.joined === 'object' ? { tuckMode: (['auto', 'tucked', 'untucked'].includes(look.joined.tuckMode) ? look.joined.tuckMode : undefined) as SavedLook['tuckMode'] } : undefined };
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

const SAVED_MERGED = 'savedLooksMerged';

/**
 * The saved looks move into the favourites, once. Runs before anything is shown or written, and only when both lists were read.
 * The old list goes last: first the favourites holding it are written and read back, then the mark that this is done; a crash at any
 * point leaves the old list, and the next launch repeats what is left (mergeSavedLooks finds what is already there).
 * `pending` is how many looks are still waiting in the old list.
 */
export async function migrateSavedLooks(login: string, data: { favorites: GeneratedLook[]; saved: SavedLook[]; failed: Set<string> }) {
  const unmoved = { favorites: data.favorites, pending: data.saved.length };
  if (data.failed.has(DATA_KEYS.favorites) || data.failed.has(DATA_KEYS.savedLooks)) return unmoved;
  const savedKey = accountKey(login, DATA_KEYS.savedLooks);
  const favoritesKey = accountKey(login, DATA_KEYS.favorites);
  try {
    const done = await loadRaw(accountKey(login, SAVED_MERGED));
    if (done.failed) return unmoved;
    // Done before: what is left of the old list is only its removal, which must not bring back a look deleted since.
    if (done.value === '1') { await storage.removeItem(savedKey).catch(() => {}); return { favorites: data.favorites, pending: 0 }; }
    if (!data.saved.length) return unmoved;
    const favorites = mergeSavedLooks(data.favorites, data.saved);
    if (favorites !== data.favorites) await saveJson(favoritesKey, favorites);
    const written = await loadValidated(favoritesKey, decodeGenerated);
    if (written.failed || favorites.some(look => !written.value?.some(other => other.id === look.id))) return unmoved;
    await storage.setItem(accountKey(login, SAVED_MERGED), '1');
    await storage.removeItem(savedKey).catch(() => {});
    return { favorites, pending: 0 };
  } catch (error) {
    console.warn('Failed to move saved looks', error);
    return unmoved;
  }
}

const purged = new Set<string>();
export const isPurged = (login: string) => purged.has(login);

/** Стирает всё локальное для аккаунта: записи, фото гардероба и кадры примерок. */
export async function purgeAccountData(login: string) {
  purged.add(login);
  const keys = [...Object.values(DATA_KEYS), 'tryOnJobs', 'storageVersion', 'aiConsent', 'closetSync', 'dismissedLooks', 'favoriteColors', 'dailyLook', 'onboardingSeen', SAVED_MERGED].map(key => accountKey(login, key));
  await Promise.all(keys.flatMap(key => [storage.removeItem(key).catch(() => {}), AsyncStorage.removeItem(key).catch(() => {})]));
  await removeUnusedPhotos([], login).catch(() => {});
  await removeTryOnFrames(login).catch(() => {});
  // The pre-accounts copy kept as a backup is this account's data too: left behind, it would come back with the same login.
  if (await AsyncStorage.getItem(OWNER_KEY).catch(() => null) === login) {
    await AsyncStorage.multiRemove([...Object.values(DATA_KEYS), OWNER_KEY]).catch(() => {});
  }
}

async function removeTryOnFrames(login: string) {
  const FileSystem = await import('expo-file-system/legacy');
  if (!FileSystem.documentDirectory) return;
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}try-ons/${encodeURIComponent(login)}/`, { idempotent: true });
}

/** The favourites with no picture left hanging on a server link. A list that could not be read is left alone. */
export async function settleFavoriteLinks(login: string, favorites: GeneratedLook[], failed: Set<string>) {
  if (failed.has(DATA_KEYS.favorites)) return favorites;
  const { keepTryOnImage } = await import('./tryOnPhotos');
  return settleTryOnLinks(favorites, Date.now(), (uri, id) => keepTryOnImage(uri, id, login));
}
