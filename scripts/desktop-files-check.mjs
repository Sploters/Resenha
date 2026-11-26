// Confere, antes de montar o instalador, que todo arquivo do app desktop usado a partir do main.js (require('./x') e
// páginas .html) está na lista build.files do desktop/package.json. Arquivo fora da lista fica fora do app.asar e o app
// instalado nem abre ("Cannot find module './helper'", versão 1.0.40).
//   node scripts/desktop-files-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')), files = pkg.build.files;
// começa pelo "main" do pacote (boot.js, que carrega o main.js) e pelo main.js
const seen = new Set(), todo = [...new Set(['main.js', pkg.main || 'main.js'])], missing = new Set();
while (todo.length) {
  const f = todo.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  if (!files.includes(f)) missing.add(f);
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
    let p = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
    if (!p.endsWith('.js') && fs.existsSync(path.join(dir, p + '.js'))) p += '.js';
    if (!fs.existsSync(path.join(dir, p))) { console.error(`${f} pede ${m[1]}, que não existe em desktop/`); process.exit(1); }
    todo.push(p);
  }
  for (const m of src.matchAll(/['"]([\w-]+\.html)['"]/g)) if (fs.existsSync(path.join(dir, m[1])) && !files.includes(m[1])) missing.add(m[1]);
}
if (missing.size) {
  console.error('Faltam na lista build.files de desktop/package.json (ficariam fora do app instalado):\n  ' + [...missing].join('\n  '));
  process.exit(1);
}
console.log(`ok: ${seen.size} arquivos .js do app estão em build.files`);
