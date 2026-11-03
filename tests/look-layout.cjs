// The looks on the stages: a strict grid of equal cells, none over another, all inside.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { gridCount, gridLook, gridStageHeight } = require('../src/components/studio/lookLayout.ts');
const item = (id, category, section) => ({ id, name: category, category, section, color: 'Белый', pattern: 'Однотонный', season: 'Круглый год', tags: [], imageUri: 'photo' });
const coat = item('coat', 'Куртка', 'Верхняя одежда'), shirt = item('shirt', 'Рубашка', 'Верх'), tee = item('tee', 'Футболка', 'Верх');
const jeans = item('jeans', 'Джинсы', 'Низ'), shoes = item('shoes', 'Кеды', 'Обувь'), bag = item('bag', 'Сумка', 'Сумки'), hat = item('hat', 'Шапка', 'Аксессуары');
const dress = item('dress', 'Платье', 'Верх');
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

  // Arrows at the sides: no cell under them, for any number of pieces, on any phone; still centred and equal.
  for (const W of [320, 358, 390, 430, 720]) for (let n = 1; n <= 8; n++) {
    const layout = gridLook(wide.slice(0, n), W, 290, { sideInset: 58 });
    assert.equal(layout.length, n, `inset grid of ${n} on ${W}`);
    layout.forEach(p => assert.ok(p.x >= 58 && p.x + p.w <= W - 58, `${n} on ${W}: ${p.id} at ${p.x}+${p.w} is under an arrow`));
    assert.ok(layout.every(p => p.w === layout[0].w && p.h === layout[0].h));
    for (const row of rowsOf(layout)) assert.ok(Math.abs(row[0].x - (W - row[row.length - 1].x - row[0].w)) <= 1, `${n} on ${W}: off centre`);
  }
  assert.deepEqual(gridLook(wide.slice(0, 5), 390, 290, {}), gridLook(wide.slice(0, 5), 390, 290), 'no inset: as before');
  assert.deepEqual(gridLook(wide.slice(0, 5), 390, 290, { sideInset: 5 }), gridLook(wide.slice(0, 5), 390, 290), 'an inset inside the padding changes nothing');
  assert.deepEqual(gridLook([], 390, 290, { sideInset: 58 }), [], 'nothing to draw: the screen shows the placeholder');

  // The hero uses the grid and tilts nothing.
  const heroSource = fs.readFileSync(`${__dirname}/../src/components/DailyLookHero.tsx`, 'utf8');
  assert.match(heroSource, /gridLook\(selection, width, stageHeight\)/);
  assert.ok(!/layoutLook|piece\.rotate|useAspects/.test(heroSource), 'the hero has no tilt and no picture-dependent layout');
  for (const file of ['screens/RecommendationsScreen.tsx', 'screens/FavoritesScreen.tsx']) {
    const source = fs.readFileSync(`${__dirname}/../src/${file}`, 'utf8');
    assert.match(source, /gridLook\(/, file);
    assert.ok(!/layoutLook|piece\.rotate|useAspects/.test(source), `${file} has no tilt and no picture-dependent layout`);
  }
  console.log('PASS: look-of-the-day grid — equal cells, no overlap, no rotation, inside the stage for 1–8 pieces');
}
