// Clipe da transmissão de OUTRA pessoa sem recomprimir (public/cliptap-worker.js + clipbuf.js createTapBuffer): quem
// assiste guarda os quadros comprimidos como chegam do servidor (aqui VP8, de uma transmissão pelo Chromium) e grava só o
// áudio. Confere: o buffer é o dos quadros recebidos; pede quadro-chave ao servidor (que limita por transmissão); o
// clipe tem o vídeo na taxa da transmissão e o áudio, o ffmpeg e um <video> leem, corte rápido e exato funcionam; o
// vídeo na tela segue normal com o worker no meio e depois que ele sai; sem RTCRtpScriptTransform, volta ao MediaRecorder.
// O caminho H.264 (transmissão pelo programa nativo) está em scripts/native-clip-test.mjs.
// Uso: node scripts/clip-tap-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyframeTimes, trimWebm } from '../public/webm.js';

const PORT = 3249, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-tap-'));
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const decodeErrors = (f) => { try { return execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return String(e.stderr || e.message).trim() || 'falhou'; } };
const countFrames = (f) => +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim();

fs.rmSync('.testdata-tap', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-tap', RTC_PORT: '41030', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
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
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /^Transmitir$/.test(x.textContent.trim()))?.click());
  // bruno assiste (clipes das transmissões dos outros: ligados por padrão)
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, a.id);
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  const key = 's:' + a.id;
  await B.waitForFunction(async (key) => !!(await window.__lc.import('clips.js')).clipInfo(key), { timeout: 15000 }, key).catch(() => { });
  const i1 = await info(B, key);
  ok(i1?.mode === 'tap' && i1.limiter === 'quadros recebidos', 'quem assiste grava os quadros como chegam (sem MediaRecorder no vídeo)', i1);
  const codec = await B.evaluate((uid) => [...window.__lc.voice.sfu.consumers.values()].find(x => x.uid === uid && x.source === 'screen')?.c.rtpParameters.codecs[0].mimeType, a.id);
  ok(/vp8|h264/i.test(codec || ''), 'transmissão pelo Chromium chega em VP8 ou H.264', codec);
  ok(await decoded(B, a.id) >= 20, 'o vídeo na tela continua decodificando com o worker no meio (~30 fps)');
  await sleep(9000);
  const saved = await B.evaluate(async (key, cid) => {
    const m = await window.__lc.import('clips.js'), L = await window.__lc.import('cliplocal.js');
    let cap = null; await m.saveClip(key, 4, { channelId: cid, who: 'alice', onCaptured: (ok, why) => { cap = { ok, why }; } });
    const c = (await L.listLocalClips())[0]; if (!c) return { cap };
    const bytes = new Uint8Array(await c.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { cap, hasAudio: c.hasAudio, size: bytes.length, b64: btoa(s), last: m.clipInfo(key)?.last };
  }, key, vch.id);
  if (!saved.cap?.ok) console.log('  motivo:', JSON.stringify(await info(B, key)));
  ok(saved.cap?.ok && saved.size > 20000, 'atalho do clipe: capturado e guardado no aparelho', { cap: saved.cap, size: saved.size, last: saved.last });
  ok(saved.last?.src?.keyAsks >= 1, 'pediu quadro-chave ao servidor (o Chromium não manda um sozinho)', saved.last?.src);
  const cf = path.join(TMP, 'clipe.webm'); if (saved.b64) fs.writeFileSync(cf, Buffer.from(saved.b64, 'base64'));
  const pr = saved.b64 ? probe(cf) : { streams: [], format: {} }, vs = pr.streams.find(s => s.codec_type === 'video'), as = pr.streams.find(s => s.codec_type === 'audio');
  ok(vs && /vp8|h264/.test(vs.codec_name) && vs.width >= 640, 'vídeo do clipe: os quadros da transmissão', vs && [vs.codec_name, vs.width, vs.height]);
  ok(as?.codec_name === 'opus' && saved.hasAudio, 'com o áudio (Opus, gravado aqui)', { a: as?.codec_name, hasAudio: saved.hasAudio });
  const dur = +pr.format.duration;
  // começa no quadro-chave anterior ao pedido: com o servidor mandando um a cada ~4-5 s, até ~5 s a mais
  ok(dur >= 4 && dur <= 10, 'duração: os 4 s pedidos, voltando até o quadro-chave anterior', dur);
  const nf = saved.b64 ? countFrames(cf) : 0;
  ok(nf / dur > 22, 'na taxa da transmissão (~30 fps)', Math.round(nf / dur));
  ok(saved.b64 && !decodeErrors(cf), 'o ffmpeg decodifica o clipe inteiro sem erro', saved.b64 ? decodeErrors(cf).slice(0, 200) : '');
  const ap = saved.b64 && JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', cf]).toString()).packets[0];
  ok(ap && +ap.pts_time < 0.1, 'áudio começa junto com o vídeo', ap);
  const bytes = saved.b64 ? new Uint8Array(Buffer.from(saved.b64, 'base64')) : new Uint8Array(0), kt = keyframeTimes(bytes);
  ok(kt[0] === 0, 'o clipe começa num quadro-chave', kt);
  const tr = kt.length > 1 ? trimWebm(bytes, kt[1], kt[1] + 800) : trimWebm(bytes, 0, 1000), tf = path.join(TMP, 'corte.webm');
  if (tr) fs.writeFileSync(tf, tr.bytes);
  ok(tr && !decodeErrors(tf), 'corte rápido funciona', tr && { start: tr.startMs, end: tr.endMs });
  const play = await B.evaluate(async () => {
    const L = await window.__lc.import('cliplocal.js'), R = await window.__lc.import('cliprecode.js'), c = (await L.listLocalClips())[0];
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(c.blob); document.body.append(v);
    await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
    const meta = { w: v.videoWidth, h: v.videoHeight, err: v.error?.message || null };
    try { await v.play(); await new Promise(r => setTimeout(r, 600)); meta.played = v.currentTime > 0.2; } catch (e) { meta.played = 'erro: ' + e.message; }
    v.remove();
    let exact = null;
    try { const r = await R.exactTrim(new Uint8Array(await c.blob.arrayBuffer()), 1200, 2800); exact = { start: r.startMs, end: r.endMs, size: r.bytes.length }; } catch (e) { exact = { error: e.message }; }
    return { meta, exact };
  });
  ok(play.meta.w >= 640 && play.meta.played === true, 'o clipe abre e toca num <video>', play.meta);
  ok(play.exact && !play.exact.error, 'corte exato (WebCodecs) funciona', play.exact);
  // o servidor limita os pedidos de quadro-chave por transmissão
  const lim = await B.evaluate(async (uid) => { const v = window.__lc.voice, e = [...v.sfu.consumers.values()].find(x => x.uid === uid && x.source === 'screen'); const r1 = await v.sfuReq('keyframe', { consumer_id: e.c.id }); const r2 = await v.sfuReq('keyframe', { consumer_id: e.c.id }); return [r1, r2]; }, a.id);
  ok(!lim[1].ok && lim[1].wait > 0, 'servidor: no máximo um quadro-chave pedido por transmissão a cada ~4 s', lim);
  // desligar os clipes: o worker para de guardar (fica no receptor só deixando passar: o Chromium não o religaria) e o vídeo continua
  await B.evaluate(async () => { const L = window.__lc; L.S.prefs.clipsOn = false; (await L.import('clips.js')).stopAllBuffers(); });
  await sleep(500);
  ok(!(await info(B, key)), 'clipes desligados: nenhum buffer');
  ok(await decoded(B, a.id) >= 20, 'e o vídeo segue decodificando normal');
  // religados: o mesmo worker volta a guardar (sem precisar receber a transmissão de novo)
  await B.evaluate(() => { const L = window.__lc; delete L.S.prefs.clipsOn; document.dispatchEvent(new Event('voice-rerender')); });
  await B.waitForFunction(async (key) => (await window.__lc.import('clips.js')).clipInfo(key)?.mode === 'tap', { timeout: 10000 }, key).catch(() => { });
  ok((await info(B, key))?.mode === 'tap', 'religados: volta a guardar os quadros recebidos');
  // navegador sem RTCRtpScriptTransform (transmissão recebida depois disso): volta ao MediaRecorder, sem ficar tentando
  await B.evaluate(() => { window.__RST = window.RTCRtpScriptTransform; window.RTCRtpScriptTransform = undefined; });
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1500); // para
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: true })); // e transmite de novo
  await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"] video`), { timeout: 15000 }, a.id).catch(() => { });
  await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id);
  await B.waitForFunction(async (key) => !!(await window.__lc.import('clips.js')).clipInfo(key), { timeout: 15000 }, key).catch(() => { });
  const i2 = await info(B, key);
  ok(i2?.mode === 'rec', 'sem o encaixe no receptor: grava pelo MediaRecorder como antes', i2 && { mode: i2.mode, limiter: i2.limiter });
  await B.evaluate(() => { window.RTCRtpScriptTransform = window.__RST; });
} catch (e) { console.log('  EXCEÇÃO', e.stack || e.message); fails++; }
await browser.close(); srv.kill();
fs.rmSync('.testdata-tap', { recursive: true, force: true }); fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
