// Prints da bola "Parar transmissão" (barra do palco, no lugar do Sair da chamada), da faixa "AO VIVO" do painel de voz
// e do olho ao lado de quem está assistindo na lista da sala.
// Uso: node scripts/stopshare-shots.mjs  (prints em .testshots/stopshare)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const OUT = '.testshots/stopshare', PORT = 3319, BASE = `http://localhost:${PORT}`, DATA = './.testdata-stopshare';
fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(DATA, { recursive: true, force: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41199', RTC_IPS: '127.0.0.1', GAMES_SYNC: '0', DEALS: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Resenha' });
  const P = await browser.newPage(); await P.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 640, 360); }, 33); return c.captureStream(30); }; }, tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const room = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  await P.evaluate((gid, r) => { window.__lc.go(gid, r); window.__lc.joinVoice(r); }, g.id, room);
  await P.waitForFunction(() => window.__lc.voice?.active, { timeout: 15000 });
  await P.evaluate(() => window.__lc.voice.toggleScreen({ res: 360, fps: 30, audio: false, hint: 'motion' })); await sleep(3500);
  const st = await P.evaluate(() => {
    const bar = document.querySelector('#stage .bar'), b = bar?.querySelector('.stopshare'), other = bar?.querySelector('.roundbtn:not(.stopshare)');
    return { last: bar?.querySelector('.roundbtn:last-of-type')?.classList.contains('stopshare'), w: b?.offsetWidth, ow: other?.offsetWidth, leave: !!bar?.querySelector('[title^="Sair da chamada"]'), vp: document.querySelector('#voice-panel .vp-live')?.innerText.replace(/\s+/g, ' ') };
  });
  ok(st.last, 'barra: a bola "Parar transmissão" fica na ponta, no lugar do Sair da chamada', st);
  ok(st.w && st.w === st.ow, 'mesmo tamanho das outras bolas', [st.w, st.ow]);
  ok(!st.leave, 'Sair da chamada sai da barra enquanto transmite (continua no painel de voz)');
  ok(/AO VIVO .*Parar/.test(st.vp || ''), 'painel de voz: faixa AO VIVO com Parar (visível em qualquer tela)', st.vp);
  // segunda pessoa assiste: o olho aparece ao lado do nome dela na lista da sala
  const tok2 = (await call('', 'POST', '/register', { username: 'bia', password: 'Teste.senha-123' })).token;
  const inv = await call(tok, 'POST', `/guilds/${g.id}/invites`, {}); await call(tok2, 'POST', `/invites/${inv.code}`);
  const Q = await browser.newPage(); await Q.setViewport({ width: 1280, height: 800 });
  await Q.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok2);
  await Q.goto(BASE); await Q.waitForSelector('#rail .rail-wrap');
  await Q.evaluate((gid, r) => { window.__lc.go(gid, r); window.__lc.joinVoice(r); }, g.id, room);
  await Q.waitForFunction(() => window.__lc.voice?.active, { timeout: 15000 }); await sleep(1500);
  await Q.evaluate((uid) => { window.__lc.voice.openStream(uid); window.__lc.S.focus = 's:' + uid; window.__lc.renderVoiceUI?.(); }, await P.evaluate(() => window.__lc.S.me.id));
  const eye = await P.waitForFunction(() => [...document.querySelectorAll('.vuser')].some(r => r.querySelector('.vu-watch')), { timeout: 8000 }).then(() => true).catch(() => false);
  ok(eye, 'lista da sala: olho ao lado de quem está assistindo');
  await P.screenshot({ path: OUT + '/03-olho.png' });
  await P.screenshot({ path: OUT + '/01-palco.png' });
  await (await P.$('#voice-panel')).screenshot({ path: OUT + '/02-painel.png' });
  await P.evaluate(() => document.querySelector('#voice-panel .vp-live-stop').click()); await sleep(800);
  ok(await P.evaluate(() => !window.__lc.voice.screen && window.__lc.voice.active && !document.querySelector('.vp-live')), '"Parar" do painel encerra só a transmissão (continua na chamada)');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
