// Mensagens + Amigos numa tela só: lista de amigos única (Pedidos / Online / Offline recolhíveis) e seção Jogos própria
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3237, BASE = `http://localhost:${PORT}`, SHOTS = process.env.SHOTS || '.testshots';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
fs.rmSync('.testdata-fm', { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-fm' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const reg = async (name) => { const { token } = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'senha123' }) }).then(r => r.json()); return { token }; };
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
async function open(tok) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE); await page.evaluate((t) => localStorage.setItem('lc_token', t), tok); await page.goto(BASE);
  await page.waitForSelector('#rail .rail-wrap', { timeout: 10000 }); await sleep(800);
  return page;
}
try {
  const U = {}; for (const n of ['eu', 'ana', 'bia', 'caio', 'duda']) U[n] = await reg(n);
  const tk = (n) => U[n].token;
  await new Promise(r => setTimeout(r, 0));
  if (!tk('eu')) throw new Error('registro: ' + JSON.stringify(U.eu));
  const P = await open(tk('eu')); U.eu.id = await P.evaluate(() => window.__lc.S.me.id);
  for (const n of ['ana', 'bia']) { await api(tk('eu'), 'POST', '/relationships', { username: n }); await api(tk(n), 'PUT', '/relationships/' + U.eu.id, {}); }
  await api(tk('caio'), 'POST', '/relationships', { username: 'eu' }); // pedido recebido
  await api(tk('eu'), 'POST', '/relationships', { username: 'duda' }); // pedido enviado
  const ana = await open(tk('ana')); U.ana.id = await ana.evaluate(() => window.__lc.S.me.id); // ana online, bia offline
  await P.reload(); await P.waitForSelector('#rail .rail-wrap'); await sleep(800);
  await P.evaluate(() => window.__lc.go('@me')); await sleep(800);
  const st = () => P.evaluate(() => ({
    tabs: [...document.querySelectorAll('#home #topbar .tab')].map(t => t.textContent.trim()),
    groups: [...document.querySelectorAll('#home .pane .fgroup')].map(g => g.textContent.replace(/\s+/g, ' ').trim()),
    rows: [...document.querySelectorAll('#home .pane .frow b')].map(b => b.textContent),
    sideHead: document.querySelector('#side-head')?.textContent.trim(), metabs: document.querySelectorAll('.metab').length,
    friendsRow: !!document.querySelector('#side-list .friendsrow.active'), dmTools: !!document.querySelector('#side-list .dm-tools'),
    lfgInSide: !!document.querySelector('#side-list .lfgrow-side'), games: !!document.querySelector('#rail .rail-games'),
  }));
  let s = await st();
  ok(!s.tabs.includes('Online') && s.tabs.includes('Todos'), 'Online e Todos viraram uma aba só', s.tabs);
  ok(s.groups.length === 3 && /^Pedidos/.test(s.groups[0]) && /^Online/.test(s.groups[1]) && /^Offline/.test(s.groups[2]), 'grupos Pedidos / Online / Offline', s.groups);
  ok(s.rows.join() === 'caio,duda,ana,bia', 'ordem: pedidos, online, offline', s.rows);
  ok(s.metabs === 0 && /Mensagens/.test(s.sideHead) && s.friendsRow && s.dmTools, 'sem abas Mensagens|Amigos: lista de conversas ao lado com "Amigos" no topo', s);
  ok(!s.lfgInSide && s.games, 'Procurar jogadores/Descobrir saíram da lista; ícone Jogos na barra', s);
  await P.screenshot({ path: `${SHOTS}/fm-01-amigos.png` });
  // recolher Offline
  await P.evaluate(() => [...document.querySelectorAll('#home .fgroup')].find(g => /Offline/.test(g.textContent)).click()); await sleep(300);
  s = await st();
  ok(s.rows.join() === 'caio,duda,ana' && /Offline/.test(s.groups[2]), 'Offline recolhido esconde a bia', s.rows);
  ok(await P.evaluate(() => JSON.parse(localStorage.lc_fcol).offline === true), 'recolhido fica salvo');
  await P.screenshot({ path: `${SHOTS}/fm-02-recolhido.png` });
  // busca abre tudo
  await P.type('#home .fsearch', 'bi'); await sleep(400);
  s = await st(); ok(s.rows.join() === 'bia', 'buscando: grupo recolhido aparece aberto', s.rows);
  // abrir uma DM: a lista continua, "Amigos" volta ao meio
  await P.evaluate(async (uid) => { const t = localStorage.lc_token; const r = await fetch('/api/dms', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ user_id: uid }) }).then(r => r.json()); window.__lc.go('@me', r.id); }, U.ana.id); await sleep(800);
  ok(await P.evaluate(() => !!document.querySelector('#side-list .dmrow, #side-list .ch.active') && !document.querySelector('#side-list .friendsrow.active') && !!document.querySelector('#composer')), 'DM aberta com a lista de conversas ao lado');
  await P.evaluate(() => document.querySelector('#side-list .friendsrow').click()); await sleep(600);
  ok(await P.evaluate(() => !!document.querySelector('#home .fgroup') && window.__lc.S.view.kind === 'home'), 'clicar em "Amigos" volta para a lista de amigos');
  await P.evaluate(() => { location.hash = '#/@me/messages'; }); await sleep(600);
  ok(await P.evaluate(() => window.__lc.S.view.kind === 'home' && !!document.querySelector('#home')), 'link antigo #/@me/messages abre a mesma tela');
  // seção Jogos
  await P.evaluate(() => document.querySelector('#rail .rail-games .rail-item').click()); await sleep(1200);
  s = await P.evaluate(() => ({ kind: window.__lc.S.view.kind, head: document.querySelector('#side-head')?.textContent.trim(), rows: [...document.querySelectorAll('#side-list .ch .name')].map(e => e.textContent), railActive: !!document.querySelector('#rail .rail-games.active'), meActive: !!document.querySelector('#rail .rail-wrap.rail-fly.active') }));
  ok(s.kind === 'lfg' && s.head === 'Jogos' && s.rows.join() === 'Procurar jogadores,Descobrir' && s.railActive && !s.meActive, 'ícone Jogos abre a seção com Procurar jogadores e Descobrir', s);
  await P.screenshot({ path: `${SHOTS}/fm-03-jogos.png` });
  await P.evaluate(() => [...document.querySelectorAll('#side-list .ch')].find(e => /Descobrir/.test(e.textContent)).click()); await sleep(1200);
  await P.evaluate(() => window.__lc.go('@me')); await sleep(400);
  await P.evaluate(() => document.querySelector('#rail .rail-games .rail-item').click()); await sleep(800);
  ok(await P.evaluate(() => window.__lc.S.view.kind === 'discover'), 'Jogos lembra a última (Descobrir)');
} catch (e) { console.log('  FAIL', e.stack); fails++; }
await browser.close(); srv.kill(); fs.rmSync('.testdata-fm', { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
