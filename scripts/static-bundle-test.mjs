// Pacotes da interface (server/bundle.mjs + server/static.js): a abertura em poucos arquivos em vez de ~130 módulos.
// - a página aponta para app.<hash>.js, um CSS só (ui.<hash>.css) e o modulepreload só dos pedaços da abertura;
// - os pacotes respondem com cache longo; a abertura tem poucos arquivos; não sobra import de módulo solto (./x.js);
// - num navegador: o app abre só com os pacotes (nenhum módulo solto pedido) e o __lc.import pega a MESMA instância do
//   state.js que o app usa;
// - deploy que muda um módulo (SIGHUP): o pacote dele troca de nome; os da versão anterior continuam servidos
//   (página aberta antes da atualização abrindo uma tela sob demanda).
// Uso: node scripts/static-bundle-test.mjs   (PORT=3438)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
const PORT = +(process.env.PORT || 3438), RTC = process.env.RTC_PORT || '41438', DIR = path.resolve('.testdata-staticbundle'), PUB = path.join(DIR, 'public');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
fs.cpSync('public', PUB, { recursive: true });
let log = '';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, STATIC_BUNDLE: '', PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, PUBLIC_DIR: PUB, RTC_PORT: RTC, RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
process.on('exit', () => { try { srv.kill(); } catch { } });
const BASE = `http://localhost:${PORT}`;
if (!await until(() => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000)) { console.log('servidor não subiu'); process.exit(1); }
const HASHED = /^[\w-]+\.[A-Z0-9]{8}\.(js|css)$/;
const page = async () => {
  const html = await (await fetch(BASE + '/')).text();
  const meta = (n) => new RegExp(`<meta name="${n}" content="([^"]*)">`).exec(html)?.[1];
  return {
    html, ui: meta('lc-ui'), mods: meta('lc-mods'), files: (meta('lc-files') || '').split(' ').filter(Boolean),
    app: /<script type="module" src="\/([^"]+)">/.exec(html)?.[1],
    css: [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)">/g)].map(m => m[1]),
    pre: [...html.matchAll(/<link rel="modulepreload" href="\/([^"]+)">/g)].map(m => m[1]),
  };
};
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await page();
  ok(HASHED.test(a.app || '') && a.app.startsWith('app.'), 'a página carrega o pacote app.<hash>.js', a.app);
  ok(a.css.length === 1 && HASHED.test(a.css[0]), 'um CSS só (ui.<hash>.css) no lugar dos vários', a.css);
  ok(a.pre.length >= 1 && a.pre.every(f => HASHED.test(f)), 'modulepreload só de pacotes', a.pre.length);
  ok(a.pre.length + 2 <= 25, `abertura com poucos arquivos (${a.pre.length + 2})`);
  ok(/^\/lc-mods\.[A-Z0-9]{8}\.js$/.test(a.mods || '') && a.files.includes(a.app) && a.files.includes(a.css[0]), 'lc-mods e lc-files na página', { mods: a.mods, files: a.files.length });
  const r = await fetch(`${BASE}/${a.app}`);
  ok(r.status === 200 && /immutable/.test(r.headers.get('cache-control') || '') && /javascript/.test(r.headers.get('content-type') || ''), 'pacote: 200, JS, cache longo');
  const rc = await fetch(`${BASE}/${a.css[0]}`), cssText = await rc.text();
  ok(rc.status === 200 && /text\/css/.test(rc.headers.get('content-type') || '') && cssText.length > 50000, 'CSS junto: 200, text/css, com o conteúdo dos arquivos', cssText.length);
  // nenhum import de módulo solto dentro dos pacotes da abertura (seria uma segunda instância)
  const loose = [];
  for (const f of [a.app, ...a.pre]) { const t = await (await fetch(`${BASE}/${f}`)).text(); for (const m of t.matchAll(/(?:from|import)\s*\(?\s*["']\.\/([\w.-]+\.js)["']/g)) if (!HASHED.test(m[1])) loose.push(`${f} -> ${m[1]}`); }
  ok(!loose.length, 'pacotes não importam módulos soltos', loose.slice(0, 5));

  // no navegador: abre só com pacotes, sem erro, e o __lc.import é a mesma instância do app
  const p = await bA.newPage(); const errs = [], reqs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('request', q => { const u = new URL(q.url()); if (/\.js$/.test(u.pathname) && u.origin === BASE) reqs.push(u.pathname.slice(1)); });
  await p.goto(BASE); await sleep(2500);
  const looseReq = reqs.filter(f => !HASHED.test(f) && !/worker|worklet|^sw\.js$|^vendor\//.test(f));
  ok(!errs.length, 'a página abre sem erro', errs.slice(0, 3));
  ok(!looseReq.length, 'nenhum módulo solto baixado na abertura', looseReq.slice(0, 8));
  const same = await p.evaluate(async () => { const st = await window.__lc.import('state.js'); return st.S === window.__lc.S; }).catch(e => 'erro: ' + e.message);
  ok(same === true, '__lc.import("state.js") devolve a mesma instância que o app usa', same);
  const auth = await p.evaluate(async () => typeof (await window.__lc.import('auth.js')) === 'object').catch(e => 'erro: ' + e.message);
  ok(auth === true, '__lc.import de uma tela sob demanda funciona', auth);

  // deploy: muda um módulo folha só de uma tela sob demanda; o resto dos pacotes mantém o nome
  const before = new Set(a.files);
  fs.appendFileSync(path.join(PUB, 'radar.js'), '\nexport const __teste = 1;\n');
  srv.kill('SIGHUP');
  ok(await until(async () => (await page()).ui !== a.ui), 'SIGHUP: versão nova');
  const b = await page();
  const kept = b.files.filter(f => before.has(f)), novos = b.files.filter(f => !before.has(f));
  // (o hash de quem importa inclui o nome do importado, então parte dos pacotes troca junto: uma vez por deploy)
  const radar = (x) => x.files.find(f => f.startsWith('radar.'));
  ok(radar(b) && radar(b) !== radar(a) && novos.length < b.files.length, 'o pacote mexido troca de nome', { novos: novos.length, mantidos: kept.length });
  const gone = [...before].filter(f => !b.files.includes(f));
  const old = await Promise.all(gone.map(f => fetch(`${BASE}/${f}`).then(x => x.status)));
  ok(gone.length >= 1 && old.every(s => s === 200), 'pacotes da versão anterior continuam servidos', { gone, old });
} catch (e) { ok(false, 'erro: ' + e.message); }
await bA.close(); srv.kill();
if (fails) console.log('\n--- log do servidor ---\n' + log.slice(-3000));
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
