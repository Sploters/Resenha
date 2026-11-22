// Versão por arquivo na entrega da interface (server/static.js): num deploy só muda o endereço (?v=) do que mudou e de quem
// o importa; o resto fica igual e sai do cache do navegador/service worker sem baixar de novo. Sem navegador.
// - cada import dentro de um módulo aponta para a mesma versão que a página avisa no modulepreload (uma instância só);
// - mudar um módulo folha troca a versão dele e a dos que o importam, e mais nada; o CSS não mexido fica igual;
// - a versão geral (<meta lc-ui>) muda e o app.js usa ela; a versão anterior do arquivo mudado continua servida (página
//   aberta antes da atualização); versão desconhecida não ganha cache longo.
// Uso: node scripts/static-vers-test.mjs   (PORT=3437)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
const PORT = +(process.env.PORT || 3437), RTC = process.env.RTC_PORT || '41437', DIR = path.resolve('.testdata-staticvers'), PUB = path.join(DIR, 'public');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
fs.cpSync('public', PUB, { recursive: true });
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, PUBLIC_DIR: PUB, RTC_PORT: RTC, RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
const BASE = `http://localhost:${PORT}`;
if (!await until(() => fetch(BASE + '/api/server-info').then(() => true, () => false), 30000)) { console.log('servidor não subiu'); process.exit(1); }
const page = async () => {
  const html = await (await fetch(BASE + '/')).text();
  const urls = new Map([...html.matchAll(/(?:href|src)="\/([\w.-]+\.(?:js|css))\?v=(\w+)"/g)].map(m => [m[1], m[2]]));
  return { html, urls, ui: /name="lc-ui" content="(\w+)"/.exec(html)?.[1] };
};
try {
  const a = await page();
  ok(a.urls.size > 50 && a.ui, 'página com os módulos e a versão geral', { arquivos: a.urls.size, ui: a.ui });
  ok(a.urls.get('app.js') === a.ui, 'app.js usa a versão geral');
  ok(new Set([...a.urls.values()]).size > 20, 'versões diferentes por arquivo', new Set([...a.urls.values()]).size);
  // imports dentro dos módulos = versões da página
  let bad = []; for (const f of ['chat.js', 'gateway.js', 'state.js', 'voice.js']) {
    const src = await (await fetch(`${BASE}/${f}?v=${a.urls.get(f)}`)).text();
    for (const m of src.matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)\?v=(\w+)["']/g)) if (a.urls.has(m[1]) && a.urls.get(m[1]) !== m[2]) bad.push(`${f} -> ${m[1]}`);
  }
  ok(!bad.length, 'imports dos módulos apontam para a mesma versão do modulepreload', bad.slice(0, 5));
  const lazy = /name="lc-lazy" content="([^"]*)"/.exec(a.html)?.[1] || '';
  const sv = /settings\.js:(\w+)/.exec(lazy)?.[1];
  ok(sv && (await fetch(`${BASE}/settings.js?v=${sv}`)).headers.get('cache-control')?.includes('immutable'), 'tela sob demanda (settings.js) com versão na página (lc-lazy) e cache longo', sv);
  const r1 = await fetch(`${BASE}/util.js?v=${a.urls.get('util.js')}`);
  ok(/immutable/.test(r1.headers.get('cache-control') || ''), 'versão atual: cache longo');
  const r2 = await fetch(`${BASE}/util.js?v=0000000000`);
  ok(!/immutable/.test(r2.headers.get('cache-control') || ''), 'versão desconhecida: sem cache longo');

  // deploy que muda um módulo folha (o mais importado por um só)
  const leaf = 'changelog.js', oldLeaf = await (await fetch(`${BASE}/${leaf}?v=${a.urls.get(leaf)}`)).text();
  fs.appendFileSync(path.join(PUB, leaf), '\n// versão nova (teste)\n');
  srv.kill('SIGHUP');
  ok(await until(async () => (await page()).ui !== a.ui), 'SIGHUP: versão geral nova');
  const b = await page();
  const changed = [...a.urls].filter(([f, v]) => b.urls.get(f) !== v).map(([f]) => f);
  const total = a.urls.size;
  ok(changed.includes(leaf) && changed.includes('app.js'), 'o módulo mudado e o app.js trocam de versão', changed);
  ok(changed.length < total / 3, `só o que mudou e quem o importa trocam de endereço (${changed.length} de ${total})`, changed);
  ok(!changed.some(f => f.endsWith('.css')), 'CSS não mexido continua com o mesmo endereço');
  const rOld = await fetch(`${BASE}/${leaf}?v=${a.urls.get(leaf)}`);
  ok(rOld.status === 200 && /immutable/.test(rOld.headers.get('cache-control') || '') && await rOld.text() === oldLeaf, 'versão anterior do arquivo mudado continua servida igual');
  const same = [...b.urls.keys()].find(f => !changed.includes(f) && f.endsWith('.js'));
  const rSame = await fetch(`${BASE}/${same}?v=${b.urls.get(same)}`);
  ok(/immutable/.test(rSame.headers.get('cache-control') || ''), 'arquivo sem mudança: mesmo endereço, cache longo', same);
} catch (e) { ok(false, 'erro: ' + e.message); }
srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
