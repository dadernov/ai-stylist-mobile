// The one generation view: the placeholder's sweep, the status line's wave, the reveal's bands, which reveals are owed, and that every window uses it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { createRevealLedger, letterWave, lineLetters, placeholderFill, REVEAL_STRIPS, REVEAL_TOTAL_MS, revealStrips, stripOpacity, SWEEP_STOPS, sweepColors, sweepTravel } = require('../src/components/studio/generationReveal.ts');
const { fitRect, pictureFit } = require('../src/components/studio/imageFit.ts');

// The light has no edges and never shows its jump back; it is restrained, and neutral in itself.
for (const dark of [false, true]) {
  const colors = sweepColors(dark);
  assert.equal(colors.length, SWEEP_STOPS.length);
  assert.match(colors[0], /,0\)$/);
  assert.match(colors[colors.length - 1], /,0\)$/);
  assert.equal(new Set(colors.slice(1, -1)).size, colors.length - 2, 'more than one hue: the iridescent hint');
}
assert.notEqual(placeholderFill(true), placeholderFill(false));
const travel = sweepTravel(300, 400);
assert.ok(travel.from + travel.bandWidth <= 0, 'starts wholly left of the frame');
assert.ok(travel.to > 300, 'ends wholly right of it, tilt included');

// The reveal lasts about a second and a half.
assert.ok(REVEAL_TOTAL_MS >= 1300 && REVEAL_TOTAL_MS <= 1700);

// The bands cover the picture exactly, whatever its height: a gap or an overlap would show as a line.
for (const height of [0, 1, 5, 150, 511, 640.5, 844]) {
  const strips = revealStrips(height);
  assert.ok(strips.length <= REVEAL_STRIPS);
  let bottom = 0;
  for (const strip of strips) { assert.equal(strip.top, bottom, 'no gap'); assert.ok(Number.isInteger(strip.height)); bottom += strip.height; }
  assert.equal(bottom, Math.ceil(height));
}

// Top first, the last band done exactly at the end, never a band reversing.
const count = REVEAL_STRIPS;
assert.equal(stripOpacity(0, count).inputRange[0], 0);
assert.equal(stripOpacity(count - 1, count).inputRange[1], 1);
for (let i = 1; i < count; i++) assert.ok(stripOpacity(i, count).inputRange[0] > stripOpacity(i - 1, count).inputRange[0], 'a lower band starts later');
for (let i = 0; i < count; i++) { const { inputRange } = stripOpacity(i, count); assert.ok(inputRange[1] > inputRange[0], 'Animated needs a rising range'); }
assert.deepEqual(stripOpacity(0, 1).inputRange.length, 2);

// The wave runs left to right, one letter after another, each range rising; it is off the line at both ends of its loop, so the loop has no jump.
const crest = (i, n) => letterWave(i, n).inputRange[1];
assert.ok(crest(1, 10) > crest(0, 10));
for (const n of [1, 2, 13, 36]) for (let i = 0; i < n; i++) {
  const { inputRange, outputRange } = letterWave(i, n);
  assert.ok(inputRange[0] < inputRange[1] && inputRange[1] < inputRange[2]);
  assert.ok(inputRange[0] >= -1e-9 && inputRange[2] <= 1 + 1e-9, 'whole crest within the loop');
  assert.ok(outputRange[1] > outputRange[0]);
}
assert.deepEqual(lineLetters('Да о'), ['Д', 'а', '\u00A0', 'о']);
assert.equal(lineLetters('✨a').length, 2);

// Nothing cut off: a picture of a known shape fills exactly its own rect; a cover fit with a fixed frame is gone from every picture on screen.
const rect = fitRect(0.75, 300, 900);
assert.ok(Math.abs(rect.width / rect.height - 0.75) < 0.01);
assert.equal(pictureFit(undefined), 'contain');
assert.equal(pictureFit(null), 'contain');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
for (const file of walk(`${__dirname}/../src`).filter(name => name.endsWith('.tsx'))) {
  assert.ok(!/resizeMode="cover"|\? 'cover' :/.test(fs.readFileSync(file, 'utf8')), `${file} crops a picture`);
}

// The reveal is owed once per surface, wherever the look finished.
const ledger = createRevealLedger();
assert.equal(ledger.owes('old', 'full'), false, 'a look never seen running owes nothing');
ledger.track('a');
assert.equal(ledger.owes('a', 'full'), true);
assert.equal(ledger.owes('a', 'mini'), true);
ledger.settle('a', 'mini');
assert.equal(ledger.owes('a', 'mini'), false);
assert.equal(ledger.owes('a', 'full'), true, 'the corner playing it leaves the big view its own');
ledger.track('a');
assert.equal(ledger.owes('a', 'mini'), false, 'tracked again while running: what has played stays played');
ledger.forget('a');
assert.equal(ledger.owes('a', 'full'), false);

// Every window goes through the one view; the old ones are gone.
const read = file => fs.readFileSync(`${__dirname}/../src/components/${file}`, 'utf8');
for (const file of ['GenerationStage.tsx', 'AiTryOnPreview.tsx', 'onboarding/FirstLook.tsx']) assert.match(read(file), /<GenerationView/, file);
for (const file of ['GenerationDock.tsx', 'FittingRoom.tsx']) assert.match(read(file), /<DevelopingImage[^>]*revealKey=/, file);
assert.match(read('FittingRoom.tsx'), /<GenerationStatus/);
assert.ok(!/BusyVeil/.test(read('FittingRoom.tsx')), 'no veil of its own');
assert.ok(!/blurRadius/.test(read('GenerationDock.tsx')), 'no blur of its own in the corner');
assert.ok(!/Промежуточный результат/.test(read('AiTryOnPreview.tsx')), 'no intermediate frame of its own');
assert.ok(!/react-native-skia/.test(fs.readFileSync(`${__dirname}/../package.json`, 'utf8')), 'no shader engine left');
console.log('PASS: generation view — sweep, wave, reveal bands, owed reveals, nothing cropped, one view in every window');
