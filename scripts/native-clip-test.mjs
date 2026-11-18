// Clipe da própria transmissão pelo programa nativo (native/lc-stream/src/replay.rs + public/clipbuf.js createNativeBuffer):
// o vídeo do clipe sai dos quadros H.264 que o programa JÁ comprimiu para a transmissão, sem o Chromium capturar e
// recomprimir a tela de novo. No Linux o programa usa um ffmpeg no lugar da captura + placa de vídeo.
// Parte 1 (sem navegador): o programa guarda o buffer, grava os últimos N s quando pedido (comando pela entrada padrão),
//   desliga e solta a memória; o arquivo vira um WebM com o áudio que o ffprobe/ffmpeg leem do começo ao fim.
// Parte 2 (app no navegador, app desktop simulado): transmitindo a 120 FPS com clipes próprios ligados, o buffer é o
//   nativo, a prévia do Chromium fica leve (10 fps), o clipe salvo tem o vídeo a ~120 fps e o áudio, abre num <video>, o
//   corte rápido e o exato (WebCodecs) funcionam; caindo para o Chromium, o buffer volta ao MediaRecorder.
// Uso: node scripts/native-clip-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { parseNativeClip, muxNativeClip } from '../public/clipbuf.js';
import { keyframeTimes, trimWebm } from '../public/webm.js';

const PORT = 3247, BASE = `http://localhost:${PORT}`;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: 'native/lc-stream', stdio: 'inherit' });
const BIN = 'native/lc-stream/target/release/lc-stream';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-clip-'));
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const decodeErrors = (f) => { try { return execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return String(e.stderr || e.message).trim() || 'falhou'; } };

// ---------- parte 1: o programa sozinho ----------
// programa como o app desktop abre: configuração em JSON na 1ª linha; eventos JSON por linha na saída
function program(cfg) {
  const p = spawn(BIN, ['--stdin'], { stdio: ['pipe', 'pipe', 'ignore'] }), waits = new Map(), events = [];
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let ev; try { ev = JSON.parse(l); } catch { continue; } events.push(ev); if (ev.t === 'clip') waits.get(ev.id)?.(ev); } });
  p.stdin.write(JSON.stringify(cfg) + '\n');
  let seq = 0;
  return {
    events, proc: p,
    send: (o) => p.stdin.write(JSON.stringify(o) + '\n'),
    clip: (secs) => new Promise((res) => { const id = ++seq, file = path.join(TMP, `c${id}.lcrb`); waits.set(id, (ev) => res({ ...ev, file })); p.stdin.write(JSON.stringify({ cmd: 'clip', id, secs, path: file }) + '\n'); setTimeout(() => res({ ok: false, error: 'sem resposta' }), 10000); }),
    stop: () => { try { p.stdin.write('stop\n'); p.stdin.end(); } catch { } },
  };
}
const sink = dgram.createSocket('udp4'); let packets = 0; sink.on('message', () => packets++);
await new Promise(r => sink.bind(0, '127.0.0.1', r));
{
  const P = program({ host: '127.0.0.1', port: sink.address().port, ssrc: 1111, pt: 102, fps: 60, height: 720, kbps: 4000, clipKeepMs: 6000 });
  await sleep(1500);
  const early = await P.clip(30);
  ok(early.ok, 'com 1 s de transmissão já dá para clipar (o que houver)', early.error);
  await sleep(7000);
  const t0 = Date.now(), c = await P.clip(3), took = Date.now() - t0;
  ok(c.ok && c.frames > 0, 'pedido de clipe responde com o arquivo', { ok: c.ok, error: c.error, frames: c.frames, bytes: c.bytes, ms: c.ms, took });
  ok(packets > 300, 'a transmissão continua saindo enquanto o buffer grava', packets);
  const nv = c.ok && parseNativeClip(fs.readFileSync(c.file));
  ok(nv && nv.w === 1280 && nv.h === 720, 'arquivo legível, com o tamanho da imagem tirado do SPS', nv && [nv.w, nv.h]);
  if (nv) {
    const span = nv.frames.at(-1).at - nv.frames[0].at, fps = (nv.frames.length - 1) / (span / 1000);
    ok(nv.frames[0].key, 'começa num quadro-chave');
    ok(span >= 3000 && span <= 5200, 'cobre os 3 s pedidos (voltando até o quadro-chave anterior, a cada 2 s)', Math.round(span));
    ok(fps > 55 && fps < 65, 'todos os quadros da transmissão (60 fps), sem recomprimir', Math.round(fps));
    ok(nv.frames.every((f, i) => !i || f.at > nv.frames[i - 1].at), 'tempos sempre crescendo');
    ok(Math.abs(nv.frames.at(-1).at - Date.now()) < 1500, 'tempo de cada quadro na hora do relógio (o mesmo Date.now() da página, para juntar com o áudio)', Math.round(Date.now() - nv.frames.at(-1).at));
    const all = parseNativeClip(fs.readFileSync((await P.clip(60)).file));
    const allSpan = all.frames.at(-1).at - all.frames[0].at;
    ok(allSpan <= 6100 && allSpan >= 4000, 'pedido maior que o buffer: só o que ele guarda (clipKeepMs 6 s)', Math.round(allSpan));

    // áudio como o MediaRecorder grava (WebM/Opus, tempo 0 no começo) começando 2 s antes do vídeo do clipe
    const aw = path.join(TMP, 'a.webm');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', aw]);
    const out = muxNativeClip(nv, { bytes: new Uint8Array(fs.readFileSync(aw)), anchor: nv.frames[0].at - 2000 });
    const of = path.join(TMP, 'clipe.webm'); fs.writeFileSync(of, out.bytes);
    const pr = probe(of), vs = pr.streams.find(s => s.codec_type === 'video'), as = pr.streams.find(s => s.codec_type === 'audio');
    ok(vs?.codec_name === 'h264' && vs.width === 1280 && vs.height === 720 && as?.codec_name === 'opus', 'WebM com o vídeo H.264 do programa e o áudio Opus', { v: vs && [vs.codec_name, vs.width, vs.height], a: as?.codec_name });
    ok(Math.abs(+pr.format.duration * 1000 - out.ms) < 150 && out.audio, 'duração = a do vídeo', { dur: +pr.format.duration, ms: out.ms });
    const err = decodeErrors(of);
    ok(!err, 'o ffmpeg decodifica o arquivo inteiro sem erro', err.slice(0, 300));
    const n = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', of]).toString().trim();
    ok(n === nv.frames.length, 'todos os quadros entraram', { lidos: n, quadros: nv.frames.length });
    // o áudio começa junto com o vídeo (o que veio antes ficou de fora), não 2 s adiantado
    const ap = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', of]).toString()).packets[0];
    ok(+ap.pts_time < 0.05, 'áudio alinhado pela hora: começa no início do clipe', ap);
    const kt = keyframeTimes(out.bytes);
    ok(kt.length >= 2 && kt[0] === 0, 'cortes podem começar em cada quadro-chave (cluster novo em cada um)', kt);
    const tr = trimWebm(out.bytes, kt[1], kt[1] + 1000);
    const tf = path.join(TMP, 'corte.webm'); if (tr) fs.writeFileSync(tf, tr.bytes);
    ok(tr && !decodeErrors(tf) && Math.abs(+probe(tf).format.duration - 1) < 0.1, 'corte rápido (sem recomprimir) funciona no clipe nativo', tr && { start: tr.startMs, end: tr.endMs });
    // sem áudio (ninguém fazendo som): só o vídeo
    const solo = muxNativeClip(nv, null), sf = path.join(TMP, 'solo.webm'); fs.writeFileSync(sf, solo.bytes);
    ok(!solo.audio && probe(sf).streams.length === 1 && !decodeErrors(sf), 'sem áudio: WebM só com o vídeo, válido');
  }
  // desligar solta a memória: pedido seguinte não acha nada
  P.send({ cmd: 'clipKeep', ms: 0 }); await sleep(300);
  const off = await P.clip(5);
  ok(!off.ok && /nao ha video/.test(off.error || ''), 'clipKeep 0 apaga o buffer', off.error);
  P.send({ cmd: 'clipKeep', ms: 4000 }); await sleep(2500);
  const on = await P.clip(5);
  ok(on.ok, 'religado, volta a guardar (a partir do próximo quadro-chave)', on.error);
  P.stop(); await sleep(500);
  ok(P.events.some(e => e.t === 'ended'), 'a transmissão termina normalmente');
  // sem clipKeepMs (app antigo / clipes desligados): não guarda nada
  const Q = program({ host: '127.0.0.1', port: sink.address().port, ssrc: 2222, pt: 102, fps: 30, height: 360, kbps: 800 });
  await sleep(2500);
  const none = await Q.clip(5);
  ok(!none.ok, 'sem clipes ligados o programa não guarda quadros', none.error);
  Q.stop();
}
sink.close();

// ---------- parte 2: o app (navegador + app desktop simulado) ----------
fs.rmSync('.testdata-nclip', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-nclip', RTC_PORT: '41020', RTC_IPS: '127.0.0.1', RTC_NATIVE_PORTS: '41021-41025' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const helpers = []; let keepMs = 0; const keeps = [];
// ponte do processo principal (desktop/native.js): liga o programa de verdade, passa o clipKeepMs, pede e lê o clipe
async function page(tok, desk) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  if (desk) {
    await p.exposeFunction('__natStart', (o) => new Promise((resolve) => {
      const cfg = { ...o, sourceId: undefined, window: 1234, ...(keepMs ? { clipKeepMs: keepMs } : {}) };
      const h = { cfg, P: program(cfg) }; helpers.push(h);
      const t = setInterval(() => { const ev = h.P.events.find(e => e.t === 'started' || e.t === 'error'); if (ev) { clearInterval(t); resolve(ev.t === 'started' ? { ok: true, ...ev } : { ok: false, error: ev.error }); } }, 50);
      h.P.proc.stdout.on('data', () => { for (const ev of h.P.events.splice(0)) { if (ev.t === 'started' || ev.t === 'error') h.P.events.push(ev); if (ev.t !== 'clip') p.evaluate((ev) => window.__natCb?.(ev), ev).catch(() => { }); } });
    }));
    await p.exposeFunction('__natStop', () => { for (const h of helpers) if (!h.stopped) { h.stopped = true; h.P.stop(); } });
    await p.exposeFunction('__natClipKeep', (ms) => { keepMs = ms; keeps.push(ms); for (const h of helpers) if (!h.stopped) h.P.send({ cmd: 'clipKeep', ms }); });
    await p.exposeFunction('__natClip', async (secs) => {
      const h = helpers.filter(x => !x.stopped).at(-1); if (!h) return { ok: false, error: 'parado' };
      const r = await h.P.clip(secs); if (!r.ok) return { ok: false, error: r.error };
      const b64 = fs.readFileSync(r.file).toString('base64'); fs.rmSync(r.file, { force: true });
      return { ok: true, b64, frames: r.frames, ms: r.ms };
    });
  }
  await p.evaluateOnNewDocument((tok, desk) => {
    localStorage.lc_token = tok;
    navigator.mediaDevices.getDisplayMedia = async (c) => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33);
      const s = cv.captureStream(30);
      if (c?.audio) { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]); }
      return s;
    };
    if (desk) {
      const fns = { isDesktop: true, getSettings: async () => ({}), getUpdate: async () => null, setThrottle: () => { },
        getSources: async () => [{ id: 'window:1234:0', name: 'Jogo', type: 'window', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
        selectSource: async () => true, nativeCapable: async () => ({ ok: true, encoders: ['teste'] }),
        nativeStart: (o) => window.__natStart(o), nativeStop: () => window.__natStop(), onNativeEvent: (cb) => { window.__natCb = cb; },
        nativeClipKeep: (ms) => { window.__natClipKeep(ms); },
        // o IPC do Electron entrega um Uint8Array; aqui vem em base64 pela ponte do teste
        nativeClip: async (secs) => { const r = await window.__natClip(secs); return r.ok ? { ...r, bytes: Uint8Array.from(atob(r.b64), c => c.charCodeAt(0)) } : r; } };
      window.lcDesktop = new Proxy(fns, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(true)) });
    }
  }, tok, desk);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Jogo' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  await call(b.tok, 'POST', '/invites/' + inv);
  const A = await page(a.tok, true), B = await page(b.tok, false);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 15000 });
  }
  await A.evaluate(() => { window.__lc.S.prefs.clipsOn = true; window.__lc.S.prefs.clipSecs = 15; });
  // transmitir: janela, 720p, 120 fps (pelo programa nativo)
  await A.evaluate(() => [...document.querySelectorAll('.roundbtn')].find(x => x.title.includes('Transmitir')).click()); await sleep(800);
  await A.evaluate(() => { [...document.querySelectorAll('.modal .seg button')].find(x => x.textContent.trim() === 'Janelas / aplicativos')?.click(); });
  await sleep(300); await A.evaluate(() => document.querySelector('.modal .source')?.click());
  await A.evaluate(() => { const cols = document.querySelectorAll('.modal .ssq-cols .seg'); [...cols[0].querySelectorAll('button')].find(x => x.textContent.trim() === '720')?.click(); [...cols[1].querySelectorAll('button')].find(x => x.textContent.trim() === '120')?.click(); });
  await sleep(200);
  await A.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(x => /^Transmitir$/.test(x.textContent.trim())).click());
  await A.waitForFunction(() => window.__lc.voice.native && !window.__lc.voice.native.pending, { timeout: 15000 }).catch(() => { });
  // o modo leve automático (jogo transmitido) desliga os clipes: religa, como quem os quer mesmo assim
  await A.evaluate(() => { const L = window.__lc; L.S.prefs.clipsOn = true; L.savePrefs(); document.dispatchEvent(new Event('voice-rerender')); });
  const key = 's:' + a.id;
  const info = () => A.evaluate(async (key) => (await window.__lc.import('clips.js')).clipInfo(key), key);
  await A.waitForFunction(async (key) => (await window.__lc.import('clips.js')).clipInfo(key)?.native, { timeout: 10000 }, key).catch(() => { });
  const i1 = await info();
  ok(i1?.native === true && i1.limiter === 'nativo', 'transmissão nativa com clipes próprios: o buffer é o do programa', i1);
  ok(helpers.length === 1 && keepMs === 65000 && (helpers[0].cfg.clipKeepMs === 65000 || keeps.includes(65000)), 'o programa recebe quanto guardar (60 s + folga)', { keepMs, cfg: helpers[0]?.cfg.clipKeepMs });
  const prev = await A.evaluate(() => window.__lc.voice.screen.getVideoTracks()[0].getConstraints());
  ok(prev.frameRate?.ideal === 10 && prev.height?.max === 360, 'a captura do Chromium continua só como prévia leve (10 fps, 360p): não grava o clipe', { fps: prev.frameRate?.ideal, h: prev.height?.max });
  await sleep(7000);
  // clipe pelo mesmo caminho do atalho (Configurações → Clipes: guardar neste aparelho)
  const saved = await A.evaluate(async (key, cid) => {
    const m = await window.__lc.import('clips.js'), L = await window.__lc.import('cliplocal.js');
    let cap = null; await m.saveClip(key, 5, { channelId: cid, who: 'alice', onCaptured: (ok, why) => { cap = { ok, why }; } });
    const c = (await L.listLocalClips())[0]; if (!c) return { cap };
    const bytes = new Uint8Array(await c.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { cap, hasAudio: c.hasAudio, size: bytes.length, b64: btoa(s), last: m.clipInfo(key)?.last };
  }, key, vch.id);
  ok(saved.cap?.ok && saved.size > 100000, 'atalho do clipe: capturado e guardado no aparelho', { cap: saved.cap, size: saved.size, last: saved.last });
  const cf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-clip-')), 'clipe.webm');
  if (saved.b64) fs.writeFileSync(cf, Buffer.from(saved.b64, 'base64'));
  const pr = saved.b64 ? probe(cf) : { streams: [], format: {} }, vs = pr.streams.find(s => s.codec_type === 'video'), as = pr.streams.find(s => s.codec_type === 'audio');
  ok(vs?.codec_name === 'h264' && vs.width === 1280 && vs.height === 720, 'vídeo do clipe: o H.264 da transmissão (1280x720)', vs && [vs.codec_name, vs.width, vs.height]);
  ok(as?.codec_name === 'opus' && saved.hasAudio, 'com o áudio da transmissão e da sala (Opus, gravado pelo Chromium)', { a: as?.codec_name, hasAudio: saved.hasAudio });
  const dur = +pr.format.duration;
  ok(dur >= 5 && dur <= 7.5, 'duração: os 5 s pedidos, voltando até o quadro-chave anterior', dur);
  const nf = saved.b64 ? +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', cf]).toString().trim() : 0;
  ok(nf / dur > 100, 'na taxa da transmissão (~120 fps), não nos 60 do clipe recomprimido', Math.round(nf / dur));
  ok(saved.b64 && !decodeErrors(cf), 'o ffmpeg decodifica o clipe inteiro sem erro');
  // o navegador abre o clipe e o editor corta exato (WebCodecs decodifica o H.264 com o avcC do programa)
  const play = await A.evaluate(async () => {
    const L = await window.__lc.import('cliplocal.js'), R = await window.__lc.import('cliprecode.js'), c = (await L.listLocalClips())[0];
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(c.blob); document.body.append(v);
    await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
    const meta = { w: v.videoWidth, h: v.videoHeight, err: v.error?.message || null };
    try { await v.play(); await new Promise(r => setTimeout(r, 600)); meta.played = v.currentTime > 0.2; } catch (e) { meta.played = 'erro: ' + e.message; }
    v.remove();
    let exact = null;
    try { const bytes = new Uint8Array(await c.blob.arrayBuffer()), r = await R.exactTrim(bytes, 1500, 3500); exact = { start: r.startMs, end: r.endMs, size: r.bytes.length }; } catch (e) { exact = { error: e.message }; }
    return { meta, exact };
  });
  ok(play.meta.w === 1280 && play.meta.played === true, 'o clipe abre e toca num <video> da página', play.meta);
  ok(play.exact && !play.exact.error && play.exact.size > 10000, 'corte exato (decodifica e recomprime o trecho) funciona no clipe nativo', play.exact);
  // queda do programa de vez: a transmissão volta ao Chromium e o clipe também (MediaRecorder), sem ficar sem buffer
  await A.evaluate(() => window.__lc.voice.nativeFallback('teste'));
  await A.waitForFunction(async (key) => { const i = (await window.__lc.import('clips.js')).clipInfo(key); return i && !i.native; }, { timeout: 10000 }, key).catch(() => { });
  const i2 = await info();
  ok(i2 && !i2.native && /webm/.test(i2.mime || ''), 'caiu para o Chromium: o clipe volta a ser gravado pelo MediaRecorder', i2);
  ok(keeps.at(-1) === 0, 'e o programa é avisado para soltar a memória', keeps);
  const prev2 = await A.evaluate(() => window.__lc.voice.screen.getVideoTracks()[0].getConstraints());
  ok(!prev2.height || prev2.height.max !== 360, 'a captura do Chromium volta a ser a transmissão (sem o limite da prévia)', prev2.height);
} catch (e) { console.log('  EXCEÇÃO', e.stack || e.message); fails++; }
await browser.close(); srv.kill(); for (const h of helpers) h.P.stop();
fs.rmSync('.testdata-nclip', { recursive: true, force: true });
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
