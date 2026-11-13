// Capturas do bot de música: sala com o bot, painel (Fila, Histórico, Playlists) e pausado.
// Sem YouTube: músicas geradas pelo ffmpeg e servidas por HTTP local (MUSIC_ALLOW_ANY=1).
// Uso: BROWSER=/caminho/do/chrome node scripts/music-shots.mjs  (saída em .testshots/music)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 3296, BASE = `http://localhost:${PORT}`, DATA = './.testdata-musicshots', MEDIA = './.testmedia-musicshots', OUT = '.testshots/music';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(MEDIA, { recursive: true, force: true }); fs.mkdirSync(MEDIA, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const songs = [['Noite de Verão', 440, 214], ['Céu de Neon', 523, 187], ['Estrada Longa', 659, 242], ['Café da Manhã', 392, 176], ['Último Trem', 587, 203]];
for (const [n, hz, secs] of songs) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '2', '-c:a', 'libopus', '-b:a', '32k', path.join(MEDIA, n + '.webm')]);
const media = http.createServer((req, res) => { const f = path.join(MEDIA, decodeURIComponent(req.url.slice(1))); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MURL = (n) => `http://127.0.0.1:${media.address().port}/${encodeURIComponent(n + '.webm')}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41095', RTC_IPS: '127.0.0.1', MUSIC_ALLOW_ANY: '1', YTDLP_REMOTE_EJS: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => (await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' })).token;
let browser;
try {
  const ta = await reg('ana'), tb = await reg('beto');
  const g = await call(ta, 'POST', '/guilds', { name: 'Resenha' }); await call(tb, 'POST', '/invites/' + (await call(ta, 'POST', `/guilds/${g.id}/invites`)).code);
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (tok) => { const c = await browser.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 }); await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; };
  const A = await open(ta), B = await open(tb);
  const v1 = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  for (const P of [A, B]) await P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, v1);
  await sleep(2000);
  const cmd = (op, extra) => A.evaluate(async (op, extra) => (await window.__lc.import('music.js')).musicCmd(op, extra), op, extra);
  const st = () => A.evaluate(async () => JSON.parse(JSON.stringify((await window.__lc.import('music.js')).musicState())));
  const waitPlaying = async (title) => { for (let t = 0; t < 20000; t += 400) { const s = await st(); if (s?.current?.title === title && !s.loading) return; await sleep(400); } };
  // histórico: toca duas e pula
  await cmd('play', { query: MURL('Café da Manhã') }); await waitPlaying('Café da Manhã');
  await cmd('play', { query: MURL('Último Trem') }); await cmd('skip'); await waitPlaying('Último Trem');
  // playlist salva
  for (const n of ['Noite de Verão', 'Céu de Neon', 'Estrada Longa']) await cmd('play', { query: MURL(n) });
  await cmd('pl_save', { name: 'Resenha de sexta' });
  await cmd('skip'); await waitPlaying('Noite de Verão');
  await cmd('seek', { ms: 83000 }); await waitPlaying('Noite de Verão'); await sleep(1500);
  await A.bringToFront();
  await A.screenshot({ path: `${OUT}/01-sala-com-o-bot.png` });
  const btn = () => A.evaluate(() => [...document.querySelectorAll('button')].find(x => x.title === 'Música: tocar no canal de voz').click());
  await btn(); await sleep(900);
  await A.screenshot({ path: `${OUT}/02-painel-fila.png` });
  const tab = (n) => A.evaluate((n) => [...document.querySelectorAll('.mutab')].find(t => t.textContent.startsWith(n))?.click(), n);
  await tab('Histórico'); await sleep(500); await A.screenshot({ path: `${OUT}/03-painel-historico.png` });
  await tab('Playlists'); await sleep(500); await A.screenshot({ path: `${OUT}/04-painel-playlists.png` });
  await tab('Fila'); await cmd('pause'); await sleep(900); await A.screenshot({ path: `${OUT}/05-pausado.png` });
  console.log('ok');
} catch (e) { console.log('ERRO', e); }
await browser?.close(); srv.kill(); media.close(); setTimeout(() => process.exit(0), 300);
