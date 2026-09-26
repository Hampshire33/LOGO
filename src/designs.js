/*
 * designs.js
 * Real LEGO designs for common subjects, shaped and coloured from a photo. Every part is a real
 * element from the library, attached the way a builder would (studs, side studs for wheels and
 * eyes), and every design passes LEGO.checkModel.
 *
 *   LEGO.designs.list                            -> [{ key: 'car', title: 'Car' }, ...]
 *   LEGO.designs.build('car', { length, colors }) -> engine model
 *
 * colors: { main, second, accent } engine colour keys (from the photo); sizes in studs.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const D = (LEGO.designs = {});

  // Part ids by family and length (studs).
  const FAM = {
    brick1: { 1: '3005', 2: '3004', 3: '3622', 4: '3010', 6: '3009', 8: '3008' },
    brick2: { 2: '3003', 3: '3002', 4: '3001', 6: '2456', 8: '3007' },
    plate1: { 1: '3024', 2: '3023', 3: '3623', 4: '3710', 6: '3666', 8: '3460' },
    plate2: { 2: '3022', 3: '3021', 4: '3020', 6: '3795', 8: '3034' },
    tile1: { 1: '3070', 2: '3069', 3: '63864', 4: '2431', 6: '6636' },
    tile2: { 2: '3068', 4: '87079' },
  };
  D.FAM = FAM;

  // Collects parts into instruction steps (at most 12 parts each).
  function Builder() {
    const steps = [];
    let cur = [];
    return {
      add(spec) {
        cur.push(spec);
      },
      step() {
        for (let i = 0; i < cur.length; i += 12) steps.push(cur.slice(i, i + 12));
        cur = [];
      },
      steps,
    };
  }

  // Lengths that fill `len` studs from a family, longest first, keeping joints off `avoid`.
  function split(len, fam, avoid, x0) {
    const sizes = Object.keys(FAM[fam]).map(Number).sort((a, b) => b - a);
    const out = [];
    function rec(left, at) {
      if (left === 0) return true;
      for (const s of sizes) {
        if (s > left) continue;
        const joint = at + s;
        if (avoid && left !== s && avoid.has(joint)) continue;
        out.push(s);
        if (rec(left - s, at + s)) return true;
        out.pop();
      }
      return false;
    }
    if (rec(len, x0 || 0)) return out;
    // no joint-free way: plain longest-first
    const plain = [];
    let left = len;
    for (const s of sizes) while (s <= left) { plain.push(s); left -= s; }
    return plain;
  }

  // A straight run of parts. along 'x' (default) or 'y'. Returns the joint positions it made.
  function run(b, fam, x, y, z, len, color, o) {
    const opt = o || {};
    const alongY = opt.along === 'y';
    const joints = new Set();
    let at = alongY ? y : x;
    for (const s of split(len, fam, opt.avoid, at)) {
      const spec = { id: FAM[fam][s], color, at: alongY ? [x, at, z] : [at, y, z] };
      if (alongY) spec.rot = 1;
      b.add(spec);
      at += s;
      joints.add(at);
    }
    return joints;
  }

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  // ---------------------------------------------------------------- car

  // Side view to the camera (-y). x runs from the back (0) to the front (L).
  function car(p) {
    const L = Math.max(8, Math.min(14, even(p.length || 10)));
    const main = p.colors.main;
    const glass = 'black';
    const tyre = 'black';
    const sill = main === 'dbg' ? 'black' : 'dbg';
    const light = main === 'white' ? 'yellow' : 'white';
    const b = Builder();
    const a1 = 1;
    const a2 = L - 3;

    // 1. lower body: long sides carry side-stud bricks where the wheels go
    for (const [y, rot] of [[0, 0], [3, 2]]) {
      run(b, 'brick1', 0, y, 0, a1, main);
      b.add({ id: '87087', color: main, at: [a1, y, 0], rot });
      b.add({ id: '87087', color: main, at: [a1 + 1, y, 0], rot });
      run(b, 'brick1', a1 + 2, y, 0, a2 - a1 - 2, main);
      b.add({ id: '87087', color: main, at: [a2, y, 0], rot });
      b.add({ id: '87087', color: main, at: [a2 + 1, y, 0], rot });
      run(b, 'brick1', a2 + 2, y, 0, L - a2 - 2, main);
    }
    b.step();
    run(b, 'brick2', 0, 1, 0, L, main);
    b.step();
    // 2. wheels: round 2 x 2 plates on the side studs, both sides
    for (const a of [a1, a2]) {
      b.add({ id: '4032', color: tyre, at: [a, -0.4, 0.5], up: '-y', from: [0, -3, 0] });
      b.add({ id: '4032', color: tyre, at: [a, 4, 0.5], up: '+y', from: [0, 3, 0] });
    }
    b.step();
    // 3. chassis plates tie both sides together
    const j0 = run(b, 'plate2', 0, 0, 3, L, sill, { avoid: new Set([a1, a1 + 1, a1 + 2, a2, a2 + 1, a2 + 2]) });
    run(b, 'plate2', 0, 2, 3, L, sill, { avoid: j0 });
    b.step();
    // 4. upper body, lights on side studs at both ends
    for (const [y] of [[0], [3]]) {
      b.add({ id: '87087', color: main, at: [0, y, 4], rot: 3 });
      run(b, 'brick1', 1, y, 4, L - 2, main, { avoid: j0 });
      b.add({ id: '87087', color: main, at: [L - 1, y, 4], rot: 1 });
    }
    b.step();
    run(b, 'brick2', 1, 1, 4, L - 2, main, { avoid: j0 });
    b.add({ id: '3004', color: main, at: [0, 1, 4], rot: 1 });
    b.add({ id: '3004', color: main, at: [L - 1, 1, 4], rot: 1 });
    b.step();
    for (const y of [0, 3]) {
      b.add({ id: '98138', color: light, at: [L, y, 4.5], up: '+x', from: [3, 0, 0] });
      b.add({ id: '98138', color: 'red', at: [-0.4, y, 4.5], up: '-x', from: [-3, 0, 0] });
    }
    b.step();
    // 5. cab: a ring of window bricks, hood and boot tiled flat
    const cab = Math.max(4, even(L * 0.5));
    const hood = Math.max(2, even((L - cab) * 0.6));
    const c0 = L - hood - cab;
    const c1 = L - hood;
    run(b, 'tile2', c1, 0, 7, hood, main);
    run(b, 'tile2', c1, 2, 7, hood, main);
    if (c0 > 0) {
      run(b, 'tile2', 0, 0, 7, c0, main);
      run(b, 'tile2', 0, 2, 7, c0, main);
    }
    b.step();
    run(b, 'brick1', c0, 0, 7, cab, glass);
    run(b, 'brick1', c0, 3, 7, cab, glass);
    b.add({ id: '3004', color: glass, at: [c0, 1, 7], rot: 1 });
    b.add({ id: '3004', color: glass, at: [c1 - 1, 1, 7], rot: 1 });
    b.step();
    // 6. roof
    const r0 = run(b, 'plate2', c0, 0, 10, cab, main);
    run(b, 'plate2', c0, 2, 10, cab, main, { avoid: r0 });
    b.step();
    run(b, 'tile2', c0, 0, 11, cab, main);
    run(b, 'tile2', c0, 2, 11, cab, main);
    b.step();
    return { title: 'Car', theta: 28, phi: 24, steps: b.steps };
  }

  // ---------------------------------------------------------------- house

  function house(p) {
    const L = Math.max(6, Math.min(12, even(p.length || 8)));
    const wall = p.colors.main;
    const roof = p.colors.second && p.colors.second !== wall ? p.colors.second : wall === 'red' ? 'dbg' : 'red';
    const ground = 'green';
    const door = 'brown';
    const glass = 'brightLightBlue';
    const b = Builder();
    // lawn
    const g0 = run(b, 'plate2', 0, 0, 0, L, ground);
    run(b, 'plate2', 0, 2, 0, L, ground, { avoid: g0 });
    b.step();
    const mid = Math.floor(L / 2) - 1;
    // walls: three rows; door in the middle of the front, a glass window either side on row two
    let below = new Set();
    for (let r = 0; r < 3; r++) {
      const z = 1 + r * 3;
      const joints = new Set();
      const add = (js) => js.forEach((j) => joints.add(j));
      if (r === 0) {
        add(run(b, 'brick1', 0, 0, z, mid, wall));
        b.add({ id: '3004', color: door, at: [mid, 0, z] });
        add(run(b, 'brick1', mid + 2, 0, z, L - mid - 2, wall));
      } else if (r === 1) {
        // wall | window | wall | door | wall | window | wall
        const wl = mid >= 4 ? 1 : 0;
        if (wl) add(run(b, 'brick1', 0, 0, z, wl, wall));
        b.add({ id: '3004', color: glass, at: [wl, 0, z] });
        if (mid - wl - 2 > 0) add(run(b, 'brick1', wl + 2, 0, z, mid - wl - 2, wall));
        b.add({ id: '3004', color: door, at: [mid, 0, z] });
        const right = L - mid - 2;
        const wr = right >= 4 ? 1 : 0;
        if (right - wr - 2 > 0) add(run(b, 'brick1', mid + 2, 0, z, right - wr - 2, wall));
        b.add({ id: '3004', color: glass, at: [L - wr - 2, 0, z] });
        if (wr) add(run(b, 'brick1', L - wr, 0, z, wr, wall));
      } else {
        // lintel row spans the door and windows
        add(run(b, 'brick1', 0, 0, z, L, wall, { avoid: below }));
      }
      run(b, 'brick1', 0, 3, z, L, wall, { avoid: below });
      b.add({ id: '3004', color: wall, at: [0, 1, z], rot: 1 });
      b.add({ id: '3004', color: wall, at: [L - 1, 1, z], rot: 1 });
      below = joints;
      b.step();
    }
    const s0 = run(b, 'plate2', 0, 0, 10, L, wall);
    run(b, 'plate2', 0, 2, 10, L, wall, { avoid: s0 });
    b.step();
    for (let x = 0; x < L; x += 2) b.add({ id: '3039', color: roof, at: [x, 0, 11] });
    b.step();
    for (let x = 0; x < L; x += 2) b.add({ id: '3039', color: roof, at: [x, 2, 11], rot: 2 });
    b.step();
    const m = { title: 'House', theta: 30, phi: 24, steps: b.steps };
    return m;
  }

  // ---------------------------------------------------------------- tree

  function tree(p) {
    const leaf = p.colors.main && !['brown', 'darkBrown', 'white', 'lbg'].includes(p.colors.main) ? p.colors.main : 'green';
    const b = Builder();
    b.add({ id: '3958', color: 'green', at: [0, 0, 0] });
    b.step();
    for (const z of [1, 4, 7]) b.add({ id: '3003', color: 'brown', at: [2, 2, z] });
    b.step();
    // canopy: a wide plate, then narrowing layers
    b.add({ id: '3958', color: leaf, at: [0, 0, 10] });
    b.step();
    b.add({ id: '3001', color: leaf, at: [1, 1, 11] });
    b.add({ id: '3001', color: leaf, at: [1, 3, 11] });
    b.add({ id: '3004', color: leaf, at: [0, 2, 11], rot: 1 });
    b.add({ id: '3004', color: leaf, at: [5, 2, 11], rot: 1 });
    b.step();
    b.add({ id: '3001', color: leaf, at: [1, 2, 14], rot: 1 });
    b.add({ id: '3001', color: leaf, at: [3, 1, 14], rot: 1 });
    b.step();
    b.add({ id: '3003', color: leaf, at: [2, 2, 17] });
    b.step();
    b.add({ id: '3941', color: leaf, at: [2, 2, 20] });
    b.step();
    return { title: 'Tree', theta: 35, phi: 24, steps: b.steps };
  }

  // ---------------------------------------------------------------- animal

  // A four-legged animal side-on: legs, body, head with an eye on a side stud, ears, tail.
  function animal(p) {
    const fur = p.colors.main || 'tan';
    const dark = ['black', 'darkBrown', 'dbg', 'brown'].includes(fur) ? 'white' : 'black';
    const b = Builder();
    for (const x of [0, 5]) for (const y of [0, 1]) b.add({ id: '3005', color: fur, at: [x, y, 0] });
    b.step();
    for (const x of [0, 5]) for (const y of [0, 1]) b.add({ id: '3005', color: fur, at: [x, y, 3] });
    b.step();
    b.add({ id: '3795', color: fur, at: [0, 0, 6] });
    b.step();
    b.add({ id: '2456', color: fur, at: [0, 0, 7] });
    b.step();
    // head: sits on the front end of the body and reaches forward
    b.add({ id: '3003', color: fur, at: [5, 0, 10] });
    b.add({ id: '3005', color: fur, at: [0, 0, 10] });
    b.step();
    b.add({ id: '87087', color: fur, at: [5, 0, 13] });
    b.add({ id: '3005', color: fur, at: [6, 0, 13] });
    b.add({ id: '3004', color: fur, at: [5, 1, 13] });
    b.add({ id: '3062b', color: fur, at: [0, 0, 13] });
    b.step();
    b.add({ id: '98138', color: dark, at: [5, -0.4, 13.5], up: '-y', from: [0, -3, 0] });
    b.add({ id: '3040', color: fur, at: [5, 0, 16] });
    b.add({ id: '3040', color: fur, at: [6, 0, 16] });
    b.step();
    return { title: 'Animal', theta: 25, phi: 22, steps: b.steps };
  }

  D.list = [
    { key: 'car', title: 'Car', build: car, hint: 'wheels, cab, roof' },
    { key: 'house', title: 'House', build: house, hint: 'walls, door, windows, roof' },
    { key: 'tree', title: 'Tree', build: tree, hint: 'trunk and canopy' },
    { key: 'animal', title: 'Animal', build: animal, hint: 'legs, body, head' },
  ];

  D.build = function build(key, params) {
    const d = D.list.find((x) => x.key === key);
    if (!d) return null;
    return d.build(Object.assign({ colors: { main: 'red' } }, params || {}));
  };
})(typeof window !== 'undefined' ? window : globalThis);
