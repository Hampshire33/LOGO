// Builds the real-LEGO catalogue the app checks every identified piece against:
// every part, every colour, and which colours each part was actually produced in.
//   node tools/catalog.cjs                 download from Rebrickable (runs in the Pages build)
//   node tools/catalog.cjs --from <dir>    read colors/parts/elements/part_categories .csv(.gz) from a folder
// -> dist/catalog.json
// Data: Rebrickable (https://rebrickable.com/downloads/), free to use; credited in the app.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = 'https://cdn.rebrickable.com/media/downloads/';
const FILES = ['colors', 'parts', 'elements', 'part_categories'];
const args = process.argv.slice(2);
const fromDir = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const out = path.resolve(__dirname, '../dist/catalog.json');

async function load(name) {
  let buf;
  if (fromDir) {
    const gz = path.join(fromDir, name + '.csv.gz');
    const plain = path.join(fromDir, name + '.csv');
    buf = fs.existsSync(gz) ? zlib.gunzipSync(fs.readFileSync(gz)) : fs.readFileSync(plain);
  } else {
    const r = await fetch(BASE + name + '.csv.gz');
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    buf = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()));
  }
  return parseCsv(buf.toString('utf8'));
}

// CSV with quoted fields (part names contain commas and quotes). Returns rows as objects by header.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

(async () => {
  const [colors, parts, elements, cats] = await Promise.all(FILES.map(load));

  // Colours: id -> [name, hex, transparent]. Skip Rebrickable's placeholder colours.
  const col = {};
  for (const c of colors) {
    const id = Number(c.id);
    if (!(id >= 0) || /^\[|unknown|no color|any color/i.test(c.name)) continue;
    col[id] = [c.name, (c.rgb || '').toUpperCase(), c.is_trans === 't' || c.is_trans === 'True' ? 1 : 0];
  }

  // Produced colours per part, from the element list (an element is a part made in a colour).
  const made = new Map();
  for (const e of elements) {
    const p = e.part_num;
    const c = Number(e.color_id);
    if (!p || !col[c]) continue;
    if (!made.has(p)) made.set(p, new Set());
    made.get(p).add(c);
  }

  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const skipCat = /non-lego|stickers|^bionicle|duplo|quatro|primo|znap|fabuland|clikits/i;
  const out_parts = {};
  let kept = 0;
  for (const p of parts) {
    const cn = catName[p.part_cat_id] || '';
    if (skipCat.test(cn)) continue;
    const colorsMade = made.get(p.part_num);
    // Parts never produced as an element in any colour are catalogue oddities (moulds, stickers).
    if (!colorsMade || !colorsMade.size) continue;
    out_parts[p.part_num] = [p.name, Number(p.part_cat_id), [...colorsMade].sort((a, b) => a - b)];
    kept++;
  }
  const catsOut = Object.fromEntries(cats.filter((c) => !skipCat.test(c.name)).map((c) => [c.id, c.name]));

  const data = {
    v: 1,
    source: 'Rebrickable',
    built: new Date().toISOString().slice(0, 10),
    colors: col,
    cats: catsOut,
    parts: out_parts,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(`catalog.json: ${kept} parts, ${Object.keys(col).length} colours, ${mb} MB`);
})().catch((e) => {
  console.error('catalogue build failed:', e.message);
  process.exit(1);
});
