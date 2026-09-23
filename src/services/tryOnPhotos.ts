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
