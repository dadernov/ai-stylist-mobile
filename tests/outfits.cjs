const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
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
assert.ok(near.tips.some(x => x.includes('близки по тону')), 'ожидался вариант стилизации близких оттенков');
assert.ok(!near.warnings.some(x => x.includes('по тону')), 'близкие оттенки сами по себе не ошибка');
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

const manyTops = Array.from({ length: 10 }, (_, i) => item(`top-${i}`, 'Футболка', 'Верх'));
const anchored = buildLooks([...manyTops, jeans, shoes], 'Кэжуал', 'Прогулка', '', null, 'male', false, { anchorId: 'top-9' });
assert.ok(anchored.length && anchored.every(look => look.itemIds.includes('top-9')), 'anchor beyond ranking limit must stay');
const coatAnchor = buildLooks([shirt, jeans, shoes, outer], 'Кэжуал', 'Прогулка', '', 27, 'male', false, { anchorId: outer.id });
assert.ok(coatAnchor.every(look => look.itemIds.includes(outer.id)), 'explicit anchor remains, with weather warning');
assert.ok(coatAnchor[0].warnings.some(warning => warning.includes('тёплой')));
const gymLooks = buildLooks([shirt, jeans, sneakers, item('tee-gym', 'Футболка', 'Верх'), item('gym-pants', 'Джоггеры', 'Низ')], 'Спорт-шик', 'Спортзал', '', null);
assert.ok(gymLooks.every(look => !look.itemIds.includes(shirt.id) && !look.itemIds.includes(jeans.id)), 'gym excludes formal garments');
const excluded = buildLooks([shirt, jeans, shoes], 'Кэжуал', 'Прогулка', '', null, 'male', false, { excludedIds: [shirt.id] });
assert.ok(excluded.every(look => !look.itemIds.includes(shirt.id)));
const { getOutfitSwaps } = require('../src/domain/outfits.ts');
const warmShoes = item('boots', 'Ботинки', 'Обувь');
const swapChoices = getOutfitSwaps([shirt, jeans, item('sandals', 'Сандалии', 'Обувь')], [warmShoes], { style: 'Кэжуал', event: 'Прогулка', temperature: 0 });
assert.ok(swapChoices.some(swap => swap.to.id === warmShoes.id));
assert.equal(getOutfitSwaps([item('sandals', 'Сандалии', 'Обувь')], [warmShoes], { style: 'Кэжуал', event: 'Прогулка', temperature: 0 }, 'sandals').length, 0);
console.log('PASS: anchor preserved, sport eligibility, explicit weather conflict, excluded garments, concrete swaps');

// --- погода, база гардероба и качество подборки (сентябрь 2026) ---
{
  const it = (id, category, section, color, extra = {}) => item(id, category, section, { color, ...extra });
  const W = [
    it('tee', 'Футболка', 'Верх', 'Черный'), it('shirt2', 'Рубашка', 'Верх', 'Белый'), it('hoodie', 'Худи', 'Верх', 'Красный'),
    it('sweater', 'Свитер', 'Верх', 'Бежевый'), it('jeans2', 'Джинсы', 'Низ', 'Синий'), it('pants2', 'Брюки', 'Низ', 'Черный'),
    it('canvas', 'Кеды', 'Обувь', 'Белый'), it('boots2', 'Ботинки', 'Обувь', 'Черный'), it('loafers2', 'Лоферы', 'Обувь', 'Коричневый'),
    it('trench', 'Тренч', 'Верхняя одежда', 'Бежевый'), it('puffer2', 'Пуховик', 'Верхняя одежда', 'Черный'), it('blazer2', 'Пиджак', 'Верхняя одежда', 'Синий'),
  ];
  // Джинсы — база: красный верх с джинсами не считается конфликтом двух акцентов.
  const redJeans = advise([W[2], W[4], W[7]], {});
  assert.ok(!redJeans.tips.some(x => x.includes('близки по тону') || x.includes('выразительное')), 'jeans are a neutral base');
  // Дождь: верхний слой обязателен, кеды уступают ботинкам.
  const rain = buildLooks(W, 'Кэжуал', 'Прогулка', '', 15, 'male', false, { precipitation: 'rain' });
  assert.ok(rain.every(look => look.itemIds.some(id => ['trench', 'blazer2', 'puffer2'].includes(id))), 'rain adds an outer layer');
  assert.ok(rain.filter(look => look.itemIds.includes('canvas')).length <= 1, 'white canvas shoes are not the default in rain');
  assert.ok(advise([W[0], W[4], W[6]], { temperature: 15, precipitation: 'rain' }).warnings.some(x => x.includes('дождь')));
  // Снег: низкой обуви и лёгкого тренча нет, если есть ботинки и пуховик.
  const snow = buildLooks(W, 'Кэжуал', 'Прогулка', '', -8, 'male', false, { precipitation: 'snow' });
  assert.ok(snow.length && snow.every(look => look.itemIds.includes('boots2') && look.itemIds.includes('puffer2')));
  // Разнообразие: образы не отличаются одной лишь обувью.
  const cores = snow.map(look => look.itemIds.filter(id => ['tee', 'shirt2', 'hoodie', 'sweater', 'jeans2', 'pants2'].includes(id)).sort().join());
  assert.equal(new Set(cores).size, cores.length, 'each look has its own top and bottom');
  // Совещание: без кед и с пиджаком; то, что приложение само раскритикует, не предлагается первым.
  const office = buildLooks(W, 'Офисный', 'Совещание', '', 20);
  assert.ok(office[0].itemIds.includes('blazer2'), 'blazer is part of a meeting look');
  assert.ok(office.every(look => !look.itemIds.includes('canvas')));
  assert.equal(office[0].warnings.length, 0);
  // Материал уточняет тепло: льняная рубашка в жару не «слишком тёплая», шерстяная — теплее обычной.
  assert.ok(!advise([it('linen', 'Рубашка', 'Верх', 'Белый', { material: 'лён' }), W[5], W[8]], { temperature: 30 }).warnings.some(x => x.includes('тёплой')));
  const { precipitationFromCode } = require('../src/domain/outfits.ts');
  assert.equal(precipitationFromCode(61), 'rain'); assert.equal(precipitationFromCode(73), 'snow'); assert.equal(precipitationFromCode(2), null);
  console.log('PASS: jeans as base, rain layer and shoes, snow boots, distinct looks, meeting blazer, warning-free top pick, material warmth');
}

// --- понятная оценка: проценты, критерии, пробелы гардероба ---
{
  const { evaluateLook, wardrobeGaps, EVENTS, STYLES } = require('../src/domain/outfits.ts');
  const it = (id, category, section, color, extra = {}) => item(id, category, section, { color, ...extra });
  const shirtW = it('s', 'Рубашка', 'Верх', 'Белый'), pantsB = it('p', 'Брюки', 'Низ', 'Черный'), loafersB = it('l', 'Лоферы', 'Обувь', 'Коричневый');
  const hoodieR = it('h', 'Худи', 'Верх', 'Красный'), jeansB = it('j', 'Джинсы', 'Низ', 'Синий'), canvasW = it('c', 'Кеды', 'Обувь', 'Белый');
  const interview = { style: 'Классика', event: 'Собеседование', temperature: 18 };
  const strong = evaluateLook([shirtW, pantsB, loafersB], interview);
  const weak = evaluateLook([hoodieR, jeansB, canvasW], interview);
  assert.ok(strong.percent >= 85 && weak.percent < 60, `strong ${strong.percent} vs weak ${weak.percent}`);
  assert.deepEqual(strong.criteria.map(c => c.key), ['set', 'occasion', 'style', 'weather', 'colors']);
  assert.equal(weak.criteria.find(c => c.key === 'occasion').status, 'bad');
  assert.ok(weak.criteria.find(c => c.key === 'occasion').note.includes(hoodieR.name), 'the note names the offending item');
  const noWeather = evaluateLook([shirtW, pantsB, loafersB], { style: 'Классика', event: 'Собеседование', temperature: null });
  assert.equal(noWeather.criteria.find(c => c.key === 'weather').status, 'unknown', 'unknown weather does not count against the look');
  const rainy = evaluateLook([hoodieR, jeansB, canvasW], { style: 'Кэжуал', event: 'Прогулка', temperature: 12, precipitation: 'rain' });
  assert.notEqual(rainy.criteria.find(c => c.key === 'weather').status, 'good');
  // Пробелы гардероба называют конкретные вещи.
  const gaps = wardrobeGaps([hoodieR, jeansB, canvasW], { ...interview, temperature: 2, precipitation: 'rain' });
  for (const expected of ['рубашки или блузы', 'строгой обуви (лоферы, туфли)', 'тёплой верхней одежды', 'плаща или куртки']) assert.ok(gaps.includes(expected), expected);
  assert.deepEqual(wardrobeGaps([shirtW, pantsB, loafersB], interview), []);
  // Каждое новое событие и стиль собирают образ без ошибок.
  const wardrobe = [shirtW, pantsB, loafersB, hoodieR, jeansB, canvasW, it('t', 'Футболка', 'Верх', 'Черный'), it('sh', 'Шорты', 'Низ', 'Бежевый'), it('sn', 'Сандалии', 'Обувь', 'Коричневый')];
  for (const event of EVENTS) for (const style of STYLES) {
    const looks = buildLooks(wardrobe, style, event, '', 20);
    assert.ok(looks.length, `${style}/${event}`);
    assert.ok(looks.every((look, index) => index === 0 || look.matchPercent <= looks[index - 1].matchPercent), 'looks are ordered by match');
  }
  const beach = buildLooks(wardrobe, 'Кэжуал', 'Пляж', '', 30)[0];
  assert.ok(beach.itemIds.includes('sh') && !beach.itemIds.includes('j'), 'beach picks shorts, not jeans');
  console.log('PASS: match percent separates strong and weak looks, criteria name the problem, gaps are concrete, all occasions × styles');
}

{
  // Сгенерированный лук хранит готовый текст с подставленными значениями — перевести его
  // потом уже нельзя, поэтому язык интерфейса передаётся в buildLooks.
  require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText, filename);
  const Module = require('node:module');
  const load = Module._load;
  Module._load = (request, parent, main) => request === '@react-native-async-storage/async-storage' ? { default: { getItem: async () => null, setItem: async () => {} } } : load(request, parent, main);
  const i18n = require('../src/constants/i18n.tsx');
  const coat = item('coat', 'Пальто', 'Верхняя одежда', { season: 'Зима' });
  const check = (lang, expectTitle) => {
    i18n.setActiveLang(lang);
    const look = buildLooks([shirt, jeans, shoes, coat], 'Кэжуал', 'Прогулка', '', 5, 'male', false, { t: i18n.translate })[0];
    assert.equal(look.title, expectTitle);
    for (const text of [...look.fitReasons, ...look.stylingTips, ...look.warnings]) assert.ok(!/[А-Яа-яЁё]{3}/.test(text.replace(/(Рубашка|Джинсы|Кеды|Пальто) \w+/g, '')), `${lang}: ${text}`);
  };
  check('en', 'Shirt + Jeans');
  check('zh', `${i18n.translateIn('zh', 'Рубашка')} + ${i18n.translateIn('zh', 'Джинсы')}`);
  i18n.setActiveLang('ru');
  console.log('PASS: generated looks are written in the interface language');
}

{
  // A garment added a day ago must reach the ideas even when the wardrobe
  // already has many equally good ones; after two weeks it competes as usual.
  const { noveltyBonus } = require('../src/domain/outfits.ts');
  const now = Date.UTC(2026, 8, 30);
  const tops = Array.from({ length: 12 }, (_, i) => item(`old-top-${i}`, 'Футболка', 'Верх'));
  const fresh = item(String(now - 86_400_000), 'Футболка', 'Верх');
  const wardrobe = [...tops, fresh, jeans, shoes];
  const looks = buildLooks(wardrobe, 'Кэжуал', 'Прогулка', '', 20, 'male', false, { now });
  assert.ok(looks.some(look => look.itemIds.includes(fresh.id)), 'a new top appears in the ideas');
  assert.ok(noveltyBonus(fresh, now) > 3.5 && noveltyBonus(fresh, now + 20 * 86_400_000) === 0);
  assert.equal(noveltyBonus(tops[0], now), 0, 'demo and imported ids get no bonus');
  console.log('PASS: a newly added garment reaches the ideas, the head start fades in two weeks');
}
