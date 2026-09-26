/*
 * recognize.js
 * Turning photos into parts lists, and parts lists into designed models.
 *
 * Two ways to read a pile of loose bricks:
 *   LEGO.recognize.claude(sample, photo)                 whole photo, Claude counts the pieces
 *   LEGO.recognize.brickognize(image, boxes, onProgress) one crop per detected piece, Brickognize
 *                                                         names each part (standalone site only)
 * And a way to design with what you have:
 *   LEGO.ai.ideas(sample, inventory, target?)            three build ideas
 *   LEGO.ai.design(sample, inventory, idea, target?)     a checked model, as the engine's steps
 *
 * `sample` is the artifact runtime's Claude capability; every function here that takes it
 * rejects with its {code, message} errors unchanged, so the page decides what to say.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const INV = LEGO.inv;
  const REC = (LEGO.recognize = {});
  const AI = (LEGO.ai = {});

  const invText = (inv) =>
    inv.filter(INV.usable).map((r) => `${r.qty} x ${r.id} ${LEGO.LIB[r.id].label} in ${r.color}`).join('\n');

  // ------------------------------------------------------------------ Claude reads the pile

  REC.claude = async function claude(sample, photo, hint) {
    const prompt = [
      'The photo shows loose LEGO pieces spread on a surface. List every piece you can see and count them.',
      'Rules:',
      '- When a piece matches one in the PARTS list below, use that id. Otherwise give the best BrickLink part number you can, and its name.',
      '- For colour use a key from the COLOURS list when the piece is that colour. Otherwise give the BrickLink colour name.',
      '- One entry per part + colour, with qty. Count each piece once. Do not guess pieces you cannot see.',
      '- Put anything uncertain (hidden, blurry, not LEGO) in "notes", in one or two short sentences.',
      hint ? `- A simple detector found about ${hint} separate objects; pieces touching each other count as one there.` : '',
      '',
      'Answer with JSON only, in this shape:',
      '{"pieces":[{"id":"3001","name":"Brick 2×4","color":"red","qty":2}],"notes":""}',
      '',
      INV.libraryText(),
    ].join('\n');
    const out = await sample.json(prompt, { images: [photo], modelTier: 'complex' });
    const rows = (out && Array.isArray(out.pieces) ? out.pieces : []).map((p) => ({
      id: String(p.id || '').trim(),
      color: INV.colorKey(p.color) || String(p.color || '').trim(),
      qty: p.qty,
      name: p.name || '',
    }));
    return { rows: INV.from(rows), notes: (out && out.notes) || '' };
  };

  // ------------------------------------------------------------------ Brickognize, one part per crop

  // min_similarity_items is lowered from the API's 0.5: phone photos with shadows and odd angles
  // often score just under it and came back empty. Weak matches are kept and flagged instead.
  REC.BRICKOGNIZE = 'https://api.brickognize.com/predict/parts/?predict_color=true&top_k_items=3&top_k_colors=1&min_similarity_items=0.15';
  REC.WEAK = 0.45;

  // Resolves { rows, pieces, failed, weak, lastError }. `pieces` has one entry per detected box,
  // in box order: { n, box, crop (data URL), id?, name?, color, score?, error? }. Pieces without
  // an id are the ones the user names by hand.
  REC.brickognize = async function brickognize(image, boxes, onProgress) {
    // A box may carry `color` and `qty` (a colour group from a heap): its colour is already known
    // and it stands for several bricks, so Brickognize only suggests the part.
    const pieces = boxes.map((box, i) => ({
      n: i + 1,
      box,
      qty: box.qty || 1,
      group: !!box.color,
      label: box.label || '',
      color: box.color || LEGO.detect.colorClass(box.rgb[0], box.rgb[1], box.rgb[2]),
    }));
    let lastError = '';
    let done = 0;
    const queue = pieces.slice();
    async function worker() {
      while (queue.length) {
        const p = queue.shift();
        const crop = LEGO.detect.crop(image, p.box, 448);
        p.crop = crop.toDataURL('image/jpeg', 0.8);
        const blob = await new Promise((res) => crop.toBlob(res, 'image/jpeg', 0.92));
        try {
          const fd = new FormData();
          fd.append('query_image', blob, 'piece.jpg');
          const r = await fetch(REC.BRICKOGNIZE, { method: 'POST', body: fd });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          const item = j.items && j.items[0];
          if (!item) throw new Error('no match');
          const cName = (j.colors && j.colors[0] && j.colors[0].name) || (item.colors && item.colors[0] && item.colors[0].name);
          p.id = String(item.id);
          p.name = item.name || '';
          p.score = typeof item.score === 'number' ? item.score : null;
          if (!p.group) p.color = INV.colorKey(cName) || p.color;
          p.alts = (j.items || []).slice(1, 3).map((a) => ({ id: String(a.id), name: a.name || '' }));
        } catch (e) {
          p.error = e && e.message ? e.message : String(e);
          lastError = p.error;
        }
        done++;
        if (onProgress) onProgress(done, boxes.length);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    const named = pieces.filter((p) => p.id);
    return {
      rows: INV.from(named.map((p) => ({ id: p.id, name: p.name, color: p.color, qty: p.qty }))),
      pieces,
      failed: pieces.length - named.length,
      weak: named.filter((p) => p.score != null && p.score < REC.WEAK).length,
      lastError,
    };
  };

  // ------------------------------------------------------------------ main colours of a target photo

  // The few library colours that cover most of the middle of a photo: a quick read of what a
  // model of this subject needs, shown before any design is asked for.
  REC.mainColors = function mainColors(img, n) {
    const cv = document.createElement('canvas');
    const W = 64;
    const H = Math.max(1, Math.round((64 * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width)));
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const count = new Map();
    for (let y = Math.round(H * 0.15); y < H * 0.85; y++) {
      for (let x = Math.round(W * 0.15); x < W * 0.85; x++) {
        const i = (y * W + x) * 4;
        const k = INV.nearestColor([d[i], d[i + 1], d[i + 2]]);
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
    const total = [...count.values()].reduce((a, b) => a + b, 0) || 1;
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n || 4)
      .map(([key, c]) => ({ key, share: c / total }));
  };

  // ------------------------------------------------------------------ design with what you have

  AI.RULES = `HOW MODELS ARE WRITTEN
- Units: x, y in studs (8 mm); z in plates. A plate is 1 high, a brick 3. Plate 0 lies on the ground.
- x runs right, y away from the viewer, z up. The model faces -y (towards the camera).
- A part: {"id":"3001","color":"red","at":[x,y,z]} with optional "rot" (0..3, quarter turns
  anticlockwise seen from above; unrotated, the part's width runs along x) and "up".
- "at" is the part's minimum corner AFTER rotation (left, front, bottom).
- A brick on a brick sits 3 higher in z, a plate on a brick 3 higher, a brick on a plate 1 higher.
- Every part must rest on studs of a part below (footprints overlapping) or stand on the ground.
  Tiles (no studs on top) and curved slopes hold nothing above them.
- Side studs: brick 87087 has a stud on its -y face. A 1x1 round tile or 2x2 round plate can hang on it
  with "up":"-y","from":[0,-3,0]; if the 87087 is at z=k and y=0, the part's at is [x,-0.4,k+0.5].
  Use this for eyes, noses, wheels. Never invent printed parts.
- Steps: a list of steps, each a list of 1 to 12 parts, bottom layer first. Parts drop in from above,
  so each must reach its place without passing through parts already there. Put small face or detail
  parts in the last steps.
- Stagger joints between layers like brickwork. Keep the footprint within about 12 x 12 studs.
- Set "theta" 30 to 45 and "phi" 22 to 32 for the camera.`;

  AI.ideas = async function ideas(sample, inv, target) {
    const prompt = [
      'I have these LEGO parts:',
      invText(inv),
      '',
      target
        ? 'The attached photo shows what I would like to build. Suggest 3 ways to build a small model of it from my parts (for example different sizes or poses), most recognisable first.'
        : 'Suggest 3 different small models I could build from only these parts. Aim for recognisable things (an animal, a vehicle, a building, a character), not abstract stacks.',
      'Each idea must be buildable mostly from the parts listed. Keep each to at most 80 parts.',
      '',
      'Answer with JSON only: {"ideas":[{"title":"Red Fire Truck","pitch":"One sentence on what it looks like and which parts carry the shape.","parts":40}]}',
    ].join('\n');
    const out = await sample.json(prompt, { images: target ? [target] : undefined, modelTier: 'default' });
    return (out && Array.isArray(out.ideas) ? out.ideas : []).slice(0, 3);
  };

  // Design a model; Claude can run the page's checker as a tool while it works.
  AI.design = async function design(sample, inv, idea, target, opt) {
    const o = opt || {};
    const limits = await sample.limits().catch(() => null);
    const strictParts = o.onlyMine !== false;

    const report = (model) => {
      if (!model || !Array.isArray(model.steps)) return { ok: false, problems: ['model needs a "steps" array of arrays of parts'] };
      const c = LEGO.checkModel(model);
      const over = INV.coverage(inv, model).missing;
      const problems = c.problems.slice(0, 25).map((p) => p.text);
      const overText = over.map((m) => `NOT IN MY PARTS  ${m.qty} x ${m.id} ${m.color}`);
      return {
        ok: !problems.length && (!strictParts || !over.length),
        parts: c.parts,
        steps: c.steps,
        problems,
        extraParts: strictParts ? overText : [],
      };
    };

    const tools = limits && limits.tools
      ? [{
          name: 'check_model',
          description: 'Checks a model draft: overlapping parts, parts that are not held by anything, unknown parts or colours, and parts beyond my inventory. Call it on your full draft and fix everything it reports before answering.',
          inputSchema: {
            type: 'object',
            properties: {
              steps: { type: 'array', items: { type: 'array', items: { type: 'object' } } },
            },
            required: ['steps'],
          },
          execute: (input) => report({ steps: input.steps }),
        }]
      : undefined;

    const prompt = [
      `Design a LEGO model: ${idea.title}.` + (idea.pitch ? ` ${idea.pitch}` : ''),
      target ? 'The attached photo shows the subject. Capture its overall shape and main colours; it must be recognisable.' : '',
      '',
      'MY PARTS (use only these' + (strictParts ? ', and never more of any part + colour than I have' : ' where you can; extra parts are allowed if the model needs them') + '):',
      invText(inv),
      '',
      AI.RULES,
      '',
      LEGO.inv.libraryText(),
      '',
      tools ? 'Use the check_model tool on your draft and fix every problem it reports. ' : '',
      'Answer with JSON only: {"title":"...","theta":38,"phi":26,"steps":[[{"id":"3001","color":"red","at":[0,0,0]}]]}',
    ].join('\n');

    const model = await sample.json(prompt, {
      images: target ? [target] : undefined,
      modelTier: 'complex',
      tools,
      onText: o.onText,
      signal: o.signal,
    });
    if (!model || !Array.isArray(model.steps)) throw { code: 'invalid_json', message: 'no steps in the answer' };
    // Keep only parts the engine can draw; report the rest.
    const dropped = [];
    model.steps = model.steps
      .map((st) => (Array.isArray(st) ? st : []).filter((s) => {
        const ok = s && LEGO.LIB[s.id] && LEGO.COLORS[s.color] && Array.isArray(s.at) && s.at.length === 3;
        if (!ok) dropped.push(s);
        return ok;
      }))
      .filter((st) => st.length);
    model.title = String(model.title || idea.title || 'My Model').slice(0, 40);
    model.theta = Number(model.theta) || 38;
    model.phi = Number(model.phi) || 26;
    return { model, check: report(model), dropped };
  };
})(typeof window !== 'undefined' ? window : globalThis);
