/*
 * identify.js
 * Reads a photo of LEGO pieces with Claude, tile by tile.
 *
 * Claude's counts get unreliable with many small objects in one image, and images are scaled
 * down past ~1500-2500 px. So a large photo is cut into overlapping tiles of about 1000 px;
 * each tile shows a magenta frame (the counting zone) with the overlap dimmed, and Claude counts
 * only pieces centred inside the frame, so a piece on a tile border is counted exactly once.
 * Small photos (web images) are read whole: cutting them would only make blurry fragments.
 *
 *   const r = await LEGO.identify.run(img, callTile, { onProgress });
 *   // callTile(jpegBlob, n, of) -> the report_pieces answer for that tile
 *   // r = { rows: [{id, name, color, qty, conf, category}], hidden, notes, tiles, grid }
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const P = root.PILEBUILD_PROMPT;
  const ID = (LEGO.identify = {});

  ID.TILE = 700; // source pixels per tile side, roughly
  ID.MAX_GRID = 3;
  ID.OVERLAP = 0.14; // of a tile, on each inner edge
  ID.SEND = 1400; // long side of each image sent

  // Grid for a photo: enough tiles that each is about ID.TILE source pixels, at most 3 x 3.
  ID.grid = function grid(W, H, density, want) {
    const extra = density === 'lots' ? 1 : 0;
    let cols, rows;
    if (want) {
      // about `want` tiles, shaped like the photo
      cols = Math.max(1, Math.round(Math.sqrt((want * W) / H)));
      rows = Math.max(1, Math.round(want / cols));
    } else {
      cols = Math.round(W / ID.TILE) + extra;
      rows = Math.round(H / ID.TILE) + extra;
    }
    cols = Math.max(1, Math.min(ID.MAX_GRID, cols));
    rows = Math.max(1, Math.min(ID.MAX_GRID, rows));
    // never cut below ~350 px of source per tile: that only makes blurry fragments
    const c = Math.max(1, Math.min(cols, Math.floor(W / 350)));
    const r = Math.max(1, Math.min(rows, Math.floor(H / 350)));
    return { cols: c, rows: r };
  };

  // Tiles with their counting zone (core) and the wider area shown (view), in source pixels.
  ID.plan = function plan(W, H, density, want) {
    const g = ID.grid(W, H, density, want);
    const tiles = [];
    const cw = W / g.cols;
    const ch = H / g.rows;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const core = { x: c * cw, y: r * ch, w: cw, h: ch };
        const ox = g.cols > 1 ? cw * ID.OVERLAP : 0;
        const oy = g.rows > 1 ? ch * ID.OVERLAP : 0;
        const x0 = Math.max(0, core.x - ox), y0 = Math.max(0, core.y - oy);
        const x1 = Math.min(W, core.x + core.w + ox), y1 = Math.min(H, core.y + core.h + oy);
        tiles.push({ core, view: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      }
    }
    return { grid: g, tiles };
  };

  // One tile as a JPEG: the view area, overlap dimmed, counting zone framed in magenta.
  ID.render = function render(img, tile, single) {
    const v = tile.view;
    const s = Math.min(1, ID.SEND / Math.max(v.w, v.h));
    // small photos are enlarged a little so edges and studs stay readable
    const up = Math.max(v.w, v.h) < 800 ? Math.min(2, 800 / Math.max(v.w, v.h)) : 1;
    const k = s * up;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(v.w * k));
    cv.height = Math.max(1, Math.round(v.h * k));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, v.x, v.y, v.w, v.h, 0, 0, cv.width, cv.height);
    if (!single) {
      const c = tile.core;
      const fx = (c.x - v.x) * k, fy = (c.y - v.y) * k, fw = c.w * k, fh = c.h * k;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(0, 0, cv.width, fy);
      ctx.fillRect(0, fy + fh, cv.width, cv.height - fy - fh);
      ctx.fillRect(0, fy, fx, fh);
      ctx.fillRect(fx + fw, fy, cv.width - fx - fw, fh);
      ctx.strokeStyle = '#FF00DD';
      ctx.lineWidth = Math.max(3, Math.round(cv.width / 300));
      ctx.strokeRect(fx, fy, fw, fh);
    }
    return cv;
  };

  const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));

  // Run every tile through `callTile` (3 at a time) and merge the answers.
  // Adaptive reading. Measured on the test bench: tiles help big dense piles (count error 67% ->
  // 52%) but hurt ordinary ones (pieces on tile borders) and cost ~3x. So Claude reads the whole
  // photo first; only when it finds a big pile is the photo re-read in tiles of ~30 pieces each.
  ID.BIG = 60; // pieces (found + hidden) above which a photo is re-read in tiles
  ID.PER_TILE = 30;

  ID.run = async function run(img, callTile, opt) {
    const o = opt || {};
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    if (o.adaptive === false) return ID.runPlan(img, callTile, o, ID.plan(W, H, o.density));
    // Cost first: without "lots of small pieces", a photo is read once, whole.
    if (o.density !== 'lots') {
      const one = await ID.runPlan(img, callTile, o, ID.plan(W, H, '', 1));
      return Object.assign(one, { passes: 1 });
    }
    const first = await ID.runPlan(img, callTile, Object.assign({}, o, { onProgress: null }), ID.plan(W, H, '', 1));
    const est = first.rows.reduce((t, r) => t + r.qty, 0) + first.hidden;
    // Tile when the pile fills the frame (no floor showing) or is very large; a big heap with
    // floor around it reads better whole (measured: tiling a 68-piece heap raised the error).
    const busy = o.busy != null ? o.busy : !!(LEGO.detect && LEGO.detect.census && LEGO.detect.census(img).fullFrame);
    const big = est > 150 || (busy && est > ID.BIG);
    const want = Math.ceil((est * (o.density === 'lots' ? 2 : 1.5)) / ID.PER_TILE);
    const p = ID.plan(W, H, '', want);
    if (!big || p.tiles.length < 2) return Object.assign(first, { passes: 1, estimate: est, busy });
    if (o.onBig) o.onBig(est, p.tiles.length);
    const second = await ID.runPlan(img, callTile, o, p);
    return Object.assign(second, { passes: 2, estimate: est, firstPass: first });
  };

  ID.runPlan = async function runPlan(img, callTile, o, p) {
    const n = p.tiles.length;
    const answers = new Array(n);
    const errors = [];
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < n) {
        const i = next++;
        const cv = ID.render(img, p.tiles[i], n === 1);
        try {
          answers[i] = P.clean(await callTile(await toBlob(cv), i + 1, n, cv));
        } catch (e) {
          errors.push({ tile: i + 1, error: e });
        }
        done++;
        if (o.onProgress) o.onProgress(done, n);
      }
    }
    await Promise.all([worker(), worker(), worker()].slice(0, Math.min(3, n)));
    if (errors.length === n) throw errors[0].error;
    const merged = ID.merge(answers.filter(Boolean));
    return Object.assign(merged, { tiles: n, grid: p.grid, failed: errors.length, errors });
  };

  // Sum tile answers into parts-list rows (colours as engine keys where known).
  ID.merge = function merge(answers) {
    const m = new Map();
    let hidden = 0;
    const notes = [];
    const rank = { high: 3, medium: 2, low: 1 };
    for (const a of answers) {
      hidden += a.hidden_count;
      if (a.notes) notes.push(a.notes);
      for (const p of a.pieces) {
        const color = colorKey(p.color);
        const part = ID.partFor(p);
        const k = (part.id || part.name) + '|' + color;
        const cur = m.get(k);
        if (cur) {
          cur.qty += p.count;
          if (rank[p.confidence] < rank[cur.conf]) cur.conf = p.confidence;
        } else {
          m.set(k, { id: part.id, name: part.name, color, colorName: p.color, qty: p.count, conf: p.confidence, category: p.category, shape: p.shape });
        }
      }
    }
    return { rows: [...m.values()], hidden, notes: [...new Set(notes)].slice(0, 4) };
  };

  // Plain pieces get their part number from what Claude saw (type + studs), not from its memory
  // of numbers: measured, it often gave brick numbers for plates. Common moulds by size:
  const PLAIN = {
    brick: { '1x1': '3005', '1x2': '3004', '1x3': '3622', '1x4': '3010', '1x6': '3009', '1x8': '3008', '1x10': '6111', '1x12': '6112', '2x2': '3003', '2x3': '3002', '2x4': '3001', '2x6': '2456', '2x8': '3007', '2x10': '3006' },
    plate: { '1x1': '3024', '1x2': '3023', '1x3': '3623', '1x4': '3710', '1x6': '3666', '1x8': '3460', '1x10': '4477', '1x12': '60479', '2x2': '3022', '2x3': '3021', '2x4': '3020', '2x6': '3795', '2x8': '3034', '2x10': '3832', '2x12': '2445', '4x4': '3031', '4x6': '3032', '4x8': '3035', '6x6': '3958', '6x8': '3036' },
    tile: { '1x1': '3070b', '1x2': '3069b', '1x3': '63864', '1x4': '2431', '1x6': '6636', '1x8': '4162', '2x2': '3068b', '2x4': '87079', '2x6': '69729' },
    round_plate: { '1x1': '4073', '2x2': '4032' },
    round_brick: { '1x1': '3062b', '2x2': '3941' },
    round_tile: { '1x1': '98138', '2x2': '14769' },
  };
  const NAME = { brick: 'Brick', plate: 'Plate', tile: 'Tile', round_plate: 'Plate Round', round_brick: 'Brick Round', round_tile: 'Tile Round' };
  ID.partFor = function partFor(p) {
    const table = PLAIN[p.shape];
    if (!table || !p.studs_w || !p.studs_l) return { id: p.part_num, name: p.name };
    const size = p.studs_w + 'x' + p.studs_l;
    const name = `${NAME[p.shape]} ${p.studs_w} x ${p.studs_l}`;
    const id = table[size] || (LEGO.catalog && LEGO.catalog.byName && LEGO.catalog.byName(name)) || p.part_num;
    return { id, name };
  };

  function colorKey(name) {
    return (LEGO.catalog && LEGO.catalog.colorKey(name)) || (LEGO.inv && LEGO.inv.colorKey(name)) || name;
  }

  // ---------------------------------------------------------------- callers

  // Published prices, US dollars per million tokens (input, output). platform.claude.com/docs pricing.
  ID.PRICE = { 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-4-5-20251001': [1, 5] };

  // Adds up what reads cost, from the token usage the server reports.
  ID.meter = function meter() {
    const m = { reads: 0, in: 0, out: 0, usd: 0, models: new Set() };
    m.add = (usage, model) => {
      if (!usage) return;
      const p = ID.PRICE[model] || [4, 20];
      const i = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      const o = usage.output_tokens || 0;
      m.reads++;
      m.in += i;
      m.out += o;
      m.usd += (i * p[0] + o * p[1]) / 1e6;
      if (model) m.models.add(model);
    };
    return m;
  };

  // Through the AI server (public site). One request per tile; the server holds the prompt.
  // opt.precise asks for the stronger model; opt.meter collects the cost of each read.
  ID.viaServer = function viaServer(endpoint, opt) {
    const o = opt || {};
    return async (blob, n, of) => {
      const b64 = await blobToBase64(blob);
      const r = await fetch(endpoint.replace(/\/$/, '') + '/v1/identify-tile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: b64, n, of, precise: !!o.precise }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { code: j.code || 'server_error', status: r.status });
      if (o.meter) o.meter.add(j.usage, j.model);
      return j.answer;
    };
  };

  // Through the claude.ai page's own Claude (the `sample` capability).
  ID.viaSample = function viaSample(sample) {
    return async (blob, n, of) =>
      sample.json(P.SYSTEM + '\n\n' + P.userText(n, of) + '\n\n' + P.JSON_INSTRUCTIONS, { images: [blob], modelTier: 'complex' });
  };

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
