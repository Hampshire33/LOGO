/*
 * sample-pile.js
 * An example photo of loose bricks, drawn by the engine itself: the app opens on it, and it
 * doubles as a test image for the detector. The inventory that goes with it is exact.
 *
 *   const { canvas, inventory } = LEGO.samplePile();
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;

  const PILE = [
    ['3001', 'red', 3], ['3001', 'blue', 2], ['3003', 'yellow', 3], ['3004', 'white', 4],
    ['3010', 'white', 2], ['3020', 'green', 2], ['3023', 'black', 3], ['3039', 'red', 2],
    ['3005', 'yellow', 2], ['2456', 'lbg', 2], ['98138', 'black', 2], ['3022', 'white', 1],
  ];

  // Deterministic scatter: the same pile every time.
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  LEGO.samplePile = function samplePile(W, H) {
    const w = W || 1200;
    const h = H || 900;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    // a matte grey-blue mat, a little uneven like a real photo
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#C9CFD6');
    g.addColorStop(1, '#BCC3CB');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const pieces = [];
    for (const [id, color, qty] of PILE) for (let i = 0; i < qty; i++) pieces.push({ id, color });
    const cols = 7;
    const rows = Math.ceil(pieces.length / cols);
    const cw = w / cols;
    const ch = h / rows;
    pieces.forEach((p, i) => {
      const c = i % cols;
      const r = (i / cols) | 0;
      const cx = cw * (c + 0.5) + (hash(i) - 0.5) * cw * 0.28;
      const cy = ch * (r + 0.5) + (hash(i + 50) - 0.5) * ch * 0.28;
      const theta = Math.round(hash(i + 90) * 360);
      const size = LEGO.partSize(p, theta, 58);
      const scale = Math.min((cw * 0.72) / size.w, (ch * 0.72) / size.h, 34);
      // soft contact shadow
      ctx.save();
      ctx.fillStyle = 'rgba(40, 48, 58, 0.16)';
      ctx.beginPath();
      ctx.ellipse(cx + 4, cy + size.h * scale * 0.28, size.w * scale * 0.42, size.h * scale * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      LEGO.drawPart(ctx, p, cx, cy, scale, { theta, phi: 58 });
    });
    const inventory = PILE.map(([id, color, qty]) => ({ id, color, qty, name: LEGO.LIB[id].label }));
    return { canvas: cv, inventory, count: pieces.length };
  };
})(typeof window !== 'undefined' ? window : globalThis);
