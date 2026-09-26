/*
 * catalog.js
 * The real-LEGO check. Loads dist/catalog.json (built from Rebrickable by tools/catalog.cjs)
 * and answers: is this a real part, what is it called, and was it ever made in this colour?
 * Every real LEGO colour it knows is also registered with the engine, so pieces in colours
 * like Dark Red or Sand Green can be listed, counted and drawn.
 *
 *   await LEGO.catalog.load('catalog.json');
 *   LEGO.catalog.verify({ id: '3004', color: 'yellow', qty: 3 }, 'claude')
 *     -> { row, status: 'ok' | 'colour-fixed' | 'not-real' | 'unchecked', note }
 *
 * Without the file (offline, local dev) every row comes back 'unchecked' and the app carries on.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const CAT = (LEGO.catalog = { ready: false, parts: 0 });
  let data = null;
  const byName = new Map(); // normalised colour name -> Rebrickable colour id
  const keyOfRb = new Map(); // Rebrickable colour id -> engine colour key
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  CAT.load = async function load(url) {
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return false;
      data = await r.json();
    } catch (e) {
      return false;
    }
    // Link catalogue colours to engine colours by name; register the rest with the engine.
    const engineByName = new Map(Object.values(LEGO.COLORS).map((c) => [norm(c.name), c.key]));
    for (const [id, [name, hex, trans]] of Object.entries(data.colors)) {
      const rb = Number(id);
      byName.set(norm(name), rb);
      let key = engineByName.get(norm(name));
      if (!key && hex && /^[0-9A-F]{6}$/.test(hex)) {
        key = 'rb' + rb;
        const n = parseInt(hex, 16);
        LEGO.COLORS[key] = { key, hex: '#' + hex, name, label: name, rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], trans: !!trans, extra: true };
      }
      if (key) keyOfRb.set(rb, key);
    }
    CAT.ready = true;
    CAT.parts = Object.keys(data.parts).length;
    CAT.built = data.built;
    return true;
  };

  // Rebrickable id of an engine colour key (or of a colour name).
  const rbOf = (color) => {
    if (!color) return null;
    if (/^rb\d+$/.test(color)) return Number(color.slice(2));
    const c = LEGO.COLORS[color];
    return byName.get(norm(c ? c.name : color)) ?? null;
  };

  // Look a part up, trying the common BrickLink/Rebrickable spelling differences.
  CAT.part = function part(id) {
    if (!data || !id) return null;
    const s = String(id).trim();
    for (const cand of [s, s.toLowerCase(), s.replace(/[a-z]$/i, ''), s + 'a', s + 'b']) {
      const p = data.parts[cand];
      if (p) return { id: cand, name: p[0], cat: data.cats[p[1]] || '', colors: p[2] };
    }
    return null;
  };

  CAT.madeIn = function madeIn(id, color) {
    const p = CAT.part(id);
    const rb = rbOf(color);
    return !!(p && rb != null && p.colors.includes(rb));
  };

  // The produced colour of a part nearest to a given one (by RGB).
  CAT.nearestMade = function nearestMade(id, color) {
    const p = CAT.part(id);
    if (!p || !p.colors.length) return null;
    const src = LEGO.COLORS[color] ? LEGO.COLORS[color].rgb : null;
    let best = null;
    let bd = Infinity;
    for (const rb of p.colors) {
      const key = keyOfRb.get(rb);
      if (!key || !LEGO.COLORS[key]) continue;
      if (LEGO.COLORS[key].trans && !(LEGO.COLORS[color] && LEGO.COLORS[color].trans)) continue;
      const q = LEGO.COLORS[key].rgb;
      const d = src ? (q[0] - src[0]) ** 2 * 0.3 + (q[1] - src[1]) ** 2 * 0.59 + (q[2] - src[2]) ** 2 * 0.11 : 0;
      if (d < bd) {
        bd = d;
        best = key;
      }
    }
    return best;
  };

  // Engine colour key for a colour name from a recogniser (BrickLink or Rebrickable naming).
  CAT.colorKey = function colorKey(name) {
    if (!name) return '';
    if (LEGO.COLORS[name]) return name;
    const rb = byName.get(norm(name));
    if (rb != null && keyOfRb.has(rb)) return keyOfRb.get(rb);
    for (const c of Object.values(LEGO.COLORS)) if (norm(c.name) === norm(name)) return c.key;
    return '';
  };

  // Check one parts-list row. `source` is 'claude', 'brickognize' or 'hand'.
  // - A part not in the catalogue is rejected when it came from Claude (a guess), but kept when it
  //   came from Brickognize, whose answers are catalogue items themselves (only newer than our copy).
  // - A colour the part was never made in is moved to the nearest colour it was made in.
  CAT.verify = function verify(row, source) {
    if (!data) return { row, status: 'unchecked' };
    const p = CAT.part(row.id);
    if (!p) {
      return source === 'claude'
        ? { row, status: 'not-real', note: `${row.id} is not a LEGO part number` }
        : { row, status: 'unchecked', note: 'not in the catalogue copy' };
    }
    const fixed = Object.assign({}, row, { id: LEGO.LIB[row.id] ? row.id : p.id, name: row.name || p.name });
    if (!row.color || CAT.madeIn(p.id, row.color)) return { row: fixed, status: 'ok', part: p };
    const near = CAT.nearestMade(p.id, row.color);
    if (!near) return { row: fixed, status: 'ok', part: p };
    const was = LEGO.COLORS[row.color] ? LEGO.COLORS[row.color].name : row.color;
    fixed.color = near;
    return { row: fixed, status: 'colour-fixed', part: p, note: `${p.id} was never made in ${was}; closest real colour is ${LEGO.COLORS[near].name}` };
  };
})(typeof window !== 'undefined' ? window : globalThis);
