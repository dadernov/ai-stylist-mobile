import { AI_BASE_URL, AI_CLIENT_TOKEN } from '../constants/ai';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { readStoredSession, Session } from './auth';
import { GarmentTraits } from '../data/mock';
import { fetchJson } from './http';
import { translate } from '../constants/i18n';

export type AiResult = {
  dominantColor: string | null;
  palette: string[];
  bgRemovedBase64: string;
  category?: string | null;
  section?: string | null;
  season?: string | null;
  pattern?: string | null;
  needsReview?: boolean;
  categoryCandidates?: { category: string; section: string; score: number }[];
  warnings?: string[];
  analysisSource?: string;
  backgroundRemoved?: boolean;
  /** Sleeves, length, front opening and bulk read from the photo, for tops and outerwear. */
  traits?: GarmentTraits;
  error?: string;
};

export type TryOnPoint = {
  x: number;
  y: number;
  v: number;
};

export type TryOnPose = {
  leftShoulder: TryOnPoint;
  rightShoulder: TryOnPoint;
  leftHip: TryOnPoint;
  rightHip: TryOnPoint;
  leftAnkle: TryOnPoint;
  rightAnkle: TryOnPoint;
  nose: TryOnPoint;
} | null;

export type TryOnModelResult = {
  avatarModelBase64?: string;
  neutralModelBase64?: string;
  personMaskBase64: string;
  pose: TryOnPose;
  orientation: 'front' | 'left' | 'right' | 'unknown';
  torsoAngleDeg: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type TryOnProgress = {
  // Server stage names: bottom | shoes | top | outer | outfit, plus 'composite' for the final lock;
  // 'queue' while the look waits its turn on the server, 'upload' while the app still sends the photos.
  done: string[];
  pending: string[];
  stage?: string | null;
  total: number;
  previewUrl?: string;
  // The place in the server's queue, from 1.
  position?: number;
};

export type TryOnGenerateResult = {
  status: string;
  jobId?: string;
  updatedAt?: number;
  outputUrl?: string;
  predictionId?: string;
  webUrl?: string;
  error?: string;
  detail?: string;
  warning?: string;
  identityLocked?: boolean;
  progress?: TryOnProgress;
  steps?: Array<Record<string, any>>;
};

export type TuckMode = 'auto' | 'tucked' | 'untucked';
export type TryOnQualityMode = 'fast' | 'quality';

// Сервер отказывает без токена сборки и без живой сессии: платные генерации
// больше не открыты всем подряд, а суточная норма считается по аккаунту.
// Сессия читается из хранилища на каждый запрос, чтобы после входа или выхода
// не остался заголовок от прошлого пользователя.
export const authHeaders = async (owner?: Session): Promise<Record<string, string>> => {
  const session = owner || await readStoredSession();
  return {
    ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
    ...(session ? { 'X-Session-Token': session.token } : {})
  };
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`AI timeout (${timeoutMs}ms): ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseJsonOrThrow = async (res: Response) => {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const snippet = raw.slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`AI returned non-JSON (${res.status}): ${snippet || 'empty body'}`);
  }
};

const UPLOAD_ERROR = 'Не удалось прочитать выбранное фото. Выбери его ещё раз.';

// Since SDK 57 the global fetch is Expo's: multipart parts must be strings,
// Blobs or expo-file-system File objects. The old { uri, name, type } part
// throws "Unsupported FormDataPart implementation".
// The server never uses more than 2048 px of the person's photo and 1024 px of
// a garment's, and a full-size camera JPEG (3-8 MB) takes longer to upload over
// mobile data than the analysis itself: a garment at 1280 px is 0.24 MB where
// one at 2048 px was 0.83. PNG keeps its transparency; anything that fails to
// shrink is sent as it is.
const TRYON_UPLOAD_MAX_SIDE = 2048;
const GARMENT_UPLOAD_MAX_SIDE = 1280;
const shrinkForUpload = async (fileUri: string, png: boolean, maxSide = TRYON_UPLOAD_MAX_SIDE) => {
  try {
    const rendered = await ImageManipulator.manipulate(fileUri).renderAsync();
    const { width, height } = rendered;
    if (Math.max(width, height) <= maxSide) return fileUri;
    // Resized from the decoded image: the file is not read and decoded a second time.
    const resized = await ImageManipulator.manipulate(rendered)
      .resize(width >= height ? { width: maxSide } : { height: maxSide }).renderAsync();
    const saved = await resized.saveAsync(png ? { format: SaveFormat.PNG } : { format: SaveFormat.JPEG, compress: 0.9 });
    return saved.uri;
  } catch {
    return fileUri;
  }
};

// `shrink`: true sends at most 2048 px, a number at most that many.
export const appendPhoto = async (form: FormData, field: string, uri: string, shrink: boolean | number = false) => {
  const png = /^data:image\/png/i.test(uri) || /\.png(?:\?|$)/i.test(uri);
  const webp = /^data:image\/webp/i.test(uri) || /\.webp(?:\?|$)/i.test(uri);
  const extension = png ? 'png' : webp ? 'webp' : 'jpg';
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(translate(UPLOAD_ERROR));
    const blob = await response.blob();
    form.append(field, blob, `${field}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
    return;
  }
  let fileUri = uri;
  if (!/^file:\/\//i.test(uri)) {
    // Data URLs and foreign schemes are materialised in the cache first; the
    // legacy writer is the same one that stores wardrobe photos.
    const target = `${LegacyFileSystem.cacheDirectory || ''}upload-${field}-${Date.now()}.${extension}`;
    try {
      if (/^data:image\//i.test(uri)) {
        await LegacyFileSystem.writeAsStringAsync(target, uri.split(',')[1] || '', { encoding: LegacyFileSystem.EncodingType.Base64 });
      } else if (/^https?:\/\//i.test(uri)) {
        const download = await LegacyFileSystem.downloadAsync(uri, target);
        if (download.status < 200 || download.status >= 300) throw new Error(translate(UPLOAD_ERROR));
      } else {
        await LegacyFileSystem.copyAsync({ from: uri, to: target });
      }
    } catch {
      throw new Error(translate(UPLOAD_ERROR));
    }
    fileUri = target;
  }
  // Expo's multipart encoder accepts any part with bytes(); File itself
  // exposes arrayBuffer() only, so wrap it with the name and type it needs.
  if (shrink) fileUri = await shrinkForUpload(fileUri, png, shrink === true ? TRYON_UPLOAD_MAX_SIDE : shrink);
  const file = new File(fileUri);
  const part = {
    uri: fileUri,
    name: `${field}.${extension}`,
    type: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg',
    bytes: async () => new Uint8Array(await file.arrayBuffer())
  };
  form.append(field, part as unknown as Blob);
};

export async function analyzeImage(uri: string, sectionHint?: string): Promise<AiResult> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri);
  if (sectionHint) form.append('section_hint', sectionHint);

  return fetchJson(AI_BASE_URL + '/analyze', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 90000);

}

/** The traits of an item added before /analyze returned them: read once, then kept with the item. */
export async function readGarmentTraits(uri: string, category: string): Promise<GarmentTraits> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri);
  form.append('category', category);
  const result = await fetchJson(AI_BASE_URL + '/garment-traits', { method: 'POST', headers: await authHeaders(), body: form }, 30000);
  return result?.traits && typeof result.traits === 'object' ? result.traits : {};
}

// What may spoil a try-on on this photo, found by the server's local models
// before any paid generation: nobody, several people, a cut-off head, a hidden
// face, cut-off feet, a raised arm or a figure too far away.
export type PhotoIssue = 'person' | 'people' | 'head' | 'face' | 'feet' | 'arms' | 'hands' | 'coat' | 'small';

export async function checkTryOnPhoto(uri: string): Promise<PhotoIssue[]> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri, true);
  const result = await fetchJson(AI_BASE_URL + '/tryon-photo-check', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 30000);
  return Array.isArray(result?.issues) ? result.issues : [];
}

export async function analyzeTryOnModel(uri: string): Promise<TryOnModelResult> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri);

  const res = await fetchWithTimeout(AI_BASE_URL + '/tryon-model', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 45000);

  if (res.ok === false) {
    throw new Error(`AI try-on model failed (${res.status})`);
  }

  return parseJsonOrThrow(res);
}

export async function analyzeTryOnAvatar(uri: string): Promise<TryOnModelResult> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri);

  const res = await fetchWithTimeout(AI_BASE_URL + '/tryon-avatar', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 45000);

  if (res.ok === false) {
    throw new Error(`AI try-on avatar failed (${res.status})`);
  }

  return parseJsonOrThrow(res);
}

export async function analyzeTryOnGenerate(personUri: string, garmentUri: string): Promise<TryOnGenerateResult> {
  const form = new FormData();
  await appendPhoto(form, 'person_file', personUri);
  await appendPhoto(form, 'garment_file', garmentUri);

  const res = await fetchWithTimeout(
    AI_BASE_URL + '/tryon-generate',
    {
      method: 'POST',
      headers: await authHeaders(),
      body: form
    },
    260000
  );

  const data = await parseJsonOrThrow(res);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `AI try-on generate failed (${res.status})`);
  }

  return data;
}

export async function analyzeTryOnGenerateLook(
  personUri: string,
  topUri?: string,
  bottomUri?: string,
  shoesUri?: string,
  tuckMode: TuckMode = 'auto',
  compareMode = false,
  qualityMode: TryOnQualityMode = 'quality',
  outerUri?: string,
  topCategory?: string,
  outerCategory?: string,
  requestId?: string,
  owner?: Session,
  // true when the same garments are generated again: the user wants another
  // variant, so the server redoes every layer instead of reusing the base.
  fresh = false,
  // Further tops and a second outer layer, worn over the first ones.
  layers: { top2Uri?: string; top2Category?: string; outer2Uri?: string; outer2Category?: string;
    top3Uri?: string; top3Category?: string; top4Uri?: string; top4Category?: string;
    // Tights, worn under the skirt or dress.
    legwearUri?: string;
    // One hat, scarf, pair of gloves and bag; a bag's category tells a backpack or a clutch from a shoulder bag.
    hatUri?: string; scarfUri?: string; glovesUri?: string; bagUri?: string; bagCategory?: string } = {},
  // How each garment is worn, by upload slot: { top: { tuck: 'tucked' }, outer: { fasten: 'closed' } }.
  garmentOptions: Record<string, { tuck?: string; fasten?: string }> = {}
): Promise<TryOnGenerateResult> {
  const form = new FormData();
  // All photos are prepared at once rather than one after another; the server
  // reads each part by its name, so their order in the form does not matter.
  const garments: [string, string | undefined][] = [['top_file', topUri], ['top2_file', layers.top2Uri], ['top3_file', layers.top3Uri],
    ['top4_file', layers.top4Uri], ['bottom_file', bottomUri], ['legwear_file', layers.legwearUri], ['shoes_file', shoesUri],
    ['outer_file', outerUri], ['outer2_file', layers.outer2Uri], ['hat_file', layers.hatUri], ['scarf_file', layers.scarfUri],
    ['gloves_file', layers.glovesUri], ['bag_file', layers.bagUri]];
  await Promise.all([appendPhoto(form, 'person_file', personUri, true),
    ...garments.filter(([, uri]) => uri).map(([field, uri]) => appendPhoto(form, field, uri!, GARMENT_UPLOAD_MAX_SIDE))]);
  if (topCategory) form.append('top_category', topCategory);
  if (outerCategory) form.append('outer_category', outerCategory);
  if (layers.top2Category) form.append('top2_category', layers.top2Category);
  if (layers.bagUri && layers.bagCategory) form.append('bag_category', layers.bagCategory);
  if (layers.outer2Category) form.append('outer2_category', layers.outer2Category);
  if (layers.top3Category) form.append('top3_category', layers.top3Category);
  if (layers.top4Category) form.append('top4_category', layers.top4Category);
  form.append('tuck_mode', tuckMode);
  if (Object.keys(garmentOptions).length) form.append('garment_options', JSON.stringify(garmentOptions));
  // The app always asks for 'quality'; 'fast' drafts remain only in older history.
  form.append('quality_mode', qualityMode);
  if (fresh) form.append('fresh', 'true');
  if (requestId) { form.append('request_id', requestId); form.append('async_mode', 'true'); }
  if (compareMode) {
    form.append('compare_mode', 'true');
  }

  const timeoutMs = 1080000;
  return fetchJson(
    AI_BASE_URL + '/tryon-generate-look',
    {
      method: 'POST',
      headers: await authHeaders(owner),
      body: form
    },
    requestId ? 90000 : timeoutMs
  );
}

export async function getTryOnJob(id: string, owner: Session): Promise<TryOnGenerateResult> {
  return fetchJson(AI_BASE_URL + '/tryon-jobs/' + encodeURIComponent(id), { headers: await authHeaders(owner) }, 15000);
}
