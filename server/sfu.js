// SFU (mediasoup): cada pessoa envia áudio/vídeo uma vez ao servidor, que repassa aos outros.
// Se o mediasoup não carregar (ou RTC=0), o gateway cai para a malha P2P antiga.
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = Number(process.env.RTC_PORT || 40000);
const SOURCES = ['mic', 'cam', 'screen', 'screenaudio'];
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  // High: o Chromium só usa a placa de vídeo (NVENC/AMF/QuickSync) com várias camadas neste perfil; o Baseline cai no OpenH264 (CPU)
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '640032', 'level-asymmetry-allowed': 1 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

// Workers do mediasoup: cada um é um processo (1 núcleo). Cada sala fica inteira num worker (o com menos gente na hora
// em que a sala abre). SFU_WORKERS=N (ou "auto": núcleos, até 4); padrão 1. Cada worker extra escuta numa porta própria
// (RTC_EXTRA_PORT, padrão 40011, 40012…; 40001-40010 são da transmissão nativa) que precisa estar aberta como a 40000.
const EXTRA_PORT = Number(process.env.RTC_EXTRA_PORT || 40011);
const workers = []; // { worker, webRtcServer, port, dead, lastRu, peakCpu, restarts, diedAt }
// Recuperação: worker que morre é recriado sozinho na mesma porta (espera 1 s, 2 s, 5 s… até 60 s entre tentativas) e
// quem estava nas salas dele recebe SFU_RESET: o app refaz só a conexão de mídia (sem sair da sala nem avisar os outros)
// e cai num worker vivo. Antes a sala ficava muda até todo mundo sair, e o servidor precisava ser reiniciado.
let msMod = null;
const events = []; // últimos acontecimentos do SFU (painel de saúde do servidor)
let onEvent = () => { };
export const onSfuEvent = (fn) => { onEvent = fn; };
const note = (kind, text) => { events.push({ at: Date.now(), kind, text }); if (events.length > 50) events.shift(); console.log('  SFU:', text); try { onEvent(kind, text); } catch { } };
// Piso da banda estimada de cada espectador. Sem ele o consumidor começa na camada MENOR (480x270) e leva 10-25 s (às vezes nunca) para subir,
// porque a estimativa de banda no servidor fica em ~0,3-0,5 Mbps enquanto só a camada pequena é enviada. 0 desliga (internet muito lenta).
const MIN_OUT_KBPS = process.env.SFU_MIN_OUT_KBPS != null ? Math.max(0, +process.env.SFU_MIN_OUT_KBPS || 0) : 6000;
const WEAK_KBPS = 800; // piso para quem mostrou perda (a camada leve da transmissão + voz cabem)
const rooms = new Map(); // channelId -> { router, peers: Map<userId, Peer> }

// IPs anunciados: RTC_ANNOUNCED_IP (Docker/NAT) ou todos os IPv4 das interfaces (inclui a da VPN)
function listenInfos(port) {
  const out = [];
  if (process.env.RTC_ANNOUNCED_IP) {
    // RTC_LISTEN_IP: escutar só numa interface (padrão: todas). O scripts/voice-network-test.mjs usa para pôr um relé com
    // perda e atraso entre o navegador e o SFU (escuta em 127.0.0.2, anuncia 127.0.0.1, onde fica o relé)
    const announcedAddress = process.env.RTC_ANNOUNCED_IP.split(',')[0].trim(), ip = process.env.RTC_LISTEN_IP || '0.0.0.0';
    for (const protocol of ['udp', 'tcp']) out.push({ protocol, ip, announcedAddress, port });
    return out;
  }
  const ips = process.env.RTC_IPS ? process.env.RTC_IPS.split(',').map(s => s.trim())
    : [...new Set(Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => i.address))];
  for (const ip of ips) for (const protocol of ['udp', 'tcp']) out.push({ protocol, ip, port });
  return out;
}

export async function startSfu() {
  if (process.env.RTC === '0') return false;
  const want = process.env.SFU_WORKERS === 'auto' ? Math.min(os.availableParallelism?.() || os.cpus().length, 4) : Math.max(1, Math.min(16, Number(process.env.SFU_WORKERS) || 1));
  let ms;
  try { ms = msMod = await import('mediasoup'); } catch (e) { console.log(`  (SFU indisponível, voz em malha P2P: ${e.message})`); return false; }
  for (let i = 0; i < want; i++) {
    const port = i === 0 ? PORT : EXTRA_PORT + i - 1;
    try {
      const w = await openWorker(port);
      workers.push(w);
      if (i === 0) console.log(`  SFU de voz ativo (mediasoup ${ms.version}) na porta ${PORT} UDP/TCP: ${[...new Set(w.infos.map(x => x.announcedAddress || x.ip))].join(', ')}`);
    } catch (e) {
      if (i === 0) { console.log(`  (SFU indisponível, voz em malha P2P: ${e.message})`); return false; }
      console.log(`  (SFU: worker extra na porta ${port} não abriu: ${e.message}; seguindo com ${workers.length})`); break;
    }
  }
  if (workers.length > 1) console.log(`  SFU: ${workers.length} workers (portas ${workers.map(w => w.port).join(', ')})`);
  return true;
}
async function openWorker(port, prev = null) {
  let worker = null;
  try {
    worker = await msMod.createWorker({ logLevel: 'warn' });
    const infos = listenInfos(port), w = { worker, infos, webRtcServer: await worker.createWebRtcServer({ listenInfos: infos }), port, dead: false, lastRu: null, peakCpu: 0, restarts: prev?.restarts || 0, diedAt: prev?.diedAt || 0, startedAt: Date.now() };
    worker.on('died', (err) => onWorkerDied(w, err));
    return w;
  } catch (e) { worker?.close(); throw e; }
}
const RESPAWN_WAIT = [1000, 2000, 5000, 10000, 30000, 60000];
function onWorkerDied(w, err) {
  if (w.dead) return;
  w.dead = true; w.diedAt = Date.now();
  // quem estava nas salas deste worker refaz a conexão de mídia (cai num worker vivo ou no recriado)
  let peers = 0;
  for (const [cid, r] of [...rooms]) {
    if (r.w !== w) continue;
    rooms.delete(cid);
    for (const p of r.peers.values()) { peers++; try { p.close(); } catch { } try { p.notify('SFU_RESET', { reason: 'worker' }); } catch { } }
  }
  note('worker_died', `worker do mediasoup da porta ${w.port} morreu (${err?.message || 'sem motivo'}); ${peers} pessoa(s) reconectando a mídia`);
  respawn(w, 0);
}
function respawn(old, attempt) {
  const wait = RESPAWN_WAIT[Math.min(attempt, RESPAWN_WAIT.length - 1)];
  setTimeout(async () => {
    try {
      const w = await openWorker(old.port, old);
      w.restarts = old.restarts + 1;
      const i = workers.indexOf(old); if (i >= 0) workers[i] = w; else workers.push(w);
      note('worker_restarted', `worker da porta ${old.port} recriado (${w.restarts}ª vez)`);
    } catch (e) {
      note('worker_restart_failed', `não consegui recriar o worker da porta ${old.port}: ${e.message}; tentando de novo`);
      respawn(old, attempt + 1);
    }
  }, wait).unref?.();
}
const live = () => workers.filter(w => !w.dead);
// ligado = o SFU subiu (mesmo com um worker sendo recriado agora: quem entra nesse instante tenta de novo, não cai na malha P2P)
export const sfuEnabled = () => workers.length > 0;
export const sfuReady = () => live().length > 0;
// worker para uma sala nova: o com menos gente agora (empate: menos salas)
function pickWorker() {
  const load = new Map(live().map(w => [w, [0, 0]]));
  for (const r of rooms.values()) { const x = load.get(r.w); if (x) { x[0] += r.peers.size; x[1]++; } }
  return [...load].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])[0]?.[0];
}

async function roomFor(cid) {
  let r = rooms.get(cid);
  if (r && r.w?.dead) { rooms.delete(cid); r = null; } // worker morreu: a sala recomeça noutro
  if (!r) {
    const w = pickWorker(); if (!w) throw new Error('SFU indisponível');
    r = { router: null, peers: new Map(), ready: null, w };
    rooms.set(cid, r);
    r.ready = w.worker.createRouter({ mediaCodecs: MEDIA_CODECS }).then(router => (r.router = router));
  }
  await r.ready;
  return r;
}

// Entra na sala: devolve as capacidades RTP do roteador para o cliente carregar o Device
export async function sfuJoin(cid, uid, notify) {
  const r = await roomFor(cid);
  r.peers.get(uid)?.close();
  const peer = { uid, notify, transports: new Map(), producers: new Map(), consumers: new Map(),
    close() { for (const t of this.transports.values()) t.close(); this.transports.clear(); } };
  r.peers.set(uid, peer);
  return { rtpCapabilities: r.router.rtpCapabilities };
}

export function sfuLeave(cid, uid) {
  const r = rooms.get(cid); if (!r) return;
  const peer = r.peers.get(uid); if (!peer) return;
  peer.close(); r.peers.delete(uid);
  if (!r.peers.size) { r.router?.close(); rooms.delete(cid); }
}

const producerInfo = (p, uid) => ({ producer_id: p.id, user_id: uid, kind: p.kind, source: p.appData.source });

// "Falando" medido no servidor (AudioLevelObserver): para quem está ensurdecido, que não recebe as vozes (economiza banda e
// processador) mas continua vendo quem fala. Só quem pediu ('levels') recebe SFU_SPEAKING, e só quando a lista muda.
// Limiar de -50 dBov e 250 ms: bate com o medidor do app em ~83% das amostras, acendendo ~150 ms depois
// (scripts/speaking-server-test.mjs).
const LEVEL_DB = +(process.env.SFU_SPEAK_DB || -50);
function levelsFor(r) {
  return r.levelsP ||= r.router.createAudioLevelObserver({ maxEntries: 16, threshold: LEVEL_DB, interval: 250 }).then((o) => {
    let last = '';
    const push = (ids) => { const k = ids.sort().join(); if (k === last) return; last = k; for (const x of r.peers.values()) if (x.wantLevels) x.notify('SFU_SPEAKING', { ids }); };
    o.on('volumes', (v) => push([...new Set(v.map(x => x.producer.appData.uid).filter(Boolean))]));
    o.on('silence', () => push([]));
    r.levelsNow = () => last ? last.split(',') : [];
    return o;
  });
}
// Publica o producer na sala e avisa os demais participantes
function registerProducer(r, peer, source, p) {
  peer.producers.get(source)?.close();
  peer.producers.set(source, p);
  if (source === 'mic' && p.kind === 'audio') levelsFor(r).then(o => o.addProducer({ producerId: p.id }).catch(() => { }), () => { });
  p.appData.uid = peer.uid;
  p.on('transportclose', () => peer.producers.get(source) === p && peer.producers.delete(source));
  p.observer.on('close', () => {
    if (peer.producers.get(source) === p) peer.producers.delete(source);
    for (const o of r.peers.values()) if (o !== peer) o.notify('SFU_PRODUCER_CLOSED', producerInfo(p, peer.uid));
  });
  for (const o of r.peers.values()) if (o !== peer) o.notify('SFU_NEW_PRODUCER', producerInfo(p, peer.uid));
}

// Bot de música: recebe RTP/Opus local (ffmpeg) e publica como o microfone de um participante.
// O ffmpeg deve enviar para 127.0.0.1:<port> com o payload type 101 e o ssrc devolvidos.
export async function sfuAttachRtp(cid, uid) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  const t = await r.router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: true, comedia: true });
  const ssrc = 1000000 + Math.floor(Math.random() * 1e8);
  const p = await t.produce({ kind: 'audio', appData: { source: 'mic' }, rtpParameters: {
    codecs: [{ mimeType: 'audio/opus', payloadType: 101, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1, 'sprop-stereo': 1 } }],
    encodings: [{ ssrc }] } });
  peer.transports.set(t.id, t);
  t.observer.on('close', () => peer.transports.delete(t.id));
  registerProducer(r, peer, 'mic', p);
  return { port: t.tuple.localPort, ssrc, payloadType: 101, close: () => { try { p.close(); } catch { } try { t.close(); } catch { } } };
}

// Transmissão nativa (teste de 120 FPS): um programa no PC captura a tela, comprime em H.264 na placa de vídeo e
// manda RTP puro (UDP) para esta porta. Aparece na sala como a transmissão de tela da pessoa.
// Porta(s): RTC_NATIVE_PORTS (padrão 40001-40010, UDP), anunciadas no mesmo IP do SFU. comedia: o servidor aprende o
// endereço de quem enviar o primeiro pacote (só quem tem o código sabe a porta e o ssrc; numa VPN isso basta para o teste).
const NATIVE_PORTS = (() => { const [a, b] = String(process.env.RTC_NATIVE_PORTS || '40001-40010').split('-').map(Number); return { min: a || 40001, max: b || a || 40010 }; })();
function nativeListen() {
  if (process.env.RTC_ANNOUNCED_IP) return { protocol: 'udp', ip: '0.0.0.0', announcedAddress: process.env.RTC_ANNOUNCED_IP.split(',')[0].trim(), portRange: NATIVE_PORTS };
  return { protocol: 'udp', ip: '0.0.0.0', portRange: NATIVE_PORTS };
}
export const NATIVE_PT = 102;
// layers: quantas camadas (simulcast por ssrc, da mais leve para a cheia); o SFU escolhe para cada espectador a que cabe na banda dele
export async function sfuAttachNative(cid, uid, layers = 1) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  // SRTP: só quem recebeu a chave (o app de quem transmite, pelo gateway autenticado) consegue mandar vídeo nesta porta
  const t = await r.router.createPlainTransport({ listenInfo: nativeListen(), rtcpMux: true, comedia: true, enableSctp: false, enableSrtp: true, srtpCryptoSuite: 'AES_CM_128_HMAC_SHA1_80' });
  const key = crypto.randomBytes(30).toString('base64');
  try { await t.connect({ srtpParameters: { cryptoSuite: 'AES_CM_128_HMAC_SHA1_80', keyBase64: key } }); } catch (e) { t.close(); throw e; }
  const n = Math.max(1, Math.min(3, layers | 0)), base = 1000000 + Math.floor(Math.random() * 1e8);
  const ssrcs = Array.from({ length: n }, (_, i) => base + i * 7919), ssrc = ssrcs[n - 1];
  let p;
  try {
    p = await t.produce({ kind: 'video', appData: { source: 'screen', native: true, layers: n }, rtpParameters: {
      codecs: [{ mimeType: 'video/H264', payloadType: NATIVE_PT, clockRate: 90000,
        parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 },
        rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'ccm', parameter: 'fir' }] }],
      encodings: ssrcs.map(x => ({ ssrc: x })) } });
  } catch (e) { t.close(); throw e; }
  peer.transports.set(t.id, t);
  t.observer.on('close', () => peer.transports.delete(t.id));
  registerProducer(r, peer, 'screen', p);
  return { transport: t, producer: p, port: t.tuple.localPort, ip: t.tuple.localAddress, ssrc, ssrcs, payloadType: NATIVE_PT, key, serverKey: t.srtpParameters.keyBase64,
    close: () => { try { p.close(); } catch { } try { t.close(); } catch { } } };
}

// Requisições do cliente (via gateway). Retorna o payload da resposta ou lança erro.
export async function sfuRequest(cid, uid, op, d) {
  const r = rooms.get(cid), peer = r?.peers.get(uid);
  if (!peer) throw new Error('fora da sala');
  const transport = () => { const t = peer.transports.get(String(d.transport_id)); if (!t) throw new Error('transporte inválido'); return t; };
  switch (op) {
    case 'transport': {
      if ([...peer.transports.values()].filter(t => t.appData?.dir).length >= 2) throw new Error('transportes demais');
      const t = await r.router.createWebRtcTransport({ webRtcServer: r.w.webRtcServer, enableUdp: true, enableTcp: true, preferUdp: true, initialAvailableOutgoingBitrate: 8_000_000, appData: { dir: d.dir === 'send' ? 'send' : 'recv' } });
      if (t.appData.dir === 'recv' && MIN_OUT_KBPS > 0) await t.setMinOutgoingBitrate(MIN_OUT_KBPS * 1000).catch(() => { });
      peer.transports.set(t.id, t);
      return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
    }
    case 'connect': await transport().connect({ dtlsParameters: d.dtlsParameters }); return {};
    // conexão de mídia caiu (troca de Wi-Fi, 4G, oscilação): credenciais ICE novas para o app reconectar sem refazer tudo
    case 'restart_ice': { const t = transport(); return { iceParameters: await t.restartIce() }; }
    case 'produce': {
      const t = transport(), source = String(d.source);
      if (t.appData.dir !== 'send' || !SOURCES.includes(source)) throw new Error('produção inválida');
      const p = await t.produce({ kind: d.kind, rtpParameters: d.rtpParameters, appData: { source } });
      registerProducer(r, peer, source, p);
      return { id: p.id };
    }
    case 'close_producer': { const p = peer.producers.get(String(d.source)); p?.close(); return {}; }
    case 'producers': { // o que já está sendo transmitido na sala
      const out = [];
      for (const o of r.peers.values()) if (o !== peer) for (const p of o.producers.values()) out.push(producerInfo(p, o.uid));
      return { producers: out };
    }
    case 'consume': {
      const t = transport(), pid = String(d.producer_id);
      if (t.appData.dir !== 'recv') throw new Error('transporte inválido');
      if (!r.router.canConsume({ producerId: pid, rtpCapabilities: d.rtpCapabilities })) {
        // quem pediu não decodifica o codec da transmissão (ex.: H.264 High num PC sem decodificação de vídeo pela placa):
        // pede a quem transmite para trocar pelo VP8, que todo navegador recebe; a nova transmissão chega a todos sozinha
        for (const o of r.peers.values()) for (const p of o.producers.values()) {
          if (p.id !== pid || p.kind !== 'video' || p.appData.native || p.appData.fallbackAsked || !/h264/i.test(p.rtpParameters.codecs[0]?.mimeType || '')) continue;
          p.appData.fallbackAsked = true; o.notify('SFU_CODEC_FALLBACK', { source: p.appData.source });
        }
        throw new Error('não é possível consumir');
      }
      const c = await t.consume({ producerId: pid, rtpCapabilities: d.rtpCapabilities, paused: true });
      peer.consumers.set(c.id, c);
      // conexão fraca de quem recebe: a nota (0-10) do que chega até ela cai com perda. Aí o piso de banda deixa de valer
      // para essa pessoa (senão o servidor seguia mandando vídeo acima do que a internet dela aguenta e a voz picotava)
      c.on('score', (sc) => { if (sc.score < 7 && !t.appData.weak && MIN_OUT_KBPS > WEAK_KBPS) { t.appData.weak = true; t.setMinOutgoingBitrate(WEAK_KBPS * 1000).catch(() => { }); } });
      const drop = () => { if (peer.consumers.delete(c.id)) peer.notify('SFU_CONSUMER_CLOSED', { consumer_id: c.id }); };
      c.on('producerclose', drop); c.on('transportclose', () => peer.consumers.delete(c.id));
      return { id: c.id, producer_id: pid, kind: c.kind, rtpParameters: c.rtpParameters };
    }
    case 'levels': { // quer saber quem fala pelo servidor (ensurdecido): já recebe a lista de agora
      peer.wantLevels = !!d.on; if (peer.wantLevels) await levelsFor(r);
      return { ids: peer.wantLevels ? r.levelsNow?.() || [] : [] };
    }
    case 'pause': { const c = peer.consumers.get(String(d.consumer_id)); if (c) d.paused ? await c.pause() : await c.resume(); return {}; }
    case 'layers': { const c = peer.consumers.get(String(d.consumer_id)); if (c?.kind === 'video') await c.setPreferredLayers({ spatialLayer: Math.max(0, Math.min(2, d.spatial | 0)), temporalLayer: 2 }).catch(() => { }); return {}; }
    // perda de verdade da voz que esta pessoa envia, vista pelo servidor. O relatório RTCP que o navegador recebe não serve:
    // com a correção de erros do Opus ligada, o mediasoup põe nele a PIOR perda entre quem ouve (para o Opus mandar mais
    // correção), então a internet ruim de um ouvinte aparecia como "perda saindo" de quem fala (public/callqual.js)
    case 'upstats': {
      let count = 0, lost = 0, seen = false;
      for (const p of peer.producers.values()) {
        if (p.kind !== 'audio' || p.closed) continue;
        for (const st of await p.getStats().catch(() => [])) if (st.type === 'inbound-rtp') { seen = true; count += st.packetCount || 0; lost += Math.max(0, st.packetsLost || 0); }
      }
      return seen ? { count, lost } : {};
    }
    case 'resume': { await peer.consumers.get(String(d.consumer_id))?.resume(); return {}; }
    default: throw new Error('operação desconhecida');
  }
}

// Para o painel de admin / diagnóstico
export const sfuStats = () => ({ enabled: sfuEnabled(), rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0) });
// estado de cada worker (painel de saúde): vivo/morto, quantas vezes foi recriado, pico de CPU, salas e pessoas
export const sfuWorkers = () => workers.map(w => ({ port: w.port, pid: w.worker?.pid, alive: !w.dead, restarts: w.restarts || 0, diedAt: w.diedAt || null, startedAt: w.startedAt, peakCpu: w.peakCpu,
  rooms: [...rooms.values()].filter(r => r.w === w).length, peers: [...rooms.values()].filter(r => r.w === w).reduce((n, r) => n + r.peers.size, 0) }));
export const sfuEvents = () => events.slice();

// Carga dos workers do mediasoup: CPU (% de um núcleo, entre duas amostras), memória e contagem de objetos.
// Amostrado a cada 15 s; guarda o pico e as últimas amostras. Se o pico se aproximar de 100% de um núcleo, é hora de usar mais workers.
// Com vários workers: cpu = o do worker mais carregado (é ele que trava primeiro); "per_worker" traz cada um.
const loadHist = []; let peakCpu = 0;
async function sampleLoad() {
  const ws = live(); if (!ws.length) return null;
  const now = Date.now(), per = [];
  for (const w of ws) {
    const ru = await w.worker.getResourceUsage();
    let cpu = null;
    if (w.lastRu) { const dt = now - w.lastRu.t, du = (ru.ru_utime + ru.ru_stime) - w.lastRu.cpu; cpu = dt > 0 ? +(du / dt * 100).toFixed(1) : null; } // ru_utime/ru_stime em ms (mediasoup): % de um núcleo
    w.lastRu = { t: now, cpu: ru.ru_utime + ru.ru_stime };
    if (cpu != null) w.peakCpu = Math.max(w.peakCpu, cpu);
    per.push({ port: w.port, cpu, rssMB: Math.round(ru.ru_maxrss / 1024), rooms: [...rooms.values()].filter(r => r.w === w).length, peers: [...rooms.values()].filter(r => r.w === w).reduce((n, r) => n + r.peers.size, 0) });
  }
  let transports = 0, producers = 0, consumers = 0;
  for (const r of rooms.values()) for (const p of r.peers.values()) { transports += p.transports.size; producers += p.producers.size; consumers += p.consumers.size; }
  const cpus = per.map(x => x.cpu).filter(x => x != null), cpu = cpus.length ? Math.max(...cpus) : null;
  const smp = { t: now, cpu, rssMB: per.reduce((n, x) => n + x.rssMB, 0), rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0), transports, producers, consumers, ...(per.length > 1 ? { per_worker: per } : {}) };
  if (cpu != null) peakCpu = Math.max(peakCpu, cpu);
  loadHist.push(smp); if (loadHist.length > 240) loadHist.shift();
  return smp;
}
setInterval(() => { sampleLoad().catch(() => { }); }, 15000).unref();
export async function sfuLoad() {
  const cur = await sampleLoad();
  return { enabled: sfuEnabled(), workers: live().length, current: cur, peakCpuPercent: peakCpu, history: loadHist.slice(-40) };
}
