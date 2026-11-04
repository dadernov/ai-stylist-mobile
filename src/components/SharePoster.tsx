import { forwardRef, useEffect, useRef, useState } from 'react';
import { Image, PixelRatio, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WardrobeItem } from '../data/mock';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { decodeDailyLook, isDailyLook, localDay } from '../domain/dailyLook';
import { lookName } from '../domain/lookName';
import { accountKey } from '../services/accountStorage';
import { loadValidated } from '../services/storage';
import { shareLocalFile, shareTryOn } from '../services/tryOnExport';
import { cachedWeather, describeWeatherCode } from '../services/weather';
import { Pill } from './studio/Glass';
import { GarmentImage } from './studio/Garment';
import { StudioSheet } from './studio/StudioSheet';
import { font, INK, isCutout } from './studio/studio';
import { pictureFit } from './studio/imageFit';
import { useImageAspect } from './studio/useImageAspect';
import { FittedFrame } from './ui/FittedFrame';

/** What can be shared: the finished try-on and the look's garments. */
export type ShareRequest = { uri: string; items: WardrobeItem[]; title: string; daily?: boolean };

const PIECES = 4;
const OUTPUT_WIDTH = 1080;
// iOS does not always report the end of loading a local file: the poster does not wait for it for ever.
const LOAD_PATIENCE = 2500;
const PAPER = '#F4F0EA';

/** The 9:16 card, on its own paper in either theme. Everything scales with `width`: it is shown small and captured at full size. */
export const SharePoster = forwardRef<View, { request: ShareRequest; width: number; onReady?: () => void }>(function SharePoster({ request, width, onReady }, ref) {
  const t = useT();
  const s = width / 360;
  const aspect = useImageAspect(request.uri);
  const pieces = request.items.filter(item => item.imageUri).slice(0, PIECES);
  const generated = request.items.map(item => item.name).join(' + ');
  // A name the user gave stands; the pieces' list that serves as a default reads better as a phrase.
  const title = request.title && request.title !== generated ? request.title : lookName(request.items, t('и')) || request.title;
  // Only weather already known: the poster never asks for location, and a city never leaves the device on it.
  const [weather] = useState(cachedWeather);
  const degrees = weather ? Math.round(weather.temperature) : 0;
  const weatherText = weather ? `${degrees > 0 ? '+' : degrees < 0 ? '−' : ''}${Math.abs(degrees)}°, ${t(describeWeatherCode(weather.code))}` : '';
  const loaded = useRef(0);
  const told = useRef(false);
  const ready = () => { if (!told.current) { told.current = true; onReady?.(); } };
  const settled = () => { loaded.current += 1; if (loaded.current >= pieces.length + 1) ready(); };
  useEffect(() => { const timer = setTimeout(ready, LOAD_PATIENCE); return () => clearTimeout(timer); }, []);
  return <View ref={ref} collapsable={false} style={{ width, height: width * 16 / 9, backgroundColor: PAPER, padding: 16 * s }}>
    <FittedFrame aspect={aspect} radius={24 * s} style={{ flex: 1, width: '100%' }}>
      <Image source={{ uri: request.uri }} resizeMode={pictureFit(aspect)} onLoadEnd={settled} style={StyleSheet.absoluteFill} />
    </FittedFrame>
    <View style={{ paddingTop: 14 * s, gap: 4 * s }}>
      <Text style={[font('regular'), { color: INK, opacity: 0.6, fontSize: 12 * s, lineHeight: 16 * s, letterSpacing: 0.4 * s }]} numberOfLines={1}>{t(request.daily ? 'Образ дня' : 'Мой образ')}{weatherText ? ` · ${weatherText}` : ''}</Text>
      <Text style={[font('semibold'), { color: INK, fontSize: 22 * s, lineHeight: 27 * s, letterSpacing: -0.5 * s }]} numberOfLines={2}>{title}</Text>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 12 * s }}>
      <View style={{ flexDirection: 'row', gap: 6 * s }}>
        {pieces.map(item => <View key={item.id} style={{ width: 58 * s, height: 58 * s, borderRadius: 14 * s, backgroundColor: isCutout(item.imageUri) ? 'transparent' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
          <GarmentImage item={item} print printRadius={10 * s} onLoadEnd={settled} style={{ width: 54 * s, height: 54 * s }} />
        </View>)}
      </View>
      <Text style={[font('medium'), { color: INK, opacity: 0.55, fontSize: 11 * s, lineHeight: 14 * s }]}>{t('AI Стилист')}</Text>
    </View>
  </View>;
});

/** The sheet where the choice is made: nothing leaves the device before one of its buttons is tapped. */
function ShareChoiceSheet({ request, visible, login, onClose }: { request: ShareRequest; visible: boolean; login: string; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const poster = useRef<View>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'poster' | 'photo' | null>(null);
  const [failed, setFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const close = () => { if (!busy) { setFailed(false); onClose(); } };
  const sendPoster = async () => {
    if (busy || !poster.current) return;
    setBusy('poster'); setFailed(false); setShareFailed(false);
    let file: string;
    let viewShot: typeof import('react-native-view-shot');
    try {
      // A native module: an older installed build may not have it. The user is told, and nothing else goes out instead.
      viewShot = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const side = OUTPUT_WIDTH / PixelRatio.get();
      file = await viewShot.captureRef(poster.current, { format: 'jpg', quality: 0.92, result: 'tmpfile', width: side, height: side * 16 / 9 });
    } catch { setFailed(true); setBusy(null); return; }
    let shared = true;
    try { await shareLocalFile(file); } catch { shared = false; }
    try { viewShot.releaseCapture(file); } catch { /* A temporary file: the system clears it anyway. */ }
    setBusy(null);
    if (shared) onClose(); else setShareFailed(true);
  };
  const sendPhoto = async () => {
    if (busy) return;
    setBusy('photo'); setFailed(false); setShareFailed(false);
    try { await shareTryOn(request.uri, login); }
    catch { setBusy(null); setShareFailed(true); return; }
    setBusy(null); onClose();
  };
  return <StudioSheet visible={visible} title={t('Как поделиться?')} subtitle={t('Сначала посмотри: без твоего выбора ничего не отправится.')} onClose={close} dismissOnBackdrop={!busy}>
    <View style={styles.preview}><View style={styles.frame}>
      <SharePoster ref={poster} request={request} width={Math.min(240, Math.round(height * 0.5 * 9 / 16))} onReady={() => setReady(true)} />
    </View></View>
    {failed ? <Text style={[font('regular'), styles.error, { color: colors.danger }]}>{t('Постер не получился. Попробуй ещё раз или отправь только фото.')}</Text> : null}
    {shareFailed ? <Text style={[font('regular'), styles.error, { color: colors.danger }]}>{t('Не удалось открыть меню «Поделиться». Попробуй ещё раз или обнови приложение.')}</Text> : null}
    <Pill variant="primary" title={t(ready ? 'Постер' : 'Собираю постер…')} disabled={!ready || busy === 'photo'} loading={busy === 'poster'} onPress={() => { void sendPoster(); }} />
    <Pill title={t('Только фото')} disabled={busy === 'poster'} loading={busy === 'photo'} onPress={() => { void sendPhoto(); }} />
  </StudioSheet>;
}

/**
 * The share action of a finished look: `offer` asks poster or photo in a sheet (draw `sheet` where the
 * button lives, so it opens over that window). A browser has no captured poster: the plain photo goes.
 */
export function useShareChoice(login: string) {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  const asked = useRef(0);
  const offer = (next: ShareRequest) => {
    if (Platform.OS === 'web') { void shareTryOn(next.uri, login); return; }
    const ask = ++asked.current;
    // «Образ дня» only on the day's own look; any other try-on of the day is simply a look.
    void loadValidated(accountKey(login, 'dailyLook'), decodeDailyLook).then(result => isDailyLook(result.value, next.items.map(item => item.id), localDay(new Date())), () => false)
      .then(daily => { if (asked.current === ask) setRequest({ ...next, daily }); });
  };
  const clear = () => { asked.current += 1; setRequest(null); };
  const sheet = request ? <ShareChoiceSheet key={request.uri} request={request} visible login={login} onClose={() => setRequest(null)} /> : null;
  return { offer, sheet, clear };
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center' },
  frame: { borderRadius: 18, overflow: 'hidden' },
  error: { fontSize: 13, lineHeight: 18 }
});
