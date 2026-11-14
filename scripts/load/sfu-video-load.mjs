// Teste de carga do SFU com VÍDEO PESADO (transmissões de 120 FPS em 1080p, 1440p e 4K, em várias salas), sem navegador.
// O sfu-load.mjs simula as pessoas num Chromium, que não dá conta de decodificar tanto vídeo (o simulador virava o gargalo).
// Aqui só o servidor de mídia trabalha de verdade:
//  - FONTE: uma linha de execução manda RTP H.264 sintético (FU-A, quadro-chave com SPS/PPS a cada 2 s, quadros em rajada
//    a cada 1/fps, como um codificador) para um worker "fonte" separado, que repassa para a sala por pipeToRouter COM SRTP
//    (o worker da sala decifra a entrada, como na transmissão nativa do app, que chega por SRTP);
//  - SALA: um worker do mediasoup por sala ou dividido como no app (cada sala inteira num worker);
//  - ESPECTADORES: consumers em PlainTransports com SRTP (o worker cifra cada cópia, como para um navegador) mandando
//    para sockets UDP de outras linhas de execução, que só contam pacotes, bytes e buracos na numeração (perda).
// Mede a CPU de cada worker de sala (getResourceUsage), a do worker fonte e a do processo de teste (para saber se o
// gerador limitou), a taxa que chegou a cada espectador e a perda.
//
// Uso:  node scripts/load/sfu-video-load.mjs
//       CENARIOS="1x5:1440p120 4x5:1440p120w2" SECS=20 node scripts/load/sfu-video-load.mjs
// Cenário "SxV:<res>p<fps>[@<Mbps>][w<workers>]": S salas, cada uma com 1 transmissão e V espectadores; res 1080/1440/4k;
// sem @, a taxa é a padrão do app (public/voice.js bitrateFor: 1080p 4,5, 1440p 8, fonte 9 Mbps; x2,4 a 120 FPS, x1,6 a 60).
import * as mediasoup from 'mediasoup';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const SECS = +(process.env.SECS || 20), WARM = +(process.env.WARM || 5), OUT = process.env.OUT || '.testshots/sfu-video-load.json';
const BASE = { 1080: 4.5, 1440: 8, 4: 9 }, MULT = (fps) => (fps >= 120 ? 2.4 : fps >= 60 ? 1.6 : 1);
const SCEN = (process.env.CENARIOS || '1x5:1080p120 1x5:1440p120 1x5:4kp120 1x5:4kp120@64 4x5:1440p120 4x5:1440p120w2 8x5:1440p120 8x5:1440p120w2 4x10:1080p120 4x5:4kp120@64w2').trim().split(/\s+/).map(s => {
  const m = /^(\d+)x(\d+):(1080|1440|4k)p(\d+)(?:@(\d+(?:\.\d+)?))?(?:w(\d+))?$/.exec(s); if (!m) throw new Error('cenário inválido: ' + s);
  const fps = +m[4], mbps = m[5] ? +m[5] : Math.round(BASE[m[3] === '4k' ? 4 : m[3]] * MULT(fps) * 10) / 10;
  return { name: s, rooms: +m[1], viewers: +m[2], res: m[3], fps, mbps, workers: +(m[6] || 1) };
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const H264 = { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } };
const PT = 102;
const srtpKey = () => ({ cryptoSuite: 'AES_CM_128_HMAC_SHA1_80', keyBase64: crypto.randomBytes(30).toString('base64') });
const ru = async (w) => { const u = await w.getResourceUsage(); return u.ru_utime + u.ru_stime; }; // ms de CPU

// ---------- gerador de RTP (linha de execução própria) ----------
const SENDER = `
const { parentPort, workerData } = require('node:worker_threads');
const dgram = require('node:dgram');
const sock = dgram.createSocket('udp4');
const PAY = 1188, rnd = require('node:crypto').randomBytes(PAY);
let sent = 0, bytes = 0, stop = false;
const streams = workerData.map(s => ({ ...s, seq: Math.floor(Math.random() * 60000), frame: 0, gop: s.fps * 2 }));
function packet(s, marker, ts, payloadHead, len) {
  const b = Buffer.allocUnsafe(12 + len);
  b[0] = 0x80; b[1] = (marker ? 0x80 : 0) | s.pt; b.writeUInt16BE(s.seq, 2); s.seq = (s.seq + 1) & 0xffff;
  b.writeUInt32BE(ts >>> 0, 4); b.writeUInt32BE(s.ssrc, 8);
  payloadHead.copy(b, 12); rnd.copy(b, 12 + payloadHead.length, 0, len - payloadHead.length);
  sock.send(b, s.port, '127.0.0.1'); sent++; bytes += b.length;
}
function sendFrame(s) {
  const key = s.frame % s.gop === 0, avg = s.mbps * 1e6 / 8 / s.fps;
  // quadro-chave ~4x maior, os outros menores para a média bater com a taxa
  const size = Math.max(PAY, Math.round(key ? avg * 4 : (avg * s.gop - avg * 4) / (s.gop - 1)));
  const ts = Math.round(s.frame * 90000 / s.fps) + s.ts0;
  if (key) { // STAP-A com SPS (7) e PPS (8): o SFU só começa a repassar a cada espectador num quadro-chave
    const sps = Buffer.from([0x67, 0x42, 0xe0, 0x1f, 0xda, 0x01, 0x40, 0x16, 0xec, 0x04, 0x40]), pps = Buffer.from([0x68, 0xce, 0x3c, 0x80]);
    const st = Buffer.concat([Buffer.from([0x78]), Buffer.from([0, sps.length]), sps, Buffer.from([0, pps.length]), pps]);
    packet(s, false, ts, st, st.length);
  }
  const nal = key ? 5 : 1, n = Math.ceil(size / (PAY - 2));
  for (let i = 0; i < n; i++) {
    const fu = Buffer.from([0x60 | 28, (i === 0 ? 0x80 : 0) | (i === n - 1 ? 0x40 : 0) | nal]);
    packet(s, i === n - 1, ts, fu, PAY);
  }
  s.frame++;
}
const t0 = performance.now();
function tick() {
  if (stop) return;
  const el = performance.now() - t0;
  for (const s of streams) { const due = Math.floor(el * s.fps / 1000); let k = 0; while (s.frame <= due && k++ < 4) sendFrame(s); if (s.frame <= due) s.frame = due + 1; }
  setTimeout(tick, 1);
}
tick();
parentPort.on('message', (m) => { if (m === 'stats') parentPort.postMessage({ sent, bytes }); if (m === 'stop') { stop = true; sock.close(); } });
`;

// ---------- espectadores (contam o que chega) ----------
const RECEIVER = `
const { parentPort, workerData } = require('node:worker_threads');
const dgram = require('node:dgram');
const st = [];
let ready = 0;
if (!workerData.n) parentPort.postMessage({ ports: [] });
for (let i = 0; i < workerData.n; i++) {
  const s = { pk: 0, bytes: 0, base: -1, max: -1, cyc: 0 };
  const sock = dgram.createSocket('udp4');
  sock.on('message', (b) => {
    if (b[1] >= 200 && b[1] <= 206) return; // RTCP (o mediasoup manda relatórios)
    if (b.readUInt32BE(8) === 1234) return; // pacotes de sondagem de banda do mediasoup (numeração própria)
    s.pk++; s.bytes += b.length;
    const seq = b.readUInt16BE(2);
    if (s.base < 0) { s.base = seq; s.max = seq; return; }
    const d = (seq - (s.max & 0xffff) + 65536) % 65536;
    if (d > 0 && d < 30000) { if (seq < (s.max & 0xffff)) s.cyc += 65536; s.max = s.cyc + seq; }
  });
  sock.bind(0, '127.0.0.1', () => { s.port = sock.address().port; if (++ready === workerData.n) parentPort.postMessage({ ports: st.map(x => x.port) }); });
  s.sock = sock; st.push(s);
}
parentPort.on('message', (m) => {
  if (m === 'stats') parentPort.postMessage({ stats: st.map(s => ({ pk: s.pk, bytes: s.bytes, expected: s.base < 0 ? 0 : s.max - s.base + 1 })) });
  if (m === 'stop') st.forEach(s => s.sock.close());
});
`;
const ask = (w, msg, key) => new Promise(res => { const f = (m) => { if (key in m) { w.off('message', f); res(m); } }; w.on('message', f); w.postMessage(msg); });

async function run(sc) {
  const target = []; for (let i = 0; i < sc.workers; i++) target.push(await mediasoup.createWorker({ logLevel: 'error' }));
  const srcW = await mediasoup.createWorker({ logLevel: 'error' }), src = await srcW.createRouter({ mediaCodecs: [H264] });
  const routers = await Promise.all(target.map(w => w.createRouter({ mediaCodecs: [H264] })));
  // espectadores divididos em 2 linhas de execução
  const totalV = sc.rooms * sc.viewers, half = Math.ceil(totalV / 2);
  const recv = [new Worker(RECEIVER, { eval: true, workerData: { n: half } }), new Worker(RECEIVER, { eval: true, workerData: { n: totalV - half } })];
  const ports = (await Promise.all(recv.map(w => new Promise(res => w.once('message', m => res(m.ports)))))).flat();
  const streams = [];
  for (let r = 0; r < sc.rooms; r++) {
    const router = routers[r % routers.length]; // como o app: cada sala inteira num worker
    const inT = await src.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: true, comedia: true });
    const ssrc = 1000000 + r * 7919;
    const prod = await inT.produce({ kind: 'video', rtpParameters: { codecs: [{ ...H264, payloadType: PT, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'ccm', parameter: 'fir' }] }], encodings: [{ ssrc }] } });
    const { pipeProducer } = await src.pipeToRouter({ producerId: prod.id, router, enableSrtp: true });
    for (let v = 0; v < sc.viewers; v++) {
      const t = await router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: true, comedia: false, enableSrtp: true, srtpCryptoSuite: 'AES_CM_128_HMAC_SHA1_80' });
      await t.connect({ ip: '127.0.0.1', port: ports[r * sc.viewers + v], srtpParameters: srtpKey() });
      await t.consume({ producerId: pipeProducer.id, rtpCapabilities: router.rtpCapabilities });
    }
    streams.push({ port: inT.tuple.localPort, pt: PT, ssrc, fps: sc.fps, mbps: sc.mbps, ts0: Math.floor(Math.random() * 1e9) });
  }
  const sender = new Worker(SENDER, { eval: true, workerData: streams });
  await sleep(WARM * 1000);
  const c0 = process.cpuUsage(), w0 = await Promise.all(target.map(ru)), s0 = await ru(srcW), r0 = (await Promise.all(recv.map(w => ask(w, 'stats', 'stats')))).flatMap(m => m.stats), t0 = performance.now();
  const tx0 = await ask(sender, 'stats', 'sent');
  await sleep(SECS * 1000);
  const el = performance.now() - t0, c1 = process.cpuUsage(c0), w1 = await Promise.all(target.map(ru)), s1 = await ru(srcW), r1 = (await Promise.all(recv.map(w => ask(w, 'stats', 'stats')))).flatMap(m => m.stats);
  const tx1 = await ask(sender, 'stats', 'sent');
  sender.postMessage('stop'); recv.forEach(w => w.postMessage('stop')); await sleep(200);
  await Promise.all([sender.terminate(), ...recv.map(w => w.terminate())]);
  target.forEach(w => w.close()); srcW.close();

  const per = r1.map((x, i) => ({ pk: x.pk - r0[i].pk, bytes: x.bytes - r0[i].bytes, exp: x.expected - r0[i].expected }));
  const pk = per.reduce((n, x) => n + x.pk, 0), exp = per.reduce((n, x) => n + x.exp, 0), bytes = per.reduce((n, x) => n + x.bytes, 0);
  const viewerMbps = per.map(x => x.bytes * 8 / el / 1000), inPps = (tx1.sent - tx0.sent) / el * 1000;
  return {
    ...sc, secs: Math.round(el / 1000),
    cpu_workers: w1.map((v, i) => Math.round((v - w0[i]) / el * 1000) / 10), // % de um núcleo
    cpu_fonte: Math.round((s1 - s0) / el * 1000) / 10, cpu_teste: Math.round((c1.user + c1.system) / 1000 / el * 1000) / 10,
    entrada_pps: Math.round(inPps), saida_pps: Math.round(pk / el * 1000), saida_mbps: Math.round(bytes * 8 / el / 1000),
    por_espectador_mbps: { min: Math.round(Math.min(...viewerMbps) * 10) / 10, max: Math.round(Math.max(...viewerMbps) * 10) / 10 },
    perda_pct: exp ? Math.round((1 - pk / exp) * 1000) / 10 : null,
  };
}

console.log(`SFU com vídeo pesado: ${os.cpus().length} núcleos, ${SECS} s por cenário (+${WARM} s de aquecimento)\n`);
const results = [];
for (const sc of SCEN) {
  process.stdout.write(`  ${sc.name.padEnd(18)} ${sc.rooms} sala(s) x (1 transmissão ${sc.res === '4k' ? '4K' : sc.res + 'p'}${sc.fps} a ${sc.mbps} Mb/s + ${sc.viewers} espectadores), ${sc.workers} worker(s) … `);
  const r = await run(sc); results.push(r);
  console.log(`CPU ${r.cpu_workers.map(v => v + '%').join(' + ')} | sai ${r.saida_mbps} Mb/s (${(r.saida_pps / 1000).toFixed(1)} mil p/s) | espectador ${r.por_espectador_mbps.min}–${r.por_espectador_mbps.max} Mb/s | perda ${r.perda_pct}% | fonte ${r.cpu_fonte}% teste ${r.cpu_teste}%`);
}
fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), cores: os.cpus().length, secs: SECS, results }, null, 2));
console.log(`\nresultado em ${OUT}`);
process.exit(0);
