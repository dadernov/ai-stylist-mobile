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

// The strip: loops only when it does not fit; each copy shows its piece; going round has no end to meet.
assert.equal(m.stripLoops(5, 390), false, 'five fit on a phone');
assert.equal(m.stripLoops(6, 390), true);
assert.equal(m.stripLoops(0, 390), false);
assert.equal(m.stripRun(24) % 24, 0);
assert.ok(m.stripRun(7) > 19000);
for (const count of [6, 7, 24, 500]) for (const index of [0, 3, count - 1]) {
  const mid = m.stripMiddle(index, count);
  assert.equal(m.mod(mid, count), index);
  assert.ok(Math.abs(mid - m.stripRun(count) / 2) <= count, 'starts in the middle of the run');
}
// Offset and copy are inverses; the middle of the view is the middle of the copy, as iOS snaps to with snapToAlignment center.
assert.equal(m.offsetToCopy(m.copyOffset(123, 390), 390), 123);
assert.equal(m.copyOffset(10, 390) + 390 / 2, 10 * 70 + 35);
{
  const interval = 70, frame = 390;
  const alignment = frame * 0.5 + interval * 0.5; // RCTEnhancedScrollView.mm
  const snapped = Math.round((m.copyOffset(50, frame) + 12 + alignment) / interval) * interval - alignment;
  assert.equal(m.offsetToCopy(snapped, frame) % 1, 0, 'a native snap point is a whole copy');
}
// The nearest copy goes the short way, across the join too.
assert.equal(m.nearestCopy(240, 1, 24), 241);
assert.equal(m.nearestCopy(240, 23, 24), 239, 'back across the join');
assert.equal(m.nearestCopy(263, 0, 24), 264, 'forward across the join');
assert.equal(m.nearestCopy(240, 0, 24), 240);
// At rest: left alone near the middle, moved silently to the same piece when far.
{
  const count = 24, mid = m.stripMiddle(5, count);
  assert.equal(m.recentred(mid + count, count), mid + count);
  const far = mid + count * Math.ceil(m.stripRun(count) / 3 / count);
  const back = m.recentred(far, count);
  assert.equal(back, mid);
  assert.equal(m.mod(back, count), m.mod(far, count), 'the same piece, so the jump cannot be seen');
}
// The shift between strip and rail keeps the piece the same on both, and stays by the rail.
for (const [strip, now, center, index, count] of [[245, 7, 7, 5, 24], [240.3, -3.2, -3, 11, 24], [1000, 500, 500, 2, 7]]) {
  const shift = m.stripShift(strip, now, center, index, count);
  assert.ok(Number.isInteger(shift));
  assert.ok(Math.abs(strip + shift - now) <= count / 2);
  assert.equal(m.mod(index + Math.round(strip + shift) - center, count), m.mod(Math.round(strip), count));
}
// The stage is on the strip up to its speed and behind it above; a skip closes the gap, not too often.
assert.equal(m.stageFollow(5, 5.1, 16), 5.1);
assert.ok(Math.abs(m.stageFollow(5, 9, 16) - (5 + m.STAGE_MAX_SPEED * 0.016)) < 1e-9);
assert.ok(m.stageFollow(5, 1, 16) < 5);
assert.ok(m.stageFollow(5, 9, 5000) < 6, 'a stalled frame is no leap');
assert.equal(m.stageSkip(5, 5.5, 1000), 0);
assert.equal(m.stageSkip(5, 9.4, 50), 0, 'throttled');
assert.equal(m.stageSkip(5, 9.4, 200), 4);
assert.equal(m.stageSkip(5, 1, 200), -4);
{ // A long spin: renders stay bounded, and the stage ends beside what the strip shows.
  let strip = 240, shown = 0, shift = -240, lastSkip = -1e9, commits = 0, t = 0, speed = 60;
  while (speed > 0.05) {
    t += 16; strip += speed * 0.016; speed *= 0.985;
    const target = strip + shift;
    shown = m.stageFollow(shown, target, 16);
    const k = m.stageSkip(shown, target, t - lastSkip);
    if (k) { shift -= k; lastSkip = t; commits++; }
  }
  assert.ok(commits / (t / 1000) <= 1000 / m.STAGE_SKIP_GAP_MS + 1);
  assert.ok(Math.abs(strip + shift - shown) < 2);
}
// Ticks: for a new piece only, throttled.
assert.equal(m.stripTick(5.2, 5, 1000, 0), null);
assert.equal(m.stripTick(5.6, 5, 1000, 0), 6);
assert.equal(m.stripTick(5.6, 5, 1000, 990), null);

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
assert.deepEqual([depth.opacity.outputRange[0], depth.opacity.outputRange.at(-1)], [0, 0], 'two places off is gone');
assert.equal(depth.opacity.outputRange[3], 1);
assert.deepEqual(depth.opacity.outputRange, [...depth.opacity.outputRange].reverse(), 'symmetric');
assert.ok(depth.opacity.outputRange[2] >= 0.9, 'a piece near the centre keeps its true colour');
assert.ok(depth.opacity.inputRange.every((v, n, all) => n === 0 || v > all[n - 1]));
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

// A spin's phases: fast above the top line, its tail only below the lower one, nothing back and forth around either.
assert.ok(m.SPIN_CALM_SPEED >= 4 && m.SPIN_CALM_SPEED <= 5 && m.SPIN_CALM_SPEED < m.SPIN_SPEED);
assert.equal(m.nextSpinPhase('calm', m.SPIN_SPEED - 1), 'calm', 'a slow drag is no spin');
assert.equal(m.nextSpinPhase('calm', 3), 'calm', 'and has no tail');
assert.equal(m.nextSpinPhase('calm', m.SPIN_SPEED + 1), 'fast');
assert.equal(m.nextSpinPhase('fast', 7), 'fast', 'between the lines it stays');
assert.equal(m.nextSpinPhase('fast', m.SPIN_CALM_SPEED - 0.1), 'tail');
assert.equal(m.nextSpinPhase('tail', 7), 'tail', 'between the lines it stays');
assert.equal(m.nextSpinPhase('tail', 0), 'tail', 'only the end of the spin makes it calm');
assert.equal(m.nextSpinPhase('tail', m.SPIN_SPEED + 1), 'fast', 'a new flick on the same spin');

// A strip left off its piece: the near copy, a short glide or a jump, never the long way back.
assert.deepEqual(m.stripReturn(1002, 2, 20), { copy: 1002, animated: true, aligned: true }, 'there already');
assert.equal(m.stripReturn(1002.5, 2, 20).aligned, false);
assert.equal(m.stripReturn(1003, 2, 20).copy, 1002);
assert.equal(m.stripReturn(1003, 2, 20).animated, true);
assert.equal(m.stripReturn(1000 + m.STRIP_GLIDE_BACK, 0, 20).animated, true);
const farBack = m.stripReturn(1000 + m.STRIP_GLIDE_BACK + 1, 0, 20);
assert.equal(farBack.copy, 1000);
assert.equal(farBack.animated, false);
assert.equal(m.stripReturn(1019, 0, 20).copy, 1020, 'around the end of the list, the short way');
console.log('wardrobe-rail: ok');
