const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

let checked = 0;
function checkFile(filename) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node, inModal = false, modalProvider = false) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(source);
      if (name === 'Modal') {
        inModal = true;
        modalProvider = false;
      } else if (name === 'SafeAreaProvider' && inModal) {
        modalProvider = true;
      } else if (name === 'SafeAreaView' && inModal) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        assert.ok(modalProvider, `${filename}:${line}: native modal safe areas need a provider inside that modal`);
        checked++;
      }
    }
    ts.forEachChild(node, child => visit(child, inModal, modalProvider));
  }
  visit(source);
}

function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(filename);
    else if (entry.name.endsWith('.tsx')) checkFile(filename);
  }
}
checkDirectory(path.join(__dirname, '..', 'src'));
assert.ok(checked >= 5, 'Expected to check history, recent try-ons, help, cropper and photo picker');
console.log(`PASS: ${checked} native modal safe areas have their own provider`);
