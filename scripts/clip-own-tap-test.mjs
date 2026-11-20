// Clipe da SUA transmissão pelo Chromium sem recomprimir (voice.js sfuProduce/ownTap + cliptap-worker.js side 'send'):
// com os clipes da própria transmissão ligados, os quadros que o enviador acabou de comprimir vão para o buffer, em vez
// do MediaRecorder comprimir a tela de novo. Confere: o buffer é o dos quadros enviados; só a camada maior do simulcast
// entra (largura cheia); o quadro-chave vem do próprio codificador; o clipe tem o vídeo na taxa da transmissão e o
// áudio, o ffmpeg lê sem erro e começa num quadro-chave; quem assiste continua recebendo normal com o worker no meio;
// sem RTCRtpScriptTransform, ou clipes ligados com a transmissão já no ar, volta ao MediaRecorder como antes.
// Uso: node scripts/clip-own-tap-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyframeTimes } from '../public/webm.js';

const PORT = 3277, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-owntap-'));
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const decodeErrors = (f) => { try { return execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return String(e.stderr || e.message).trim() || 'falhou'; } };
const countFrames = (f) => +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim();

fs.rmSync('.testdata-owntap', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-owntap', RTC_PORT: '41141', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function page(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((tok) => {
    localStorage.lc_token = tok;
    // tela falsa a 30 fps com movimento (quadros diferentes) e som do sistema (um tom)
    navigator.mediaDevices.getDisplayMedia = async (c) => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const x = cv.getContext('2d'); let n = 0;
      setInterval(() => { x.fillStyle = `hsl(${n % 360},60%,35%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.fillText(String(n), 60, 200); x.fillRect((n * 17) % 1200, 500, 80, 80); n++; }, 33);
      const s = cv.captureStream(30);
      if (c?.audio !== false) { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]); }
      return s;
    };
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const info = (P, key) => P.evaluate(async (key) => (await window.__lc.import('clips.js')).clipInfo(key), key);
const decoded = (P, uid) => P.evaluate(async (uid) => {
  const v = window.__lc.voice, e = [...v.sfu.consumers.values()].filter(x => x.uid === uid && x.source === 'screen').at(-1);
  const rd = async () => { let n = 0; (await e.c.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') n = r.framesDecoded; }); return n; };
  const a = await rd(); await new Promise(r => setTimeout(r, 2000)); return Math.round((await rd() - a) / 2);
}, uid);
const stream = async (A, on) => { if (!on) { await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1200); return; } await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: true })); await sleep(1500); };
const save = (A, key, cid) => A.evaluate(async (key, cid) => {
  const m = await window.__lc.import('clips.js'), L = await window.__lc.import('cliplocal.js');
  let cap = null; await m.saveClip(key, 4, { channelId: cid, who: 'alice', onCaptured: (ok, why) => { cap = { ok, why }; } });
  const c = (await L.listLocalClips())[0]; if (!c) return { cap };
  const bytes = new Uint8Array(await c.blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { cap, hasAudio: c.hasAudio, size: bytes.length, b64: btoa(s), last: m.clipInfo(key)?.last };
}, key, cid);
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogo' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const A = await page(a.tok), B = await page(b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }
  await A.evaluate(() => { window.__lc.S.prefs.clipsOn = true; }); // clipes da própria transmissão (desligados por padrão)
  await stream(A, true);
  const key = 's:' + a.id;
  await A.waitForFunction(async (key) => !!(await window.__lc.import('clips.js')).clipInfo(key), { timeout: 15000 }, key).catch(() => { });
  const i1 = await info(A, key);
  ok(i1?.mode === 'tap' && i1.limiter === 'quadros enviados', 'quem transmite guarda os quadros que o enviador comprimiu (sem MediaRecorder no vídeo)', i1 && { mode: i1.mode, limiter: i1.limiter });
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  await sleep(1500);
  ok(await decoded(B, a.id) >= 20, 'quem assiste continua recebendo ~30 fps com o worker no enviador');
  await sleep(8000);
  const saved = await save(A, key, vch.id);
  if (!saved.cap?.ok) console.log('  motivo:', JSON.stringify(await info(A, key)));
  ok(saved.cap?.ok && saved.size > 20000, 'clipe capturado e guardado no aparelho', { cap: saved.cap, size: saved.size });
  ok(saved.last?.src?.keys >= 1, 'o buffer tem quadro-chave (pedido ao próprio codificador)', saved.last?.src);
  const cf = path.join(TMP, 'clipe.webm'); if (saved.b64) fs.writeFileSync(cf, Buffer.from(saved.b64, 'base64'));
  const pr = saved.b64 ? probe(cf) : { streams: [], format: {} }, vs = pr.streams.find(s => s.codec_type === 'video'), as = pr.streams.find(s => s.codec_type === 'audio');
  ok(vs && /vp8|h264/.test(vs.codec_name) && vs.width === 1280 && vs.height === 720, 'vídeo do clipe: a camada maior (1280x720), não as menores do simulcast', vs && [vs.codec_name, vs.width, vs.height]);
  ok(as?.codec_name === 'opus' && saved.hasAudio, 'com o áudio (Opus)', { a: as?.codec_name, hasAudio: saved.hasAudio });
  const dur = +pr.format.duration;
  ok(dur >= 4 && dur <= 10, 'duração: os 4 s pedidos, voltando até o quadro-chave anterior', dur);
  const nf = saved.b64 ? countFrames(cf) : 0;
  ok(nf / dur > 22, 'na taxa da transmissão (~30 fps)', Math.round(nf / dur));
  ok(saved.b64 && !decodeErrors(cf), 'o ffmpeg decodifica o clipe inteiro sem erro', saved.b64 ? decodeErrors(cf).slice(0, 200) : '');
  const bytes = saved.b64 ? new Uint8Array(Buffer.from(saved.b64, 'base64')) : new Uint8Array(0), kt = keyframeTimes(bytes);
  ok(kt[0] === 0, 'o clipe começa num quadro-chave', kt.slice(0, 3));
  const ap = saved.b64 && JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', cf]).toString()).packets[0];
  ok(ap && +ap.pts_time < 0.1, 'áudio começa junto com o vídeo', ap);
  // parar e transmitir de novo: novo enviador, novo encaixe
  await stream(A, false);
  ok(!(await A.evaluate(() => !!window.__lc.voice._ownTap)), 'parar a transmissão encerra o encaixe');
  await stream(A, true);
  await A.waitForFunction(async (key) => (await window.__lc.import('clips.js')).clipInfo(key)?.mode === 'tap', { timeout: 10000 }, key).catch(() => { });
  ok((await info(A, key))?.mode === 'tap', 'transmitindo de novo: volta a guardar os quadros enviados');
  // clipes ligados com a transmissão já no ar: o enviador não tem encaixe -> MediaRecorder, como antes
  await stream(A, false); await A.evaluate(() => { window.__lc.S.prefs.clipsOn = false; }); await stream(A, true);
  await A.evaluate(() => { window.__lc.S.prefs.clipsOn = true; document.dispatchEvent(new Event('voice-rerender')); });
  await A.waitForFunction(async (key) => !!(await window.__lc.import('clips.js')).clipInfo(key), { timeout: 10000 }, key).catch(() => { });
  ok((await info(A, key))?.mode === 'rec', 'clipes ligados com a transmissão no ar: MediaRecorder, como antes');
  // navegador sem RTCRtpScriptTransform: MediaRecorder
  await stream(A, false); await A.evaluate(() => { window.__RST = window.RTCRtpScriptTransform; window.RTCRtpScriptTransform = undefined; }); await stream(A, true);
  await A.waitForFunction(async (key) => !!(await window.__lc.import('clips.js')).clipInfo(key), { timeout: 10000 }, key).catch(() => { });
  ok((await info(A, key))?.mode === 'rec', 'sem o encaixe: grava pelo MediaRecorder como antes');
} catch (e) { console.log('  EXCEÇÃO', e.stack || e.message); fails++; }
await browser.close(); srv.kill();
fs.rmSync('.testdata-owntap', { recursive: true, force: true }); fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
