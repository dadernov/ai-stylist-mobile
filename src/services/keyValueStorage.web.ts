import AsyncStorage from '@react-native-async-storage/async-storage';

// Photos exceed localStorage's small quota. Account collections use IndexedDB;
// legacy keys remain readable until a successful transactional write migrates them.
let database: Promise<IDBDatabase> | undefined;
const open = () => {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('stylist-local-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('collections');
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('Close other app tabs to update local storage')); };
  });
  return database;
};
const usesDatabase = (key: string) => key.startsWith('account:') && typeof indexedDB !== 'undefined';

export default {
  async getItem(key: string): Promise<string | null> {
    if (!usesDatabase(key)) return AsyncStorage.getItem(key);
    const db = await open();
    const value = await new Promise<string | undefined>((resolve, reject) => {
      const transaction = db.transaction('collections', 'readonly');
      const request = transaction.objectStore('collections').get(key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    return value ?? AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!usesDatabase(key)) return AsyncStorage.setItem(key, value);
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('collections', 'readwrite');
      transaction.objectStore('collections').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    await AsyncStorage.removeItem(key).catch(() => {});
  }
};
