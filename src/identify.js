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

  ID.TILE = 1000; // source pixels per tile side, roughly
  ID.MAX_GRID = 3;
  ID.OVERLAP = 0.14; // of a tile, on each inner edge
  ID.SEND = 1400; // long side of each image sent

  // Grid for a photo: enough tiles that each is about ID.TILE source pixels, at most 3 x 3.
  ID.grid = function grid(W, H, density) {
    const extra = density === 'lots' ? 1 : 0;
    const cols = Math.max(1, Math.min(ID.MAX_GRID, Math.round(W / ID.TILE) + extra));
    const rows = Math.max(1, Math.min(ID.MAX_GRID, Math.round(H / ID.TILE) + extra));
    // never cut below ~350 px of source per tile: that only makes blurry fragments
    const c = Math.max(1, Math.min(cols, Math.floor(W / 350)));
    const r = Math.max(1, Math.min(rows, Math.floor(H / 350)));
    return { cols: c, rows: r };
  };

  // Tiles with their counting zone (core) and the wider area shown (view), in source pixels.
  ID.plan = function plan(W, H, density) {
    const g = ID.grid(W, H, density);
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
  ID.run = async function run(img, callTile, opt) {
    const o = opt || {};
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    const p = ID.plan(W, H, o.density);
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
        const k = (p.part_num || p.name) + '|' + color;
        const cur = m.get(k);
        if (cur) {
          cur.qty += p.count;
          if (rank[p.confidence] < rank[cur.conf]) cur.conf = p.confidence;
        } else {
          m.set(k, { id: p.part_num, name: p.name, color, colorName: p.color, qty: p.count, conf: p.confidence, category: p.category });
        }
      }
    }
    return { rows: [...m.values()], hidden, notes: [...new Set(notes)].slice(0, 4) };
  };

  function colorKey(name) {
    return (LEGO.catalog && LEGO.catalog.colorKey(name)) || (LEGO.inv && LEGO.inv.colorKey(name)) || name;
  }

  // ---------------------------------------------------------------- callers

  // Through the AI server (public site). One request per tile; the server holds the prompt.
  ID.viaServer = function viaServer(endpoint) {
    return async (blob, n, of) => {
      const b64 = await blobToBase64(blob);
      const r = await fetch(endpoint.replace(/\/$/, '') + '/v1/identify-tile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: b64, n, of }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { code: j.code || 'server_error', status: r.status });
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
