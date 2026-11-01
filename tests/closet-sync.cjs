// The wardrobe mirrored on the server: two devices of one account against a
// fake closet server (ai-server/closet.py behind the same endpoints).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');

require.extensions['.ts'] = require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false, jsx: ts.JsxEmit.ReactJSX },
  fileName: filename
}).outputText, filename);

// Each device has its own storage and disk; `device` says which one runs.
const devices = { a: { values: new Map(), disk: new Map() }, b: { values: new Map(), disk: new Map() } };
let device = devices.a;
const storage = {
  getItem: async key => device.values.get(key) ?? null,
  setItem: async (key, value) => { device.values.set(key, value); },
  removeItem: async key => { device.values.delete(key); },
};
const server = { items: new Map(), profile: null, blobs: new Map(), clock: 1000, calls: [] };
const files = {
  documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  moveAsync: async ({ from, to }) => { device.disk.set(to, device.disk.get(from)); device.disk.delete(from); },
  downloadAsync: async (url, target) => {
    const blob = server.blobs.get(decodeURIComponent(url.split('/').pop()));
    if (!blob) return { status: 404, headers: {} };
    device.disk.set(target, blob.content);
    return { status: 200, uri: target, headers: { 'Content-Type': blob.mime } };
  },
};
const stubs = {
  '@react-native-async-storage/async-storage': { default: storage },
  'expo-secure-store': { getItemAsync: async () => JSON.stringify({ token: 't', login: 'alice', displayName: 'Alice' }), setItemAsync: async () => {}, deleteItemAsync: async () => {} },
  'react-native': { Platform: { OS: 'ios' } },
  'expo-file-system/legacy': files,
  'expo-file-system': { File: class File { constructor(uri) { this.uri = uri; } async arrayBuffer() { return Buffer.from(device.disk.get(this.uri) || ''); } } },
  'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg', PNG: 'png' }, ImageManipulator: { manipulate: () => ({
    resize() { return this; }, renderAsync: async () => ({ width: 800, height: 1200 }) }) } },
  'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, randomUUID: crypto.randomUUID,
    digestStringAsync: async (algorithm, value) => crypto.createHash(algorithm).update(value).digest('hex') },
};
const originalLoad = Module._load;
Module._load = (request, parent, main) => request in stubs ? stubs[request] : originalLoad(request, parent, main);

// The closet server: every write gets the server's own clock.
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url);
  const method = init.method || 'GET';
  server.calls.push(`${method} ${pathname}`);
  assert.equal(init.headers['X-Session-Token'], 't', 'every call carries the session');
  if (pathname === '/closet' && method === 'GET') {
    const since = Number(searchParams.get('since'));
    return json({ items: [...server.items.values()].filter(item => item.updated > since),
      profile: server.profile && server.profile.updated > since ? server.profile : null, now: server.clock });
  }
  if (pathname === '/closet/blobs' && method === 'POST') {
    const id = `blob${server.blobs.size + 1}`;
    server.blobs.set(id, { content: `photo ${id}`, mime: 'image/png' });
    return json({ id });
  }
  const item = pathname.match(/^\/closet\/items\/(.+)$/);
  if (item && method === 'PUT') {
    const updated = ++server.clock;
    server.items.set(item[1], { id: item[1], data: JSON.parse(init.body).data, updated, deleted: false });
    return json({ updated });
  }
  if (item && method === 'DELETE') {
    const updated = ++server.clock;
    server.items.set(item[1], { ...server.items.get(item[1]), updated, deleted: true });
    return json({ updated });
  }
  if (pathname === '/closet/profile' && method === 'PUT') {
    const updated = ++server.clock;
    server.profile = { data: JSON.parse(init.body).data, updated };
    return json({ updated });
  }
  return new Response('{"detail":"no"}', { status: 404 });
};

const { syncCloset } = require(path.join(__dirname, '../src/services/closetSync.ts'));
const session = { token: 't', login: 'alice', displayName: 'Alice' };
const dir = 'file:///docs/photos/alice/';
const tee = { id: '1727000000001', name: 'TEE', category: 'Футболка', section: 'Верх', color: 'Белый', season: 'Лето', pattern: 'Однотонный', tags: [],
  imageUri: `${dir}tee.png`, sourceImageUri: `${dir}tee.jpg` };
const jeans = { id: '1727000000002', name: 'JEANS', category: 'Джинсы', section: 'Низ', color: 'Синий', season: 'Круглый год', pattern: 'Однотонный', tags: [],
  imageUri: `${dir}jeans.png` };

const phone = (items, profile) => {
  const state = { items, profile };
  return { state, io: { items: () => state.items, applyItems: update => { state.items = update(state.items); },
    profile: () => state.profile, applyProfile: next => { state.profile = next; } } };
};

const ALLOWED = { canDelete: true, photos: async () => true };
const WITHHELD = { canDelete: true, photos: async () => false };
const blobPosts = () => server.calls.filter(call => call === 'POST /closet/blobs').length;

async function test(name, run) { await run(); console.log(`PASS: ${name}`); }

(async () => {
  device = devices.a;
  devices.a.disk.set(`${dir}tee.png`, 'tee cut-out'); devices.a.disk.set(`${dir}tee.jpg`, 'tee photo'); devices.a.disk.set(`${dir}jeans.png`, 'jeans');
  devices.a.disk.set(`${dir}me.jpg`, 'me');
  const a = phone([tee, jeans], { gender: 'female', beautyAdvice: true, modelUri: `${dir}me.jpg` });
  const b = phone([], {});

  await test('the first phone sends its wardrobe, the photos once each', async () => {
    await syncCloset(session, a.io, ALLOWED);
    assert.deepEqual([...server.items.keys()].sort(), [tee.id, jeans.id]);
    assert.equal(server.items.get(tee.id).data.imageUri, undefined, 'no path of the phone reaches the server');
    assert.ok(server.items.get(tee.id).data.imageBlob && server.items.get(tee.id).data.sourceBlob);
    assert.equal(server.blobs.size, 4, 'two tee photos, jeans and the try-on photo');
    assert.equal(server.profile.data.gender, 'female');
    server.calls.length = 0;
    await syncCloset(session, a.io, ALLOWED);
    assert.deepEqual(server.calls, ['GET /closet'], 'nothing changed, nothing is sent again');
  });

  await test('a second phone of the same account receives the wardrobe with its photos', async () => {
    device = devices.b;
    await syncCloset(session, b.io, ALLOWED);
    assert.deepEqual(b.state.items.map(item => item.name).sort(), ['JEANS', 'TEE']);
    const received = b.state.items.find(item => item.id === tee.id);
    assert.ok(received.imageUri.startsWith(dir) && received.imageUri.endsWith('.png'));
    assert.equal(devices.b.disk.get(received.imageUri), `photo ${server.items.get(tee.id).data.imageBlob}`);
    assert.equal(b.state.profile.gender, 'female');
    assert.ok(b.state.profile.modelUri.startsWith(dir));
    server.calls.length = 0;
    await syncCloset(session, b.io, ALLOWED);
    assert.deepEqual(server.calls, ['GET /closet'], 'what came from the server is not sent back');
  });

  await test('a change and a deletion on one phone reach the other', async () => {
    device = devices.a;
    a.state.items = [{ ...tee, name: 'TEE, white' }];
    await syncCloset(session, a.io, ALLOWED);
    assert.equal(server.items.get(jeans.id).deleted, true);
    device = devices.b;
    await syncCloset(session, b.io, ALLOWED);
    assert.deepEqual(b.state.items.map(item => item.name), ['TEE, white']);
  });

  await test('a change not sent yet wins over an older one from the server', async () => {
    device = devices.b;
    b.state.items = b.state.items.map(item => ({ ...item, color: 'Черный' }));
    device = devices.a;
    a.state.items = [{ ...tee, name: 'TEE, renamed on A' }];
    await syncCloset(session, a.io, ALLOWED);
    device = devices.b;
    await syncCloset(session, b.io, ALLOWED);
    assert.equal(b.state.items[0].color, 'Черный', 'the local edit is kept');
    assert.equal(server.items.get(tee.id).data.color, 'Черный', 'and sent');
  });

  // Without the consent: a fresh account on a third device, then the cases around another device and the server.
  await test('without consent no photo goes, the other fields do, and nothing is sent again', async () => {
    const login = { ...session, login: 'bob' }; const bobDir = 'file:///docs/photos/bob/';
    device = devices.c = { values: new Map(), disk: new Map() };
    const snapshotServer = [new Map(server.items), server.profile];
    server.items = new Map(); server.profile = null;
    const shirt = { ...tee, id: '1727000000050', name: 'SHIRT', imageUri: `${bobDir}shirt.png`, sourceImageUri: `${bobDir}shirt.jpg` };
    const c = phone([shirt], { gender: 'male', modelUri: `${bobDir}me.jpg`, avatarUri: `${bobDir}me.jpg` });
    server.calls.length = 0;
    await syncCloset(login, c.io, WITHHELD);
    assert.equal(blobPosts(), 0, 'no photo left the phone');
    const stored = server.items.get(shirt.id);
    assert.equal(stored.data.name, 'SHIRT');
    assert.equal(stored.data.imageBlob, undefined);
    assert.equal(server.profile.data.gender, 'male');
    assert.equal(server.profile.data.modelBlob, undefined);
    assert.equal(c.state.items[0].imageUri, shirt.imageUri, 'the photo stays on the phone');
    assert.equal(c.state.profile.modelUri, `${bobDir}me.jpg`);
    server.calls.length = 0;
    await syncCloset(login, c.io, WITHHELD);
    assert.deepEqual(server.calls, ['GET /closet'], 'a withheld photo does not make the item go out again and again');

    // A field edit still syncs.
    c.state.items = [{ ...c.state.items[0], name: 'SHIRT 2' }];
    await syncCloset(login, c.io, WITHHELD);
    assert.equal(server.items.get(shirt.id).data.name, 'SHIRT 2');
    assert.equal(c.state.items[0].imageUri, shirt.imageUri);

    // The consent given: the photos follow, once.
    device.disk.set(shirt.imageUri, 'cut'); device.disk.set(shirt.sourceImageUri, 'photo'); device.disk.set(`${bobDir}me.jpg`, 'me');
    server.calls.length = 0;
    await syncCloset(login, c.io, ALLOWED);
    assert.equal(blobPosts(), 4, 'cut-out, photo, try-on photo and avatar');
    assert.ok(server.items.get(shirt.id).data.imageBlob && server.items.get(shirt.id).data.sourceBlob);
    assert.ok(server.profile.data.modelBlob);
    assert.equal(c.state.items[0].imageUri, shirt.imageUri);
    server.calls.length = 0;
    await syncCloset(login, c.io, ALLOWED);
    assert.deepEqual(server.calls, ['GET /closet']);

    // Revoked: what is on the server stays referred to, a new photo stays home.
    const before = server.items.get(shirt.id).data;
    const beforeProfile = server.profile.data;
    const fresh = { ...tee, id: '1727000000051', name: 'NEW', imageUri: `${bobDir}new.png`, sourceImageUri: undefined };
    c.state.items = [fresh, { ...c.state.items[0], imageUri: `${bobDir}other.png` }];
    c.state.profile = { ...c.state.profile, modelUri: `${bobDir}me2.jpg` };
    server.calls.length = 0;
    await syncCloset(login, c.io, WITHHELD);
    assert.equal(blobPosts(), 0, 'revoking stops further photo uploads');
    assert.equal(server.items.get(shirt.id).data.imageBlob, before.imageBlob, 'the server keeps the photo it had');
    assert.equal(server.items.get(shirt.id).data.sourceBlob, before.sourceBlob);
    assert.equal(server.items.get(fresh.id).data.imageBlob, undefined);
    assert.equal(server.profile.data.modelBlob, beforeProfile.modelBlob, 'and the try-on photo');
    assert.equal(c.state.items.find(item => item.id === shirt.id).imageUri, `${bobDir}other.png`);
    assert.equal(c.state.profile.modelUri, `${bobDir}me2.jpg`);
    server.items = snapshotServer[0]; server.profile = snapshotServer[1];
  });

  await test('without consent, a change from another device neither wipes a local photo nor overwrites a photo there', async () => {
    const login = { ...session, login: 'carol' }; const carolDir = 'file:///docs/photos/carol/';
    const snapshotServer = [new Map(server.items), server.profile];
    server.items = new Map(); server.profile = null;
    const dress = { ...tee, id: '1727000000060', name: 'DRESS', imageUri: `${carolDir}dress.png`, sourceImageUri: undefined };
    devices.d = { values: new Map(), disk: new Map([[dress.imageUri, 'dress']]) };
    devices.e = { values: new Map(), disk: new Map() };

    // D has consent and sends the photo; E has none, receives it (downloading is no upload).
    device = devices.d;
    const d = phone([dress], { gender: 'female', modelUri: `${carolDir}d.jpg` });
    device.disk.set(`${carolDir}d.jpg`, 'd');
    await syncCloset(login, d.io, ALLOWED);
    const firstBlob = server.items.get(dress.id).data.imageBlob;
    const firstModel = server.profile.data.modelBlob;
    device = devices.e;
    const e = phone([], {});
    server.calls.length = 0;
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(blobPosts(), 0);
    assert.equal(e.state.items[0].name, 'DRESS');
    assert.ok(e.state.items[0].imageUri.endsWith('.png'), 'a photo already on the server still arrives');
    assert.ok(e.state.profile.modelUri);

    // E picks a new photo, withheld, and a name edit goes out with D's photo kept.
    const local = `${carolDir}e-new.png`;
    e.state.items = [{ ...e.state.items[0], imageUri: local, name: 'DRESS e' }];
    const localModel = `${carolDir}e-model.jpg`;
    e.state.profile = { ...e.state.profile, modelUri: localModel };
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(server.items.get(dress.id).data.name, 'DRESS e');
    assert.equal(server.items.get(dress.id).data.imageBlob, firstBlob, 'the photo on the server is not cleared');
    assert.equal(server.profile.data.modelBlob, firstModel);

    // D replaces the photo; E, unchanged since, takes the fields and keeps its own withheld file.
    device = devices.d;
    await syncCloset(login, d.io, ALLOWED);
    d.state.items = [{ ...d.state.items[0], imageUri: `${carolDir}dress2.png`, name: 'DRESS d' }];
    device.disk.set(`${carolDir}dress2.png`, 'dress2');
    await syncCloset(login, d.io, ALLOWED);
    const secondBlob = server.items.get(dress.id).data.imageBlob;
    assert.notEqual(secondBlob, firstBlob);
    device = devices.e;
    server.calls.length = 0;
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(e.state.items[0].name, 'DRESS d');
    assert.equal(e.state.items[0].imageUri, local, 'the local photo survives an update from the server');
    assert.equal(e.state.profile.modelUri, localModel);
    assert.equal(blobPosts(), 0);
    assert.equal(server.items.get(dress.id).data.imageBlob, secondBlob, 'no write-back over the new photo');

    // A later edit on E still carries D's newer photo.
    e.state.items = [{ ...e.state.items[0], name: 'DRESS e2' }];
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(server.items.get(dress.id).data.name, 'DRESS e2');
    assert.equal(server.items.get(dress.id).data.imageBlob, secondBlob);

    // Both changed at once: E's fields win, D's photo survives.
    device = devices.d;
    await syncCloset(login, d.io, ALLOWED);
    d.state.items = [{ ...d.state.items[0], imageUri: `${carolDir}dress3.png` }];
    device.disk.set(`${carolDir}dress3.png`, 'dress3');
    await syncCloset(login, d.io, ALLOWED);
    const thirdBlob = server.items.get(dress.id).data.imageBlob;
    device = devices.e;
    e.state.items = [{ ...e.state.items[0], name: 'DRESS e3' }];
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(server.items.get(dress.id).data.name, 'DRESS e3');
    assert.equal(server.items.get(dress.id).data.imageBlob, thirdBlob);
    assert.equal(e.state.items[0].imageUri, local);

    // Deleted elsewhere while this phone holds a photo not sent: the item is not lost here.
    device = devices.d;
    await syncCloset(login, d.io, ALLOWED);
    d.state.items = [];
    await syncCloset(login, d.io, ALLOWED);
    assert.equal(server.items.get(dress.id).deleted, true);
    device = devices.e;
    await syncCloset(login, e.io, WITHHELD);
    assert.equal(e.state.items.length, 1, 'the only copy of that photo stays');

    // The consent on E: its photo goes out, as any local change does.
    device.disk.set(local, 'e photo'); device.disk.set(localModel, 'e model');
    await syncCloset(login, e.io, ALLOWED);
    assert.equal(server.items.get(dress.id).deleted, false);
    assert.ok(server.items.get(dress.id).data.imageBlob);
    server.items = snapshotServer[0]; server.profile = snapshotServer[1];
  });

  await test('consent revoked during a sync stops the photos still to go', async () => {
    const login = { ...session, login: 'dan' }; const danDir = 'file:///docs/photos/dan/';
    const snapshotServer = [new Map(server.items), server.profile];
    server.items = new Map(); server.profile = null;
    device = devices.f = { values: new Map(), disk: new Map() };
    const two = [1, 2].map(n => ({ ...tee, id: `17270000007${n}0`, name: `I${n}`, imageUri: `${danDir}${n}.png`, sourceImageUri: undefined }));
    two.forEach(item => device.disk.set(item.imageUri, 'x'));
    const f = phone(two, {});
    let asks = 0;
    server.calls.length = 0;
    // Allowed at the start and for the first item, revoked before the second.
    await syncCloset(login, f.io, { canDelete: true, photos: async () => ++asks <= 2 });
    assert.equal(blobPosts(), 1);
    assert.equal(server.items.size, 2, 'the second item still syncs, without its photo');
    assert.equal(f.state.items.length, 2);
    assert.ok(server.items.get(two[0].id).data.imageBlob);
    assert.equal(server.items.get(two[1].id).data.imageBlob, undefined);
    server.items = snapshotServer[0]; server.profile = snapshotServer[1];
  });

  await test('a wardrobe that suddenly reads empty never wipes the server', async () => {
    device = devices.a;
    const many = Array.from({ length: 5 }, (_, index) => ({ ...jeans, id: `99${index}`, name: `ITEM ${index}` }));
    a.state.items = many;
    await syncCloset(session, a.io, ALLOWED);
    a.state.items = [];
    await syncCloset(session, a.io, ALLOWED);
    assert.equal(many.every(item => !server.items.get(item.id).deleted), true);
  });
})().catch(error => { console.error(error); process.exit(1); });
