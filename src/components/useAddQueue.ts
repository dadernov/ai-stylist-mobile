import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { WardrobeItem } from '../data/mock';
import { AddEntry, cancelQueue, clearFinished, decodeAddQueue, enqueue, markAnalyzing, markFailed, markFlatSettled, markInterrupted, markLanded, needsCheck, nextToRun, queueSummary, recoverQueue, requestOutcome, retryEntry, retryFailed, uploadResize } from '../domain/addQueue';
import { readingColourName } from '../domain/flatReading';
import { decodeTraits } from '../domain/garmentTraits';
import { suggestItemName } from '../domain/itemName';
import { FLAT_SECTIONS, colorOptions, getClosestColorName, getSectionByCategory, normalizeHex } from '../screens/WardrobeScreen';
import { accountKey, isPurged } from '../services/accountStorage';
import { analyzeImage, AiResult, flattenGarment, prepareGarmentPhoto } from '../services/ai';
import { hasAiConsent } from '../services/aiConsent';
import { persistPhoto, reanchorPhoto } from '../services/photos';
import { loadValidated, saveJson } from '../services/storage';

/** The wardrobe item a reading makes; the flat picture, when it comes, changes only its picture, as with a single item saved early. */
function itemOf(id: string, result: AiResult, card: string, source: string, name: (key: string) => string): WardrobeItem {
  const category = result.category as string;
  const hex = normalizeHex(result.dominantColor || '');
  const color = readingColourName({ colorName: result.colorName, dominantColor: hex }, getClosestColorName, colorOptions);
  const palette = [color, ...(result.palette || []).map(value => normalizeHex(value)).filter(Boolean).map(value => getClosestColorName(value))].filter(value => value && value !== 'Не определено');
  const pattern = result.pattern || 'Не определено';
  return { id, name: suggestItemName({ category, color, pattern }) || name(category), category, section: getSectionByCategory(category), color: color || 'Не определено',
    season: result.season || 'Не определено', pattern, tags: [...new Set(palette)].slice(0, 5), imageUri: card, sourceImageUri: source,
    traits: result.traits ? decodeTraits(result.traits) : undefined, needsReview: needsCheck(result) || undefined };
}

/** HEIC and sideways photos become an upright JPEG, bounded as the single add's picker bounds them: a 24 MP original is over the server's limit. */
async function uprightCopy(uri: string, login: string) {
  if (Platform.OS === 'web') return uri;
  const source = ImageManipulator.manipulate(uri);
  try {
    const rendered = await source.renderAsync();
    try {
      const size = uploadResize(rendered.width, rendered.height);
      if (!size) {
        const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
        return (await persistPhoto(saved.uri, login)) || saved.uri;
      }
      // Resized from the decoded image: the file is not read and decoded a second time.
      const scaling = ImageManipulator.manipulate(rendered).resize(size);
      try {
        const resized = await scaling.renderAsync();
        try {
          const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
          return (await persistPhoto(saved.uri, login)) || saved.uri;
        } finally { resized.release(); }
      } finally { scaling.release(); }
    } finally { rendered.release(); }
  } finally { source.release(); }
}

const decodeStoredQueue = (value: unknown) => decodeAddQueue(value, reanchorPhoto);

export type AddQueueControl = {
  queue: AddEntry[];
  add: (uris: string[]) => Promise<number>;
  cancel: () => void;
  retry: (id: string) => void;
  retryConsent: () => void;
  close: () => void;
};

/**
 * The batch add, above the screens: it goes on on any tab. One photo at a time, only while the app is on screen; a request
 * cut off by leaving runs again on return. The queue is written down, so a closed app carries on at the next launch.
 */
export function useAddQueue({ login, ready, setItems, name }: { login: string; ready: boolean; setItems: Dispatch<SetStateAction<WardrobeItem[]>>; name: (key: string) => string }): AddQueueControl {
  const key = accountKey(login, 'addQueue');
  const [queue, setQueueState] = useState<AddEntry[]>([]);
  const current = useRef<AddEntry[]>([]);
  const loaded = useRef(false);
  const alive = useRef(true);
  const running = useRef(false);
  const away = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;
  const update = useCallback((next: (queue: AddEntry[]) => AddEntry[]) => {
    current.current = next(current.current);
    if (!alive.current) return;
    setQueueState(current.current);
    if (loaded.current && !isPurged(login)) void saveJson(key, current.current).catch(error => console.warn('Failed to save the add queue', error));
  }, [key, login]);

  const runOne = async (entry: AddEntry) => {
    const stage = () => current.current.find(other => other.id === entry.id)?.stage;
    const stillWanted = () => alive.current && !isPurged(login) && stage() === 'analyzing';
    update(queue => markAnalyzing(queue, entry.id));
    away.current = AppState.currentState !== 'active';
    let source: string;
    try { source = await uprightCopy(entry.uri, login); }
    catch { if (stillWanted()) update(queue => markFailed(queue, entry.id, 'photo')); return; }
    if (!stillWanted()) return;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const upload = await prepareGarmentPhoto(source);
      if (!stillWanted()) return;
      // As in the single add: sent with the analysis; the server pays for it only when the category is one that gets a flat.
      const early = entry.askFlat ? flattenGarment(upload, undefined, FLAT_SECTIONS, controller.signal) : null;
      early?.catch(() => undefined);
      const result = await analyzeImage(upload).catch(error => { controller.abort(); throw error; });
      if (!stillWanted()) { controller.abort(); return; }
      if (!result.category) { controller.abort(); update(queue => markFailed(queue, entry.id, 'unread')); return; }
      const card = (await persistPhoto(result.bgRemovedBase64 || source, login)) || source;
      if (!stillWanted()) return;
      const itemId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const item = itemOf(itemId, result, card, source, nameRef.current);
      setItems(items => [item, ...items]);
      const flatComing = Boolean(early) && FLAT_SECTIONS.includes(item.section);
      update(queue => markLanded(queue, entry.id, itemId, Boolean(item.needsReview), flatComing));
      abort.current = null; // From here the server may be generating: leaving or cancelling no longer drops it.
      if (flatComing && early) {
        // The next photo waits for this flat: never two paid pictures at once. A failed one leaves the cut-out on the card.
        let made = false;
        try {
          const flat = await early;
          made = !flat.skipped;
          if (!flat.skipped && flat.checked && alive.current && !isPurged(login)) {
            const stored = (await persistPhoto(flat.image, login)) || flat.image;
            if (alive.current) setItems(items => items.map(other => other.id === itemId && other.imageUri === card ? { ...other, imageUri: stored, styleVec: undefined } : other));
          }
        } catch { /* the cut-out stays */ }
        update(queue => markFlatSettled(queue, entry.id, made));
      }
      const summary = queueSummary(current.current);
      if (!summary.active) console.log(`Batch add: ${summary.landed} items, ${summary.flats} flats, about $${summary.costUsd}`);
    } catch (error) {
      if (!stillWanted()) return;
      const outcome = requestOutcome((error as { status?: number } | null)?.status, away.current);
      update(queue => (outcome === 'interrupted' ? markInterrupted(queue, entry.id) : markFailed(queue, entry.id, outcome)));
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const pump = useCallback(async () => {
    if (running.current || !loaded.current) return;
    running.current = true;
    try {
      while (alive.current && AppState.currentState === 'active') {
        const next = nextToRun(current.current);
        if (!next) break;
        // Asked before each photo: consent taken back in the profile stops what has not been sent.
        if (!(await hasAiConsent(login))) { update(queue => markFailed(queue, next.id, 'consent')); continue; }
        await runOne(next);
      }
    } finally { running.current = false; }
  }, [login, update]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!ready || loaded.current) return;
    let active = true;
    void loadValidated(key, decodeStoredQueue).then(result => {
      if (!active) return;
      loaded.current = true;
      if (result.value?.length) update(() => recoverQueue(result.value as AddEntry[]));
      void pump();
    }).catch(() => { loaded.current = true; });
    return () => { active = false; };
  }, [ready, key]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void pump(); else away.current = true;
    });
    return () => subscription.remove();
  }, [pump]);

  return {
    queue,
    add: async uris => {
      // Copied at once: what the picker hands over lies in a cache the system may clear.
      const kept = (await Promise.all(uris.map(uri => persistPhoto(uri, login).catch(() => undefined)))).filter(Boolean) as string[];
      let dropped = uris.length - kept.length;
      update(queue => { const result = enqueue(queue, kept, () => Crypto.randomUUID()); dropped += result.dropped; return result.queue; });
      void pump();
      return dropped;
    },
    cancel: () => { update(cancelQueue); abort.current?.abort(); },
    retry: id => { update(queue => retryEntry(queue, id)); void pump(); },
    retryConsent: () => { update(queue => retryFailed(queue, 'consent')); void pump(); },
    close: () => update(clearFinished)
  };
}

/** The photos a written-down queue still needs: the launch's clean-up of the photo folder must not take them. */
export async function queuedPhotos(login: string) {
  const stored = await loadValidated(accountKey(login, 'addQueue'), decodeStoredQueue).catch(() => ({ value: null, failed: true }));
  return { failed: Boolean(stored.failed), photos: (stored.value || []).map(entry => entry.uri) };
}
