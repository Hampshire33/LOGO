/*
 * inventory.js
 * What you own, what a model needs, and a model built only from what you own.
 *
 *   const inv = LEGO.inv.from([{ id: '3001', color: 'red', qty: 4 }, ...]);
 *   LEGO.inv.coverage(inv, model)    // { total, exact, shape, missing: [{id, color, qty}] }
 *   LEGO.inv.generate(inv)           // a model that uses only inventory parts, or null
 *
 * An inventory row is { id, color, qty, name? }. `id` is a BrickLink part number and `color`
 * a key of LEGO.COLORS; rows the engine cannot draw (a part or colour outside the library)
 * are kept and listed but never used in a build.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const INV = (LEGO.inv = {});
  const key = (id, color) => id + '|' + color;

  // Recognisers often return an older or variant number for the same brick shape.
  INV.ALIAS = { '3065': '3004', '3066': '3010', '3067': '3009', '3004b': '3004', '3001old': '3001', '3003old': '3003' };

  INV.usable = (row) => !!(LEGO.LIB[row.id] && LEGO.COLORS[row.color]);

  // Merge rows with the same part and colour.
  INV.from = function from(rows) {
    const m = new Map();
    for (const r of rows || []) {
      const qty = Math.max(0, Math.round(Number(r.qty) || 0));
      if (!r.id || !qty) continue;
      const id = INV.ALIAS[String(r.id)] || String(r.id);
      const k = key(id, String(r.color || ''));
      const cur = m.get(k);
      const rank = { high: 3, medium: 2, low: 1 };
      if (cur) {
        cur.qty += qty;
        if (r.conf && (!cur.conf || rank[r.conf] < rank[cur.conf])) cur.conf = r.conf;
      } else {
        const row = { id, color: String(r.color || ''), qty, name: r.name || '' };
        if (r.conf) row.conf = r.conf; // how sure the reader was (high / medium / low)
        if (r.category) row.category = r.category;
        m.set(k, row);
      }
    }
    return [...m.values()];
  };

  INV.count = (inv) => inv.reduce((s, r) => s + r.qty, 0);

  // Counts a model needs, by part + colour.
  INV.needs = function needs(model) {
    const m = new Map();
    for (const s of model.steps.flat()) {
      const k = key(s.id, s.color);
      const cur = m.get(k);
      if (cur) cur.qty++;
      else m.set(k, { id: s.id, color: s.color, qty: 1 });
    }
    return [...m.values()];
  };

  // How much of a model your parts cover: exact = right part and colour,
  // shape = right part in any colour (you could build it in your own colours).
  INV.coverage = function coverage(inv, model) {
    const need = INV.needs(model);
    const have = new Map(inv.map((r) => [key(r.id, r.color), r.qty]));
    const byShape = new Map();
    for (const r of inv) byShape.set(r.id, (byShape.get(r.id) || 0) + r.qty);
    let total = 0;
    let exact = 0;
    const missing = [];
    for (const n of need) {
      total += n.qty;
      const got = Math.min(n.qty, have.get(key(n.id, n.color)) || 0);
      exact += got;
      if (got < n.qty) missing.push({ id: n.id, color: n.color, qty: n.qty - got });
    }
    let shape = 0;
    const shapeNeed = new Map();
    for (const n of need) shapeNeed.set(n.id, (shapeNeed.get(n.id) || 0) + n.qty);
    for (const [id, q] of shapeNeed) shape += Math.min(q, byShape.get(id) || 0);
    return { total, exact, shape, missing };
  };

  // Parts a model uses beyond the inventory.
  INV.overuse = function overuse(inv, model) {
    return INV.coverage(inv, model).missing;
  };

  // ------------------------------------------------------------------ generator

  // A striped block built only from your bricks and plates: two studs deep, layers
  // alternating their joints like brickwork, each layer in one colour where it can be.
  // Plain and sturdy, the "sort your pile" build. Returns null when there is too little.
  INV.generate = function generate(inv, opt) {
    const o = opt || {};
    // Upright box parts with studs on top, 1 or 2 deep: bricks (3 plates) and plates (1).
    const pool = [];
    for (const r of inv) {
      if (!INV.usable(r)) continue;
      const d = LEGO.LIB[r.id];
      if (d.kind !== 'ext' || d.profile.length !== 4 || !d.studs.length) continue;
      const plates = Math.round(d.h / LEGO.PLATE);
      if (plates !== 1 && plates !== 3) continue;
      if (d.d > 2 || d.w > 8 || d.w < d.d) continue;
      pool.push({ id: r.id, color: r.color, w: d.w, d: d.d, h: plates, qty: r.qty });
    }
    if (!pool.length) return null;

    const area = pool.reduce((s, p) => s + p.w * p.d * p.h * p.qty, 0);
    // Length of the block: long enough to look like something, short enough to get height.
    const L = o.length || [8, 6, 4].find((n) => area / (2 * n) >= 9) || 4;

    const take = (p) => {
      p.qty--;
      return p;
    };

    // Fill one row of `len` studs from pieces that match (depth, height), preferring one colour.
    // Returns the pieces in order, or null. Small search: rows are at most 8 long.
    function fillRow(len, depth, h, color, joints) {
      for (const strict of joints && joints.size ? [true, false] : [false]) {
        const r = fillRowOnce(len, depth, h, color, strict ? joints : null);
        if (r) return r;
      }
      return null;
    }

    function fillRowOnce(len, depth, h, color, joints) {
      const cands = pool.filter((p) => p.qty > 0 && p.d === depth && p.h === h && p.w <= len);
      const order = (a, b) => (b.color === color) - (a.color === color) || b.w - a.w;
      cands.sort(order);
      const used = new Map();
      const out = [];
      function rec(left) {
        if (left === 0) return true;
        for (const p of cands) {
          if (p.w > left || (used.get(p) || 0) >= p.qty) continue;
          const at = len - left + p.w;
          if (joints && at < len && joints.has(at)) continue;
          used.set(p, (used.get(p) || 0) + 1);
          out.push(p);
          if (rec(left - p.w)) return true;
          out.pop();
          used.set(p, used.get(p) - 1);
        }
        return false;
      }
      return rec(len) ? out.slice() : null;
    }

    // A full layer two studs deep: 2-deep pieces across, or two rows of 1-deep pieces.
    function layer(h, color, joints) {
      const two = fillRow(L, 2, h, color, joints);
      if (two) return two.map((p) => [take(p), 0]);
      const front = fillRow(L, 1, h, color, joints);
      if (!front) return null;
      front.forEach(take);
      const back = fillRow(L, 1, h, color, jointsOf(front));
      if (!back) {
        front.forEach((p) => p.qty++);
        return null;
      }
      back.forEach(take);
      return front.map((p) => [p, 0]).concat(back.map((p) => [p, 1]));
    }

    const colorsByArea = () => {
      const m = new Map();
      for (const p of pool) if (p.qty > 0) m.set(p.color, (m.get(p.color) || 0) + p.w * p.d * p.qty);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    };

    const jointsOf = (pieces) => {
      const j = new Set();
      let x = 0;
      for (const p of pieces) {
        x += p.w;
        if (x < L) j.add(x);
      }
      return j;
    };

    const steps = [];
    let below = new Set();
    let z = 0;
    let n = 0;
    const maxLayers = o.maxLayers || 10;
    while (n < maxLayers) {
      let placed = null;
      const colors = colorsByArea();
      // Try bricks first (height), then plates; keep the colour of the layer below for bands.
      for (const h of [3, 1]) {
        for (const c of colors) {
          placed = layer(h, c, below);
          if (placed) {
            placed.h = h;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) break;
      // Each row left to right; the search above already kept joints off the ones below.
      const step = [];
      const cursor = [0, 0];
      const rows = [[], []];
      for (const [p, y] of placed) rows[y].push(p);
      for (let y = 0; y < 2; y++) {
        for (const p of rows[y]) {
          step.push({ id: p.id, color: p.color, at: [cursor[y], y, z] });
          cursor[y] += p.w;
        }
      }
      below = new Set([...jointsOf(rows[0]), ...jointsOf(rows[1])]);
      steps.push(step);
      z += placed.h;
      n++;
    }
    if (steps.length < 2) return null;
    return { title: o.title || 'Sorted Stack', theta: 38, phi: 26, steps, generated: true };
  };

  // ------------------------------------------------------------------ colours

  // BrickLink colour name -> LEGO.COLORS key, for recognisers that answer with names.
  INV.colorKey = function colorKey(name) {
    if (!name) return '';
    if (LEGO.COLORS[name]) return name;
    const n = String(name).toLowerCase().replace(/[^a-z]/g, '');
    for (const c of Object.values(LEGO.COLORS)) if (c.name.toLowerCase().replace(/[^a-z]/g, '') === n) return c.key;
    const alias = { lightgray: 'lbg', lightbluishgrey: 'lbg', darkgray: 'dbg', darkbluishgrey: 'dbg', brown: 'brown', trans: '' };
    return alias[n] || '';
  };

  // Nearest library colour to an RGB triple (for reading the main colours of a photo).
  INV.nearestColor = function nearestColor(rgb) {
    let best = null;
    let bd = Infinity;
    for (const c of Object.values(LEGO.COLORS)) {
      const d = (c.rgb[0] - rgb[0]) ** 2 * 0.3 + (c.rgb[1] - rgb[1]) ** 2 * 0.59 + (c.rgb[2] - rgb[2]) ** 2 * 0.11;
      if (d < bd) {
        bd = d;
        best = c.key;
      }
    }
    return best;
  };

  // Compact library description for a prompt: every part Claude may use and how it sits.
  INV.libraryText = function libraryText() {
    const rows = LEGO.ORDER.map((id) => {
      const d = LEGO.LIB[id];
      const side = d.studs.filter((s) => s[3]).length;
      const shape = d.kind === 'cyl' ? 'round' : d.profile.length === 4 ? (d.studs.length ? 'box' : 'tile') : id === '3044c' ? 'ridge' : d.profile.length > 6 ? 'curved slope' : 'slope';
      return `${id} | ${d.label} | w${d.w} d${d.d} h${Math.round(d.h / LEGO.PLATE)} | ${shape}${side ? ' | side stud on -y face, centre 0.7 above bottom' : ''}`;
    });
    const colors = Object.values(LEGO.COLORS).map((c) => `${c.key} = ${c.name}`);
    return 'PARTS (id | name | width x, depth y, height in plates | shape)\n' + rows.join('\n') + '\n\nCOLOURS (key = BrickLink name)\n' + colors.join('\n');
  };
})(typeof window !== 'undefined' ? window : globalThis);
