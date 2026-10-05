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

{
  // Cool days bring layered looks: a T-shirt under a sweater, a shirt under a cardigan,
  // inside out as the try-on puts them on; never all four, never on a hot day.
  const it = (id, category, section, color) => item(id, category, section, { color });
  const W = [it('tee', 'Футболка', 'Верх', 'Белый'), it('longsleeve', 'Лонгслив', 'Верх', 'Черный'), it('shirt', 'Рубашка', 'Верх', 'Голубой'),
    it('hoodie', 'Худи', 'Верх', 'Серый'), it('sweater', 'Свитер', 'Верх', 'Бежевый'), it('cardigan', 'Кардиган', 'Верх', 'Коричневый'),
    it('jeans', 'Джинсы', 'Низ', 'Синий'), it('pants', 'Брюки', 'Низ', 'Черный'), it('sneakers', 'Кроссовки', 'Обувь', 'Белый'),
    it('boots', 'Ботинки', 'Обувь', 'Черный'), it('loafers', 'Лоферы', 'Обувь', 'Коричневый'), it('jacket', 'Куртка', 'Верхняя одежда', 'Черный'),
    it('trench', 'Тренч', 'Верхняя одежда', 'Бежевый')];
  const byId = Object.fromEntries(W.map(entry => [entry.id, entry]));
  const tops = look => look.itemIds.filter(id => byId[id].section === 'Верх');
  const order = { Футболка: 1, Лонгслив: 2, Рубашка: 3, Свитер: 4, Худи: 4, Кардиган: 5 };
  const cool = buildLooks(W, 'Кэжуал', 'Прогулка', '', 9, 'male', false, { precipitation: 'rain' });
  const layered = cool.filter(look => tops(look).length === 2);
  assert.ok(layered.length >= 1 && layered.length <= 2, 'a cool day brings some layered looks, not only them');
  for (const look of layered) {
    const [inner, over] = tops(look).map(id => byId[id].category);
    assert.ok(order[inner] < order[over], `${inner} goes under ${over}`);
    assert.ok(!(over === 'Худи' && inner === 'Рубашка') && !(over === 'Кардиган' && ['Свитер', 'Худи'].includes(inner)), 'no awkward pairs');
    assert.equal(look.title.split(' + ').length, 3, 'the title names both tops and the bottom');
  }
  assert.ok(buildLooks(W, 'Кэжуал', 'Прогулка', '', 25).every(look => tops(look).length === 1), 'no layers on a hot day');
  assert.ok(buildLooks(W, 'Кэжуал', 'Прогулка', '', null).every(look => tops(look).length === 1), 'no layers when the weather is unknown');
  console.log('PASS: cool days bring layered looks in their natural order, at most two of four, none when hot');
}

{
  // "Not now" is remembered: the look sinks in later ideas instead of coming back on top.
  const { lookCore } = require('../src/domain/outfits.ts');
  const tee = item('tee', 'Футболка', 'Верх'), polo = item('polo', 'Поло', 'Верх'), jeans2 = item('jeans2', 'Джинсы', 'Низ', { color: 'Синий' });
  const wardrobe = [tee, polo, jeans2, shoes];
  const first = buildLooks(wardrobe, 'Кэжуал', 'Прогулка', '', 20)[0];
  const core = lookCore(wardrobe.filter(entry => first.itemIds.includes(entry.id)));
  const later = buildLooks(wardrobe, 'Кэжуал', 'Прогулка', '', 20, 'male', false, { dismissed: [core] });
  assert.notEqual(lookCore(wardrobe.filter(entry => later[0].itemIds.includes(entry.id))), core, 'the dismissed look is no longer first');
  assert.equal(lookCore(wardrobe.filter(entry => later.at(-1).itemIds.includes(entry.id))), core, 'it sinks to the end, it is not banned');
  console.log('PASS: a look put aside with "Not now" sinks in later ideas');
}

{
  // Reasonable advice only (the user: "a polo with a shirt - what nonsense?"): layers come
  // from the pairs stylists wear, a vest never goes on bare skin, shorts wait for warm days.
  let n = 0;
  const it = (category, section, color, extra = {}) => item(`r${++n}`, category, section, { color, ...extra });
  const W = [it('Футболка', 'Верх', 'Белый'), it('Поло', 'Верх', 'Синий'), it('Рубашка', 'Верх', 'Голубой'), it('Худи', 'Верх', 'Серый'),
    it('Свитер', 'Верх', 'Бежевый'), it('Кардиган', 'Верх', 'Коричневый'), it('Жилет', 'Верх', 'Графит'), it('Майка', 'Верх', 'Белый'),
    it('Джинсы', 'Низ', 'Синий'), it('Брюки', 'Низ', 'Черный'), it('Шорты', 'Низ', 'Бежевый'), it('Кроссовки', 'Обувь', 'Белый'),
    it('Лоферы', 'Обувь', 'Коричневый'), it('Сандалии', 'Обувь', 'Бежевый'), it('Куртка', 'Верхняя одежда', 'Черный'), it('Пальто', 'Верхняя одежда', 'Бежевый')];
  const byId = Object.fromEntries(W.map(entry => [entry.id, entry]));
  const allowed = { Майка: ['Кардиган'], Футболка: ['Свитер', 'Кардиган', 'Жилет'], Рубашка: ['Свитер', 'Кардиган', 'Жилет', 'Свитшот'] };
  const { EVENTS, STYLES } = require('../src/domain/outfits.ts');
  for (const event of EVENTS) for (const style of STYLES) for (const temperature of [-5, 8, 12, 25]) {
    for (const look of buildLooks(W, style, event, '', temperature, 'male')) {
      const tops = look.itemIds.map(id => byId[id]).filter(entry => entry.section === 'Верх').map(entry => entry.category);
      if (tops.length === 2) assert.ok(allowed[tops[0]]?.includes(tops[1]), `${tops.join(' under ')} is a pair stylists wear`);
      if (tops.length === 1) assert.ok(!['Жилет', 'Кардиган'].includes(tops[0]), `${tops[0]} is never worn alone in a man's look`);
      if (temperature < 15 && event !== 'Спортзал') {
        assert.ok(!look.itemIds.some(id => ['Шорты', 'Сандалии'].includes(byId[id].category)), `no shorts or sandals at ${temperature}°C`);
        assert.ok(!(tops.length === 1 && tops[0] === 'Майка'), 'a tank top is no top of its own on a cool day');
      }
    }
  }
  // A vest chosen as the base of the ideas goes over a top that suits it.
  const vest = W.find(entry => entry.category === 'Жилет');
  for (const look of buildLooks(W, 'Кэжуал', 'Прогулка', '', 25, 'male', false, { anchorId: vest.id })) {
    assert.ok(look.itemIds.includes(vest.id));
    assert.ok(look.itemIds.some(id => ['Футболка', 'Рубашка'].includes(byId[id].category)), 'the vest has a top under it');
  }
  console.log('PASS: layers only in real pairs, no vest on bare skin, no shorts or sandals on cool days');
}

{
  // Tights: kept with the bottoms, worn under a skirt or a dress, never as trousers.
  const { canTuck } = require('../src/domain/garmentOptions.ts');
  const tights = item('tights', 'Колготки', 'Низ', { color: 'Черный' }), skirt = item('skirt', 'Юбка', 'Низ', { color: 'Черный' });
  const trousers = item('trousers', 'Брюки', 'Низ', { color: 'Черный' }), dress = item('dress2', 'Платье', 'Верх', { color: 'Черный' });
  const blouse = item('blouse', 'Блуза', 'Верх'), boots = item('boots', 'Сапоги', 'Обувь', { color: 'Черный' });
  const wardrobe = [tights, skirt, trousers, dress, blouse, boots];
  const byId = Object.fromEntries(wardrobe.map(entry => [entry.id, entry]));
  for (const temperature of [-3, 8, 25]) {
    for (const look of buildLooks(wardrobe, 'Классика', 'Работа', '', temperature, 'female')) {
      const categories = look.itemIds.map(id => byId[id].category);
      if (look.itemIds.includes('tights')) {
        assert.ok(categories.some(category => ['Юбка', 'Платье'].includes(category)), `tights only with a skirt or a dress: ${categories}`);
        assert.ok(!categories.includes('Брюки'), 'never under trousers');
        assert.ok(temperature < 15, 'tights wait for a cool day');
      } else if (temperature < 15) {
        assert.ok(!categories.some(category => ['Юбка', 'Платье'].includes(category)), `a skirt on a cool day comes with the tights: ${categories}`);
      }
      assert.ok(!(categories.includes('Колготки') && !categories.includes('Юбка') && !categories.includes('Платье') && categories.includes('Блуза')),
        'tights are never the bottom of a blouse');
    }
  }
  for (const look of buildLooks(wardrobe, 'Классика', 'Работа', '', 20, 'female', false, { anchorId: 'tights' })) {
    assert.ok(look.itemIds.includes('tights'), 'the ideas around tights wear them');
    assert.ok(look.itemIds.some(id => ['Юбка', 'Платье'].includes(byId[id].category)), 'with a skirt or a dress');
  }
  assert.ok(!canTuck(blouse, [blouse, tights]), 'a blouse is not tucked into tights');
  assert.ok(canTuck(blouse, [blouse, tights, skirt]));
  const cold = getOutfitAdvice([blouse, skirt, tights, boots], { style: '', event: '', temperature: 2 });
  const bare = getOutfitAdvice([blouse, skirt, boots], { style: '', event: '', temperature: 2 });
  assert.ok(all(cold).length < all(bare).length || !all(cold).includes(skirt.name), 'tights keep the legs of a skirt warm');
  console.log('PASS: tights go with skirts and dresses on cool days, never as the bottom');
}

{
  // What a garment is like comes from its own photo: a zip hoodie can be worn open, a pullover cannot;
  // a top with sleeves is not "sleeveless" because of its category.
  const { canFasten } = require('../src/domain/garmentOptions.ts');
  const { decodeTraits } = require('../src/domain/garmentTraits.ts');
  assert.equal(canFasten(item('zip', 'Худи', 'Верх', { traits: { opening: 'front' } })), true, 'a zip hoodie opens');
  assert.equal(canFasten(item('pull', 'Худи', 'Верх', { traits: { opening: 'none' } })), false, 'a pullover hoodie does not');
  assert.equal(canFasten(item('unread', 'Кардиган', 'Верх')), true, 'unread, the category decides');
  assert.equal(canFasten(item('unsure', 'Худи', 'Верх', { traits: { opening: null } })), false, 'unsure, the category decides');
  assert.deepEqual(decodeTraits({ sleeves: 'short', length: 'knee', opening: 'front', bulk: 7 }),
    { sleeves: 'short', length: null, opening: 'front', bulk: null }, 'only the values the server gives');
  assert.equal(decodeTraits('short'), undefined);
  console.log('PASS: options and sleeves follow each garment\'s photo, its category only when unread');
}
