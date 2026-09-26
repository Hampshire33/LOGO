// Design test bench: Claude designs models for a few cases; each result is checked, rendered next
// to its target, and written to dist/design-results/ (the workflow publishes it to the
// design-results branch). Cases and model come from eval/design-request.json.
//   ANTHROPIC_API_KEY=... node tools/design-bench.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright'));
}
const req = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/design-request.json'), 'utf8'));
const MODEL = req.model || 'claude-opus-5-5';
const OUT = path.join(ROOT, 'dist/design-results');
const PRICE = { 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20] }[MODEL] || [4, 20];

// piles to design with
const PILES = {
  none: [],
  ones: [['black', 11], ['blue', 17], ['white', 3], ['yellow', 21], ['red', 14], ['green', 8]].map(([color, qty]) => ({ id: '3004', color, qty })),
  varied: [
    ['3001', 'red', 8], ['3004', 'red', 12], ['3010', 'red', 6], ['3003', 'red', 4], ['3005', 'red', 6], ['3020', 'red', 4], ['3023', 'red', 6],
    ['3001', 'white', 4], ['3004', 'white', 8], ['3022', 'white', 3], ['3069', 'white', 4], ['3001', 'black', 4], ['3004', 'black', 10],
    ['3020', 'black', 4], ['3034', 'black', 2], ['4032', 'black', 6], ['87087', 'red', 6], ['87087', 'black', 4], ['98138', 'yellow', 4],
    ['98138', 'white', 4], ['3039', 'red', 4], ['3040', 'red', 4], ['3068', 'lbg', 4], ['3023', 'lbg', 8], ['3004', 'lbg', 8],
    ['3001', 'blue', 4], ['3004', 'blue', 8], ['3004', 'yellow', 6], ['3070', 'yellow', 4], ['2431', 'black', 4], ['3666', 'lbg', 4],
  ].map(([id, color, qty]) => ({ id, color, qty })),
};

async function callApi(payload) {
  if (process.env.FAKE_API) {
    // dry run without spending: a fixed tiny model
    const steps = [[{ i: '3001', c: 'red', a: [0, 0, 0], r: 0, u: '' }, { i: '3001', c: 'red', a: [0, 2, 0], r: 0, u: '' }], [{ i: '3003', c: 'yellow', a: [1, 1, 3], r: 0, u: '' }]];
    return { content: [{ type: 'tool_use', id: 'x', name: 'submit_model', input: { title: 'Dry Run', steps } }], usage: { input_tokens: 4000, output_tokens: 3000 } };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (r.status === 429 || r.status === 529) {
      await new Promise((s) => setTimeout(s, 5000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`API ${r.status}: ${(j.error && j.error.message) || ''}`);
    return j;
  }
  throw new Error('API busy');
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.FAKE_API) throw new Error('ANTHROPIC_API_KEY is not set');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = (f) => `<script>${fs.readFileSync(path.join(ROOT, f), 'utf8')}</script>`;
  await page.setContent('<body></body>' + ['src/lego.js', 'src/booklet.js', 'src/check.js', 'src/inventory.js', 'src/designs.js', 'src/design-core.js'].map(src).join(''));
  await page.exposeFunction('callApi', callApi);

  const summary = [];
  let usd = 0;
  for (const c of req.cases) {
    const t0 = Date.now();
    let res;
    try {
      res = await page.evaluate(async ({ c, pile, model }) => {
        // target: a rendered LEGO model standing in for a photo ("render:car", "render:house")
        let image = null;
        let targetPng = null;
        if (c.target && c.target.startsWith('render:')) {
          const m = LEGO.designs.build(c.target.slice(7), { length: 10, colors: { main: c.targetColor || 'yellow', second: 'red' } });
          const f = LEGO.booklet(m, 'horizontal');
          const cv = document.createElement('canvas');
          cv.width = f.W;
          cv.height = f.H;
          f.draw(cv.getContext('2d'), 0.55 + m.steps.length * 0.85 + 0.3);
          const crop = document.createElement('canvas');
          crop.width = 1000;
          crop.height = 750;
          crop.getContext('2d').drawImage(cv, 600, 120, 1260, 900, 0, 0, 1000, 750);
          image = crop.toDataURL('image/jpeg', 0.88).split(',')[1];
          targetPng = crop.toDataURL('image/png');
        }
        const r = await LEGO.designAI.run(window.callApi, { image, want: c.want, inventory: pile, onlyMine: !!c.onlyMine, model });
        // render the result, finished, before the spin
        const f = LEGO.booklet(r.model, 'horizontal');
        const cv = document.createElement('canvas');
        cv.width = f.W;
        cv.height = f.H;
        f.draw(cv.getContext('2d'), 0.55 + r.model.steps.length * 0.85 + 0.3);
        const out = document.createElement('canvas');
        out.width = 1600;
        out.height = 600;
        const o = out.getContext('2d');
        o.fillStyle = '#fff';
        o.fillRect(0, 0, 1600, 600);
        if (targetPng) {
          const im = new Image();
          im.src = targetPng;
          await im.decode();
          o.drawImage(im, 0, 50, 700, 525);
        } else {
          o.fillStyle = '#1B1F24';
          o.font = '600 34px sans-serif';
          o.fillText('"' + (c.want || 'anything') + '"', 40, 300);
        }
        o.drawImage(cv, 560, 60, 1360, 960, 780, 20, 800, 565);
        o.fillStyle = '#5B6570';
        o.font = '20px sans-serif';
        o.fillText('target', 20, 30);
        o.fillText('Claude\'s design: ' + r.model.title, 800, 30);
        const cov = LEGO.inv.coverage(pile, r.model);
        return { png: out.toDataURL('image/png'), model: r.model, check: { ok: r.check.ok, problems: r.check.problems.length, parts: r.check.parts, steps: r.check.steps }, rounds: r.rounds, usage: r.usage, owned: cov.exact, total: cov.total };
      }, { c, pile: PILES[c.pile || 'none'], model: MODEL });
    } catch (e) {
      console.log(`::error title=design ${c.name}::${e.message}`);
      summary.push(`| ${c.name} | failed: ${e.message} |`);
      continue;
    }
    const cost = (res.usage.input_tokens * PRICE[0] + res.usage.output_tokens * PRICE[1]) / 1e6;
    usd += cost;
    fs.writeFileSync(path.join(OUT, c.name + '.png'), Buffer.from(res.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, c.name + '.json'), JSON.stringify(res.model));
    const line = `${res.check.parts} parts, ${res.check.steps} steps, ${res.check.ok ? 'checks pass' : res.check.problems + ' problems'}, ${res.rounds} round(s), owned ${res.owned}/${res.total}, $${cost.toFixed(2)}, ${Math.round((Date.now() - t0) / 1000)} s`;
    console.log(`::notice title=design ${c.name}::${res.model.title}: ${line}`);
    summary.push(`| ${c.name} | ${res.model.title} | ${line} |`);
  }
  await browser.close();
  console.log(`::notice title=design cost::${MODEL}, total $${usd.toFixed(2)}`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Design bench (${MODEL}, design v${2})\n\n| Case | Title | Result |\n|---|---|---|\n${summary.join('\n')}\n\nTotal $${usd.toFixed(2)}\n`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
