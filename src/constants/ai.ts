const DEFAULT_AI_BASE_URL = 'http://193.233.250.130:8000';
const envBaseUrl = process.env.EXPO_PUBLIC_AI_BASE_URL?.trim();

export const AI_BASE_URL = (envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : DEFAULT_AI_BASE_URL).replace(
  /\/+$/,
  ''
);
