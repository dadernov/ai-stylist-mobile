import { GeneratedLook, TryOnHistoryItem } from '../types/looks';

// The app's data folder changes between installs and updates on iOS: a stored picture is known by its path inside try-ons/.
const imageKey = (uri: string) => {
  const index = uri.lastIndexOf('/try-ons/');
  return index < 0 ? uri : uri.slice(index);
};
const sameImage = (a?: string | null, b?: string | null) => Boolean(a && b && imageKey(a) === imageKey(b));
const shows = (favorite: GeneratedLook, uri: string) => sameImage(favorite.tryOnImageUri, uri) || sameImage(favorite.tryOnSourceUri, uri);
const samePieces = (a: string[], b: string[]) => {
  const left = new Set(a), right = new Set(b);
  return left.size > 0 && left.size === right.size && [...left].every(id => right.has(id));
};

/**
 * One rule for «is it saved»: a look with a try-on is saved when that very picture is; a look without one, when its id or
 * its pieces are. Another try-on of the same pieces is therefore a favourite of its own, and the same pieces never twice bare.
 */
const isSame = (favorite: GeneratedLook, look: GeneratedLook) => look.tryOnImageUri
  ? shows(favorite, look.tryOnImageUri)
  : favorite.id === look.id || samePieces(favorite.itemIds, look.itemIds);

export const isLookSaved = (favorites: GeneratedLook[], look: GeneratedLook) => favorites.some(favorite => isSame(favorite, look));

/** Saves once, whatever the number of taps. A try-on of a look saved without it (or with another) joins that favourite rather than doubling it. */
export function addLook(favorites: GeneratedLook[], look: GeneratedLook): GeneratedLook[] {
  if (isLookSaved(favorites, look)) return favorites;
  const target = look.tryOnImageUri
    ? favorites.find(favorite => favorite.id === look.id) || favorites.find(favorite => !favorite.tryOnImageUri && samePieces(favorite.itemIds, look.itemIds))
    : undefined;
  if (!target) return [look, ...favorites];
  const earlier: TryOnHistoryItem[] = target.tryOnImageUri
    ? [{ id: target.id, imageUri: target.tryOnImageUri, updatedAt: target.tryOnUpdatedAt || 0, warning: target.tryOnWarning, tuckMode: target.tuckMode, qualityMode: target.tryOnQualityMode }]
    : [];
  const frames = [...(look.tryOnHistory || []), ...earlier, ...(target.tryOnHistory || [])];
  const tryOnHistory = frames.filter((frame, index) => frames.findIndex(other => sameImage(other.imageUri, frame.imageUri)) === index);
  return favorites.map(favorite => favorite === target ? { ...target, tuckMode: look.tuckMode ?? target.tuckMode, tryOnImageUri: look.tryOnImageUri, tryOnSourceUri: look.tryOnSourceUri,
    tryOnWarning: look.tryOnWarning, tryOnUpdatedAt: look.tryOnUpdatedAt, tryOnQualityMode: look.tryOnQualityMode, tryOnHistory } : favorite);
}

export const removeLook = (favorites: GeneratedLook[], look: GeneratedLook) => {
  const left = favorites.filter(favorite => !isSame(favorite, look));
  return left.length === favorites.length ? favorites : left;
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
