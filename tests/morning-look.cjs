// The morning notification: off by default, only coming mornings, never a word about the weather, and a tap opens only this account's Ideas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { DEFAULT_MORNING, MORNING_DAYS, decodeMorningSettings, formatMorningTime, morningDates, opensIdeas, planMorning } = require('../src/domain/morningLook.ts');
const { zh } = require('../src/constants/translations.ts');
const { en } = require('../src/constants/translations.en.ts');

const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
const on = { enabled: true, hour: 8, minute: 0 };
const base = { settings: on, login: 'anna', name: 'Анна', hasClothes: true, lookFor: () => null, t };

assert.deepEqual(DEFAULT_MORNING, { enabled: false, hour: 8, minute: 0 });
assert.deepEqual(decodeMorningSettings(null), DEFAULT_MORNING);
assert.deepEqual(decodeMorningSettings({ enabled: 'yes', hour: 99, minute: -1 }), DEFAULT_MORNING);
assert.deepEqual(decodeMorningSettings({ enabled: true, hour: 7, minute: 30 }), { enabled: true, hour: 7, minute: 30 });
assert.equal(formatMorningTime({ hour: 8, minute: 5 }), '8:05');

// Before the hour today counts; after it, or too close to it, the first is tomorrow.
const before = new Date(2026, 10, 4, 7, 0), after = new Date(2026, 10, 4, 9, 0), close = new Date(2026, 10, 4, 7, 59, 30);
assert.equal(morningDates(before, 8, 0)[0].getDate(), 4);
assert.equal(morningDates(after, 8, 0)[0].getDate(), 5);
assert.equal(morningDates(close, 8, 0)[0].getDate(), 5);
assert.equal(morningDates(after, 8, 0).length, MORNING_DAYS);
assert.ok(morningDates(after, 8, 0).every(date => date.getHours() === 8 && date.getMinutes() === 0));
// Over a month's end.
assert.equal(morningDates(new Date(2026, 10, 30, 9, 0), 8, 0)[0].getMonth(), 11);

assert.deepEqual(planMorning({ ...base, now: before, settings: DEFAULT_MORNING }), [], 'off: nothing');
const asked = [];
const plan = planMorning({ ...base, now: before, lookFor: day => { asked.push(day); return 'свитшот и джинсы'; } });
assert.equal(plan.length, MORNING_DAYS);
assert.equal(new Set(plan.map(entry => entry.identifier)).size, MORNING_DAYS);
assert.ok(plan.every(entry => entry.identifier.startsWith('morning-look-')));
assert.equal(asked.length, 2, 'a look is named only for the nearest mornings');
assert.ok(plan[0].body.includes('свитшот и джинсы') && plan[1].body.includes('свитшот и джинсы'));
assert.ok(plan.slice(2).every(entry => !entry.body.includes('свитшот')), 'further mornings stay generic');
assert.equal(plan[0].title, 'Доброе утро, Анна');
assert.equal(planMorning({ ...base, now: before, name: '' })[0].title, 'Доброе утро');
assert.ok(plan.every(entry => opensIdeas(entry.data, 'anna')));

// Unknown look: a warm word; an empty wardrobe is told what would help, and no look is asked for.
const generic = planMorning({ ...base, now: before });
assert.ok(generic.every(entry => entry.body.length > 10));
let askedEmpty = 0;
const empty = planMorning({ ...base, now: before, hasClothes: false, lookFor: () => { askedEmpty++; return 'x'; } });
assert.equal(askedEmpty, 0);
assert.ok(empty.every(entry => entry.body.startsWith('Добавь')));

// No text it can say claims weather it cannot know, and no text says a try-on is ready. Every language.
const source = fs.readFileSync(path.join(__dirname, '../src/domain/morningLook.ts'), 'utf8');
const bodies = [...source.matchAll(/t\('([^']+)'/g)].map(match => match[1]);
assert.ok(bodies.length >= 5);
for (const body of bodies) {
  assert.ok(en[body] && zh[body], `translated: ${body}`);
  for (const text of [body, en[body], zh[body]]) assert.ok(!/погод|дожд|снег|холод|тепл|жар|°|weather|rain|snow|cold|warm|hot|sunny|天气|雨|雪|冷|热|примерк|try-on/i.test(text), `no such claim: ${text}`);
}

// Only this feature's taps, only this account's.
assert.equal(opensIdeas({ kind: 'morning-look', login: 'anna' }, 'boris'), false);
assert.equal(opensIdeas({}, 'anna'), false);
assert.equal(opensIdeas(undefined, 'anna'), false);

// Cancelled on every way out, and asked for only on enabling; purged with the account.
const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
assert.match(app, /else if \(hadSession\.current\) \{ hadSession\.current = false; void cancelMorningNotifications\(\); \}/);
const storageSource = fs.readFileSync(path.join(__dirname, '../src/services/accountStorage.ts'), 'utf8');
for (const key of ['lookVotes', 'morningLook', 'addQueue']) assert.ok(storageSource.includes(`'${key}'`), `${key} is purged with the account`);
const service = fs.readFileSync(path.join(__dirname, '../src/services/morningNotifications.ts'), 'utf8');
assert.ok(!/^import .*expo-notifications/m.test(service), 'loaded lazily');
assert.ok(!service.includes('cancelAllScheduledNotificationsAsync'), 'only its own are cancelled');
const hook = fs.readFileSync(path.join(__dirname, '../src/components/useMorningLook.ts'), 'utf8');
assert.ok(!/fetch|services\/ai'|analyzeTryOn/.test(hook), 'nothing goes to the network');

console.log('PASS: morning look plans only coming mornings, with no claim about the weather');
