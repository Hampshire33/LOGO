/*
 * design-core.js
 * Claude designs a LEGO model: from a photo of the subject and/or a few words, using the
 * builder's own parts where possible. Shared by the AI server (worker/) and the design test
 * bench, so both run exactly the same prompt and check-and-fix loop.
 *
 *   const r = await LEGO.designAI.run(callApi, { image, want, inventory, onlyMine, model });
 *   // callApi(payload) -> Messages API response JSON; r = { model, check, rounds, usage }
 *
 * The model comes back in a compact form (short keys) to keep output tokens down, is expanded
 * to the engine's steps, and is checked with LEGO.checkModel (no overlaps, every part held,
 * known parts and colours) plus, when asked, against the parts the builder owns. Problems go
 * back to Claude once to fix; the better of the two versions is kept.
 */
(function (root) {
  'use strict';

  const LEGO = root.LEGO;
  const D = (LEGO.designAI = {});

  D.VERSION = 3;
  D.MAX_ROUNDS = 2; // first design + one fix
  D.MAX_TOKENS = 12000; // per round; a 120-part model in compact form is ~4-6k

  function library() {
    const rows = LEGO.ORDER.map((id) => {
      const d = LEGO.LIB[id];
      const side = d.studs.filter((s) => s[3]).length;
      const shape = d.kind === 'cyl' ? 'round' : d.profile.length === 4 ? (d.studs.length ? 'box' : 'tile') : id === '3044c' ? 'ridge' : d.profile.length > 6 ? 'curved slope' : 'slope';
      return `${id} ${d.label}: w${d.w} d${d.d} h${Math.round(d.h / LEGO.PLATE)} ${shape}${side ? ', side stud on -y face 0.7 above bottom' : ''}`;
    });
    const colors = Object.values(LEGO.COLORS).filter((c) => !c.extra).map((c) => `${c.key}=${c.name}`);
    return 'PARTS (id name: width x, depth y, height in plates)\n' + rows.join('\n') + '\n\nCOLOURS (key=name)\n' + colors.join(', ');
  }

  D.system = function system() {
    return [
      'You are an expert LEGO designer. You design small, sturdy, recognisable models from real LEGO parts, the way official sets and good fan builds do, and write them as building steps.',
      '',
      'DESIGN',
      '- First decide what makes the subject recognisable from the front-left view: silhouette, proportions, main colours, 2-4 key features (wheels, windows, roof, face, legs). Build those; skip tiny details.',
      '- Size: aim for the part count given in the request (within about 15%). A bigger model shows the subject better: use the extra parts for body, shape and detail, not for a solid lump. Solid, symmetrical where the subject is.',
      '- Use real techniques: stagger joints like brickwork, plates to tie rows together, slopes for roofs and noses, round plates on side-stud bricks (87087) for wheels and eyes, tiles for smooth tops.',
      '- The key features must be there: a vehicle has wheels, a house a roof and door, an animal legs, ears and eyes. Never drop a key feature to save parts.',
      '- When told to use only the builder\'s parts, work within them (another colour or shorter pieces that add up). Otherwise recognisability comes first: use the builder\'s parts for the bulk, and add the parts the key features need; they go on a shopping list.',
      '',
      'HOW MODELS ARE WRITTEN',
      '- Units: x, y in studs; z in plates (a plate is 1 high, a brick 3). Plate 0 lies on the ground. x right, y away from the viewer, z up. The model faces -y, towards the viewer.',
      '- A part is {"i": part id, "c": colour key, "a": [x, y, z], "r": rotation 0-3, "u": ""}. "a" is the minimum corner after rotation (left, front, bottom). r turns a quarter anticlockwise seen from above; with r 0 the part\'s width runs along x.',
      '- Every part must rest on studs of a part below with footprints overlapping, or stand on the ground. Tiles and curved slopes hold nothing above them.',
      '- Side studs: an 87087 at z = k with its front at y = 0 holds a 1x1 round tile (98138) or 2x2 round plate (4032) on its front: "u": "-y", "a": [x, -0.4, k + 0.5]. A 2x2 round plate rests on two 87087 side by side (x of the left one). For the back face use an 87087 with r 2 at [x, yb, k] and hang the part with "u": "+y" at [x, yb + 1, k + 0.5].',
      '- Steps: a list of steps, each a list of 1 to 12 parts, bottom layer first. Each part drops in from above, so it must not pass through parts already placed. Side-stud parts come last.',
      '- Only parts and colours from the lists below. No invented prints.',
      '',
      library(),
      '',
      'Submit the whole model with the submit_model tool, with no other text. It is checked for overlaps, parts that are not held, and parts the builder does not own; fix anything reported and submit the whole model again.',
    ].join('\n');
  };

  D.TOOL = {
    name: 'submit_model',
    description: 'Submit the complete model as building steps.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                i: { type: 'string' },
                c: { type: 'string' },
                a: { type: 'array', items: { type: 'number' } },
                r: { type: 'integer' },
                u: { type: 'string' },
              },
              required: ['i', 'c', 'a', 'r', 'u'],
            },
          },
        },
      },
      required: ['title', 'steps'],
    },
  };

  const FROM = { '-y': [0, -3, 0], '+y': [0, 3, 0], '-x': [-3, 0, 0], '+x': [3, 0, 0] };

  // Compact tool input -> engine model. Unknown parts/colours are kept (the checker reports them).
  D.expand = function expand(input) {
    const steps = (Array.isArray(input && input.steps) ? input.steps : []).slice(0, 60).map((st) =>
      (Array.isArray(st) ? st : []).slice(0, 24).map((p) => {
        const spec = { id: String(p.i || ''), color: String(p.c || ''), at: Array.isArray(p.a) ? p.a.slice(0, 3).map(Number) : [0, 0, 0] };
        const r = Math.round(Number(p.r) || 0) & 3;
        if (r) spec.rot = r;
        if (p.u && FROM[p.u]) {
          spec.up = p.u;
          spec.from = FROM[p.u];
        }
        return spec;
      }).filter((s) => s.at.length === 3 && s.at.every((v) => isFinite(v)))
    ).filter((st) => st.length);
    return { title: String((input && input.title) || 'My Design').slice(0, 40), theta: 35, phi: 26, steps };
  };

  // How many parts to aim for: small ~30, medium ~60, max = most of the builder's pile.
  D.SIZES = ['small', 'medium', 'max'];
  D.targetParts = function targetParts(inv, size) {
    const owned = (inv || []).filter((r) => LEGO.LIB[r.id] && LEGO.COLORS[r.color]).reduce((t, r) => t + r.qty, 0);
    if (size === 'small') return 30;
    if (size === 'medium') return 60;
    // most of the pile, within what one answer can hold
    return Math.max(40, Math.min(150, Math.round(owned * 0.8) || 80));
  };

  // Check a model; `inv` given = also list parts beyond what the builder owns.
  D.review = function review(model, inv, onlyMine, target) {
    const c = LEGO.checkModel(model);
    const problems = c.problems.map((p) => p.text);
    let extra = [];
    if (inv && LEGO.inv) extra = LEGO.inv.coverage(inv, model).missing;
    const lines = problems.slice(0, 30);
    if (onlyMine && extra.length) lines.push(...extra.slice(0, 15).map((m) => `NOT OWNED  ${m.qty} x ${m.id} ${m.color}`));
    if (target && c.parts < target * 0.6) lines.push(`TOO SMALL  model has ${c.parts} parts, aim for about ${target}`);
    return { ok: !problems.length, parts: c.parts, steps: c.steps, problems, missing: extra, feedback: lines, small: !!(target && c.parts < target * 0.6) };
  };

  function inventoryText(inv) {
    const rows = (inv || []).filter((r) => LEGO.LIB[r.id] && LEGO.COLORS[r.color]).slice(0, 150);
    if (!rows.length) return 'The builder has not listed any parts: use common parts freely.';
    return 'THE BUILDER OWNS (id colour count): ' + rows.map((r) => `${r.id} ${r.color} ${r.qty}`).join('; ');
  }

  D.userContent = function userContent(o) {
    const want = String(o.want || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const text = [
      o.image ? 'The photo shows what to build.' : '',
      want ? `What to build: ${want}.` : '',
      !o.image && !want ? 'Design something fun and recognisable from these parts.' : '',
      inventoryText(o.inventory),
      o.onlyMine ? 'Use only parts the builder owns, and no more of each part + colour than they have.' : 'Use the builder\'s parts for the bulk of the model and add whatever parts the key features need.',
      `Size: about ${D.targetParts(o.inventory, o.size)} parts` + (o.size === 'max' || !o.size ? ' (use most of the builder\'s pile).' : '.'),
    ].filter(Boolean).join('\n');
    const content = [];
    if (o.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: o.image } });
    content.push({ type: 'text', text });
    return content;
  };

  const canForce = (model) => !/opus-5-5|fable|mythos/.test(model || '');

  // Problem lines the checker writes. A fix request may only carry lines of these shapes, so the
  // server can relay them to Claude without becoming a general-purpose proxy.
  D.PROBLEM_LINE = /^(OVERLAP|FLOATS|UNKNOWN PART|UNKNOWN COLOUR|BAD POSITION|BAD PART|NOT OWNED|TOO SMALL)\s[\w\s:,.[\]|+#-]{1,160}$/;

  // One API request: a first design, or a fix of `previous` (the compact tool input) given the
  // checker's problem lines.
  D.request = function request(o, previous, problems) {
    const model = o.model || 'claude-opus-5-5';
    const messages = [{ role: 'user', content: D.userContent(o) }];
    if (previous && problems && problems.length) {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: D.TOOL.name, input: previous }] });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_prev', content: 'The check found these problems. Fix them all and submit the whole model again:\n' + problems.join('\n') }],
      });
    }
    return {
      model,
      max_tokens: D.MAX_TOKENS,
      system: D.system(),
      messages,
      tools: [D.TOOL],
      tool_choice: canForce(model) ? { type: 'tool', name: D.TOOL.name } : { type: 'auto' },
    };
  };

  // The tool input from an API response, or null.
  D.inputOf = function inputOf(res) {
    const use = ((res && res.content) || []).find((c) => c.type === 'tool_use' && c.name === D.TOOL.name);
    return use ? use.input : null;
  };

  // Design in the browser through the site's server: the server makes one Claude call per request,
  // the page checks the result and asks for one fix. callServer(body) -> { input, usage, model }.
  D.viaServer = async function viaServer(callServer, o) {
    const base = { image: o.image || undefined, want: o.want, inventory: o.inventory, onlyMine: !!o.onlyMine, size: o.size || 'max' };
    const target = D.targetParts(o.inventory, o.size || 'max');
    const usage = { input_tokens: 0, output_tokens: 0 };
    let best = null;
    let previous = null;
    let problems = null;
    let modelName = '';
    for (let round = 1; round <= D.MAX_ROUNDS; round++) {
      if (o.onRound) o.onRound(round);
      const r = await callServer(Object.assign({}, base, previous ? { fix: { previous, problems } } : {}));
      usage.input_tokens += (r.usage && r.usage.input_tokens) || 0;
      usage.output_tokens += (r.usage && r.usage.output_tokens) || 0;
      modelName = r.model || modelName;
      if (!r.input) break;
      const m = D.expand(r.input);
      const check = D.review(m, o.inventory, o.onlyMine, target);
      const score = check.problems.length * 3 + (o.onlyMine ? check.missing.length : 0) + (check.small ? 5 : 0);
      if (!best || score < best.score) best = { model: m, check, score, round };
      if (!check.feedback.length) break;
      previous = r.input;
      problems = check.feedback.filter((l) => D.PROBLEM_LINE.test(l)).slice(0, 40);
      if (!problems.length) break;
    }
    if (!best) throw Object.assign(new Error('no model came back'), { code: 'bad_answer' });
    return { model: best.model, check: best.check, rounds: best.round, usage, modelName };
  };

  // The design loop. callApi(payload) returns the Messages API response (throws on errors).
  D.run = async function run(callApi, o) {
    const model = o.model || 'claude-opus-5-5';
    const system = D.system();
    const messages = [{ role: 'user', content: D.userContent(o) }];
    const usage = { input_tokens: 0, output_tokens: 0 };
    let best = null;
    for (let round = 1; round <= (o.maxRounds || D.MAX_ROUNDS); round++) {
      const res = await callApi({
        model,
        max_tokens: D.MAX_TOKENS,
        system,
        messages,
        tools: [D.TOOL],
        tool_choice: canForce(model) ? { type: 'tool', name: D.TOOL.name } : { type: 'auto' },
      });
      usage.input_tokens += (res.usage && res.usage.input_tokens) || 0;
      usage.output_tokens += (res.usage && res.usage.output_tokens) || 0;
      const use = (res.content || []).find((c) => c.type === 'tool_use' && c.name === D.TOOL.name);
      if (!use) break;
      const m = D.expand(use.input);
      const check = D.review(m, o.inventory, o.onlyMine, D.targetParts(o.inventory, o.size || 'max'));
      const score = check.problems.length * 3 + (o.onlyMine ? check.missing.length : 0) + (check.small ? 5 : 0);
      if (!best || score < best.score) best = { model: m, check, score, round };
      if (!check.feedback.length || round === (o.maxRounds || D.MAX_ROUNDS)) break;
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: use.id,
          content: 'The check found these problems. Fix them all and submit the whole model again:\n' + check.feedback.join('\n'),
        }],
      });
    }
    if (!best) throw Object.assign(new Error('no model came back'), { code: 'bad_answer' });
    return { model: best.model, check: best.check, rounds: best.round, usage, modelName: model };
  };
})(typeof window !== 'undefined' ? window : globalThis);
