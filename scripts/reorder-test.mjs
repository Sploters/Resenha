// Segurar e arrastar: abas de canais, servidores e conversas fixadas trocam de lugar; imagens não arrastam mais
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3241, BASE = `http://localhost:${PORT}`, SHOTS = process.env.SHOTS || '.testshots';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
fs.rmSync('.testdata-ro', { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-ro' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const reg = async (name) => (await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'Teste.senha-123' }) }).then(r => r.json())).token;
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
async function drag(P, sel, dx, dy) {
  const r = await P.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await P.mouse.move(r.x, r.y); await P.mouse.down();
  for (let i = 1; i <= 12; i++) { await P.mouse.move(r.x + dx * i / 12, r.y + dy * i / 12); await sleep(16); }
  await P.mouse.up(); await sleep(300);
}
try {
  const eu = await reg('eu'), ana = await reg('ana'), bia = await reg('bia');
  for (const n of ['Alfa', 'Beta', 'Gama']) await api(eu, 'POST', '/guilds', { name: n });
  const ctx = await browser.createBrowserContext(); const P = await ctx.newPage();
  await P.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.goto(BASE); await P.evaluate((t) => localStorage.setItem('lc_token', t), eu); await P.goto(BASE);
  await P.waitForSelector('#rail .rail-wrap.railg'); await sleep(800);
  const order = () => P.$$eval('#rail .railg', ws => ws.map(w => w.dataset.tip));
  ok((await order()).join() === 'Alfa,Beta,Gama', 'ordem inicial', await order());
  await drag(P, '#rail .railg .rail-item', 0, 0); // sem mover = clique normal
  await drag(P, '#rail .railg[data-tip="Alfa"] .rail-item', 0, 130); // Alfa para depois de Gama
  ok((await order()).join() === 'Beta,Gama,Alfa', 'servidor arrastado para baixo', await order());
  ok(await P.evaluate(() => JSON.stringify(window.__lc.S.prefs.guildOrder?.length)) === '3', 'ordem salva nas preferências');
  await P.reload(); await P.waitForSelector('#rail .railg'); await sleep(800);
  ok((await order()).join() === 'Beta,Gama,Alfa', 'ordem continua depois de recarregar', await order());
  ok(await P.$$eval('#rail img', is => is.every(i => i.getAttribute('draggable') === 'false')), 'imagens da barra não arrastam');
  // conversas fixadas
  const me = await P.evaluate(() => window.__lc.S.me.id);
  const ids = [];
  for (const [n, t] of [['ana', ana], ['bia', bia]]) { await api(eu, 'POST', '/relationships', { username: n }); await api(t, 'PUT', '/relationships/' + me, {}); }
  await sleep(800);
  ids.push(...await P.evaluate(() => [...window.__lc.S.rels.keys()]));
  for (const id of ids) await api(eu, 'POST', '/dms', { user_id: id });
  await P.evaluate((ids) => { window.__lc.S.prefs.pinnedDMs = ids; window.__lc.savePrefs(); }, ids); await sleep(1500);
  await P.reload(); await P.waitForSelector('#rail .raildm'); await sleep(800);
  const dms = () => P.$$eval('#rail .raildm', ws => ws.map(w => w.dataset.tip));
  const d0 = await dms(); ok(d0.length === 2, 'duas conversas fixadas', d0);
  await drag(P, '#rail .raildm .rail-item', 0, 60);
  const d1 = await dms(); ok(d1.join() === [d0[1], d0[0]].join(), 'conversa fixada trocou de lugar', d1);
  await drag(P, '#rail .raildm .rail-item', 0, 400); // não passa para o grupo dos servidores
  ok((await order()).join() === 'Beta,Gama,Alfa' && (await P.$$eval('#rail .raildm', w => w.length)) === 2, 'grupos não se misturam');
  // abas
  await P.evaluate(() => { document.querySelector('#chtabs .ct-add').click(); document.querySelector('#chtabs .ct-add').click(); }); await sleep(300);
  await P.evaluate(() => window.__lc.go('@me')); await sleep(400);
  const tabs = () => P.$$eval('#chtabs .ct-tab', ts => ts.map(t => t.dataset.id));
  const t0 = await tabs(); ok(t0.length === 3, 'três abas', t0);
  const w = await P.$eval('#chtabs .ct-tab', e => e.offsetWidth);
  await drag(P, '#chtabs .ct-tab', w * 2.2, 0);
  const t1 = await tabs(); ok(t1.join() === [t0[1], t0[2], t0[0]].join(), 'aba arrastada para o fim', t1);
  ok(JSON.parse(await P.evaluate(() => localStorage.lc_tabs)).tabs.map(t => String(t.id)).join() === t1.join(), 'ordem das abas salva');
  // painel de DM: sem linha no rodapé; botão segue o tema
  await P.evaluate(() => document.documentElement.dataset.theme = 'darker');
  await P.evaluate(() => document.querySelector('#rail .raildm .rail-item').click()); await sleep(800);
  const f = await P.evaluate(() => { const ft = document.querySelector('#dmpanel .dmp-foot'), b = document.querySelector('#dmpanel .dmp-full'); return ft && { border: getComputedStyle(ft).borderTopWidth, bg: getComputedStyle(b).backgroundColor }; });
  ok(f && f.border === '0px' && f.bg !== 'rgb(78, 80, 88)', 'rodapé sem linha e botão no tom do tema', f);
  await P.screenshot({ path: `${SHOTS}/ro-01.png` });
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync('.testdata-ro', { recursive: true, force: true });
console.log(fails ? `${fails} falha(s)` : 'tudo ok'); process.exit(fails ? 1 : 0);
