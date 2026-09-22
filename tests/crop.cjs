const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { moveCrop, cropPixels } = require('../src/domain/crop.ts');
const rect = { x: .1, y: .2, width: .6, height: .5 };
assert.deepEqual(moveCrop(rect, 'move', -1, 2), { ...rect, x: 0, y: .5 });
const left = moveCrop(rect, 'w', .9, 0);
assert.ok(Math.abs(left.width - .12) < 1e-8);
for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
  for (const delta of [-2, -.1, .1, 2]) {
    const cropped = moveCrop(rect, handle, delta, delta);
    assert.ok(cropped.x >= 0 && cropped.y >= 0 && cropped.x + cropped.width <= 1.00001 && cropped.y + cropped.height <= 1.00001);
    assert.ok(cropped.width >= .11999 && cropped.height >= .11999);
    const pixels = cropPixels(cropped, 403, 701);
    assert.ok(pixels.originX + pixels.width <= 403 && pixels.originY + pixels.height <= 701);
  }
}
assert.deepEqual(cropPixels({ x: 0, y: 0, width: 1, height: 1 }, 403, 701), { originX: 0, originY: 0, width: 403, height: 701 });
console.log('PASS: free crop, all eight handles, movement, minimum size, pixel bounds, original framing');
