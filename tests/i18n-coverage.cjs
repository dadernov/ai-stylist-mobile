// Every string passed to t()/translate() must exist in the English and Chinese
// dictionaries with the same {placeholders}; otherwise the UI falls back to Russian.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const root = path.join(__dirname, '..');
const { zh } = require(path.join(root, 'src/constants/translations.ts'));
const { en } = require(path.join(root, 'src/constants/translations.en.ts'));
const files = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) walk(full); else if (/\.tsx?$/.test(entry.name)) files.push(full);
});
walk(path.join(root, 'src')); files.push(path.join(root, 'App.tsx'));
const keys = new Set();
// Keys built from data rather than literal t('…') calls: occasions, styles, criteria and verdicts.
const outfitsSource = fs.readFileSync(path.join(root, 'src/domain/outfits.ts'), 'utf8');
for (const block of outfitsSource.matchAll(/export const (?:EVENTS|STYLES) = \[([^\]]*)\]/g)) for (const m of block[1].matchAll(/'([^']+)'/g)) keys.add(m[1]);
for (const m of outfitsSource.split('CRITERION_LABELS')[1].split('\n')[0].matchAll(/: '([^']+)'/g)) keys.add(m[1]);
['Отлично подходит', 'Хорошо подходит', 'Подходит с оговорками', 'Слабое совпадение'].forEach(key => keys.add(key));
const pattern = /\b(?:t|translate)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(pattern)) keys.add(match[2].replace(/\\'/g, "'"));
  // Literals inside the first argument of t(…)/translate(…): t(cond ? 'а' : 'б'), t(x || 'в').
  for (const call of source.matchAll(/\b(?:t|translate)\(/g)) {
    let depth = 0, i = call.index + call[0].length - 1, end = i;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth === 0) break; }
      else if (ch === ',' && depth === 1) break;
    }
    const argument = source.slice(i + 1, end);
    for (const literal of argument.matchAll(/(['"])((?:\\.|(?!\1).)*[А-Яа-яЁё](?:\\.|(?!\1).)*)\1/g)) keys.add(literal[2].replace(/\\'/g, "'"));
  }
  // Labels in data that the UI passes through t(): options, crop handles, storage section names.
  for (const literal of source.matchAll(/\blabel: '([^']*[А-Яа-яЁё][^']*)'/g)) keys.add(literal[1]);
}
for (const literal of fs.readFileSync(path.join(root, 'App.tsx'), 'utf8').matchAll(/persist\([^,]+, [^,]+, '([^']+)'\)/g)) keys.add(literal[1]);
const placeholders = text => new Set([...text.matchAll(/\{\w+\}/g)].map(m => m[0]));
for (const [name, dictionary] of [['en', en], ['zh', zh]]) {
  const missing = [...keys].filter(key => !(key in dictionary));
  assert.deepEqual(missing, [], `${name}: missing translations`);
  const broken = Object.entries(dictionary).filter(([key, value]) => [...placeholders(value)].some(name => !placeholders(key).has(name))).map(([key]) => key);
  assert.deepEqual(broken, [], `${name}: translation uses a placeholder the source does not provide`);
}
console.log(`PASS: ${keys.size} interface strings translated into English and Chinese`);
