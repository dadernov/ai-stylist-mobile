import * as FileSystem from 'expo-file-system/legacy';

/**
 * Фотографии вещей живут файлами, а в AsyncStorage попадают только пути.
 *
 * Раньше вырез с убранным фоном сохранялся прямо в состоянии как data-URL и
 * вместе с ним уезжал в AsyncStorage. Один такой вырез весит около мегабайта,
 * а на Android у AsyncStorage лимит порядка 6 МБ на всё приложение: примерно
 * с пятой вещи запись начинала падать, и гардероб терялся целиком.
 *
 * Здесь же решается вторая беда — фото из ImagePicker лежат в кеше, который
 * система вправе вычистить, а путь в хранилище остаётся и ведёт в никуда.
 */

const PHOTO_DIR = `${FileSystem.documentDirectory || ''}photos/`;
const MARKER = '/photos/';
export const accountPhotoDirectory = (login: string) => `${PHOTO_DIR}${encodeURIComponent(login)}/`;

const isDataUri = (uri: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(uri);
const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

const extensionOf = (uri: string) => {
  if (isDataUri(uri)) {
    const mime = uri.slice(5, uri.indexOf(';')).toLowerCase();
    return mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  }
  const match = uri.split('?')[0].toLowerCase().match(/\.(jpg|jpeg|png|webp)$/);
  return match ? match[1] : 'jpg';
};

const uniqueName = (extension: string) => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

/**
 * Абсолютный путь внутри контейнера приложения меняется при обновлении, из-за
 * чего сохранённый путь перестаёт указывать на файл. Имя файла при этом
 * остаётся прежним, поэтому путь достаточно перепривязать к текущей папке.
 * Функция синхронная и ничего не спрашивает у файловой системы: источником
 * правды о том, читается ли картинка, остаётся сам <Image>.
 */
export const reanchorPhoto = (uri?: string | null): string | undefined => {
  if (!uri || typeof uri !== 'string') return undefined;
  if (isDataUri(uri) || isRemote(uri) || !FileSystem.documentDirectory) return uri;
  const index = uri.lastIndexOf(MARKER);
  if (index === -1) return uri;
  const name = uri.slice(index + MARKER.length);
  return name && !name.split('/').some(part => part === '..' || part === '.') ? `${PHOTO_DIR}${name}` : undefined;
};

/** Кладёт фото в папку приложения и возвращает путь к файлу. */
export async function persistPhoto(uri?: string | null, login?: string): Promise<string | undefined> {
  if (!uri || !FileSystem.documentDirectory) return uri || undefined;
  const directory = login ? accountPhotoDirectory(login) : PHOTO_DIR;
  if (uri.startsWith(directory)) return uri;
  const target = `${directory}${uniqueName(extensionOf(uri))}`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  if (isDataUri(uri)) {
    await FileSystem.writeAsStringAsync(target, uri.split(',')[1], { encoding: FileSystem.EncodingType.Base64 });
    return target;
  }
  if (isRemote(uri)) {
    const downloaded = await FileSystem.downloadAsync(uri, target);
    if (downloaded.status < 200 || downloaded.status >= 300) throw new Error(`download failed (${downloaded.status})`);
    return downloaded.uri;
  }
  // Файл из кеша ImagePicker: копируем к себе, пока система его не вычистила.
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

/**
 * Удаляет из папки всё, на что больше никто не ссылается. Вызывается после
 * загрузки состояния: так удаление вещи не требует отдельной уборки в каждом
 * месте, откуда её можно удалить, и файл не остаётся висеть навсегда.
 */
export async function removeUnusedPhotos(keep: Array<string | undefined>, login?: string): Promise<number> {
  if (!FileSystem.documentDirectory) return 0;
  const directory = login ? accountPhotoDirectory(login) : PHOTO_DIR;
  const used = new Set(keep.filter(Boolean).map((uri) => (uri as string).split('/').pop()));
  let names: string[] = [];
  try {
    names = await FileSystem.readDirectoryAsync(directory);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (name.includes('/') || (!login && !/\.(png|jpe?g|webp)$/i.test(name))) continue;
    if (used.has(name)) continue;
    try {
      await FileSystem.deleteAsync(`${directory}${name}`, { idempotent: true });
      removed += 1;
    } catch {
      // Не смогли удалить — не повод ломать запуск.
    }
  }
  return removed;
}

export const photoDirectory = PHOTO_DIR;
