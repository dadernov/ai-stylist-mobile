// The reflections' small copies: one decode at a time, the latest wanted first, each once, bounded, failures final.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { COPY_LONG_SIDE, copyName, createCopyCache } = require('../src/components/studio/reflectionCache.ts');

const manual = () => {
  const open = []; const started = []; let active = 0, peak = 0;
  const make = uri => new Promise((resolve, reject) => {
    started.push(uri); peak = Math.max(peak, ++active);
    open.push({ uri, finish: value => { active--; value instanceof Error ? reject(value) : resolve(value); } });
  });
  return { make, open, started, peak: () => peak };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  assert.ok(COPY_LONG_SIDE >= 400 && COPY_LONG_SIDE <= 800);
  assert.equal(copyName('file:///a.jpg'), copyName('file:///a.jpg'), 'the same file across launches');
  assert.notEqual(copyName('file:///a.jpg'), copyName('file:///b.jpg'));
  assert.ok(copyName(`data:image/png;base64,${'A'.repeat(100000)}`).length < 40, 'a short name for any uri');
  assert.match(copyName('https://x/y?z=1#w'), /^[a-z0-9-]+$/, 'safe as a file name');

  // Dedupe, one at a time, latest first.
  {
    const m = manual(); const cache = createCopyCache(m.make);
    assert.equal(cache.peek('a'), undefined);
    const a = cache.request('a'); const again = cache.request('a');
    cache.request('b'); cache.request('c');
    cache.request('b'); // wanted again: back on top
    await tick();
    assert.deepEqual(m.started, ['b'], 'the latest wanted first, one at a time');
    m.open.shift().finish('b-small'); await tick();
    assert.deepEqual(m.started, ['b', 'c']);
    assert.equal(cache.peek('b'), 'b-small');
    m.open.shift().finish('c-small'); await tick();
    m.open.shift().finish('a-small');
    assert.equal(await a, 'a-small'); assert.equal(await again, 'a-small');
    assert.equal(m.started.filter(uri => uri === 'a').length, 1, 'in flight once');
    assert.equal(m.peak(), 1, 'never two full-size decodes at once');
    assert.equal(await cache.request('a'), 'a-small');
    assert.equal(m.started.length, 3, 'known: not made again');
  }
  // A failure is an answer: the contact shadow; the queue goes on.
  {
    const m = manual(); const cache = createCopyCache(m.make);
    const bad = cache.request('bad'); await tick();
    m.open.shift().finish(new Error('no decode'));
    assert.equal(await bad, null);
    assert.equal(cache.peek('bad'), null);
    const good = cache.request('good'); await tick();
    m.open.shift().finish('good-small');
    assert.equal(await good, 'good-small');
  }
  // Bounded, the least recently used going first.
  {
    const cache = createCopyCache(async uri => `${uri}-small`, 2);
    await cache.request('a'); await cache.request('b');
    assert.equal(cache.peek('a'), 'a-small');
    await cache.request('c');
    assert.equal(cache.peek('b'), undefined, 'b went');
    assert.equal(cache.peek('a'), 'a-small');
    assert.equal(cache.peek('c'), 'c-small');
  }
  console.log('PASS: reflection copies — one decode at a time, latest first, deduped, bounded, failures fall back');
})().catch(error => { console.error(error); process.exit(1); });
