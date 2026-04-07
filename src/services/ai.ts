import { AI_BASE_URL } from '../constants/ai';

export type AiResult = {
  dominantColor: string;
  palette: string[];
  bgRemovedBase64: string;
  category?: string;
  season?: string;
  pattern?: string;
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

export async function analyzeImage(uri: string): Promise<AiResult> {
  const form = new FormData();
  const filename = uri.split('/').pop() || 'image.jpg';
  form.append('file', {
    uri,
    name: filename,
    type: 'image/jpeg'
  } as any);

  const res = await fetchWithTimeout(AI_BASE_URL + '/analyze', {
    method: 'POST',
    body: form
  }, 20000);

  if (res.ok === false) {
    throw new Error(`AI analyze failed (${res.status})`);
  }

  return res.json();
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
    body: form
  }, 45000);

  if (res.ok === false) {
    throw new Error(`AI try-on model failed (${res.status})`);
  }

  return res.json();
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
    body: form
  }, 45000);

  if (res.ok === false) {
    throw new Error(`AI try-on avatar failed (${res.status})`);
  }

  return res.json();
}
