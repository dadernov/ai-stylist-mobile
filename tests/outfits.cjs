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

// --- правила, добавленные вместе с таблицей знаний о вещах ---
const advise = (items, context) => getOutfitAdvice(items, { style: '', event: '', temperature: null, ...context });
const all = advice => [...advice.tips, ...advice.warnings, ...advice.reasons].join(' | ');

// Разрыв по строгости: пиджак с кроссовками — разные регистры.
const blazer = item('blazer', 'Пиджак', 'Верхняя одежда'), sneakers = item('sneakers', 'Кроссовки', 'Обувь');
const gap = advise([blazer, shirt, jeans, sneakers], {});
assert.ok(gap.warnings.some(x => x.includes('разных регистров')), 'ожидалось замечание о разрыве строгости');

// Ровный по строгости офисный комплект получает объяснение, а не претензию.
const office = advise([shirt, item('pants', 'Брюки', 'Низ'), item('loafers', 'Лоферы', 'Обувь')], { style: 'Офисный', event: 'Совещание' });
assert.ok(!office.warnings.some(x => x.includes('разных регистров')));
assert.ok(office.reasons.some(x => x.includes('формальности')), 'ожидалось объяснение про формальность');

// «Почти совпало» по цвету — худший случай, он разбирается отдельно от контраста.
// Красный (357°) и жёлтый (47°) расходятся на 50° — это и есть «почти совпало».
const near = advise([item('t1', 'Футболка', 'Верх', { color: '#b9383e' }), item('b1', 'Брюки', 'Низ', { color: '#e2c455' }), shoes], {});
assert.ok(near.warnings.some(x => x.includes('близки по тону')), 'ожидалось замечание о близких оттенках');
const far = advise([item('t2', 'Футболка', 'Верх', { color: '#b9383e' }), item('b2', 'Брюки', 'Низ', { color: '#44825a' }), shoes], {});
assert.ok(!far.warnings.some(x => x.includes('близки по тону')));

// Полностью нейтральный образ получает совет про акцент, а не предупреждение.
assert.ok(all(advise([shirt, jeans, shoes], {})).includes('нейтральных тонах'));

// Два объёмных слоя сразу — совет по пропорции.
const bulky = advise([item('hood', 'Худи', 'Верх'), item('jog', 'Джоггеры', 'Низ'), sneakers], {});
assert.ok(bulky.tips.some(x => x.includes('объёмные')), 'ожидался совет про объём');

// Спортзал: неспортивные вещи названы поимённо.
const gym = advise([shirt, jeans, sneakers], { event: 'Спортзал' });
assert.ok(gym.warnings.some(x => x.includes(shirt.name) && x.includes('тренировки')));

// Тёплая вещь в жару и лёгкая в холод разбираются по шкале утепления, а не по сезону.
assert.ok(advise([shirt, jeans, item('puffer', 'Пуховик', 'Верхняя одежда'), shoes], { temperature: 26 })
  .warnings.some(x => x.includes('слишком тёплой')));
assert.ok(advise([shirt, item('shorts', 'Шорты', 'Низ'), item('sand', 'Сандалии', 'Обувь')], { temperature: 2 })
  .warnings.some(x => x.includes('долгого пребывания')));

// Совет «заправь» важнее замечания о светлоте и не должен вытесняться.
const tuck = advise([shirt, jeans, shoes], { style: 'Офисный', event: 'Совещание', temperature: 3 });
assert.equal(tuck.tips[0].includes('Заправь'), true, 'совет про заправку должен идти первым');

console.log('PASS: строгость, цветовые пары, пропорции, спортзал, погода по утеплению, порядок советов');
