import { GeneratedLook, TryOnHistoryItem } from '../types/looks';

// The app's data folder changes between installs and updates on iOS: a stored picture is known by its path inside try-ons/.
const imageKey = (uri: string) => {
  const index = uri.lastIndexOf('/try-ons/');
  return index < 0 ? uri : uri.slice(index);
};
const sameImage = (a?: string | null, b?: string | null) => Boolean(a && b && imageKey(a) === imageKey(b));
const shows = (favorite: GeneratedLook, uri: string) => sameImage(favorite.tryOnImageUri, uri) || sameImage(favorite.tryOnSourceUri, uri)
  || Boolean(favorite.tryOnHistory?.some(frame => sameImage(frame.imageUri, uri)));
const samePieces = (a: string[], b: string[]) => {
  const left = new Set(a), right = new Set(b);
  return left.size > 0 && left.size === right.size && [...left].every(id => right.has(id));
};
// It stands for its pieces without a try-on: it has none, or the one it has joined it later.
const bareInside = (favorite: GeneratedLook) => !favorite.tryOnImageUri || Boolean(favorite.joined);

/**
 * One rule for «is it saved»: a look with a try-on is saved when that very picture is, as a favourite's picture or a frame of its
 * history; a look without one, when its id is or the same pieces are saved bare. Another try-on of the same pieces is therefore a
 * favourite of its own, and the same pieces never twice bare.
 */
const isSame = (favorite: GeneratedLook, look: GeneratedLook) => look.tryOnImageUri
  ? shows(favorite, look.tryOnImageUri)
  : favorite.id === look.id || (bareInside(favorite) && samePieces(favorite.itemIds, look.itemIds));

export const isLookSaved = (favorites: GeneratedLook[], look: GeneratedLook) => favorites.some(favorite => isSame(favorite, look));

// The list, its keys and «Удалить» go by id: a second try-on of one card is a favourite of its own and needs one of its own.
const freeId = (favorites: GeneratedLook[], look: GeneratedLook) => {
  if (!favorites.some(favorite => favorite.id === look.id)) return look;
  const base = `${look.id}~${look.tryOnUpdatedAt || favorites.length}`;
  let id = base;
  for (let n = 2; favorites.some(favorite => favorite.id === id); n++) id = `${base}-${n}`;
  return { ...look, id };
};

/** Saves once, whatever the number of taps. A try-on joins a favourite saved bare with the same pieces; any other try-on is its own favourite. */
export function addLook(favorites: GeneratedLook[], look: GeneratedLook): GeneratedLook[] {
  if (isLookSaved(favorites, look)) return favorites;
  const target = look.tryOnImageUri ? favorites.find(favorite => !favorite.tryOnImageUri && samePieces(favorite.itemIds, look.itemIds)) : undefined;
  if (!target) return [freeId(favorites, look), ...favorites];
  return favorites.map(favorite => favorite === target ? { ...target, joined: { tuckMode: target.tuckMode }, tuckMode: look.tuckMode ?? target.tuckMode, tryOnImageUri: look.tryOnImageUri,
    tryOnSourceUri: look.tryOnSourceUri, tryOnWarning: look.tryOnWarning, tryOnUpdatedAt: look.tryOnUpdatedAt, tryOnQualityMode: look.tryOnQualityMode, tryOnHistory: look.tryOnHistory } : favorite);
}

/** The favourite as it was before a try-on joined it: the idea and its advice, without the picture. */
const withoutTryOn = ({ joined, tryOnImageUri, tryOnSourceUri, tryOnWarning, tryOnUpdatedAt, tryOnQualityMode, tryOnHistory, ...bare }: GeneratedLook): GeneratedLook =>
  ({ ...bare, tuckMode: joined?.tuckMode });

/** Unsaving a try-on that joined a bare favourite gives that favourite back; anything else simply goes. */
export const removeLook = (favorites: GeneratedLook[], look: GeneratedLook) => {
  if (!favorites.some(favorite => isSame(favorite, look))) return favorites;
  return favorites.flatMap(favorite => !isSame(favorite, look) ? [favorite] : look.tryOnImageUri && favorite.joined ? [withoutTryOn(favorite)] : []);
};

/** A look known only by its name and pieces, shaped as the favourites keep it. */
export const plainLook = (id: string, title: string, itemIds: string[]): GeneratedLook =>
  ({ id, title, itemIds, weather: '', style: '', event: '', makeup: '', hair: '' });

/** The same look carrying a finished try-on. */
export const lookWithResult = (look: GeneratedLook, result: Omit<TryOnHistoryItem, 'id'> & { id?: string }): GeneratedLook => ({
  ...look, tuckMode: result.tuckMode ?? look.tuckMode, tryOnImageUri: result.imageUri, tryOnWarning: result.warning, tryOnUpdatedAt: result.updatedAt, tryOnQualityMode: 'quality'
});

/** A finished job of the try-on journal as a favourite; a job without a result is only its pieces. */
export function lookFromJob(job: { id: string; name: string; itemIds: string[]; result?: TryOnHistoryItem }): GeneratedLook {
  const look = plainLook(`job-${job.id}`, job.name, job.itemIds);
  return job.result ? { ...lookWithResult(look, job.result), tryOnHistory: [job.result] } : look;
}
