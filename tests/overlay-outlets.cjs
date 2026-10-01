// iOS presents a modal only from the screen on top: a window the app opens from
// its root while a sheet is up silently never shows. App-wide windows go through
// OverlayHost, and every sheet that starts AI work holds an outlet for them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '../src');
const read = file => fs.readFileSync(path.join(src, file), 'utf8');

for (const file of ['components/AiConsentContext.tsx', 'components/GenerationDock.tsx']) {
  assert.match(read(file), /useOverlay\(/, `${file} draws its window through OverlayHost`);
}
// The sliding sheets of the try-on and the wardrobe: a try-on, an item's AI
// analysis and its editor all ask for consent or open the generation window.
let checked = 0;
for (const file of ['components/FittingRoom.tsx', 'screens/WardrobeScreen.tsx']) {
  const source = read(file);
  for (const match of source.matchAll(/<Modal[\s>]/g)) {
    const end = source.indexOf('</Modal>', match.index);
    const block = source.slice(match.index, end);
    if (!/animationType="slide"/.test(block.slice(0, 300))) continue;
    checked += 1;
    assert.ok(block.includes('<OverlayOutlet />'), `${file}: a sheet that starts AI work holds an OverlayOutlet`);
  }
}
assert.ok(checked >= 4, 'the try-on sheet and the three wardrobe sheets were found');
console.log(`PASS: app-wide windows open over ${checked} sheets that start AI work`);
