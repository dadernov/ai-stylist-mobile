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

  return parseJsonOrThrow(res);
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
  qualityMode: TryOnQualityMode = 'quality'
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
  form.append('tuck_mode', tuckMode);
  form.append('quality_mode', qualityMode);
  if (compareMode) {
    form.append('compare_mode', 'true');
  }

  const res = await fetchWithTimeout(
    AI_BASE_URL + '/tryon-generate-look',
    {
      method: 'POST',
      body: form
    },
    420000
  );

  const data = await parseJsonOrThrow(res);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `AI try-on look failed (${res.status})`);
  }

  return data;
}
