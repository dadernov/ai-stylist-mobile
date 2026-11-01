const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { canTryOn, firstLookDecision, hasLocalHistory, magicView, nextStep, QUESTIONS, remoteHasCloset } = require('../src/components/onboarding/firstLookLogic.ts');
const { EVENTS, STYLES } = require('../src/domain/outfits.ts');

// Existing accounts never see it; an account that could not be checked sees it neither, and is asked again later.
assert.equal(firstLookDecision({ unreadable: false, local: true, remote: null }), 'hide-and-remember');
assert.equal(firstLookDecision({ unreadable: false, local: false, remote: true }), 'hide-and-remember');
assert.equal(firstLookDecision({ unreadable: false, local: false, remote: null }), 'hide');
assert.equal(firstLookDecision({ unreadable: true, local: false, remote: false }), 'hide');
assert.equal(firstLookDecision({ unreadable: false, local: false, remote: false }), 'show');
const none = { items: 0, photo: false, jobs: 0, looks: 0 };
assert.equal(hasLocalHistory(none), false);
for (const part of [{ items: 1 }, { photo: true }, { jobs: 1 }, { looks: 1 }]) assert.equal(hasLocalHistory({ ...none, ...part }), true);
assert.equal(remoteHasCloset({ items: [], profile: null }), false);
assert.equal(remoteHasCloset({ items: [{ deleted: true }], profile: { data: { gender: 'male', modelBlob: undefined } } }), false, 'a bare gender is not a history');
assert.equal(remoteHasCloset({ items: [{ deleted: false }], profile: null }), true);
assert.equal(remoteHasCloset({ items: [], profile: { data: { avatarBlob: 'b' } } }), true);

// A try-on starts only with both a photo and a garment.
assert.equal(nextStep('you', { hasPhoto: false, hasGarment: false }), 'garment');
assert.equal(nextStep('garment', { hasPhoto: true, hasGarment: true }), 'magic');
assert.equal(nextStep('garment', { hasPhoto: false, hasGarment: true }), 'app');
assert.equal(nextStep('garment', { hasPhoto: true, hasGarment: false }), 'app');

const item = (section, category) => ({ section, category, imageUri: 'x' });
assert.equal(canTryOn(item('Верх', 'Футболка')), true);
assert.equal(canTryOn(item('Аксессуары', 'Шапка')), true);
assert.equal(canTryOn(item('Аксессуары', 'Ремень')), false);
assert.equal(canTryOn({ ...item('Верх', 'Футболка'), imageUri: '' }), false);

assert.equal(magicView(undefined, false), 'starting');
assert.equal(magicView(undefined, true), 'failed');
assert.equal(magicView({ status: 'pending' }, false), 'waiting');
assert.equal(magicView({ status: 'retry' }, false), 'failed');
assert.equal(magicView({ status: 'failed' }, false), 'failed');
assert.equal(magicView({ status: 'succeeded', result: { imageUri: 'r' } }, false), 'ready');
assert.equal(magicView({ status: 'succeeded' }, false), 'failed');

// Answers must be values the ideas understand.
for (const option of QUESTIONS.find(q => q.id === 'style').options) assert.ok(STYLES.includes(option.value), option.value);
for (const option of QUESTIONS.find(q => q.id === 'event').options) assert.ok(EVENTS.includes(option.value), option.value);

// The flow lives behind the session and asks consent before any try-on; the old pre-login card is gone.
const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
assert.ok(!app.includes('<Onboarding'), 'no text-card onboarding before sign-in');
assert.ok(app.indexOf('<FirstLook') > app.indexOf('function AppContent'), 'the flow opens only inside the signed-in app');
const flow = fs.readFileSync(path.join(__dirname, '../src/components/onboarding/FirstLook.tsx'), 'utf8');
assert.ok(flow.indexOf('aiConsent.ensure()', flow.indexOf('const start = async')) < flow.indexOf('store.start('), 'consent comes before the try-on');
const storage = fs.readFileSync(path.join(__dirname, '../src/services/accountStorage.ts'), 'utf8');
assert.ok(storage.includes("'favoriteColors'"), 'deleting the account deletes the colour answer');
console.log('PASS: first look gate, steps, try-on eligibility, job views, question values, consent order');

{
  // «Подождать в приложении» hands the try-on to the small window, also when its id comes after the exit.
  const dock = fs.readFileSync(path.join(__dirname, '../src/components/GenerationDock.tsx'), 'utf8');
  assert.match(flow, /waiting\.current = true; onDone\('wardrobe', jobId\)/);
  assert.match(flow, /if \(waiting\.current\) onLateJob\(id\)/);
  assert.ok(flow.indexOf('askReadyNotificationPermission(', flow.indexOf('const start = async')) > flow.indexOf('aiConsent.ensure()', flow.indexOf('const start = async')), 'notifications are asked after the consent');
  assert.match(app, /initialDocked=\{firstLookJob\}/);
  assert.match(dock, /useState<string\[\]>\(\(\) => initialDocked \? \[initialDocked\] : \[\]\)/, 'in the dock from its first render, finished or not');
  // Once per account, and existing accounts are never shown it.
  assert.match(app, /accountKey\(next\.login, ONBOARDING_SEEN\)/);
  assert.match(app, /accountKey\(stored\.login, ONBOARDING_SEEN\), 'true'/, 'the old device flag goes to the signed-in account');
  assert.ok(storage.includes("'onboardingSeen'"), 'deleting the account deletes the flag');
  console.log('PASS: first try-on reaches the dock; onboarding is per account');
}
