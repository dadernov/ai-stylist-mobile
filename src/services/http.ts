import { translate } from '../constants/i18n';

// Server and network messages are Russian source strings; show them in the interface language.
export class ApiError extends Error {
  constructor(message: string, public status?: number) { super(translate(message)); }
}

export async function fetchJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new ApiError('Сервер ответил неожиданным образом. Попробуй позже.', response.status); }
    if (!response.ok || data?.error) {
      const validation = Array.isArray(data?.detail) ? data.detail.filter((entry: any) => typeof entry?.msg === 'string')
        .slice(0, 3).map((entry: any) => entry.msg.slice(0, 512)).join('. ') : '';
      const message = typeof data?.detail === 'string' ? data.detail : validation || (typeof data?.error === 'string' ? data.error
        : response.status === 429 ? 'Слишком много запросов. Попробуй позже.' : 'Не удалось выполнить запрос. Попробуй ещё раз.');
      throw new ApiError(message, response.status);
    }
    return data as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new ApiError('Сервер не ответил вовремя. Проверь соединение и попробуй ещё раз.');
    throw error;
  } finally { clearTimeout(timer); }
}
