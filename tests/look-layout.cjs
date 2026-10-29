// The look on the «Что надеть» stage: a tidy flat lay — pieces of one size, none over another, all inside.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { layoutLook, SMALL } = require('../src/components/studio/lookLayout.ts');
const item = (id, category, section) => ({ id, name: category, category, section, color: 'Белый', pattern: 'Однотонный', season: 'Круглый год', tags: [], imageUri: 'photo' });
const at = (layout, id) => layout.find(piece => piece.id === id);
const centreY = p => p.y + p.h / 2;

function sound(layout, W, H, label) {
  layout.forEach(p => {
    assert.ok(p.x >= 0 && p.x + p.w <= W + 0.01, `${label}: ${p.id} leaves the stage sideways`);
    assert.ok(p.y >= 0 && p.y + p.h <= H + 0.01, `${label}: ${p.id} leaves the stage vertically`);
    const r = parseFloat(p.rotate); assert.match(p.rotate, /^-?\d+(\.\d+)?deg$/); assert.ok(Math.abs(r) <= 3, `${p.id} rotated ${p.rotate}`);
  });
  for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
    const a = layout[i], b = layout[j];
    const apart = a.x + a.w + 8 <= b.x || b.x + b.w + 8 <= a.x || a.y + a.h + 8 <= b.y || b.y + b.h + 8 <= a.y;
    assert.ok(apart, `${label}: ${a.id} and ${b.id} overlap`);
  }
  // Shoes, bags and accessories are meant a little smaller (SMALL); against that, every piece is the same size.
  const small = new Set(['shoes', 'bag', 'hat']);
  const sides = layout.map(p => Math.sqrt(p.w * p.h) / (small.has(p.id) ? SMALL : 1)), mean = sides.reduce((s, v) => s + v, 0) / sides.length;
  sides.forEach((s, i) => assert.ok(Math.abs(s / mean - 1) <= 0.2, `${label}: ${layout[i].id} is ${Math.round(s / mean * 100)}% of the usual size`));
}

const coat = item('coat', 'Куртка', 'Верхняя одежда'), shirt = item('shirt', 'Рубашка', 'Верх'), tee = item('tee', 'Футболка', 'Верх');
const jeans = item('jeans', 'Джинсы', 'Низ'), shoes = item('shoes', 'Кеды', 'Обувь'), bag = item('bag', 'Сумка', 'Сумки'), hat = item('hat', 'Шапка', 'Аксессуары');
const dress = item('dress', 'Платье', 'Верх');
const pool = [coat, shirt, tee, jeans, shoes, bag, hat];
const aspectSets = [{}, { coat: 1.1, shirt: 0.8, tee: 1.05, jeans: 0.45, shoes: 2, bag: 1, hat: 1.3 }, { coat: 0.6, shirt: 0.7, tee: 0.9, jeans: 0.7, shoes: 1.2, bag: 0.5, hat: 2.2 }];
for (const [W, H] of [[390, 404], [358, 360], [320, 300], [170, 230]]) for (let n = 2; n <= 6; n++) for (const aspects of aspectSets) {
  for (const look of [pool.slice(0, n), [coat, ...pool.slice(3, 2 + n)].slice(0, n), [shirt, tee, jeans, shoes, bag, hat].slice(0, n)]) {
    const layout = layoutLook(look, W, H, aspects);
    assert.equal(layout.length, look.length);
    sound(layout, W, H, `${n} pieces on ${W}×${H}`);
  }
}

// Worn order: the upper body above the bottom, shoes at the foot.
const W = 390, H = 404;
const owner = layoutLook([coat, shirt, tee, jeans, shoes], W, H, { coat: 1.1, shirt: 0.85, tee: 1.05, jeans: 0.5, shoes: 1.9 });
assert.ok(centreY(at(owner, 'shoes')) >= centreY(at(owner, 'coat')), 'shoes are not above the jacket');
assert.ok(centreY(at(owner, 'jeans')) >= centreY(at(owner, 'tee')) - 1 || at(owner, 'jeans').x > at(owner, 'tee').x, 'the bottom comes after the top');
const basic = layoutLook([shoes, jeans, tee], W, H);
assert.ok(centreY(at(basic, 'shoes')) > centreY(at(basic, 'tee')), 'shoes below the top');

const tights = item('tights', 'Колготки', 'Низ');
assert.equal(at(layoutLook([dress, tights, shoes], W, H), 'tights'), undefined, 'tights are worn under, not shown');
assert.deepEqual(layoutLook([], W, H), []);
const [alone] = layoutLook([tee], W, H);
assert.ok(Math.abs(alone.x + alone.w / 2 - W / 2) < 2 && alone.w < W * 0.8, 'a look of one piece stands in the middle, not filling the stage');
console.log('PASS: look layout — equal size, no overlaps, inside the stage for 2–6 pieces, worn order, tights hidden');
