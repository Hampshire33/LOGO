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

  P.VERSION = 3;

  P.SYSTEM = [
    'You are a LEGO parts expert cataloguing a photo of loose LEGO pieces for someone who wants to build with them.',
    '',
    'For every piece you can identify, give:',
    '- part_num: the Rebrickable part number of the most common mould for that shape (e.g. 3001 for Brick 2 x 4, 3023 for Plate 1 x 2, 3069b for Tile 1 x 2 with Groove, 3039 for Slope 45 2 x 2).',
    '- name: the Rebrickable-style part name, e.g. "Brick 2 x 4", "Plate 1 x 6", "Tile 2 x 2 with Groove", "Slope 30 1 x 2 x 2/3", "Technic Beam 1 x 5 Thick", "Plate Round 1 x 1".',
    '- color: the official LEGO colour name as Rebrickable/BrickLink write it: Black, White, Red, Blue, Yellow, Green, Light Bluish Gray, Dark Bluish Gray, Tan, Dark Tan, Reddish Brown, Dark Red, Orange, Lime, Medium Azure, Dark Blue, Trans-Clear, and so on.',
    '- count: how many identical pieces (same part and colour).',
    '- confidence: high when you can count the studs and see the shape clearly, medium when mostly sure, low when it is your best guess.',
    '',
    'How to count sizes: count the studs along each side. A brick is 3 plates tall; a plate is thin; a tile is thin and smooth on top. Look at the side profile to tell bricks from plates.',
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
              part_num: { type: 'string' },
              name: { type: 'string' },
              category: { type: 'string', enum: P.CATEGORIES },
              color: { type: 'string' },
              count: { type: 'integer' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['part_num', 'name', 'category', 'color', 'count', 'confidence'],
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
    'Answer with JSON only, exactly in this shape: {"pieces":[{"part_num":"3001","name":"Brick 2 x 4","category":"brick","color":"Red","count":2,"confidence":"high"}],"hidden_count":0,"notes":""}. ' +
    'category is one of: ' + P.CATEGORIES.join(', ') + '.';

  // Check an answer's shape; returns a clean copy or throws.
  P.clean = function clean(a) {
    if (!a || !Array.isArray(a.pieces)) throw new Error('answer has no pieces list');
    const pieces = [];
    for (const p of a.pieces.slice(0, 400)) {
      if (!p || typeof p !== 'object') continue;
      const count = Math.max(0, Math.min(2000, Math.round(Number(p.count) || 0)));
      if (!count) continue;
      pieces.push({
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
