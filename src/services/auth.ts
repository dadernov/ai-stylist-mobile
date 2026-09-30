import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { AI_BASE_URL, AI_CLIENT_TOKEN } from '../constants/ai';
import { ApiError, fetchJson } from './http';
import { translate } from '../constants/i18n';

/**
 * Вход по логину и паролю. Проверка — на сервере.
 *
 * Прежний вход был демонстрационным: код подтверждения генерировался и
 * сверялся прямо в приложении, а в боевой сборке нигде не показывался, то есть
 * войти было невозможно. Теперь пароль проверяет сервер, а приложение хранит
 * только токен сессии — он живёт год и переживает перезапуск, поэтому входить
 * заново при каждом открытии не нужно.
 */
const SESSION_KEY = 'authSession';

// The session token is the key to the account: on a phone it lives in the
// Keychain (the Keystore on Android), not in the app's plain storage, and a
// login saved before moves there on its first read. A browser has no such store.
type SecureStore = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void> };
const secure: SecureStore | null = Platform.OS === 'web' ? null : require('expo-secure-store');
const readRaw = async () => {
  if (!secure) return AsyncStorage.getItem(SESSION_KEY);
  const kept = await secure.getItemAsync(SESSION_KEY);
  if (kept) return kept;
  const legacy = await AsyncStorage.getItem(SESSION_KEY);
  if (legacy) {
    await secure.setItemAsync(SESSION_KEY, legacy);
    await AsyncStorage.removeItem(SESSION_KEY);
  }
  return legacy;
};
const writeRaw = async (value: string) => {
  if (!secure) return AsyncStorage.setItem(SESSION_KEY, value);
  await secure.setItemAsync(SESSION_KEY, value);
  await AsyncStorage.removeItem(SESSION_KEY);
};
const removeRaw = async () => {
  if (secure) await secure.deleteItemAsync(SESSION_KEY);
  await AsyncStorage.removeItem(SESSION_KEY);
};

export type Session = { token: string; login: string; displayName: string };
let sessionWrites: Promise<unknown> = Promise.resolve();
const mutateSession = <T>(action: () => Promise<T>) => {
  const result = sessionWrites.then(action, action);
  sessionWrites = result.catch(() => {});
  return result;
};

const validSession = (value: any): value is Session => Boolean(value && typeof value.token === 'string' && value.token
  && typeof value.login === 'string' && /^[a-z0-9._-]{3,32}$/.test(value.login) && typeof value.displayName === 'string');

const request = async (path: string, body: unknown, sessionToken?: string) => {
  return fetchJson(AI_BASE_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
      ...(sessionToken ? { 'X-Session-Token': sessionToken } : {})
    },
    body: JSON.stringify(body)
  });
};

export const readStoredSession = async (): Promise<Session | null> => {
  try {
    await sessionWrites;
    const raw = await mutateSession(readRaw);
    const value = raw ? JSON.parse(raw) : null;
    return validSession(value) ? value : null;
  } catch (error) {
    console.warn('Failed to read session', error);
    return null;
  }
};

const store = async (session: Session) => {
  try {
    if (!validSession(session)) throw new Error('Invalid server session');
    await mutateSession(() => writeRaw(JSON.stringify(session)));
  } catch (error) {
    // Сессия не записалась — на этом запуске человек внутри, но при следующем
    // придётся войти заново. Молчать об этом нельзя, поэтому пробрасываем выше.
    console.warn('Failed to store session', error);
    throw new Error(translate('Не удалось сохранить вход. Освободи место на устройстве.'));
  }
};

export async function registerAccount(login: string, password: string, displayName: string): Promise<Session> {
  const data = await request('/auth/register', { login, password, displayName });
  const session = { token: data.token, login: data.login, displayName: data.displayName || displayName };
  await store(session);
  return session;
}

export async function signIn(login: string, password: string): Promise<Session> {
  const data = await request('/auth/login', { login, password });
  const session = { token: data.token, login: data.login, displayName: data.displayName || '' };
  await store(session);
  return session;
}

/** Жива ли сохранённая сессия. null — входить заново. */
export async function verifySession(session: Session): Promise<Session | null> {
  try {
    const data = await fetchJson(AI_BASE_URL + '/auth/me', {
      headers: {
        ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
        'X-Session-Token': session.token
      }
    }, 8000);
    return { ...session, displayName: typeof data.displayName === 'string' ? data.displayName : session.displayName };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    // Нет сети — оставляем как есть: гардероб лежит локально и доступен.
    return session;
  }
}

export async function forgetStoredSession(session: Session) {
  await mutateSession(async () => {
    const raw = await readRaw();
    const stored = raw ? JSON.parse(raw) : null;
    if (stored?.token === session.token) await removeRaw();
  });
}

export async function signOut(session: Session | null) {
  if (!session) return;
  // Clear locally before networking; an old logout must never erase a new login.
  await forgetStoredSession(session);
  void request('/auth/logout', {}, session.token).catch(() => console.warn('Remote logout unavailable'));
}

/** Удаляет аккаунт на сервере (сессии, результаты примерок, расход) и забывает вход. */
export async function deleteAccount(session: Session) {
  await request('/auth/delete-account', {}, session.token);
  await forgetStoredSession(session);
}
