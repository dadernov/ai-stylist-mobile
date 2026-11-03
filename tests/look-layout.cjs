// The look on the «Что надеть» stage: a tidy flat lay — pieces of one size, none over another, all inside.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { gridCount, gridLook, gridStageHeight, layoutLook, SMALL } = require('../src/components/studio/lookLayout.ts');
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

// The look of the day: a strict grid, the same cell for everything, shoes and accessories included.
{
  const wide = [coat, shirt, tee, jeans, shoes, bag, hat, item('belt', 'Ремень', 'Аксессуары')];
  const rowsOf = layout => [...new Set(layout.map(p => p.y))].map(y => layout.filter(p => p.y === y));
  for (const [gW, gH] of [[390, 200], [358, 290], [358, 200], [320, 290], [320, 240], [430, 290], [700, 290], [240, 500]]) for (let n = 1; n <= 8; n++) {
    const label = `grid of ${n} on ${gW}×${gH}`;
    const layout = gridLook(wide.slice(0, n), gW, gH);
    assert.equal(layout.length, n, label);
    assert.deepEqual(layout.map(p => p.id), wide.slice(0, n).map(p => p.id), `${label}: in worn, reading order`);
    layout.forEach(p => {
      assert.equal(p.rotate, '0deg', label);
      assert.ok(p.w === layout[0].w && p.h === layout[0].h && p.w > 0 && p.h > 0, `${label}: cells differ`);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= gW && p.y + p.h <= gH, `${label}: ${p.id} leaves the stage`);
    });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = layout[i], b = layout[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${label}: ${a.id} and ${b.id} overlap`);
    }
    const rows = rowsOf(layout), { w, h } = layout[0];
    rows.forEach(row => {
      row.slice(1).forEach((p, i) => assert.equal(p.x - row[i].x - w, 10, `${label}: uneven gutter in a row`));
      const left = row[0].x, right = gW - (row[row.length - 1].x + w);
      assert.ok(Math.abs(left - right) <= 1, `${label}: a row is off centre by ${left - right}`);
    });
    rows.slice(1).forEach((row, i) => assert.equal(row[0].y - rows[i][0].y - h, 10, `${label}: uneven gutter between rows`));
    assert.ok(Math.abs(layout[0].y - (gH - (layout[n - 1].y + h))) <= 1, `${label}: off centre vertically`);
    // Full rows share their columns; a shorter last row is centred, so it is the only one allowed its own.
    rows.slice(1, -1).forEach(row => assert.equal(row[0].x, rows[0][0].x, `${label}: columns do not line up`));
  }

  const shape = (n, H, sW = 358) => rowsOf(gridLook(wide.slice(0, n), sW, H)).map(row => row.length).join('+');
  assert.equal(shape(2, 200), '2', 'two stand side by side');
  assert.equal(shape(2, 290), '2', 'two stand side by side on a tall stage too');
  assert.equal(shape(3, 200), '3', 'three in a row on a low stage');
  assert.equal(shape(3, 290), '2+1', 'three as 2+1 where that makes them larger');
  assert.equal(shape(4, 290), '2+2');
  assert.equal(shape(5, 290), '3+2');
  assert.equal(shape(6, 290), '3+3');
  assert.equal(shape(6, 700, 300), '2+2+2', 'a tall narrow stage takes the taller grid');
  const [lone] = gridLook([tee], 358, 290);
  assert.ok(Math.abs(lone.x + lone.w / 2 - 179) <= 1 && lone.w < 358 * 0.7, 'one piece stands in the middle, not filling the stage');

  // Worn order whatever order they came in, tights not shown.
  assert.deepEqual(gridLook([shoes, jeans, tee, coat], 358, 290).map(p => p.id), ['coat', 'tee', 'jeans', 'shoes']);
  const under = item('tights', 'Колготки', 'Низ');
  assert.deepEqual(gridLook([dress, under, shoes], 358, 200).map(p => p.id), ['dress', 'shoes']);
  assert.equal(gridCount([dress, under, shoes]), 2);
  assert.deepEqual(gridLook([], 358, 200), []);
  assert.deepEqual(gridLook([tee], 0, 200), []);
  assert.equal(gridStageHeight(3), gridStageHeight(1), 'few pieces share a low stage');
  assert.ok(gridStageHeight(4) > gridStageHeight(3));
  assert.equal(gridStageHeight(8), gridStageHeight(4));

  // The hero uses the grid and tilts nothing.
  const heroSource = fs.readFileSync(`${__dirname}/../src/components/DailyLookHero.tsx`, 'utf8');
  assert.match(heroSource, /gridLook\(selection, width, stageHeight\)/);
  assert.ok(!/layoutLook|piece\.rotate|useAspects/.test(heroSource), 'the hero has no tilt and no picture-dependent layout');
  console.log('PASS: look-of-the-day grid — equal cells, no overlap, no rotation, inside the stage for 1–8 pieces');
}
