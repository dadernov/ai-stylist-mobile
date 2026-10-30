// Sheet drag/handle decisions: a real tap only closes, a blocked dismiss rubber-bands and springs back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false }
}).outputText, filename);
const { isTap, dragOffset, releaseCloses } = require('../src/components/studio/sheetGesture.ts');

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
console.log('sheet-gesture: ok');
