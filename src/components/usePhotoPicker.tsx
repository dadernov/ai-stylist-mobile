import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CropPhoto, PhotoCropper } from './PhotoCropper';

export function usePhotoPicker() {
  const [photo, setPhoto] = useState<CropPhoto | null>(null);
  const [visible, setVisible] = useState(false);
  const resultUri = useRef<string | null>(null);
  const resolve = useRef<((uri: string | null) => void) | null>(null);
  const picking = useRef(false);
  useEffect(() => () => { resolve.current?.(null); resolve.current = null; }, []);
  const complete = () => { setPhoto(null); resolve.current?.(resultUri.current); resolve.current = null; picking.current = false; };
  const finish = (uri: string | null) => {
    resultUri.current = uri; setVisible(false);
    // iOS must dismiss this controller before the caller presents its editor.
    if (Platform.OS !== 'ios') setTimeout(complete, 0);
  };
  const pickPhoto = async (source: 'gallery' | 'camera' = 'gallery'): Promise<string | null> => {
    if (picking.current) return null;
    picking.current = true; Keyboard.dismiss();
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { Alert.alert('Нет доступа к камере', 'Разреши доступ в настройках устройства.'); picking.current = false; return null; }
      }
      const options: ImagePicker.ImagePickerOptions = { allowsEditing: false, quality: 1, mediaTypes: ['images'] };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) { picking.current = false; return null; }
      const asset = result.assets[0];
      return await new Promise<string | null>(done => { resolve.current = done; setPhoto({ uri: asset.uri, width: asset.width, height: asset.height }); setVisible(true); });
    } catch { picking.current = false; Alert.alert('Не удалось открыть фото', 'Попробуй выбрать изображение ещё раз.'); return null; }
  };
  return { pickPhoto, cropModal: photo ? <PhotoCropper key={photo.uri} photo={photo} visible={visible} onDismiss={() => { if (Platform.OS === 'ios') complete(); }} onClose={() => finish(null)} onDone={finish} /> : null };
}
