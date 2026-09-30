import { Platform, Share } from 'react-native';
import { translate } from '../constants/i18n';
import { cacheTryOnImage, isRemoteUri } from './tryOnPhotos';

// A try-on result goes out as the stored full-size file, never a downscaled preview.
const localFile = async (uri: string, login: string, prefix: string) =>
  isRemoteUri(uri) || uri.startsWith('data:') ? (await cacheTryOnImage(uri, `${prefix}-${Date.now()}`, login)).imageUri : uri;

/** Straight to a messenger or a story, without saving to the gallery. A dismissed sheet is not an error. */
export async function shareTryOn(uri: string, login: string) {
  try {
    const fileUri = await localFile(uri, login, 'share');
    await Share.share(Platform.OS === 'ios' ? { url: fileUri } : { message: fileUri, url: fileUri });
  } catch { /* The share sheet was dismissed or unavailable. */ }
}

/** Saves the look to the photo gallery; throws with a message the user can act on. */
export async function saveTryOnToGallery(uri: string, login: string) {
  if (Platform.OS === 'web') {
    // A browser has no gallery: the look is downloaded as a file.
    const link = document.createElement('a');
    link.href = uri; link.download = `ai-stylist-${Date.now()}.png`; link.click();
    return;
  }
  // The gallery module is native: loaded only when needed, or the web build fails at start.
  const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error(translate('Нет доступа к галерее. Разреши сохранение фото в настройках.'));
  await MediaLibrary.saveToLibraryAsync(await localFile(uri, login, 'export'));
}
