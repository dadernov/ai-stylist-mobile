import { NativeModules } from 'react-native';

const FALLBACK_AI_BASE_URL = 'http://193.233.250.130:8000';
const DEV_AI_PORT = 8010;

const envBaseUrl = process.env.EXPO_PUBLIC_AI_BASE_URL?.trim();

const deriveLocalAiBaseUrl = () => {
  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    if (!scriptURL) return null;
    const parsed = new URL(scriptURL);
    if (!parsed.hostname) return null;
    return `http://${parsed.hostname}:${DEV_AI_PORT}`;
  } catch (_error) {
    return null;
  }
};

const devDerivedBaseUrl = __DEV__ ? deriveLocalAiBaseUrl() : null;
const selected = envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : devDerivedBaseUrl || FALLBACK_AI_BASE_URL;

export const AI_BASE_URL = selected.replace(/\/+$/, '');
