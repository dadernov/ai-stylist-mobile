import * as Crypto from 'expo-crypto';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { AI_BASE_URL } from '../constants/ai';
import { WardrobeItem } from '../data/mock';
import { Gender } from '../types/profile';
import { appendPhoto, authHeaders } from './ai';
import { Session } from './auth';
import { accountKey } from './accountStorage';
import { fetchJson } from './http';
import { accountPhotoDirectory } from './photos';
import { loadJson, saveJson } from './storage';

/**
 * The wardrobe and the try-on photo, kept on the server as well (server: closet.py).
 *
 * The phone stays the working copy: everything is read and changed locally and
 * this only mirrors it. First it takes what another device changed, then it
 * sends what differs here from the last sync. Photos go separately and once:
 * an item refers to them by id. A change made on this device and not sent yet
 * wins over an older one from the server.
 */
type PhotoRef = { uri: string; blob: string };
type SyncedItem = { hash: string; updated: number; image?: PhotoRef; source?: PhotoRef };
type SyncedProfile = { hash: string; updated: number; model?: PhotoRef; avatar?: PhotoRef };
type SyncState = { since: number; items: Record<string, SyncedItem>; profile?: SyncedProfile };
type Remote = {
  items: { id: string; data: Record<string, unknown>; updated: number; deleted: boolean }[];
  profile: { data: Record<string, unknown>; updated: number } | null;
  now: number;
};

export type ClosetProfile = { gender?: Gender; beautyAdvice?: boolean; modelUri?: string; avatarUri?: string };
export type ClosetIO = {
  items: () => WardrobeItem[];
  applyItems: (update: (current: WardrobeItem[]) => WardrobeItem[]) => void;
  profile: () => ClosetProfile;
  applyProfile: (profile: ClosetProfile) => void;
};

const STATE_KEY = 'closetSync';
// A wardrobe that suddenly reads empty is more likely a fault than a person
// deleting everything: then no more than this many deletions go out.
const MASS_DELETE = 3;

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().filter(key => (value as any)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}` : JSON.stringify(value);
const hashOf = (data: unknown) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, stable(data));

const fieldsOf = (item: WardrobeItem) => {
  const { id: _id, imageUri: _image, sourceImageUri: _source, ...fields } = item;
  return fields;
};
// The item as the server keeps it; a photo not sent yet has no id and marks the item changed.
const dataOf = (item: WardrobeItem, known?: SyncedItem) => ({ ...fieldsOf(item),
  imageBlob: item.imageUri ? known?.image?.uri === item.imageUri ? known.image.blob : 'unsent' : undefined,
  sourceBlob: item.sourceImageUri ? known?.source?.uri === item.sourceImageUri ? known.source.blob : 'unsent' : undefined });
const profileData = (profile: ClosetProfile, known?: SyncedProfile) => ({ gender: profile.gender, beautyAdvice: profile.beautyAdvice === true,
  modelBlob: profile.modelUri ? known?.model?.uri === profile.modelUri ? known.model.blob : 'unsent' : undefined,
  avatarBlob: profile.avatarUri ? known?.avatar?.uri === profile.avatarUri ? known.avatar.blob : 'unsent' : undefined });

const call = async <T,>(session: Session, path: string, init: RequestInit = {}, timeoutMs = 20000) =>
  fetchJson<T>(AI_BASE_URL + path, { ...init, headers: { ...(await authHeaders(session)), ...(init.headers || {}) } }, timeoutMs);
const putJson = (session: Session, path: string, data: unknown) =>
  call<{ updated: number }>(session, path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });

async function upload(session: Session, uri: string) {
  const form = new FormData();
  await appendPhoto(form, 'file', uri, true);
  return (await call<{ id: string }>(session, '/closet/blobs', { method: 'POST', body: form }, 90000)).id;
}

async function download(session: Session, blob: string): Promise<string> {
  const url = `${AI_BASE_URL}/closet/blobs/${encodeURIComponent(blob)}`;
  const headers = await authHeaders(session);
  if (Platform.OS === 'web') {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`closet photo ${response.status}`);
    const data = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(data);
    });
  }
  const directory = accountPhotoDirectory(session.login);
  await LegacyFileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}closet-${blob}`;
  const result = await LegacyFileSystem.downloadAsync(url, target, { headers });
  if (result.status < 200 || result.status >= 300) throw new Error(`closet photo ${result.status}`);
  // The extension tells a cut-out (PNG) from a photo when it is sent again.
  const type = String(result.headers['Content-Type'] || result.headers['content-type'] || '');
  const named = `${target}.${type.includes('png') ? 'png' : 'jpg'}`;
  await LegacyFileSystem.moveAsync({ from: target, to: named });
  return named;
}

const sent = async (session: Session, uri: string | undefined, known?: PhotoRef): Promise<PhotoRef | undefined> =>
  !uri ? undefined : known?.uri === uri ? known : { uri, blob: await upload(session, uri) };
const received = async (session: Session, blob: unknown, known?: PhotoRef, current?: string): Promise<PhotoRef | undefined> =>
  typeof blob !== 'string' ? undefined : known?.blob === blob && current === known.uri ? known : { uri: await download(session, blob), blob };

// A photo still on its way into the app's folder gets a new path in a moment: it waits for it.
const settled = (session: Session, uri?: string) => !uri || Platform.OS === 'web' || uri.startsWith(accountPhotoDirectory(session.login));

export async function syncCloset(session: Session, io: ClosetIO, options: { canDelete: boolean }) {
  const key = accountKey(session.login, STATE_KEY);
  const loaded = await loadJson<SyncState>(key);
  if (loaded.failed) return;
  const state: SyncState = loaded.value && typeof loaded.value.since === 'number' ? loaded.value : { since: 0, items: {} };
  const save = () => saveJson(key, state);

  // 1. What another device changed since the last sync.
  const remote = await call<Remote>(session, `/closet?since=${encodeURIComponent(String(state.since))}`);
  const local = new Map(io.items().map(item => [item.id, item]));
  const incoming = new Map<string, WardrobeItem>();
  const removed = new Set<string>();
  for (const entry of remote.items) {
    const known = state.items[entry.id];
    if (known && known.updated >= entry.updated) continue;
    const current = local.get(entry.id);
    // Changed here and not sent yet: this device's version goes out below.
    if (current && known && await hashOf(dataOf(current, known)) !== known.hash) continue;
    if (entry.deleted) {
      if (current) removed.add(entry.id);
      delete state.items[entry.id];
      continue;
    }
    const image = await received(session, entry.data.imageBlob, known?.image, current?.imageUri);
    const source = entry.data.sourceBlob === entry.data.imageBlob ? image : await received(session, entry.data.sourceBlob, known?.source, current?.sourceImageUri);
    const { imageBlob: _image, sourceBlob: _source, ...fields } = entry.data;
    incoming.set(entry.id, { ...(fields as Omit<WardrobeItem, 'id'>), id: entry.id, imageUri: image?.uri, sourceImageUri: source?.uri });
    state.items[entry.id] = { hash: await hashOf(entry.data), updated: entry.updated, image, source };
  }
  const merge = (current: WardrobeItem[]) => {
    const kept = current.filter(item => !removed.has(item.id)).map(item => incoming.get(item.id) || item);
    const added = [...incoming.values()].filter(item => !current.some(existing => existing.id === item.id));
    return [...added, ...kept];
  };
  if (incoming.size || removed.size) io.applyItems(merge);

  let profile = io.profile();
  if (remote.profile && (!state.profile || remote.profile.updated > state.profile.updated)
    && (!state.profile || await hashOf(profileData(profile, state.profile)) === state.profile.hash)) {
    const data = remote.profile.data;
    const model = await received(session, data.modelBlob, state.profile?.model, profile.modelUri);
    const avatar = await received(session, data.avatarBlob, state.profile?.avatar, profile.avatarUri);
    profile = { gender: data.gender as Gender | undefined, beautyAdvice: data.beautyAdvice === true, modelUri: model?.uri, avatarUri: avatar?.uri };
    io.applyProfile(profile);
    state.profile = { hash: await hashOf(data), updated: remote.profile.updated, model, avatar };
  }
  state.since = remote.now;
  await save();

  // 2. What changed here.
  const items = merge(io.items());
  for (const item of items) {
    if (!settled(session, item.imageUri) || !settled(session, item.sourceImageUri)) continue;
    const known = state.items[item.id];
    if (known && await hashOf(dataOf(item, known)) === known.hash) continue;
    const image = await sent(session, item.imageUri, known?.image);
    const source = item.sourceImageUri === item.imageUri ? image : await sent(session, item.sourceImageUri, known?.source);
    const data = { ...fieldsOf(item), imageBlob: image?.blob, sourceBlob: source?.blob };
    const { updated } = await putJson(session, `/closet/items/${encodeURIComponent(item.id)}`, data);
    state.items[item.id] = { hash: await hashOf(data), updated, image, source };
    await save();
  }
  const present = new Set(items.map(item => item.id));
  const gone = Object.keys(state.items).filter(id => !present.has(id));
  if (options.canDelete && (items.length || gone.length <= MASS_DELETE)) {
    for (const id of gone) {
      await call(session, `/closet/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      delete state.items[id];
      await save();
    }
  }

  if (settled(session, profile.modelUri) && settled(session, profile.avatarUri)
    && (!state.profile || await hashOf(profileData(profile, state.profile)) !== state.profile.hash)) {
    const model = await sent(session, profile.modelUri, state.profile?.model);
    const avatar = await sent(session, profile.avatarUri, state.profile?.avatar);
    const data = { gender: profile.gender, beautyAdvice: profile.beautyAdvice === true, modelBlob: model?.blob, avatarBlob: avatar?.blob };
    const { updated } = await putJson(session, '/closet/profile', data);
    state.profile = { hash: await hashOf(data), updated, model, avatar };
    await save();
  }
}
