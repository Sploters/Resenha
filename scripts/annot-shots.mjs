// Desenhar sobre a transmissão: o menu "Mais opções" (curto, com ícones), a barra compacta, o desenho transparente por cima
// do vídeo, o zoom com a roda do mouse durante o desenho e quem transmite desenhando na própria tela (prévia pausada).
// Uso: node scripts/annot-shots.mjs  (prints em .testshots/annot)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const OUT = '.testshots/annot', PORT = 3327, BASE = `http://localhost:${PORT}`, DATA = './.testdata-annot';
fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(DATA, { recursive: true, force: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41207', RTC_IPS: '127.0.0.1', GAMES_SYNC: '0', DEALS: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const tok = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const g = await call(tok, 'POST', '/guilds', { name: 'Resenha' });
  const P = await browser.newPage(); await P.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = '#20324a'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#3d6b4f'; x.fillRect(0, 250, 640, 110); x.fillStyle = '#f5c542'; x.beginPath(); x.arc(520, 70, 36, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.fillText('JOGO ' + n, 30, 50); }, 33); return c.captureStream(30); }; }, tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const room = await P.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  await P.evaluate((gid, r) => { window.__lc.go(gid, r); window.__lc.joinVoice(r); }, g.id, room);
  await P.waitForFunction(() => window.__lc.voice?.active, { timeout: 15000 });
  await P.evaluate(() => window.__lc.voice.toggleScreen({ res: 360, fps: 30, audio: false, hint: 'motion' })); await sleep(3500);
  // segunda pessoa assiste e desenha
  const tok2 = (await call('', 'POST', '/register', { username: 'bia', password: 'Teste.senha-123' })).token;
  const inv = await call(tok, 'POST', `/guilds/${g.id}/invites`, {}); await call(tok2, 'POST', `/invites/${inv.code}`);
  const Q = await browser.newPage(); await Q.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  Q.on('pageerror', e => console.log('  QERR', e.message));
  await Q.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok2);
  await Q.goto(BASE); await Q.waitForSelector('#rail .rail-wrap');
  await Q.evaluate((gid, r) => { window.__lc.go(gid, r); window.__lc.joinVoice(r); }, g.id, room);
  await Q.waitForFunction(() => window.__lc.voice?.active, { timeout: 15000 });
  const sid = await P.evaluate(() => window.__lc.S.me.id);
  await Q.evaluate((uid) => window.__lc.voice.openStream(uid), sid);
  await Q.waitForFunction((uid) => window.__lc.S.watching?.has(uid), { timeout: 20000, polling: 500 }, sid).catch(() => null);
  await sleep(1500);
  const tileSel = '.tile.screen';
  const tb = await (await Q.$(tileSel)).boundingBox(); await Q.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(300);
  await Q.evaluate(() => [...document.querySelectorAll('.tile.screen .sctl button')].find(b => b.title === 'Mais opções').click());
  await sleep(400); await Q.screenshot({ path: OUT + '/01-menu.png' });
  const items = await Q.evaluate(() => [...document.querySelectorAll('.menu .it')].map(x => ({ t: x.querySelector('.mlab, .itl > span')?.textContent || x.textContent, ic: !!x.querySelector('.mic') })));
  ok(items.length && items.every(i => i.ic), 'menu: todo item com ícone', items.map(i => i.t));
  ok(items.every(i => i.t.length <= 20), 'menu: rótulos curtos', items.map(i => i.t));
  await Q.evaluate(() => [...document.querySelectorAll('.menu .it')].find(x => /Desenhar/.test(x.textContent)).click());
  await sleep(800);
  const st1 = await Q.evaluate(() => { const t = document.querySelector('.tile.screen'); return { annot: t.classList.contains('annotating'), focus: t.classList.contains('focus'), sctl: getComputedStyle(t.querySelector('.sctl')).display, bar: !!t.querySelector('.annot-bar .bcompact'), bg: getComputedStyle(t.querySelector('canvas.board')).backgroundColor }; });
  ok(st1.annot && st1.focus, 'desenhar: o quadro vai para o destaque', st1);
  ok(st1.sctl === 'none' && st1.bar, 'desenhar: só a barra compacta (sem os outros botões por cima)', st1);
  ok(st1.bg === 'rgba(0, 0, 0, 0)', 'desenho transparente sobre o vídeo', st1.bg);
  const c = await Q.$('.tile canvas.board.drawing'); const r = await c.boundingBox();
  await Q.mouse.move(r.x + r.width * .25, r.y + r.height * .5); await Q.mouse.down();
  for (let i = 0; i <= 20; i++) await Q.mouse.move(r.x + r.width * (.25 + i * .025), r.y + r.height * (.5 + Math.sin(i / 3) * .15));
  await Q.mouse.up(); await sleep(600);
  await Q.screenshot({ path: OUT + '/02-desenho.png' });
  // zoom com a roda do mouse durante o desenho: o vídeo e o desenho acompanham juntos
  await Q.mouse.move(r.x + r.width * .5, r.y + r.height * .5);
  for (let i = 0; i < 4; i++) { await Q.mouse.wheel({ deltaY: -120 }); await sleep(80); }
  await sleep(400);
  const z = await Q.evaluate(() => { const t = document.querySelector('.tile.screen'); return { v: t.querySelector('video').style.transform, c: t.querySelector('canvas.board').style.transform, still: t.classList.contains('annotating') }; });
  ok(z.v && z.v === z.c && z.still, 'zoom com a roda do mouse sem sair do desenho (desenho acompanha o vídeo)', z);
  await Q.screenshot({ path: OUT + '/03-zoom.png' });
  await Q.keyboard.press('Escape'); await sleep(500);
  ok(await Q.evaluate(() => !document.querySelector('.tile.screen.annotating')), 'Esc termina o desenho');
  // quem transmite, com a prévia pausada: desenhar mostra o vídeo (antes ficava o fundo colorido do perfil)
  await P.bringToFront();
  const pt = await (await P.$('.tile.screen')).boundingBox(); await P.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2); await sleep(300);
  await P.evaluate(() => [...document.querySelectorAll('.tile.screen .sctl button')].find(b => b.title === 'Mais opções').click()); await sleep(300);
  await P.evaluate(() => [...document.querySelectorAll('.menu .it')].find(x => /Desenhar/.test(x.textContent)).click()); await sleep(1200);
  const own = await P.evaluate(() => { const t = document.querySelector('.tile.screen'); return { video: !!t.querySelector('video'), pause: !!t.querySelector('.selfpause'), canvas: !!t.querySelector('canvas.board.drawing') }; });
  ok(own.video && !own.pause && own.canvas, 'quem transmite: desenha sobre a própria tela (sem o fundo colorido)', own);
  await P.screenshot({ path: OUT + '/04-proprio.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
