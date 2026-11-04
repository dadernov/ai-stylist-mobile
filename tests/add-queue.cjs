// Several photos at once: one at a time, retry per photo, cancel, and never a second paid flat for the same photo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const q = require('../src/domain/addQueue.ts');

let n = 0;
const makeId = () => `e${++n}`;
const start = count => q.enqueue([], Array.from({ length: count }, (_, i) => `file://${i}.jpg`), makeId).queue;
const stages = queue => queue.map(entry => entry.stage);

// Bounded; the rest is counted, not lost silently.
const big = q.enqueue([], Array.from({ length: 13 }, (_, i) => `u${i}`), makeId);
assert.equal(big.queue.length, q.MAX_BATCH);
assert.equal(big.dropped, 3);
assert.equal(q.roomInQueue(big.queue), 0);
const topUp = q.enqueue(big.queue, ['more'], makeId);
assert.equal(topUp.dropped, 1);
assert.equal(topUp.queue.length, q.MAX_BATCH);
assert.ok(big.queue.every(entry => entry.stage === 'waiting' && entry.askFlat));

// One at a time, in order; the next waits for the flat too.
let queue = start(3);
const [a, b, c] = queue.map(entry => entry.id);
assert.equal(q.nextToRun(queue).id, a);
queue = q.markAnalyzing(queue, a);
assert.equal(q.nextToRun(queue), null, 'none while one is being read');
queue = q.markLanded(queue, a, 'item-a', false, true);
assert.equal(queue[0].stage, 'flat');
assert.equal(q.nextToRun(queue), null, 'none while its paid flat is being made');
assert.equal(q.queueSummary(queue).landed, 1, 'in the wardrobe before the flat');
queue = q.markFlatSettled(queue, a, true);
assert.equal(q.nextToRun(queue).id, b);

// A low-confidence photo is flagged; failure is per photo, and a retry goes without a second flat.
queue = q.markAnalyzing(queue, b);
queue = q.markLanded(queue, b, 'item-b', true, false);
assert.equal(queue[1].stage, 'done');
assert.equal(q.queueSummary(queue).review, 1);
queue = q.markAnalyzing(queue, c);
queue = q.markFailed(queue, c, 'network');
assert.equal(queue[2].stage, 'failed');
assert.equal(queue[2].askFlat, false, 'that flat may be paid for already');
assert.equal(q.nextToRun(queue), null, 'a failed one does not run by itself');
assert.equal(q.queueSummary(queue).active, false);
queue = q.retryEntry(queue, c);
assert.equal(q.nextToRun(queue).id, c);
assert.equal(queue[2].askFlat, false);
assert.equal(queue[2].error, undefined);
queue = q.markAnalyzing(queue, c);
queue = q.markLanded(queue, c, 'item-c', false, false);

// Counted per batch: only flats really made are paid; analysis runs on the host.
const summary = q.queueSummary(queue);
assert.deepEqual([summary.total, summary.landed, summary.failed, summary.flats], [3, 3, 0, 1]);
assert.equal(summary.costUsd, 0.027);
let full = start(10);
for (const entry of full) { full = q.markAnalyzing(full, entry.id); full = q.markLanded(full, entry.id, `i${entry.id}`, false, true); full = q.markFlatSettled(full, entry.id, true); }
assert.equal(q.queueSummary(full).costUsd, 0.27, 'at most 10 flats a batch');

// Waiting for consent keeps the flat: nothing has been sent yet.
let consent = start(2);
consent = q.markFailed(consent, consent[0].id, 'consent');
assert.equal(consent[0].askFlat, true);
consent = q.retryFailed(consent, 'consent');
assert.equal(consent[0].stage, 'waiting');

// Leaving the app: the cut-off photo runs again by itself, without a second flat; the rest wait with theirs.
let leaving = start(2);
leaving = q.markAnalyzing(leaving, leaving[0].id);
leaving = q.markInterrupted(leaving, leaving[0].id);
assert.deepEqual(stages(leaving), ['waiting', 'waiting']);
assert.deepEqual(leaving.map(entry => entry.askFlat), [false, true]);

// A closed app, read back: what was being read goes again without a flat, what waited for a flat is simply done (its card keeps the cut-out).
let closed = start(3);
closed = q.markAnalyzing(closed, closed[0].id);
closed = q.markLanded(closed, closed[0].id, 'i', false, true);
closed = q.markAnalyzing(closed, closed[1].id);
const reread = q.recoverQueue(q.decodeAddQueue(JSON.parse(JSON.stringify(closed))));
assert.deepEqual(stages(reread), ['done', 'waiting', 'waiting']);
assert.deepEqual(reread.map(entry => entry.askFlat), [true, false, true]);
assert.equal(reread[0].itemId, 'i');
assert.deepEqual(q.decodeAddQueue('junk'), []);
assert.deepEqual(q.decodeAddQueue([{ id: 'x' }, null, { id: 'x', uri: 'u', stage: 'nonsense' }]), []);

// Cancel: nothing further starts, an item in the wardrobe stays, a flat being made still finishes.
let stop = start(4);
stop = q.markAnalyzing(stop, stop[0].id);
stop = q.markLanded(stop, stop[0].id, 'kept', false, true);
stop = q.markFlatSettled(stop, stop[0].id, true);
stop = q.markAnalyzing(stop, stop[1].id);
stop = q.markLanded(stop, stop[1].id, 'kept2', false, true);
const cancelled = q.cancelQueue(stop);
assert.deepEqual(stages(cancelled), ['done', 'flat', 'cancelled', 'cancelled']);
assert.equal(q.nextToRun(q.markFlatSettled(cancelled, cancelled[1].id, true)), null);
let reading = start(1);
reading = q.markAnalyzing(reading, reading[0].id);
assert.deepEqual(stages(q.cancelQueue(reading)), ['cancelled'], 'a photo being read does not land');

// A result that comes after a cancel cannot fail or requeue it.
const late = q.cancelQueue(reading);
assert.deepEqual(stages(q.markFailed(late, late[0].id, 'network')), ['cancelled']);
assert.deepEqual(stages(q.markInterrupted(late, late[0].id)), ['cancelled']);

// A finished batch: the next one starts clean; what can be retried stays and keeps its place.
const done = q.markFlatSettled(q.markLanded(q.markAnalyzing(start(1), `e${n}`), `e${n}`, 'i', false, true), `e${n}`, false);
assert.equal(q.enqueue(done, ['new'], makeId).queue.length, 1);
let withFailed = start(2);
withFailed = q.markFailed(withFailed, withFailed[0].id, 'network');
withFailed = q.markLanded(q.markAnalyzing(withFailed, withFailed[1].id), withFailed[1].id, 'i', false, false);
const again = q.enqueue(withFailed, ['new'], makeId).queue;
assert.deepEqual(stages(again), ['failed', 'waiting']);
assert.equal(q.clearFinished(withFailed).length, 0, 'closing the strip empties it');

assert.equal(q.needsCheck({ needsReview: true }), true);
assert.equal(q.needsCheck({ backgroundRemoved: false }), true);
assert.equal(q.needsCheck({ backgroundRemoved: true }), false);
assert.equal(q.needsCheck({}), false);

// The single add is not touched: its picker still crops one photo, and only the batch asks for several.
const picker = fs.readFileSync(path.join(__dirname, '../src/components/usePhotoPicker.tsx'), 'utf8');
assert.ok(!picker.includes('allowsMultipleSelection'));
const screen = fs.readFileSync(path.join(__dirname, '../src/screens/WardrobeScreen.tsx'), 'utf8');
assert.match(screen, /aiConsent\.ensure\(\)\)\) \{ Alert\.alert\(t\('Нужно согласие'\)[\s\S]*allowsMultipleSelection: true, selectionLimit: room/, 'the consent comes before the gallery');

// A photo over the limit: its own error, no retry, no place taken; a path written down before an update is re-anchored on reading.
{
  assert.equal(q.requestOutcome(413, false), 'tooLarge');
  assert.equal(q.requestOutcome(413, true), 'tooLarge');
  assert.equal(q.requestOutcome(500, false), 'network');
  assert.equal(q.requestOutcome(undefined, false), 'network');
  assert.equal(q.requestOutcome(undefined, true), 'interrupted');
  const running = q.markAnalyzing(q.enqueue([], ['x'], () => 'big').queue, 'big');
  const big413 = q.markFailed(running, 'big', 'tooLarge');
  assert.equal(big413[0].error, 'tooLarge');
  assert.equal(q.canRetry(big413[0]), false);
  assert.deepEqual(q.retryEntry(big413, 'big'), big413);
  assert.deepEqual(q.retryFailed(big413), big413);
  assert.equal(q.roomInQueue(big413), q.MAX_BATCH);
  assert.equal(q.queueSummary(big413).retryable, 0);
  assert.equal(q.queueSummary(big413).failed, 1);
  assert.equal(q.decodeAddQueue(JSON.parse(JSON.stringify(big413)))[0].error, 'tooLarge');
  const network = q.markFailed(running, 'big', 'network');
  assert.equal(q.retryEntry(network, 'big')[0].stage, 'waiting');

  assert.equal(q.uploadResize(4096, 3000), null);
  assert.deepEqual(q.uploadResize(6000, 4000), { width: 4096 });
  assert.deepEqual(q.uploadResize(4000, 6000), { height: 4096 });

  const stored = [{ id: 'a', uri: 'old/photos/a.jpg', stage: 'waiting', askFlat: true }, { id: 'b', uri: 'bad', stage: 'waiting', askFlat: true }];
  const anchored = q.decodeAddQueue(stored, uri => uri === 'bad' ? undefined : uri.replace('old', 'new'));
  assert.deepEqual(anchored.map(entry => entry.uri), ['new/photos/a.jpg']);
  const hook = fs.readFileSync(path.join(__dirname, '../src/components/useAddQueue.ts'), 'utf8');
  assert.match(hook, /decodeAddQueue\(value, reanchorPhoto\)/);
  assert.ok(!/loadValidated\([^)]*, decodeAddQueue\)/.test(hook), 'every read of the queue re-anchors');
  const manipulated = hook.match(/async function uprightCopy[\s\S]*?\n}\n/)[0];
  for (const name of ['source', 'rendered', 'scaling', 'resized']) assert.match(manipulated, new RegExp(`finally \\{ ${name}\\.release\\(\\); \\}`));
  assert.ok(!/compress: 1\b/.test(manipulated));
}

// Dialogs change the newest list, so what the queue landed while they were open stays.
{
  const screen = fs.readFileSync(path.join(__dirname, '../src/screens/WardrobeScreen.tsx'), 'utf8');
  const calls = screen.match(/onItemsChange\([^\n]*/g);
  assert.ok(calls.length >= 5);
  calls.forEach(call => assert.match(call, /onItemsChange\(\(?latest\)? =>/, call));
}

console.log('PASS: add queue runs one photo at a time and never pays twice for a flat');
