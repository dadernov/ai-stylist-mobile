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
  downloadAsync: async (uri, target) => { if (failDownload) return { status: 404 }; files.set(target, `download-of:${uri}`); return { status: 200, uri: target }; }
};
const asyncStorage = { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } };
const stubs = { 'expo-file-system/legacy': fileSystem, '@react-native-async-storage/async-storage': { default: asyncStorage }, './keyValueStorage': { default: asyncStorage } };
const load = Module._load;
Module._load = (request, parent, isMain) => (request in stubs ? stubs[request] : load(request, parent, isMain));

const src = path.join(__dirname, '../src');
const { addLook, isLookSaved, lookFromJob, lookWithResult, plainLook, removeFavorite, removeLook } = require(path.join(src, 'domain/favorites.ts'));
const { durableLook, keepTryOnImage, reanchorTryOnUri } = require(path.join(src, 'services/tryOnPhotos.ts'));
const { decodeGenerated } = require(path.join(src, 'services/accountStorage.ts'));

const favoritesDomain = require('../src/domain/favorites');
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
  assert.equal(removeLook(list, tried).length, 2, 'the one that joined the idea leaves it bare');
  assert.equal(removeLook(list, tried).find(look => look.id === 'idea').tryOnImageUri, undefined);

  // The same card tried again: no merge by id, its own favourite under an id of its own, and each goes alone.
  const card = lookWithResult(plainLook('card', 'К', ['z']), { imageUri: `${DOCS}try-ons/me/1.jpg`, updatedAt: 1 });
  const again = lookWithResult(card, { imageUri: `${DOCS}try-ons/me/2.jpg`, updatedAt: 2 });
  const updated = addLook(addLook([], card), again);
  assert.equal(updated.length, 2);
  assert.equal(new Set(updated.map(look => look.id)).size, 2, 'the list goes by id');
  assert.equal(updated.find(look => look.id === 'card').tryOnImageUri, card.tryOnImageUri);
  assert.equal(removeLook(updated, again).length, 1);
  assert.equal(isLookSaved(removeLook(updated, again), card), true);

  // Unsaving a try-on that joined a bare favourite gives the favourite back, with the idea's advice.
  const idea = { ...plainLook('advice', 'Идея', ['p', 'q']), makeup: 'Стрелки', hair: 'Пучок', tuckMode: 'tucked' };
  const triedIdea = lookFromJob({ id: 'j9', name: 'И', itemIds: ['q', 'p'], result: { id: 'j9', imageUri: `${DOCS}try-ons/me/j9.jpg`, updatedAt: 9, tuckMode: 'auto' } });
  const joinedList = addLook([idea], triedIdea);
  assert.equal(joinedList.length, 1);
  assert.equal(isLookSaved(joinedList, plainLook('other', 'x', ['p', 'q'])), true, 'the bare pieces stay saved, not doubled');
  const reverted = removeLook(joinedList, triedIdea);
  assert.equal(reverted.length, 1);
  assert.equal(reverted[0].id, 'advice');
  assert.equal(reverted[0].makeup, 'Стрелки');
  assert.equal(reverted[0].tuckMode, 'tucked');
  assert.equal(reverted[0].tryOnImageUri, undefined);
  assert.equal(reverted[0].tryOnHistory, undefined);
  assert.equal(reverted[0].joined, undefined);
  assert.equal(isLookSaved(reverted, triedIdea), false);
  // A second try-on doesn't join what is already joined, and unsaving it leaves the first.
  const triedTwice = lookFromJob({ id: 'j10', name: 'И', itemIds: ['p', 'q'], result: { id: 'j10', imageUri: `${DOCS}try-ons/me/j10.jpg`, updatedAt: 10 } });
  const both = addLook(joinedList, triedTwice);
  assert.equal(both.length, 2);
  assert.equal(removeLook(both, triedTwice)[0].tryOnImageUri, triedIdea.tryOnImageUri);
  // The mark outlives a restart.
  assert.equal(removeLook(decodeGenerated(JSON.parse(JSON.stringify(joinedList))), triedIdea)[0].makeup, 'Стрелки');

  // A frame merely in a favourite's history: not saved, unsaving it touches nothing, saving it is a favourite of its own.
  const framed = { ...card, tryOnHistory: [{ id: 'old', imageUri: `${DOCS}try-ons/me/old.jpg`, updatedAt: 0 }] };
  const frame = lookWithResult(plainLook('card', 'n', ['z']), { imageUri: `${DOCS}try-ons/me/old.jpg`, updatedAt: 0 });
  assert.equal(isLookSaved([framed], frame), false);
  assert.deepEqual(removeLook([framed], frame), [framed]);
  const withFrame = addLook([framed], frame);
  assert.equal(withFrame.length, 2);
  assert.equal(new Set(withFrame.map(look => look.id)).size, 2);
  assert.equal(withFrame.find(look => look.id === 'card').tryOnImageUri, card.tryOnImageUri, 'the other stays as it was');
  assert.equal(isLookSaved(withFrame, frame), true);
  assert.equal(removeLook(withFrame, frame).length, 1, 'and goes alone');
  assert.equal(removeLook(withFrame, frame)[0], framed);
  // The picture known by where it came from is still its current picture.
  const fromSource = { ...card, tryOnSourceUri: 'https://server/1.jpg' };
  assert.deepEqual(removeLook([fromSource], { ...card, tryOnImageUri: 'https://server/1.jpg' }), []);

  // A bare look over a favourite with a picture: reads saved, the heart destroys nothing and hands back the same list.
  const bareIdea = plainLook('other', 'x', ['p', 'q']);
  assert.equal(isLookSaved(joinedList, bareIdea), true);
  assert.equal(removeLook(joinedList, bareIdea), joinedList, 'joined, by the same pieces');
  assert.equal(removeLook(joinedList, plainLook('advice', 'x', ['p', 'q'])), joinedList, 'joined, by id');
  assert.equal(addLook(joinedList, bareIdea), joinedList, 'not doubled either');
  const tried1 = addLook([], card);
  const bareCard = plainLook('card', 'К', ['z']);
  assert.equal(isLookSaved(tried1, bareCard), true, 'not joined, by id');
  assert.equal(removeLook(tried1, bareCard), tried1);
  // Only the bare record goes when a bare look has both beside it.
  const beside = [plainLook('b', 'b', ['u']), lookWithResult(plainLook('c', 'c', ['u']), { imageUri: `${DOCS}try-ons/me/c.jpg`, updatedAt: 1 })];
  assert.deepEqual(removeLook(beside, plainLook('n', 'n', ['u'])).map(look => look.id), ['c']);

  // «Удалить» and the heart on the favourites screen do the same thing.
  assert.deepEqual(removeFavorite(joinedList, 'advice'), removeLook(joinedList, triedIdea));
  assert.equal(removeFavorite(joinedList, 'advice')[0].makeup, 'Стрелки');
  assert.deepEqual(removeFavorite(tried1, 'card'), []);
  assert.equal(removeFavorite(joinedList, 'nope').length, 1);

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
  const tempLook = lookWithResult(plain, { imageUri: 'file:///var/Caches/x.jpg', updatedAt: 11 });
  assert.equal((await durableLook(tempLook, 'me')).tryOnSourceUri, 'file:///var/Caches/x.jpg', 'where it came from is always written');
  assert.equal(isLookSaved(addLook([], await durableLook(tempLook, 'me')), tempLook), true);
  assert.equal((await durableLook(lookWithResult(plain, { imageUri: 'data:image/png;base64,QUJD', updatedAt: 12 }), 'me')).tryOnSourceUri, undefined, 'never megabytes in the record');

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
  for (const file of ['components/GenerationStage.tsx', 'components/GenerationHistory.tsx', 'components/FittingRoom.tsx', 'screens/FavoritesScreen.tsx']) {
    assert.match(read(file), /<ResultActions/, `${file} has the three buttons`);
  }
  for (const file of ['components/GenerationHistory.tsx', 'components/GenerationStage.tsx', 'components/DailyLookHero.tsx', 'screens/RecommendationsScreen.tsx', 'components/onboarding/FirstLook.tsx']) {
    assert.match(read(file), /<SaveLookButton/, `${file} has the button`);
  }
  // The window is drawn by the root outlet, above the provider in the tree: without the hand-over the button would throw.
  assert.match(read('components/GenerationDock.tsx'), /<FavoritesProvider value=\{favorites\}><GenerationStage/);
  // A look without a try-on can be saved on its card; on the favourites screen the heart asks first, and trash and heart agree.
  assert.match(read('components/GenerationStage.tsx'), /<SaveLookButton look=\{setup\.look\}/);
  assert.match(read('screens/FavoritesScreen.tsx'), /<ResultActions[^>]*onUnsave=\{onRemove\}/);
  assert.match(fs.readFileSync(path.join(src, '../App.tsx'), 'utf8'), /removeFavorite\(prev, id\)/);
  // The burst on a double tap waits for the save; a gallery error is said in the user's language.
  assert.match(read('components/GenerationStage.tsx'), /save\.save\(\)\.then\(added => \{ if \(added\) bloom\(\)/);
  assert.match(read('components/ResultKit.tsx'), /message: t\(error\?\.message \|\|/);
  // The photo only zooms: no saving in that window, and a thumbnail doesn't open it.
  const kit = read('components/ResultKit.tsx');
  const zoom = kit.slice(kit.indexOf('<Modal transparent'), kit.indexOf('</Modal>'));
  assert.ok(zoom.includes('ZoomableImage') && !/save|Сохран/i.test(zoom));
  // Old links: expired ones leave the look without a try-on, its name and pieces kept; fresh ones become files; a failed download waits.
  const day = 24 * 60 * 60 * 1000, now = 10 * day;
  const old = { id: 'o', title: 'Старый', itemIds: ['a'], tryOnImageUri: 'https://x/o.jpg', tryOnUpdatedAt: now - 2 * day };
  const fresh = { id: 'f', title: 'Свежий', itemIds: ['b'], tryOnImageUri: 'https://x/f.jpg', tryOnUpdatedAt: now - 1000 };
  const [gone, fileNow] = await favoritesDomain.settleTryOnLinks([old, fresh], now, async () => 'file:///kept.jpg');
  assert.equal(gone.tryOnImageUri, undefined); assert.equal(gone.title, 'Старый'); assert.deepEqual(gone.itemIds, ['a']);
  assert.equal(fileNow.tryOnImageUri, 'file:///kept.jpg');
  const [waiting] = await favoritesDomain.settleTryOnLinks([fresh], now, async () => { throw new Error('offline'); });
  assert.equal(waiting.tryOnImageUri, fresh.tryOnImageUri);
  const local = [{ id: 'l', title: 'Файл', itemIds: ['c'], tryOnImageUri: 'file:///l.jpg' }];
  assert.equal(await favoritesDomain.settleTryOnLinks(local, now, async () => ''), local);
  console.log('favorites ok');
};
run().catch(error => { console.error(error); process.exit(1); });
