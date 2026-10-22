// The look on the «Что надеть» stage: each piece where it is worn, all of it inside the stage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { layoutLook } = require('../src/components/studio/lookLayout.ts');
const item = (id, category, section) => ({ id, name: category, category, section, color: 'Белый', pattern: 'Однотонный', season: 'Круглый год', tags: [], imageUri: 'photo' });
const W = 390, H = 400;
const at = (layout, id) => layout.find(piece => piece.id === id);
const inside = layout => layout.forEach(p => {
  assert.ok(p.x >= 0 && p.x + p.w <= W, `${p.id} leaves the stage sideways`);
  assert.ok(p.y >= 0 && p.y + p.h <= H, `${p.id} leaves the stage vertically`);
  assert.match(p.rotate, /^-?\d+(\.\d+)?deg$/);
  const r = parseFloat(p.rotate); assert.ok(r >= -6 && r <= 3, `${p.id} rotated ${p.rotate}`);
});

const tee = item('tee', 'Футболка', 'Верх'), jeans = item('jeans', 'Джинсы', 'Низ'), shoes = item('shoes', 'Кеды', 'Обувь');
const basic = layoutLook([tee, jeans, shoes], W, H);
assert.equal(basic.length, 3);
const top = at(basic, 'tee'), bottom = at(basic, 'jeans'), feet = at(basic, 'shoes');
assert.ok(top.y < 140 && top.x < 195, 'the top sits in the upper-left half');
assert.ok(bottom.x > top.x && bottom.y > top.y, 'the bottom sits right of the top and below it');
assert.ok(feet.y > 260, 'shoes in the bottom third');
inside(basic);

const coat = item('coat', 'Пальто', 'Верхняя одежда');
const layered = layoutLook([tee, coat, jeans, shoes], W, H);
assert.ok(at(layered, 'coat').w > at(layered, 'tee').w, 'outerwear is larger than a T-shirt');
inside(layered);

const dress = item('dress', 'Платье', 'Верх');
const dressed = layoutLook([dress, shoes], W, H);
const d = at(dressed, 'dress');
assert.ok(Math.abs(d.x + d.w / 2 - W / 2) < 40, 'a one-piece stands in the middle');
inside(dressed);

const tights = item('tights', 'Колготки', 'Низ');
assert.equal(at(layoutLook([dress, tights, shoes], W, H), 'tights'), undefined, 'tights are worn under, not shown');
assert.deepEqual(layoutLook([], W, H), []);
const [alone] = layoutLook([tee], W, H);
assert.ok(Math.abs(alone.x + alone.w / 2 - W / 2) < 2, 'a look of one piece stands in the middle');

// Bags, accessories and extra layers still land on the stage; a small stage scales everything down.
const bag = item('bag', 'Сумка', 'Сумки'), hat = item('hat', 'Шапка', 'Аксессуары'), shirt = item('shirt', 'Рубашка', 'Верх');
const full = layoutLook([coat, shirt, tee, jeans, item('skirt', 'Юбка', 'Низ'), shoes, bag, hat], W, H);
assert.equal(full.length, 8);
inside(full);
const small = layoutLook([coat, tee, jeans, shoes, bag], 320, 300);
small.forEach(p => assert.ok(p.x >= 0 && p.x + p.w <= 320 && p.y >= 0 && p.y + p.h <= 300, `${p.id} leaves a small stage`));
console.log('PASS: look layout — top upper-left, bottom right, shoes low, outerwear large, one-piece centred, tights hidden, inside the stage');
