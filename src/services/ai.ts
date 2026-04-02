import { AI_BASE_URL } from '../constants/ai';

export type AiResult = {
  dominantColor: string;
  palette: string[];
  bgRemovedBase64: string;
  category?: string;
  season?: string;
  pattern?: string;
};

export async function analyzeImage(uri: string): Promise<AiResult> {
  const form = new FormData();
  const filename = uri.split('/').pop() || 'image.jpg';
  form.append('file', {
    uri,
    name: filename,
    type: 'image/jpeg'
  } as any);

  const res = await fetch(AI_BASE_URL + '/analyze', {
    method: 'POST',
    body: form
  });

  if (res.ok === false) {
    throw new Error('AI analyze failed');
  }

  return res.json();
}
