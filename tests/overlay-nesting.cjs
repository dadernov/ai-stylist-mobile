// The real OverlayHost under React: a sheet opened inside an app-wide window (Share in the
// generation window) used to take over as the top outlet, the window's own outlet then drew
// nothing and unmounted the sheet with it, round and round: «Maximum update depth exceeded».
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  fileName: filename
}).outputText, filename);

global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const renderer = require('react-test-renderer');
const { OverlayOutlet, OverlayProvider, useOverlay, useOverlayPlace } = require(path.join(__dirname, '../src/components/OverlayHost.tsx'));
const h = React.createElement;
const { act, create } = renderer;

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  const text = String(args[0]);
  // react-test-renderer announces its own deprecation; everything else is a finding.
  if (!text.includes('react-test-renderer is deprecated')) errors.push(text);
};

let mounts;
const counted = (name, render) => function Counted(props) {
  React.useEffect(() => { mounts[name] = (mounts[name] || 0) + 1; }, []);
  return render(props);
};
const Sheet = counted('sheet', ({ name = 'sheet', children }) => h('sheet', { name }, children, h(OverlayOutlet)));
const Stage = counted('stage', ({ nested }) => { const place = useOverlayPlace(); return h('stage', { place }, nested); });
function Dock({ open, nested }) {
  const stage = open ? h(Stage, { nested }) : null;
  const inline = useOverlay('generation-stage', stage);
  return inline ? stage : null;
}
const render = element => { let root; act(() => { root = create(element); }); return root; };
const has = (root, type) => root.root.findAllByType(type).length;
const reset = () => { mounts = {}; errors.length = 0; };

reset();
{
  const root = render(h(OverlayProvider, null, h(Dock, { open: true })));
  assert.equal(has(root, 'stage'), 1, 'a window with no sheet is drawn at the root');
  assert.equal(root.root.findByType('stage').props.place, 'root');
  // Share tapped inside the window.
  act(() => root.update(h(OverlayProvider, null, h(Dock, { open: true, nested: h(Sheet) }))));
  assert.equal(has(root, 'stage'), 1, 'the window stays');
  assert.equal(has(root, 'sheet'), 1, 'the nested sheet shows inside the window');
  assert.equal(mounts.stage, 1, 'the window is not remounted');
  assert.equal(mounts.sheet, 1, 'the sheet is not remounted');
  assert.deepEqual(errors, [], 'no update-depth error');
  // Share closed: the window is still there.
  act(() => root.update(h(OverlayProvider, null, h(Dock, { open: true }))));
  assert.equal(has(root, 'stage'), 1);
  assert.equal(has(root, 'sheet'), 0);
  act(() => root.unmount());
  console.log('PASS: a sheet nested in a window shows, without taking the window away');
}

reset();
{
  // The ordinary case must not change: a sheet on a screen still hosts the windows opened over it.
  const tree = (sheet, open) => h(OverlayProvider, null, sheet ? h(Sheet) : null, h(Dock, { open }));
  const root = render(tree(true, false));
  act(() => root.update(tree(true, true)));
  const sheet = root.root.findByType('sheet');
  assert.equal(sheet.findAllByType('stage').length, 1, 'a window opened over a sheet is drawn inside that sheet');
  assert.equal(sheet.findByType('stage').props.place, 'sheet');
  act(() => root.update(tree(false, true)));
  assert.equal(has(root, 'stage'), 1, 'the sheet gone, the window moves to the root');
  assert.equal(root.root.findByType('stage').props.place, 'root');
  assert.deepEqual(errors, []);
  act(() => root.unmount());
  console.log('PASS: a sheet on a screen still hosts app-wide windows');
}

reset();
{
  // A window over a sheet, with a sheet of its own inside: the outer sheet's outlet keeps drawing it.
  const tree = nested => h(OverlayProvider, null, h(Sheet, { name: 'outer' }), h(Dock, { open: true, nested }));
  const root = render(tree(null));
  act(() => root.update(tree(h(Sheet, { name: 'inner' }))));
  const outer = root.root.findAll(node => node.type === 'sheet' && node.props.name === 'outer')[0];
  assert.equal(outer.findAllByType('stage').length, 1);
  assert.equal(outer.findByType('stage').findAll(node => node.type === 'sheet' && node.props.name === 'inner').length, 1);
  assert.equal(mounts.stage, 1);
  assert.deepEqual(errors, []);
  act(() => root.unmount());
  console.log('PASS: a window over a sheet keeps its own nested sheet');
}
console.error = originalError;
