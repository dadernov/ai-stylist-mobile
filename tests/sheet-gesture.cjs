// Sheet drag/handle decisions: a real tap only closes, a blocked dismiss rubber-bands and springs back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { isTap, dragOffset, releaseCloses, startTrack, stepTrack, dragFree, grabOffset, addSample, releaseVelocity, springVelocity, scrollAtTop, isZoomed } = require('../src/components/studio/sheetGesture.ts');

assert.equal(isTap(0, 0, 100), true);
assert.equal(isTap(4, 3, 200), true);
assert.equal(isTap(40, 0, 150), false, 'horizontal drag is no tap');
assert.equal(isTap(20, 20, 150), false, 'diagonal drag is no tap');
assert.equal(isTap(0, 0, 900), false, 'long press is no tap');

assert.equal(dragOffset(100, true), 100);
assert.equal(dragOffset(-50, true), 0);
const band = dragOffset(300, false);
assert.ok(band > 0 && band < 60, 'blocked drag only rubber-bands: ' + band);
assert.ok(dragOffset(100, false) < dragOffset(300, false));

const base = { height: 400, threshold: 0.25, velocity: 0.8 };
assert.equal(releaseCloses({ ...base, dy: 200, vy: 0, canDismiss: true }), true);
assert.equal(releaseCloses({ ...base, dy: 20, vy: 2, canDismiss: true }), true);
assert.equal(releaseCloses({ ...base, dy: 20, vy: 0, canDismiss: true }), false);
assert.equal(releaseCloses({ ...base, dy: 300, vy: 3, canDismiss: false }), false);
assert.equal(releaseCloses({ ...base, dy: 200, vy: -2, canDismiss: true }), false, 'flicked back up stays open');

// Who owns a touch.
const run = (moves, from = [100, 100]) => {
  let track = startTrack(...from), claim = false;
  for (const m of moves) { const r = stepTrack(track, { touches: 1, free: true, ...m }); track = r.track; claim = r.claim; if (claim) break; }
  return claim;
};
assert.equal(run([{ x: 100, y: 104 }]), false, 'within the slop nothing happens: taps survive');
assert.equal(run([{ x: 100, y: 110 }]), true, 'a vertical pull takes the sheet');
assert.equal(run([{ x: 100, y: 90 }]), false, 'an upward drag never does');
assert.equal(run([{ x: 130, y: 105 }, { x: 130, y: 200 }]), false, 'a horizontal swipe keeps the pager for the whole touch');
assert.equal(run([{ x: 108, y: 108 }]), false, 'a diagonal is nobody\'s yet');
assert.equal(run([{ x: 102, y: 108 }]), true, 'slightly slanted still counts');
assert.equal(run([{ x: 100, y: 120, touches: 2 }]), false, 'a pinch never moves the sheet');
assert.equal(run([{ x: 100, y: 120, touches: 2 }, { x: 100, y: 160 }]), false, 'nor does what is left of it');
assert.equal(run([{ x: 100, y: 60 }, { x: 100, y: 68 }]), true, 'reversing at the top pulls from the turning point');
// Handoff: a list scrolled down reaches its top during the same gesture.
assert.equal(run([{ x: 100, y: 180, free: false }, { x: 100, y: 183 }]), false, 'travel spent on scrolling does not count');
assert.equal(run([{ x: 100, y: 180, free: false }, { x: 100, y: 190 }]), true, 'the pull past the top moves the sheet');

const free = { blocked: false, inert: false, body: true, grabbed: false, scrollerAtTop: true };
assert.equal(dragFree(free), true);
assert.equal(dragFree({ ...free, scrollerAtTop: false }), false, 'a scrolled list keeps the touch');
assert.equal(dragFree({ ...free, inert: true }), false, 'a zoomed photo or focused input keeps the touch');
assert.equal(dragFree({ ...free, blocked: true }), false, 'a window on top keeps the sheet still');
assert.equal(dragFree({ ...free, body: false }), false, 'an unreported list: the body does not drag');
assert.equal(dragFree({ ...free, body: false, grabbed: true }), true, 'but the handle and header do');

// No jump on grab: the sheet starts at 0 however far the finger went before the claim, or where it was caught.
assert.equal(grabOffset(110, 110, 0), 0);
assert.equal(grabOffset(150, 110, 0), 40);
assert.equal(grabOffset(110, 110, 30), 30);
assert.equal(grabOffset(50, 110, 0), 0, 'never above its place');

let samples = [];
for (const [t, y] of [[0, 0], [16, 16], [32, 32]]) samples = addSample(samples, { t, y });
assert.equal(releaseVelocity(samples, 40), 1);
assert.equal(releaseVelocity(samples, 500), 0, 'a finger at rest has no speed');
assert.equal(releaseVelocity([], 10), 0);
assert.equal(addSample(samples, { t: 500, y: 90 }).length, 1, 'old moves are dropped');
assert.equal(springVelocity(1.5), 1500, 'px/ms into px/s');
assert.equal(springVelocity(100), 5000);
assert.equal(springVelocity(-100), -5000);

assert.equal(scrollAtTop(0), true);
assert.equal(scrollAtTop(-20), true);
assert.equal(scrollAtTop(12), false);
assert.equal(isZoomed(1), false);
assert.equal(isZoomed(undefined), false);
assert.equal(isZoomed(1.5), true);
console.log('sheet-gesture: ok');
