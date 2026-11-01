import { Platform, Share } from 'react-native';
import { translate } from '../constants/i18n';
import { cacheTryOnImage, isRemoteUri } from './tryOnPhotos';

// A try-on result goes out as the stored full-size file, never a downscaled preview.
const localFile = async (uri: string, login: string, prefix: string) =>
  isRemoteUri(uri) || uri.startsWith('data:') ? (await cacheTryOnImage(uri, `${prefix}-${Date.now()}`, login)).imageUri : uri;

const MIME_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
const mimeTypeOf = (fileUri: string) => MIME_TYPES[fileUri.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || ''] || 'image/jpeg';

/**
 * The one way out to the system's share sheet, for a file already on the device. A dismissed sheet is not an error.
 * Android's Share takes only text, and a path sent as text reaches nobody: there the file goes through expo-sharing,
 * a native module an older build may not have (hence the lazy require), and a failure is thrown for the user to see.
 */
export async function shareLocalFile(fileUri: string) {
  if (Platform.OS === 'android') {
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available');
    await Sharing.shareAsync(fileUri, { mimeType: mimeTypeOf(fileUri) });
    return;
  }
  try { await Share.share({ url: fileUri }); } catch { /* The share sheet was dismissed or unavailable. */ }
}

// A browser shares the picture itself where it can, and downloads it where it cannot.
async function shareOnWeb(uri: string, login: string) {
  try {
    const blob = await (await fetch(uri)).blob();
    const file = new File([blob], `ai-stylist-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (error: any) { if (error?.name === 'AbortError') return; }
  await saveTryOnToGallery(uri, login).catch(() => {});
}

/** Straight to a messenger or a story, without saving to the gallery. */
export async function shareTryOn(uri: string, login: string) {
  if (Platform.OS === 'web') return shareOnWeb(uri, login);
  // A failure reaches the sheet, which says so.
  await shareLocalFile(await localFile(uri, login, 'share'));
}

/** Saves the look to the photo gallery; throws with a message the user can act on. */
export async function saveTryOnToGallery(uri: string, login: string) {
  if (Platform.OS === 'web') {
    // A browser has no gallery: the look is downloaded as a file.
    const link = document.createElement('a');
    link.href = uri; link.download = `ai-stylist-${Date.now()}.${uri.startsWith('data:image/png') ? 'png' : 'jpg'}`; link.click();
    return;
  }
  // The gallery module is native: loaded only when needed, or the web build fails at start.
  // Its function API lives in /legacy since SDK 57; the default entry throws "deprecated" on it.
  const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error(translate('Нет доступа к галерее. Разреши сохранение фото в настройках.'));
  await MediaLibrary.saveToLibraryAsync(await localFile(uri, login, 'export'));
}
