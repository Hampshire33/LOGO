/*
 * identify-prompt.js
 * The one definition of how Claude reads a photo of LEGO pieces. Shared by the browser (claude.ai
 * page), the AI server (worker/) and the test bench, so all three ask exactly the same question.
 * The server builds its request only from this file plus the image: it never accepts a prompt
 * from the page, so it cannot be used as a general-purpose Claude proxy.
 */
(function (root) {
  'use strict';

  const P = (root.PILEBUILD_PROMPT = {});

  P.VERSION = 6;

  // v6: same rules as v5, compact answer (one-letter keys, no fields the page can derive) to cut
  // output tokens, which cost 5x input. Measured history in EVAL-RESULTS.md.
  P.SYSTEM = [
    'You are a LEGO parts expert cataloguing a photo of loose LEGO pieces for someone who wants to build with them.',
    '',
    'Report every piece you can identify with the report_pieces tool, grouping identical pieces (same part and colour) into one entry:',
    '- s: shape. brick, plate or tile for plain rectangular pieces; round_brick, round_plate or round_tile for round ones; otherwise slope, technic, minifig, wheel, window_door, decor or other.',
    '- w, l: size in studs, shorter side first (a 2 x 4 brick: w 2, l 4). 0 when size does not apply.',
    '- n: the Rebrickable part number, only for pieces that are not plain bricks, plates, tiles or round pieces (e.g. 3039 Slope 45 2 x 2, 85984 Slope 30 1 x 2 x 2/3, 32524 Technic Beam 1 x 7). Empty for plain pieces.',
    '- c: the official LEGO colour name (Black, White, Red, Blue, Yellow, Green, Light Bluish Gray, Dark Bluish Gray, Tan, Dark Tan, Reddish Brown, Dark Red, Orange, Lime, Medium Azure, Dark Blue, Trans-Clear...).',
    '- q: how many.',
    '- k: h when you can count the studs and see the shape clearly, m when mostly sure, l for a best guess.',
    '',
    'Work systematically: scan in horizontal bands from top to bottom, left to right, keeping a running tally, so no piece is skipped or counted twice.',
    'Brick or plate: decide for every piece from its side profile. A brick side is about 1.2 studs tall; a plate side is a thin strip, a third of a brick. Collections have many plates: do not default to brick. A tile is plate-thin with a smooth top.',
    'Colours: judge by the brightest lit face. Black looks dark grey where lit, White looks light grey in shade, Green and Medium Azure look darker in shadow. Prefer the common colours (Black, White, Red, Blue, Yellow, Green, Light/Dark Bluish Gray, Tan, Reddish Brown, Orange, Lime) unless a rarer shade is unmistakable.',
    'If the photo is a tile of a larger photo, a magenta frame marks the counting zone and the rest is dimmed: count only pieces whose centre is inside the frame.',
    'Partly covered pieces count if you can tell what they are; pieces too covered to identify go in h, not guessed. Ignore anything that is not LEGO (hands, carpet, boxes, watermarks, text). A complete minifigure is one entry with s minifig and n "minifig".',
    'Only real LEGO parts and colours LEGO produced them in: answers are checked against the LEGO catalogue.',
    'Call report_pieces straight away, with no other text.',
  ].join('\n');

  P.SHAPES = ['brick', 'plate', 'tile', 'round_brick', 'round_plate', 'round_tile', 'slope', 'technic', 'minifig', 'wheel', 'window_door', 'decor', 'other'];
  P.CATEGORIES = ['brick', 'plate', 'tile', 'slope', 'round', 'technic', 'minifig', 'wheel', 'window_door', 'decor', 'other'];
  const CAT_OF = { round_brick: 'round', round_plate: 'round', round_tile: 'round' };

  P.TOOL = {
    name: 'report_pieces',
    description: 'Report the LEGO pieces counted in the photo (or in the framed counting zone of this tile).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        p: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              s: { type: 'string', enum: P.SHAPES },
              w: { type: 'integer' },
              l: { type: 'integer' },
              n: { type: 'string' },
              c: { type: 'string' },
              q: { type: 'integer' },
              k: { type: 'string', enum: ['h', 'm', 'l'] },
            },
            required: ['s', 'w', 'l', 'n', 'c', 'q', 'k'],
          },
        },
        h: { type: 'integer', description: 'Pieces present but too covered to identify.' },
        note: { type: 'string', description: 'A few words on anything that limited the count, or empty.' },
      },
      required: ['p', 'h', 'note'],
    },
  };

  // The only per-request text: which tile this is. Numbers only, built from integers.
  P.userText = function userText(n, of) {
    const a = Math.max(1, Math.min(99, Math.floor(Number(n) || 1)));
    const b = Math.max(a, Math.min(99, Math.floor(Number(of) || 1)));
    return b === 1
      ? 'Here is the whole photo. Count and identify every LEGO piece in it.'
      : `This is tile ${a} of ${b} from one photo. Count and identify only the pieces whose centre is inside the magenta frame.`;
  };

  // For callers that cannot force a tool (claude.ai page): the same answer as plain JSON.
  P.JSON_INSTRUCTIONS =
    'Answer with JSON only, exactly in this shape: {"p":[{"s":"brick","w":2,"l":4,"n":"","c":"Red","q":2,"k":"h"}],"h":0,"note":""}. ' +
    's is one of: ' + P.SHAPES.join(', ') + '.';

  // Check an answer's shape; returns a clean copy or throws.
  // Check an answer's shape and expand it to full field names for the page. Accepts the compact
  // v6 answer (p/s/w/l/n/c/q/k) and, for older cached answers, the long v5 form.
  P.clean = function clean(a) {
    const list = a && (Array.isArray(a.p) ? a.p : Array.isArray(a.pieces) ? a.pieces : null);
    if (!list) throw new Error('answer has no pieces list');
    const conf = { h: 'high', m: 'medium', l: 'low', high: 'high', medium: 'medium', low: 'low' };
    const pieces = [];
    for (const x of list.slice(0, 400)) {
      if (!x || typeof x !== 'object') continue;
      const count = Math.max(0, Math.min(2000, Math.round(Number(x.q ?? x.count) || 0)));
      if (!count) continue;
      const w = Math.max(0, Math.min(16, Math.round(Number(x.w ?? x.studs_w) || 0)));
      const l = Math.max(0, Math.min(16, Math.round(Number(x.l ?? x.studs_l) || 0)));
      const shape = P.SHAPES.includes(x.s ?? x.shape) ? (x.s ?? x.shape) : 'other';
      pieces.push({
        shape,
        studs_w: Math.min(w, l || w),
        studs_l: Math.max(w, l),
        part_num: String(x.n ?? x.part_num ?? '').trim().slice(0, 24),
        name: String(x.name || '').trim().slice(0, 120),
        category: CAT_OF[shape] || (P.CATEGORIES.includes(shape) ? shape : 'other'),
        color: String(x.c ?? x.color ?? '').trim().slice(0, 48),
        count,
        confidence: conf[x.k ?? x.confidence] || 'medium',
      });
    }
    return {
      pieces,
      hidden_count: Math.max(0, Math.min(5000, Math.round(Number(a.h ?? a.hidden_count) || 0))),
      notes: String(a.note ?? a.notes ?? '').slice(0, 300),
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
