import { translate } from '../constants/i18n';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Linking } from 'react-native';
import { useAppDialog } from './AppDialog';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CropPhoto, PhotoCropper } from './PhotoCropper';

export function usePhotoPicker() {
  const Alert = useAppDialog();
  const [photo, setPhoto] = useState<CropPhoto | null>(null);
  const [visible, setVisible] = useState(false);
  const [isPicking, setPicking] = useState(false);
  const resultUri = useRef<string | null>(null);
  const resolve = useRef<((uri: string | null) => void) | null>(null);
  const picking = useRef(false);
  useEffect(() => () => { resolve.current?.(null); resolve.current = null; }, []);
  const stopPicking = () => { picking.current = false; setPicking(false); };
  const complete = () => { setPhoto(null); resolve.current?.(resultUri.current); resolve.current = null; stopPicking(); };
  const finish = (uri: string | null) => {
    resultUri.current = uri; setVisible(false);
    // iOS must dismiss this controller before the caller presents its editor.
    if (Platform.OS !== 'ios') setTimeout(complete, 0);
  };
  const pickPhoto = async (source: 'gallery' | 'camera' = 'gallery'): Promise<string | null> => {
    if (picking.current) return null;
    picking.current = true; setPicking(true); Keyboard.dismiss();
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { Alert.alert(translate('Нет доступа к камере'), translate('Разреши доступ в настройках устройства.'), [{ text: translate('Отмена'), style: 'cancel' }, { text: translate('Открыть настройки'), onPress: () => { void Linking.openSettings().catch(() => {}); } }]); stopPicking(); return null; }
      }
      const options: ImagePicker.ImagePickerOptions = { allowsEditing: false, quality: 1, mediaTypes: ['images'],
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) { stopPicking(); return null; }
      const asset = result.assets[0];
      let cropPhoto = { uri: asset.uri, width: asset.width, height: asset.height };
      if (Platform.OS !== 'web') {
        // Resolve HEIC/orientation; bound very large camera photos before previewing.
        const context = ImageManipulator.manipulate(asset.uri);
        if (Math.max(asset.width, asset.height) > 4096) context.resize(asset.width >= asset.height ? { width: 4096 } : { height: 4096 });
        const rendered = await context.renderAsync();
        const normalized = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
        cropPhoto = { uri: normalized.uri, width: normalized.width, height: normalized.height };
      }
      if (cropPhoto.width <= 0 || cropPhoto.height <= 0) throw new Error('Invalid photo dimensions');
      return await new Promise<string | null>(done => { resolve.current = done; setPhoto(cropPhoto); setVisible(true); });
    } catch { stopPicking(); Alert.alert(translate('Не удалось открыть фото'), translate('Попробуй выбрать изображение ещё раз.')); return null; }
  };
  return { pickPhoto, isPicking, cropModal: photo ? <PhotoCropper key={photo.uri} photo={photo} visible={visible} onDismiss={() => { if (Platform.OS === 'ios') complete(); }} onClose={() => finish(null)} onDone={finish} /> : null };
}
