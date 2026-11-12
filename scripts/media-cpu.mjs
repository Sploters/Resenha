// Quanto custam (1) a gravação contínua dos clipes (F8: os últimos ~65 s de cada transmissão assistida, public/clipbuf.js)
// e (2) a cifra quadro a quadro das chamadas protegidas (public/e2ee-worker.js), ligados x desligados, em rodadas
// alternadas. Mede o tempo de CPU de todos os processos do Chromium (/proc) e separa as threads que interessam.
//  - Clipes: uma "transmissão" 1080p 30 fps (câmera falsa) tocando num <video>, como a que você assiste; com o buffer, o
//    MediaRecorder recomprime uma cópia a 30 fps (o mesmo createBuffer do app). Também mede quanto ele guarda na memória.
//  - Cifra: duas conexões WebRTC na mesma página (vai e volta: quem envia cifra, quem recebe decifra), com câmera 720p e
//    microfone; com a cifra, cada quadro passa pelo worker real (RTCRtpScriptTransform), como numa chamada protegida.
// Uso: node scripts/media-cpu.mjs   (SECS=15, ROUNDS=2, ONLY=clip|e2ee, JSON=arquivo)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import { ownServer } from './test-server.mjs';
import { threads, diff, pct } from './proc-cpu.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SECS = +(process.env.SECS || 15), ROUNDS = +(process.env.ROUNDS || 2), ONLY = process.env.ONLY || '';
const BASE = await ownServer('mediacpu', 3340, 41310);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 180000,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const root = browser.process().pid;
const page = await browser.newPage();
page.on('pageerror', e => console.log('  PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text()); });
await page.goto(BASE + '/vendor/ns/LICENSE'); // página parada da mesma origem
const measure = async () => { const a = threads(root), t0 = Date.now(); await sleep(SECS * 1000); const b = threads(root); return { d: diff(a, b), secs: (Date.now() - t0) / 1000 }; };
const avg = (xs, k) => +(xs.reduce((s, x) => s + x[k], 0) / xs.length).toFixed(2);
const OUT = { secs: SECS, rounds: ROUNDS, cores: os.cpus().length, cpu: os.cpus()[0]?.model };

// ---------- 1) gravação contínua dos clipes ----------
if (!ONLY || ONLY === 'clip') {
  console.log('\n== Clipes: transmissão 1080p 30 fps assistida, com e sem o buffer de clipe ==');
  const R = { off: [], on: [] }; let info = null;
  for (let r = 0; r < ROUNDS; r++) for (const on of [false, true]) {
    const st = await page.evaluate(async (on) => {
      const { createBuffer } = await import('/clipbuf.js');
      window.src = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: true });
      const v = window.vid = document.createElement('video'); v.muted = true; v.srcObject = window.src; document.body.append(v); await v.play();
      window.buf = on ? createBuffer(window.src, null) : null;
      const s = window.src.getVideoTracks()[0].getSettings();
      return { w: s.width, h: s.height, fps: s.frameRate, mime: window.buf?.rec.mimeType || null, bps: window.buf?.rec.videoBitsPerSecond || null };
    }, on);
    if (on) info = st;
    await sleep(2500);
    const m = await measure(), p = pct(m.d, m.secs, { page: /^renderer \//, gpu: /^gpu-process/, enc: /^(renderer|gpu-process) \/ .*(Media|Encoder|Video|ThreadPool)/i });
    const held = on ? await page.evaluate(() => ({ bytes: window.buf.size - (window.buf.chunks[0]?.start || 0), chunks: window.buf.chunks.length })) : null;
    R[on ? 'on' : 'off'].push({ ...p, held });
    console.log(`  rodada ${r + 1} ${on ? 'COM buffer' : 'sem buffer'}: total ${p.total}%  página ${p.page}%  GPU/vídeo ${p.gpu}%${held ? `  guardado ${(held.bytes / 1048576).toFixed(1)} MB em ${SECS + 2.5} s` : ''}`);
    if (process.env.DEBUG) console.log('     ', JSON.stringify(p.top));
    await page.evaluate(() => { window.buf?.stop(); window.src.getTracks().forEach(t => t.stop()); window.vid.remove(); });
    await sleep(1000);
  }
  // memória com o buffer cheio (65 s): proporcional à taxa
  const mbFull = info?.bps ? +(info.bps * 65 / 8 / 1048576).toFixed(0) : null;
  OUT.clip = { source: info && `${info.w}x${info.h} ${info.fps} fps`, mime: info?.mime, bps: info?.bps, off: avg(R.off, 'total'), on: avg(R.on, 'total'), extra: +(avg(R.on, 'total') - avg(R.off, 'total')).toFixed(2), mbFull };
  console.log(`  Média: sem ${OUT.clip.off}% → com ${OUT.clip.on}% (+${OUT.clip.extra}% de um núcleo). Gravador: ${info?.mime} a ${(info?.bps / 1e6).toFixed(1)} Mb/s → ~${mbFull} MB com o buffer cheio (65 s).`);
}

// ---------- 2) cifra quadro a quadro ----------
if (!ONLY || ONLY === 'e2ee') {
  console.log('\n== Chamada protegida: câmera 720p + microfone, com e sem a cifra de cada quadro ==');
  const R = { off: [], on: [] }; let last = null;
  for (let r = 0; r < ROUNDS; r++) for (const on of [false, true]) {
    const st = await page.evaluate(async (on) => {
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: true });
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate); b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      const key = on ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) : null;
      const worker = on ? new Worker('/e2ee-worker.js') : null; window.wstats = null; if (worker) worker.onmessage = (e) => { if (e.data?.stats) window.wstats = e.data.stats; };
      const tr = (t, op) => { if (on) t.transform = new RTCRtpScriptTransform(worker, { op, key }); };
      for (const t of media.getTracks()) { const s = a.addTrack(t, media); tr(s, 'enc'); if (t.kind === 'video') { const p = s.getParameters(); p.encodings[0].maxBitrate = 2_500_000; p.degradationPreference = 'maintain-resolution'; s.setParameters(p).catch(() => { }); } }
      const vids = [];
      b.ontrack = (e) => { tr(e.receiver, 'dec'); if (e.track.kind === 'video') { const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([e.track]); document.body.append(v); v.play(); vids.push(v); } else { const au = new Audio(); au.srcObject = new MediaStream([e.track]); au.play().catch(() => { }); vids.push(au); } };
      await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
      window.call = { a, b, media, worker, vids };
      return { script: !!window.RTCRtpScriptTransform };
    }, on);
    await sleep(+(process.env.WARM || 12000)); // conecta e sobe a taxa (a estimativa de banda começa baixa)
    const s0 = await page.evaluate(async () => { let f = 0, by = 0; (await window.call.b.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') { f = x.framesDecoded; by = x.bytesReceived; } }); return { f, by, w: window.wstats }; });
    const m = await measure();
    const s1 = await page.evaluate(async () => { let f = 0, by = 0, w = 0; (await window.call.b.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') { f = x.framesDecoded; by = x.bytesReceived; w = x.frameWidth; } }); return { f, by, wd: w, w: window.wstats }; });
    const p = pct(m.d, m.secs, { worker: /^renderer \/ DedicatedWorker/i });
    const fps = +((s1.f - s0.f) / m.secs).toFixed(1), kbps = Math.round((s1.by - s0.by) * 8 / m.secs / 1000);
    const perSec = on && s1.w && s0.w ? Math.round(((s1.w.enc + s1.w.dec) - (s0.w.enc + s0.w.dec)) / m.secs) : 0;
    R[on ? 'on' : 'off'].push({ ...p, fps, kbps, perSec, bad: s1.w?.bad || 0 });
    last = { width: s1.wd, script: st.script };
    console.log(`  rodada ${r + 1} ${on ? 'COM cifra' : 'sem cifra'}: total ${p.total}%  worker da cifra ${p.worker}%  vídeo ${fps} fps / ${kbps} kbps (${s1.wd}px)${on ? `  quadros cifrados+decifrados ${perSec}/s, descartados ${s1.w?.bad || 0}` : ''}`);
    if (process.env.DEBUG) console.log('     ', JSON.stringify(p.top));
    await page.evaluate(() => { const c = window.call; c.a.close(); c.b.close(); c.media.getTracks().forEach(t => t.stop()); c.worker?.terminate(); c.vids.forEach(v => { v.srcObject = null; v.remove?.(); }); });
    await sleep(1000);
  }
  OUT.e2ee = { width: last?.width, scriptTransform: last?.script, off: avg(R.off, 'total'), on: avg(R.on, 'total'), worker: avg(R.on, 'worker'), extra: +(avg(R.on, 'total') - avg(R.off, 'total')).toFixed(2), frames: avg(R.on, 'perSec'), kbps: avg(R.on, 'kbps'), fpsOff: avg(R.off, 'fps'), fpsOn: avg(R.on, 'fps'), bad: Math.max(0, ...R.on.map(x => x.bad)) };
  console.log(`  Média: sem ${OUT.e2ee.off}% → com ${OUT.e2ee.on}% (+${OUT.e2ee.extra}% de um núcleo; o worker da cifra ${OUT.e2ee.worker}%) para ${OUT.e2ee.frames} quadros/s a ~${OUT.e2ee.kbps} kbps; vídeo ${OUT.e2ee.fpsOff} → ${OUT.e2ee.fpsOn} fps.`);
}
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(OUT, null, 2));
await browser.close(); setTimeout(() => process.exit(0), 200);
