// The try-on picture: the rounded container is the picture's own rect, before and after share it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { aspectOf, FALLBACK_ASPECT, fitRect, frameAspect, heldAspect, heldHeight, MEASURE_TIMEOUT_MS, measureAspect, pictureFit, rememberAspect } = require('../src/components/studio/imageFit.ts');

assert.deepEqual(fitRect(3 / 4, 300, 600), { x: 0, y: 100, width: 300, height: 400 }, 'a narrow box: full width, centred vertically');
assert.deepEqual(fitRect(3 / 4, 600, 400), { x: 150, y: 0, width: 300, height: 400 }, 'a wide box: full height, centred sideways');
assert.deepEqual(fitRect(1, 200, 200), { x: 0, y: 0, width: 200, height: 200 }, 'the same shape: fills it');
assert.deepEqual(fitRect(2, 300, 300), { x: 0, y: 75, width: 300, height: 150 }, 'a landscape picture');
assert.deepEqual(fitRect(0.5, 300, 300), { x: 75, y: 0, width: 150, height: 300 }, 'a very tall picture');
for (const bad of [null, undefined, 0, -1, NaN, Infinity]) assert.deepEqual(fitRect(bad, 300, 400), fitRect(FALLBACK_ASPECT, 300, 400), `aspect ${bad} falls back`);
for (const box of [[0, 100], [100, 0], [-5, 100]]) assert.deepEqual(fitRect(1, ...box), { x: 0, y: 0, width: 0, height: 0 }, 'no box, no rect');

for (const [W, H] of [[353, 487], [320, 200], [480, 610], [333, 333], [101, 777], [777, 101]]) for (const a of [0.4, 0.5625, 2 / 3, 0.75, 0.8, 1, 1.333, 1.777, 2.5]) {
  const r = fitRect(a, W, H);
  assert.ok(r.width <= W && r.height <= H && r.x >= 0 && r.y >= 0, `${a} in ${W}×${H} leaves the box`);
  assert.ok(r.width === W || r.height === H, `${a} in ${W}×${H} touches neither side`);
  // Whole pixels: the shape is off by at most half a pixel on the side that was rounded.
  assert.ok(Math.abs(r.width - r.height * a) <= 0.5 + a / 2 && Math.abs(r.height - r.width / a) <= 0.5 + 1 / (2 * a), `${a} in ${W}×${H} is distorted: ${r.width}×${r.height}`);
  assert.ok(Math.abs(W - r.width - 2 * r.x) <= 1 && Math.abs(H - r.height - 2 * r.y) <= 1, `${a} in ${W}×${H} is off centre`);
}

assert.equal(aspectOf(300, 400), 0.75);
assert.equal(aspectOf(0, 400), null);

// Developing in the source's shape; before and after in the result's.
assert.equal(frameAspect(false, null, 0.75, true), 0.75, 'developing: the source photo, from the start');
assert.equal(frameAspect(false, null, undefined, true), undefined, 'the source not measured yet: no empty frame');
assert.equal(frameAspect(false, null, null, true), null, 'no photo: a usual shape');
assert.equal(frameAspect(true, 1, 0.75, true), 1, 'the result decides for both');
assert.equal(frameAspect(true, undefined, 0.75, true), 0.75, 'its result being measured, the developed look stays put');
assert.equal(frameAspect(true, undefined, 0.75, false), undefined, 'a reopened look waits for its own shape');
assert.equal(frameAspect(true, null, 0.75, false), 0.75, 'a result that cannot be measured falls back to the source');

// A try-on is cropped by nothing unless its own shape is known.
assert.equal(pictureFit(0.75), 'cover');
assert.equal(pictureFit(null), 'contain', 'measuring failed');
assert.equal(pictureFit(undefined), 'contain', 'still measuring, in a frame held from another picture');

// While the next picture is measured the frame keeps the last shape.
assert.equal(heldAspect(0.75, undefined), 0.75);
assert.equal(heldAspect(undefined, undefined), undefined);
assert.equal(heldAspect(0.75, 1), 1);
assert.equal(heldAspect(0.75, null), null, 'an answer, even a failed one, is taken');

// Measuring always answers in time.
{
  const clock = () => {
    let now = 0; const timers = new Set();
    const after = (ms, run) => { const timer = { at: now + ms, run }; timers.add(timer); return () => timers.delete(timer); };
    const pass = ms => {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers.delete(next); now = next.at; next.run();
      }
      now = end;
    };
    return { after, pass, timers };
  };
  const run = (uri, getSize) => {
    const c = clock(), reports = [];
    const cancel = measureAspect(uri, getSize, aspect => reports.push(aspect), c.after);
    return { ...c, reports, cancel };
  };
  assert.ok(MEASURE_TIMEOUT_MS >= 2000 && MEASURE_TIMEOUT_MS <= 4000);

  let t = run('file:///a.jpg', (_, ok) => ok(300, 400));
  assert.deepEqual(t.reports, [0.75], 'measured');
  assert.equal(t.timers.size, 0, 'and no timer left behind');

  let calls = 0;
  t = run('file:///a.jpg', (_, __, fail) => { calls++; fail(); });
  assert.deepEqual([t.reports, calls], [[null], 1], 'a local file is not tried twice');

  calls = 0;
  t = run('https://x/a.jpg', (_, __, fail) => { calls++; fail(); });
  assert.deepEqual(t.reports, [], 'http: not given up on yet');
  t.pass(1000);
  assert.deepEqual([t.reports, calls], [[null], 2], 'one retry, then null');
  t.pass(10000);
  assert.deepEqual([t.reports, calls], [[null], 2], 'once');

  calls = 0;
  t = run('https://x/a.jpg', (_, ok, fail) => { if (calls++) ok(100, 100); else fail(); });
  t.pass(1000);
  assert.deepEqual(t.reports, [1], 'the retry succeeds');

  // getSize that never calls back: the case that kept a result hidden.
  let late;
  t = run('https://x/a.jpg', (_, ok) => { late = ok; });
  t.pass(MEASURE_TIMEOUT_MS - 1);
  assert.deepEqual(t.reports, [], 'in time');
  t.pass(1);
  assert.deepEqual(t.reports, [null], 'silence ends in null at the timeout');
  late(200, 100);
  assert.deepEqual(t.reports, [null, 2], 'a size arriving late still corrects the frame');

  t = run('file:///a.jpg', () => {});
  t.cancel();
  t.pass(10000);
  assert.deepEqual(t.reports, [], 'unmounted: silence');
  t = run('file:///a.jpg', (_, ok) => { late = ok; });
  t.cancel(); late(1, 1);
  assert.deepEqual(t.reports, []);
  t = run('file:///a.jpg', (_, ok) => ok(0, 10));
  assert.deepEqual(t.reports, [null], 'a senseless size');
  assert.equal(t.timers.size, 0);
}

// The memory of shapes: bounded, no pictures in it.
{
  const known = new Map();
  rememberAspect(known, 'data:image/png;base64,AAAA', 1);
  assert.equal(known.size, 0, 'a data: URI is not kept');
  rememberAspect(known, 'a', 1, 2); rememberAspect(known, 'b', 1, 2); rememberAspect(known, 'a', 2, 2); rememberAspect(known, 'c', 1, 2);
  assert.deepEqual([...known.keys()], ['a', 'c'], 'the oldest goes first');
}

assert.equal(heldHeight(0, 500), 500);
assert.equal(heldHeight(400, 500), 400, 'while held, more room does not grow the picture');
assert.equal(heldHeight(500, 400), 400);

// No viewer letterboxes a try-on in a frame of its own again.
const read = file => fs.readFileSync(`${__dirname}/../src/components/${file}`, 'utf8');
const stage = read('GenerationStage.tsx');
const view = read('studio/GenerationView.tsx');
assert.match(stage, /<GenerationView/);
assert.match(view, /<FittedFrame/);
assert.match(stage, /<ZoomableImage[^>]*resizeMode=\{fit\}/, 'the zoomed picture fills its rect, or is shown whole if its shape is unknown');
assert.match(view, /holdHeight=\{!done \|\| settling\}/, 'the frame stands still until the look is done, then grows');
assert.match(read('onboarding/FirstLook.tsx'), /resizeMode=\{fit\}/);
assert.match(read('ui/FittedFrame.tsx'), /resizeMode=\{pictureFit\(aspect\)\}/);
const developing = read('studio/DevelopingImage.tsx');
assert.match(developing, /beforeUri \}\} resizeMode="contain"/, 'the photo before is shown whole in the shared rect');
assert.ok(!/resizeMode="cover"/.test(developing), 'nothing in the view is cropped');
assert.match(developing, /blurRadius=\{BLUR\} resizeMode=\{fit\}/, 'the blurred look sits exactly as the sharp one');
assert.ok(!/resizeMode="contain"/.test(read('onboarding/FirstLook.tsx').split('<GenerationView')[1].split('/>\n    </View>')[0]));
for (const file of ['GenerationHistory.tsx']) assert.match(read(file), /FittedImage|FittedFrame/, file);
console.log('PASS: image fit — the picture\'s own rect for every aspect, one frame for before and after');
