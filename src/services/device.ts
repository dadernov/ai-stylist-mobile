import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Идентификатор установки приложения.
 *
 * Нужен серверу, чтобы считать суточную норму примерок: аккаунтов пока нет, а
 * ограничивать расход платных генераций надо уже сейчас. Это не идентификатор
 * человека и не привязан ни к телефону, ни к железу — просто случайная строка,
 * живущая рядом с остальными настройками и исчезающая вместе с приложением.
 */
const KEY = 'deviceId';

let cached: string | null = null;

const generate = () => {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `d-${Date.now().toString(36)}-${random()}${random()}`;
};

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch (error) {
    console.warn('Failed to read device id', error);
  }
  const created = generate();
  cached = created;
  try {
    await AsyncStorage.setItem(KEY, created);
  } catch (error) {
    // Не записался — работаем с тем, что есть в памяти: на этом запуске
    // сервер всё равно увидит один и тот же идентификатор.
    console.warn('Failed to store device id', error);
  }
  return created;
}
