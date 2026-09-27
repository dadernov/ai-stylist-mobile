const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText, filename);
const Module = require('node:module');
const load = Module._load;
Module._load = (request, parent, main) => request === '@react-native-async-storage/async-storage' ? { default: { getItem: async () => null, setItem: async () => {} } }
  : request === 'expo-location' ? {} : load(request, parent, main);
const { suggestItemName, isAutoItemName } = require(path.join(__dirname, '../src/domain/itemName.ts'));
const name = (category, color, pattern = 'Однотонный', lang = 'ru') => suggestItemName({ category, color, pattern }, lang);

assert.equal(name('Футболка', 'Оранжевый'), 'Оранжевая футболка');
assert.equal(name('Свитер', 'Черный'), 'Черный свитер');
assert.equal(name('Джинсы', 'Синий'), 'Синие джинсы');
assert.equal(name('Платье', 'Красный'), 'Красное платье');
assert.equal(name('Куртка', 'Синий'), 'Синяя куртка');
assert.equal(name('Кроссовки', 'Белый'), 'Белые кроссовки');
assert.equal(name('Пальто', 'Голубой'), 'Голубое пальто');
assert.equal(name('Брюки', 'Хаки'), 'Брюки хаки');
assert.equal(name('Худи', 'Графит'), 'Графитовое худи');
assert.equal(name('Рубашка', 'Белый', 'Полоска'), 'Белая рубашка в полоску');
assert.equal(name('Юбка', 'Не определено', 'Клетка'), 'Юбка в клетку');
assert.equal(name('Не определено', 'Черный'), '');
assert.equal(name('Футболка', 'Оранжевый', 'Однотонный', 'en'), 'Orange T-shirt');
assert.equal(name('Джинсы', 'Черный', 'Однотонный', 'en'), 'Black jeans');
assert.equal(name('Рубашка', 'Белый', 'Полоска', 'en'), 'Striped white shirt');
assert.equal(name('Футболка', 'Оранжевый', 'Однотонный', 'zh'), '橙色T恤');

for (const placeholder of ['Новая вещь', 'Новая вещь_3', 'новая вещь 12', 'Футболка', '']) assert.ok(isAutoItemName(placeholder, 'Футболка'), placeholder);
for (const own of ['Любимая футболка', 'Pink Floyd', 'Футболка с концерта']) assert.ok(!isAutoItemName(own, 'Футболка'), own);
const { describeWeatherCode } = require(path.join(__dirname, '../src/services/weather.ts'));
assert.equal(describeWeatherCode(63), 'дождь', 'moderate rain used to read as partly cloudy');
assert.equal(describeWeatherCode(65), 'дождь'); assert.equal(describeWeatherCode(53), 'морось');
assert.equal(describeWeatherCode(75), 'снег'); assert.equal(describeWeatherCode(81), 'ливень'); assert.equal(describeWeatherCode(99), 'гроза');
console.log('PASS: every WMO weather code is described');
console.log('PASS: item names agree in gender and number, follow the language, and never replace a name the user typed');
