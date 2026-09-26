/*
 * brickpic.js
 * Designs a model from a photo without any AI: the subject is cut out from its background,
 * turned into a grid one stud wide and one brick high per cell, coloured with the nearest
 * colours you own, and packed into 1 x N bricks with staggered joints, standing on a base of
 * 2-wide bricks when you have them. The result is a free-standing "brick picture" of the
 * subject's side view, with a parts list of what it needs and what is missing.
 *
 *   const r = LEGO.brickPicture(img, inventory, { width: 16, onlyMine: true });
 *   // r.model  -> engine model (steps), r.grid -> colour keys per cell, r.width, r.height
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const INV = LEGO.inv;
  const BRICKS_1 = [['3005', 1], ['3004', 2], ['3622', 3], ['3010', 4], ['3009', 6], ['3008', 8]];
  const BRICKS_2 = [['3003', 2], ['3002', 3], ['3001', 4], ['2456', 6], ['3007', 8]];

  // ---------------------------------------------------------------- subject cut-out

  // Pixels of the photo at a working size, and a mask of what is not background (the
  // background colour is read from the border, as in detect.js), cropped to the largest object.
  function cutOut(img) {
    const W0 = img.naturalWidth || img.width;
    const H0 = img.naturalHeight || img.height;
    const s = Math.min(1, 240 / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * s));
    const H = Math.max(1, Math.round(H0 * s));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    // Background colours: the border pixels grouped into a few clusters (k-means), so a photo
    // with a wall above and a table below has both treated as background.
    const at = (x, y) => (y * W + x) * 4;
    const border = [];
    for (let x = 0; x < W; x += 2) for (const y of [0, 1, H - 2, H - 1]) border.push(at(x, y));
    for (let y = 0; y < H; y += 2) for (const x of [0, 1, W - 2, W - 1]) border.push(at(x, y));
    const K = 4;
    let cent = [];
    for (let k = 0; k < K; k++) {
      const i = border[Math.floor(((k + 0.5) / K) * border.length)];
      cent.push([px[i], px[i + 1], px[i + 2]]);
    }
    const dist = (i, c) => Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]);
    for (let it = 0; it < 8; it++) {
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (const i of border) {
        let bk = 0;
        for (let k = 1; k < K; k++) if (dist(i, cent[k]) < dist(i, cent[bk])) bk = k;
        acc[bk][0] += px[i]; acc[bk][1] += px[i + 1]; acc[bk][2] += px[i + 2]; acc[bk][3]++;
      }
      cent = acc.map((a, k) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cent[k]));
    }
    // how far border pixels sit from their own cluster: the texture of the background
    let spread = 0;
    for (const i of border) spread += Math.min(...cent.map((c) => dist(i, c)));
    spread /= border.length;
    const T = Math.max(70, spread * 3);

    let mask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (Math.min(...cent.map((c) => dist(i, c))) > T) mask[p] = 1;
    }
    // close gaps, then keep the largest object
    const grow = (m, on) => {
      const o = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let v = on ? 0 : 1;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              const q = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : m[yy * W + xx];
              if (on ? q : !q) v = on ? 1 : 0;
            }
          }
          o[y * W + x] = v;
        }
      }
      return o;
    };
    mask = grow(grow(grow(mask, true), true), false);
    const lab = new Int32Array(W * H);
    let best = null;
    let id = 0;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (!mask[p0] || lab[p0]) continue;
      id++;
      const st = [p0];
      lab[p0] = id;
      let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      while (st.length) {
        const p = st.pop();
        const x = p % W, y = (p / W) | 0;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
          if (q >= 0 && mask[q] && !lab[q]) {
            lab[q] = id;
            st.push(q);
          }
        }
      }
      // An object cut by the photo's edge is usually background (a table edge, a wall).
      const edges = (x0 <= 1) + (y0 <= 1) + (x1 >= W - 2) + (y1 >= H - 2);
      const score = n * (edges === 0 ? 1 : edges === 1 ? 0.45 : 0.1);
      if (!best || score > best.score) best = { id, n, x0, y0, x1, y1, score };
    }
    // Nothing stands out from the background: use the middle of the photo.
    if (!best || best.n < W * H * 0.02) {
      const m2 = new Uint8Array(W * H).fill(1);
      return { px, W, H, lab: m2.map(() => 1), id: 1, box: { x0: Math.round(W * 0.1), y0: Math.round(H * 0.1), x1: Math.round(W * 0.9), y1: Math.round(H * 0.9) }, found: false };
    }
    return { px, W, H, lab, id: best.id, box: best, found: true };
  }

  // The few library colours that cover most of the subject (not the background).
  LEGO.subjectColors = function subjectColors(img, n) {
    const c = cutOut(img);
    const count = new Map();
    for (let y = c.box.y0; y <= c.box.y1; y++) {
      for (let x = c.box.x0; x <= c.box.x1; x++) {
        const p = y * c.W + x;
        if (c.lab[p] !== c.id) continue;
        const k = LEGO.detect.colorClass(c.px[p * 4], c.px[p * 4 + 1], c.px[p * 4 + 2]);
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
    const total = [...count.values()].reduce((a, b) => a + b, 0) || 1;
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n || 4).map(([key, v]) => ({ key, share: v / total }));
  };

  // ---------------------------------------------------------------- the design

  LEGO.brickPicture = function brickPicture(img, inv, opt) {
    const o = opt || {};
    const onlyMine = o.onlyMine !== false;
    const c = cutOut(img);
    const bw = c.box.x1 - c.box.x0 + 1;
    const bh = c.box.y1 - c.box.y0 + 1;

    // Stock of upright bricks by colour and length (1 deep) and of 2-deep bricks for the stand.
    const stock1 = new Map();
    const stock2 = new Map();
    let studs = 0;
    for (const r of inv) {
      if (!INV.usable(r)) continue;
      const one = BRICKS_1.find((b) => b[0] === r.id);
      const two = BRICKS_2.find((b) => b[0] === r.id);
      if (one) {
        stock1.set(r.color + '|' + one[1], (stock1.get(r.color + '|' + one[1]) || 0) + r.qty);
        studs += one[1] * r.qty;
      }
      if (two) stock2.set(r.color + '|' + two[1], (stock2.get(r.color + '|' + two[1]) || 0) + r.qty);
    }
    const myColors = [...new Set([...stock1.keys()].map((k) => k.split('|')[0]))];
    const palette = onlyMine && myColors.length ? myColors : Object.keys(LEGO.COLORS);

    // Size: width in studs; height in bricks keeps the photo's proportions (a brick is 1.2 studs tall).
    const aspect = bh / bw;
    const auto = Math.round(Math.sqrt(Math.max(40, studs) / (0.75 * aspect / 1.2)));
    const width = Math.max(6, Math.min(28, Math.round(o.width || auto)));
    const height = Math.max(3, Math.min(24, Math.round((width * aspect) / 1.2)));

    // Colour of each cell: the average of subject pixels in it, snapped to an allowed colour.
    const near = (rgb) => {
      let best = palette[0];
      let bd = Infinity;
      for (const k of palette) {
        const q = LEGO.COLORS[k].rgb;
        const d = (q[0] - rgb[0]) ** 2 * 0.3 + (q[1] - rgb[1]) ** 2 * 0.59 + (q[2] - rgb[2]) ** 2 * 0.11;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    };
    const grid = [];
    for (let r = 0; r < height; r++) {
      const row = [];
      for (let q = 0; q < width; q++) {
        const x0 = c.box.x0 + (q * bw) / width, x1 = c.box.x0 + ((q + 1) * bw) / width;
        // row 0 is the bottom of the picture
        const y1 = c.box.y1 + 1 - (r * bh) / height, y0 = c.box.y1 + 1 - ((r + 1) * bh) / height;
        let n = 0, inside = 0, sr = 0, sg = 0, sb = 0;
        const votes = new Map();
        for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
          for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
            if (x < 0 || y < 0 || x >= c.W || y >= c.H) continue;
            const p = y * c.W + x;
            n++;
            if (c.lab[p] !== c.id) continue;
            inside++;
            const cls = LEGO.detect.colorClass(c.px[p * 4], c.px[p * 4 + 1], c.px[p * 4 + 2]);
            votes.set(cls, (votes.get(cls) || 0) + 1);
            sr += c.px[p * 4];
            sg += c.px[p * 4 + 1];
            sb += c.px[p * 4 + 2];
          }
        }
        // The colour most pixels in the cell show; if you do not have it, the nearest you do.
        let vote = null;
        for (const [k, v] of votes) if (!vote || v > votes.get(vote)) vote = k;
        const cellColor = !vote ? near([sr / (inside || 1), sg / (inside || 1), sb / (inside || 1)])
          : palette.includes(vote) ? vote : near(LEGO.COLORS[vote].rgb);
        row.push(inside && inside >= n * 0.4 ? cellColor : null);
      }
      grid.push(row);
    }
    // Clean-up: a single cell unlike all its neighbours is photo noise; it takes their colour.
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        const k = grid[r][q];
        if (!k) continue;
        const nb = [[r - 1, q], [r + 1, q], [r, q - 1], [r, q + 1]]
          .filter(([rr, qq]) => rr >= 0 && qq >= 0 && rr < height && qq < width && grid[rr][qq])
          .map(([rr, qq]) => grid[rr][qq]);
        if (nb.length >= 3 && !nb.includes(k)) {
          const tally = new Map();
          for (const n of nb) tally.set(n, (tally.get(n) || 0) + 1);
          grid[r][q] = [...tally.entries()].sort((a2, b2) => b2[1] - a2[1])[0][0];
        }
      }
    }

    // Every column is solid from the ground up to its top cell, so nothing floats. Gaps below
    // the outline (under a car, between legs) get a backdrop colour that stands apart.
    const used = new Map();
    for (const row of grid) for (const k of row) if (k) used.set(k, (used.get(k) || 0) + 1);
    const backdrop = pickBackdrop(palette, used, stock1);
    for (let q = 0; q < width; q++) {
      let top = -1;
      for (let r = height - 1; r >= 0; r--) if (grid[r][q]) { top = r; break; }
      for (let r = 0; r < top; r++) if (!grid[r][q]) grid[r][q] = backdrop;
    }
    // Drop empty rows at the top.
    while (grid.length && grid[grid.length - 1].every((k) => !k)) grid.pop();

    // ------------------------------------------------------------ pack rows into bricks
    const left1 = new Map(stock1);
    const take1 = (color, len) => {
      const k = color + '|' + len;
      const n = left1.get(k) || 0;
      if (n > 0) left1.set(k, n - 1);
      return n > 0;
    };
    const has1 = (color, len) => (left1.get(color + '|' + len) || 0) > 0;
    const idOf = (len, set) => set.find((b) => b[1] === len)[0];

    const steps = [];
    let z = 0;
    // Stand: one layer of 2-deep bricks across the full width, when there are enough.
    const standCover = [...stock2.entries()].reduce((t, [k, n]) => t + Number(k.split('|')[1]) * n, 0);
    const useStand = o.stand !== false && (standCover >= width || !onlyMine);
    if (useStand) {
      const left2 = new Map(stock2);
      const lens = [8, 6, 4, 3, 2];
      const parts = [];
      let x = 0;
      while (x < width) {
        const room = width - x;
        let pick = null;
        for (const len of lens) {
          if (len > room) continue;
          const k = [...left2.keys()].find((kk) => kk.endsWith('|' + len) && left2.get(kk) > 0);
          if (k) {
            pick = { len, color: k.split('|')[0] };
            left2.set(k, left2.get(k) - 1);
            break;
          }
        }
        if (!pick) pick = { len: Math.min(room, 4) === 1 ? 2 : lens.find((l) => l <= room) || 2, color: 'dbg' };
        // a 2-stud end piece may stick out by one stud; that is fine for a stand
        parts.push({ id: idOf(pick.len, BRICKS_2), color: pick.color, at: [x, 0, 0] });
        x += pick.len;
      }
      for (let i = 0; i < parts.length; i += 10) steps.push(parts.slice(i, i + 10));
      z = 3;
    }

    let below = new Set();
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const parts = [];
      const joints = new Set();
      let q = 0;
      while (q < width) {
        const color = row[q];
        if (!color) {
          q++;
          continue;
        }
        let run = 1;
        while (q + run < width && row[q + run] === color) run++;
        // fill the run: prefer lengths in stock, then any; avoid joints right above joints
        let x = q;
        const end = q + run;
        while (x < end) {
          const room = end - x;
          const cands = [8, 6, 4, 3, 2, 1].filter((l) => l <= room);
          const ok = (l) => x + l === end || !below.has(x + l);
          const pick =
            cands.find((l) => l <= 4 && has1(color, l) && ok(l)) ||
            cands.find((l) => has1(color, l) && ok(l)) ||
            cands.find((l) => has1(color, l)) ||
            (onlyMine ? cands.find((l) => l <= 4 && ok(l)) : cands.find((l) => l <= 4 && ok(l))) ||
            cands[cands.length - 1];
          take1(color, pick);
          parts.push({ id: idOf(pick, BRICKS_1), color, at: [x, 0, z] });
          x += pick;
          if (x < width) joints.add(x);
        }
        q = end;
      }
      below = joints;
      for (let i = 0; i < parts.length; i += 12) steps.push(parts.slice(i, i + 12));
      z += 3;
    }

    const model = {
      title: o.title || 'Brick Picture',
      theta: 18,
      phi: 16,
      steps: steps.filter((s) => s.length),
      generated: true,
    };
    return { model, grid, width, height: grid.length, found: c.found, stand: useStand, backdrop };
  };

  function pickBackdrop(palette, used, stock1) {
    // Prefer a colour you have plenty of that the subject hardly uses; greys and white read as backdrop.
    const plenty = (k) => [...stock1.entries()].filter(([kk]) => kk.startsWith(k + '|')).reduce((t, [kk, n]) => t + n * Number(kk.split('|')[1]), 0);
    const neutral = ['white', 'lbg', 'dbg', 'tan', 'black'];
    const score = (k) => plenty(k) - (used.get(k) || 0) * 3 + (neutral.includes(k) ? 20 : 0);
    return palette.slice().sort((a, b) => score(b) - score(a))[0] || 'lbg';
  }
})(typeof window !== 'undefined' ? window : globalThis);
