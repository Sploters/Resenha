// Sala de voz trancada (sem Conectar para @everyone) nem aparece para quem não pode entrar: some da barra, da lista de
// salas do servidor e não abre por link. Se alguém com cargo puxar a pessoa para lá, a sala aparece enquanto ela está
// dentro e some de novo assim que ela sai. Categoria que só tinha salas escondidas some junto.
// Servidor de verdade + navegador para a Ana (dona) e o Beto (membro). Uso: node scripts/hidden-room-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
import { DatabaseSync } from 'node:sqlite';
const BASE = await ownServer('hiddenroom', 3415, 41630);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { n, tok: r.token, id: me.id }; };
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
fs.mkdirSync('.testshots', { recursive: true });
try {
  const [ana, beto] = await Promise.all(['ana', 'beto'].map(reg));
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Sala' }), code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`, {})).code;
  await call(beto.tok, 'POST', '/invites/' + code);
  const v1 = new DatabaseSync('./.testdata-hiddenroom/resenha.db').prepare('SELECT id FROM channels WHERE guild_id=? AND type=2').get(g.id).id;
  // categoria "Staff" só com a sala trancada
  const cat = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Staff', type: 4 })).id;
  const sec = (await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Secreta', type: 2, parent_id: cat })).id;
  ok((await call(ana.tok, 'PUT', `/channels/${cat}/perms`, { overwrites: [{ target: 'everyone', allow: 0, deny: 8 }] })).status === 200, 'Staff tranca Conectar para todos');
  const open = async (u) => {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => { console.log('  PAGEERROR', u.n, e.message); fails++; });
    await p.setViewport({ width: 1280, height: 800 });
    await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, u.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
    await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, v1); await p.waitForSelector('#side-list .catblk');
    return p;
  };
  const A = await open(ana), B = await open(beto);
  const names = (p) => p.evaluate(() => [...document.querySelectorAll('#side-list .ch .name, #side-list .cat')].map(e => e.textContent.trim()));
  ok((await names(A)).includes('Secreta') && (await names(A)).includes('Staff'), 'Ana (dona) vê a sala trancada e a categoria', await names(A));
  ok(!(await names(B)).includes('Secreta') && !(await names(B)).includes('Staff'), 'Beto não vê a sala nem a categoria', await names(B));
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, sec); await sleep(200);
  ok(await B.evaluate((sec) => window.__lc.S.view.cid !== sec, sec), 'link direto para a sala não abre para o Beto');

  // Beto entra na Sala 1; Ana o puxa para a Secreta
  await B.evaluate((cid) => window.__lc.joinVoice(cid), v1);
  await B.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 });
  ok(await until(() => A.$(`.vuser[data-uid="${beto.id}"]`)), 'Ana vê o Beto na Sala 1');
  ok((await call(ana.tok, 'PATCH', `/guilds/${g.id}/voice/${beto.id}`, { channel_id: sec })).status === 200, 'Ana move o Beto para a Secreta');
  ok(await until(() => B.evaluate((cid) => window.__lc.voice?.channelId === cid, sec), 10000), 'Beto está na Secreta');
  ok(await until(async () => (await names(B)).includes('Secreta') && (await names(B)).includes('Staff')), 'enquanto está lá, Beto vê a sala (e a categoria)', await names(B));
  ok(await B.$eval(`#side-list .vuser[data-uid="${beto.id}"]`, () => true).catch(() => false), 'Beto se vê dentro da sala na barra');
  await B.screenshot({ path: '.testshots/hidden-room-inside.png' });
  await B.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, sec); await sleep(200);
  ok(await B.evaluate((sec) => window.__lc.S.view.cid === sec, sec), 'e consegue abrir a sala enquanto está nela');

  // Beto sai: a sala some de novo e a tela volta para o servidor
  await B.evaluate(() => window.__lc.voice.leave?.()); await B.evaluate(() => document.querySelector('#user-area [title*="Desconectar"], #user-area [aria-label*="Desconectar"]')?.click());
  ok(await until(() => B.evaluate(() => !window.__lc.S.voice.get(window.__lc.S.me.id))), 'Beto saiu da chamada');
  ok(await until(async () => !(await names(B)).includes('Secreta') && !(await names(B)).includes('Staff')), 'ao sair, a sala e a categoria somem de novo', await names(B));
  ok(await until(() => B.evaluate((sec) => window.__lc.S.view.cid && window.__lc.S.view.cid !== sec, sec)), 'a tela sai da sala escondida');
  // a liberação valia uma vez só: nem forçando a entrada pelo app ele volta sozinho
  await B.evaluate((cid) => window.__lc.joinVoice(cid, { moved: true }), sec); await sleep(1500);
  ok(await B.evaluate((sec) => window.__lc.voice?.channelId !== sec && window.__lc.S.voice.get(window.__lc.S.me.id)?.channel_id !== sec, sec), 'depois de sair, o servidor não deixa o Beto voltar sozinho');
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
