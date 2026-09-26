// Scores identification against scenes with known contents, and writes a report.
//   node tools/eval/run.cjs --engine offline            detector only (counts), runs anywhere
//   node tools/eval/run.cjs --engine claude             Claude via the API (needs ANTHROPIC_API_KEY)
//        [--model claude-sonnet-5] [--per-kind 3] [--kinds spread,heap,carpet,dense] [--out report.md]
// Also scores real photos placed in eval/photos/ when eval/photos/truth.json lists their contents:
//   { "kitchen-table.jpg": [{ "id": "3001", "color": "red", "qty": 4 }, ...] }
// Needs Playwright (npm i playwright && npx playwright install chromium).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENGINE = opt('--engine', 'offline');
const MODEL = opt('--model', 'claude-sonnet-5');
const PER = Number(opt('--per-kind', 3));
const KINDS = opt('--kinds', 'spread,heap,carpet,dense').split(',');
const OUT = opt('--out', path.resolve(__dirname, '../../dist/eval-report.md'));
const ROOT = path.resolve(__dirname, '../..');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright'));
}
global.window = global;
require(path.join(ROOT, 'src/identify-prompt.js'));
const P = global.PILEBUILD_PROMPT;

// ---------------------------------------------------------------- scoring

// Part numbers differ by mould suffix (3069 / 3069b, 3062b / 3062): compare the base number.
const base = (id) => String(id || '').toLowerCase().replace(/[a-z]+$/, '');
function score(truth, pred) {
  const T = truth.reduce((t, r) => t + r.qty, 0);
  const Pn = pred.reduce((t, r) => t + r.qty, 0);
  const sumBy = (rows, f) => rows.reduce((m, r) => m.set(f(r), (m.get(f(r)) || 0) + r.qty), new Map());
  const overlap = (a, b) => [...a].reduce((t, [k, q]) => t + Math.min(q, b.get(k) || 0), 0);
  const exact = overlap(sumBy(truth, (r) => base(r.id) + '|' + r.color), sumBy(pred, (r) => base(r.id) + '|' + r.color));
  const colour = overlap(sumBy(truth, (r) => r.color), sumBy(pred, (r) => r.color));
  const shape = overlap(sumBy(truth, (r) => base(r.id)), sumBy(pred, (r) => base(r.id)));
  const f1 = (m) => (T + Pn ? (2 * m) / (T + Pn) : 1);
  return { truth: T, found: Pn, countErr: T ? (Pn - T) / T : 0, exact: f1(exact), colour: f1(colour), shape: f1(shape) };
}

// ---------------------------------------------------------------- Claude via the API

async function callClaude(b64, n, of) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
    { type: 'text', text: P.userText(n, of) },
  ];
  const canForce = !/opus-5-5|fable|mythos/.test(MODEL);
  const body = { model: MODEL, max_tokens: 4000, system: P.SYSTEM, messages: [{ role: 'user', content }], tools: [P.TOOL], tool_choice: canForce ? { type: 'tool', name: P.TOOL.name } : { type: 'auto' } };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (r.status === 400 && body.tool_choice.type === 'tool') {
      body.tool_choice = { type: 'auto' };
      continue;
    }
    if (r.status === 429 || r.status === 529) {
      await new Promise((s) => setTimeout(s, 4000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`API ${r.status}: ${(j.error && j.error.message) || ''}`);
    usage.in += (j.usage && j.usage.input_tokens) || 0;
    usage.out += (j.usage && j.usage.output_tokens) || 0;
    const use = (j.content || []).find((c) => c.type === 'tool_use');
    return P.clean(use.input);
  }
  throw new Error('API busy');
}
const usage = { in: 0, out: 0 };

// ---------------------------------------------------------------- run

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = (f) => `<script>${fs.readFileSync(path.join(ROOT, f), 'utf8')}</script>`;
  await page.setContent('<body></body>' + ['src/lego.js', 'src/inventory.js', 'src/detect.js', 'src/catalog.js', 'src/identify-prompt.js', 'src/identify.js', 'tools/eval/scenes.js'].map(src).join(''));
  const catalog = path.join(ROOT, 'dist/catalog.json');
  if (fs.existsSync(catalog)) {
    await page.evaluate((j) => LEGO.catalog.load('data:application/json;base64,' + j), fs.readFileSync(catalog).toString('base64'));
  }
  await page.exposeFunction('callTile', (b64, n, of) => callClaude(b64, n, of));

  const cases = [];
  for (const kind of KINDS) for (let i = 0; i < PER; i++) cases.push({ kind, seed: 100 + i });
  const photos = path.join(ROOT, 'eval/photos');
  const photoTruth = fs.existsSync(path.join(photos, 'truth.json')) ? JSON.parse(fs.readFileSync(path.join(photos, 'truth.json'), 'utf8')) : {};
  for (const [file, truth] of Object.entries(photoTruth)) cases.push({ kind: 'photo', file, truth });
  // eval/private/: your own photos, not in the repo; truth.json optional (without it: listing only)
  const priv = path.join(ROOT, 'eval/private');
  if (args.includes('--private') && fs.existsSync(priv)) {
    const pt = fs.existsSync(path.join(priv, 'truth.json')) ? JSON.parse(fs.readFileSync(path.join(priv, 'truth.json'), 'utf8')) : {};
    for (const f of fs.readdirSync(priv).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()) cases.push({ kind: 'private', file: f, dir: priv, truth: pt[f] || [] });
  }

  const results = [];
  for (const c of cases) {
    const img = c.file ? 'data:image/jpeg;base64,' + fs.readFileSync(path.join(c.dir || photos, c.file)).toString('base64') : null;
    const r = await page.evaluate(async ({ c, img, engine }) => {
      let im, truth;
      if (img) {
        im = new Image();
        im.src = img;
        await im.decode();
        truth = c.truth;
      } else {
        const s = EVAL.scene(c.seed, c.kind);
        im = s.canvas;
        truth = s.truth;
      }
      if (engine === 'offline') {
        const d = LEGO.detect(im);
        const n = d.boxes.length + d.heaps.reduce((t, h) => t + h.estimate, 0);
        const colours = new Map();
        for (const b of d.boxes) colours.set(LEGO.detect.colorClass(...b.rgb), (colours.get(LEGO.detect.colorClass(...b.rgb)) || 0) + 1);
        for (const h of d.heaps) for (const p of h.parts) colours.set(p.color, (colours.get(p.color) || 0) + p.count);
        return { truth, pred: [...colours].map(([color, qty]) => ({ id: '?', color, qty })) };
      }
      const toB64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      const out = await LEGO.identify.run(im, async (blob, n, of) => window.callTile(await toB64(blob), n, of));
      const rows = out.rows.map((row) => (LEGO.catalog.ready ? LEGO.catalog.verify(row, 'claude') : { row, status: 'unchecked' })).filter((v) => v.status !== 'not-real').map((v) => v.row);
      return { truth, pred: rows, tiles: out.tiles, hidden: out.hidden };
    }, { c, img, engine: ENGINE });
    const s = score(r.truth, r.pred);
    if (args.includes('--debug')) {
      fs.mkdirSync(path.join(ROOT, 'dist/eval-debug'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'dist/eval-debug', (c.file || c.kind + '-' + c.seed) + '.json'), JSON.stringify({ truth: r.truth, pred: r.pred }, null, 1));
    }
    results.push(Object.assign({ name: c.file || `${c.kind}-${c.seed}`, kind: c.kind, tiles: r.tiles || 1, hidden: r.hidden || 0 }, s));
    console.log(`${(c.file || c.kind + '-' + c.seed).padEnd(14)} truth ${String(s.truth).padStart(3)}  found ${String(s.found).padStart(3)}  count ${(s.countErr * 100).toFixed(0).padStart(4)}%  part+colour ${(s.exact * 100).toFixed(0).padStart(3)}%  colour ${(s.colour * 100).toFixed(0).padStart(3)}%  shape ${(s.shape * 100).toFixed(0).padStart(3)}%`);
  }
  await browser.close();

  // report
  const byKind = {};
  for (const r of results) (byKind[r.kind] = byKind[r.kind] || []).push(r);
  const avg = (rows, k) => rows.reduce((t, r) => t + r[k], 0) / rows.length;
  const pct = (v) => (v * 100).toFixed(0) + '%';
  const lines = [
    `# Identification report: ${ENGINE}${ENGINE === 'claude' ? ' (' + MODEL + ', prompt v' + P.VERSION + ')' : ''}`,
    '',
    '| Scene | Photos | Count error (avg abs) | Part + colour | Colour only | Part only |',
    '|---|---|---|---|---|---|',
    ...Object.entries(byKind).map(([k, rows]) => `| ${k} | ${rows.length} | ${pct(rows.reduce((t, r) => t + Math.abs(r.countErr), 0) / rows.length)} | ${ENGINE === 'offline' ? 'n/a' : pct(avg(rows, 'exact'))} | ${pct(avg(rows, 'colour'))} | ${ENGINE === 'offline' ? 'n/a' : pct(avg(rows, 'shape'))} |`),
    '',
    'Scores are overlap F1 between found and true pieces (100% = every piece found with nothing extra).',
    ENGINE === 'claude' ? `Tokens: ${usage.in} in, ${usage.out} out.` : 'Offline detector: counts and colours only, no part numbers.',
  ];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  // one annotation per scene kind, readable on the run page and through the API
  if (process.env.GITHUB_ACTIONS) {
    for (const [k, rows] of Object.entries(byKind)) {
      console.log(`::notice title=${ENGINE}${ENGINE === 'claude' ? ' ' + MODEL + ' v' + P.VERSION : ''} ${k}::count error ${pct(rows.reduce((t, r) => t + Math.abs(r.countErr), 0) / rows.length)}, part+colour ${ENGINE === 'offline' ? 'n/a' : pct(avg(rows, 'exact'))}, colour ${pct(avg(rows, 'colour'))}, part ${ENGINE === 'offline' ? 'n/a' : pct(avg(rows, 'shape'))} (${rows.length} photos)`);
    }
    if (ENGINE === 'claude') {
      const pr = { 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20] }[MODEL] || [4, 20];
      console.log(`::notice title=cost::${usage.in} tokens in, ${usage.out} out, about $${((usage.in * pr[0] + usage.out * pr[1]) / 1e6).toFixed(2)}`);
    }
  }
  console.log('\n' + lines.join('\n'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
