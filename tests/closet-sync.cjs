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

async function test(name, run) { await run(); console.log(`PASS: ${name}`); }

(async () => {
  device = devices.a;
  devices.a.disk.set(`${dir}tee.png`, 'tee cut-out'); devices.a.disk.set(`${dir}tee.jpg`, 'tee photo'); devices.a.disk.set(`${dir}jeans.png`, 'jeans');
  devices.a.disk.set(`${dir}me.jpg`, 'me');
  const a = phone([tee, jeans], { gender: 'female', beautyAdvice: true, modelUri: `${dir}me.jpg` });
  const b = phone([], {});

  await test('the first phone sends its wardrobe, the photos once each', async () => {
    await syncCloset(session, a.io, { canDelete: true });
    assert.deepEqual([...server.items.keys()].sort(), [tee.id, jeans.id]);
    assert.equal(server.items.get(tee.id).data.imageUri, undefined, 'no path of the phone reaches the server');
    assert.ok(server.items.get(tee.id).data.imageBlob && server.items.get(tee.id).data.sourceBlob);
    assert.equal(server.blobs.size, 4, 'two tee photos, jeans and the try-on photo');
    assert.equal(server.profile.data.gender, 'female');
    server.calls.length = 0;
    await syncCloset(session, a.io, { canDelete: true });
    assert.deepEqual(server.calls, ['GET /closet'], 'nothing changed, nothing is sent again');
  });

  await test('a second phone of the same account receives the wardrobe with its photos', async () => {
    device = devices.b;
    await syncCloset(session, b.io, { canDelete: true });
    assert.deepEqual(b.state.items.map(item => item.name).sort(), ['JEANS', 'TEE']);
    const received = b.state.items.find(item => item.id === tee.id);
    assert.ok(received.imageUri.startsWith(dir) && received.imageUri.endsWith('.png'));
    assert.equal(devices.b.disk.get(received.imageUri), `photo ${server.items.get(tee.id).data.imageBlob}`);
    assert.equal(b.state.profile.gender, 'female');
    assert.ok(b.state.profile.modelUri.startsWith(dir));
    server.calls.length = 0;
    await syncCloset(session, b.io, { canDelete: true });
    assert.deepEqual(server.calls, ['GET /closet'], 'what came from the server is not sent back');
  });

  await test('a change and a deletion on one phone reach the other', async () => {
    device = devices.a;
    a.state.items = [{ ...tee, name: 'TEE, white' }];
    await syncCloset(session, a.io, { canDelete: true });
    assert.equal(server.items.get(jeans.id).deleted, true);
    device = devices.b;
    await syncCloset(session, b.io, { canDelete: true });
    assert.deepEqual(b.state.items.map(item => item.name), ['TEE, white']);
  });

  await test('a change not sent yet wins over an older one from the server', async () => {
    device = devices.b;
    b.state.items = b.state.items.map(item => ({ ...item, color: 'Черный' }));
    device = devices.a;
    a.state.items = [{ ...tee, name: 'TEE, renamed on A' }];
    await syncCloset(session, a.io, { canDelete: true });
    device = devices.b;
    await syncCloset(session, b.io, { canDelete: true });
    assert.equal(b.state.items[0].color, 'Черный', 'the local edit is kept');
    assert.equal(server.items.get(tee.id).data.color, 'Черный', 'and sent');
  });

  await test('a wardrobe that suddenly reads empty never wipes the server', async () => {
    device = devices.a;
    const many = Array.from({ length: 5 }, (_, index) => ({ ...jeans, id: `99${index}`, name: `ITEM ${index}` }));
    a.state.items = many;
    await syncCloset(session, a.io, { canDelete: true });
    a.state.items = [];
    await syncCloset(session, a.io, { canDelete: true });
    assert.equal(many.every(item => !server.items.get(item.id).deleted), true);
  });
})().catch(error => { console.error(error); process.exit(1); });
