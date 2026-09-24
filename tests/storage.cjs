const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);

// --- заглушки нативных модулей -------------------------------------------
const store = new Map();
const asyncStorage = {
  getItem: async (key) => {
    if (store.get(key) === '__throw__') throw new Error('storage unavailable');
    return store.has(key) ? store.get(key) : null;
  },
  setItem: async (key, value) => {
    if (key === '__full__') throw new Error('database or disk is full');
    store.set(key, value);
  }
};

const DOCS = '/docs/';
let files = new Map();
const fileSystem = {
  documentDirectory: DOCS,
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (target, contents) => files.set(target, contents),
  copyAsync: async ({ from, to }) => files.set(to, `copy-of:${from}`),
  downloadAsync: async (uri, target) => {
    files.set(target, `download-of:${uri}`);
    return { status: 200, uri: target };
  },
  readDirectoryAsync: async (dir) => [...files.keys()].filter((name) => name.startsWith(dir)).map((name) => name.slice(dir.length)),
  deleteAsync: async (target) => files.delete(target)
};

const stubs = { 'expo-file-system/legacy': fileSystem, '@react-native-async-storage/async-storage': { default: asyncStorage } };
const load = Module._load;
Module._load = (request, parent, isMain) => (request in stubs ? stubs[request] : load(request, parent, isMain));

const root = path.join(__dirname, '..', 'src', 'services');
const { loadJson, loadRaw, saveJson } = require(path.join(root, 'storage.ts'));
const { persistPhoto, photoDirectory, reanchorPhoto, removeUnusedPhotos } = require(path.join(root, 'photos.ts'));

const run = async () => {
  // --- чтение по ключу ----------------------------------------------------
  store.set('good', JSON.stringify([{ id: 'a' }]));
  store.set('broken', '{"нет закрывающей');
  assert.deepEqual(await loadJson('good'), { value: [{ id: 'a' }], failed: false });
  assert.deepEqual(await loadJson('missing'), { value: null, failed: false });

  // Главное свойство: испорченный ключ отличим от пустого. Иначе приложение
  // считало данные отсутствующими и записывало поверх пустоту.
  const damaged = await loadJson('broken');
  assert.equal(damaged.value, null);
  assert.equal(damaged.failed, true);

  store.set('unreadable', '__throw__');
  assert.equal((await loadJson('unreadable')).failed, true);
  assert.equal((await loadRaw('unreadable')).failed, true);

  // Один испорченный ключ не мешает прочитать остальные.
  assert.deepEqual((await loadJson('good')).value, [{ id: 'a' }]);

  // --- запись -------------------------------------------------------------
  await saveJson('wardrobe', [{ id: 'b' }]);
  assert.equal(store.get('wardrobe'), '[{"id":"b"}]');
  await assert.rejects(() => saveJson('__full__', []), /full/);

  // --- фотографии в файлах ------------------------------------------------
  files = new Map();
  const fromData = await persistPhoto('data:image/png;base64,AAAA');
  assert.ok(fromData.startsWith(photoDirectory), 'вырез должен уехать в папку приложения');
  assert.ok(fromData.endsWith('.png'));
  assert.equal(files.get(fromData), 'AAAA');

  const fromCache = await persistPhoto('file:///tmp/ImagePicker/xyz.jpg');
  assert.ok(fromCache.startsWith(photoDirectory), 'кеш ImagePicker система может вычистить, поэтому копируем к себе');
  assert.equal(files.get(fromCache), 'copy-of:file:///tmp/ImagePicker/xyz.jpg');

  const fromRemote = await persistPhoto('https://example.com/a.webp');
  assert.ok(fromRemote.endsWith('.webp'));

  // Уже наш файл не копируется повторно — иначе папка росла бы при каждом сохранении.
  assert.equal(await persistPhoto(fromData), fromData);
  assert.equal(files.size, 3);

  // --- путь переживает обновление приложения ------------------------------
  const moved = `/var/containers/OLD/photos/${fromData.split('/').pop()}`;
  assert.equal(reanchorPhoto(moved), fromData);
  assert.equal(reanchorPhoto('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(reanchorPhoto(undefined), undefined);

  // --- уборка -------------------------------------------------------------
  const removed = await removeUnusedPhotos([fromData, undefined]);
  assert.equal(removed, 2, 'удалить нужно только то, на что никто не ссылается');
  assert.ok(files.has(fromData));
  assert.equal(files.size, 1);

  console.log('PASS: испорченный ключ отличим от пустого, фото уезжают в файлы, путь переживает обновление, мусор убирается');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
