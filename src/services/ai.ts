import { AI_BASE_URL, AI_CLIENT_TOKEN } from '../constants/ai';
import { Platform } from 'react-native';
import { getDeviceId } from './device';

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

export type TryOnGenerateResult = {
  status: string;
  outputUrl?: string;
  predictionId?: string;
  webUrl?: string;
  error?: string;
  detail?: string;
  warning?: string;
  steps?: Array<Record<string, any>>;
};

export type TuckMode = 'auto' | 'tucked' | 'untucked';
export type TryOnQualityMode = 'fast' | 'quality';

// Сервер отказывает без токена приложения и идентификатора установки: платные
// генерации больше не открыты всем подряд, а норма считается на устройство.
const authHeaders = async (): Promise<Record<string, string>> => ({
  ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
  'X-Device-Id': await getDeviceId()
});

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

const appendPhoto = async (form: FormData, field: string, uri: string) => {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Не удалось прочитать выбранное фото. Выбери его ещё раз.');
    const blob = await response.blob();
    form.append(field, blob, `${field}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
    return;
  }
  const png = /^data:image\/png/i.test(uri) || /\.png(?:\?|$)/i.test(uri);
  const webp = /^data:image\/webp/i.test(uri) || /\.webp(?:\?|$)/i.test(uri);
  form.append(field, { uri, name: `${field}.${png ? 'png' : webp ? 'webp' : 'jpg'}`, type: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg' } as any);
};

export async function analyzeImage(uri: string, sectionHint?: string): Promise<AiResult> {
  const form = new FormData();
  await appendPhoto(form, 'file', uri);
  if (sectionHint) form.append('section_hint', sectionHint);

  const res = await fetchWithTimeout(AI_BASE_URL + '/analyze', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 90000);

  const data = await parseJsonOrThrow(res);

  if (res.ok === false) {
    throw new Error(data?.error || (typeof data?.detail === 'string' ? data.detail : 'Не удалось проанализировать фото. Попробуй ещё раз.'));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function analyzeTryOnModel(uri: string): Promise<TryOnModelResult> {
  const form = new FormData();
  const filename = uri.split('/').pop() || 'model.jpg';
  form.append('file', {
    uri,
    name: filename,
    type: 'image/jpeg'
  } as any);

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
  const filename = uri.split('/').pop() || 'model.jpg';
  form.append('file', {
    uri,
    name: filename,
    type: 'image/jpeg'
  } as any);

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
  form.append('person_file', {
    uri: personUri,
    name: personUri.split('/').pop() || 'person.jpg',
    type: 'image/jpeg'
  } as any);
  form.append('garment_file', {
    uri: garmentUri,
    name: garmentUri.split('/').pop() || 'garment.jpg',
    type: 'image/jpeg'
  } as any);

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
  outerCategory?: string
): Promise<TryOnGenerateResult> {
  const form = new FormData();
  form.append('person_file', {
    uri: personUri,
    name: personUri.split('/').pop() || 'person.jpg',
    type: 'image/jpeg'
  } as any);

  if (topUri) {
    form.append('top_file', {
      uri: topUri,
      name: topUri.split('/').pop() || 'top.jpg',
      type: 'image/jpeg'
    } as any);
  }
  if (bottomUri) {
    form.append('bottom_file', {
      uri: bottomUri,
      name: bottomUri.split('/').pop() || 'bottom.jpg',
      type: 'image/jpeg'
    } as any);
  }
  if (shoesUri) {
    form.append('shoes_file', {
      uri: shoesUri,
      name: shoesUri.split('/').pop() || 'shoes.jpg',
      type: 'image/jpeg'
    } as any);
  }
  if (outerUri) {
    form.append('outer_file', {
      uri: outerUri,
      name: outerUri.split('/').pop() || 'outer.jpg',
      type: 'image/jpeg'
    } as any);
  }
  // Сервер решает по категориям, видно ли верх под верхней одеждой: если нет,
  // отдельный проход по верху не запускается — это лишняя оплаченная генерация
  // и лишняя потеря качества на кадре.
  if (topCategory) form.append('top_category', topCategory);
  if (outerCategory) form.append('outer_category', outerCategory);
  form.append('tuck_mode', tuckMode);
  form.append('quality_mode', qualityMode);
  if (compareMode) {
    form.append('compare_mode', 'true');
  }

  const timeoutMs = qualityMode === 'fast' ? 180000 : 420000;
  const res = await fetchWithTimeout(
    AI_BASE_URL + '/tryon-generate-look',
    {
      method: 'POST',
      headers: await authHeaders(),
      body: form
    },
    timeoutMs
  );

  const data = await parseJsonOrThrow(res);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `AI try-on look failed (${res.status})`);
  }

  return data;
}
