// Teste de carga do SFU (mediasoup) com várias salas: muitas pessoas de voz simuladas num Chromium só, cada uma com o
// próprio gateway (WebSocket), Device do mediasoup-client, transporte de envio e de recepção, microfone (tom senoidal em
// Opus, como o app: mono, DTX, FEC, 64 kb/s) e recebendo a voz de todos da sala. Opcional: transmissões de tela (canvas
// animado, VP8 3 camadas) assistidas por todos da sala.
// Mede a cada 5 s: CPU e memória de cada worker (/api/sfu/load), CPU do processo do servidor e do navegador (/proc),
// pacotes de voz enviados e recebidos por segundo, perda e jitter de quem recebe.
// Sobe um servidor próprio numa pasta de dados de teste (nunca a de verdade) e roda os cenários em sequência.
//
// Uso:  node scripts/load/sfu-load.mjs                       (cenários padrão; ~6 min)
//       CENARIOS="1x10@1 4x10@1 4x10@2" SECS=30 node scripts/load/sfu-load.mjs
// Cenário "SxP@W[:fala][+tN]": S salas de P pessoas com W workers; ":2" = só 2 falando por sala (o resto em silêncio,
// DTX); "+t1" = 1 transmissão de tela por sala (720p30, VP8 3 camadas) assistida pelos outros.
// PAGES: abas do navegador entre as quais as pessoas são divididas (padrão 4). OUT: arquivo do resultado (JSON).
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const PORT = +(process.env.PORT || 3297), BASE = `http://localhost:${PORT}`, DATA = process.env.DATA_DIR || './.loaddata-sfu';
const SECS = +(process.env.SECS || 30), WARM = +(process.env.WARM || 8), PAGES = +(process.env.PAGES || 4);
const OUT = process.env.OUT || '.testshots/sfu-load.json';
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const SCEN = (process.env.CENARIOS || '1x10@1 1x25@1 4x10@1 8x10@1 8x10@2 8x10:2@1 2x8+t1@1').trim().split(/\s+/).map(s => {
  const m = /^(\d+)x(\d+)(?::(\d+))?(?:\+t(\d+))?@(\d+)$/.exec(s); if (!m) throw new Error('cenário inválido: ' + s);
  return { name: s, rooms: +m[1], peers: +m[2], talk: m[3] != null ? +m[3] : +m[2], streams: +(m[4] || 0), workers: +m[5] };
});
const NEED = Math.max(...SCEN.map(s => s.rooms * s.peers)), ROOMS = Math.max(...SCEN.map(s => s.rooms));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TICK = 100; // jiffies por segundo do /proc (Linux)

// ---------- CPU de processos pelo /proc (servidor e navegador inteiro, com os filhos) ----------
const cpuOf = (pid) => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (+f[11] + +f[12]) / TICK * 1000; } catch { return 0; } }; // ms
const rssOf = (pid) => { try { return +/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1] / 1024; } catch { return 0; } }; // MB
function tree(root) {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const pp = +fs.readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; (kids.get(pp) || kids.set(pp, []).get(pp)).push(+d); } catch { } }
  const out = [root]; for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || [])); return out;
}
const cpuTree = (root) => tree(root).reduce((n, p) => n + cpuOf(p), 0);

// ---------- servidor ----------
let srv = null, srvLog = '';
async function startServer(workers) {
  srvLog = '';
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41200', RTC_EXTRA_PORT: '41211', RTC_IPS: '127.0.0.1', SFU_WORKERS: String(workers), UX_TELEMETRY: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(BASE + '/api/server-info')).ok) return; } catch { } await sleep(150); }
  throw new Error('servidor não subiu:\n' + srvLog);
}
async function stopServer() { if (!srv) return; const p = srv; srv = null; p.kill(); await new Promise(r => { p.once('exit', r); setTimeout(r, 4000); }); }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

// ---------- pessoa simulada (roda dentro da página) ----------
const PEER_CODE = () => {
  const ctx = new AudioContext();
  const peers = window.__peers = [];
  window.mkPeer = async ({ base, token, cid, talk, stream, freq }) => {
    const { Device } = await import('/vendor/msc/mediasoup-client.js');
    const P = { token, cid, ws: null, rid: 0, pending: new Map(), consumers: new Map(), seen: new Set(), err: null, ready: false, resets: 0 };
    peers.push(P);
    const send = (t, d) => P.ws.readyState === 1 && P.ws.send(JSON.stringify({ t, d }));
    const req = (op, d = {}) => new Promise((res, rej) => { const rid = ++P.rid; P.pending.set(rid, { res, rej }); send('SFU', { ...d, rid, op }); setTimeout(() => { if (P.pending.delete(rid)) rej(new Error('sem resposta: ' + op)); }, 20000); });
    // microfone: tom com leve vibrato (o Opus não fica num quadro idêntico); quem não fala manda silêncio (DTX)
    const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), dst = ctx.createMediaStreamDestination();
    osc.frequency.value = freq; lfo.frequency.value = 3; lg.gain.value = 40; lfo.connect(lg).connect(osc.frequency);
    g.gain.value = talk ? 0.3 : 0; osc.connect(g).connect(dst); osc.start(); lfo.start();
    let screen = null;
    if (stream) { // transmissão de tela: canvas animado 1280x720@30
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let n = 0;
      setInterval(() => { n++; x.fillStyle = `hsl(${n * 3 % 360} 60% 40%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff'; for (let i = 0; i < 24; i++) x.fillRect((n * 11 + i * 83) % 1180, (i * 41) % 620, 90, 90); x.font = '60px monospace'; x.fillText('quadro ' + n, 30, 80); }, 33);
      screen = c.captureStream(30).getVideoTracks()[0];
    }
    const consume = async (pi) => {
      if (!P.ready || pi.user_id === P.uid || P.seen.has(pi.producer_id)) return;
      P.seen.add(pi.producer_id);
      try {
        const c = await req('consume', { transport_id: P.recv.id, producer_id: pi.producer_id, rtpCapabilities: P.device.rtpCapabilities });
        const cons = await P.recv.consume({ id: c.id, producerId: c.producer_id, kind: c.kind, rtpParameters: c.rtpParameters });
        P.consumers.set(cons.id, cons); await req('resume', { consumer_id: cons.id });
      } catch (e) { P.err = 'consume: ' + e.message; }
    };
    const start = async ({ rtpCapabilities }) => {
      const device = P.device = new Device(); await device.load({ routerRtpCapabilities: rtpCapabilities });
      const tr = async (dir) => {
        const info = await req('transport', { dir });
        const t = device[dir === 'send' ? 'createSendTransport' : 'createRecvTransport'](info);
        t.on('connect', ({ dtlsParameters }, ok, fail) => req('connect', { transport_id: t.id, dtlsParameters }).then(ok, fail));
        t.on('connectionstatechange', (st) => { P['st_' + dir] = st; });
        if (dir === 'send') t.on('produce', ({ kind, rtpParameters, appData }, ok, fail) => req('produce', { transport_id: t.id, kind, rtpParameters, source: appData.source }).then(ok, fail));
        return t;
      };
      P.send = await tr('send'); P.recv = await tr('recv');
      P.ready = true;
      for (const pi of (await req('producers')).producers) consume(pi);
      await P.send.produce({ track: dst.stream.getAudioTracks()[0], appData: { source: 'mic' }, encodings: [{ maxBitrate: 64000, priority: 'high' }], codecOptions: { opusStereo: false, opusDtx: true, opusFec: true, opusMaxAverageBitrate: 384000 }, stopTracks: false });
      if (screen) await P.send.produce({ track: screen, appData: { source: 'screen' }, stopTracks: false, encodings: [{ scaleResolutionDownBy: 4, maxBitrate: 300000 }, { scaleResolutionDownBy: 2, maxBitrate: 900000 }, { maxBitrate: 2500000 }], codecOptions: { videoGoogleStartBitrate: 1500 } });
    };
    await new Promise((resolve, reject) => {
      P.ws = new WebSocket(base.replace(/^http/, 'ws') + '/gateway?token=' + token);
      P.ws.onerror = () => reject(new Error('gateway'));
      P.ws.onmessage = (e) => {
        if (!/^\{"t":"(READY|VOICE_JOINED|SFU)/.test(e.data.slice(0, 20))) return; // o resto (presença, estados) não interessa
        const { t, d } = JSON.parse(e.data);
        if (t === 'READY') { P.uid = d.user.id; send('VOICE_JOIN', { channel_id: cid }); }
        else if (t === 'VOICE_JOINED' && d.sfu) start(d.sfu).then(resolve, (er) => { P.err = 'start: ' + er.message; reject(er); });
        else if (t === 'SFU_RES') { const p = P.pending.get(d.rid); if (p) { P.pending.delete(d.rid); d.error ? p.rej(new Error(d.error)) : p.res(d.data); } }
        else if (t === 'SFU_NEW_PRODUCER') consume(d);
        else if (t === 'SFU_CONSUMER_CLOSED') { P.consumers.get(d.consumer_id)?.close(); P.consumers.delete(d.consumer_id); }
        else if (t === 'SFU_RESET') { P.resets++; }
      };
      setTimeout(() => reject(new Error('não entrou na sala em 30 s')), 30000);
    });
  };
  // soma de todas as pessoas desta aba: pacotes (contadores acumulados), perda e jitter de quem recebe
  window.peerStats = async () => {
    const s = { aSent: 0, aRecv: 0, aLost: 0, vSent: 0, vRecvBytes: 0, vFrames: 0, jit: [], cons: 0, okConn: 0, n: peers.length, errs: peers.filter(p => p.err).map(p => p.err).slice(0, 3), resets: peers.reduce((n, p) => n + p.resets, 0) };
    for (const p of peers) {
      if (p.st_send === 'connected' && p.st_recv === 'connected') s.okConn++;
      s.cons += p.consumers.size;
      if (p.send) (await p.send.getStats()).forEach(r => { if (r.type === 'outbound-rtp') { if (r.kind === 'audio') s.aSent += r.packetsSent || 0; else s.vSent += r.packetsSent || 0; } });
      if (p.recv) (await p.recv.getStats()).forEach(r => { if (r.type !== 'inbound-rtp') return; if (r.kind === 'audio') { s.aRecv += r.packetsReceived || 0; s.aLost += Math.max(0, r.packetsLost || 0); if (r.jitter != null) s.jit.push(r.jitter * 1000); } else { s.vRecvBytes += r.bytesReceived || 0; s.vFrames += r.framesDecoded || 0; } });
    }
    return s;
  };
  window.closeAll = () => { for (const p of peers) { try { p.ws.close(); } catch { } try { p.send?.close(); p.recv?.close(); } catch { } } peers.length = 0; };
};

// ---------- execução ----------
const results = { host: { cpus: os.cpus().length, model: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30) }, at: new Date().toISOString(), scenarios: [] };
fs.mkdirSync(OUT.replace(/[^/]+$/, '') || '.', { recursive: true });
console.log(`preparando ${NEED} contas e ${ROOMS} salas em ${DATA}…`);
execFileSync(process.execPath, ['scripts/load/seed.mjs', String(NEED)], { env: { ...process.env, DATA_DIR: DATA }, stdio: 'ignore' });
const seed = JSON.parse(fs.readFileSync(DATA + '/load.json', 'utf8'));
await startServer(1);
const rooms = [];
while (rooms.length < ROOMS) rooms.push((await api('load-0', 'POST', `/guilds/${seed.guild}/channels`, { name: 'Sala ' + (rooms.length + 1), type: 2 })).id);
if (rooms.some(r => !r)) throw new Error('não consegui criar as salas');
await stopServer();

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--force-fieldtrials=WebRTC-Audio-Red-For-Opus/Disabled/'] });
const bpid = browser.process().pid;
const pct = (a, b) => b ? +(a / b * 100).toFixed(1) : 0;
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
const p95 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(1); };

for (const sc of SCEN) {
  const n = sc.rooms * sc.peers;
  console.log(`\n== ${sc.name}: ${sc.rooms} sala(s) x ${sc.peers} pessoas (${sc.talk} falando${sc.streams ? `, ${sc.streams} transmissão` : ''}), ${sc.workers} worker(s) ==`);
  const R = { ...sc, samples: [] };
  try {
    await startServer(sc.workers);
    const pages = [];
    for (let i = 0; i < Math.min(PAGES, n); i++) { const p = await (await browser.createBrowserContext()).newPage(); p.on('pageerror', e => console.log('  erro na página:', e.message)); await p.goto(BASE + '/api/server-info'); await p.evaluate(PEER_CODE); pages.push(p); }
    // entra uma pessoa por vez em cada aba (em paralelo entre as abas), como gente chegando
    const t0 = Date.now(); let fails = 0;
    await Promise.all(pages.map(async (pg, pi) => {
      for (let k = pi; k < n; k += pages.length) {
        const room = Math.floor(k / sc.peers), idx = k % sc.peers;
        try { await pg.evaluate((o) => window.mkPeer(o), { base: BASE, token: 'load-' + k, cid: rooms[room], talk: idx < sc.talk, stream: idx < sc.streams, freq: 180 + (k % 40) * 9 }); }
        catch (e) { fails++; if (fails <= 3) console.log('  pessoa', k, 'não entrou:', e.message.split('\n')[0]); }
      }
    }));
    console.log(`  ${n - fails}/${n} na sala em ${((Date.now() - t0) / 1000).toFixed(1)} s; aquecendo ${WARM} s…`);
    await sleep(WARM * 1000);
    const spid = srv.pid;
    let prev = null;
    const snap = async () => {
      const st = (await Promise.all(pages.map(p => p.evaluate(() => window.peerStats())))).reduce((a, s) => { for (const k of ['aSent', 'aRecv', 'aLost', 'vSent', 'vRecvBytes', 'vFrames', 'cons', 'okConn', 'n', 'resets']) a[k] = (a[k] || 0) + s[k]; a.jit.push(...s.jit); a.errs.push(...s.errs); return a; }, { jit: [], errs: [] });
      return { t: Date.now(), st, srvCpu: cpuOf(spid), brCpu: cpuTree(bpid), load: await api('load-0', 'GET', '/sfu/load') };
    };
    await api('load-0', 'GET', '/sfu/load'); prev = await snap();
    const tEnd = Date.now() + SECS * 1000;
    while (Date.now() < tEnd) {
      await sleep(5000);
      const cur = await snap(), dt = (cur.t - prev.t) / 1000, a = cur.st, b = prev.st, c = cur.load.current || {};
      const s = {
        workerCpu: (c.per_worker || [{ cpu: c.cpu, rooms: c.rooms, peers: c.peers }]).map(w => w.cpu), workerRssMB: c.rssMB,
        serverCpu: +((cur.srvCpu - prev.srvCpu) / dt / 10).toFixed(1), browserCpu: +((cur.brCpu - prev.brCpu) / dt / 10).toFixed(1),
        audioOutPps: Math.round((a.aSent - b.aSent) / dt), audioInPps: Math.round((a.aRecv - b.aRecv) / dt),
        lossPct: pct(a.aLost - b.aLost, (a.aRecv - b.aRecv) + (a.aLost - b.aLost)), jitterMs: { p50: med(a.jit), p95: p95(a.jit) },
        videoInMbps: +(((a.vRecvBytes - b.vRecvBytes) * 8 / dt) / 1e6).toFixed(1), videoFps: a.vFrames ? +((a.vFrames - b.vFrames) / dt).toFixed(0) : 0,
        consumers: a.cons, connected: a.okConn, peers: a.n, srvProducers: c.producers, srvConsumers: c.consumers, resets: a.resets,
      };
      R.samples.push(s); prev = cur;
      console.log(`  worker ${s.workerCpu.map(x => String(x ?? '-').padStart(5) + '%').join(' ')} | servidor ${String(s.serverCpu).padStart(5)}% | navegador ${String(s.browserCpu).padStart(5)}% | voz ${s.audioOutPps} p/s enviados, ${s.audioInPps} p/s recebidos, perda ${s.lossPct}%, jitter p95 ${s.jitterMs.p95} ms${s.videoInMbps ? ` | vídeo ${s.videoInMbps} Mb/s ${s.videoFps} q/s` : ''}${a.errs.length ? ' | erros: ' + a.errs.slice(0, 2).join('; ') : ''}`);
    }
    const S = R.samples, avg = (f) => +(S.reduce((n, s) => n + f(s), 0) / (S.length || 1)).toFixed(1);
    const nW = Math.max(...S.map(s => s.workerCpu.length));
    R.summary = {
      joined: n - fails, connected: S.at(-1)?.connected, consumers: S.at(-1)?.srvConsumers,
      workerCpuAvg: Array.from({ length: nW }, (_, i) => avg(s => s.workerCpu[i] || 0)), workerCpuMax: Math.max(...S.flatMap(s => s.workerCpu.filter(x => x != null))),
      serverCpuAvg: avg(s => s.serverCpu), browserCpuAvg: avg(s => s.browserCpu), workerRssMB: S.at(-1)?.workerRssMB,
      audioOutPps: avg(s => s.audioOutPps), audioInPps: avg(s => s.audioInPps), lossPct: avg(s => s.lossPct), jitterP95: avg(s => s.jitterMs.p95 || 0),
      ...(sc.streams ? { videoInMbps: avg(s => s.videoInMbps), videoFps: avg(s => s.videoFps) } : {}),
    };
    // pacotes que o SFU repassa: cada pacote recebido por alguém saiu do worker (é a medida de trabalho dele)
    R.summary.cpuPer1kPps = R.summary.audioInPps ? +(R.summary.workerCpuAvg.reduce((a, b) => a + b, 0) / (R.summary.audioInPps / 1000)).toFixed(2) : null;
    console.log('  RESUMO', JSON.stringify(R.summary));
    for (const p of pages) { await p.evaluate(() => window.closeAll()).catch(() => { }); await p.browserContext().close().catch(() => { }); }
  } catch (e) { console.log('  ERRO', e.message); R.error = String(e.stack || e); }
  results.scenarios.push(R);
  await stopServer(); await sleep(1000);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
}
await browser.close();
if (!process.env.KEEP) fs.rmSync(DATA, { recursive: true, force: true });
console.log('\nresultado em', OUT);
console.log('\n| cenário | conectados | consumers | CPU worker(s) | servidor | navegador | voz recebida (p/s) | perda | jitter p95 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results.scenarios) { const s = r.summary; if (!s) { console.log(`| ${r.name} | erro | | | | | | | |`); continue; } console.log(`| ${r.name} | ${s.connected}/${r.rooms * r.peers} | ${s.consumers} | ${s.workerCpuAvg.map(x => x + '%').join(' + ')} | ${s.serverCpuAvg}% | ${s.browserCpuAvg}% | ${s.audioInPps} | ${s.lossPct}% | ${s.jitterP95} ms |`); }
process.exit(0);
