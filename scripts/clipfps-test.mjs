// Clipes em 60 e 120 FPS: grava uma fonte com taxa exata (gerador de quadros) que passa por WebRTC (como a transmissão
// que chega de outra pessoa), corta com o buffer de clipes e conta os quadros do arquivo final (intervalo entre quadros).
// Uso: node scripts/clipfps-test.mjs   (BROWSER=caminho do Chrome/Edge)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3241, ROOT = path.resolve('public');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<!doctype html><title>t</title>'); } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(PORT);
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

// quadros de vídeo do WebM: tempo (ms) de cada SimpleBlock/BlockGroup da trilha de vídeo
function frameTimes(b) {
  const vint = (p) => { const x = b[p]; let l = 1, m = 0x80; while (l <= 8 && !(x & m)) { l++; m >>= 1; } let v = x & (m - 1); for (let i = 1; i < l; i++) v = v * 256 + b[p + i]; return { len: l, value: v, unknown: v === 2 ** (7 * l) - 1 }; };
  const id = (p) => { const x = b[p]; const l = x & 0x80 ? 1 : x & 0x40 ? 2 : x & 0x20 ? 3 : 4; let v = 0; for (let i = 0; i < l; i++) v = v * 256 + b[p + i]; return { len: l, id: v }; };
  const out = []; let vt = 1, cts = 0;
  const walk = (s, e) => {
    for (let p = s; p < e;) {
      const i = id(p), z = vint(p + i.len), d = p + i.len + z.len, end = z.unknown ? e : d + z.value;
      if (i.id === 0x18538067 || i.id === 0x1f43b675 || i.id === 0x1654ae6b) walk(d, end); // Segment, Cluster, Tracks
      else if (i.id === 0xae) { let num = 0, type = 0; for (let q = d; q < end;) { const ci = id(q), cz = vint(q + ci.len), cd = q + ci.len + cz.len; if (ci.id === 0xd7) num = b[cd]; if (ci.id === 0x83) type = b[cd]; q = cd + cz.value; } if (type === 1) vt = num; }
      else if (i.id === 0xe7) { cts = 0; for (let k = 0; k < z.value; k++) cts = cts * 256 + b[d + k]; }
      else if (i.id === 0xa3 || i.id === 0xa1) { const tr = vint(d); if (tr.value === vt) { const rel = (b[d + tr.len] << 8 | b[d + tr.len + 1]) << 16 >> 16; out.push(cts + rel); } }
      else if (i.id === 0xa0) walk(d, end);
      p = end;
    }
  };
  walk(0, b.length);
  return out.sort((a, c) => a - c);
}
const stats = (t) => {
  const d = t.slice(1).map((x, i) => x - t[i]), dur = (t.at(-1) - t[0]) / 1000;
  const med = [...d].sort((a, c) => a - c)[d.length >> 1] || 0, gaps = d.filter(x => x > med * 1.8).length;
  return { frames: t.length, secs: +dur.toFixed(2), fps: +((t.length - 1) / dur).toFixed(1), medMs: med, gaps };
};

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
page.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text()); });
await page.goto(`http://localhost:${PORT}/x.html`);

// fps: taxa da fonte; w×h: resolução; rtc: passa por WebRTC; opts: opções do buffer (fullRate, maxFps); secs: corte
async function run(label, { fps, w = 1280, h = 720, rtc = true, local = false, opts = {}, secs = 4 }) {
  const r = await page.evaluate(async ({ fps, w, h, rtc, local, opts, secs }) => {
    const { createBuffer } = await import('/clipbuf.js');
    // gerador com taxa exata: cada quadro tem o número desenhado e o carimbo de tempo certo
    const gen = new MediaStreamTrackGenerator({ kind: 'video' }), wr = gen.writable.getWriter();
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); let n = 0, t0 = performance.now(), stop = false;
    (async () => { while (!stop) { const due = t0 + n * 1000 / fps; const wait = due - performance.now(); if (wait > 1) { await new Promise(r => setTimeout(r, wait - 1)); continue; }
      x.fillStyle = `hsl(${n * 7 % 360},60%,35%)`; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = `bold ${h / 6}px sans-serif`; x.fillText(String(n), 40, h / 3); x.fillRect((n * 13) % (w - 80), h * .7, 80, 80);
      const f = new VideoFrame(c, { timestamp: Math.round(due * 1000) }); await wr.write(f); n++; } })();
    let track = gen, pcs = [], cv = null;
    if (local) { // captura local (como a sua própria transmissão pelo Chromium): canvas desenhado na taxa da fonte
      cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); let k = 0;
      const iv = setInterval(() => { g.drawImage(c, 0, 0); k++; }, 1000 / fps); pcs.push({ close: () => clearInterval(iv) });
      track = cv.captureStream(fps).getVideoTracks()[0];
    }
    if (rtc && !local) { // ida e volta por WebRTC no mesmo processo: o quadro chega como o de uma transmissão de outra pessoa
      const a = new RTCPeerConnection(), b = new RTCPeerConnection(); pcs = [a, b];
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate); b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      const got = new Promise(r => (b.ontrack = (e) => r(e.track)));
      const s = a.addTrack(gen, new MediaStream([gen]));
      const p = s.getParameters(); p.encodings = [{ maxBitrate: 20_000_000, maxFramerate: fps }]; p.degradationPreference = 'maintain-framerate';
      await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
      await s.setParameters(p).catch(() => { });
      track = await got;
      // a mesma taxa que o palco de quem assiste vê (frames decodificados por segundo)
    }
    const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([track]); await v.play().catch(() => { });
    await new Promise(r => setTimeout(r, 1500)); // a conexão sobe a taxa
    const st0 = v.getVideoPlaybackQuality?.().totalVideoFrames || 0, tp0 = performance.now();
    const buf = createBuffer(new MediaStream([track]), null, opts);
    await new Promise(r => setTimeout(r, (secs + 2.5) * 1000));
    const recvFps = ((v.getVideoPlaybackQuality?.().totalVideoFrames || 0) - st0) / ((performance.now() - tp0) / 1000);
    const blob = await buf.cut(secs); const bytes = blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
    const mime = buf.mimeType, bps = buf.bps, how = buf.how; buf.stop(); stop = true; pcs.forEach(p => p.close()); gen.stop();
    return { bytes, mime, recvFps: Math.round(recvFps), bps, how };
  }, { fps, w, h, rtc, local, opts, secs });
  if (!r.bytes) { ok(false, label + ': clipe vazio'); return null; }
  const s = stats(frameTimes(Uint8Array.from(r.bytes)));
  console.log(`  ${label.padEnd(44)} fonte ${fps} → chegando ${r.recvFps} fps · clipe ${s.fps} fps (${s.frames} quadros em ${s.secs}s, intervalo ${s.medMs} ms, buracos ${s.gaps}) · ${(r.bytes.length / 1048576).toFixed(1)} MB · ${(r.bps / 1e6).toFixed(1)} Mb/s · limitador ${r.how}`);
  return { ...s, recv: r.recvFps, mb: r.bytes.length / 1048576, bps: r.bps, how: r.how };
}

try {
  const R = {};
  // transmissão de outra pessoa (WebRTC): a trilha recusa o limite por applyConstraints → o worker reduz
  R.r60d = await run('remota 60 → padrão (60)', { fps: 60 });
  R.r120d = await run('remota 120 → padrão (60)', { fps: 120 });
  R.r120_30 = await run('remota 120 → 30', { fps: 120, opts: { maxFps: 30 } });
  R.r144_60 = await run('remota 144 → 60', { fps: 144, opts: { maxFps: 60 } });
  R.r120_0 = await run('remota 120 → igual à transmissão', { fps: 120, opts: { maxFps: 0 } });
  R.r120_0d = await run('remota 120 1080p → igual à transmissão', { fps: 120, w: 1920, h: 1080, opts: { maxFps: 0 } });
  // sua transmissão pelo Chromium (captura local): o próprio Chromium limita
  R.l120d = await run('local 120 → padrão (60)', { fps: 120, local: true });
  R.l60_30 = await run('local 60 → 30', { fps: 60, local: true, opts: { maxFps: 30 } });
  const near = (r, f, tol = 0.08) => r && Math.abs(r.fps - f) <= f * tol && r.gaps <= 2;
  ok(near(R.r60d, 60), 'remota 60 fps, padrão: clipe a 60', R.r60d && { fps: R.r60d.fps, gaps: R.r60d.gaps });
  ok(near(R.r120d, 60) && R.r120d.how === 'worker', 'remota 120 fps, padrão: clipe a 60 (pelo worker)', R.r120d && { fps: R.r120d.fps, gaps: R.r120d.gaps, how: R.r120d.how });
  ok(near(R.r120_30, 30), 'remota 120 fps, limite 30: clipe a 30', R.r120_30 && { fps: R.r120_30.fps, gaps: R.r120_30.gaps });
  ok(near(R.r144_60, 60), 'remota 144 fps, limite 60: clipe a 60 sem acumular atraso', R.r144_60 && { fps: R.r144_60.fps, gaps: R.r144_60.gaps });
  ok(R.r120_0 && R.r120_0.fps >= Math.min(R.r120_0.recv, 120) * 0.92 && R.r120_0.how === 'cheio', 'igual à transmissão: clipe a 120', R.r120_0 && { fps: R.r120_0.fps, chega: R.r120_0.recv });
  ok(R.r120_0d && R.r120_0d.fps >= 110, 'igual à transmissão em 1080p: clipe a 120', R.r120_0d && { fps: R.r120_0d.fps, gaps: R.r120_0d.gaps });
  // (o canvas do teste nem sempre chega a 120: vale não passar de 60)
  ok(R.l120d && R.l120d.fps <= 62 && R.l120d.fps >= 50 && R.l120d.how === 'constraints', 'local 120 fps, padrão: clipe a ~60 (o Chromium limita)', R.l120d && { fps: R.l120d.fps, how: R.l120d.how });
  ok(near(R.l60_30, 30, 0.12), 'local 60 fps, limite 30: clipe a 30', R.l60_30 && { fps: R.l60_30.fps });
  ok(R.r120_0 && R.r120_30 && R.r120_0.bps > R.r120_30.bps, 'bitrate sobe com o FPS do clipe', R.r120_0 && { b120: R.r120_0.bps, b30: R.r120_30.bps });
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close(); srv.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
