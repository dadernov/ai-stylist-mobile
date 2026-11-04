import * as FileSystem from 'expo-file-system/legacy';

const ROOT = `${FileSystem.documentDirectory || ''}try-ons/`;
export const isRemoteUri = (uri: string) => /^https?:\/\//i.test(uri);
const isDataUri = (uri: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(uri);

export function reanchorTryOnUri(uri?: string | null): string | null {
  if (!uri || typeof uri !== 'string') return null;
  if (isRemoteUri(uri) || isDataUri(uri) || !FileSystem.documentDirectory) return uri;
  const index = uri.lastIndexOf('/try-ons/');
  if (index < 0) return uri;
  const suffix = uri.slice(index + '/try-ons/'.length);
  return suffix && !suffix.split('/').some(part => part === '..' || part === '.') ? ROOT + suffix : null;
}

export async function cacheTryOnImage(source: string, id: string, login: string): Promise<{ imageUri: string; warning?: string }> {
  if (!FileSystem.documentDirectory || (!isDataUri(source) && !isRemoteUri(source))) return { imageUri: source };
  const dir = ROOT + encodeURIComponent(login) + '/';
  const extension = source.startsWith('data:image/png') ? 'png' : source.startsWith('data:image/webp') ? 'webp' : 'jpg';
  const target = `${dir}${id.replace(/[^a-z0-9_-]/gi, '_')}.${extension}`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    if (isDataUri(source)) await FileSystem.writeAsStringAsync(target, source.split(',')[1], { encoding: FileSystem.EncodingType.Base64 });
    else {
      const response = await FileSystem.downloadAsync(source, target);
      if (response.status < 200 || response.status >= 300) throw new Error('Download failed');
    }
    return { imageUri: target };
  } catch {
    throw new Error('Не удалось сохранить фото на устройстве. Освободи место и повтори загрузку результата.');
  }
}

/**
 * A file of the app's own that outlives a restart, whatever the picture is now: a server link (gone within a day),
 * a data uri or a temporary file becomes one, and what is already kept stays where it is. Throws rather than keep a link.
 */
export async function keepTryOnImage(source: string, id: string, login: string): Promise<string> {
  const anchored = reanchorTryOnUri(source);
  if (!anchored) throw new Error('Invalid try-on path');
  if (isRemoteUri(anchored) || isDataUri(anchored)) return (await cacheTryOnImage(anchored, id, login)).imageUri;
  if (!FileSystem.documentDirectory || anchored.startsWith(ROOT)) return anchored;
  const dir = ROOT + encodeURIComponent(login) + '/';
  const extension = anchored.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || 'jpg';
  const target = `${dir}${id.replace(/[^a-z0-9_-]/gi, '_')}.${/^[a-z0-9]{1,5}$/.test(extension) ? extension : 'jpg'}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.copyAsync({ from: anchored, to: target });
  return target;
}

/** The look as a favourite stores it: its picture a kept file, and no frame in its history that would die or bloat the record. */
export async function durableLook<T extends { id: string; tryOnImageUri?: string; tryOnSourceUri?: string; tryOnUpdatedAt?: number; tryOnHistory?: { imageUri: string }[] }>(look: T, login: string): Promise<T> {
  const source = look.tryOnImageUri;
  const tryOnHistory = look.tryOnHistory?.filter(frame => !isRemoteUri(frame.imageUri) && !isDataUri(frame.imageUri));
  if (!source) return { ...look, tryOnHistory };
  const tryOnImageUri = await keepTryOnImage(source, `favorite-${look.id}-${look.tryOnUpdatedAt || Date.now()}`, login);
  // Always where it came from, so the look on screen still holding that uri reads as saved. A data uri is megabytes in the record: its picture is then known only by the kept file.
  return { ...look, tryOnImageUri, tryOnHistory, tryOnSourceUri: isDataUri(source) ? look.tryOnSourceUri : source };
}

const COPY_GRACE_S = 60;

/**
 * Deletes the `favorite-*` copies no look refers to any more. `keep`: every look that may show one. A copy younger than a minute
 * is left alone: it may be a save still on its way into the list.
 */
export async function removeUnusedFavoriteCopies(keep: { tryOnImageUri?: string; tryOnSourceUri?: string; tryOnHistory?: { imageUri: string }[] }[], login: string, nowSeconds = Date.now() / 1000) {
  if (!FileSystem.documentDirectory) return;
  const dir = ROOT + encodeURIComponent(login) + '/';
  const used = new Set(keep.flatMap(look => [look.tryOnImageUri, look.tryOnSourceUri, ...(look.tryOnHistory || []).map(frame => frame.imageUri)])
    .filter((uri): uri is string => Boolean(uri)).map(uri => uri.slice(uri.lastIndexOf('/') + 1)));
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith('favorite-') || used.has(name)) continue;
    const info = await FileSystem.getInfoAsync(dir + name).catch(() => null);
    if (!info?.exists || (info.modificationTime && nowSeconds - info.modificationTime < COPY_GRACE_S)) continue;
    await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => {});
  }
}
