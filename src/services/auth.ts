import AsyncStorage from '@react-native-async-storage/async-storage';
import { AI_BASE_URL, AI_CLIENT_TOKEN } from '../constants/ai';

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

export type Session = { token: string; login: string; displayName: string };

const request = async (path: string, body: unknown, sessionToken?: string) => {
  const response = await fetch(AI_BASE_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
      ...(sessionToken ? { 'X-Session-Token': sessionToken } : {})
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Сервер ответил неожиданным образом. Попробуй позже.');
  }
  if (!response.ok) {
    // detail — формат ошибок FastAPI; сообщения там уже человеческие.
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'Не удалось связаться с сервером.');
  }
  return data;
};

export const readStoredSession = async (): Promise<Session | null> => {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch (error) {
    console.warn('Failed to read session', error);
    return null;
  }
};

const store = async (session: Session) => {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    // Сессия не записалась — на этом запуске человек внутри, но при следующем
    // придётся войти заново. Молчать об этом нельзя, поэтому пробрасываем выше.
    console.warn('Failed to store session', error);
    throw new Error('Не удалось сохранить вход. Освободи место на устройстве.');
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
    const response = await fetch(AI_BASE_URL + '/auth/me', {
      headers: {
        ...(AI_CLIENT_TOKEN ? { Authorization: `Bearer ${AI_CLIENT_TOKEN}` } : {}),
        'X-Session-Token': session.token
      }
    });
    if (response.status === 401) return null;
    if (!response.ok) return session; // сервер лежит — не выкидываем человека
    const data = await response.json();
    return { ...session, login: data.login || session.login, displayName: data.displayName || session.displayName };
  } catch {
    // Нет сети — оставляем как есть: гардероб лежит локально и доступен.
    return session;
  }
}

export async function signOut(session: Session | null) {
  if (session) {
    try {
      await request('/auth/logout', {}, session.token);
    } catch (error) {
      console.warn('Failed to end session on server', error);
    }
  }
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Failed to clear session', error);
  }
}
