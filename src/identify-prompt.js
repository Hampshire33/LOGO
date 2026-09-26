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

  P.VERSION = 5;

  P.SYSTEM = [
    'You are a LEGO parts expert cataloguing a photo of loose LEGO pieces for someone who wants to build with them.',
    '',
    'For every piece you can identify, give what you see:',
    '- shape: brick, plate or tile for plain rectangular pieces; round_brick, round_plate or round_tile for round ones; otherwise slope, technic, minifig, wheel, window_door, decor or other.',
    '- studs_w and studs_l: the size in studs, shorter side first (a 2 x 4 brick: 2 and 4). Use 0 when size does not apply.',
    '- part_num: the Rebrickable part number when the piece is not a plain brick, plate or tile (e.g. 3039 for Slope 45 2 x 2, 85984 for Slope 30 1 x 2 x 2/3, 32524 for Technic Beam 1 x 7); for plain pieces give your best number, it is checked against the shape.',
    '- name: the Rebrickable-style part name, e.g. "Brick 2 x 4", "Plate 1 x 6", "Tile 2 x 2 with Groove", "Slope 30 1 x 2 x 2/3".',
    '- color: the official LEGO colour name as Rebrickable/BrickLink write it: Black, White, Red, Blue, Yellow, Green, Light Bluish Gray, Dark Bluish Gray, Tan, Dark Tan, Reddish Brown, Dark Red, Orange, Lime, Medium Azure, Dark Blue, Trans-Clear, and so on.',
    '- count: how many identical pieces (same part and colour).',
    '- confidence: high when you can count the studs and see the shape clearly, medium when mostly sure, low when it is your best guess.',
    '',
    'How to work: scan the image systematically in horizontal bands from top to bottom, left to right, so no piece is skipped or counted twice. Keep a running tally.',
    '',
    'Brick or plate: decide this for every piece from its side profile. A brick side is about as tall as a stud is wide times 1.2 (a 1 x 2 brick side is roughly square-ish); a plate side is a thin strip, a third of a brick. Many collections have more plates than bricks: do not default to brick. A tile is plate-thin with a smooth top and no studs.',
    'Sizes: count the studs along each side (a 2 x 4 has 8 studs).',
    '',
    'How to tell colours: photos darken colours in shadow. Judge each piece by its brightest lit face. Black plastic often looks dark grey on lit faces, White looks light grey in shade, Green and Medium Azure look darker than they are. Most collections are mostly Black, White, Red, Blue, Yellow, Green, Light Bluish Gray, Dark Bluish Gray, Tan, Reddish Brown, Orange and Lime: use a rarer shade (Dark Green, Dark Turquoise, Dark Red...) only when it is clearly that shade and not a common colour in shadow.',
    '',
    'Rules:',
    '- The photo may be one tile of a larger photo. A magenta frame marks the counting zone and the area outside it is dimmed. Count only pieces whose centre lies inside the frame; pieces centred in the dimmed area are counted in another tile.',
    '- A piece partly covered by others still counts if you can tell what it is.',
    '- Pieces too covered to identify: do not guess them. Add them to hidden_count instead.',
    '- Ignore anything that is not a LEGO element: hands, carpet, tables, boxes, stickers, watermarks, text.',
    '- A complete minifigure is one entry with part_num "minifig", name "Minifigure", its main torso colour, and category minifig.',
    '- Only real LEGO parts and colours that LEGO actually produced that part in. Every answer is checked against the LEGO catalogue.',
    '',
    'Report everything with the report_pieces tool.',
  ].join('\n');

  P.SHAPES = ['brick', 'plate', 'tile', 'round_brick', 'round_plate', 'round_tile', 'slope', 'technic', 'minifig', 'wheel', 'window_door', 'decor', 'other'];
  P.CATEGORIES = ['brick', 'plate', 'tile', 'slope', 'round', 'technic', 'minifig', 'wheel', 'window_door', 'decor', 'other'];

  P.TOOL = {
    name: 'report_pieces',
    description: 'Report the LEGO pieces counted in the photo (or in the framed counting zone of this tile).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pieces: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              shape: { type: 'string', enum: P.SHAPES },
              studs_w: { type: 'integer' },
              studs_l: { type: 'integer' },
              part_num: { type: 'string' },
              name: { type: 'string' },
              category: { type: 'string', enum: P.CATEGORIES },
              color: { type: 'string' },
              count: { type: 'integer' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['shape', 'studs_w', 'studs_l', 'part_num', 'name', 'category', 'color', 'count', 'confidence'],
          },
        },
        hidden_count: { type: 'integer', description: 'Pieces present in the counting zone but too covered to identify.' },
        notes: { type: 'string', description: 'One short sentence about anything that limited the count, or empty.' },
      },
      required: ['pieces', 'hidden_count', 'notes'],
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
    'Answer with JSON only, exactly in this shape: {"pieces":[{"shape":"brick","studs_w":2,"studs_l":4,"part_num":"3001","name":"Brick 2 x 4","category":"brick","color":"Red","count":2,"confidence":"high"}],"hidden_count":0,"notes":""}. ' +
    'shape is one of: ' + P.SHAPES.join(', ') + '. ' +
    'category is one of: ' + P.CATEGORIES.join(', ') + '.';

  // Check an answer's shape; returns a clean copy or throws.
  P.clean = function clean(a) {
    if (!a || !Array.isArray(a.pieces)) throw new Error('answer has no pieces list');
    const pieces = [];
    for (const p of a.pieces.slice(0, 400)) {
      if (!p || typeof p !== 'object') continue;
      const count = Math.max(0, Math.min(2000, Math.round(Number(p.count) || 0)));
      if (!count) continue;
      const w = Math.max(0, Math.min(16, Math.round(Number(p.studs_w) || 0)));
      const l = Math.max(0, Math.min(16, Math.round(Number(p.studs_l) || 0)));
      pieces.push({
        shape: P.SHAPES.includes(p.shape) ? p.shape : 'other',
        studs_w: Math.min(w, l || w),
        studs_l: Math.max(w, l),
        part_num: String(p.part_num || '').trim().slice(0, 24),
        name: String(p.name || '').trim().slice(0, 120),
        category: P.CATEGORIES.includes(p.category) ? p.category : 'other',
        color: String(p.color || '').trim().slice(0, 48),
        count,
        confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium',
      });
    }
    return {
      pieces,
      hidden_count: Math.max(0, Math.min(5000, Math.round(Number(a.hidden_count) || 0))),
      notes: String(a.notes || '').slice(0, 300),
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
