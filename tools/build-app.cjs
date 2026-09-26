// Bundles app.html and its scripts into single self-contained pages.
//   node tools/build-app.cjs
//   -> dist/app.html            full page, open anywhere or host on GitHub Pages
//   -> dist/app.artifact.html   the same content without the html/head/body wrapper,
//                               for publishing as a claude.ai artifact
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const start = src.indexOf('<!-- @inline-start -->');
const end = src.indexOf('<!-- @inline-end -->');
if (start < 0 || end < 0) throw new Error('app.html: inline markers missing');

const scripts = [...src.slice(start, end).matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const inlined = scripts
  .map((s) => `<script>/* ${s} */\n${fs.readFileSync(path.join(root, s), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .join('\n');
const full = src.slice(0, start) + inlined + src.slice(end + '<!-- @inline-end -->'.length);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/app.html'), full);

// Artifact form: head content (title, fonts, style) then body content, no wrapper tags.
const head = full.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
const body = full.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync(path.join(root, 'dist/app.artifact.html'), head.trim() + '\n' + body.trim() + '\n');

const kb = (f) => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0) + ' KB';
console.log(`dist/app.html ${kb('dist/app.html')}, dist/app.artifact.html ${kb('dist/app.artifact.html')}, ${scripts.length} scripts inlined`);
