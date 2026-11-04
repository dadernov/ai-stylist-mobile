import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';

// The app's data folder changes between installs and updates on iOS: a stored picture is known by its path inside try-ons/.
const imageKey = (uri: string) => {
  const index = uri.lastIndexOf('/try-ons/');
  return index < 0 ? uri : uri.slice(index);
};
const sameImage = (a?: string | null, b?: string | null) => Boolean(a && b && imageKey(a) === imageKey(b));
// Its current picture, known by the kept file or by where that came from. A frame merely in its history is not what it shows.
const shows = (favorite: GeneratedLook, uri: string) => sameImage(favorite.tryOnImageUri, uri) || sameImage(favorite.tryOnSourceUri, uri);
const samePieces = (a: string[], b: string[]) => {
  const left = new Set(a), right = new Set(b);
  return left.size > 0 && left.size === right.size && [...left].every(id => right.has(id));
};
// It stands for its pieces without a try-on: it has none, or the one it has joined it later.
const bareInside = (favorite: GeneratedLook) => !favorite.tryOnImageUri || Boolean(favorite.joined);

/**
 * One rule for «is it saved»: a look with a try-on is saved when that very picture is a favourite's current picture; a look without
 * one, when its id is or the same pieces are saved bare. Another try-on of the same pieces, or an older frame, is therefore a favourite
 * of its own, and the same pieces never twice bare.
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

const unsaved = (favorite: GeneratedLook) => favorite.joined ? [withoutTryOn(favorite)] : [];

/**
 * Unsaving a try-on removes only the favourite showing that very picture; one that joined a bare favourite gives that favourite back.
 * A look without a try-on removes only a favourite without one: a favourite with a picture stays, and stays saved, so the list comes
 * back unchanged (the same array) and the caller can tell nothing happened.
 */
export const removeLook = (favorites: GeneratedLook[], look: GeneratedLook) => {
  const goes = (favorite: GeneratedLook) => isSame(favorite, look) && Boolean(look.tryOnImageUri || !favorite.tryOnImageUri);
  if (!favorites.some(goes)) return favorites;
  return favorites.flatMap(favorite => goes(favorite) ? unsaved(favorite) : [favorite]);
};

/** «Удалить» on the favourites screen, the same as its heart: a try-on that joined a bare favourite gives that favourite back. */
export const removeFavorite = (favorites: GeneratedLook[], id: string) =>
  favorites.flatMap(favorite => favorite.id === id ? unsaved(favorite) : [favorite]);

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

/** Another bare favourite already stands for these pieces: the list never holds them twice bare. */
export const bareTwin = (favorites: GeneratedLook[], id: string, itemIds: string[]) =>
  favorites.some(favorite => favorite.id !== id && bareInside(favorite) && samePieces(favorite.itemIds, itemIds));

export const piecesChanged = (look: GeneratedLook, itemIds: string[]) => !samePieces(look.itemIds, itemIds);

/**
 * A new name stays with everything else. New pieces make it another look: the try-on and the advice were about the old ones and leave
 * (the picture stays in the journal), and it takes `newId`, as the id of an idea stands for that idea's pieces.
 */
export function editFavorite(favorites: GeneratedLook[], id: string, change: { title: string; itemIds: string[]; newId: string }): GeneratedLook[] {
  return favorites.map(favorite => {
    if (favorite.id !== id) return favorite;
    if (!piecesChanged(favorite, change.itemIds)) return { ...favorite, title: change.title };
    const { fitScore, fitReasons, matchPercent, stylingTips, warnings, why, source, ...rest } = withoutTryOn(favorite);
    return { ...rest, id: change.newId, title: change.title, itemIds: change.itemIds, tuckMode: undefined };
  });
}

/** The server keeps a finished picture this long, so a link older than this leads nowhere. */
export const LINK_LIFE_MS = 24 * 60 * 60 * 1000;
const isLink = (uri?: string) => /^https?:/i.test(uri || '');

/**
 * Pictures still kept only as a server link. A fresh one becomes a file (`keep`), and stays a link to try again if that fails;
 * an expired one is gone for good, so its look honestly has no try-on, and keeps its name and pieces. Nothing to do returns the same array.
 */
export async function settleTryOnLinks(looks: GeneratedLook[], now: number, keep: (uri: string, id: string) => Promise<string>): Promise<GeneratedLook[]> {
  let changed = false;
  const settled: GeneratedLook[] = [];
  for (const original of looks) {
    let look = original;
    const history = look.tryOnHistory?.filter(frame => !(isLink(frame.imageUri) && now - frame.updatedAt > LINK_LIFE_MS));
    if (history && history.length !== look.tryOnHistory!.length) look = { ...look, tryOnHistory: history };
    if (isLink(look.tryOnImageUri)) {
      if (now - (look.tryOnUpdatedAt || 0) > LINK_LIFE_MS) look = { ...withoutTryOn(look), tryOnHistory: history?.length ? history : undefined };
      else {
        try { look = { ...look, tryOnImageUri: await keep(look.tryOnImageUri!, `favorite-${look.id}-${look.tryOnUpdatedAt}`), tryOnSourceUri: look.tryOnImageUri }; }
        catch { /* No network now: the next launch tries while the link lives. */ }
      }
    }
    changed = changed || look !== original;
    settled.push(look);
  }
  return changed ? settled : looks;
}

/** What the retired list of looks kept, as a favourite. Its id comes from the old one, so doing this again finds it. */
const fromSaved = (look: SavedLook): GeneratedLook => ({
  ...plainLook(`saved-${look.id}`, look.name, look.itemIds), fitScore: look.fitScore, fitReasons: look.fitReasons, tuckMode: look.tuckMode,
  tryOnImageUri: look.tryOnImageUri, tryOnWarning: look.tryOnWarning, tryOnQualityMode: look.tryOnQualityMode, tryOnHistory: look.tryOnHistory,
  tryOnUpdatedAt: look.tryOnUpdatedAt ?? (look.tryOnImageUri ? look.createdAt : undefined)
});

const moreFrames = (kept?: TryOnHistoryItem[], added?: TryOnHistoryItem[]) => {
  const frames = [...(kept || [])];
  for (const frame of added || []) if (!frames.some(other => sameImage(other.imageUri, frame.imageUri))) frames.push(frame);
  return frames.length ? frames : undefined;
};

/**
 * The saved looks joined into the favourites, each once however many times this runs. The same picture, or the same pieces under the same name where neither
 * has a picture, is one look: it keeps the favourite, under the name given in the old list, with both lists' frames. A look with a picture
 * of its own is its own favourite even beside the same pieces, so no name and no picture is lost. Nothing to add returns the same array.
 */
export function mergeSavedLooks(favorites: GeneratedLook[], saved: SavedLook[]): GeneratedLook[] {
  let merged = favorites;
  for (const look of saved) {
    const next = fromSaved(look);
    if (merged.some(favorite => favorite.id === next.id)) continue;
    const twin = merged.find(favorite => next.tryOnImageUri ? shows(favorite, next.tryOnImageUri) : !favorite.tryOnImageUri && samePieces(favorite.itemIds, next.itemIds) && favorite.title === next.title);
    merged = twin
      ? merged.map(favorite => favorite === twin ? { ...twin, title: next.title, fitReasons: twin.fitReasons ?? next.fitReasons, tryOnHistory: moreFrames(twin.tryOnHistory, next.tryOnHistory) } : favorite)
      : [...merged, next];
  }
  return merged;
}
