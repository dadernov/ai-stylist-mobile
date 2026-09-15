const FALLBACK_AI_BASE_URL = 'https://62.60.238.183.nip.io';

const envBaseUrl = process.env.EXPO_PUBLIC_AI_BASE_URL?.trim();

const selected = envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : FALLBACK_AI_BASE_URL;

export const AI_BASE_URL = selected.replace(/\/+$/, '');
