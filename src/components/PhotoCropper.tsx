import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Check, RotateCcw, X } from 'lucide-react-native';
import { CropHandle, CropRect, cropPixels, moveCrop } from '../domain/crop';
import { AppPressable } from './AppPressable';
import { useT } from '../constants/i18n';
import { font, INK, useReducedMotion } from './studio/studio';

export type CropPhoto = { uri: string; width: number; height: number };
const full: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const handles: { key: CropHandle; x: number; y: number; label: string }[] = [
  { key: 'nw', x: 0, y: 0, label: 'Верхний левый угол' }, { key: 'n', x: 0.5, y: 0, label: 'Верхняя граница' },
  { key: 'ne', x: 1, y: 0, label: 'Верхний правый угол' }, { key: 'e', x: 1, y: 0.5, label: 'Правая граница' },
  { key: 'se', x: 1, y: 1, label: 'Нижний правый угол' }, { key: 's', x: 0.5, y: 1, label: 'Нижняя граница' },
  { key: 'sw', x: 0, y: 1, label: 'Нижний левый угол' }, { key: 'w', x: 0, y: 0.5, label: 'Левая граница' }
];

export function PhotoCropper({ photo, visible, onDismiss, onClose, onDone }: { photo: CropPhoto; visible: boolean; onDismiss: () => void; onClose: () => void; onDone: (uri: string) => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [rect, setRect] = useState(full);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [imageReady, setImageReady] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(rect); current.current = rect;
  const start = useRef(rect);
  const hasLayout = layout.width > 1 && layout.height > 1 && photo.width > 0 && photo.height > 0;
  const scale = hasLayout ? Math.min(layout.width / photo.width, layout.height / photo.height) : 0;
  const width = photo.width * scale, height = photo.height * scale;
  const responders = useMemo(() => Object.fromEntries(['move', ...handles.map(handle => handle.key)].map(key => [key, PanResponder.create({
    onStartShouldSetPanResponder: () => !busy && imageReady,
    onMoveShouldSetPanResponder: () => !busy && imageReady,
    onPanResponderGrant: () => { start.current = current.current; },
    onPanResponderMove: (_, gesture) => { if (width > 0 && height > 0) setRect(moveCrop(start.current, key as CropHandle, gesture.dx / width, gesture.dy / height)); },
    onPanResponderTerminationRequest: () => false
  })])), [width, height, busy, imageReady]);
  const save = async () => {
    if (busy || !imageReady || !hasLayout) return;
    setBusy(true); setError('');
    try {
      const context = ImageManipulator.manipulate(photo.uri);
      context.crop(cropPixels(rect, photo.width, photo.height));
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.97, base64: Platform.OS === 'web' });
      onDone(saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri);
    } catch { setError(t('Не удалось обрезать фото. Попробуй ещё раз.')); }
    finally { setBusy(false); }
  };
  const x = rect.x * width, y = rect.y * height, w = rect.width * width, h = rect.height * height;
  return <Modal visible={visible} onDismiss={onDismiss} animationType={reduced ? 'none' : 'slide'} presentationStyle="fullScreen" onRequestClose={() => !busy && onClose()}>
    <SafeAreaProvider style={styles.screen}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.toolbar}>
          <AppPressable accessibilityRole="button" accessibilityLabel={t('Отменить обрезку')} disabled={busy} onPress={onClose} style={styles.icon}><X color="#FFFFFF" size={19} strokeWidth={1.8} /></AppPressable>
          <Text accessibilityRole="header" style={[font('semibold'), styles.title]}>{t('Кадрирование')}</Text>
          <AppPressable accessibilityRole="button" accessibilityLabel={t('Сбросить обрезку')} disabled={busy} onPress={() => setRect(full)} style={styles.icon}><RotateCcw color="#FFFFFF" size={18} strokeWidth={1.8} /></AppPressable>
        </View>
        <View style={styles.stage} onLayout={event => setLayout(event.nativeEvent.layout)}>
          {hasLayout && <View style={{ width, height }}>
            {/* Do not decode at the initial 1px layout: iOS can cache that tiny bitmap. */}
            <Image testID="crop-image" key={`${Math.round(width)}-${Math.round(height)}-${imageAttempt}`} source={{ uri: photo.uri, width: photo.width, height: photo.height }}
              resizeMode="contain" resizeMethod="scale" style={{ width, height }}
              onLoad={() => { setImageReady(true); setImageError(false); }}
              onError={() => { setImageReady(false); setImageError(true); }} />
            <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width, height: y }]} />
            <View pointerEvents="none" style={[styles.shade, { left: 0, top: y + h, width, height: height - y - h }]} />
            <View pointerEvents="none" style={[styles.shade, { left: 0, top: y, width: x, height: h }]} />
            <View pointerEvents="none" style={[styles.shade, { left: x + w, top: y, width: width - x - w, height: h }]} />
            <View testID="crop-selection" accessibilityLabel={t('Область кадрирования')} {...responders.move.panHandlers} style={[styles.selection, { left: x, top: y, width: w, height: h }]}>
              {[1, 2].map(line => <View pointerEvents="none" key={`v${line}`} style={[styles.gridLine, { left: `${line * 100 / 3}%`, top: 0, bottom: 0, width: 1 }]} />)}
              {[1, 2].map(line => <View pointerEvents="none" key={`h${line}`} style={[styles.gridLine, { top: `${line * 100 / 3}%`, left: 0, right: 0, height: 1 }]} />)}
            </View>
            {handles.map(handle => <View key={handle.key} testID={`crop-${handle.key}`} accessibilityLabel={t(handle.label)} {...responders[handle.key].panHandlers}
              style={[styles.handle, { left: x + handle.x * w - 22, top: y + handle.y * h - 22 }]}>
              <View style={[styles.handleMark, { width: handle.x === 0.5 ? 22 : 5, height: handle.y === 0.5 ? 22 : 5 }]} />
            </View>)}
          </View>}
          {!imageReady && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101215' }]}>
            {imageError ? <AppPressable accessibilityRole="button" accessibilityLabel={t('Повторить загрузку фото')}
              onPress={() => { setImageError(false); setImageAttempt(value => value + 1); }} style={{ padding: 20, gap: 12, alignItems: 'center' }}>
              <Text style={[font('medium'), styles.error]}>{t('Не удалось загрузить фото')}</Text><RotateCcw color="#FFFFFF" size={24} />
            </AppPressable> : <ActivityIndicator color="#FFFFFF" />}
          </View>}
        </View>
        <View style={styles.footer}>
          {error ? <Text style={[font('medium'), styles.error]}>{error}</Text> : null}
          <AppPressable accessibilityRole="button" accessibilityLabel={t('Готово')} disabled={busy || !imageReady} onPress={save} style={[styles.done, !imageReady && { opacity: .45 }]}>
            {busy ? <ActivityIndicator color={INK} /> : <Check size={19} strokeWidth={1.8} color={INK} />}<Text style={[font('semibold'), styles.doneText]}>{t('Готово')}</Text>
          </AppPressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101215' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 64 },
  title: { color: '#F4F5F7', fontSize: 17, letterSpacing: -0.3 },
  icon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(40,43,48,0.55)', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'rgba(255,255,255,0.10)' },
  stage: { flex: 1, margin: 24, justifyContent: 'center', alignItems: 'center' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  selection: { position: 'absolute', borderWidth: 1, borderColor: '#FFFFFF', ...(Platform.OS === 'web' ? { touchAction: 'none' } as any : {}) },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.6)' },
  handle: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { touchAction: 'none' } as any : {}) },
  handleMark: { backgroundColor: '#FFFFFF', borderRadius: 3 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  done: { backgroundColor: '#FFFFFF', minHeight: 50, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  doneText: { color: INK, fontSize: 15 },
  error: { color: '#FFB5AA', textAlign: 'center', fontSize: 14 }
});
