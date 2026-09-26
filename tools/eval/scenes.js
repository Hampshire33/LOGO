/*
 * scenes.js (test bench, runs in a browser page with the engine loaded)
 * Draws photos of LEGO piles whose exact contents are known, for scoring identification.
 * Four kinds of scene, from easy to hard:
 *   spread  pieces apart on a plain surface
 *   heap    a pile with pieces lying on each other
 *   carpet  a loose pile on a textured carpet
 *   dense   the frame filled with pieces, no background visible
 * Each scene gets shadows, a lighting gradient, sensor noise and blur, like a phone photo.
 *
 *   const s = EVAL.scene(seed, 'heap');  // { canvas, truth: [{id, color, qty}], total }
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const EVAL = (root.EVAL = {});

  // A realistic mix: common parts and colours, weighted like a typical family collection.
  const PARTS = [
    ['3001', 8], ['3004', 12], ['3003', 7], ['3010', 5], ['3005', 5], ['3622', 4], ['3009', 3], ['3002', 3], ['2456', 2],
    ['3023', 9], ['3020', 5], ['3022', 5], ['3710', 5], ['3024', 5], ['3666', 3], ['3021', 3], ['3795', 2], ['3034', 2],
    ['3069', 4], ['3070', 3], ['3068', 3], ['2431', 2],
    ['3039', 3], ['3040', 3], ['11477', 2], ['15068', 2],
    ['4073', 3], ['3062b', 2], ['4032', 2], ['98138', 3], ['87087', 2], ['3700', 2],
  ];
  const COLORS = [
    ['red', 10], ['blue', 9], ['yellow', 9], ['white', 9], ['black', 9], ['lbg', 10], ['dbg', 8], ['green', 6],
    ['tan', 5], ['orange', 4], ['brown', 4], ['lime', 3], ['azure', 3], ['darkRed', 2], ['darkBlue', 2], ['brightGreen', 2], ['pink', 1],
  ];

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const pick = (r, list) => {
    const tot = list.reduce((t, x) => t + x[1], 0);
    let v = r() * tot;
    for (const [k, w] of list) if ((v -= w) < 0) return k;
    return list[0][0];
  };

  const KINDS = {
    spread: { n: [12, 24], bg: 'plain', spread: 'grid' },
    heap: { n: [35, 70], bg: 'plain', spread: 'pile' },
    carpet: { n: [30, 55], bg: 'carpet', spread: 'pile' },
    dense: { n: [260, 340], bg: 'plain', spread: 'fill' },
  };
  EVAL.KINDS = Object.keys(KINDS);

  EVAL.scene = function scene(seed, kind, size) {
    const k = KINDS[kind] || KINDS.heap;
    const r = rng(seed * 7919 + kind.length);
    const W = (size && size[0]) || 1400;
    const H = (size && size[1]) || 1050;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    // background
    const tones = [['#E9E6E1', '#D9D5CF'], ['#C9CFD6', '#B7BEC7'], ['#2F3237', '#24272B'], ['#E8E2D2', '#D6CDB8']];
    const t = tones[Math.floor(r() * tones.length)];
    if (k.bg === 'carpet') {
      ctx.fillStyle = '#B9A48B';
      ctx.fillRect(0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * 70 + (((i / 4) % W) % 3 === 0 ? -8 : 0);
        img.data[i] += n;
        img.data[i + 1] += n * 0.9;
        img.data[i + 2] += n * 0.8;
      }
      ctx.putImageData(img, 0, 0);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, t[0]);
      g.addColorStop(1, t[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const n = Math.floor(k.n[0] + r() * (k.n[1] - k.n[0]));
    const pieces = [];
    for (let i = 0; i < n; i++) pieces.push({ id: pick(r, PARTS), color: pick(r, COLORS) });
    const scale = k.spread === 'fill' ? 46 : k.spread === 'grid' ? 38 : 34;
    const cols = Math.ceil(Math.sqrt((n * W) / H));
    pieces.forEach((p, i) => {
      let cx, cy;
      if (k.spread === 'grid') {
        const rows = Math.ceil(n / cols);
        cx = (W / cols) * ((i % cols) + 0.5) + (r() - 0.5) * (W / cols) * 0.3;
        cy = (H / rows) * (Math.floor(i / cols) + 0.5) + (r() - 0.5) * (H / rows) * 0.3;
      } else if (k.spread === 'fill') {
        cx = r() * W;
        cy = r() * H;
      } else {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * Math.min(W, H) * 0.36;
        cx = W / 2 + Math.cos(a) * d * 1.25;
        cy = H / 2 + Math.sin(a) * d;
      }
      const theta = Math.floor(r() * 360);
      const phi = 38 + r() * 34;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 6;
      LEGO.drawPart(ctx, p, cx, cy, scale * (0.85 + r() * 0.3), { theta, phi });
      ctx.restore();
    });

    // photo feel: light falloff, noise, slight blur
    const v = ctx.createRadialGradient(W * 0.4, H * 0.35, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const e = (r() - 0.5) * 16;
      img.data[i] += e;
      img.data[i + 1] += e;
      img.data[i + 2] += e;
    }
    ctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const o = out.getContext('2d');
    o.filter = 'blur(0.7px)';
    o.drawImage(cv, 0, 0);

    const m = new Map();
    for (const p of pieces) {
      const key = p.id + '|' + p.color;
      m.set(key, (m.get(key) || 0) + 1);
    }
    const truth = [...m.entries()].map(([key, qty]) => {
      const [id, color] = key.split('|');
      return { id, color, qty };
    });
    return { canvas: out, truth, total: n, kind };
  };
})(typeof window !== 'undefined' ? window : globalThis);
