const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);
const { buildLooks, getOutfitAdvice } = require('../src/domain/outfits.ts');
const item = (id, category, section, extra = {}) => ({ id, name: category + ' ' + id, category, section, color: 'Белый', pattern: 'Однотонный', season: 'Круглый год', tags: [], imageUri: 'photo', ...extra });
const shirt = item('shirt', 'Рубашка', 'Верх'), jeans = item('jeans', 'Джинсы', 'Низ'), shoes = item('shoes', 'Кеды', 'Обувь');
assert.deepEqual(buildLooks([], 'Кэжуал', 'Прогулка', '', null), []);
const single = buildLooks([shirt], 'Кэжуал', 'Прогулка', '', null, 'male')[0];
assert.deepEqual(single.itemIds, ['shirt']);
assert.ok(single.warnings.some(x => x.includes('Неполный')));
assert.equal(single.makeup, ''); assert.equal(single.hair, '');
const dress = item('dress', 'Платье', 'Верх');
for (const look of buildLooks([dress, jeans, shoes], 'Кэжуал', 'Прогулка', '', null)) {
  assert.ok(!(look.itemIds.includes('dress') && look.itemIds.includes('jeans')));
}
const advice = getOutfitAdvice([shirt, jeans, shoes], { style: 'Офисный', event: 'Совещание', temperature: 3 });
assert.equal(advice.tuckMode, 'tucked');
assert.ok(advice.tips.some(x => x.includes(shirt.name) && x.includes(jeans.name)));
assert.ok(advice.warnings.some(x => x.includes('3°C')));
const outer = item('outer', 'Пуховик', 'Верхняя одежда', { season: 'Зима' });
assert.ok(!buildLooks([shirt, jeans, shoes, outer], 'Кэжуал', 'Прогулка', '', 29)[0].itemIds.includes('outer'));
const variants = buildLooks([shirt, item('tee', 'Футболка', 'Верх'), jeans, shoes, outer], 'Кэжуал', 'Прогулка', '', 5);
assert.equal(new Set(variants.map(x => [...x.itemIds].sort().join(','))).size, variants.length);
assert.ok(variants[0].itemIds.includes('outer'));
assert.ok(buildLooks([shirt, jeans, shoes], 'Кэжуал', 'Прогулка', '', null, 'female', true)[0].makeup);
console.log('PASS: single item, incomplete warnings, dress without trousers, contextual advice, weather, diversity, beauty opt-in');
