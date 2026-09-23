import storage from './keyValueStorage';

/**
 * Чтение и запись состояния по одному ключу.
 *
 * Раньше вся загрузка была обёрнута в один try/catch: испорченная запись в
 * одном ключе обрывала чтение остальных, а состояние по умолчанию тут же
 * сохранялось поверх — приложение стирало данные, которые были целы.
 * Поэтому каждый ключ читается отдельно, а о неудаче сообщается явно, чтобы
 * вызывающий код не записал в этот ключ пустоту.
 */
export type LoadResult<T> = { value: T | null; failed: boolean };

export async function loadJson<T>(key: string): Promise<LoadResult<T>> {
  try {
    const raw = await storage.getItem(key);
    if (raw === null || raw === '') return { value: null, failed: false };
    return { value: JSON.parse(raw) as T, failed: false };
  } catch (error) {
    console.warn(`Failed to read ${key}`, error);
    return { value: null, failed: true };
  }
}

export async function loadRaw(key: string): Promise<LoadResult<string>> {
  try {
    return { value: await storage.getItem(key), failed: false };
  } catch (error) {
    console.warn(`Failed to read ${key}`, error);
    return { value: null, failed: true };
  }
}

export async function loadValidated<T>(key: string, decode: (value: unknown) => T): Promise<LoadResult<T>> {
  const result = await loadJson<unknown>(key);
  if (result.failed || result.value === null) return { value: null, failed: result.failed };
  try { return { value: decode(result.value), failed: false }; }
  catch { return { value: null, failed: true }; }
}

const writes = new Map<string, Promise<void>>();
export function saveJson(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  const write = (writes.get(key) || Promise.resolve()).catch(() => {}).then(() => storage.setItem(key, encoded));
  writes.set(key, write);
  void write.finally(() => { if (writes.get(key) === write) writes.delete(key); }).catch(() => {});
  return write;
}
