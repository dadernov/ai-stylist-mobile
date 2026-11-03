// The wardrobe showcase's decisions: flicks are never lost, ends and small lists hold, the depth is continuous and symmetric.
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

// The depth: frontal in the centre, mirrored either side, and the same for every place on the rail.
const depth = m.depthKeyframes(5, 200, false);
assert.deepEqual(depth.rotateY.inputRange, [4, 5, 6]);
assert.equal(depth.rotateY.outputRange[1], '0deg');
const angle = parseFloat(depth.rotateY.outputRange[2]);
assert.ok(angle >= 35 && angle <= 45);
assert.equal(parseFloat(depth.rotateY.outputRange[0]), -angle);
assert.equal(depth.scale.outputRange[1], 1);
assert.equal(depth.scale.outputRange[0], depth.scale.outputRange[2]);
assert.ok(depth.scale.outputRange[0] < 1);
assert.deepEqual([depth.opacity.outputRange[0], depth.opacity.outputRange[4]], [0, 0], 'two places off is gone');
assert.equal(depth.opacity.outputRange[2], 1);
assert.deepEqual(depth.translateX, { inputRange: [4, 6], outputRange: [200, -200] }, 'the piece keeps to the finger: one pitch per place');
assert.deepEqual(m.depthKeyframes(9, 200, false).scale.outputRange, depth.scale.outputRange);
// Reduced motion only slides and fades.
const plain = m.depthKeyframes(5, 200, true);
assert.equal(plain.rotateY, undefined);
assert.equal(plain.scale, undefined);
assert.equal(plain.rise, undefined);
assert.ok(plain.opacity && plain.translateX);
// The light is the same ramp: the two pieces around the position always add up to the whole of it.
const ramp = (range, x) => x <= range.inputRange[0] || x >= range.inputRange[2] ? 0 : 1 - Math.abs(x - range.inputRange[1]);
for (const x of [5, 5.2, 5.5, 5.9]) assert.ok(Math.abs(ramp(m.depthKeyframes(5, 1, false).focus, x) + ramp(m.depthKeyframes(6, 1, false).focus, x) - 1) < 1e-9);

// The light going and the light coming, drawn over each other, cover nearly the whole of it at every point of a swipe.
const lit = (at, x) => {
  const { inputRange: i, outputRange: o } = m.depthKeyframes(at, 1, false).light;
  if (x <= i[0] || x >= i[4]) return 0;
  const k = i.findIndex((v, n) => x >= v && x <= i[n + 1]);
  return o[k] + (o[k + 1] - o[k]) * (x - i[k]) / (i[k + 1] - i[k]);
};
assert.equal(lit(5, 5), 1, 'all of it at rest');
assert.equal(lit(6, 5), 0, 'no neighbour\'s light at rest');
for (let x = 5; x <= 6; x += 0.05) {
  const together = 1 - (1 - lit(5, x)) * (1 - lit(6, x));
  assert.ok(together >= 0.93, `the light dips to ${together} at ${x}`);
  assert.ok(lit(5, x) + lit(6, x) >= 1 - 1e-9, `the two sum below the whole at ${x}`);
}
assert.ok(Math.abs(lit(5, 5.3) - lit(6, 5.7)) < 1e-9, 'symmetric');
assert.deepEqual(m.depthKeyframes(5, 1, true).light, m.depthKeyframes(5, 1, false).light);

// Reflections stay mounted two places out, so a swipe never meets one appearing.
assert.deepEqual([2, 3, 4, 5, 6, 7, 8].filter(at => m.showsReflection(at, 5)), [3, 4, 5, 6, 7]);
// Their copies are made for the whole mounted window, the focused piece's taken last off the list, i.e. first.
assert.deepEqual(m.windowIndices(5, 20), [8, 2, 7, 3, 6, 4, 5]);
assert.equal(m.windowIndices(0, 20).at(-1), 0);
assert.ok(m.windowIndices(0, 20).includes(17), 'around the end of a looping list');
assert.deepEqual(m.windowIndices(0, 0), []);
assert.deepEqual(m.windowIndices(0, 1), [0]);
assert.deepEqual(m.windowIndices(1, 2).sort(), [0, 1], 'a rail with ends goes no further than them');
assert.equal(m.windowIndices(1, 4).length, 4, 'a short looping list: each once');
assert.equal(m.windowIndices(1, 4).at(-1), 1);

// The stage holds the piece and its reflection at any height, and the floor is where the piece ends.
for (const height of [220, 320, 420, 700]) {
  const g = m.showcaseGeometry(height, 390);
  assert.ok(g.top + g.side + g.reflection <= height);
  assert.equal(g.floorY, g.top + g.side);
  assert.ok(g.reflection > 0);
  assert.ok(g.side <= 300);
}
assert.ok(m.showcaseGeometry(400, 390, true).pitch > m.showcaseGeometry(400, 390).pitch, 'flat neighbours sit farther out');
// A print's picture is centred in its box.
const printed = m.printRect({ width: 100, height: 100 });
assert.ok(Math.abs(printed.x - 8) < 1e-9 && Math.abs(printed.y - 4) < 1e-9 && Math.abs(printed.width - 84) < 1e-9 && Math.abs(printed.height - 92) < 1e-9);
console.log('wardrobe-rail: ok');
