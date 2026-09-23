const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);

const values = new Map();
const disk = new Map();
const storage = {
  getItem: async key => values.get(key) ?? null,
  setItem: async (key, value) => { values.set(key, value); },
  removeItem: async key => { values.delete(key); },
  multiGet: async keys => keys.map(key => [key, values.get(key) ?? null])
};
const files = {
  documentDirectory: '/docs/', EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (file, content) => { disk.set(file, content); },
  copyAsync: async ({ from, to }) => { disk.set(to, disk.get(from)); },
  getInfoAsync: async file => ({ exists: disk.has(file) }),
  readDirectoryAsync: async dir => [...disk.keys()].filter(f => f.startsWith(dir)).map(f => f.slice(dir.length)),
  deleteAsync: async file => { disk.delete(file); }
};
let submit, poll;
const stubs = {
  '@react-native-async-storage/async-storage': { default: storage },
  'react-native': { Platform: { OS: 'ios' } },
  'expo-file-system/legacy': files,
  'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, randomUUID: crypto.randomUUID,
    digestStringAsync: async (algorithm, value) => crypto.createHash(algorithm).update(value).digest('hex') }
};
const originalLoad = Module._load;
Module._load = (request, parent, main) => {
  if (request === './ai' && parent.filename.endsWith('tryOnJobs.ts')) return {
    analyzeTryOnGenerateLook: (...args) => submit(...args), getTryOnJob: (...args) => poll(...args)
  };
  return request in stubs ? stubs[request] : originalLoad(request, parent, main);
};
const service = name => require(path.join(__dirname, '../src/services', `${name}.ts`));
const { accountKey, prepareAccountStorage, startWithoutLegacy, loadAccountData } = service('accountStorage');
const { saveJson } = service('storage');
const { removeUnusedPhotos, persistPhoto, reanchorPhoto } = service('photos');
const { signIn, signOut, readStoredSession, forgetStoredSession, verifySession } = service('auth');
const { fetchJson, ApiError } = service('http');
const { TryOnJobStore, tryOnContext } = service('tryOnJobs');
const alice = { login: 'alice', token: 'session-alice', displayName: 'Alice' };
const bob = { login: 'bobby', token: 'session-bob', displayName: 'Bob' };
const item = { id: 'coat', name: 'Coat', category: 'Плащ', section: 'Верхняя одежда', imageUri: 'data:image/png;base64,AAAA', color: 'Чёрный', season: 'Осень', tags: [] };
const response = { outputUrl: 'data:image/png;base64,AAAA', updatedAt: 123456789 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
let passed = 0;
const test = async (name, callback) => { values.clear(); disk.clear(); await callback(); passed++; console.log(`PASS: ${name}`); };

async function run() {
  await test('legacy migration requires a claim and never leaks to another account', async () => {
    values.set('wardrobeItems', JSON.stringify([item]));
    values.set('profileState', JSON.stringify({ displayName: 'Alice', gender: 'male', modelUri: '/docs/photos/alice.jpg' }));
    assert.equal(await prepareAccountStorage('alice'), 'claim');
    assert.equal(values.has(accountKey('alice', 'wardrobeItems')), false);
    assert.equal(await prepareAccountStorage('alice', true), 'ready');
    assert.equal(await prepareAccountStorage('bobby', true), 'ready');
    assert.equal((await loadAccountData('bobby')).items.length, 0);
    assert.equal((await loadAccountData('alice')).items[0].id, 'coat');
    assert.equal((await loadAccountData('alice')).profile.gender, 'male');
    assert.equal(values.get('wardrobeItems'), JSON.stringify([item]), 'keep recovery originals');
  });
  await test('declining legacy import preserves the collection for its owner', async () => {
    values.set('wardrobeItems', JSON.stringify([item]));
    await startWithoutLegacy('bobby');
    assert.equal(await prepareAccountStorage('bobby'), 'ready');
    assert.equal(await prepareAccountStorage('alice'), 'claim');
    await prepareAccountStorage('alice', true);
    assert.equal((await loadAccountData('alice')).items.length, 1);
    assert.equal((await loadAccountData('bobby')).items.length, 0);
  });
  await test('semantic corruption is isolated and never treated as an empty collection', async () => {
    values.set(accountKey('alice', 'wardrobeItems'), '[null]');
    values.set(accountKey('alice', 'profileState'), '{"gender": []}');
    values.set(accountKey('alice', 'favoriteLooks'), '[{"id":"f","title":"Keep","itemIds":["coat"]}]');
    const data = await loadAccountData('alice');
    assert.deepEqual([...data.failed].sort(), ['profileState', 'wardrobeItems']);
    assert.equal(data.favorites[0].title, 'Keep');
    assert.equal(values.get(accountKey('alice', 'wardrobeItems')), '[null]');
  });
  await test('photo collection only deletes within the current account', async () => {
    disk.set('/docs/photos/bobby/keep.jpg', 'b');
    disk.set('/docs/photos/alice/old.jpg', 'a');
    disk.set('/docs/photos/legacy.jpg', 'legacy');
    await removeUnusedPhotos([], 'alice');
    assert.equal(disk.has('/docs/photos/alice/old.jpg'), false);
    assert.equal(disk.has('/docs/photos/bobby/keep.jpg'), true);
    assert.equal(disk.has('/docs/photos/legacy.jpg'), true);
    const copied = await persistPhoto('/docs/photos/legacy.jpg', 'alice');
    assert.ok(copied.startsWith('/docs/photos/alice/'));
    assert.equal(reanchorPhoto('/old/photos/alice/x.jpg'), '/docs/photos/alice/x.jpg');
    assert.equal(reanchorPhoto('/old/photos/../secret'), undefined);
  });
  await test('a delayed old logout cannot erase a new login or profile', async () => {
    const logout = deferred();
    values.set('authSession', JSON.stringify(alice));
    values.set(accountKey('alice', 'profileState'), '{"gender":"male"}');
    global.fetch = async url => url.endsWith('/logout') ? logout.promise : new Response(JSON.stringify(bob));
    await signOut(alice);
    assert.equal(await readStoredSession(), null);
    await signIn('bobby', 'password');
    logout.resolve(new Response('{}'));
    await settle();
    await forgetStoredSession(alice);
    assert.equal((await readStoredSession()).token, bob.token);
    assert.equal(values.get(accountKey('alice', 'profileState')), '{"gender":"male"}');
  });
  await test('auth verification only forgets an explicit 401', async () => {
    global.fetch = async () => new Response('{"detail":"busy"}', { status: 503 });
    assert.deepEqual(await verifySession(alice), alice);
    global.fetch = async () => new Response('{"detail":"expired"}', { status: 401 });
    assert.equal(await verifySession(alice), null);
  });
  await test('FastAPI detail and validation errors reach the client', async () => {
    global.fetch = async () => new Response('{"detail":"Daily limit"}', { status: 429 });
    await assert.rejects(() => fetchJson('/api'), error => error instanceof ApiError && error.status === 429 && error.message === 'Daily limit');
    global.fetch = async () => new Response('{"detail":[{"msg":"Invalid image"}]}', { status: 422 });
    await assert.rejects(() => fetchJson('/api'), /Invalid image/);
  });
  await test('request timeout includes a stalled response body', async () => {
    global.fetch = async (_url, options) => ({ ok: true, status: 200, text: () => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    await assert.rejects(() => fetchJson('/api', {}, 10), /долго|время|ответ/i);
  });
  await test('try-on context changes with photos and preserves slot identity', async () => {
    assert.equal(await tryOnContext('person', [item]), await tryOnContext('person', [item]));
    assert.notEqual(await tryOnContext('person', [item]), await tryOnContext('new-person', [item]));
    assert.notEqual(await tryOnContext('person', [item]), await tryOnContext('person', [{ ...item, section: 'Низ' }]));
  });
  await test('in-flight generation survives screen/account unmount and charges one request', async () => {
    const pending = deferred();
    let calls = 0;
    submit = async (...args) => { calls++; assert.equal(args.at(-1).login, 'alice'); return pending.promise; };
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    const input = { modelUri: 'person', items: [item], context: 'context', tuckMode: 'auto' };
    const first = store.start(input);
    await settle();
    await store.start(input);
    store.deactivate();
    pending.resolve(response);
    await first;
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().jobs[0].status, 'succeeded');
    assert.equal(values.has(accountKey('bobby', 'tryOnJobs')), false);
    assert.equal(JSON.parse(values.get(accountKey('alice', 'tryOnJobs')))[0].status, 'succeeded');
  });
  await test('reload resumes a persisted pending job without resubmitting', async () => {
    const job = { id: crypto.randomUUID(), context: 'ctx', itemIds: ['coat'], name: 'Coat', createdAt: 1, status: 'pending', tuckMode: 'auto' };
    await saveJson(accountKey('alice', 'tryOnJobs'), [job]);
    submit = () => assert.fail('must not resubmit');
    poll = async (id, owner) => { assert.equal(id, job.id); assert.equal(owner.login, 'alice'); return response; };
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    for (let i = 0; i < 10 && store.getSnapshot().jobs[0].status !== 'succeeded'; i++) await settle();
    assert.equal(store.getSnapshot().jobs[0].status, 'succeeded');
    store.deactivate();
  });
  await test('reload recovers a repaired failed job with one GET, preserving its ID and garments', async () => {
    const job = { id: crypto.randomUUID(), context: 'ctx', itemIds: ['coat'], garments: [{ id: 'coat', name: 'Original coat' }],
      name: 'Coat', createdAt: Date.now(), status: 'failed', error: 'Rejected result', tuckMode: 'untucked' };
    await saveJson(accountKey('alice', 'tryOnJobs'), [job]);
    submit = () => assert.fail('must not submit paid work');
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, method: options.method || 'GET' });
      assert.equal(options.headers['X-Session-Token'], alice.token);
      return new Response(JSON.stringify({ ...response, status: 'succeeded', jobId: job.id }));
    };
    poll = service('ai').getTryOnJob;
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    await settle();
    const recovered = store.getSnapshot().jobs[0];
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.id, job.id);
    assert.equal(recovered.result.id, job.id);
    assert.equal(recovered.result.tuckMode, 'untucked');
    assert.equal(recovered.error, undefined);
    assert.deepEqual(recovered.garments, job.garments);
    assert.deepEqual(recovered.itemIds, job.itemIds);
    assert.equal(recovered.createdAt, job.createdAt);
    assert.deepEqual(requests.map(request => request.method), ['GET']);
    assert.ok(requests[0].url.endsWith('/tryon-jobs/' + job.id));
    assert.equal(JSON.parse(values.get(accountKey('alice', 'tryOnJobs')))[0].status, 'succeeded');
    store.deactivate();
  });
  await test('failed reconciliation leaves actual failures, expired jobs and network errors unchanged', async () => {
    const jobs = ['rejected', 'expired', 'offline'].map(id => ({ id, context: 'ctx', itemIds: ['coat'], name: 'Coat',
      createdAt: Date.now(), status: 'failed', error: `Original ${id}`, tuckMode: 'auto' }));
    await saveJson(accountKey('alice', 'tryOnJobs'), jobs);
    submit = () => assert.fail('must not submit paid work');
    const calls = [];
    poll = async id => { calls.push(id); throw id === 'offline' ? new Error('Offline') : new ApiError('Still failed', id === 'expired' ? 404 : 200); };
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    await settle();
    assert.equal(calls.length, 3);
    assert.deepEqual(store.getSnapshot().jobs, jobs);
    assert.deepEqual(JSON.parse(values.get(accountKey('alice', 'tryOnJobs'))), jobs);
    store.deactivate();
    await store.activate(alice);
    await settle();
    assert.equal(calls.length, 3, 'a failed check is not an automatic retry loop');
    store.deactivate();
  });
  await test('failed reconciliation checks only the latest three jobs within 24 hours', async () => {
    const now = Date.now();
    const jobs = [now - 5000, now - 4000, now - 3000, now - 2000, now - 1000, now - 25 * 60 * 60 * 1000, now + 60000]
      .map((createdAt, index) => ({ id: `failed-${index}`, context: 'ctx', itemIds: [], name: 'Look', createdAt, status: 'failed', tuckMode: 'auto' }));
    await saveJson(accountKey('alice', 'tryOnJobs'), jobs);
    submit = () => assert.fail('must not submit paid work');
    const calls = [];
    poll = async id => { calls.push(id); return { status: 'pending' }; };
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    await settle();
    assert.deepEqual(calls, ['failed-4', 'failed-3', 'failed-2']);
    assert.deepEqual(store.getSnapshot().jobs, jobs, 'an unfinished server repair does not start normal polling');
    store.deactivate();
  });
  await test('regenerate gets a new ID; a rejected protected result is not displayed', async () => {
    const ids = [];
    submit = async (...args) => { ids.push(args.at(-2)); return response; };
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    const input = { modelUri: 'person', items: [item], context: 'ctx', tuckMode: 'auto' };
    await store.start(input); await store.start(input);
    assert.notEqual(ids[0], ids[1]);
    submit = async () => { throw new ApiError('Protected result rejected', 200); };
    await store.start(input);
    assert.equal(store.getSnapshot().jobs[0].status, 'failed');
    assert.equal(store.getSnapshot().jobs[0].result, undefined);
    store.deactivate();
  });
  await test('corrupt job history is preserved and blocks paid work', async () => {
    values.set(accountKey('alice', 'tryOnJobs'), '[null]');
    submit = () => assert.fail('must not submit');
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    await assert.rejects(() => store.start({ modelUri: 'x', items: [item], context: 'x', tuckMode: 'auto' }));
    assert.equal(values.get(accountKey('alice', 'tryOnJobs')), '[null]');
    store.deactivate();
  });
  await test('completed job without a result is rejected as malformed', async () => {
    const job = { id: 'job', context: 'ctx', itemIds: [], name: 'Look', createdAt: 1, tuckMode: 'auto', status: 'succeeded' };
    values.set(accountKey('alice', 'tryOnJobs'), JSON.stringify([job]));
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    assert.equal(store.getSnapshot().readOnly, true);
    store.deactivate();
  });
  await test('history imports every legacy frame once, including unsaved current variants', async () => {
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    const frame = { id: 'old-frame', imageUri: 'data:image/png;base64,OLD', updatedAt: 100 };
    const look = { id: 'saved', name: 'Old outfit', itemIds: [item.id], createdAt: 50, tryOnImageUri: 'data:image/png;base64,NEW', tryOnUpdatedAt: 200, tryOnHistory: [frame] };
    await store.importLooks([look, { ...look, id: 'favorite', title: 'Duplicate' }], [item]);
    await store.importLooks([look], [item]);
    assert.equal(store.getSnapshot().jobs.length, 2);
    assert.deepEqual(store.getSnapshot().jobs.map(j => j.createdAt), [200, 100]);
    assert.deepEqual(store.getSnapshot().jobs[0].garments, [{ id: item.id, name: item.name }]);
    const reloaded = new TryOnJobStore(alice);
    await reloaded.activate(alice);
    assert.equal(reloaded.getSnapshot().jobs.length, 2);
    await reloaded.importLooks([look], []);
    assert.equal(reloaded.getSnapshot().jobs.length, 2, 'deleting a garment must not duplicate old results');
    const other = new TryOnJobStore(bob);
    await other.activate(bob);
    assert.equal(other.getSnapshot().jobs.length, 0);
    store.deactivate(); reloaded.deactivate(); other.deactivate();
  });
  await test('history retains more than 80 generations and garment snapshots after rename/delete', async () => {
    const old = Array.from({ length: 85 }, (_, i) => ({ id: `old-${i}`, context: 'ctx', itemIds: ['coat'], name: 'Old', createdAt: i,
      tuckMode: 'auto', status: 'succeeded', result: { id: `old-${i}`, imageUri: `data:image/png;base64,${i}`, updatedAt: i } }));
    await saveJson(accountKey('alice', 'tryOnJobs'), old);
    submit = async () => response;
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    const garment = { ...item };
    await store.start({ modelUri: 'person', items: [garment], context: 'new', tuckMode: 'auto' });
    garment.name = 'Renamed';
    assert.equal(store.getSnapshot().jobs.length, 86);
    assert.deepEqual(store.getSnapshot().jobs[0].garments, [{ id: item.id, name: 'Coat' }]);
    await store.importLooks([], []);
    assert.equal(JSON.parse(values.get(accountKey('alice', 'tryOnJobs'))).length, 86);
    store.deactivate();
  });
  await test('legacy import cannot overwrite an unreadable journal', async () => {
    values.set(accountKey('alice', 'tryOnJobs'), '[null]');
    const store = new TryOnJobStore(alice);
    await store.activate(alice);
    await store.importLooks([{ id: 'old', name: 'Old', itemIds: ['coat'], createdAt: 1, tryOnImageUri: response.outputUrl }], [item]);
    assert.equal(values.get(accountKey('alice', 'tryOnJobs')), '[null]');
    store.deactivate();
  });
  console.log(`PASS: ${passed} account, networking and durable job regressions`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
