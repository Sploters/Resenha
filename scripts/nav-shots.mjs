// Capturas da navegação (Início, Jogos, servidor, auditoria). PREFIX=before|after → .testshots/nav/
// Uso: PREFIX=after node scripts/nav-shots.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT_SHOT || 3293), BASE = `http://localhost:${PORT}`, DATA = './.testdata-navshots', OUT = '.testshots/nav', PREFIX = process.env.PREFIX || 'before';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HEALTH_DISK_PCT: '0', HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id, n }; };
const U = {}; for (const n of ['eu', 'ana', 'beto', 'carla']) U[n] = await reg(n);
for (const n of ['ana', 'beto', 'carla']) { await call(U.eu.tok, 'POST', '/relationships', { username: n }); await call(U[n].tok, 'PUT', '/relationships/' + U.eu.id, {}); }
const g = await call(U.eu.tok, 'POST', '/guilds', { name: 'Turma' }); const code = (await call(U.eu.tok, 'POST', `/guilds/${g.id}/invites`)).code;
for (const n of ['ana', 'beto', 'carla']) await call(U[n].tok, 'POST', '/invites/' + code);
const text = await call(U.eu.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'resenha', type: 0 });
if (text) {
  const m1 = await call(U.ana.tok, 'POST', `/channels/${text.id}/messages`, { content: 'bora jogar valorant hoje às 21h?' });
  await call(U.ana.tok, 'PATCH', `/channels/${text.id}/messages/${m1.id}`, { content: 'bora jogar valorant hoje às 22h? (mudou o horário)' });
  const m2 = await call(U.beto.tok, 'POST', `/channels/${text.id}/messages`, { content: 'mensagem com palavrão que vai sumir' });
  await call(U.eu.tok, 'DELETE', `/channels/${text.id}/messages/${m2.id}`);
  const m3 = await call(U.carla.tok, 'POST', `/channels/${text.id}/messages`, { content: 'opa, mandei no canal errado' });
  await call(U.carla.tok, 'DELETE', `/channels/${text.id}/messages/${m3.id}`);
}
const ad = await call(U.ana.tok, 'POST', '/lfg/posts', { game: 'valorant', mode: process.env.LFG_MODE || 'Competitivo', slots: 2, rank_min: '', rank_max: '', roles: [], note: 'ranqueada de leve' });
if (!ad.id) console.log('anúncio:', ad);
await call(U.ana.tok, 'PUT', '/lfg/profile/valorant', { ign: 'ana#BR1', roles: [] });
await call(U.eu.tok, 'PUT', '/lfg/profile/valorant', { ign: 'eu#BR1', roles: [] });
const dm = await call(U.eu.tok, 'POST', '/dms', { user_id: U.ana.id });
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: +(process.env.W || 1440), height: +(process.env.H || 900), deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; localStorage.lc_seen_changelog = '9999'; }, U.eu.tok);
await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); await sleep(1500);
const shot = async (name) => { await sleep(1200); await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` }); console.log('shot', name); };
try {
  await p.evaluate(() => window.__lc.go('@me')); await shot('1-amigos');
  for (const k of (process.env.TABS || 'lfg,discover').split(',')) { await p.evaluate((k) => window.__lc.go('@me', k), k); await shot('2-' + k); }
  await p.evaluate((id) => window.__lc.go(id), g.id); await shot('3-servidor');
  await p.hover('#side-list .st-btn.evrow'); await shot('3b-servidor-hover');
  if (dm.id) { await p.evaluate((id) => window.__lc.go('@me', id), dm.id); await shot('6-dm');
    await p.evaluate(() => document.querySelector('.pt-btn')?.click()); await sleep(1500); await shot('7-jogar-juntos'); await p.keyboard.press('Escape'); await sleep(400); }
  // Registro de auditoria › Mensagens (menu do servidor)
  await p.evaluate(async (gid) => { const m = await import('/mod.js'); m.auditModal(gid); }, g.id); await sleep(800);
  await p.evaluate(() => [...document.querySelectorAll('.audit-tabs .seg button')].find(b => /Mensagens/.test(b.textContent))?.click()); await shot('4-auditoria-mensagens');
  await p.evaluate(() => document.querySelector('.ml-mode')?.click()); await shot('5-auditoria-lado-a-lado');
} finally { await browser.close(); srv.kill(); }
