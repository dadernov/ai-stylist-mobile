// The one generation view: the fog's tint, its reveal, how it steps down, which reveals are owed, and that every window uses it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { createFrameGovernor, createRevealLedger, FOG_LEVELS, fogPalette, fogSeed, fogTime, revealAt, REVEAL_COVER_MS, REVEAL_TOTAL_MS } = require('../src/components/studio/generationFog.ts');
const { FOG_SKSL } = require('../src/components/studio/fogShader.ts');
const { NAMED_COLORS } = require('../src/domain/namedColors.ts');

// The tint comes from the garments, softly; anything unknown or colourless keeps the default.
const plain = fogPalette([], false);
assert.deepEqual(fogPalette([{ color: 'Нет такого', tags: [] }, {}], false), plain, 'unknown colours keep the default');
assert.deepEqual(fogPalette([{ color: 'Белый' }], false), plain, 'a colourless garment keeps the default');
assert.notDeepEqual(fogPalette([], true), plain, 'dark theme has its own default');
const colourful = NAMED_COLORS.find(({ hex }) => { const v = parseInt(hex.slice(1), 16); return Math.max(v >> 16 & 255, v >> 8 & 255, v & 255) - Math.min(v >> 16 & 255, v >> 8 & 255, v & 255) > 120; });
const tinted = fogPalette([{ color: colourful.name }], false);
assert.notDeepEqual(tinted.a, plain.a, 'a colourful garment tints the fog');
assert.deepEqual(fogPalette([{ color: colourful.name.toUpperCase() }], false), tinted, 'names match in any case');
for (const set of [[], [{ color: colourful.name }]]) for (const dark of [false, true]) for (const tint of Object.values(fogPalette(set, dark))) {
  assert.equal(tint.length, 3);
  for (const channel of tint) assert.ok(channel >= 0 && channel <= 1, 'a colour channel in range');
}

// The reveal: closes over the photo first, then opens; ends fully open.
assert.deepEqual(revealAt(0), { cover: 0, open: 0, covered: false, finished: false });
assert.equal(revealAt(REVEAL_COVER_MS).cover, 1);
assert.equal(revealAt(REVEAL_COVER_MS).open, 0, 'nothing opens before the fog is opaque');
assert.equal(revealAt(REVEAL_COVER_MS).covered, true);
assert.equal(revealAt(REVEAL_TOTAL_MS).open, 1);
assert.equal(revealAt(REVEAL_TOTAL_MS).finished, true);
assert.equal(revealAt(REVEAL_TOTAL_MS + 5000).open, 1);
assert.equal(revealAt(-100).cover, 0);
let previous = -1;
for (let ms = 0; ms <= REVEAL_TOTAL_MS; ms += 50) { const { open } = revealAt(ms); assert.ok(open >= previous, 'it never closes again'); previous = open; }

// The same look has the same fog in every window, and the clock survives a window change.
assert.equal(fogSeed('job-1'), fogSeed('job-1'));
assert.notEqual(fogSeed('job-1'), fogSeed('job-2'));
assert.equal(fogSeed(undefined), fogSeed(''));
assert.ok(fogTime(Date.now(), 500) < 500 + 1800, 'time stays small enough for a shader float');

// Slow frames step it down, once and for all; a pause is not a slow frame; a healthy run stays.
const steady = createFrameGovernor();
for (let i = 0; i < 500; i++) steady.tick(16.7);
assert.equal(steady.level, 0);
const slow = createFrameGovernor();
for (let i = 0; i < 40; i++) slow.tick(40);
assert.equal(slow.level, 1, 'too slow for 60: down to 30');
for (let i = 0; i < 80; i++) slow.tick(90);
assert.equal(slow.level, FOG_LEVELS.length - 1, 'too slow for 30: the smallest canvas');
for (let i = 0; i < 300; i++) slow.tick(16);
assert.equal(slow.level, FOG_LEVELS.length - 1, 'it never climbs back');
const paused = createFrameGovernor();
for (let i = 0; i < 100; i++) paused.tick(5000);
assert.equal(paused.level, 0, 'long gaps are a pause');

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

// The shader declares what the canvas sets. (That it compiles was checked against CanvasKit by hand.)
const skiaModule = fs.readFileSync(`${__dirname}/../src/components/studio/skiaModule.ts`, 'utf8');
const uniforms = /FogUniforms = \{([^}]*)\}/.exec(skiaModule)[1].match(/u[A-Z]\w*/g);
assert.deepEqual(FOG_SKSL.match(/uniform \w+ (\w+);/g).map(line => line.replace(/uniform \w+ |;/g, '')).sort(), [...uniforms].sort());

// Every window goes through the one view; the old ones are gone.
const read = file => fs.readFileSync(`${__dirname}/../src/components/${file}`, 'utf8');
for (const file of ['GenerationStage.tsx', 'AiTryOnPreview.tsx', 'onboarding/FirstLook.tsx']) assert.match(read(file), /<GenerationView/, file);
for (const file of ['GenerationDock.tsx', 'FittingRoom.tsx']) assert.match(read(file), /<DevelopingImage[^>]*revealKey=/, file);
assert.match(read('FittingRoom.tsx'), /<GenerationStatus/);
assert.ok(!/BusyVeil/.test(read('FittingRoom.tsx')), 'no veil of its own');
assert.ok(!/blurRadius/.test(read('GenerationDock.tsx')), 'no blur of its own in the corner');
assert.ok(!/Промежуточный результат/.test(read('AiTryOnPreview.tsx')), 'no intermediate frame of its own');
assert.match(read('studio/skiaModule.web.ts'), /return null/, 'the web keeps the gradient');
console.log('PASS: generation fog — tint, reveal, frame governor, owed reveals, one view in every window');
