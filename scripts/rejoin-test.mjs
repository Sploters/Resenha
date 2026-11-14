// Voltar para a chamada: F5 (ou fechar o app) no meio da chamada mostra "Você saiu da chamada · Reconectar" no lugar do
// painel de voz, e o botão volta para a mesma sala, mudo como estava. Sair pelo botão, passar de 5 min ou já estar na
// chamada por outra aba: nada é oferecido. Uso: BROWSER=/caminho/do/chrome node scripts/rejoin-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const PORT = 3419, BASE = `http://localhost:${PORT}`, DATA = '.testdata-rejoin';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41131', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const tok = (await call('', 'POST', '/register', { username: 'volta', password: 'Teste.senha-12345' })).token;
const g = await call(tok, 'POST', '/guilds', { name: 'Galera' });
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 20000 });
  const vc = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  const inCall = () => p.evaluate(() => window.__lc.voice?.channelId || null);
  const panel = () => p.evaluate(() => { const e = document.querySelector('#voice-panel.rejoin'); return e && { t: e.querySelector('.t').textContent, sub: e.querySelector('.sub').textContent, btn: !!e.querySelector('.rj-go') }; });
  const reload = async () => { await p.reload(); await p.waitForSelector('#rail .rail-wrap', { timeout: 20000 }); await sleep(1200); };

  await p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); await sleep(1500);
  await p.evaluate(() => window.__lc.voice.toggleMute()); await sleep(300);
  ok(await inCall() === vc && await p.evaluate(() => window.__lc.voice.muted), 'na chamada, mudo');

  // F5 no meio da chamada
  await reload();
  let pn = await panel();
  ok(!(await inCall()) && pn?.btn && /saiu da chamada/.test(pn.t) && /Galera/.test(pn.sub), 'depois do F5: "Você saiu da chamada" com Reconectar (sala / servidor)', pn);
  if (process.env.SHOTS) { fs.mkdirSync('.testshots', { recursive: true }); await p.screenshot({ path: '.testshots/rejoin.png', clip: { x: 0, y: 600, width: 420, height: 300 } }); }
  await p.evaluate(() => document.querySelector('#voice-panel.rejoin .rj-go').click()); await sleep(2000);
  ok(await inCall() === vc && !(await panel()), 'Reconectar volta para a mesma sala', await inCall());
  ok(await p.evaluate(() => window.__lc.voice.muted), 'e volta mudo, como estava');

  // caiu com o app aberto (o servidor avisa reason 'drop'): oferece na hora
  await p.evaluate((cid, gid) => { const me = window.__lc.S.me.id; window.__lc.onEvent('VOICE_STATE', { channel_id: null, prev_channel_id: cid, user_id: me, guild_id: gid, reason: 'drop' }); }, vc, g.id); await sleep(500);
  pn = await panel();
  ok(!(await inCall()) && pn?.btn, 'caiu da chamada com o app aberto: Reconectar aparece na hora', pn);
  await p.evaluate(() => document.querySelector('#voice-panel.rejoin .rj-go').click()); await sleep(2000);
  ok(await inCall() === vc, 'Reconectar depois da queda volta para a sala');
  // tirado por outro motivo (trocou de aparelho, expulso…): não oferece
  await p.evaluate((cid, gid) => { const me = window.__lc.S.me.id; window.__lc.onEvent('VOICE_STATE', { channel_id: null, prev_channel_id: cid, user_id: me, guild_id: gid }); }, vc, g.id); await sleep(500);
  ok(!(await inCall()) && !(await panel()), 'tirado da sala sem ser queda: sem Reconectar');

  // dispensar
  await p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); await sleep(1500);
  await reload(); await p.evaluate(() => document.querySelector('#voice-panel.rejoin button[title="Dispensar"]').click()); await sleep(300);
  ok(!(await panel()), 'o × dispensa');
  await reload();
  ok(!(await panel()), 'dispensado não volta depois de outro F5');

  // sair pelo botão: nada a oferecer
  await p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); await sleep(1500);
  await p.evaluate(() => window.__lc.voice.leave()); await sleep(500);
  ok(!(await panel()), 'saiu pelo botão: sem "Reconectar"');
  await reload();
  ok(!(await panel()), 'e nem depois do F5');

  // mais de 5 minutos depois: não oferece
  await p.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); await sleep(1500);
  await p.evaluate(() => { addEventListener('pagehide', () => { const r = JSON.parse(localStorage.lc_lastcall); r.at -= 6 * 60 * 1000; localStorage.lc_lastcall = JSON.stringify(r); }); });
  await reload();
  ok(!(await panel()), 'voltou depois de 5 minutos: não oferece');

  // outra aba ainda na chamada: não oferece nesta
  const p2 = await ctx.newPage(); await p2.goto(BASE); await p2.waitForSelector('#rail .rail-wrap', { timeout: 20000 });
  await p2.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vc); await sleep(1500);
  ok(await p.evaluate(() => !!JSON.parse(localStorage.lc_lastcall || 'null')), 'a outra aba deixou a sala guardada (o caso vale)');
  await p.bringToFront(); await reload();
  ok(!(await panel()), 'outra aba está na chamada: esta não oferece reconectar');
  ok(!errors.length, 'sem erros na página', errors);
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
