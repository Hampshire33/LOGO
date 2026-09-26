/*
 * detect.js
 * Finds separate pieces in a photo of loose bricks spread on a plain surface.
 * No model and no network: the table colour is read from the photo's border, every pixel far
 * enough from it counts as brick, and touching brick pixels are grouped into one piece.
 * Pieces that touch each other come out as one box, so spread them a little.
 *
 *   const found = LEGO.detect(imageOrCanvas);   // { boxes: [{x, y, w, h, rgb}], width, height }
 *
 * Boxes are in the source image's pixels. `rgb` is the average colour inside the piece.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;

  LEGO.detect = function detect(src, opt) {
    const o = opt || {};
    const W0 = src.naturalWidth || src.videoWidth || src.width;
    const H0 = src.naturalHeight || src.videoHeight || src.height;
    const S = Math.min(1, (o.maxSide || 480) / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * S));
    const H = Math.max(1, Math.round(H0 * S));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    // Background: median of a 3 px frame around the edge, per channel.
    const edge = [[], [], []];
    const push = (x, y) => {
      const i = (y * W + x) * 4;
      edge[0].push(px[i]);
      edge[1].push(px[i + 1]);
      edge[2].push(px[i + 2]);
    };
    for (let x = 0; x < W; x += 2) for (let t = 0; t < 3; t++) { push(x, t); push(x, H - 1 - t); }
    for (let y = 0; y < H; y += 2) for (let t = 0; t < 3; t++) { push(t, y); push(W - 1 - t, y); }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const bg = edge.map(med);

    // Spread of the border tells how noisy the table is; the threshold sits above it.
    let spread = 0;
    for (let i = 0; i < edge[0].length; i++) {
      spread += Math.abs(edge[0][i] - bg[0]) + Math.abs(edge[1][i] - bg[1]) + Math.abs(edge[2][i] - bg[2]);
    }
    spread /= edge[0].length || 1;
    const T = o.threshold || Math.max(42, spread * 3.2);

    // A dark shadow of the table colour is not a brick: compare chroma and brightness apart.
    const bgL = (bg[0] + bg[1] + bg[2]) / 3;
    let mask = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const L = (r + g + b) / 3;
      const dc = Math.abs(r - L - (bg[0] - bgL)) + Math.abs(g - L - (bg[1] - bgL)) + Math.abs(b - L - (bg[2] - bgL));
      const dl = L - bgL;
      // brighter or much darker than the table, or a different hue
      if (dc * 1.6 > T || dl > T * 0.8 || dl < -T * 1.3) mask[p] = 1;
    }

    // Close small gaps (studs, edge lines) then drop specks: dilate twice, erode twice.
    const morph = (m, grow) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let v = grow ? 0 : 1;
          for (let dy = -1; dy <= 1 && v === (grow ? 0 : 1); dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              const q = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : m[yy * W + xx];
              if (grow ? q : !q) { v = grow ? 1 : 0; break; }
            }
          }
          out[y * W + x] = v;
        }
      }
      return out;
    };
    mask = morph(morph(mask, true), true);
    mask = morph(morph(mask, false), false);

    // Connected groups of set pixels, 4-neighbour flood fill. `within` limits the search to one
    // label of an earlier pass (a heap), so the same routine splits heaps by colour.
    function components(m, within, withinId) {
      const lab = new Int32Array(W * H);
      const out = [];
      const stack = [];
      let next = 0;
      for (let p0 = 0; p0 < W * H; p0++) {
        if (!m[p0] || lab[p0] || (within && within[p0] !== withinId)) continue;
        next++;
        let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0, sr = 0, sg = 0, sb = 0;
        stack.push(p0);
        lab[p0] = next;
        while (stack.length) {
          const p = stack.pop();
          const x = p % W, y = (p / W) | 0;
          n++;
          const i = p * 4;
          sr += px[i]; sg += px[i + 1]; sb += px[i + 2];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
            if (q >= 0 && m[q] && !lab[q] && (!within || within[q] === withinId)) {
              lab[q] = next;
              stack.push(q);
            }
          }
        }
        out.push({ id: next, x0, y0, x1, y1, n, rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] });
      }
      return { list: out, lab };
    }

    const toBox = (c, pad) => ({
      x: Math.max(0, (c.x0 - pad) / S),
      y: Math.max(0, (c.y0 - pad) / S),
      w: Math.min(W0, (c.x1 - c.x0 + 1 + 2 * pad) / S),
      h: Math.min(H0, (c.y1 - c.y0 + 1 + 2 * pad) / S),
      area: c.n / (S * S),
      rgb: c.rgb,
    });

    const minArea = o.minArea || Math.max(20, (W * H) / 2500);
    const first = components(mask);
    // Drop specks and anything that fills nearly the whole photo (a hand, a box lid).
    const blobs = first.list.filter((c) => c.n >= minArea && c.n <= W * H * 0.85);

    // A heap is a blob far bigger than a single loose piece: bricks lying on top of each other.
    const small = blobs.filter((c) => c.n < W * H * 0.03).map((c) => c.n).sort((a, b) => a - b);
    const single = small.length ? small[small.length >> 1] : 0;
    const heapMin = Math.max(W * H * 0.03, single * 6);
    const boxes = [];
    const heaps = [];
    for (const c of blobs) {
      if (c.n < heapMin) boxes.push(toBox(c, 3));
      else heaps.push(splitHeap(c, first.lab));
    }

    // Split a heap by colour: every pixel gets a colour class, and each class is grouped on its
    // own, so a red brick next to a blue one comes apart. Same-coloured bricks that touch stay
    // together; their count is estimated from area against the typical region size.
    function splitHeap(c, lab) {
      const cls = new Uint8Array(W * H);
      const keys = [];
      const keyIndex = new Map();
      for (let y = c.y0; y <= c.y1; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
          const p = y * W + x;
          if (lab[p] !== c.id) continue;
          const k = colorClass(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
          if (!keyIndex.has(k)) {
            keyIndex.set(k, keys.length + 1);
            keys.push(k);
          }
          cls[p] = keyIndex.get(k);
        }
      }
      const parts = [];
      keys.forEach((key, ki) => {
        const m = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) m[p] = cls[p] === ki + 1 ? 1 : 0;
        // Erode once: the thin shading lines between bricks of one colour cut them apart.
        const e = new Uint8Array(W * H);
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x;
            e[p] = m[p] && m[p - 1] && m[p + 1] && m[p - W] && m[p + W] ? 1 : 0;
          }
        }
        for (const r of components(e).list) if (r.n >= minArea * 0.6) parts.push(Object.assign(r, { color: key }));
      });
      // Typical visible area of one brick in this heap. Hidden bricks show as small fragments,
      // so the upper-middle region size is a better guide than the median.
      const areas = parts.map((r) => r.n).sort((a, b) => a - b);
      const unit = areas.length ? areas[Math.floor(areas.length * 0.6)] : 1;
      const median = areas.length ? areas[areas.length >> 1] : 1;
      const kept = parts
        .filter((r) => r.n >= median * 0.35)
        .map((r) => Object.assign(toBox(r, 2), { color: r.color, count: Math.max(1, Math.round(r.n / unit)) }));
      return { box: toBox(c, 3), parts: kept, estimate: kept.reduce((s, r) => s + r.count, 0) };
    }

    // Reading order: top to bottom in rough rows, then left to right.
    const row = Math.max(1, H0 / 12);
    boxes.sort((a, b) => Math.floor(a.y / row) - Math.floor(b.y / row) || a.x - b.x);
    return { boxes, heaps, width: W0, height: H0, background: bg };
  };

  // Shading-tolerant colour class for one pixel, as a LEGO.COLORS key: hue decides for
  // coloured plastic, brightness for white, greys and black.
  function colorClass(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const v = mx / 255;
    const s = mx ? (mx - mn) / mx : 0;
    if (v < 0.2) return 'black';
    if (s < 0.2) return v > 0.62 ? 'white' : v > 0.42 ? 'lbg' : v > 0.28 ? 'dbg' : 'black';
    let h;
    if (mx === r) h = (60 * ((g - b) / (mx - mn)) + 360) % 360;
    else if (mx === g) h = 60 * ((b - r) / (mx - mn)) + 120;
    else h = 60 * ((r - g) / (mx - mn)) + 240;
    if (h < 12 || h >= 342) return 'red';
    if (h < 33) return v < 0.45 ? 'brown' : 'orange';
    if (h < 68) return s < 0.3 && v > 0.7 ? 'tan' : 'yellow';
    if (h < 90) return 'lime';
    if (h < 170) return 'green';
    if (h < 198) return 'azure';
    if (h < 262) return 'blue';
    return 'pink';
  }
  LEGO.detect.colorClass = colorClass;

  // Colour mix of a pile when pieces cannot be separated (full-frame piles, busy backgrounds).
  // If the photo's border is one even colour it is background and left out; if the border is
  // itself busy (the pile fills the frame) every pixel counts.
  LEGO.detect.census = function census(src) {
    const W0 = src.naturalWidth || src.width, H0 = src.naturalHeight || src.height;
    const s = Math.min(1, 240 / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const border = new Map();
    let nb = 0;
    const tally = (m, x, y) => {
      const i = (y * W + x) * 4;
      const k = colorClass(px[i], px[i + 1], px[i + 2]);
      m.set(k, (m.get(k) || 0) + 1);
    };
    for (let x = 0; x < W; x++) { tally(border, x, 0); tally(border, x, H - 1); nb += 2; }
    for (let y = 0; y < H; y++) { tally(border, 0, y); tally(border, W - 1, y); nb += 2; }
    // The floor: the one or two border colours that cover most of the edge (a carpet or wood
    // grain shows as two shades). A pile that fills the frame has no such colours.
    const ranked = [...border.entries()].sort((a, b) => b[1] - a[1]);
    const floor = new Set();
    let covered = 0;
    for (const [k, v] of ranked.slice(0, 2)) {
      if (covered / nb >= 0.75) break;
      floor.add(k);
      covered += v;
    }
    const plainBorder = covered / nb >= 0.75;
    const all = new Map();
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const k = colorClass(px[i], px[i + 1], px[i + 2]);
        if (plainBorder && floor.has(k)) continue;
        all.set(k, (all.get(k) || 0) + 1);
        n++;
      }
    }
    const shares = [...all.entries()].map(([key, v]) => ({ key, share: v / (n || 1) })).filter((c) => c.share >= 0.03).sort((a, b) => b.share - a.share);
    return { shares, fullFrame: !plainBorder };
  };

  // One detected piece as its own square image (for recognisers that take one part per photo).
  LEGO.detect.crop = function crop(src, box, size) {
    const s = size || 320;
    const side = Math.max(box.w, box.h) * 1.15;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, s, s);
    ctx.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, s, s);
    return cv;
  };
})(typeof window !== 'undefined' ? window : globalThis);
