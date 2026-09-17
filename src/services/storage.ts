import AsyncStorage from '@react-native-async-storage/async-storage';

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
    const raw = await AsyncStorage.getItem(key);
    if (raw === null || raw === '') return { value: null, failed: false };
    return { value: JSON.parse(raw) as T, failed: false };
  } catch (error) {
    console.warn(`Failed to read ${key}`, error);
    return { value: null, failed: true };
  }
}

export async function loadRaw(key: string): Promise<LoadResult<string>> {
  try {
    return { value: await AsyncStorage.getItem(key), failed: false };
  } catch (error) {
    console.warn(`Failed to read ${key}`, error);
    return { value: null, failed: true };
  }
}

export function saveJson(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}
