// «Что надеть сегодня»: one look a day, stable through it; and nothing in the hero may start a paid try-on by itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { decodeDailyLook, dayPart, greetingName, localDay, pickDailyLook, skipDailyLook } = require('../src/domain/dailyLook.ts');
const { lookCore } = require('../src/domain/outfits.ts');
const item = (id, section) => ({ id, name: id, category: id, section, color: 'Белый', pattern: 'Однотонный', season: 'Круглый год', tags: [], imageUri: 'photo' });
const items = [item('a', 'Верх'), item('b', 'Верх'), item('c', 'Верх'), item('d', 'Верх'), item('j', 'Низ'), item('s', 'Обувь')];
const look = (id, temperature = 5) => ({ id, itemIds: [id, 'j', 's'], temperature });
const looks = [look('a'), look('b'), look('c'), look('d')];
const day = '2026-11-01';
const dates = Array.from({ length: 28 }, (_, d) => `2026-11-${String(d + 1).padStart(2, '0')}`);

assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
assert.deepEqual([4, 5, 11, 12, 17, 18, 22, 23].map(dayPart), ['night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night']);
assert.equal(greetingName('Анна Петрова', 'anna'), 'Анна');
assert.equal(greetingName('anna', 'anna'), '');
assert.equal(greetingName('a@b.c', 'x'), '');
assert.equal(greetingName(undefined, 'x'), '');

// The same day and the same record: the same look, however the weather reorders the candidates.
const first = pickDailyLook(looks, items, null, day);
assert.ok(first.lookId);
assert.equal(first.temperature, 5);
assert.equal(pickDailyLook([...looks].reverse().map(l => look(l.id, 20)), items, first, day), first);
assert.equal(pickDailyLook([], items, first, day), first, 'the look holds with no candidates at all');
// Only the top of the list is offered, and the date varies it.
const picks = dates.map(date => pickDailyLook(looks, items, null, date).lookId);
assert.ok(!picks.includes('d'));
assert.ok(new Set(picks).size > 1, 'the date varies the look');
// A new day chooses anew and forgets what was skipped.
const skippedYesterday = skipDailyLook(first, lookCore([items[0], items[4]]));
assert.deepEqual(pickDailyLook(looks, items, skippedYesterday, '2026-11-02').skipped, []);
// A piece that left the wardrobe releases the look.
const gone = items.filter(entry => entry.id !== first.itemIds[0]);
assert.notEqual(pickDailyLook(looks, gone, first, day).lookId, first.lookId);

// Skipping moves on, is remembered, and ends in «nothing left», not in a repeat.
let record = first; const seen = new Set();
for (let n = 0; n < 5; n++) {
  record = pickDailyLook(looks, items, record, day);
  if (!record.lookId) break;
  assert.ok(!seen.has(record.lookId), 'a skipped look never returns the same day');
  seen.add(record.lookId);
  record = skipDailyLook(record, lookCore(record.itemIds.map(id => items.find(entry => entry.id === id))));
}
assert.equal(seen.size, 4);
assert.equal(record.lookId, '');
assert.equal(record.skipped.length, 4);
assert.equal(pickDailyLook(looks, items, record, day), record, 'an exhausted day stays as it is: nothing to save again');
assert.equal(decodeDailyLook(JSON.parse(JSON.stringify(record))).skipped.length, 4);

// Dismissed looks wait until nothing else is left.
const core = id => lookCore([items.find(entry => entry.id === id), items[4]]);
assert.equal(pickDailyLook([look('a'), look('b')], items, null, day, [core('a')]).lookId, 'b');
assert.equal(pickDailyLook([look('a')], items, null, day, [core('a')]).lookId, 'a');

// Too few things: no look, one garment is not an outfit.
assert.equal(pickDailyLook([], [], null, day).lookId, '');
assert.equal(pickDailyLook([{ id: 'one', itemIds: ['a'] }], items, null, day).lookId, '');
// No weather: still a look.
assert.equal(pickDailyLook([look('a', null)], items, null, day).temperature, null);

for (const bad of [null, 3, {}, { day, lookId: 1, itemIds: [], skipped: [] }, { day, lookId: 'x', itemIds: [1], skipped: [] }]) assert.equal(decodeDailyLook(bad), null);

// Every try-on costs money: the hero reaches the try-on only through its button, and never the generation itself.
const hero = fs.readFileSync(path.join(__dirname, '../src/components/DailyLookHero.tsx'), 'utf8');
assert.ok(!/useTryOnJobs|useGenerationDock|store\.start|tryOnJobs/.test(hero), 'the hero must not touch the try-on machinery');
assert.equal([...hero.matchAll(/\bonTryOn\(/g)].length, 1, 'one call of onTryOn');
assert.match(hero, /onPress=\{tryOn\}/);
console.log('daily-look ok');
