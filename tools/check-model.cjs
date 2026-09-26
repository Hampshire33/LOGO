// Checks a model the way a builder would: no two parts overlap, and every part is held,
// through a chain of stud connections, by something standing on the ground.
//   node tools/check-model.cjs cat
// The rules live in src/check.js, shared with the photo app.
const path = require('path');
global.window = global;
require(path.resolve(__dirname, '../src/lego.js'));
require(path.resolve(__dirname, '../src/check.js'));
const name = process.argv[2] || 'cat';
require(path.resolve(__dirname, '../src/models', name + '.js'));
const model = window.MODELS[name];
if (!model) {
  console.error(`no model "${name}" in src/models/${name}.js`);
  process.exit(1);
}

const r = window.LEGO.checkModel(model);
for (const p of r.problems) console.log(p.text);
console.log(`${name}: ${r.parts} parts, ${r.steps} steps, ` +
  (r.problems.length ? `${r.problems.length} problem(s)` : 'no overlaps, everything is held'));
process.exit(r.problems.length ? 1 : 0);
