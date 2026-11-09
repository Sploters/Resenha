// Player e mídia: upload de MP4 com o índice no fim sai com o índice no começo; .mov vira .mp4; links do YouTube/Shorts/
// TikTok/Instagram viram cartão; vídeo em pé ganha "Tela vertical"; toque duplo nos lados pula 10 s e soma; segurar = 2×;
// o visualizador vertical abre, carrega só o vídeo da vez e fecha com Esc.
// Uso: node scripts/media-test.mjs (BROWSER=<caminho do Chrome/Edge>; precisa do ffmpeg)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createThumbs } from '../server/thumbs.js';
const PORT = 3291, BASE = `http://localhost:${PORT}`, DATA = './.testdata-media';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA + '/tmp', { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '40', '-c:v', 'libx264', '-c:a', 'aac', DATA + '/tmp/deitado.mp4');
ff('-f', 'lavfi', '-i', 'testsrc=size=240x426:rate=30', '-t', '3', '-c:v', 'libx264', DATA + '/tmp/empe.mov');

const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const up = (tok, file, name, type) => fetch(BASE + '/api/upload?name=' + encodeURIComponent(name), { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': type }, body: fs.readFileSync(file) }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'senha123' }) }).then(x => x.json());
  const g = await call(r.token, 'POST', '/guilds', { name: 'Turma' });

  // --- upload ---
  const t = createThumbs(DATA + '/tmp');
  ok(!t.moovFirst(DATA + '/tmp/deitado.mp4'), 'MP4 de teste começa com o índice no fim');
  const a = await up(r.token, DATA + '/tmp/deitado.mp4', 'deitado.mp4', 'video/mp4');
  const fa = a.url.split('/')[2];
  ok(t.moovFirst(DATA + '/uploads/' + fa) || t.moovFirst(fs.readdirSync(DATA, { recursive: true }).map(f => DATA + '/' + f).find(f => f.endsWith(fa))), 'upload: índice foi para o começo', a.url);
  const b = await up(r.token, DATA + '/tmp/empe.mov', 'Gravação do iPhone.mov', 'video/quicktime');
  ok(/\.mp4\//.test(b.url) && b.name === 'Gravação do iPhone.mp4' && b.type === 'video/mp4', '.mov virou .mp4', b);

  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 860 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tk) => { localStorage.lc_token = tk; }, r.token);
  // os sites de fora não são acessíveis no teste: responde vazio
  await p.setRequestInterception(true);
  p.on('request', q => (new URL(q.url()).origin === BASE ? q.continue() : q.respond({ status: 200, contentType: 'text/html', body: '<body style="background:#222"></body>' })));
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  const tch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  await call(r.token, 'POST', `/channels/${tch.id}/messages`, { content: 'olha', attachments: [a] });
  await call(r.token, 'POST', `/channels/${tch.id}/messages`, { content: 'em pé', attachments: [b] });
  await call(r.token, 'POST', `/channels/${tch.id}/messages`, { content: 'https://www.youtube.com/shorts/dQw4w9WgXcQ e https://www.tiktok.com/@alguem/video/7300000000000000000' });
  await call(r.token, 'POST', `/channels/${tch.id}/messages`, { content: 'https://youtu.be/dQw4w9WgXcQ?t=1m5s https://www.instagram.com/reel/Cabc123xyz/ https://example.com/x' });

  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); await sleep(1500);

  const cards = await p.$$eval('#msgs .sembed', els => els.map(e => e.className));
  ok(cards.length === 4, '4 cartões de vídeo (Shorts, TikTok, YouTube, Reels)', cards);
  ok(cards.filter(c => c.includes('vert')).length === 3, '3 em pé', cards);
  const yt = await p.$eval('#msgs .sembed.se-youtube', e => e._video.embed);
  ok(/start=65/.test(yt), 'YouTube respeita o ?t=', yt);
  await p.click('#msgs .sembed.se-youtube .se-play'); await sleep(200);
  ok(await p.$eval('#msgs .sembed.se-youtube', e => !!e.querySelector('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')), 'play troca pelo player do site');
  await sleep(1500);
  ok(await p.$$eval('#msgs .attach .fsvid', els => els.some(e => e.classList.contains('vert'))), 'vídeo enviado em pé detectado pela miniatura');

  // --- toque ---
  const tap = (sel, fx) => p.evaluate((sel, fx) => {
    const v = document.querySelector(sel), r = v.getBoundingClientRect(), x = r.left + r.width * fx, y = r.top + r.height / 2;
    for (const type of ['pointerdown', 'pointerup']) v.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerId: 7 }));
  }, sel, fx);
  const V = '#msgs .attach .fsvid:not(.vert) video';
  await p.evaluate((V) => { const v = document.querySelector(V); v.preload = 'auto'; v.load(); return new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })); }, V);
  await p.evaluate((V) => { document.querySelector(V).currentTime = 20; }, V); await sleep(200);
  await tap(V, 0.9); await sleep(80); await tap(V, 0.9); await sleep(150);
  let ct = await p.$eval(V, v => v.currentTime);
  ok(Math.abs(ct - 30) < 0.6, 'dois toques à direita: +10 s', ct);
  await tap(V, 0.9); await sleep(150); await tap(V, 0.9); await sleep(150);
  ct = await p.$eval(V, v => v.currentTime);
  ok(Math.abs(ct - 40) < 0.6 || ct >= 39, 'toques seguidos somam (+30 s, até o fim)', ct);
  ok(await p.$eval(V, v => v.parentElement.querySelector('.vc-seek.r').textContent), 'aviso "+N s" aparece', await p.$eval(V, v => v.parentElement.querySelector('.vc-seek.r').textContent));
  await sleep(900);
  await p.evaluate((V) => { document.querySelector(V).currentTime = 20; }, V); await sleep(100);
  await tap(V, 0.1); await sleep(80); await tap(V, 0.1); await sleep(150);
  ct = await p.$eval(V, v => v.currentTime);
  ok(Math.abs(ct - 10) < 0.6, 'dois toques à esquerda: −10 s', ct);
  await sleep(900);
  ok(await p.$eval(V, v => v.paused), 'toque duplo não deu play/pause');
  // segurar = 2×
  await p.evaluate((V) => { const v = document.querySelector(V); v.muted = true; return v.play(); }, V);
  await p.evaluate((V) => { const v = document.querySelector(V), r = v.getBoundingClientRect(); v.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true })); }, V);
  await sleep(600);
  ok(await p.$eval(V, v => v.playbackRate === 2 && v.parentElement.classList.contains('held')), 'segurar o dedo: 2×');
  await p.evaluate((V) => { const v = document.querySelector(V), r = v.getBoundingClientRect(); v.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true })); }, V);
  await sleep(400);
  ok(await p.$eval(V, v => v.playbackRate === 1 && !v.paused), 'soltar volta a 1× e continua tocando');
  await p.$eval(V, v => v.pause());

  // --- visualizador vertical ---
  await p.click('#msgs .sembed.se-shorts .se-btn'); await sleep(600);
  ok(!!await p.$('#shorts'), 'tela vertical abriu');
  const n = await p.$eval('#shorts .sh-count', e => e.textContent);
  ok(n === '2 / 4', 'lista os 4 em pé na ordem da conversa (Shorts é o 2º)', n);
  ok(await p.$$eval('#shorts .sh-media', els => els.filter(e => e.firstChild).length) === 1, 'só o da vez fica carregado');
  await p.keyboard.press('ArrowDown'); await sleep(1200);
  ok(await p.$eval('#shorts .sh-count', e => e.textContent) === '3 / 4', '↓ vai para o próximo');
  ok(await p.$$eval('#shorts .sh-media', els => els.filter(e => e.firstChild).length) === 1, 'o anterior foi descarregado');
  await p.keyboard.press('ArrowUp'); await sleep(1200); await p.keyboard.press('ArrowUp'); await sleep(1500);
  ok(await p.$eval('#shorts .sh-count', e => e.textContent) === '1 / 4' && !!await p.$('#shorts .sh-media video'), 'o vídeo enviado toca no visualizador');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  await p.keyboard.press('Escape'); await sleep(200);
  ok(!await p.$('#shorts'), 'Esc fecha');
} finally { await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
