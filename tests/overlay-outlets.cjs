// iOS presents a modal only from the screen on top: a window the app opens from
// its root while a sheet is up silently never shows. App-wide windows go through
// OverlayHost, and every sheet holds an outlet for them; a window opened from a
// sheet is drawn inside it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '../src');
const read = file => fs.readFileSync(path.join(src, file), 'utf8');
const files = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.tsx')) files.push(full);
});
walk(src);

for (const file of ['components/AiConsentContext.tsx', 'components/GenerationDock.tsx']) {
  assert.match(read(file), /useOverlay\(/, `${file} draws its window through OverlayHost`);
}

// The one bottom sheet holds an outlet inside its modal.
const sheet = read('components/studio/StudioSheet.tsx');
const sheetModal = sheet.slice(sheet.indexOf('<Modal'), sheet.indexOf('</Modal>'));
assert.ok(sheetModal.includes('<OverlayOutlet />'), 'StudioSheet holds an OverlayOutlet inside its modal');

// The blocks of a JSX element, from its opening tag to its matching closing tag.
const blocks = (source, tag) => {
  const found = [];
  const open = new RegExp(`<${tag}[\\s>]`, 'g');
  for (const match of source.matchAll(open)) {
    let depth = 0;
    const tokens = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    tokens.lastIndex = match.index;
    let token;
    while ((token = tokens.exec(source))) {
      if (token[0].startsWith(`<${tag}`)) depth += 1;
      else if (token[0] === `</${tag}>`) { depth -= 1; if (!depth) { found.push([match.index, tokens.lastIndex]); break; } }
    }
  }
  return found;
};

// The sliding sheets and windows of the try-on and the wardrobe: a try-on, an item's AI
// analysis and its editor all ask for consent or open the generation window.
let checked = 0;
for (const file of ['components/FittingRoom.tsx', 'screens/WardrobeScreen.tsx', 'screens/OutfitBuilderScreen.tsx', 'screens/FavoritesScreen.tsx']) {
  const source = read(file);
  for (const [start, end] of blocks(source, 'Modal')) {
    const block = source.slice(start, end);
    if (!/animationType="slide"/.test(block.slice(0, 300))) continue;
    checked += 1;
    assert.ok(block.includes('<OverlayOutlet />'), `${file}: a sliding modal that starts AI work holds an OverlayOutlet`);
  }
  checked += blocks(source, 'StudioSheet').length;
}
assert.ok(checked >= 6, `the try-on sheets, the three wardrobe sheets and the look editor were found (${checked})`);

// No window is opened from inside a sheet while it is drawn beside the sheet: a <Modal> outside every
// <StudioSheet> of its file must not be shown by a setter called from inside one.
let sheets = 0;
for (const full of files) {
  const source = fs.readFileSync(full, 'utf8');
  const file = path.relative(src, full);
  const inside = blocks(source, 'StudioSheet');
  if (!inside.length) continue;
  sheets += inside.length;
  const within = index => inside.some(([start, end]) => index > start && index < end);
  for (const [start] of blocks(source, 'Modal')) {
    if (within(start)) continue;
    const visible = source.slice(start, start + 400).match(/visible=\{(?:Boolean\()?!?([A-Za-z_]\w*)/);
    if (!visible) continue;
    const name = visible[1].replace(/^is(?=[A-Z])/, '');
    const setter = `set${name[0].toUpperCase()}${name.slice(1)}(`;
    for (const [sheetStart, sheetEnd] of inside) {
      assert.ok(!source.slice(sheetStart, sheetEnd).includes(setter),
        `${file}: the window shown by ${visible[1]} opens from a StudioSheet, so it must be drawn inside that sheet`);
    }
  }
}
assert.ok(sheets >= 8, `every StudioSheet user was checked (${sheets})`);
console.log(`PASS: app-wide windows open over ${checked} sheets that start AI work; ${sheets} studio sheets draw their windows inside`);
