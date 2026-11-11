// Estresse e consumo em segundo plano: mede a CPU REAL de cada pessoa (árvore de processos do navegador inteira —
// inclui a thread de áudio, onde roda a IA de ruído, que o "TaskDuration" da página não enxerga), rede (bytes WebRTC e
// mensagens do gateway) e repete ações para achar vazamento, travamento ou conflito.
// Cenários: call de 3 com RNNoise (normal / mutado / ensurdecido / aba escondida), depois de sair da call, parado com a
// aba escondida; mutar 100x, ensurdecer 50x, entrar/sair 15x, trocar de sala sem esperar, trocar o filtro 20x,
// câmera 10x, transmissão 6x, trocar de canal 50x, rajada de 120 mensagens.
// Uso: BROWSER=<chrome> node scripts/perf-stress.mjs [rótulo]  -> .testshots/stress-<rótulo>.json
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3262, BASE = `http://localhost:${PORT}`, LABEL = process.argv[2] || 'atual', SECS = +(process.env.SECS || 8);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata20', { recursive: true, force: true }); fs.mkdirSync('.testshots', { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata20', RTC_PORT: '41060', RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'ignore', 'pipe'] });
let srvErr = ''; srv.stderr.on('data', d => { srvErr += d; });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };

// CPU (s) de uma árvore de processos (navegador + filhos), por /proc
const tree = (root) => { const out = execFileSync('ps', ['-o', 'pid=,ppid=', '-A']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)); const k = new Set([root]); for (let i = 0; i < 4; i++) for (const [p, pp] of out) if (k.has(pp)) k.add(p); return k; };
const ticks = (root) => { let t = 0; for (const pid of tree(root)) { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += +f[11] + +f[12]; } catch { } } return t / 100; };
const rssMB = (root) => { let r = 0; for (const pid of tree(root)) { try { r += +fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096; } catch { } } return Math.round(r / 1048576); };

// sonda na página: timers, mensagens do gateway, contextos de áudio, trilhas de mídia vivas
const probe = () => {
  const live = new Map(), oSI = setInterval, oCI = clearInterval;
  window.setInterval = (fn, ms, ...a) => { const id = oSI(fn, ms, ...a); live.set(id, ms); return id; };
  window.clearInterval = (id) => { live.delete(id); return oCI(id); };
  const W = window.__probe = { live, wsIn: 0, wsOut: 0, wsInB: 0, wsOutB: 0, ctxs: [], tracks: new Set(), errors: [] };
  const OW = WebSocket; window.WebSocket = class extends OW { constructor(...a) { super(...a); this.addEventListener('message', (e) => { W.wsIn++; W.wsInB += e.data.length || e.data.size || 0; }); } send(d) { W.wsOut++; W.wsOutB += d.length || 0; return super.send(d); } };
  const OA = window.AudioContext; window.AudioContext = class extends OA { constructor(...a) { super(...a); W.ctxs.push(this); } };
  const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await gum(c); s.getTracks().forEach(t => W.tracks.add(t)); return s; };
  navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0; const iv = setInterval(() => { x.fillStyle = `hsl(${n++ % 360},60%,40%)`; x.fillRect(0, 0, 1280, 720); }, 33); const s = c.captureStream(30); s.getTracks().forEach(t => { W.tracks.add(t); const st = t.stop.bind(t); t.stop = () => { clearInterval(iv); st(); }; }); return s; };
  addEventListener('error', (e) => W.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => W.errors.push('rej: ' + String(e.reason?.message || e.reason)));
  // aba escondida simulada (o app só olha document.hidden/visibilityState)
  let hid = false; Object.defineProperty(document, 'hidden', { get: () => hid }); Object.defineProperty(document, 'visibilityState', { get: () => hid ? 'hidden' : 'visible' });
  window.__hide = (v) => { hid = v; document.dispatchEvent(new Event('visibilitychange')); };
};
const snap = (P) => P.p.evaluate(async () => {
  const W = window.__probe, v = window.__lc.voice;
  let rtcIn = 0, rtcOut = 0;
  for (const t of [v?.sfu?.send, v?.sfu?.recv]) { if (!t || t.closed) continue; try { (await t.getStats()).forEach(r => { if (r.type === 'transport') { rtcIn += r.bytesReceived || 0; rtcOut += r.bytesSent || 0; } }); } catch { } }
  return { wsIn: W.wsIn, wsOut: W.wsOut, wsInB: W.wsInB, wsOutB: W.wsOutB, rtcIn, rtcOut, intervals: W.live.size, ivPerS: Math.round([...W.live.values()].reduce((n, ms) => n + 1000 / Math.max(4, ms || 4), 0)),
    ctxRunning: W.ctxs.filter(c => c.state === 'running').length, ctxTotal: W.ctxs.filter(c => c.state !== 'closed').length, liveTracks: [...W.tracks].filter(t => t.readyState === 'live').length, errors: W.errors.length };
});
async function measure(P, secs = SECS) {
  const m = async () => Object.fromEntries((await P.cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const a = await snap(P), ma = await m(), c0 = ticks(P.pid); await sleep(secs * 1000); const c1 = ticks(P.pid), b = await snap(P), mb = await m();
  return { cpuPct: +((c1 - c0) / secs * 100).toFixed(1), mainPct: +((mb.TaskDuration - ma.TaskDuration) / secs * 100).toFixed(1), rssMB: rssMB(P.pid),
    rtcInKbps: Math.round((b.rtcIn - a.rtcIn) * 8 / secs / 1000), rtcOutKbps: Math.round((b.rtcOut - a.rtcOut) * 8 / secs / 1000),
    wsInPerS: +((b.wsIn - a.wsIn) / secs).toFixed(1), wsOutPerS: +((b.wsOut - a.wsOut) / secs).toFixed(1), wsBps: Math.round((b.wsInB - a.wsInB + b.wsOutB - a.wsOutB) / secs),
    intervals: b.intervals, ivPerS: b.ivPerS, ctxRunning: b.ctxRunning, ctxTotal: b.ctxTotal, liveTracks: b.liveTracks, nodes: mb.Nodes, listeners: mb.JSEventListeners, heapMB: +(mb.JSHeapUsedSize / 1048576).toFixed(1) };
}
async function person(tok, prefs = {}) {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-background-timer-throttling'] });
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(probe);
  await p.evaluateOnNewDocument((t, pr) => { localStorage.lc_token = t; localStorage.__stressPrefs = JSON.stringify(pr); }, tok, prefs);
  const cdp = await p.createCDPSession(); await cdp.send('Performance.enable');
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  await p.evaluate((pr) => Object.assign(window.__lc.S.prefs, pr), prefs);
  return { browser, p, cdp, pid: browser.process().pid };
}
const sfuLoad = (tok) => call(tok, 'GET', '/sfu/load').then(r => r.current);
const join = (P, cid) => P.p.evaluate(async (cid) => { await window.__lc.voice.join(cid); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, cid);

const R = { label: LABEL, date: new Date().toISOString() };
const ALL = [];
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c]) await call(u.tok, 'POST', '/invites/' + inv);
  const v2 = await call(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 });
  const A = await person(a.tok, { noiseMode: 'rnnoise' }), B = await person(b.tok), C = await person(c.tok); ALL.push(A, B, C);
  const chans = await A.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.map(x => ({ id: x.id, type: x.type })), g.id);
  const tch = chans.find(x => x.type === 0).id, vch = chans.find(x => x.type === 2 && x.id !== v2.id).id;
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch); await sleep(2000);

  // ---------- fora da call ----------
  R.idleVisible = await measure(A);
  await A.p.evaluate(() => window.__hide(true)); await sleep(500);
  R.idleHidden = await measure(A);
  await A.p.evaluate(() => window.__hide(false));

  // ---------- call de 3 ----------
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch);
  for (const P of [A, B, C]) await join(P, vch);
  await sleep(4000);
  R.callNormal = await measure(A);
  await A.p.evaluate(() => window.__lc.voice.toggleMute()); await sleep(1500);
  R.callMuted = await measure(A);
  await A.p.evaluate(() => window.__lc.voice.toggleMute()); await A.p.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(1500);
  R.callDeafened = await measure(A);
  await A.p.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(1500);
  await A.p.evaluate(() => window.__hide(true)); await sleep(1000);
  R.callHidden = await measure(A);
  await A.p.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(3000);
  R.callDeafHidden = await measure(A);
  await A.p.evaluate(() => window.__hide(false)); await sleep(1500);
  R.deafBackVisible = { rtcInKbps: (await measure(A, 3)).rtcInKbps };
  await A.p.evaluate(() => window.__lc.voice.toggleDeaf()); await sleep(1000);
  R.sfuSteady = await sfuLoad(a.tok);

  // ---------- repetição ----------
  // mutar 100x e ensurdecer 50x sem esperar: estado final tem que bater no servidor (o que os outros veem)
  await A.p.evaluate(() => { const v = window.__lc.voice; for (let i = 0; i < 100; i++) v.toggleMute(); for (let i = 0; i < 51; i++) v.toggleDeaf(); });
  await sleep(1500);
  R.muteSpam = await A.p.evaluate((uid) => { const v = window.__lc.voice; return { local: { muted: v.muted, deaf: v.deafened }, trackEnabled: v.mic?.getAudioTracks()[0]?.enabled }; }, a.id);
  R.muteSpam.seenByBruno = await B.p.evaluate((uid) => { const s = window.__lc.S.voice.get(uid); return { mute: s?.mute, deaf: s?.deaf }; }, a.id);
  await A.p.evaluate(() => { const v = window.__lc.voice; if (v.deafened) v.toggleDeaf(); if (v.muted) v.toggleMute(); });
  R.muteSpam.wsOutTotal = (await snap(A)).wsOut;

  // trocar o filtro de ruído 20x
  const t0 = Date.now();
  await A.p.evaluate(async () => { const v = window.__lc.voice, S = window.__lc.S, modes = ['rnnoise', 'gtcrn', 'standard', 'off']; const ps = []; for (let i = 0; i < 20; i++) { S.prefs.noiseMode = modes[i % 4]; ps.push(v.rebuildMic()); } S.prefs.noiseMode = 'rnnoise'; ps.push(v.rebuildMic()); await Promise.all(ps); });
  R.noiseSwitch = { ms: Date.now() - t0 }; await sleep(1500);
  Object.assign(R.noiseSwitch, await measure(A, 4));

  // entrar/sair 15x (esperando cada uma)
  const base = await measure(A, 2);
  const t1 = Date.now();
  for (let i = 0; i < 15; i++) { await A.p.evaluate(() => window.__lc.voice.leave({ silent: true })); await join(A, vch); }
  R.joinLeave15 = { msEach: Math.round((Date.now() - t1) / 15) }; await sleep(3000);
  R.joinLeave15.after = await measure(A, 3); R.joinLeave15.before = base; R.joinLeave15.sfu = await sfuLoad(a.tok);

  // trocar de sala sem esperar (cliques seguidos): só pode sobrar UMA sala, um microfone e um timer
  await A.p.evaluate((x, y) => { const v = window.__lc.voice; v.join(x); v.join(y); v.join(x); v.join(y); }, vch, v2.id);
  await sleep(5000);
  R.raceJoin = await A.p.evaluate(() => { const v = window.__lc.voice; return { channel: v.channelId, micTracksLive: [...window.__probe.tracks].filter(t => t.readyState === 'live' && t.kind === 'audio').length }; });
  R.raceJoin.expect = v2.id; Object.assign(R.raceJoin, await measure(A, 3)); R.raceJoin.sfu = await sfuLoad(a.tok);
  R.raceJoin.serverSeesA = await B.p.evaluate((uid) => window.__lc.S.voice.get(uid)?.channel_id, a.id);
  await A.p.evaluate(() => window.__lc.voice.leave({ silent: true })); await join(A, vch); await sleep(2000);

  // câmera 10x sem esperar + transmissão 6x
  await A.p.evaluate(async () => { const v = window.__lc.voice; const ps = []; for (let i = 0; i < 10; i++) ps.push(v.toggleCam().catch(e => e.message)); await Promise.all(ps); });
  await sleep(3000);
  R.camSpam = await A.p.evaluate(() => ({ cam: !!window.__lc.voice.cam, producers: Object.keys(window.__lc.voice.sfu?.producers || {}).filter(k => !window.__lc.voice.sfu.producers[k]?.closed) }));
  R.camSpam.sfu = await sfuLoad(a.tok);
  if (await A.p.evaluate(() => !!window.__lc.voice.cam)) await A.p.evaluate(() => window.__lc.voice.toggleCam());
  for (let i = 0; i < 6; i++) { await A.p.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }).catch(e => e.message)); await sleep(700); }
  await sleep(3000);
  R.screenToggle = { screen: await A.p.evaluate(() => !!window.__lc.voice.screen), ...(await measure(A, 3)), sfu: await sfuLoad(a.tok) };
  if (await A.p.evaluate(() => !!window.__lc.voice.screen)) await A.p.evaluate(() => window.__lc.voice.toggleScreen());

  // sair da call: nada de áudio/timer pendurado
  for (const P of [B, C]) await P.p.evaluate(() => window.__lc.voice.leave({ silent: true }));
  await A.p.evaluate(() => window.__lc.voice.leave({ silent: true }));
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch); await sleep(3000);
  R.afterCall = await measure(A); R.afterCall.sfu = await sfuLoad(a.tok);

  // trocar de canal 50x (texto <-> voz <-> DM)
  const before = await measure(A, 2);
  await A.p.evaluate(async (gid, ids) => { for (let i = 0; i < 50; i++) { window.__lc.go(gid, ids[i % ids.length]); await new Promise(r => setTimeout(r, 60)); } }, g.id, [tch, vch, v2.id]);
  await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch); await sleep(2500);
  await A.cdp.send('HeapProfiler.collectGarbage');
  R.chanSwitch50 = { before, after: await measure(A, 2) };

  // rajada: 120 mensagens de 2 pessoas em ~2 s, alice com o canal aberto (e depois escondida)
  const burst = async () => { const ps = []; for (let i = 0; i < 120; i++) ps.push(call([b, c][i % 2].tok, 'POST', `/channels/${tch}/messages`, { content: `rajada ${i} **negrito** https://example.com/${i}` })); await Promise.all(ps); };
  let s0 = ticks(A.pid), m0 = Date.now(); await burst(); await sleep(1500);
  R.burstVisible = { cpuS: +(ticks(A.pid) - s0).toFixed(2), ms: Date.now() - m0, msgsInDom: await A.p.evaluate(() => document.querySelectorAll('#msgs .msg, .msg').length) };
  await A.p.evaluate(() => window.__hide(true));
  s0 = ticks(A.pid); m0 = Date.now(); await burst(); await sleep(1500);
  R.burstHidden = { cpuS: +(ticks(A.pid) - s0).toFixed(2), ms: Date.now() - m0, msgsInDom: await A.p.evaluate(() => document.querySelectorAll('#msgs .msg, .msg').length) };
  await A.p.evaluate(() => window.__hide(false)); await sleep(500);
  R.errors = await A.p.evaluate(() => window.__probe.errors.slice(0, 20));
} catch (e) { R.error = String(e.stack || e); console.log('ERRO', e); }
finally {
  for (const P of ALL) await P.browser.close().catch(() => { });
  srv.kill();
  R.serverStderr = srvErr.split('\n').filter(Boolean).slice(-15);
  fs.writeFileSync(`.testshots/stress-${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 1));
  setTimeout(() => process.exit(0), 300);
}
