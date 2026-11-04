// Thumbs on looks: a small capped nudge in the choice; a disliked look stays out; weather and occasion come first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { applyVote, buildTaste, decodeLookVotes, lookExact, stylistAvoid, TASTE_ITEM_CAP, TASTE_ORDER_CAP, TASTE_PAIR_CAP, tasteForOrder, tasteOfItem, tasteOfPairs, voteOf } = require('../src/domain/lookTaste.ts');
const { buildLooks, evaluateLook } = require('../src/domain/outfits.ts');

const item = (id, section, category, color = 'Белый', season = 'Круглый год') => ({ id, name: id, category, section, color, pattern: 'Однотонный', season, tags: [], imageUri: 'photo' });
const now = Date.UTC(2026, 10, 4);
const tee = item('tee', 'Верх', 'Футболка'), shirt = item('shirt', 'Верх', 'Рубашка', 'Голубой'), jeans = item('jeans', 'Низ', 'Джинсы', 'Синий'), chinos = item('chinos', 'Низ', 'Брюки', 'Бежевый');
const sneakers = item('sneakers', 'Обувь', 'Кроссовки'), loafers = item('loafers', 'Обувь', 'Лоферы', 'Чёрный'), bag = item('bag', 'Сумки', 'Сумка', 'Чёрный');
const wardrobe = [tee, shirt, jeans, chinos, sneakers, loafers, bag];

// The look is its clothes, not its bag; a vote is one tap and is replaced or taken back.
assert.equal(lookExact([tee, jeans, sneakers, bag]), lookExact([sneakers, jeans, tee]));
let votes = applyVote([], [tee, jeans, sneakers], 'like', now);
assert.equal(voteOf(votes, [tee, jeans, sneakers, bag]), 'like');
votes = applyVote(votes, [tee, jeans, sneakers], 'dislike', now);
assert.equal(votes.length, 1);
assert.equal(voteOf(votes, [tee, jeans, sneakers]), 'dislike');
assert.deepEqual(applyVote(votes, [tee, jeans, sneakers], null, now), []);
assert.equal(applyVote([], [bag], 'like', now).length, 0, 'a bag alone is no look');

// Stored votes: what cannot be read is left out, and the list is bounded.
assert.deepEqual(decodeLookVotes('x'), []);
assert.deepEqual(decodeLookVotes([{ exact: 'a', vote: 'meh', at: 1, pieces: [] }, null]), []);
assert.equal(decodeLookVotes(applyVote([], [tee, jeans], 'like', now)).length, 1);
let many = [];
for (let n = 0; n < 300; n++) many = applyVote(many, [item(`t${n}`, 'Верх', 'Футболка'), jeans], 'like', now);
assert.equal(many.length, 200);

// However many votes, each part keeps to its cap.
const strong = buildTaste(many, now);
assert.ok(Math.abs(tasteOfItem(strong, jeans)) <= TASTE_ITEM_CAP);
assert.equal(tasteOfItem(strong, jeans), TASTE_ITEM_CAP);
assert.equal(tasteOfPairs(strong, [item('t1', 'Верх', 'Футболка'), jeans]) <= TASTE_PAIR_CAP, true);
assert.ok(Math.abs(tasteForOrder(strong, [tee, jeans, sneakers, loafers])) <= TASTE_ORDER_CAP);
assert.equal(tasteOfItem(undefined, jeans), 0);
// An old vote counts less.
const fresh = buildTaste(applyVote([], [tee, jeans], 'like', now), now);
const old = buildTaste(applyVote([], [tee, jeans], 'like', now - 60 * 86_400_000), now);
assert.ok(Math.abs(old.categories.get('Джинсы') - fresh.categories.get('Джинсы') / 2) < 1e-9);

const look = (taste, temperature = 18, event = 'Прогулка', pieces = wardrobe) => buildLooks(pieces, 'Кэжуал', event, '', temperature, 'unspecified', false, { now, taste });
const exactOf = (generated, pieces = wardrobe) => lookExact(generated.itemIds.map(id => pieces.find(piece => piece.id === id)));

// No votes: exactly the old choice.
assert.deepEqual(look(undefined), look(buildTaste([], now)));

// A disliked look is never offered again, however it would score; taking the vote back returns it.
const first = look(undefined)[0];
const firstItems = first.itemIds.map(id => wardrobe.find(piece => piece.id === id));
const noFirst = applyVote([], firstItems, 'dislike', now);
const without = look(buildTaste(noFirst, now));
assert.ok(without.length, 'other looks are still offered');
assert.ok(without.every(other => exactOf(other) !== lookExact(firstItems)));
assert.ok(look(buildTaste(applyVote(noFirst, firstItems, null, now), now)).some(other => exactOf(other) === lookExact(firstItems)));

// A like moves a fitting look up among equals.
const offered = look(undefined);
const last = offered[offered.length - 1];
assert.notEqual(exactOf(last), exactOf(offered[0]));
let liked = [];
for (let n = 0; n < 5; n++) liked = applyVote(liked, last.itemIds.map(id => wardrobe.find(piece => piece.id === id)), 'like', now - n);
const after = look(buildTaste(liked, now));
assert.ok(after.findIndex(other => exactOf(other) === exactOf(last)) < offered.findIndex(other => exactOf(other) === exactOf(last)) || offered.length === 1 || after[0].matchPercent - last.matchPercent > TASTE_ORDER_CAP,
  'the liked look rises, unless the gap is above the cap');

// Votes never beat the weather: whatever is liked, a frost still gets the warm coat and closed shoes; heat still gets no coat.
const parka = item('parka', 'Верхняя одежда', 'Пуховик', 'Чёрный', 'Зима'), trench = item('trench', 'Верхняя одежда', 'Плащ', 'Бежевый');
const boots = item('boots', 'Обувь', 'Ботинки', 'Чёрный', 'Зима'), sandals = item('sandals', 'Обувь', 'Сандалии', 'Белый', 'Лето');
const sweater = item('sweater', 'Верх', 'Свитер', 'Серый', 'Зима'), sundress = item('sundress', 'Верх', 'Сарафан', 'Белый', 'Лето');
const seasons = [parka, trench, boots, sandals, sweater, sundress, tee, jeans];
let summerLover = [];
for (let n = 0; n < 200; n++) summerLover = applyVote(summerLover, [{ ...sundress, id: `sundress${n}` }, { ...sandals, id: `sandals${n}` }, trench], 'like', now);
let winterLover = [];
for (let n = 0; n < 200; n++) winterLover = applyVote(winterLover, [{ ...sweater, id: `sweater${n}` }, { ...boots, id: `boots${n}` }, parka], 'like', now);
const ids = generated => generated.itemIds;
summerLover = applyVote(summerLover, [sundress, sandals, trench], 'like', now);
winterLover = applyVote(winterLover, [sweater, boots, parka], 'like', now);
const weatherOf = (generated, temperature) => evaluateLook(generated.itemIds.map(id => seasons.find(piece => piece.id === id)), { style: 'Кэжуал', event: 'Прогулка', temperature }).criteria.find(entry => entry.key === 'weather').value;
for (const temperature of [-15, -5, 0]) {
  const plain = look(undefined, temperature, 'Прогулка', seasons)[0], tasted = look(buildTaste(summerLover, now), temperature, 'Прогулка', seasons)[0];
  assert.ok(!ids(tasted).includes('sandals') && !ids(tasted).includes('trench'), `no sandals or light coat at ${temperature}°`);
  assert.ok(ids(tasted).includes('parka') && ids(tasted).includes('boots'), `the warm coat and boots stay at ${temperature}°`);
  assert.ok(weatherOf(tasted, temperature) >= weatherOf(plain, temperature), `the weather fit is no worse at ${temperature}°`);
}
for (const temperature of [26, 32]) {
  const tasted = look(buildTaste(winterLover, now), temperature, 'Прогулка', seasons)[0];
  assert.ok(!ids(tasted).includes('parka') && !ids(tasted).includes('sweater') && !ids(tasted).includes('boots'), `no winter clothes at ${temperature}°`);
}

// Votes never beat the occasion: a suit stays first for an interview, whatever casual look is liked, and the gym stays sporty.
const blazer = item('blazer', 'Верхняя одежда', 'Пиджак', 'Чёрный'), trousers = item('trousers', 'Низ', 'Брюки', 'Чёрный'), oxford = item('oxford', 'Верх', 'Рубашка', 'Белый');
const hoodie = item('hoodie', 'Верх', 'Худи', 'Серый'), joggers = item('joggers', 'Низ', 'Спортивные штаны', 'Серый');
const dressy = [blazer, trousers, oxford, hoodie, joggers, sneakers, loafers];
let casual = [];
for (let n = 0; n < 100; n++) casual = applyVote(casual, [hoodie, joggers, sneakers], 'like', now - n);
const context = { style: 'Кэжуал', event: 'Собеседование', temperature: 18 };
const fitting = generated => generated.map(other => evaluateLook(other.itemIds.map(id => dressy.find(piece => piece.id === id)), context).criteria.find(entry => entry.key === 'occasion').status);
const plainInterview = look(undefined, 18, 'Собеседование', dressy), tastedInterview = look(buildTaste(casual, now), 18, 'Собеседование', dressy);
assert.notEqual(fitting(tastedInterview)[0], 'bad');
assert.equal(fitting(tastedInterview)[0], fitting(plainInterview)[0]);
assert.ok(look(buildTaste(casual, now), 18, 'Спортзал', dressy).every(other => !other.itemIds.includes('blazer')));

// What can go to the server stylist with no change on its side: only what to stay away from.
const disliking = applyVote(applyVote([], [tee, jeans], 'dislike', now), [shirt, chinos], 'like', now);
assert.deepEqual(stylistAvoid(disliking, ['x,y', 'jeans,tee']), ['jeans,tee', 'x,y']);
assert.equal(stylistAvoid(disliking, Array.from({ length: 50 }, (_, n) => `c${n}`)).length, 20);

console.log('PASS: look taste is bounded, disliked looks stay out, weather and occasion come first');
