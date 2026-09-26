/*
 * PileBuild AI server (Cloudflare Worker).
 *
 * Holds the Anthropic API key and reads one photo tile per request with Claude, using the
 * shared prompt in src/identify-prompt.js. It never takes a prompt from the caller: the only
 * inputs are a JPEG and which tile it is, so it cannot be used as a general Claude proxy.
 *
 * Protection, in order: allowed site origins only, JPEG only and size-capped, and daily caps
 * per visitor and overall (when the LIMITS KV namespace is bound). Set a monthly spend limit
 * in the Anthropic console as the final backstop.
 *
 *   GET  /v1/health          -> { ok, model, prompt }
 *   POST /v1/identify-tile   { image: <base64 jpeg>, n, of, precise } -> { answer, usage, model }
 *   POST /v1/design          { image?, want?, inventory, onlyMine, fix? } -> { input, usage, model }
 */
import '../src/identify-prompt.js';
import '../src/lego.js';
import '../src/check.js';
import '../src/inventory.js';
import '../src/design-core.js';

const P = globalThis.PILEBUILD_PROMPT;
const MAX_B64 = 3_500_000; // ~2.6 MB of JPEG

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'access-control-allow-origin': okOrigin ? origin : allowed[0] || 'null',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    const url = new URL(req.url);
    const defaultModel = env.MODEL || 'claude-sonnet-5';
    const preciseModel = env.PRECISE_MODEL || 'claude-opus-5-5';

    if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    // /v1/health/<anything> also answers, so a check can bypass caches in front of the server
    if (req.method === 'GET' && (url.pathname === '/v1/health' || url.pathname.startsWith('/v1/health/'))) {
      return json({ ok: !!env.ANTHROPIC_API_KEY, model: defaultModel, precise: preciseModel, prompt: P.VERSION }, 200, cors);
    }
    if (req.method !== 'POST' || (url.pathname !== '/v1/identify-tile' && url.pathname !== '/v1/design')) {
      return json({ error: 'Not found.', code: 'not_found' }, 404, cors);
    }
    if (!okOrigin) return json({ error: 'This server only answers the PileBuild site.', code: 'forbidden_origin' }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'The AI server has no API key set.', code: 'no_key' }, 500, cors);
    if (Number(req.headers.get('content-length') || 0) > MAX_B64 + 2000) {
      return json({ error: 'That photo tile is too large.', code: 'too_large' }, 413, cors);
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: 'Send JSON.', code: 'bad_request' }, 400, cors);
    }
    const isDesign = url.pathname === '/v1/design';
    const image = typeof body.image === 'string' ? body.image : '';
    if ((!isDesign || image) && (!image || image.length > MAX_B64 || !image.startsWith('/9j/'))) {
      return json({ error: 'Send one JPEG image, base64-encoded, under 2.5 MB.', code: 'bad_image' }, 400, cors);
    }

    // "Precise" reads use the stronger, ~3x dearer model and count as 3 reads against the caps.
    const precise = body.precise === true && env.ALLOW_PRECISE !== '0';
    const model = isDesign ? env.DESIGN_MODEL || 'claude-opus-5-5' : precise ? preciseModel : defaultModel;
    // a design is several long answers: it counts as 5 reads against the caps
    // a fix round of a design is a shorter follow-up: it counts 2
    const weight = isDesign ? (body.fix ? 2 : 5) : precise ? 3 : 1;

    // Daily caps (reads): per visitor and for the whole site. Needs the LIMITS KV binding.
    if (env.LIMITS) {
      // LIMIT_EPOCH in the key: changing it in wrangler.toml resets today's counters
      const day = (env.LIMIT_EPOCH || '1') + ':' + new Date().toISOString().slice(0, 10);
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';
      const perIp = Number(env.PER_IP_DAILY || 60);
      const all = Number(env.DAILY_TILES || 200);
      const [a, b] = await Promise.all([env.LIMITS.get(`ip:${day}:${ip}`), env.LIMITS.get(`all:${day}`)]);
      if (Number(a || 0) + weight > perIp) return json({ error: 'Daily limit for this device reached. Try again tomorrow.', code: 'limit_visitor' }, 429, cors);
      if (Number(b || 0) + weight > all) return json({ error: 'The site reached its daily reading limit. Try again tomorrow.', code: 'limit_site' }, 429, cors);
      await Promise.all([
        env.LIMITS.put(`ip:${day}:${ip}`, String(Number(a || 0) + weight), { expirationTtl: 172800 }),
        env.LIMITS.put(`all:${day}`, String(Number(b || 0) + weight), { expirationTtl: 172800 }),
      ]);
    }

    if (isDesign) return design(env, body, image, model, cors);

    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
      { type: 'text', text: P.userText(body.n, body.of) },
    ];
    // 4000 output tokens is plenty for the compact answer and caps what one read can cost.
    const base = { model, max_tokens: 4000, system: P.SYSTEM, messages: [{ role: 'user', content }] };

    // Forced, strict tool call where the model allows it; Opus 5.5, Fable and Mythos do not allow
    // forcing, so they are asked with the tool offered (auto). Any 400 falls back to auto too.
    const canForce = !/opus-5-5|fable|mythos/.test(model);
    let r = await callClaude(env, Object.assign({}, base, { tools: [P.TOOL], tool_choice: canForce ? { type: 'tool', name: P.TOOL.name } : { type: 'auto' } }));
    if (r.status === 400) {
      const loose = Object.assign({}, P.TOOL);
      delete loose.strict;
      r = await callClaude(env, Object.assign({}, base, { tools: [r.retryStrict ? loose : P.TOOL], tool_choice: { type: 'auto' } }));
    }
    if (!r.ok) return json({ error: r.error, code: r.code }, r.status, cors);

    const use = (r.data.content || []).find((c) => c.type === 'tool_use' && c.name === P.TOOL.name);
    let answer;
    try {
      answer = P.clean(use ? use.input : parseJson(r.data.content));
    } catch (e) {
      return json({ error: 'The reading did not come back as a parts list.', code: 'bad_answer' }, 502, cors);
    }
    return json({ answer, usage: r.data.usage || null, model }, 200, cors);
  },
};

// One Claude design call (src/design-core.js). The page checks the result and may send one fix
// request carrying the previous model and the checker's problem lines (checked against the
// checker's line format, so no free text reaches Claude). No checking here: CPU stays tiny.
async function design(env, body, image, model, cors) {
  const L = globalThis.LEGO;
  const inventory = (Array.isArray(body.inventory) ? body.inventory : []).slice(0, 300).map((r) => ({
    id: String(r && r.id || '').slice(0, 16),
    color: String(r && r.color || '').slice(0, 24),
    qty: Math.max(0, Math.min(999, Math.round(Number(r && r.qty) || 0))),
  })).filter((r) => r.id && r.qty);
  let previous = null;
  let problems = null;
  if (body.fix) {
    const p = body.fix.previous;
    const lines = Array.isArray(body.fix.problems) ? body.fix.problems.map(String).slice(0, 40) : [];
    const parts = p && Array.isArray(p.steps) ? p.steps.reduce((t, st) => t + (Array.isArray(st) ? st.length : 0), 0) : 0;
    if (!p || !parts || parts > 400 || JSON.stringify(p).length > 60000 || !lines.length || !lines.every((l) => L.designAI.PROBLEM_LINE.test(l))) {
      return json({ error: 'That fix request is not in the expected form.', code: 'bad_request' }, 400, cors);
    }
    previous = L.designAI.expand(p) && { title: String(p.title || '').slice(0, 40), steps: p.steps };
    problems = lines;
  }
  const size = L.designAI.SIZES.includes(body.size) ? body.size : 'max';
  const payload = L.designAI.request({ image: image || null, want: body.want, inventory, onlyMine: !!body.onlyMine, size, model }, previous, problems);
  const r = await callClaude(env, payload);
  if (!r.ok) return json({ error: r.error, code: r.code }, r.status, cors);
  const input = L.designAI.inputOf(r.data);
  if (!input) return json({ error: 'The design did not come back as a model.', code: 'bad_answer' }, 502, cors);
  return json({ input, usage: r.data.usage || null, model }, 200, cors);
}

async function callClaude(env, payload) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, status: 502, code: 'upstream_unreachable', error: 'Could not reach Claude. Try again.' };
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, status: 200, data };
  const msg = (data.error && data.error.message) || '';
  if (res.status === 400) return { ok: false, status: 400, code: 'bad_request', error: msg, retryStrict: /strict/i.test(msg) };
  if (res.status === 401 || res.status === 403) return { ok: false, status: 500, code: 'server_key', error: 'The AI server key was refused.' };
  if (res.status === 429 || res.status === 529) return { ok: false, status: 503, code: 'busy', error: 'Claude is busy right now. Try again in a minute.' };
  return { ok: false, status: 502, code: 'upstream_error', error: 'Claude could not answer (' + res.status + ').' };
}

function parseJson(content) {
  const text = (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const i = text.indexOf('{');
  return JSON.parse(text.slice(i, text.lastIndexOf('}') + 1));
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) });
}
