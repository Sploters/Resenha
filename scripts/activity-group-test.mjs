// "Ativo agora": amigos no mesmo jogo viram um cartão só (ex.: "VALORANT · 2 amigos"), com uma linha por pessoa e um
// "Entrar" por sala; amigos em chamada (sem jogo) no mesmo servidor também viram um cartão do servidor, com as salas.
// Uso: BROWSER=/caminho/do/chrome node scripts/activity-group-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3421, BASE = `http://localhost:${PORT}`, DATA = '.testdata-actgroup';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41151', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const mk = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-12345' }); const me = await call(r.token, 'GET', '/users/@me').catch(() => null); return { n, tok: r.token, id: me?.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const open = async (u) => {
  const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 20000 }); u.id = await p.evaluate(() => window.__lc.S.me.id); u.p = p; return p;
};
try {
  const [ana, beto, caio, duda, eva, fabi] = await Promise.all(['ana', 'beto', 'caio', 'duda', 'eva', 'fabi'].map(mk));
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Galera' }); const code = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  const sala2 = await call(ana.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 });
  for (const u of [ana, beto, caio, duda, eva, fabi]) await open(u);
  for (const u of [beto, caio, duda, eva, fabi]) {
    await call(u.tok, 'POST', '/invites/' + code);
    await call(ana.tok, 'POST', '/relationships', { username: u.n }); await call(u.tok, 'PUT', '/relationships/' + ana.id, {});
  }
  await sleep(800);
  const vc1 = await beto.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2 && c.name !== 'Sala 2').id, g.id);
  const game = (u, id, title) => u.p.evaluate((id, title) => window.__lc.voice.send('ACTIVITY_LOCAL', { game: { id, title } }), id, title);
  const join = (u, cid) => u.p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, cid);
  await game(beto, 'valorant', 'VALORANT'); await game(caio, 'valorant', 'VALORANT'); await game(duda, 'cs2', 'Counter-Strike 2');
  await join(beto, vc1); await join(caio, vc1); await join(eva, vc1); await join(fabi, sala2.id);
  await sleep(2500);
  await ana.p.evaluate(() => window.__lc.go('@me')); await sleep(1500);
  const view = () => ana.p.evaluate(() => {
    const t = (e, s) => e.querySelector(s)?.textContent.trim();
    return {
      caps: [...document.querySelectorAll('#actfeed .an-now .an-cap')].map(e => e.textContent),
      groups: [...document.querySelectorAll('#actfeed .an-now .an-group')].map(e => ({ game: t(e, '.an-game > span:not(.gicon)'), count: t(e, '.an-count'), guild: t(e, '.an-top .an-who b'), sub: t(e, '.an-top .an-who small'), mems: [...e.querySelectorAll('.an-mem .an-who b')].map(b => b.textContent), rooms: [...e.querySelectorAll('.an-rblock')].map(r => ({ room: t(r, '.an-room span'), who: t(r, '.an-rwho small'), join: [...r.querySelectorAll('.act-btns button')].map(b => b.textContent.trim()) })) })),
      singles: [...document.querySelectorAll('#actfeed .an-now .an-card:not(.an-group)')].map(e => t(e, '.an-game > span:not(.gicon)') || t(e, '.an-who b')),
    };
  });
  let v = await view();
  const val = v.groups.find(x => x.game === 'VALORANT');
  ok(val && val.count === '2 amigos' && val.mems.sort().join() === 'beto,caio', 'beto e caio no VALORANT: um cartão só, "2 amigos", uma linha por pessoa', val);
  ok(val?.rooms.length === 1 && val.rooms[0].who === 'beto e caio' && val.rooms[0].join.join() === 'Entrar', 'os dois na mesma sala: um "Entrar" só', val?.rooms);
  ok(v.singles.includes('Counter-Strike 2') && !v.groups.some(x => x.game === 'Counter-Strike 2'), 'duda sozinha no CS2: cartão normal', v.singles);
  const srvCard = v.groups.find(x => x.guild === 'Galera');
  ok(srvCard && srvCard.sub === '2 amigos em chamada' && srvCard.rooms.length === 2, 'eva e fabi em chamada no mesmo servidor (salas diferentes): um cartão do servidor com as duas salas', srvCard);
  ok(srvCard?.rooms.map(r => r.room + ':' + r.who).sort().join('|') === 'Geral:eva|Sala 2:fabi', 'cada sala mostra quem está nela', srvCard?.rooms);
  if (process.env.SHOTS) { fs.mkdirSync('.testshots', { recursive: true }); const b = await ana.p.$('#active-now'); await b.screenshot({ path: '.testshots/activity-group.png' }); }
  // Entrar pelo cartão do grupo
  await ana.p.evaluate(() => [...document.querySelectorAll('#actfeed .an-group .an-rblock .act-btns button')].find(b => /Entrar/.test(b.textContent)).click()); await sleep(2000);
  ok(await ana.p.evaluate(() => window.__lc.voice.channelId) === vc1, '"Entrar" do grupo leva para a sala deles');
  // um sai do jogo: volta a ser cartão individual
  await sleep(3200); await caio.p.evaluate(() => window.__lc.voice.send('ACTIVITY_LOCAL', { game: null })); await sleep(1500);
  await ana.p.evaluate(() => window.__lc.go('@me')); await sleep(1200);
  v = await view();
  ok(!v.groups.some(x => x.game === 'VALORANT') && v.singles.includes('VALORANT'), 'caio saiu do jogo: beto volta a ter o cartão dele', v);
  const errs = [ana, beto, caio, duda, eva, fabi].flatMap(u => u.p.errors);
  ok(!errs.length, 'sem erros na página', errs);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
