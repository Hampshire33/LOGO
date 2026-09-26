/*
 * fit.js
 * Rebuilds a design from the parts you own, the way a builder would at the table:
 *   1. use the exact part and colour where you have it;
 *   2. a long brick, plate or tile you lack becomes shorter ones of the same colour that you
 *      have, laid in the same row (two 1x2 for a 1x4; two rows of 1-wide for a 2-wide);
 *   3. if allowed, a part you have in another colour stands in (nearest colour first);
 *   4. whatever is left is the shopping list.
 * The result is checked again; if a substitution broke the build, it falls back to step 1+3.
 * Every colour is also held to what LEGO actually produced when the catalogue is loaded.
 *
 *   const r = LEGO.fit(model, inventory, { swapColors: true });
 *   // r.model, r.missing [{id,color,qty}], r.changes (count of substitutions), r.check
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const FAM = LEGO.designs.FAM;
  const ONE = { brick2: 'brick1', plate2: 'plate1', tile2: 'tile1' };

  // part id -> { fam, len }
  const FAM_OF = {};
  for (const [fam, sizes] of Object.entries(FAM)) for (const [len, id] of Object.entries(sizes)) FAM_OF[id] = { fam, len: Number(len) };

  const key = (id, color) => id + '|' + color;
  const dist = (a, b) => {
    const p = LEGO.COLORS[a], q = LEGO.COLORS[b];
    if (!p || !q) return Infinity;
    return (p.rgb[0] - q.rgb[0]) ** 2 * 0.3 + (p.rgb[1] - q.rgb[1]) ** 2 * 0.59 + (p.rgb[2] - q.rgb[2]) ** 2 * 0.11;
  };

  // Keep every part in a colour LEGO actually made it in (when the catalogue is loaded).
  LEGO.realColors = function realColors(model) {
    const cat = LEGO.catalog;
    let changed = 0;
    if (!cat || !cat.ready) return { model, changed };
    const steps = model.steps.map((st) => st.map((s) => {
      if (cat.madeIn(s.id, s.color)) return s;
      const near = cat.nearestMade(s.id, s.color);
      if (!near || near === s.color) return s;
      changed++;
      return Object.assign({}, s, { color: near });
    }));
    return { model: Object.assign({}, model, { steps }), changed };
  };

  LEGO.fit = function fit(model, inv, opt) {
    const o = opt || {};
    const attempt = (allowSplit) => run(model, inv, o, allowSplit);
    let r = attempt(true);
    if (r.check.problems.length) {
      const safe = attempt(false);
      if (safe.check.problems.length <= r.check.problems.length) r = safe;
    }
    return r;
  };

  function run(model, inv, o, allowSplit) {
    const stock = new Map();
    for (const row of inv) if (row.qty > 0) stock.set(key(row.id, row.color), (stock.get(key(row.id, row.color)) || 0) + row.qty);
    const have = (id, color) => (stock.get(key(id, color)) || 0) > 0;
    const take = (id, color) => stock.set(key(id, color), stock.get(key(id, color)) - 1);

    // First pass: exact matches everywhere, so substitutions never steal a part an exact use needs.
    const specs = model.steps.map((st) => st.map((s) => ({ s, ok: false })));
    for (const st of specs) for (const e of st) if (have(e.s.id, e.s.color)) { take(e.s.id, e.s.color); e.ok = true; }

    let changes = 0;
    const missing = new Map();
    const out = specs.map((st) => {
      const next = [];
      for (const e of st) {
        if (e.ok) { next.push(e.s); continue; }
        const s = e.s;
        const f = FAM_OF[s.id];
        const upright = !s.up || s.up === '+z';
        // 2. split into owned shorter pieces of the same colour
        if (allowSplit && f && upright) {
          const pieces = splitOwned(s, f, stock);
          if (pieces) { next.push(...pieces); changes++; continue; }
        }
        // 3. same part, another colour you own
        if (o.swapColors) {
          let best = null;
          for (const [k, n] of stock) {
            if (n <= 0) continue;
            const [id, color] = k.split('|');
            if (id !== s.id || !LEGO.COLORS[color]) continue;
            if (!best || dist(color, s.color) < dist(best, s.color)) best = color;
          }
          if (best) { take(s.id, best); next.push(Object.assign({}, s, { color: best })); changes++; continue; }
        }
        // 4. still needed
        next.push(s);
        const k = key(s.id, s.color);
        missing.set(k, (missing.get(k) || 0) + 1);
      }
      return next;
    });

    const fitted = Object.assign({}, model, { steps: out });
    // Steps may have grown past 12 parts after splitting: re-chunk.
    fitted.steps = [];
    for (const st of out) for (let i = 0; i < st.length; i += 12) fitted.steps.push(st.slice(i, i + 12));
    return {
      model: fitted,
      changes,
      missing: [...missing.entries()].map(([k, qty]) => { const [id, color] = k.split('|'); return { id, color, qty }; }),
      check: LEGO.checkModel(fitted),
    };
  }

  // Replace one box part by owned shorter parts of its colour in the same place (2-wide parts
  // become two 1-wide rows). Plans against the stock counts, takes only when the whole plan fits.
  // Returns the new specs, or null.
  function splitOwned(s, f, stock) {
    const alongY = (s.rot || 0) % 2 === 1;
    const wide = !!ONE[f.fam];
    const fam = wide ? ONE[f.fam] : f.fam;
    const rows = wide ? [0, 1] : [0];
    const count = (id) => stock.get(key(id, s.color)) || 0;
    const reserved = new Map();
    const free = (id) => count(id) - (reserved.get(id) || 0);
    // shorter pieces only for a 1-wide part; any length for each row of a 2-wide part
    const lens = Object.entries(FAM[fam])
      .map(([l, id]) => ({ l: Number(l), id }))
      .filter((x) => wide || x.l < f.len)
      .sort((a, b) => b.l - a.l);
    const plan = [];
    for (const r of rows) {
      const pick = [];
      const rec = (left) => {
        if (left === 0) return true;
        for (const x of lens) {
          if (x.l > left || free(x.id) <= 0) continue;
          reserved.set(x.id, (reserved.get(x.id) || 0) + 1);
          pick.push(x);
          if (rec(left - x.l)) return true;
          pick.pop();
          reserved.set(x.id, reserved.get(x.id) - 1);
        }
        return false;
      };
      if (!rec(f.len)) return null;
      plan.push({ r, pick: pick.slice() });
    }
    const outSpecs = [];
    for (const { r, pick } of plan) {
      let at = 0;
      for (const p of pick) {
        stock.set(key(p.id, s.color), count(p.id) - 1);
        const pos = alongY ? [s.at[0] + r, s.at[1] + at, s.at[2]] : [s.at[0] + at, s.at[1] + r, s.at[2]];
        const spec = { id: p.id, color: s.color, at: pos };
        if (alongY) spec.rot = 1;
        outSpecs.push(spec);
        at += p.l;
      }
    }
    return outSpecs;
  }
})(typeof window !== 'undefined' ? window : globalThis);
