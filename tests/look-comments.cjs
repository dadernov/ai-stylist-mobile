// The stylist's remarks while waiting: about this look's own pieces only, with honest tips when the data is thin.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { lookComments } = require(path.join(__dirname, '../src/domain/lookComments.ts'));
const t = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
const piece = (name, category, section, color, pattern = 'Однотонный') => ({ id: name, name, category, section, color, pattern, season: '', tags: [] });

const generic = lookComments([], t);
assert.equal(generic.length, 3);
assert.ok(generic.every(line => !line.includes('{')));

const look = [piece('Белая рубашка', 'Рубашка', 'Верх', 'Белый'), piece('Красная юбка', 'Юбка', 'Низ', 'Красный'), piece('Лоферы', 'Лоферы', 'Обувь', 'Черный')];
const said = lookComments(look, t);
assert.ok(said.some(line => line.includes('Цветовой акцент') && line.includes('«Красная юбка»')));
assert.ok(said.some(line => line.startsWith('Обувь здесь: «Лоферы»')));
assert.ok(!said.some(line => line.includes('Верхний слой')), 'no outerwear in this look');

const mono = lookComments([piece('A', 'Футболка', 'Верх', 'Серый'), piece('B', 'Брюки', 'Низ', 'Серый')], t);
assert.ok(mono[0].includes('в одном цвете: серый'));

// Unknown colours and patterns are not talked about; a lone piece is named.
const thin = lookComments([piece('Вещь', 'Новое', 'Верх', 'Не определено', 'Не определено')], t);
assert.equal(thin.length, 4);
assert.ok(thin[0].includes('«Вещь»'));
const hex = lookComments([piece('A', 'Футболка', 'Верх', '#ff0000'), piece('B', 'Брюки', 'Низ', '#00ff00')], t);
assert.ok(!hex.some(line => line.includes('#')));
console.log('PASS: stylist comments stay about the look');
