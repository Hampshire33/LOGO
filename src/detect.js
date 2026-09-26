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

    // Connected pieces, 4-neighbour flood fill.
    const lab = new Int32Array(W * H);
    const boxes = [];
    const minArea = o.minArea || Math.max(20, (W * H) / 2500);
    const stack = [];
    let next = 0;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (!mask[p0] || lab[p0]) continue;
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
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = next; stack.push(p - 1); }
        if (x < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = next; stack.push(p + 1); }
        if (y > 0 && mask[p - W] && !lab[p - W]) { lab[p - W] = next; stack.push(p - W); }
        if (y < H - 1 && mask[p + W] && !lab[p + W]) { lab[p + W] = next; stack.push(p + W); }
      }
      // Skip specks and anything that is most of the photo (a hand, a box lid).
      if (n < minArea || n > W * H * 0.5) continue;
      const pad = 3;
      boxes.push({
        x: Math.max(0, (x0 - pad) / S),
        y: Math.max(0, (y0 - pad) / S),
        w: Math.min(W0, (x1 - x0 + 1 + 2 * pad) / S),
        h: Math.min(H0, (y1 - y0 + 1 + 2 * pad) / S),
        area: n / (S * S),
        rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
      });
    }
    // Reading order: top to bottom in rough rows, then left to right.
    const row = Math.max(1, H0 / 12);
    boxes.sort((a, b) => Math.floor(a.y / row) - Math.floor(b.y / row) || a.x - b.x);
    return { boxes, width: W0, height: H0, background: bg };
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
