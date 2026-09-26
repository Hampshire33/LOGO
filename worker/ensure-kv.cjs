// Creates (once) the KV namespace the AI server uses for daily limits, and writes its id into
// wrangler.toml for this deploy. Runs in the deploy workflow with CLOUDFLARE_API_TOKEN set.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const TITLE = 'pilebuild-ai-LIMITS';
const run = (cmd) => execSync(cmd, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const list = () => {
  const out = run('npx --yes wrangler@4 kv namespace list');
  return JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
};
let ns = list().find((n) => n.title === TITLE || n.title.endsWith('LIMITS'));
if (!ns) {
  run('npx --yes wrangler@4 kv namespace create LIMITS');
  ns = list().find((n) => n.title === TITLE || n.title.endsWith('LIMITS'));
}
if (!ns) {
  console.log('No KV namespace; the server will run without daily caps.');
  process.exit(0);
}
const file = path.join(__dirname, 'wrangler.toml');
const toml = fs.readFileSync(file, 'utf8').replace(/# \[\[kv_namespaces\]\][\s\S]*$/, `[[kv_namespaces]]\nbinding = "LIMITS"\nid = "${ns.id}"\n`);
fs.writeFileSync(file, toml);
console.log('KV namespace for limits:', ns.id);
