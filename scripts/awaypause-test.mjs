// Janela longe (awaypause.js): minimizada ou fora de foco, os GIFs do chat viram o primeiro quadro, vídeos tocando sem som
// pausam e o de com som continua; voltando, o GIF anima de novo e o vídeo sem som volta a tocar. Fora de foco só conta
// depois de um tempo (alt-tab rápido não pisca nada). Com a opção desligada, nada para.
// Uso: BROWSER=<chrome> node scripts/awaypause-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
const PORT = 3341, MOCK = 3342, BASE = `http://localhost:${PORT}`, DIR = './.testdata-away';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-t', '1', DIR + '/a.gif']);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '3', '-c:v', 'libvpx', '-c:a', 'libopus', DIR + '/v.webm']);
const mock = http.createServer((req, res) => {
  const f = DIR + '/' + new URL(req.url, 'http://x').pathname.split('/').pop();
  if (!/\.(gif|webm)$/.test(f) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.gif') ? 'image/gif' : 'video/webm', 'access-control-allow-origin': '*' }); res.end(fs.readFileSync(f));
}).listen(MOCK);
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR + '/data', RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); mock.close(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status }; } });
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const a = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const g = await call(a.token, 'POST', '/guilds', { name: 'Turma' });
  const GIF = `http://127.0.0.1:${MOCK}/a.gif`;
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  // o navegador sem janela não perde foco de verdade: o teste controla hasFocus/hidden
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; window.__focus = true; window.__hidden = false;
    Document.prototype.hasFocus = function () { return window.__focus; };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden }); }, a.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  const ch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: GIF });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch.id);
  await p.waitForFunction(() => document.querySelector('#msgs .gifmsg img')?.complete, { timeout: 15000 });
  // dois vídeos no chat: um em loop sem som, outro com som (a pessoa está ouvindo)
  await p.evaluate((src) => { const box = document.querySelector('#msgs');
    for (const [id, muted] of [['vmute', true], ['vsound', false]]) { const v = document.createElement('video'); v.id = id; v.src = src; v.loop = true; v.muted = muted; v.style.width = '160px'; box.append(v); v.play(); } }, `http://127.0.0.1:${MOCK}/v.webm`);
  await p.waitForFunction(() => !document.querySelector('#vmute').paused && !document.querySelector('#vsound').paused, { timeout: 10000 });
  const st = () => p.evaluate(() => ({ gif: document.querySelector('#msgs .gifmsg img').getAttribute('src').slice(0, 22), mute: document.querySelector('#vmute').paused, sound: document.querySelector('#vsound').paused }));
  const animated = (s) => s.gif.startsWith('http'), still = (s) => s.gif.startsWith('data:image/png');

  // alt-tab rápido: nada muda
  await p.evaluate(() => { window.__focus = false; dispatchEvent(new Event('blur')); }); await sleep(500);
  await p.evaluate(() => { window.__focus = true; dispatchEvent(new Event('focus')); }); await sleep(1500);
  let s = await st(); ok(animated(s) && !s.mute, 'fora de foco por meio segundo: nada para', s);
  // fora de foco de verdade
  await p.evaluate(() => { window.__focus = false; dispatchEvent(new Event('blur')); }); await sleep(2200);
  s = await st(); ok(still(s), 'fora de foco: o GIF vira o primeiro quadro', s);
  ok(s.mute && !s.sound, 'fora de foco: vídeo sem som pausa, com som continua', s);
  // mensagem nova com GIF chegando enquanto está longe também fica parada
  await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: GIF + '?2' });
  await p.waitForFunction(() => document.querySelectorAll('#msgs .gifmsg img').length === 2, { timeout: 8000 }); await sleep(600);
  ok(await p.evaluate(() => document.querySelectorAll('#msgs .gifmsg img')[1].getAttribute('src').startsWith('data:')), 'GIF que chega com a janela longe já entra parado');
  // volta
  await p.evaluate(() => { window.__focus = true; dispatchEvent(new Event('focus')); }); await sleep(600);
  s = await st(); ok(animated(s) && !s.mute && !s.sound, 'voltando: GIF anima e o vídeo sem som volta a tocar', s);
  ok(await p.evaluate(() => [...document.querySelectorAll('#msgs .gifmsg img')].every(i => i.getAttribute('src').startsWith('http'))), 'voltando: todos os GIFs voltam ao endereço original');
  // minimizada: vale na hora
  await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(400);
  s = await st(); ok(still(s) && s.mute, 'minimizada: para na hora', s);
  await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(400);
  s = await st(); ok(animated(s) && !s.mute, 'restaurada: volta', s);
  // vídeo que a pessoa pausou antes de sair não volta a tocar sozinho
  await p.evaluate(() => document.querySelector('#vmute').pause());
  await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(300);
  await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(400);
  ok((await st()).mute, 'vídeo pausado pela pessoa continua pausado ao voltar');
  await p.evaluate(() => document.querySelector('#vmute').play());
  // opção desligada
  await p.evaluate(() => { window.__lc.S.prefs.awayPause = false; });
  await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(400);
  s = await st(); ok(animated(s) && !s.mute, 'com "Pausar GIFs e vídeos fora de foco" desligado, nada para', s);
} finally { await browser.close(); }
console.log(fails ? `${fails} falha(s)` : 'tudo certo'); process.exit(fails ? 1 : 0);
