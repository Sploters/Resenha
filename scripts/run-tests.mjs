// Roda os testes (scripts/*-test.mjs) um por vez, cada um num processo próprio com tempo limite, e mostra um resumo.
// Usado pela verificação automática do GitHub (.github/workflows/testes.yml) e à mão:
//   node scripts/run-tests.mjs                 # todos os da lista (scripts/tests.json)
//   node scripts/run-tests.mjs ux privacy      # só os que têm esse pedaço no nome
//   node scripts/run-tests.mjs --shard 2/4     # a 2ª de 4 partes (para dividir entre máquinas)
//   node scripts/run-tests.mjs --all           # inclui os marcados como "fora" em tests.json (para descobrir o estado)
// Um por vez porque vários testes usam a mesma porta e o servidor de voz (RTC) na porta padrão.
// Sai com código 1 se algum falhar. No GitHub, o resumo vai para a página da execução ($GITHUB_STEP_SUMMARY).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), flag = (k) => args.includes(k), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const cfg = JSON.parse(fs.readFileSync(new URL('./tests.json', import.meta.url), 'utf8'));
const TIMEOUT = +(opt('--timeout') || cfg.timeoutSecs || 300) * 1000, RETRY = !flag('--no-retry');
const VALUED = ['--shard', '--timeout', '--json']; // opções que levam um valor logo depois
const words = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
let files = fs.readdirSync('scripts').filter(f => /-test\.mjs$/.test(f)).sort();
const off = cfg.off || {};
if (!flag('--all')) files = files.filter(f => !off[f.replace(/\.mjs$/, '')]);
if (words.length) files = files.filter(f => words.some(w => f.includes(w)));
const shard = opt('--shard');
if (shard) {
  // divide pelo tempo medido (tests.json → secs), para as partes terminarem juntas
  const [i, n] = shard.split('/').map(Number), parts = Array.from({ length: n }, () => ({ t: 0, f: [] }));
  for (const f of [...files].sort((a, b) => (cfg.secs?.[b.replace(/\.mjs$/, '')] || 60) - (cfg.secs?.[a.replace(/\.mjs$/, '')] || 60))) {
    const p = parts.reduce((a, b) => (b.t < a.t ? b : a)); p.f.push(f); p.t += cfg.secs?.[f.replace(/\.mjs$/, '')] || 60;
  }
  files = parts[i - 1].f.sort();
}

// navegador: cada teste usa process.env.BROWSER (sem ela, uns procuram o Edge do Windows, outros o Chromium da nuvem).
// Aqui acha o desta máquina e passa para todos: Chromium do Playwright, Chrome/Chromium do sistema (o GitHub tem o Chrome) ou o Edge
if (!process.env.BROWSER) {
  const pw = (() => { try { return fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).sort().reverse().map(d => `/opt/pw-browsers/${d}/chrome-linux64/chrome`); } catch { return []; } })();
  const cands = [...pw, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = cands.find(p => fs.existsSync(p));
  if (found) process.env.BROWSER = found;
}
console.log('Navegador: ' + (process.env.BROWSER || 'nenhum encontrado (defina BROWSER)'));

const HAS_XVFB = process.platform === 'linux' && ['/usr/bin/xvfb-run', '/usr/local/bin/xvfb-run'].some(p => fs.existsSync(p));
const tail = (s, n = 25) => s.split('\n').filter(Boolean).slice(-n).join('\n');
// resumo de uma falha: as linhas FAIL/erro da saída inteira (a verificação que falhou pode estar bem antes do fim) + o fim
const failView = (s, n = 25) => { const L = s.split('\n').filter(Boolean), last = L.slice(-n), bad = L.slice(0, -n).filter(l => /^\s*(FAIL|ERRO|EXCE|PAGEERROR)\b|\[tempo limite|--- 2ª tentativa/.test(l)); return (bad.length ? bad.join('\n') + '\n…\n' : '') + last.join('\n'); };
function runOne(f) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = '';
    // grupo de processos próprio: no tempo limite, derruba também o servidor e o navegador que o teste abriu
    // testes que abrem janela de verdade (Electron, navegador sem "headless"): no Linux sem tela, numa tela virtual (xvfb-run)
    const needX = (cfg.xvfb || []).includes(f.replace(/\.mjs$/, '')) && process.platform === 'linux' && !process.env.DISPLAY && HAS_XVFB;
    const [cmd, argv] = needX ? ['xvfb-run', ['-a', process.execPath, path.join('scripts', f)]] : [process.execPath, [path.join('scripts', f)]];
    const p = spawn(cmd, argv, { env: { ...process.env, NODE_NO_WARNINGS: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { } };
    const timer = setTimeout(() => { out += `\n[tempo limite de ${TIMEOUT / 1000} s]`; kill(); }, TIMEOUT);
    p.on('close', (code) => {
      clearTimeout(timer); kill(); // sobra de processo (servidor filho) não segura o próximo teste
      const fails = (out.match(/^\s*FAIL\b/gm) || []).length;
      resolve({ f, ok: code === 0 && !/\[tempo limite/.test(out), code, secs: Math.round((Date.now() - t0) / 1000), fails, out });
    });
  });
}

console.log(`${files.length} teste(s)${shard ? ` (parte ${shard})` : ''}, um por vez, até ${TIMEOUT / 1000} s cada\n`);
const results = [];
for (const f of files) {
  process.stdout.write(`▶ ${f} … `);
  // preparo (tests.json → prepare): dados gerados (bancos grandes do scripts/load) ou programa compilado que o teste espera
  // achar pronto. Só roda se o arquivo `needs` não existe (numa máquina nova, como a do GitHub).
  const prep = cfg.prepare?.[f.replace(/\.mjs$/, '')];
  if (prep && !fs.existsSync(prep.needs)) {
    const t0 = Date.now(), [cmd, ...a] = prep.run;
    try { execFileSync(cmd === 'node' ? process.execPath : cmd, a, { cwd: prep.cwd || '.', env: { ...process.env, ...(prep.env || {}) }, stdio: 'pipe', timeout: TIMEOUT }); process.stdout.write(`(preparo ${Math.round((Date.now() - t0) / 1000)} s) `); }
    catch (e) { const r = { f, ok: false, code: 'preparo', secs: Math.round((Date.now() - t0) / 1000), fails: 0, out: `preparo falhou: ${prep.run.join(' ')}\n${String(e.stderr || e.message)}` }; results.push(r); console.log('FALHOU no preparo'); console.log(tail(r.out).replace(/^/gm, '    ')); continue; }
  }
  let r = await runOne(f);
  // falhou: roda de novo uma vez; se passar, fica marcado como instável (aparece no resumo, mas não reprova)
  if (!r.ok && RETRY) { const r2 = await runOne(f); r = r2.ok ? { ...r2, flaky: true, first: r } : { ...r2, out: r.out + '\n--- 2ª tentativa ---\n' + r2.out }; }
  results.push(r);
  console.log(r.ok ? `ok (${r.secs} s)${r.flaky ? ' — passou na 2ª tentativa' : ''}` : `FALHOU (${r.secs} s)`);
  if (!r.ok) console.log(failView(r.out).replace(/^/gm, '    '));
}

const bad = results.filter(r => !r.ok), flaky = results.filter(r => r.flaky), total = results.reduce((a, r) => a + r.secs, 0);
console.log(`\n${results.length - bad.length} de ${results.length} passaram em ${Math.round(total / 60)} min` + (flaky.length ? `; instáveis: ${flaky.map(r => r.f).join(', ')}` : '') + (bad.length ? `\nFalharam: ${bad.map(r => r.f).join(', ')}` : ''));
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(results.map(({ out, first, ...r }) => ({ ...r, tail: tail(out, 40), firstTail: first ? tail(first.out, 40) : undefined })), null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const row = (r) => `| ${r.ok ? (r.flaky ? '⚠️ instável' : '✅') : '❌'} | \`${r.f.replace(/\.mjs$/, '')}\` | ${r.secs} s | ${r.ok ? '' : (r.fails ? r.fails + ' verificação(ões) falharam' : r.out.includes('[tempo limite') ? 'tempo limite' : 'código ' + r.code)} |`;
  const md = [`### Testes${shard ? ` — parte ${shard}` : ''}: ${results.length - bad.length} de ${results.length} passaram`, '', '| | Teste | Tempo | |', '|---|---|---|---|', ...[...bad, ...flaky, ...results.filter(r => r.ok && !r.flaky)].map(row), '',
    ...bad.map(r => `<details><summary>❌ ${r.f}</summary>\n\n\`\`\`\n${failView(r.out, 40).replace(/```/g, "'''")}\n\`\`\`\n</details>`)].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
process.exit(bad.length ? 1 : 0);
