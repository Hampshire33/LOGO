/*
 * check.js
 * Checks a model the way a builder would: no two parts overlap, and every part is held,
 * through a chain of stud connections, by something standing on the ground.
 * Shared by tools/check-model.cjs (Node) and the photo app (browser).
 *
 *   const r = LEGO.checkModel(model);   // { parts, steps, problems: [{kind, text, index}] }
 *
 * Two parts connect when one sits on the other with their footprints overlapping, or when a
 * studs-sideways part (up other than +z) touches the part behind its studs.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const EPS = 1e-6;

  function box(p) {
    const d = p.def;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const x of [0, d.w]) {
      for (const y of [0, d.d]) {
        for (const z of [0, d.h]) {
          const v = [0, 1, 2].map((k) => p.M[k][0] * x + p.M[k][1] * y + p.M[k][2] * z + p.off[k]);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], v[k]);
            hi[k] = Math.max(hi[k], v[k]);
          }
        }
      }
    }
    return { lo, hi };
  }

  const overlap = (a, b, k) => Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]);

  LEGO.checkModel = function checkModel(model) {
    const steps = model.steps || [];
    const specs = steps.flat();
    const problems = [];
    const stepOf = [];
    steps.forEach((st, si) => st.forEach(() => stepOf.push(si + 1)));
    const label = (i) => `step ${stepOf[i]}: ${specs[i].id} ${specs[i].color} at [${specs[i].at}]`;

    // unknown parts and colours first: the geometry below needs a known part
    const parts = [];
    const index = [];
    specs.forEach((s, i) => {
      if (!s || !LEGO.LIB[s.id]) problems.push({ kind: 'unknown-part', index: i, text: `UNKNOWN PART  ${label(i)}` });
      else if (!LEGO.COLORS[s.color]) problems.push({ kind: 'unknown-colour', index: i, text: `UNKNOWN COLOUR  ${label(i)}` });
      else if (!Array.isArray(s.at) || s.at.length !== 3 || s.at.some((v) => typeof v !== 'number' || !isFinite(v))) {
        problems.push({ kind: 'bad-position', index: i, text: `BAD POSITION  ${label(i)}` });
      } else {
        try {
          parts.push(LEGO.place(s));
          index.push(i);
        } catch (e) {
          problems.push({ kind: 'bad-spec', index: i, text: `BAD PART  ${label(i)}: ${e.message}` });
        }
      }
    });

    const B = parts.map(box);
    const sideAxis = (n) => {
      const up = specs[index[n]].up;
      return !up || up === '+z' ? -1 : 'xyz'.indexOf(up[1]);
    };
    const links = B.map(() => []);
    for (let i = 0; i < B.length; i++) {
      for (let j = i + 1; j < B.length; j++) {
        const a = B[i];
        const b = B[j];
        if ([0, 1, 2].every((k) => overlap(a, b, k) > EPS)) {
          problems.push({ kind: 'overlap', index: index[j], text: 'OVERLAP  ' + label(index[i]) + '  |  ' + label(index[j]) });
          continue;
        }
        const stacked = overlap(a, b, 0) > EPS && overlap(a, b, 1) > EPS &&
          (Math.abs(a.hi[2] - b.lo[2]) < EPS || Math.abs(b.hi[2] - a.lo[2]) < EPS);
        let side = false;
        for (const [p, q] of [[i, j], [j, i]]) {
          const k = sideAxis(p);
          if (k < 0) continue;
          const others = [0, 1, 2].filter((m) => m !== k);
          const touching = Math.abs(B[p].hi[k] - B[q].lo[k]) < EPS || Math.abs(B[p].lo[k] - B[q].hi[k]) < EPS;
          if (touching && others.every((m) => overlap(B[p], B[q], m) > EPS)) side = true;
        }
        if (stacked || side) {
          links[i].push(j);
          links[j].push(i);
        }
      }
    }

    const held = new Uint8Array(B.length);
    const queue = [];
    B.forEach((b, i) => {
      if (Math.abs(b.lo[2]) < EPS) {
        held[i] = 1;
        queue.push(i);
      }
    });
    while (queue.length) {
      const i = queue.shift();
      for (const j of links[i]) {
        if (!held[j]) {
          held[j] = 1;
          queue.push(j);
        }
      }
    }
    held.forEach((h, i) => {
      if (!h) problems.push({ kind: 'floats', index: index[i], text: 'FLOATS   ' + label(index[i]) });
    });

    return { parts: specs.length, steps: steps.length, problems };
  };
})(typeof window !== 'undefined' ? window : globalThis);
