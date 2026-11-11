// Presença só para quem vai mostrar (server/index.js broadcastStatus): quem recebe e quem não recebe o aviso de
// entrou/saiu, a sincronização ao abrir um servidor, janela escondida, app antigo (sem VIEW) e quem foi removido.
// Uso: node scripts/presence-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3293, BASE = `http://localhost:${PORT}`, D = './.testdata-presence';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(D, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
// cliente de gateway: guarda os avisos de presença que chegam
function gw(tok, view) {
  return new Promise((res) => {
    const c = { got: [], ws: new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok) };
    c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (['PRESENCE', 'USER_UPDATE', 'PRESENCE_SYNC'].includes(m.t)) c.got.push(m); if (m.t === 'READY') { if (view !== undefined) c.ws.send(JSON.stringify({ t: 'VIEW', d: { guild_id: view } })); setTimeout(() => res(c), 150); } });
    c.view = (g) => c.ws.send(JSON.stringify({ t: 'VIEW', d: { guild_id: g } }));
    c.saw = (uid, st) => c.got.some(m => (m.t === 'PRESENCE' || m.t === 'USER_UPDATE') && m.d.id === uid && (!st || m.d.status === st));
    c.close = () => new Promise(r => { c.ws.on('close', r); c.ws.close(); });
  });
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla'), f = await reg('fabio'), k = await reg('kaio');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c, k]) await call(u.tok, 'POST', '/invites/' + inv);
  // fabio é amigo do bruno, fora do servidor
  await call(f.tok, 'POST', '/relationships', { username: 'bruno' }); await call(b.tok, 'PUT', '/relationships/' + f.id, {});

  // quem olha o servidor recebe; quem olha as DMs não; amigo recebe sempre; app antigo recebe como antes
  const viewing = await gw(c.tok, g.id), dms = await gw(k.tok, null), friend = await gw(f.tok, null), legacy = await gw(a.tok, undefined);
  const B = await gw(b.tok, null); await sleep(500);
  ok(viewing.saw(b.id, 'online'), 'quem está olhando o servidor recebe "bruno entrou"');
  ok(!dms.saw(b.id), 'quem está nas DMs não recebe a presença de um membro');
  ok(friend.saw(b.id, 'online'), 'amigo fora do servidor recebe');
  ok(legacy.got.some(m => m.t === 'USER_UPDATE' && m.d.id === b.id && m.d.status === 'online'), 'app antigo (sem VIEW) recebe o USER_UPDATE completo, como antes');
  const pres = viewing.got.find(m => m.t === 'PRESENCE' && m.d.id === b.id);
  ok(pres && !('bio' in pres.d) && Object.keys(pres.d).length === 3, 'aviso novo é pequeno (id, status, aparelhos)', pres?.d);

  // abrir o servidor depois: a foto de quem está online vem junto
  dms.view(g.id); await sleep(400);
  const sync = dms.got.find(m => m.t === 'PRESENCE_SYNC');
  ok(sync?.d.guild_id === g.id && sync.d.online.some(([id, st]) => id === b.id && st === 'online'), 'ao abrir o servidor recebe quem está online nele', sync?.d.online?.length);
  // agora olhando: sair chega
  await B.close(); await sleep(400);
  ok(dms.saw(b.id, 'offline'), 'olhando o servidor, recebe "bruno saiu"');
  // janela escondida (VIEW null): para de receber
  viewing.got.length = 0; viewing.view(null); await sleep(200);
  const B2 = await gw(b.tok, null); await sleep(400);
  ok(!viewing.saw(b.id), 'janela escondida (VIEW null) não recebe');
  // removido do servidor: para de receber mesmo que o app ainda diga que está olhando
  const kicked = await gw(k.tok, g.id); await sleep(200);
  await call(a.tok, 'DELETE', `/guilds/${g.id}/members/${k.id}`); await sleep(300); kicked.got.length = 0;
  await B2.close(); await sleep(400);
  ok(!kicked.saw(b.id), 'quem foi removido do servidor para de receber a presença dos membros');
  kicked.view(g.id); await sleep(300);
  ok(!kicked.got.some(m => m.t === 'PRESENCE_SYNC'), 'e não consegue pedir a foto de um servidor de que não faz parte');
  for (const x of [viewing, dms, friend, legacy, kicked]) await x.close();

  // no app: lista de membros fica certa trocando de tela (DMs -> servidor) e com a janela escondida
  const P = await browser.newPage(); await P.setViewport({ width: 1440, height: 900 });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; let hid = false; Object.defineProperty(document, 'hidden', { get: () => hid }); window.__hide = (v) => { hid = v; document.dispatchEvent(new Event('visibilitychange')); }; }, c.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  const ch = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0).id, g.id);
  await P.evaluate(() => window.__lc.go('@me')); await sleep(500);
  const B3 = await gw(b.tok, null); await sleep(500); // bruno entra enquanto carla está nas DMs
  await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch); await sleep(800);
  const st = () => P.evaluate((uid) => ({ status: window.__lc.S.users.get(uid)?.status, row: !!document.querySelector(`#members .mem[data-uid="${uid}"]:not(.off)`) }), b.id);
  ok((await st()).row, 'abriu o servidor: bruno aparece online na lista', await st());
  await P.evaluate(() => window.__hide(true)); await sleep(200);
  await B3.close(); await sleep(500); // sai com a janela escondida
  await P.evaluate(() => window.__hide(false)); await sleep(800);
  ok((await st()).status === 'offline' && !(await st()).row, 'voltou da janela escondida: bruno aparece offline', await st());
} catch (e) { console.log('ERRO', e); fails++; }
finally {
  await browser.close(); srv.kill(); fs.rmSync(D, { recursive: true, force: true });
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); setTimeout(() => process.exit(fails ? 1 : 0), 300);
}
