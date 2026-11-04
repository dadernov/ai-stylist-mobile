// «Образы» join «Избранное»: nothing lost or doubled, whatever breaks midway, and the old list stays until the move is proven.
// Then the two ways to a try-on: nothing paid starts before the setup step's own button.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);

const store = new Map();
let breakOn = null;
const trip = (op, key) => { if (breakOn && breakOn(op, key)) throw new Error(`broken ${op} ${key}`); };
const asyncStorage = {
  getItem: async key => { trip('get', key); return store.has(key) ? store.get(key) : null; },
  setItem: async (key, value) => { trip('set', key); store.set(key, value); },
  removeItem: async key => { trip('remove', key); store.delete(key); },
  multiGet: async keys => keys.map(key => [key, store.get(key) ?? null])
};
const stubs = {
  '@react-native-async-storage/async-storage': { default: asyncStorage }, './keyValueStorage': { default: asyncStorage },
  './photos': { reanchorPhoto: uri => uri, removeUnusedPhotos: async () => {} }
};
const load = Module._load;
Module._load = (request, parent, isMain) => (request in stubs ? stubs[request] : load(request, parent, isMain));
const src = path.join(__dirname, '../src');
const { loadAccountData, migrateSavedLooks } = require(path.join(src, 'services/accountStorage.ts'));
const { mergeSavedLooks, editFavorite, removeFavorite, addLook, plainLook } = require(path.join(src, 'domain/favorites.ts'));
const warn = console.warn; console.warn = () => {};

const key = name => `account:me:${name}`;
const picture = name => `file:///Documents/try-ons/me/${name}.jpg`;
const bare = { id: 's1', name: 'Мой образ', itemIds: ['a', 'b'], createdAt: 10 };
const tried = { id: 's2', name: 'Вечер', itemIds: ['c'], createdAt: 20, tryOnImageUri: picture('p2'), tryOnUpdatedAt: 21, tuckMode: 'tucked', tryOnHistory: [{ id: 'o', imageUri: picture('old'), updatedAt: 5 }] };
const reset = (saved, favorites = []) => { breakOn = null; store.clear(); store.set(key('savedLooks'), JSON.stringify(saved)); store.set(key('favoriteLooks'), JSON.stringify(favorites)); };
const launch = async () => { const data = await loadAccountData('me'); return { data, moved: await migrateSavedLooks('me', data) }; };
const stored = name => JSON.parse(store.get(key(name)));
const test = async (name, body) => { await body(); console.log(`PASS: ${name}`); };

(async () => {
  await test('every look moves with its name, picture and frames; the old list goes only after', async () => {
    reset([bare, tried], [plainLook('f', 'Идея', ['x'])]);
    const { moved } = await launch();
    assert.equal(moved.pending, 0);
    assert.deepEqual(moved.favorites.map(look => look.title), ['Идея', 'Мой образ', 'Вечер']);
    const evening = moved.favorites[2];
    assert.equal(evening.tryOnImageUri, tried.tryOnImageUri);
    assert.equal(evening.tuckMode, 'tucked');
    assert.equal(evening.tryOnHistory[0].imageUri, picture('old'));
    assert.deepEqual(stored('favoriteLooks').map(look => look.id), moved.favorites.map(look => look.id));
    assert.equal(store.has(key('savedLooks')), false);
  });

  await test('running again changes nothing, and a look deleted since does not come back', async () => {
    reset([bare]);
    await launch();
    store.set(key('favoriteLooks'), '[]');
    store.set(key('savedLooks'), JSON.stringify([bare])); // its removal had failed
    const { moved } = await launch();
    assert.deepEqual(moved.favorites, []);
    assert.equal(store.has(key('savedLooks')), false);
    const once = mergeSavedLooks([], [bare, tried]);
    assert.equal(mergeSavedLooks(once, [bare, tried]), once, 'the same array: nothing to write');
  });

  for (const [where, at] of [['writing the favourites', (op, k) => op === 'set' && k === key('favoriteLooks')], ['writing the mark', (op, k) => op === 'set' && k.endsWith('savedLooksMerged')], ['removing the old list', (op, k) => op === 'remove' && k === key('savedLooks')]]) {
    await test(`a crash while ${where} loses and doubles nothing`, async () => {
      reset([bare, tried]);
      breakOn = at;
      await launch();
      if (!where.startsWith('removing')) assert.ok(store.has(key('savedLooks')), 'the old list is still there');
      breakOn = null;
      const { moved } = await launch();
      assert.equal(moved.pending, 0);
      assert.deepEqual(moved.favorites.map(look => look.title).sort(), ['Вечер', 'Мой образ']);
      assert.equal(store.has(key('savedLooks')), false);
    });
  }

  await test('a write that does not read back keeps the old list and says so', async () => {
    reset([bare]);
    const setItem = asyncStorage.setItem;
    asyncStorage.setItem = async (k, value) => setItem(k, k === key('favoriteLooks') ? '[]' : value);
    const { moved } = await launch();
    asyncStorage.setItem = setItem;
    assert.equal(moved.pending, 1);
    assert.deepEqual(moved.favorites, []);
    assert.ok(store.has(key('savedLooks')));
  });

  await test('an unreadable list on either side moves nothing and touches neither', async () => {
    store.clear();
    store.set(key('savedLooks'), '{broken');
    store.set(key('favoriteLooks'), JSON.stringify([plainLook('f', 'Идея', ['x'])]));
    await launch();
    assert.equal(store.get(key('savedLooks')), '{broken');
    assert.equal(stored('favoriteLooks').length, 1);
    reset([bare]);
    store.set(key('favoriteLooks'), '[{"id":1}]');
    const { moved } = await launch();
    assert.equal(moved.pending, 1);
    assert.equal(store.get(key('favoriteLooks')), '[{"id":1}]');
    assert.ok(store.has(key('savedLooks')));
    assert.equal(store.has(key('savedLooksMerged')), false);
  });

  await test('the same look in both lists is one, under the name it was given', () => {
    const favorite = { ...plainLook('job-1', 'Футболка', ['c']), tryOnImageUri: 'file:///OLD/Documents/try-ons/me/p2.jpg' };
    const merged = mergeSavedLooks([favorite], [tried]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, 'Вечер');
    assert.equal(merged[0].tryOnHistory[0].imageUri, picture('old'));
    const named = mergeSavedLooks([plainLook('idea', 'Идея', ['b', 'a'])], [bare]);
    assert.deepEqual(named.map(look => look.title), ['Мой образ']);
    // A picture of its own beside the same pieces is a favourite of its own: neither name nor picture is lost.
    assert.equal(mergeSavedLooks([plainLook('idea', 'Идея', ['c'])], [tried]).length, 2);
    // Same pieces twice in the old list, both bare: one look.
    assert.equal(mergeSavedLooks([], [bare, { ...bare, id: 's3', name: 'Копия' }]).length, 1);
  });

  await test('editing: a name keeps the try-on; new pieces drop it, its advice and its identity', () => {
    const look = { ...plainLook('saved-s2', 'Вечер', ['c']), tryOnImageUri: picture('p2'), tryOnSourceUri: 'https://x/p2.jpg', tryOnUpdatedAt: 21, tryOnHistory: [{ id: 'o', imageUri: picture('old'), updatedAt: 5 }], fitReasons: ['r'], why: 'w', tuckMode: 'tucked' };
    const renamed = editFavorite([look], look.id, { title: 'Ночь', itemIds: ['c'], newId: look.id })[0];
    assert.equal(renamed.title, 'Ночь');
    assert.equal(renamed.tryOnImageUri, look.tryOnImageUri);
    const changed = editFavorite([look], look.id, { title: 'Вечер', itemIds: ['d'], newId: 'edited-1' })[0];
    assert.equal(changed.id, 'edited-1');
    assert.deepEqual(changed.itemIds, ['d']);
    for (const field of ['tryOnImageUri', 'tryOnSourceUri', 'tryOnUpdatedAt', 'tryOnHistory', 'fitReasons', 'why', 'tuckMode', 'joined']) assert.equal(changed[field], undefined, field);
    // A try-on that joined a bare favourite: after an edit the look is simply bare, and removing it removes it.
    const joined = addLook([plainLook('b', 'Б', ['c'])], { ...plainLook('j', 'Ж', ['c']), tryOnImageUri: picture('p') })[0];
    const edited = editFavorite([joined], joined.id, { title: 'Б', itemIds: ['d'], newId: 'e' });
    assert.deepEqual(removeFavorite(edited, 'e'), []);
  });

  const read = file => fs.readFileSync(path.join(src, file), 'utf8');
  await test('a paid try-on starts only from the setup step\'s button', () => {
    const callers = [];
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name) && /store\.start\(|\.start\(\{ modelUri/.test(fs.readFileSync(full, 'utf8'))) callers.push(path.relative(src, full));
    });
    walk(src);
    assert.deepEqual(callers.sort(), ['components/GenerationDock.tsx', 'components/onboarding/FirstLook.tsx']);
    const dock = read('components/GenerationDock.tsx');
    assert.equal((dock.match(/store\.start\(/g) || []).length, 1);
    assert.match(dock, /onGenerate: \(\) => \{ void generate\(\); \}/);
    assert.match(dock.split('const generate = async')[1], /aiConsent\.ensure\(\)/);
    assert.ok(!/store\.start|generate\(\)/.test(dock.split('const prepare = useCallback')[1].split('const viewed')[0]), 'opening the setup step sends nothing');
    assert.match(read('components/GenerationStage.tsx'), /disabled=\{!setup\.canGenerate\} onPress=\{setup\.onGenerate\}/);
    assert.ok(!/store\.start/.test(read('components/FittingRoom.tsx')));
  });

  await test('the old surfaces are gone and every route to a result is the shared one', () => {
    for (const gone of ['components/AiTryOnPreview.tsx', 'screens/OutfitBuilderScreen.tsx', 'components/LookPreview.tsx']) assert.ok(!fs.existsSync(path.join(src, gone)), gone);
    const room = read('components/FittingRoom.tsx');
    assert.ok(!/FittingSession|Bookmark|onSave/.test(room));
    assert.match(room, /Недавние примерки/);
    assert.match(room, /onOpenHistory/);
    const app = fs.readFileSync(path.join(src, '../App.tsx'), 'utf8');
    assert.ok(!/setSavedLooks|savedLooks/.test(app), 'nothing writes the old list again');
    assert.match(read('screens/RecommendationsScreen.tsx'), /buildLooks\(/, 'the rule-based looks stay the offline fallback');
    assert.match(read('screens/RecommendationsScreen.tsx'), /Погода рядом с тобой/);
    assert.match(read('screens/FavoritesScreen.tsx'), /<LookEditor/);
    assert.match(read('components/GenerationStage.tsx'), /<TextInput[^\n]*Название образа/);
  });
  console.warn = warn;
  console.log('Saved looks migration tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
