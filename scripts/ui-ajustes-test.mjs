// Ajustes de interface (23/11): Wishlist do servidor com "Carregar mais" mantendo a rolagem; atalhos do servidor sem
// Jogadores e Noites; topo do canal do servidor sem o botão de Arquivos (a DM continua com ele); e, numa conversa, só a
// conversa em destaque (o botão "Amigos, conversas e jogos" não fica azul).
// Uso: node scripts/ui-ajustes-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const PORT = 3462, BASE = `http://localhost:${PORT}`, DATA = './.testdata-uiajustes';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', DISCOVER_OFF: '1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), beto = await reg('beto');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' });
  const dm = await call(ana.tok, 'POST', '/dms', { user_id: beto.id });
  // 40 jogos que duas pessoas querem (a resposta do servidor é trocada: o que importa aqui é a tela)
  const items = Array.from({ length: 40 }, (_, i) => ({ appid: String(9000 + i), wish: [ana.id, beto.id], owners: [] }));
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1280, height: 900 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ana.tok);
  await P.setRequestInterception(true);
  P.on('request', q => /\/guilds\/\d+\/wishlist$/.test(q.url()) ? q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, members: 2, wishers: 2, users: [] }) }) : q.continue());
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');

  // atalhos e topo do canal no servidor
  const cid = await P.evaluate((gid) => { const c = window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0); window.__lc.go(gid, c.id); return c.id; }, g.id);
  await P.waitForSelector('#side-list .st-strip'); await sleep(300);
  const side = await P.evaluate(() => ({ tips: [...document.querySelectorAll('#side-list .st-strip .st-btn')].map(b => b.dataset.tip), files: !!document.querySelector('#topbar .files-btn'), pins: !!document.querySelector('#topbar .pins-btn') }));
  ok(!side.tips.includes('Jogadores') && !side.tips.includes('Noites') && side.tips.includes('Arquivos') && side.tips.includes('Clipes'), 'atalhos do servidor sem Jogadores e Noites', side.tips);
  ok(!side.files && side.pins, 'topo do canal do servidor sem o botão de arquivos (fixadas continua)', side);
  ok(await P.evaluate(() => !document.querySelector('#rail .rail-msgs.active')), 'no servidor o botão Amigos não fica em destaque');

  // conversa direta: só ela em destaque; tela inicial: o botão em destaque
  await P.evaluate((id) => window.__lc.go('@me', id), dm.id); await sleep(500);
  const inDm = await P.evaluate(() => ({ me: !!document.querySelector('#rail .rail-msgs.active'), files: !!document.querySelector('#topbar .files-btn'), dmRow: !!document.querySelector('#side-list .active') }));
  ok(!inDm.me && inDm.dmRow, 'na DM o botão "Amigos, conversas e jogos" não fica azul; a conversa fica em destaque', inDm);
  ok(inDm.files, 'a DM continua com o botão de arquivos');
  await P.evaluate((id) => { location.hash = `#/@me/${id}/files`; }, dm.id); await sleep(500);
  ok(await P.evaluate(() => !document.querySelector('#rail .rail-msgs.active')), 'nos arquivos da DM também não');
  await P.evaluate(() => window.__lc.go('@me')); await sleep(500);
  ok(await P.evaluate(() => !!document.querySelector('#rail .rail-msgs.active')), 'na tela de Amigos o botão fica em destaque');

  // Wishlist: "Carregar mais" (clique de verdade) mantém onde estava
  await P.evaluate((gid) => window.__lc.go(gid, 'wishlist'), g.id);
  await P.waitForSelector('#wishview .wcard'); await sleep(600);
  await P.evaluate(() => { const b = document.querySelector('#wishview .cbody'); b.scrollTop = b.scrollHeight; }); await sleep(300);
  const before = await P.evaluate(() => document.querySelector('#wishview .cbody').scrollTop);
  const bt = await P.evaluateHandle(() => [...document.querySelectorAll('#wishview .wmore button')].find(b => /Carregar mais/.test(b.textContent)));
  await bt.click(); await sleep(400);
  const after = await P.evaluate(() => ({ top: document.querySelector('#wishview .cbody').scrollTop, cards: document.querySelectorAll('#wishview .wcard').length }));
  ok(before > 100 && after.cards === 24 && Math.abs(after.top - before) < 2, 'Wishlist: "Carregar mais" acrescenta 12 e mantém a rolagem', { before, ...after });
} finally {
  await browser.close(); srv.kill(); await sleep(300); fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
