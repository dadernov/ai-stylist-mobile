// Saving a look: one tap saves once, the picture stays a file of the app's own and comes back after a restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);

const DOCS = 'file:///var/app-new/Documents/';
const files = new Map();
const store = new Map();
let failDownload = false;
const fileSystem = {
  documentDirectory: DOCS, EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (target, contents) => files.set(target, contents),
  copyAsync: async ({ from, to }) => files.set(to, `copy-of:${from}`),
  downloadAsync: async (uri, target) => { if (failDownload) return { status: 404 }; files.set(target, `download-of:${uri}`); return { status: 200, uri: target }; },
  readDirectoryAsync: async () => [], deleteAsync: async () => {}
};
const asyncStorage = { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } };
const stubs = { 'expo-file-system/legacy': fileSystem, '@react-native-async-storage/async-storage': { default: asyncStorage }, './keyValueStorage': { default: asyncStorage } };
const load = Module._load;
Module._load = (request, parent, isMain) => (request in stubs ? stubs[request] : load(request, parent, isMain));

const src = path.join(__dirname, '../src');
const { addLook, isLookSaved, lookFromJob, lookWithResult, plainLook, removeLook } = require(path.join(src, 'domain/favorites.ts'));
const { durableLook, keepTryOnImage, reanchorTryOnUri } = require(path.join(src, 'services/tryOnPhotos.ts'));
const { decodeGenerated } = require(path.join(src, 'services/accountStorage.ts'));

const run = async () => {
  // --- dedupe -------------------------------------------------------------
  const plain = plainLook('idea', 'Образ', ['a', 'b']);
  let list = addLook([], plain);
  assert.equal(list.length, 1);
  assert.equal(addLook(list, plain), list, 'a second tap changes nothing');
  assert.equal(addLook(list, plainLook('other', 'Другой', ['b', 'a'])), list, 'the same pieces in any order are the same bare look');
  assert.equal(isLookSaved(list, plain), true);
  assert.equal(isLookSaved(list, plainLook('x', 'x', ['a'])), false);
  assert.equal(isLookSaved([plainLook('e', 'e', [])], plainLook('f', 'f', [])), false, 'no pieces never match');
  assert.deepEqual(removeLook(list, plain), []);

  // A try-on of a look saved bare: not yet saved, and joins that favourite.
  const job = { id: 'j1', name: 'Образ', itemIds: ['b', 'a'], result: { id: 'j1', imageUri: `${DOCS}try-ons/me/j1.jpg`, updatedAt: 5, tuckMode: 'auto' } };
  const tried = lookFromJob(job);
  assert.equal(tried.id, 'job-j1');
  assert.equal(isLookSaved(list, tried), false);
  list = addLook(list, tried);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'idea');
  assert.equal(list[0].tryOnImageUri, job.result.imageUri);
  assert.equal(isLookSaved(list, tried), true);
  assert.equal(addLook(list, tried), list);
  assert.equal(isLookSaved(list, plain), true, 'the look stays saved seen from the idea');

  // Another try-on of the same pieces is its own favourite; removing one leaves the other.
  const second = lookFromJob({ ...job, id: 'j2', result: { ...job.result, id: 'j2', imageUri: `${DOCS}try-ons/me/j2.jpg` } });
  list = addLook(list, second);
  assert.equal(list.length, 2);
  assert.equal(removeLook(list, second).length, 1);
  assert.equal(removeLook(list, tried).length, 1);

  // The same card tried again: the favourite takes the new picture and keeps the old one in its history.
  const card = lookWithResult(plainLook('card', 'К', ['z']), { imageUri: `${DOCS}try-ons/me/1.jpg`, updatedAt: 1 });
  const again = lookWithResult(card, { imageUri: `${DOCS}try-ons/me/2.jpg`, updatedAt: 2 });
  const updated = addLook(addLook([], card), again);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].tryOnImageUri, again.tryOnImageUri);
  assert.deepEqual(updated[0].tryOnHistory.map(frame => frame.imageUri), [card.tryOnImageUri]);

  // The app's folder moved after an update: still the same picture.
  assert.equal(isLookSaved(list, { ...tried, tryOnImageUri: 'file:///var/app-old/Documents/try-ons/me/j1.jpg' }), true);

  // --- the picture is kept ------------------------------------------------
  const kept = `${DOCS}try-ons/me/j1.jpg`;
  assert.equal(await keepTryOnImage(kept, 'f', 'me'), kept, 'already kept: no copy');
  assert.equal(files.size, 0);
  assert.equal(await keepTryOnImage('file:///var/app-old/Documents/try-ons/me/j1.jpg', 'f', 'me'), kept, 'an old folder is re-anchored');

  const link = 'https://server/tmp/result.jpg';
  const fromLink = await durableLook(lookWithResult(plain, { imageUri: link, updatedAt: 7 }), 'me');
  assert.ok(fromLink.tryOnImageUri.startsWith(`${DOCS}try-ons/me/favorite-idea-7`), 'a server link never gets stored as the picture');
  assert.equal(files.get(fromLink.tryOnImageUri), `download-of:${link}`);
  assert.equal(isLookSaved(addLook([], fromLink), lookWithResult(plain, { imageUri: link, updatedAt: 7 })), true, 'the look still holding the link reads as saved');

  const temp = await keepTryOnImage('file:///var/Caches/ImagePicker/x.png', 'tmp', 'me');
  assert.equal(temp, `${DOCS}try-ons/me/tmp.png`, 'a temporary file is copied in');
  const data = await keepTryOnImage('data:image/png;base64,QUJD', 'data', 'me');
  assert.equal(files.get(data), 'QUJD');

  // A dead link fails loudly instead of saving a favourite that will show nothing.
  failDownload = true;
  await assert.rejects(durableLook(lookWithResult(plain, { imageUri: 'https://server/gone.jpg', updatedAt: 8 }), 'me'));
  failDownload = false;

  const pruned = await durableLook({ ...plain, tryOnHistory: [{ imageUri: link }, { imageUri: 'data:image/png;base64,QUJD' }, { imageUri: kept }] }, 'me');
  assert.deepEqual(pruned.tryOnHistory.map(frame => frame.imageUri), [kept]);

  // --- a restart ----------------------------------------------------------
  const restored = decodeGenerated(JSON.parse(JSON.stringify(addLook([], await durableLook(lookFromJob(job), 'me')))));
  assert.equal(restored[0].tryOnImageUri, kept);
  assert.equal(restored[0].tryOnHistory[0].imageUri, kept);
  assert.deepEqual(restored[0].itemIds, ['b', 'a']);
  assert.equal(isLookSaved(restored, lookFromJob(job)), true);
  assert.equal(reanchorTryOnUri('file:///var/app-old/Documents/try-ons/me/j1.jpg'), kept);

  // --- the wiring ---------------------------------------------------------
  const read = file => fs.readFileSync(path.join(src, file), 'utf8');
  for (const file of ['components/GenerationStage.tsx', 'components/GenerationHistory.tsx', 'components/FittingRoom.tsx', 'components/AiTryOnPreview.tsx', 'components/DailyLookHero.tsx', 'screens/RecommendationsScreen.tsx', 'components/onboarding/FirstLook.tsx']) {
    assert.match(read(file), /<SaveLookButton/, `${file} has the button`);
  }
  // The window is drawn by the root outlet, above the provider in the tree: without the hand-over the button would throw.
  assert.match(read('components/GenerationDock.tsx'), /<FavoritesProvider value=\{favorites\}><GenerationStage/);
  // The photo only zooms: no saving in that window, and a thumbnail doesn't open it.
  const room = read('components/FittingRoom.tsx');
  const zoom = room.slice(room.indexOf('<Modal transparent'), room.indexOf('</Modal>'));
  assert.ok(zoom.includes('ZoomableImage') && !/save|Сохран/i.test(zoom));
  console.log('favorites ok');
};
run().catch(error => { console.error(error); process.exit(1); });
