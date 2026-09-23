import { AI_BASE_URL, AI_CLIENT_TOKEN } from '../constants/ai';
import { Platform } from 'react-native';
import { readStoredSession, Session } from './auth';
import { fetchJson } from './http';

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
  jobId?: string;
  updatedAt?: number;
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

// Сервер отказывает без токена сборки и без живой сессии: платные генерации
// больше не открыты всем подряд, а суточная норма считается по аккаунту.
// Сессия читается из хранилища на каждый запрос, чтобы после входа или выхода
// не остался заголовок от прошлого пользователя.
const authHeaders = async (owner?: Session): Promise<Record<string, string>> => {
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

  return fetchJson(AI_BASE_URL + '/analyze', {
    method: 'POST',
    headers: await authHeaders(),
    body: form
  }, 90000);

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
  owner?: Session
): Promise<TryOnGenerateResult> {
  const form = new FormData();
  await appendPhoto(form, 'person_file', personUri);
  if (topUri) await appendPhoto(form, 'top_file', topUri);
  if (bottomUri) await appendPhoto(form, 'bottom_file', bottomUri);
  if (shoesUri) await appendPhoto(form, 'shoes_file', shoesUri);
  if (outerUri) await appendPhoto(form, 'outer_file', outerUri);
  if (topCategory) form.append('top_category', topCategory);
  if (outerCategory) form.append('outer_category', outerCategory);
  form.append('tuck_mode', tuckMode);
  form.append('quality_mode', 'quality');
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
