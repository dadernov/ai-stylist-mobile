// The wardrobe rail's decisions: flicks are never lost, ends and small lists hold, the swing stays bounded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const m = require('../src/components/studio/railMotion.ts');

const open = { min: -Infinity, max: Infinity };
const snap = args => m.snapTarget({ anchor: 5, origin: 5, ...open, ...args });
// A placed drop goes to the nearest piece.
assert.equal(snap({ position: 5.4, velocityX: 0 }), 5);
assert.equal(snap({ position: 5.6, velocityX: 0.1 }), 6);
// A flick left moves forward however short the drag was; a flick right moves back.
assert.equal(snap({ position: 5.05, velocityX: -1 }), 6);
assert.equal(snap({ position: 4.95, velocityX: 1 }), 4);
// A flick during the previous landing counts on top of it, in both directions of the anchor.
assert.equal(snap({ position: 4.5, origin: 4.3, velocityX: -1 }), 6, 'second flick is not swallowed');
assert.equal(snap({ position: 5.5, origin: 5.7, anchor: 6, velocityX: 1 }), 5);
// Ten flicks in a row, each begun mid-flight, advance ten pieces.
let anchor = 0;
for (let flick = 0; flick < 10; flick++) {
  const origin = anchor - 0.6;
  anchor = m.snapTarget({ position: origin + 0.1, velocityX: -1.2, anchor, origin, ...open });
}
assert.equal(anchor, 10);
// Dragging back then flicking forward returns to the piece it left.
assert.equal(snap({ position: 4.6, velocityX: -1 }), 5);
// A dragged-through piece is not landed behind.
assert.equal(snap({ position: 6.3, velocityX: -1 }), 7);
// The hardest flick is bounded, and ends hold.
assert.ok(snap({ position: 5.1, velocityX: -9 }) - 5 <= m.MAX_FLICK_STEPS);
assert.ok(snap({ position: 5.1, velocityX: -9 }) >= 7, 'a hard flick travels further');
assert.equal(m.snapTarget({ position: 1, velocityX: -3, anchor: 1, origin: 1, min: 0, max: 1 }), 1);
assert.equal(m.snapTarget({ position: 0, velocityX: 3, anchor: 0, origin: 0, min: 0, max: 1 }), 0);

// Lists of every small size.
assert.deepEqual(m.railWindow(7, 0, 0), []);
assert.deepEqual(m.railWindow(7, 0, 1), [7]);
assert.deepEqual(m.railWindow(7, 0, 2), [7, 8]);
assert.deepEqual(m.railWindow(8, 1, 2), [7, 8]);
assert.equal(m.railWindow(4, 0, 3).length, 7);
assert.deepEqual(m.railBounds(4, 1, 2), { min: 3, max: 4 });
assert.deepEqual(m.railBounds(4, 0, 1), { min: 4, max: 4 });
assert.equal(m.railBounds(4, 0, 3).max, Infinity);
assert.equal(m.mod(-1, 5), 4);
assert.equal(m.mod(3, 0), 0);

// The rubber band follows inside the rail, and gives less than the reach past it.
assert.equal(m.rubberBand(0.5, 0, 1), 0.5);
assert.ok(m.rubberBand(3, 0, 1) < 1.22 && m.rubberBand(3, 0, 1) > 1);
assert.ok(m.rubberBand(-3, 0, 1) > -0.22 && m.rubberBand(-3, 0, 1) < 0);
assert.ok(m.rubberBand(1.2, 0, 1) < m.rubberBand(1.6, 0, 1));

// The swing grows with speed, keeps its sign and never leaves its range.
assert.equal(m.swingFromVelocity(0), 0);
assert.ok(m.swingFromVelocity(0.5) < m.swingFromVelocity(2));
assert.ok(m.swingFromVelocity(-2) < 0);
assert.ok(Math.abs(m.swingFromVelocity(50)) <= 1);
assert.equal(m.swingKick(100), 6);
assert.equal(m.swingKick(-100), -6);
for (let at = -5; at < 5; at++) assert.ok(m.swingFactor(at) >= 0.85 && m.swingFactor(at) <= 1.15);

// One tick per piece passing the centre, none while wobbling at the same one.
assert.equal(m.centreTick(5.1, 5), null);
assert.equal(m.centreTick(5.5, 5), null);
assert.equal(m.centreTick(5.8, 5), 6);
assert.equal(m.centreTick(-1.1, 0), -1);

// The short way round, straight when the rail has ends.
assert.equal(m.shortestDelta(0, 9, 10), -1);
assert.equal(m.shortestDelta(9, 0, 10), 1);
assert.equal(m.shortestDelta(0, 3, 10), 3);
assert.equal(m.shortestDelta(1, 0, 2), -1);

// The strip stays within its content and centres what it can.
assert.equal(m.stripOffset(0, 20, 390), 0);
assert.equal(m.stripOffset(10, 20, 390), 16 + 700 + 30 - 195);
assert.equal(m.stripOffset(19, 20, 390), 20 * 70 + 32 - 390);
assert.equal(m.stripOffset(1, 2, 390), 0, 'a short strip does not scroll');

// Resting by section, not by item; anything unknown hangs.
for (const section of ['Обувь', 'Сумки', 'Аксессуары']) assert.equal(m.restingKind(section), 'stand');
for (const section of ['Верх', 'Низ', 'Верхняя одежда', 'Новый раздел', undefined]) assert.equal(m.restingKind(section), 'hang');

// A box fits the side by its longer edge; an unmeasured picture is a square.
assert.deepEqual(m.fitBox(0.5, 200), { width: 100, height: 200 });
assert.deepEqual(m.fitBox(2, 200), { width: 200, height: 100 });
assert.deepEqual(m.fitBox(undefined, 200), { width: 200, height: 200 });
assert.deepEqual(m.fitBox(0, 200), { width: 200, height: 200 });
// Native echoes count only off the finger and after the discard window.
assert.equal(m.echoCounts({ dragging: true, now: 100, staleUntil: 0 }), false);
assert.equal(m.echoCounts({ dragging: false, now: 100, staleUntil: 150 }), false);
assert.equal(m.echoCounts({ dragging: false, now: 150, staleUntil: 150 }), true);
assert.equal(m.nearestPlace(2.5, 0, 2), 2);
assert.equal(m.nearestPlace(-3.2, 0, 2), 0);
// The focused piece removed: the next one steps in, the last one's neighbour is the new last, an empty list stays at 0.
assert.equal(m.neighbourIndex(2, 5), 2);
assert.equal(m.neighbourIndex(4, 4), 3);
assert.equal(m.neighbourIndex(0, 0), 0);
console.log('wardrobe-rail: ok');
