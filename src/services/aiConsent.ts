import storage from './keyValueStorage';
import { accountKey } from './accountStorage';

// Apple 5.1.2(i): personal data may go to a third-party AI only after the user
// explicitly agrees. The answer is stored per account and per policy version,
// so a changed data flow asks again.
export const AI_CONSENT_VERSION = '2026-09-28';
const key = (login: string) => accountKey(login, 'aiConsent');

export async function hasAiConsent(login: string) {
  try { return (await storage.getItem(key(login))) === AI_CONSENT_VERSION; } catch { return false; }
}

export async function saveAiConsent(login: string, granted: boolean) {
  if (granted) await storage.setItem(key(login), AI_CONSENT_VERSION);
  else await storage.removeItem(key(login));
}
