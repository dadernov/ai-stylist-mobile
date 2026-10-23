// The flat picture's reading merged into the draft's analysis (src/domain/flatReading.ts).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename);
const { mergeFlatReading, categoryFitsSection } = require(path.join(__dirname, '../src/domain/flatReading.ts'));

const photo = {
  analysisId: 'a1', bgRemovedBase64: 'data:image/png;base64,cut', backgroundRemoved: true,
  category: 'Куртка', section: 'Верхняя одежда', needsReview: true, pattern: 'Однотонный',
  dominantColor: '#333333', palette: ['#333333'],
  warnings: ['Тип вещи определён неуверенно. Проверь предложенные варианты.', 'На фото человек: проверь цвет и тип вещи. Для точного анализа лучше отдельное фото одежды.']
};
const flat = { category: 'Худи', section: 'Верх', needsReview: false, pattern: 'Однотонный', dominantColor: '#2a3a5a', palette: ['#2a3a5a'], warnings: [] };

// The flat's reading wins; the photo's id and cut-out stay.
let merged = mergeFlatReading(photo, flat);
assert.equal(merged.category, 'Худи');
assert.equal(merged.needsReview, false);
assert.equal(merged.analysisId, 'a1');
assert.equal(merged.bgRemovedBase64, 'data:image/png;base64,cut');
assert.equal(merged.dominantColor, '#2a3a5a');
// The photo's doubt about its category is answered by the flat; its person warning stays.
assert.deepEqual(merged.warnings, ['На фото человек: проверь цвет и тип вещи. Для точного анализа лучше отдельное фото одежды.']);

// A background the photo could not remove keeps asking for review, and its warning stays.
const messy = { ...photo, backgroundRemoved: false, warnings: ['Фон не удалось надёжно отделить. Цвет может включать фон фотографии.'] };
merged = mergeFlatReading(messy, flat);
assert.equal(merged.needsReview, true);
assert.deepEqual(merged.warnings, ['Фон не удалось надёжно отделить. Цвет может включать фон фотографии.']);

// The flat's own doubts come through, once.
merged = mergeFlatReading(photo, { ...flat, needsReview: true, warnings: ['Тип вещи определён неуверенно. Проверь предложенные варианты.'] });
assert.equal(merged.needsReview, true);
assert.deepEqual(merged.warnings.filter(w => w.startsWith('Тип вещи')).length, 1);

// An empty flat palette never clears the photo's colour.
merged = mergeFlatReading(photo, { ...flat, dominantColor: null, palette: [] });
assert.equal(merged.dominantColor, '#333333');
assert.deepEqual(merged.palette, ['#333333']);

// A section set by hand keeps its kind of things.
assert.equal(categoryFitsSection('Худи', 'Верх', null), true);
assert.equal(categoryFitsSection('Худи', 'Верх', 'Верхняя одежда'), false);
assert.equal(categoryFitsSection('Куртка', 'Верхняя одежда', 'Верхняя одежда'), true);
assert.equal(categoryFitsSection('', 'Верх', null), false);

console.log('PASS: the flat reading merges into the draft without losing the photo\'s own reasons or a hand-set section');
