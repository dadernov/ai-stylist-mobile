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
const pattern = /\b(?:t|translate)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
for (const file of files) for (const match of fs.readFileSync(file, 'utf8').matchAll(pattern)) keys.add(match[2].replace(/\\'/g, "'"));
const placeholders = text => new Set([...text.matchAll(/\{\w+\}/g)].map(m => m[0]));
for (const [name, dictionary] of [['en', en], ['zh', zh]]) {
  const missing = [...keys].filter(key => !(key in dictionary));
  assert.deepEqual(missing, [], `${name}: missing translations`);
  const broken = Object.entries(dictionary).filter(([key, value]) => [...placeholders(value)].some(name => !placeholders(key).has(name))).map(([key]) => key);
  assert.deepEqual(broken, [], `${name}: translation uses a placeholder the source does not provide`);
}
console.log(`PASS: ${keys.size} interface strings translated into English and Chinese`);
