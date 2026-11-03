// The try-on picture: the rounded container is the picture's own rect, before and after share it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { aspectOf, FALLBACK_ASPECT, fitRect, frameAspect, heldHeight } = require('../src/components/studio/imageFit.ts');

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

assert.equal(heldHeight(0, 500), 500);
assert.equal(heldHeight(400, 500), 400, 'the buttons taking less room do not grow the picture');
assert.equal(heldHeight(500, 400), 400);

// No viewer letterboxes a try-on in a frame of its own again.
const read = file => fs.readFileSync(`${__dirname}/../src/components/${file}`, 'utf8');
const stage = read('GenerationStage.tsx');
assert.match(stage, /<FittedFrame/);
assert.match(stage, /<ZoomableImage[^>]*resizeMode="cover"/, 'the zoomed picture fills the rect it is clipped by');
const developing = read('studio/DevelopingImage.tsx');
assert.ok(!/resizeMode="contain"/.test(developing), 'before and blurred after fill the shared rect');
assert.ok(!/resizeMode="contain"/.test(read('onboarding/FirstLook.tsx').split('<DevelopingImage')[1].split('</DevelopingImage>')[0]));
for (const file of ['AiTryOnPreview.tsx', 'GenerationHistory.tsx']) assert.match(read(file), /FittedImage|FittedFrame/, file);
console.log('PASS: image fit — the picture\'s own rect for every aspect, one frame for before and after');
