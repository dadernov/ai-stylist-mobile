// One layout for every finished try-on: it fits without scrolling, its labels fit in every language; the double tap on the photo; the reveal's guards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const src = path.join(__dirname, '../src');
const read = file => fs.readFileSync(path.join(src, file), 'utf8');
const L = require(path.join(src, 'components/studio/resultLayout.ts'));
const { createDoubleTap, DOUBLE_TAP_MS, TAP_MAX_MS, TAP_SLOP } = require(path.join(src, 'components/studio/doubleTap.ts'));
const { PREFETCH_LIMIT_MS, REVEAL_TOTAL_MS, REVEAL_WATCHDOG_MS } = require(path.join(src, 'components/studio/generationReveal.ts'));
const { en } = require(path.join(src, 'constants/translations.en.ts'));
const { zh } = require(path.join(src, 'constants/translations.ts'));

// The sum of the column is the room it had: nothing is left to scroll.
const column = (photo, chrome, pieces = true) => chrome + photo + (pieces ? L.PIECE_SIZE + L.RESULT_GAP : 0) + L.RESULT_GAP + L.ACTIONS_HEIGHT;
for (const [name, height, top, tabs] of [['SE 2', 667, 20, 100], ['14', 844, 47, 120]]) {
  const available = L.estimatedViewport(height, top, tabs);
  for (const pieces of [true, false]) {
    const photo = L.resultPhotoHeight({ available, pieces });
    assert.ok(photo > L.MIN_PHOTO, `${name}: the room is real, not the minimum (${photo})`);
    assert.ok(column(photo, 0, pieces) <= available, `${name}: a result fits its list`);
  }
}
assert.equal(L.resultPhotoHeight({ available: 100 }), L.MIN_PHOTO, 'never less than a picture');
assert.ok(L.resultPhotoHeight({ available: 500, pieces: false }) > L.resultPhotoHeight({ available: 500 }), 'no pieces, more photo');

// The longest labels at the narrowest phone, inside a look's card (the narrowest place): screen 16 + card 12 on each side.
const cell = L.actionCellWidth(320 - 16 * 2 - 12 * 2) - L.ACTION_INSET * 2;
for (const label of L.RESULT_ACTION_LABELS) {
  assert.ok(L.labelWidth(label) <= cell, `ru «${label}» in ${cell}`);
  for (const [lang, dictionary] of [['en', en], ['zh', zh]]) {
    assert.ok(dictionary[label], `${lang}: «${label}» is translated`);
    assert.ok(L.labelWidth(dictionary[label]) <= cell, `${lang} «${dictionary[label]}» in ${cell}`);
  }
}

// Every label of the buttons is that list, in the one component that draws them.
const kit = read('components/ResultKit.tsx');
for (const label of L.RESULT_ACTION_LABELS) assert.ok(kit.includes(`'${label}'`), label);

// --- the double tap -------------------------------------------------------
const tap = (d, at, x = 100, y = 100, ms = 60) => { d.down(x, y, at); return d.up(x, y, at + ms); };
let d = createDoubleTap();
assert.equal(tap(d, 0), false, 'a single tap is nothing');
assert.equal(tap(d, 150), true, 'the second one is');
assert.equal(tap(d, 300), false, 'a third starts over');
d = createDoubleTap();
tap(d, 0);
assert.equal(tap(d, 60 + DOUBLE_TAP_MS + 1), false, 'too late');
d = createDoubleTap();
tap(d, 0);
assert.equal(tap(d, 150, 200, 200), false, 'somewhere else');
d = createDoubleTap();
d.down(100, 100, 0); assert.equal(d.up(100, 100 + TAP_SLOP + 1, 50), false, 'a drag is no tap');
assert.equal(tap(d, 100), false, 'and does not count as the first');
d = createDoubleTap();
d.down(100, 100, 0); assert.equal(d.up(100, 100, TAP_MAX_MS + 1), false, 'a long press is no tap');
assert.equal(tap(d, 300), false);
d = createDoubleTap();
tap(d, 0);
d.down(100, 100, 100); d.cancel();
assert.equal(tap(d, 150), false, 'the pager or the sheet took the touch: nothing is left of the first');
// A pinch is never a tap, however quick, nor does it leave a first tap behind.
d = createDoubleTap();
tap(d, 0);
d.down(100, 100, 80); d.down(150, 150, 90, 2);
assert.equal(d.up(100, 100, 120, 1), false);
assert.equal(d.up(150, 150, 130, 0), false);
assert.equal(tap(d, 180), false);
assert.equal(tap(d, 300), true);

// Nothing waits on a single tap, and the wiring: only the big window's photo answers, a finished one, and never by unsaving.
assert.ok(!/setTimeout/.test(read('components/studio/doubleTap.ts')));
const stage = read('components/GenerationStage.tsx');
assert.match(stage, /<DoubleTapArea enabled=\{done\}/);
assert.match(stage, /if \(save\.saved\) \{ bloom\(\); tapHaptic\(\); return; \}[\s\S]*void save\.save\(\)/);
assert.ok(!/AppPressable/.test(stage.slice(stage.indexOf('function PageView'))), 'no tap on the window\'s photo');
assert.match(read('components/SaveLook.tsx'), /if \(!look \|\| working\.current \|\| saved\) return false;/);
assert.match(read('components/GenerationDock.tsx'), /onPress=\{\(\) => onOpen\(job\.id\)\}/, 'the small window still opens on a tap');

// --- the reveal's guards --------------------------------------------------
assert.ok(PREFETCH_LIMIT_MS + REVEAL_TOTAL_MS < REVEAL_WATCHDOG_MS, 'a slow network still plays the whole reveal before the watchdog');
const developing = read('components/studio/DevelopingImage.tsx');
assert.match(developing, /running=\{active && !reduced && developing\}/);
assert.match(developing, /\[done, active\]/);
assert.match(developing, /setTimeout\(showNow, REVEAL_WATCHDOG_MS\)/);
for (const file of ['components/FittingRoom.tsx']) assert.match(read(file), /revealingId === /, `${file} holds its reveal`);

// --- one treatment --------------------------------------------------------
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
for (const file of walk(src).filter(name => /\.tsx$/.test(name))) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(!/ui\/PrimaryButton|ui\/IconButton/.test(source), `${file}: one kind of button`);
  assert.ok(!/saveTryOnToGallery\(/.test(source) || /ResultKit/.test(file), `${file}: one way to the gallery`);
  assert.ok(!/\bt\('[^']*[Лл]ук[ а-я?{]/.test(source), `${file}: «образ», not «лук»`);
}
console.log('PASS: result layout — fits without scrolling, labels fit, double tap, reveal guards, one treatment');
