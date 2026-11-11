// Orçamento de desempenho: compara o JSON de um relatório (perf-audit, perf-stress, perf-big) com os limites de
// scripts/perf-budget.json e, com --base, com um relatório anterior (piorou mais que 20% e mais que 20% do limite do item).
// Sai com código 1 se algo passou do limite ou piorou: dá para rodar depois de cada mudança ou na integração contínua.
// Uso: node scripts/perf-budget.mjs .testshots/perf-depois.json [--base .testshots/perf-antes.json] [--tol 20]
//      node scripts/perf-budget.mjs scripts/perf-big-depois.json --base scripts/perf-big-antes.json
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const baseFile = opt('--base'), tol = +(opt('--tol') ?? 20) / 100, files = args;
if (!files.length) { console.log('uso: node scripts/perf-budget.mjs <relatório.json>... [--base <anterior.json>] [--tol 20]'); process.exit(2); }
const budgets = JSON.parse(fs.readFileSync(new URL('./perf-budget.json', import.meta.url), 'utf8'));
const get = (o, p) => p.split('/').reduce((x, k) => (x == null ? undefined : x[k]), o);
const kindOf = (f) => Object.keys(budgets).filter(k => !k.startsWith('_')).sort((a, b) => b.length - a.length).find(k => path.basename(f).startsWith(k));
const show = (v) => (Array.isArray(v) ? v.join(' → ') : v === undefined ? '—' : JSON.stringify(v));
// valor que conta para comparar: número, ou o crescimento de um par [antes, depois]
const num = (v) => (Array.isArray(v) && v.length === 2 ? v[1] - v[0] : typeof v === 'number' ? v : null);
// piora mínima para contar (números pequenos oscilam de uma rodada para outra): 20% do limite do item, ou "noise" nele
const floor = (rule) => rule.noise ?? (Math.abs(rule.max ?? rule.grow ?? rule.min ?? 0) * 0.2);
let bad = 0;
const base = baseFile ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null;
for (const f of files) {
  const kind = kindOf(f); if (!kind) { console.log(`${f}: tipo de relatório desconhecido (prefixos: ${Object.keys(budgets).filter(k => !k.startsWith('_')).join(', ')})`); bad++; continue; }
  const r = JSON.parse(fs.readFileSync(f, 'utf8')), rows = [];
  for (const [p, rule0] of Object.entries(budgets[kind])) {
    const rule = typeof rule0 === 'number' ? { max: rule0 } : rule0, v = get(r, p);
    let st = 'ok', lim = '';
    if ('eq' in rule) { lim = '= ' + JSON.stringify(rule.eq); if (rule.eq === null ? v != null : v !== rule.eq) st = 'ESTOUROU'; }
    else if (v === undefined) st = 'faltou';
    else if ('grow' in rule) { lim = `cresce ≤ ${rule.grow}`; if (num(v) > rule.grow) st = 'ESTOUROU'; }
    else {
      if ('max' in rule) { lim = '≤ ' + rule.max; if (v > rule.max) st = 'ESTOUROU'; }
      if ('min' in rule) { lim += (lim ? ', ' : '') + '≥ ' + rule.min; if (v < rule.min) st = 'ESTOUROU'; }
    }
    // comparado com o relatório anterior: pior que tol e mais que a oscilação normal do item (floor)
    let cmp = '';
    if (base && !('eq' in rule)) {
      const a = num(get(base, p)), b = num(v);
      if (a != null && b != null) {
        const worse = 'min' in rule && !('max' in rule) ? a - b : b - a;
        cmp = a === 0 ? (b === 0 ? '=' : `+${b}`) : `${b >= a ? '+' : ''}${Math.round((b - a) / Math.abs(a) * 100)}%`;
        if (st === 'ok' && worse > Math.max(1, Math.abs(a) * tol, floor(rule))) st = 'PIOROU';
      }
    }
    if (st !== 'ok' && st !== 'faltou') bad++;
    rows.push([st, p, show(v), lim, base ? `${show(get(base, p))} (${cmp || '—'})` : '']);
  }
  console.log(`\n${f}  [${kind}]${base ? `  comparado com ${baseFile}` : ''}`);
  const w = [0, 1, 2, 3].map(i => Math.max(...rows.map(x => String(x[i]).length)));
  for (const x of rows) console.log(`  ${x[0].padEnd(w[0])}  ${x[1].padEnd(w[1])}  ${String(x[2]).padStart(w[2])}  ${x[3].padEnd(w[3])}  ${x[4]}`);
}
console.log(bad ? `\n${bad} item(ns) fora do orçamento` : '\ntudo dentro do orçamento');
process.exit(bad ? 1 : 0);
