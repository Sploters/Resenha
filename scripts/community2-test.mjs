// Pedidos da comunidade, lote 2 (servidor real + navegador):
// - spoiler: moderador marca a mensagem de outra pessoa para todos (com auditoria); membro comum não pode; o autor não tira
//   o spoiler do moderador; "só para mim" numa conversa direta; clicar revela
// - caixa de entrada → Pedidos: pedidos recebidos com data, aceitar
// - servidor silenciado com um canal reativado: só ele avisa e conta como não lido
// - amigos neste servidor: linha no topo dos canais, janela com a lista e cartão de convite
// Uso: BROWSER=/caminho/do/chrome node scripts/community2-test.mjs   (SHOTS=1 salva capturas em .testshots/community2)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3293, BASE = `http://localhost:${PORT}`, DATA = './.testdata-comm2', OUT = '.testshots/community2';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41093', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const befriend = async (x, y, yname) => { await call(x.tok, 'POST', '/relationships', { username: yname }); await call(y.tok, 'PUT', `/relationships/${x.id}`, {}); };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const spy = () => {
  window.__n = [];
  class N { constructor(t, o) { window.__n.push({ t, ...o }); } close() { } static permission = 'granted'; static requestPermission = async () => 'granted'; }
  window.Notification = N;
};
try {
  const ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio'), dani = await reg('dani'), eve = await reg('eve');
  await befriend(ana, caio, 'caio'); await befriend(ana, dani, 'dani');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Servidor da Ana' });
  const code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(bia.tok, 'POST', '/invites/' + code); await call(caio.tok, 'POST', '/invites/' + code);
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument(spy);
  await p.goto(BASE); await p.evaluate((t) => { localStorage.lc_token = t; }, ana.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); await sleep(400);
  const geral = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0), g.id);
  const anun = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'anuncios', type: 0 });

  // ---------- spoiler pelo servidor ----------
  const m1 = await call(bia.tok, 'POST', `/channels/${geral.id}/messages`, { content: 'o final do filme é que ele morre' });
  ok((await call(caio.tok, 'PUT', `/channels/${geral.id}/messages/${m1.id}/spoiler`)).status === 403, 'membro comum não marca a mensagem de outra pessoa como spoiler');
  ok((await call(ana.tok, 'PUT', `/channels/${geral.id}/messages/${m1.id}/spoiler`)).status === 200, 'moderadora (dona) marca a mensagem da Bia como spoiler para todos');
  const seen = (await call(caio.tok, 'GET', `/channels/${geral.id}/messages?limit=5`)).find(x => x.id === m1.id);
  ok(seen?.spoiler === true && seen.spoiler_by_mod === true, 'todo mundo recebe a mensagem marcada (por moderador)', { spoiler: seen?.spoiler, mod: seen?.spoiler_by_mod });
  ok((await call(bia.tok, 'DELETE', `/channels/${geral.id}/messages/${m1.id}/spoiler`)).status === 403, 'a autora não tira o spoiler que a moderadora pôs');
  const audit = await call(ana.tok, 'GET', `/guilds/${g.id}/audit`);
  const al = Array.isArray(audit) ? audit : audit.entries || audit.list || [];
  ok(al.some(a => a.action === 'message_spoiler'), 'fica no registro de auditoria');
  const m2 = await call(bia.tok, 'POST', `/channels/${geral.id}/messages`, { content: 'meu próprio spoiler' });
  ok((await call(bia.tok, 'PUT', `/channels/${geral.id}/messages/${m2.id}/spoiler`)).status === 200 && (await call(bia.tok, 'DELETE', `/channels/${geral.id}/messages/${m2.id}/spoiler`)).status === 200, 'a autora marca e desmarca a própria mensagem');
  const dmD = await call(dani.tok, 'POST', '/dms', { user_id: ana.id });
  const md = await call(dani.tok, 'POST', `/channels/${dmD.id}/messages`, { content: 'olha o que aconteceu no último episódio' });
  ok((await call(ana.tok, 'PUT', `/channels/${dmD.id}/messages/${md.id}/spoiler`)).status === 403, 'numa conversa direta só o autor marca para os dois (o outro usa o "só para mim")');

  // ---------- navegador da Ana ----------
  await call(eve.tok, 'POST', '/relationships', { username: 'ana' }); await sleep(400); // pedido de amizade pendente (chega ao vivo)
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, geral.id); await p.waitForSelector(`[data-mid="${m1.id}"]`); await sleep(300);
  ok(await p.evaluate((id) => { const el = document.querySelector(`[data-mid="${id}"]`); return !!el.querySelector('.mspoil') && /moderador/.test(el.querySelector('.mspoil-tag')?.textContent || ''); }, m1.id), 'no chat: mensagem coberta, com "Marcado como spoiler por um moderador"');
  ok(await p.evaluate((id) => getComputedStyle(document.querySelector(`[data-mid="${id}"] .mspoil-in`)).filter.includes('blur'), m1.id), 'o conteúdo fica borrado');
  if (process.env.SHOTS) { await p.evaluate((id) => document.querySelector(`[data-mid="${id}"]`).scrollIntoView({ block: 'center' }), m1.id); await p.screenshot({ path: OUT + '/spoiler.png' }); }
  await p.click(`[data-mid="${m1.id}"] .mspoil`); await sleep(200);
  ok(await p.evaluate((id) => !document.querySelector(`[data-mid="${id}"] .mspoil`) && /morre/.test(document.querySelector(`[data-mid="${id}"]`).textContent), m1.id), 'clicar revela');
  // "só para mim" numa conversa direta, pelo menu da mensagem
  await p.evaluate((cid) => window.__lc.go('@me', cid), dmD.id); await p.waitForSelector(`[data-mid="${md.id}"]`); await sleep(300);
  const b = await p.$(`[data-mid="${md.id}"]`); await b.click({ button: 'right' }); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll('.menu .it')].find(i => /spoiler só para mim/.test(i.textContent))?.click()); await sleep(400);
  ok(await p.evaluate((id) => !!document.querySelector(`[data-mid="${id}"] .mspoil`) && /Você marcou/.test(document.querySelector(`[data-mid="${id}"] .mspoil-tag`).textContent) && !!window.__lc.S.prefs.mySpoilers?.[id], md.id), '"Marcar como spoiler só para mim" cobre a mensagem e fica guardado na conta');
  ok((await call(dani.tok, 'GET', `/channels/${dmD.id}/messages?limit=5`)).find(x => x.id === md.id)?.spoiler !== true, '…sem mudar nada para o Dani');

  // ---------- caixa de entrada → Pedidos ----------
  await p.evaluate(() => document.querySelector('.inbox-btn').click()); await sleep(400);
  await p.evaluate(() => [...document.querySelectorAll('.inboxpop .ib-tabs button')].find(b => /Pedidos/.test(b.textContent)).click()); await sleep(300);
  const req = await p.evaluate(() => ({ tab: document.querySelector('.inboxpop .ib-tabs button.on')?.textContent, rows: [...document.querySelectorAll('.inboxpop .ib-req')].map(r => r.innerText) }));
  ok(/Pedidos1/.test(req.tab) && req.rows.length === 1 && /eve/.test(req.rows[0]) && /Recebido em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/.test(req.rows[0]), 'aba Pedidos: o pedido da Eve com data e hora', req);
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/pedidos.png' });
  await p.evaluate(() => document.querySelector('.inboxpop .ib-req .btn.green').click()); await sleep(800);
  ok(await p.evaluate((id) => window.__lc.S.rels.get(id)?.type === 1, eve.id), 'Aceitar: viram amigas');
  await p.keyboard.press('Escape'); await sleep(200);

  // ---------- servidor silenciado, canal de anúncios reativado ----------
  await p.evaluate(async (gid, cid) => { const S = window.__lc.S; S.prefs.desktopNotif = true; (S.prefs.notifyCfg ||= {})[gid] = { level: 'all', muted: true }; (await window.__lc.import('state.js')).setChannelUnmuted(cid, true); window.__lc.go('@me'); Object.defineProperty(document, 'hasFocus', { value: () => false }); window.__n = []; }, g.id, anun.id);
  await call(bia.tok, 'POST', `/channels/${geral.id}/messages`, { content: 'bom dia' }); await call(bia.tok, 'POST', `/channels/${anun.id}/messages`, { content: 'Live hoje às 20h!' }); await sleep(700);
  const un = await p.evaluate((a, b) => ({ geral: !!window.__lc.S.unread[a], anun: !!window.__lc.S.unread[b] }), geral.id, anun.id);
  ok(!un.geral && un.anun, 'servidor silenciado: #geral fica quieto, #anuncios (reativado) conta como não lido', un);
  await call(bia.tok, 'POST', `/channels/${anun.id}/messages`, { content: `<@${ana.id}> vem pra live` }); await sleep(600);
  ok(await p.evaluate(() => window.__n.some(n => /anuncios/.test(n.t))), '…e avisa');
  await p.evaluate((gid) => window.__lc.go(gid), g.id); await sleep(500);
  const side = await p.evaluate((a, b) => ({ geralMuted: !!document.querySelector(`#side-list .ch.muted`), bell: [...document.querySelectorAll('#side-list .ch')].some(c => /anuncios/.test(c.textContent) && c.querySelector('.unmutemark')) }), geral.id, anun.id);
  ok(side.geralMuted && side.bell, 'na lista: canais silenciados apagados, o reativado com sininho', side);

  // ---------- amigos neste servidor ----------
  const fr = await p.evaluate(() => document.querySelector('#side-head .srv-friends')?.textContent);
  ok(/caio está aqui/.test(fr || ''), 'topo da lista de canais: "caio está aqui"', fr);
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/servidor.png' });
  await p.click('#side-head .srv-friends'); await sleep(400);
  const modalTxt = await p.evaluate(() => document.querySelector('.modal')?.innerText || '');
  ok(/Amigos em Servidor da Ana/.test(modalTxt) && /caio/.test(modalTxt) && !/bia/.test(modalTxt), 'janela "Amigos em Servidor da Ana" lista só os amigos (Caio, não a Bia)', modalTxt.slice(0, 120));
  if (process.env.SHOTS) await p.screenshot({ path: OUT + '/amigos.png' });
  const inv = await call(dani.tok, 'GET', `/invites/${code}?peek=1`);
  ok(inv.friends?.map(u => u.username).join() === 'ana', 'cartão de convite para o Dani: mostra que a Ana (amiga dele) já está no servidor', inv.friends?.map(u => u.username));
  ok(!(await call('', 'GET', `/invites/${code}?peek=1`)).friends?.length, 'sem login: nenhum amigo listado');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
