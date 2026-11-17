// GIFs: serviço de GIFs simulado (formato da KLIPY) -> servidor (busca, em alta, favoritos, "do grupo") -> seletor no
// campo de mensagem, GIF na mensagem (sem o link), estrela de favorito, modo leve (parado até passar o mouse).
// Uso: node scripts/gifs-test.mjs  (SHOTS=1 salva capturas em .testshots/gifs)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
const PORT = 3247, MOCK = 3248, BASE = `http://localhost:${PORT}`, OUT = '.testshots/gifs', MEDIA = `http://127.0.0.1:${MOCK}/media`;
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata16', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync('.testdata-gif', { recursive: true });
for (const [n, src] of [['a', 'testsrc=size=200x120:rate=10'], ['b', 'testsrc2=size=200x150:rate=10']]) if (!fs.existsSync(`.testdata-gif/${n}.gif`)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-t', '1', `.testdata-gif/${n}.gif`]);
// serviço simulado: /api/v1/<chave>/gifs/{trending,search}
const seen = [];
const item = (i, q) => { const f = i % 2 ? 'b' : 'a', w = 200, hh = f === 'a' ? 120 : 150, v = (s) => ({ gif: { url: `${MEDIA}/${f}.gif?i=${i}&s=${s}`, width: w, height: hh, size: 1 }, webp: { url: `${MEDIA}/${f}.gif?i=${i}&s=${s}&w`, width: w, height: hh } });
  return { id: i, slug: 'g' + i, title: (q || 'em alta') + ' ' + i, type: 'gif', file: { hd: v('hd'), md: v('md'), sm: v('sm'), xs: v('xs') } }; };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/media/')) { res.writeHead(200, { 'content-type': 'image/gif', 'access-control-allow-origin': '*' }); return res.end(fs.readFileSync('.testdata-gif/' + u.pathname.split('/').pop())); }
  const m = u.pathname.match(/^\/api\/v1\/([^/]+)\/gifs\/(trending|search)$/); if (!m) { res.statusCode = 404; return res.end(); }
  seen.push({ key: m[1], kind: m[2], q: u.searchParams.get('q'), page: +u.searchParams.get('page'), cust: u.searchParams.get('customer_id'), locale: u.searchParams.get('locale') });
  if (m[1] !== 'chave-teste') { res.statusCode = 401; return res.end('{}'); }
  const page = +u.searchParams.get('page') || 1, q = u.searchParams.get('q');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ result: true, data: { data: Array.from({ length: 24 }, (_, k) => item((page - 1) * 24 + k, q)), current_page: page, per_page: 24, has_next: page < 3 } }));
}).listen(MOCK);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata16', RTC: '0', KLIPY_API_KEY: 'chave-teste', KLIPY_API_BASE: `http://127.0.0.1:${MOCK}` }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  // ---------- API ----------
  ok((await call(a.tok, 'GET', '/gifs/meta')).provider === 'klipy', 'servidor detecta a chave da KLIPY');
  const t1 = await call(a.tok, 'GET', '/gifs/trending');
  ok(t1.gifs?.length === 24 && t1.more && /s=md/.test(t1.gifs[0].url) && /s=sm/.test(t1.gifs[0].preview) && t1.gifs[0].w === 200, 'em alta: 24 GIFs com o arquivo médio para mandar e o pequeno para a grade', t1.gifs?.[0]);
  const s1 = await call(a.tok, 'GET', '/gifs/search?q=gato&page=2');
  const req = seen.find(x => x.kind === 'search');
  ok(s1.gifs?.[0]?.title === 'gato 24' && req.q === 'gato' && req.page === 2 && req.locale === 'pt', 'busca repassa o termo, a página e o idioma', req);
  ok(req.cust && req.cust !== a.id && req.cust.length === 24, 'o serviço recebe um id anônimo, não o id da pessoa', req.cust);
  const n = seen.length; await call(a.tok, 'GET', '/gifs/search?q=gato&page=2');
  ok(seen.length === n, 'buscas repetidas vêm do cache (não gastam a cota do serviço)');
  ok((await call(a.tok, 'PUT', '/gifs/favs', { url: 'javascript:alert(1).gif' })).status === 400, 'favorito com endereço inválido é recusado');
  // ---------- seletor e mensagem ----------
  const page = async (tok) => { const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 }); p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; }); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; };
  const A = await page(a.tok), B = await page(b.tok);
  const ch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await sleep(500); }
  await A.click('#composer .extras-btn'); await A.click('.cx-pop .cx-opt[title="GIF"]'); await A.waitForSelector('.gifpicker .gtile img', { timeout: 8000 });
  await sleep(800);
  const hm = await A.evaluate(() => ({ tiles: [...document.querySelectorAll('.gifpicker .gtile')].map(b => b.textContent), covers: document.querySelectorAll('.gifpicker .gtile img').length, foot: document.querySelector('.gifpicker .gfoot').textContent }));
  ok(hm.tiles.slice(0, 4).join('|') === 'Favoritos|GIFs em alta|Do grupo|Feliz' && hm.tiles.length === 23 && hm.covers === 21 && /KLIPY/.test(hm.foot), 'seletor abre na tela inicial: Favoritos, Em alta, Do grupo e as categorias com capa', hm);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/00-inicio.png` });
  const nCovers = seen.length; await A.keyboard.press('Escape'); await sleep(300);
  await A.click('#composer .extras-btn'); await A.click('.cx-pop .cx-opt[title="GIF"]'); await A.waitForSelector('.gifpicker .gtile img', { timeout: 8000 }); await sleep(500);
  ok(seen.length === nCovers, 'abrir de novo não consulta o serviço (capas em cache)', seen.length - nCovers);
  ok((await call(b.tok, 'GET', '/gifs/categories')).cats?.length === 20 && seen.length === nCovers, 'capas são do servidor todo (outra pessoa também não gasta a cota)');
  await A.evaluate(() => [...document.querySelectorAll('.gifpicker .gtile')].find(x => x.textContent === 'Rindo').click()); await A.waitForSelector('.gifpicker .gcard img', { timeout: 8000 }); await sleep(500);
  const ct = await A.evaluate(() => ({ title: document.querySelector('.gifpicker .gtitle2')?.textContent, first: document.querySelector('.gifpicker .gcard').title }));
  ok(ct.title === 'Rindo' && /^rindo/.test(ct.first), 'categoria abre a busca dela com o nome no cabeçalho', ct);
  await A.focus('.gifpicker input'); await A.keyboard.press('Escape'); await sleep(300);
  ok(await A.evaluate(() => !!document.querySelector('.gifpicker .gtile') && !document.querySelector('.gifpicker .ghome').hidden), 'Esc numa lista volta para a tela inicial (sem fechar)');
  await A.evaluate(() => [...document.querySelectorAll('.gifpicker .gtile')].find(x => x.textContent === 'GIFs em alta').click()); await A.waitForSelector('.gifpicker .gcard img', { timeout: 8000 });
  await sleep(800);
  const pk = await A.evaluate(() => ({ title: document.querySelector('.gifpicker .gtitle2')?.textContent, cards: document.querySelectorAll('.gifpicker .gcard').length }));
  ok(pk.title === 'GIFs em alta' && pk.cards === 24, 'bloco "GIFs em alta" abre a grade', pk);
  if (process.env.SHOTS) await A.screenshot({ path: `${OUT}/01-seletor.png` });
  await A.evaluate(() => { const g = document.querySelector('.gifpicker .ggrid'); g.scrollTop = g.scrollHeight; }); await sleep(1200);
  ok(await A.evaluate(() => document.querySelectorAll('.gifpicker .gcard').length) === 48, 'rolar até o fim carrega mais');
  await A.type('.gifpicker input', 'gato'); await sleep(1200);
  ok(/^gato/.test(await A.evaluate(() => document.querySelector('.gifpicker .gcard').title)), 'digitar busca os GIFs');
  await A.evaluate(() => document.querySelector('.gifpicker .gcard').click()); await sleep(1200);
  const msg = await B.evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg')].at(-1); return { gif: !!m.querySelector('.gifmsg img'), text: m.querySelector('.body')?.innerText.trim(), src: m.querySelector('.gifmsg img')?.src }; });
  ok(msg.gif && msg.text === 'GIF' && /s=md/.test(msg.src), 'quem recebe vê só o GIF animado (sem o link)', msg);
  if (process.env.SHOTS) await B.screenshot({ path: `${OUT}/02-mensagem.png` });
  // favoritar pela mensagem (bruno) e ver na aba Favoritos
  await B.evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg')].at(-1); m.querySelector('.gstar').click(); }); await sleep(800);
  const fb = await call(b.tok, 'GET', '/gifs/favs');
  ok(fb.gifs?.length === 1 && fb.gifs[0].url === msg.src, 'estrela na mensagem guarda nos favoritos de quem clicou');
  ok((await call(a.tok, 'GET', '/gifs/favs')).gifs.length === 0, 'favoritos são de cada pessoa');
  await B.click('#composer .extras-btn'); await B.click('.cx-pop .cx-opt[title="GIF"]'); await B.waitForSelector('.gifpicker .gtile', { timeout: 8000 }); await sleep(500);
  ok(await B.evaluate(() => /s=md/.test(document.querySelector('.gifpicker .gtile img')?.src || '')), 'bloco Favoritos tem o último GIF favoritado de capa');
  await B.evaluate(() => [...document.querySelectorAll('.gifpicker .gtile')].find(x => x.textContent === 'Favoritos').click()); await sleep(800);
  ok(await B.evaluate(() => document.querySelectorAll('.gifpicker .gcard').length) === 1, 'aba Favoritos mostra o GIF');
  await B.evaluate(() => document.querySelector('.gifpicker .gback').click()); await sleep(300);
  await B.evaluate(() => [...document.querySelectorAll('.gifpicker .gtile')].find(x => x.textContent === 'Do grupo').click()); await sleep(800);
  const grp = await call(b.tok, 'GET', '/gifs/group');
  ok(await B.evaluate(() => document.querySelectorAll('.gifpicker .gcard').length) === 1, '"Do grupo" mostra os GIFs mandados nos chats que a pessoa vê', grp);
  if (process.env.SHOTS) await B.screenshot({ path: `${OUT}/03-favoritos.png` });
  await B.keyboard.press('Escape');
  ok((await call(c.tok, 'GET', '/gifs/group')).gifs.length === 0, '"Do grupo" não mostra GIFs de servidores de que a pessoa não participa');
  // modo leve: parado até passar o mouse
  await B.evaluate(() => { window.__lc.S.prefs.lightMode = true; }); await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id); await sleep(300);
  await B.evaluate(() => window.__lc.go('@me')); await sleep(300); await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id);
  await B.waitForFunction(() => document.querySelector('#msgs .gifmsg.paused'), { timeout: 6000 }).catch(() => { });
  const lp = await B.evaluate(() => { const el = document.querySelector('#msgs .gifmsg'); return { paused: el?.classList.contains('paused'), still: el?.querySelector('img').src.startsWith('data:') }; });
  ok(lp.paused && lp.still, 'modo leve: GIF parado (um quadro) com a etiqueta "GIF"', lp);
  await B.hover('#msgs .gifmsg'); await sleep(300);
  ok(await B.evaluate(() => !document.querySelector('#msgs .gifmsg').classList.contains('paused')), 'passar o mouse anima');
} catch (e) { console.log('ERRO', e); fails++; }
finally { await browser.close(); srv.kill(); mock.close(); console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); setTimeout(() => process.exit(fails ? 1 : 0), 300); }
