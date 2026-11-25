// Vídeo pelo túnel (public/voztunnel-video.js, sfuTunnelAttach em server/sfu.js): transmissão de tela nos dois sentidos.
// 1) Alice direta, Bruno pelo túnel: o Bruno transmite e a Alice assiste (quadros decodificados de verdade); a Alice
//    transmite e o Bruno assiste pelo túnel (imagem chegando no <video>). 2) Carla entra também sem caminho direto e
//    assiste a tela do Bruno (túnel -> túnel). Parar a transmissão some para quem assistia.
// (cabeçalho do teste de voz, de onde veio a montagem:)
// Voz pelo túnel, de ponta a ponta (public/voztunnel.js, server/voztunnel.js, server/tunnelproxy.js):
// a Alice conecta a mídia direto; o Bruno não alcança o servidor direto (sem
// caminho: o endereço anunciado pelo servidor é trocado por um inalcançável, como quem está fora da VPN numa rede só IPv4) e, sem conectar em 5 s, a voz dele passa sozinha pela conexão
// do site. As duas pessoas se ouvem; mudo e ensurdecer valem; o popup do sinal mostra "Pelo site (túnel)"; câmera
// avisa que não passa; e sair da sala fecha o microfone do túnel para os outros.
// Uso: node scripts/voztunnel-test.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3399, BASE = `http://localhost:${PORT}`, DATA = './.testdata-voztunnel-video';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server/voz.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41399', RTC_IPS: '127.0.0.1', EXIT_WITH_PARENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(50); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 60000, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function person(tok, blockDirect) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t, block) => {
    localStorage.lc_token = t; window.__toasts = [];
    new MutationObserver(() => { const e = document.getElementById('toast'); if (e && window.__toasts.at(-1) !== e.textContent) window.__toasts.push(e.textContent); }).observe(document, { childList: true, subtree: true });
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0; setInterval(() => { n++; x.fillStyle = `hsl(${n * 5 % 360} 60% 40%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.fillRect((n * 7) % 600, 100, 40, 40); }, 33); const st = c.captureStream(30); if (window.__withAudio) { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.frequency.value = 330; o.connect(d); o.start(); st.addTrack(d.stream.getAudioTracks()[0]); } return st; };
    if (block) { // o endereço que o servidor de voz anuncia não chega daqui (como fora da VPN, numa rede só IPv4)
      const srd = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = function (d, ...a) { return srd.call(this, d?.sdp ? { type: d.type, sdp: d.sdp.replaceAll('127.0.0.1', '192.0.2.1') } : d, ...a); };
    }
  }, tok, blockDirect);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  return p;
}
// voz que chega à Alice (mídia direta) vinda do microfone de alguém
const aliceHears = (p, ms = 1500) => p.evaluate(async (ms) => {
  const s = window.__lc.voice.sfu; if (!s) { await new Promise(r => setTimeout(r, ms)); return -1; } // refazendo a mídia: espera igual
  const recv = [...s.consumers.values()].filter(e => e.source === 'mic').map(e => e.c.rtpReceiver);
  const snap = async () => { let b = 0; for (const r of recv) (await r.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); return b; };
  const a = await snap(); await new Promise(r => setTimeout(r, ms)); return (await snap()) - a;
}, ms);
// som de verdade (energia) no que o Bruno toca de alguém pelo túnel
const brunoHears = (p, uid, ms = 1200) => p.evaluate(async (uid, ms) => {
  const el = window.__lc.voice.peers.get(uid)?.audioEl; if (!el?.srcObject) { await new Promise(r => setTimeout(r, ms)); return -1; }
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(el.srcObject), an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0;
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
  ctx.close(); return peak;
}, uid, ms);

// quadros da tela de alguém decodificados aqui (mídia direta: estatística do receptor; túnel: quadros novos no <video>)
const framesFrom = (p, uid, ms = 2000) => p.evaluate(async (uid, ms) => {
  const v = window.__lc.voice, peer = v.peers.get(uid), st = peer?.streams?.screen;
  if (!st) { await new Promise(r => setTimeout(r, ms)); return { n: -1 }; }
  v.openStream?.(uid); v.flowVideo?.(uid, false);
  const el = document.createElement('video'); el.muted = true; el.srcObject = st; document.body.append(el); await el.play().catch(() => { });
  let n = 0; const cb = () => { n++; el.requestVideoFrameCallback(cb); }; el.requestVideoFrameCallback(cb);
  await new Promise(r => setTimeout(r, ms));
  const out = { n, w: el.videoWidth, h: el.videoHeight }; el.remove(); return out;
}, uid, ms);
try {
  const reg = (u) => api('', 'POST', '/register', { username: u, password: 'Teste.senha-123' });
  const ra = await reg('alice'), rb = await reg('bruno'), rc = await reg('carla');
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' });
  for (const r of [rb, rc]) await api(r.token, 'POST', '/invites/' + (await api(ra.token, 'POST', `/guilds/${g.id}/invites`)).code);
  const A = await person(ra.token, false), B = await person(rb.token, true);
  const [idA, idB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__lc.S.me.id)));
  const vc = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await A.evaluate((vc) => window.__lc.voice.join(vc), vc); await sleep(1500);
  await B.evaluate((vc) => window.__lc.voice.join(vc), vc);
  ok(await B.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 20000 }).then(() => true, () => false), 'Bruno pelo túnel');

  // Bruno (túnel) transmite; Alice (direta) assiste
  await B.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  let f = { n: -1 }; for (let i = 0; i < 10 && !(f.n > 10); i++) f = await framesFrom(A, idB);
  ok(f.n > 10 && f.w > 0, 'Alice (direta) vê a tela do Bruno (que transmite pelo túnel)', f);
  const codec = await B.evaluate(() => window.__lc.voice.tunnel?.vids.get('screen')?.sender?.codec);
  ok(!!codec, 'o Bruno comprime a tela no navegador', codec);

  // Alice (direta) transmite; Bruno (túnel) assiste
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  f = { n: -1 }; for (let i = 0; i < 10 && !(f.n > 10); i++) f = await framesFrom(B, idA);
  ok(f.n > 10 && f.w > 0, 'Bruno (túnel) vê a tela da Alice', f);

  // Carla, também sem caminho direto, assiste a tela do Bruno (túnel -> túnel) e ouve os dois
  const C = await person(rc.token, true);
  await C.evaluate((vc) => window.__lc.voice.join(vc), vc);
  ok(await C.waitForFunction(() => window.__lc.voice.tunnel?.ready, { timeout: 20000 }).then(() => true, () => false), 'Carla pelo túnel');
  f = { n: -1 }; for (let i = 0; i < 10 && !(f.n > 10); i++) f = await framesFrom(C, idB);
  ok(f.n > 10 && f.w > 0, 'Carla (túnel) vê a tela do Bruno (túnel)', f);
  f = { n: -1 }; for (let i = 0; i < 10 && !(f.n > 10); i++) f = await framesFrom(C, idA);
  ok(f.n > 10 && f.w > 0, 'Carla (túnel) vê a tela da Alice (direta)', f);
  let b = 0; for (let i = 0; i < 12 && b < 0.01; i++) b = await brunoHears(C, idB);
  ok(b > 0.01, 'Carla ouve o Bruno (os dois pelo túnel)', b);
  b = 0; for (let i = 0; i < 12 && b < 0.01; i++) b = await brunoHears(B, idA);
  ok(b > 0.01, 'Bruno ouve a Alice com as transmissões no ar', b);

  // áudio da transmissão pelo túnel: o Bruno transmite de novo com som; a Alice (direta) e a Carla (túnel) ouvem
  await B.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1500);
  await B.evaluate(() => { window.__withAudio = true; return window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: true, hint: 'motion' }); });
  const screenSound = (p, uid) => p.evaluate(async (uid) => {
    window.__lc.voice.openStream?.(uid);
    const el = window.__lc.voice.peers.get(uid)?.screenAudioEl; if (!el?.srcObject) { await new Promise(r => setTimeout(r, 1200)); return -1; }
    const ctx = new AudioContext(), an = ctx.createAnalyser(); ctx.createMediaStreamSource(el.srcObject).connect(an); an.fftSize = 2048;
    const buf = new Float32Array(2048); let peak = 0;
    for (const end = Date.now() + 1200; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
    ctx.close(); return peak;
  }, uid);
  let sa = 0; for (let i = 0; i < 12 && sa < 0.01; i++) sa = await screenSound(A, idB);
  ok(sa > 0.01, 'Alice ouve o áudio da transmissão do Bruno (túnel)', sa);
  sa = 0; for (let i = 0; i < 12 && sa < 0.01; i++) sa = await screenSound(C, idB);
  ok(sa > 0.01, 'Carla ouve o áudio da transmissão do Bruno (túnel -> túnel)', sa);

  // parou: some para quem assistia
  await B.evaluate(() => window.__lc.voice.toggleScreen());
  ok(await A.waitForFunction((idB) => !window.__lc.voice.peers.get(idB)?.streams?.screen, { timeout: 8000 }, idB).then(() => true, () => false), 'Bruno parou: a tela some para a Alice');
  ok(await C.waitForFunction((idB) => !window.__lc.voice.peers.get(idB)?.streams?.screen, { timeout: 8000 }, idB).then(() => true, () => false), 'e para a Carla');
} catch (e) { ok(false, 'erro: ' + e.message); console.log(out.slice(-1500)); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
