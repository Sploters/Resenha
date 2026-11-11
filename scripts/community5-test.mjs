// Ideias da comunidade, lote 5 (recursos de mods feitos nativos), servidor real + navegador:
// - de onde a pessoa está conectada (desktop / celular / navegador): sai no READY e no USER_UPDATE, some no invisível
// - links sem rastreio ao enviar e editar (utm_, si=, fbclid…; t= do YouTube fica)
// - horário <t:…> mostrado no horário de quem lê, "Inserir horário" no + do campo
// - duplo clique: na sua mensagem edita, na dos outros responde; Ctrl+↑/↓ escolhe a resposta
// - amizade desfeita: aviso ao vivo, lista na caixa de entrada → Pedidos (também com o app fechado), dispensar
// Uso: BROWSER=/caminho/do/chrome node scripts/community5-test.mjs   (SHOTS=1 salva capturas em .testshots/community5)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3295, BASE = `http://localhost:${PORT}`, DATA = './.testdata-comm5', OUT = '.testshots/community5';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (p, n) => process.env.SHOTS && p.screenshot({ path: `${OUT}/${n}.png` });
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', TRANSLATE: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const befriend = async (x, y, yname) => { await call(x.tok, 'POST', '/relationships', { username: yname }); await call(y.tok, 'PUT', `/relationships/${x.id}`, {}); };
// conexão "celular" de mentira: abre o gateway e diz que é um aparelho de toque
const phone = (tok) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=${tok}`); const evs = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); evs.push(m); if (m.t === 'READY') { ws.send(JSON.stringify({ t: 'CLIENT_INFO', d: { desktop: null, kind: 'mobile' } })); res({ ws, evs }); } });
  ws.on('error', rej);
});
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio');
  await befriend(ana, bia, 'bia'); await befriend(ana, caio, 'caio');
  const dm = await call(ana.tok, 'POST', '/dms', { user_id: bia.id });

  // ---------- plataformas (gateway) ----------
  const bPhone = await phone(bia.tok); await sleep(400);
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.goto(BASE); await p.evaluate((t) => { localStorage.lc_token = t; }, ana.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.waitForFunction(() => window.__lc.S.synced, { timeout: 10000 }); await sleep(500);
  const plat = () => p.evaluate((id) => window.__lc.S.users.get(id)?.platforms || null, bia.id);
  ok(JSON.stringify(await plat()) === '["mobile"]', 'Ana vê a Bia conectada pelo celular', await plat());
  const bWeb = await phone(bia.tok); bWeb.ws.send(JSON.stringify({ t: 'ACTIVE', d: { active: true, kind: 'web' } }));
  await p.waitForFunction((id) => (window.__lc.S.users.get(id)?.platforms || []).length === 2, { timeout: 5000 }, bia.id).catch(() => { });
  ok(JSON.stringify(await plat()) === '["mobile","web"]', 'abriu o navegador também: as duas plataformas chegam ao vivo', await plat());
  bWeb.ws.close(); await sleep(600);
  ok(JSON.stringify(await plat()) === '["mobile"]', 'fechou o navegador: volta a só celular', await plat());
  await call(bia.tok, 'PATCH', '/me', { status: 'invisible' }); await sleep(500);
  ok(JSON.stringify(await plat()) === '[]', 'invisível não mostra de onde está conectada', await plat());
  await call(bia.tok, 'PATCH', '/me', { status: 'online' }); await sleep(500);
  await p.evaluate((cid) => window.__lc.go('@me', cid), dm.id); await sleep(600);
  ok(await p.$('.dmrow .plats') != null, 'ícone de plataforma na lista de conversas');

  // ---------- links sem rastreio ----------
  const ta = '#composer textarea';
  await p.waitForSelector(ta);
  const send = async (txt) => { await p.focus(ta); await p.evaluate((s, t) => { const el = document.querySelector(s); el.value = t; }, ta, txt); await p.keyboard.press('Enter'); await sleep(500); };
  await send('vê isso https://youtu.be/abc123?si=XyZ987&t=42 e https://loja.com/p?id=7&utm_source=insta&fbclid=IwAR0');
  let last = (await call(bia.tok, 'GET', `/channels/${dm.id}/messages?limit=1`))[0];
  ok(last?.content === 'vê isso https://youtu.be/abc123?t=42 e https://loja.com/p?id=7', 'links saem sem rastreio (t= fica)', last?.content);
  await p.evaluate(() => { window.__lc.S.prefs.cleanLinks = false; });
  await send('cru https://x.com/a/status/1?s=20');
  last = (await call(bia.tok, 'GET', `/channels/${dm.id}/messages?limit=1`))[0];
  ok(last?.content === 'cru https://x.com/a/status/1?s=20', 'desligado: o link vai como foi escrito', last?.content);
  await p.evaluate(() => { window.__lc.S.prefs.cleanLinks = true; });

  // ---------- horário <t:…> ----------
  const sec = Math.floor(Date.UTC(2030, 0, 15, 18, 0) / 1000);
  const mt = await call(bia.tok, 'POST', `/channels/${dm.id}/messages`, { content: `a live começa <t:${sec}:t> (<t:${sec}:R>)` }); await sleep(500);
  const tsTxt = await p.evaluate((id) => [...document.querySelectorAll(`[data-mid="${id}"] .md-ts`)].map(x => x.textContent), mt.id);
  const expect = await p.evaluate((s) => { const d = new Date(s * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }, sec);
  ok(tsTxt[0] === expect && /^em /.test(tsTxt[1] || ''), 'horário aparece no fuso de quem lê e o relativo em "em …"', tsTxt);
  await p.click('#composer .ibtn'); await sleep(300);
  const items = await p.$$eval('.menu .it, .menu button, .menu [role=menuitem], .menu > *', els => els.map(e => e.textContent.trim()));
  ok(items.some(x => /Inserir horário/.test(x)), '+ do campo tem "Inserir horário"', items);
  await p.evaluate(() => [...document.querySelectorAll('.menu *')].find(e => e.textContent.trim() === 'Inserir horário')?.click()); await sleep(300);
  ok(await p.$('.ts-modal .ts-fmt') != null, 'janela de horário abre com os formatos');
  await shot(p, 'horario');
  await p.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Inserir').click()); await sleep(300);
  const v = await p.$eval(ta, el => el.value);
  ok(/^<t:\d+:R> $/.test(v), 'insere o código no campo', v);
  await p.$eval(ta, el => { el.value = ''; });

  // ---------- duplo clique e Ctrl+↑/↓ ----------
  const mine = await call(ana.tok, 'POST', `/channels/${dm.id}/messages`, { content: 'mensagem minha' }); await sleep(400);
  const box = async (id) => { const el = await p.$(`[data-mid="${id}"] .body`); return el.boundingBox(); };
  const dbl = (x, y) => p.mouse.click(x, y, { count: 2 });
  let b = await box(mine.id); await dbl(b.x + 20, b.y + b.height / 2); await sleep(300);
  ok(await p.$(`[data-mid="${mine.id}"] .edit-box`) != null, 'duplo clique na própria mensagem abre a edição');
  await p.keyboard.press('Escape'); await sleep(300);
  b = await box(mt.id); await dbl(b.x + 10, b.y + b.height / 2); await sleep(300);
  ok(await p.evaluate((id) => window.__lc.S.replyTo?.id === id, mt.id), 'duplo clique na mensagem da Bia começa a resposta');
  await p.keyboard.press('Escape'); await sleep(200);
  await p.focus(ta);
  await p.keyboard.down('Control'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Control'); await sleep(200);
  ok(await p.evaluate((id) => window.__lc.S.replyTo?.id === id, mine.id), 'Ctrl+↑ escolhe a última mensagem');
  await p.keyboard.down('Control'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Control'); await sleep(200);
  ok(await p.evaluate((id) => window.__lc.S.replyTo?.id === id && !!document.querySelector(`[data-mid="${id}"].qr-target`), mt.id), 'Ctrl+↑ de novo sobe uma e destaca');
  await p.keyboard.down('Control'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Control'); await sleep(200);
  ok(await p.evaluate(() => !window.__lc.S.replyTo && !document.querySelector('.msg.qr-target')), 'Ctrl+↓ passando da última cancela');
  await shot(p, 'conversa');

  // ---------- amizade desfeita ----------
  await call(bia.tok, 'DELETE', `/relationships/${ana.id}`); await sleep(500);
  const toasts = await p.$$eval('#toast', els => els.map(e => e.textContent));
  ok(toasts.some(t => /bia desfez a amizade/i.test(t)), 'aviso na hora quando a Bia desfaz a amizade', toasts);
  ok(await p.evaluate(() => (window.__lc.S.friendLosses || []).length === 1), 'guardado na lista');
  await call(ana.tok, 'DELETE', `/relationships/${caio.id}`); await sleep(400);
  ok((await call(caio.tok, 'DELETE', '/friend-losses')).status === 200, 'quem desfez não gera aviso para si mesmo');
  // com o app fechado: Caio é amigo de novo e bloqueia a Ana enquanto ela está fora
  await befriend(ana, caio, 'caio'); await p.close();
  await call(caio.tok, 'PUT', `/relationships/${ana.id}`, { type: 2 });
  const p2 = await ctx.newPage(); await p2.setViewport({ width: 1440, height: 900 });
  p2.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p2.goto(BASE); await p2.waitForFunction(() => window.__lc?.S?.synced, { timeout: 10000 }); await sleep(600);
  const t2 = await p2.$$eval('#toast', els => els.map(e => e.textContent));
  ok(t2.some(t => /caio desfez a amizade/i.test(t)) && !t2.some(t => /bia/i.test(t)), 'na próxima abertura avisa só o que aconteceu com o app fechado', t2);
  await p2.click('.inbox-btn'); await sleep(400);
  await p2.evaluate(() => [...document.querySelectorAll('.ib-tabs button')].find(b => /Pedidos/.test(b.textContent))?.click()); await sleep(400);
  const lostRows = await p2.$$eval('.ib-lost', els => els.map(e => e.querySelector('b')?.textContent));
  ok(lostRows.length === 2 && lostRows[0] === 'caio', 'Pedidos mostra quem desfez, do mais novo ao mais antigo', lostRows);
  await shot(p2, 'pedidos');
  await p2.evaluate(() => document.querySelector('.ib-lost [aria-label="Dispensar aviso"]').click()); await sleep(600);
  ok((await p2.$$('.ib-lost')).length === 1, 'dispensar tira da lista');
  await befriend(ana, bia, 'bia'); await sleep(500);
  ok(await p2.evaluate(() => (window.__lc.S.friendLosses || []).length === 0), 'voltaram a ser amigas: o aviso sai sozinho');
  bPhone.ws.close();
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
