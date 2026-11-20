// Buffer circular de uma transmissão: MediaRecorder em WebM, ~65s, e corte dos últimos N segundos. Sem imports de UI (testável).
import { findClusters, parseCluster, buildClip, videoTrack, splitWebm } from './webm.js';
import { tracksOf, framesOf, writeWebm } from './cliprecode.js';

const KEEP = 65000; // padrão: 60 s de clipe + folga (opts.keep muda: clipes de 2 min guardam ~125 s)

// faixas que entram no clipe (vídeo da transmissão + áudio da transmissão, que chega num stream separado)
const liveTracks = (stream, audio) => [...stream.getVideoTracks(), ...(audio?.getAudioTracks() || []), ...stream.getAudioTracks()].filter(t => t.readyState === 'live');
export const trackSig = (stream, audio) => liveTracks(stream, audio).map(t => t.id).join(',');

// Mistura várias fontes de áudio numa trilha só, para o clipe (o MediaRecorder grava só UMA trilha de áudio).
// Fontes podem entrar e sair sem reiniciar a gravação: trocar de microfone, o áudio da transmissão chegar depois do vídeo...
// Limitador no fim: jogo + voz juntos não estouram.
export function createMixer(ctx) {
  const dest = ctx.createMediaStreamDestination(), lim = ctx.createDynamicsCompressor(), conn = new Map(); // id da trilha -> nó
  lim.threshold.value = -3; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .15;
  lim.connect(dest);
  let had = false;
  return {
    stream: dest.stream,
    get had() { return had; }, // alguma fonte de áudio já entrou (senão o clipe é mudo)
    get size() { return conn.size; }, // fontes ligadas agora
    set(streams) {
      const want = new Map();
      for (const s of streams) for (const t of s?.getAudioTracks?.() || []) if (t.readyState === 'live') want.set(t.id, t);
      for (const [id, n] of conn) if (!want.has(id)) { n.disconnect(); conn.delete(id); }
      for (const [id, t] of want) if (!conn.has(id)) { try { const n = ctx.createMediaStreamSource(new MediaStream([t])); n.connect(lim); conn.set(id, n); had = true; } catch { /* trilha inválida */ } }
    },
    stop() { for (const n of conn.values()) n.disconnect(); conn.clear(); lim.disconnect(); dest.stream.getTracks().forEach(t => t.stop()); },
  };
}

// Limita a taxa de quadros de uma trilha de vídeo para o clipe. Captura local (a sua transmissão pelo Chromium, a prévia
// do programa nativo) aceita applyConstraints e o próprio Chromium descarta os quadros. A trilha que chega por WebRTC (a
// transmissão de outra pessoa) recusa (OverconstrainedError): aí os quadros passam por um worker que repassa no máximo
// `fps` por segundo (fpsdrop-worker.js). Devolve { track, stop } ou null quando não dá para limitar (grava a taxa cheia).
export async function limitFps(track, fps) {
  const c = track.clone();
  try { await c.applyConstraints({ frameRate: { ideal: fps, max: fps } }); return { track: c, how: 'constraints', stop: () => c.stop() }; } catch { /* trilha remota */ }
  if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator || !window.Worker) { c.stop(); return null; }
  try {
    const proc = new MediaStreamTrackProcessor({ track: c }), gen = new MediaStreamTrackGenerator({ kind: 'video' });
    const w = new Worker(new URL('./fpsdrop-worker.js', import.meta.url));
    w.postMessage({ readable: proc.readable, writable: gen.writable, fps }, [proc.readable, gen.writable]);
    return { track: gen, how: 'worker', stop: () => { c.stop(); gen.stop(); w.terminate(); } };
  } catch { c.stop(); return null; }
}
// teto do bitrate pelo FPS do clipe e por quanto tempo fica guardado (memória: 60 s a 15 Mb/s ≈ 110 MB; 2 min a 11 Mb/s ≈ 165 MB)
export const bpsCap = (fps, keep) => (keep > 70000 ? (fps > 60 ? 11_000_000 : fps > 30 ? 9_000_000 : 6_000_000) : (fps > 60 ? 15_000_000 : fps > 30 ? 12_000_000 : 8_000_000));

// opts.maxFps: 30, 60 ou 120 (padrão 60); 0 = sem limite (a taxa da transmissão)
export function createBuffer(stream, audio, opts = {}) {
  if (!stream || !window.MediaRecorder) return null;
  const tracks = liveTracks(stream, audio);
  if (!tracks.some(t => t.kind === 'video')) return null;
  const hasAudio = tracks.some(t => t.kind === 'audio');
  const vt0 = tracks.find(t => t.kind === 'video'), st = vt0.getSettings?.() || {};
  const maxFps = opts.maxFps ?? 60;
  // o FPS que o clipe deve ter: o limite escolhido, ou o da transmissão. Só a captura local informa a taxa de verdade
  // (getCapabilities().frameRate); a trilha remota (WebRTC) informa uma estimativa que começa em ~20–30 mesmo chegando a
  // 120, e o bitrate saía baixo: nela vale o limite pedido (ou 120, igual à transmissão)
  const known = !!vt0.getCapabilities?.()?.frameRate && st.frameRate > 0;
  const fps = Math.max(1, maxFps ? Math.min(maxFps, known ? st.frameRate : maxFps) : (known ? st.frameRate : 120));
  // H.264 primeiro = o codificador da placa de vídeo quando o Chromium tem um (opts.hw === false: só VP9/VP8, pela CPU)
  const codecs = opts.hw === false ? ['vp9', 'vp8'] : ['h264', 'vp9', 'vp8'];
  const mimeType = (opts.mimes || codecs.map(c => `video/webm;codecs=${c}${hasAudio ? ',opus' : ''}`)).concat('video/webm').find(m => MediaRecorder.isTypeSupported(m));
  const keep = opts.keep || KEEP;
  // qualidade: bitrate proporcional à resolução e ao FPS do clipe (a 120 fps, com o teto de 30, cada quadro ficava com 1/4
  // dos bits e o movimento borrava), com teto por FPS e por duração guardada (bpsCap)
  // a trilha remota também começa informando a resolução baixa (o WebRTC sobe a qualidade aos poucos): nela supõe 1080p
  // (é só o alvo do codificador; o teto por FPS continua valendo)
  const px = known && st.width ? st.width * st.height : 1920 * 1080;
  const bps = opts.bps || Math.round(Math.min(bpsCap(fps, keep), Math.max(3_000_000, px * fps * 0.15)));
  const buf = { keep, mimeType, bps, fps, maxFps, hasAudio, stream, sig: trackSig(stream, audio), rec: null, header: null, chunks: [], clusters: [], size: 0, tail: new Uint8Array(0), q: Promise.resolve(), onEnd: null, limiter: null, how: 'cheio' };
  // começa já com a trilha original e troca pela limitada assim que ela fica pronta (alguns ms): trocar a trilha de um
  // MediaRecorder não dá, então o limitador é decidido antes de gravar — a espera é só a do applyConstraints
  buf.ready = (maxFps ? limitFps(vt0, maxFps) : Promise.resolve(null)).then((lim) => {
    if (buf.stopped) { lim?.stop(); return; }
    buf.limiter = lim; buf.how = lim ? lim.how : 'cheio';
    start(tracks.map(t => (t === vt0 && lim ? lim.track : t)));
  });
  const ingest = async (blob, t) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()), start = buf.size;
    const joined = new Uint8Array(buf.tail.length + bytes.length); joined.set(buf.tail); joined.set(bytes, buf.tail.length);
    for (const off of findClusters(joined, start - buf.tail.length)) {
      if (!buf.header && start === 0) buf.header = bytes.slice(0, off);
      buf.clusters.push({ off, t: t - 1000 }); // o pedaço chega no fim do seu segundo: o cluster começou ~1s antes
    }
    buf.tail = bytes.slice(-3); buf.size += bytes.length;
    buf.chunks.push({ start, size: bytes.length, t, blob });
    while (buf.chunks.length > 1 && buf.chunks[0].t < t - buf.keep) buf.chunks.shift();
    const first = buf.chunks[0].start;
    while (buf.clusters.length && buf.clusters[0].off < first) buf.clusters.shift();
  };
  const start = (rtracks) => {
    let rec;
    try { rec = new MediaRecorder(new MediaStream(rtracks), { mimeType, videoBitsPerSecond: bps, audioBitsPerSecond: 160_000, videoKeyFrameIntervalDuration: 1000 }); } catch { buf.limiter?.stop(); buf.onEnd?.(); return; }
    buf.rec = rec;
    rec.ondataavailable = (e) => { if (e.data?.size) { const t = Date.now(); buf.q = buf.q.then(() => ingest(e.data, t)).catch(() => { }); } };
    rec.onerror = rec.onstop = () => buf.onEnd?.();
    rec.start(1000);
  };

  // devolve um Blob WebM com os últimos `secs` segundos (começa no quadro-chave mais próximo, até ~1s antes), ou null
  buf.cut = async (secs) => {
    await buf.ready; await buf.q;
    if (!buf.header || !buf.clusters.length) return null;
    const cl = buf.clusters, base = cl[0].off;
    const slice = (a, z) => { // bytes absolutos [a, z) dos pedaços guardados
      const parts = [];
      for (const c of buf.chunks) { if (c.start + c.size <= a || c.start >= z) continue; parts.push(c.blob.slice(Math.max(0, a - c.start), Math.min(c.size, z - c.start))); }
      return new Blob(parts);
    };
    const all = new Uint8Array(await slice(base, buf.size).arrayBuffer());
    const list = cl.map((c, i) => all.subarray(c.off - base, (cl[i + 1]?.off ?? buf.size) - base));
    const vt = videoTrack(buf.header), info = list.map(c => parseCluster(c, vt)), last = info[info.length - 1];
    if (!last) return null;
    const endTs = last.ts + Math.max(0, buf.chunks[buf.chunks.length - 1].t - cl[cl.length - 1].t); // tempo de mídia ao fim do que foi gravado
    let pick = -1;
    for (let i = 0; i < list.length; i++) if (info[i]?.keyStart && info[i].ts <= endTs - secs * 1000) pick = i; // quadro-chave mais recente que ainda cobre o pedido
    if (pick < 0) pick = info.findIndex(x => x?.keyStart); // buffer menor que o pedido: tudo desde o 1º quadro-chave
    if (pick < 0) return null;
    const out = buildClip(buf.header, list.slice(pick), endTs);
    return out && new Blob([out], { type: 'video/webm' });
  };
  buf.stop = () => { buf.stopped = true; buf.onEnd = null; try { if (buf.rec && buf.rec.state !== 'inactive') buf.rec.stop(); } catch { /* já parado */ } buf.limiter?.stop(); buf.chunks = []; buf.clusters = []; buf.header = null; };
  return buf;
}

// ---------- clipe da própria transmissão pelo programa nativo (app desktop, 60/120 FPS) ----------
// O lc-stream guarda os quadros H.264 que a placa de vídeo JÁ comprimiu para a transmissão (native/lc-stream/src/replay.rs).
// Aqui só o ÁUDIO é gravado (Opus, leve) e, ao clipar, os dois viram um WebM igual ao do MediaRecorder (cortar, recortar
// exato, compartilhar: tudo igual). Antes o Chromium capturava a tela de novo e recomprimia em H.264 só para o clipe.
// O vídeo sai na taxa e na qualidade da transmissão (até 120 FPS), sem o limite de FPS do clipe: não dá para tirar
// quadros de um H.264 pronto sem recomprimir.

// arquivo do programa: "LCRB" | versão | largura | altura | avcC | quadros (hora em ms do relógio do sistema, chave, AVC)
export function parseNativeClip(b) {
  if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
  if (b.length < 21 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'LCRB' || b[4] !== 1) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(5, true), h = dv.getUint32(9, true), al = dv.getUint32(13, true);
  let p = 17 + al; if (p + 4 > b.length) return null;
  const avcc = b.subarray(17, p), n = dv.getUint32(p, true); p += 4;
  const frames = [];
  for (let i = 0; i < n; i++) {
    if (p + 13 > b.length) return null;
    const at = dv.getFloat64(p, true), key = b[p + 8] === 1, len = dv.getUint32(p + 9, true); p += 13;
    if (p + len > b.length) return null;
    frames.push({ at, key, data: b.subarray(p, p + len) }); p += len;
  }
  return frames.length && frames[0].key ? { w, h, avcc, frames } : null;
}

// cabeçalho EBML de um WebM (quando não há áudio para copiar o do MediaRecorder)
const EBML_WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08,
  0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]);
const segStart = (h) => { for (let i = 0; i < Math.min(h.length - 4, 128); i++) if (h[i] === 0x18 && h[i + 1] === 0x53 && h[i + 2] === 0x80 && h[i + 3] === 0x67) return i; return -1; };

// vídeo já comprimido (parseNativeClip, ou o worker dos quadros recebidos: codec V_VP8 sem avcC) + áudio gravado ao vivo ({ bytes: WebM de áudio, anchor: hora do tempo 0 dele }) ->
// WebM com cluster novo em cada quadro-chave (onde o corte pode começar). Os dois se alinham pela hora do relógio.
export function muxNativeClip(nv, audio) {
  const base = nv.frames[0].at, video = { num: 1, codec: nv.codec || 'V_MPEG4/ISO/AVC', priv: nv.avcc || null, w: nv.w, h: nv.h };
  let ebml = EBML_WEBM, araw = null, af = [];
  const sp = audio?.bytes?.length ? splitWebm(audio.bytes) : null, tr = sp && tracksOf(sp.header).find(t => t.type === 2);
  if (tr && segStart(sp.header) > 0) {
    ebml = sp.header.subarray(0, segStart(sp.header)); araw = tr.raw; video.num = tr.num === 1 ? 2 : 1;
    try { af = framesOf(sp, true).filter(f => f.track === tr.num).map(f => ({ ...f, key: true, t: Math.round(audio.anchor + f.t - base) })); } catch { af = []; araw = null; }
  }
  const vf = nv.frames.map(f => ({ track: video.num, t: Math.round(f.at - base), key: f.key, data: f.data }));
  // fim: o último quadro mais a duração típica de um quadro
  const gaps = vf.slice(1).map((f, i) => f.t - vf[i].t).filter(x => x > 0).sort((a, b) => a - b), step = gaps[gaps.length >> 1] || 16;
  const end = vf[vf.length - 1].t + step;
  const frames = [...vf, ...(araw ? af.filter(f => f.t >= 0 && f.t < end) : [])].sort((a, b) => a.t - b.t || (a.track === video.num ? -1 : 1));
  return { bytes: writeWebm(ebml, video, araw, end, frames), ms: end, audio: !!araw };
}

// Buffer em que o VÍDEO já vem comprimido de fora (programa nativo ou receptor do WebRTC) e só o ÁUDIO é gravado aqui.
// src: { fetch(secs) -> Promise<{ ok, nv (como parseNativeClip) } | { ok: false, error }>, keep(ms), stop(), how, mime }
function createSplicedBuffer(src, audio, keep) {
  const buf = { keep, fps: 0, maxFps: 0, bps: 0, how: src.how, mimeType: src.mime, hasAudio: false, rec: null,
    header: null, chunks: [], clusters: [], size: 0, tail: new Uint8Array(0), anchor: 0, q: Promise.resolve(), onEnd: null, ready: Promise.resolve() };
  src.keep(keep);
  // áudio: os mesmos pedaços de 1 s do MediaRecorder do clipe normal, guardados pelo mesmo tempo
  const ingest = async (blob, t) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()), start = buf.size;
    const joined = new Uint8Array(buf.tail.length + bytes.length); joined.set(buf.tail); joined.set(bytes, buf.tail.length);
    for (const off of findClusters(joined, start - buf.tail.length)) {
      // cabeçalho = tudo antes do 1º cluster (pode ter chegado em mais de um pedaço)
      if (!buf.header) buf.header = new Uint8Array(await new Blob([...buf.chunks.map(c => c.blob), blob]).slice(0, off).arrayBuffer());
      buf.clusters.push(off);
    }
    buf.tail = bytes.slice(-3); buf.size += bytes.length;
    buf.chunks.push({ start, size: bytes.length, t, blob });
    while (buf.chunks.length > 1 && buf.chunks[0].t < t - keep) buf.chunks.shift();
    while (buf.clusters.length && buf.clusters[0] < buf.chunks[0].start) buf.clusters.shift();
  };
  const tracks = audio?.getAudioTracks?.().filter(t => t.readyState === 'live') || [];
  const mime = window.MediaRecorder && ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));
  if (tracks.length && mime) {
    try {
      const rec = buf.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, audioBitsPerSecond: 160_000 });
      buf.hasAudio = true;
      rec.ondataavailable = (e) => { if (e.data?.size) { const t = Date.now(); buf.q = buf.q.then(() => ingest(e.data, t)).catch(() => { }); } };
      rec.onerror = () => { buf.rec = null; }; // segue só com o vídeo
      // tempo 0 do áudio: o MediaRecorder conta a partir do primeiro pedaço de áudio, que chega logo depois de start()
      rec.start(1000); buf.anchor = Date.now();
    } catch { buf.rec = null; buf.hasAudio = false; }
  }
  const audioBytes = async () => {
    await buf.q;
    if (!buf.header || !buf.clusters.length) return null;
    const a = buf.clusters[0], parts = [buf.header];
    for (const c of buf.chunks) { if (c.start + c.size <= a) continue; parts.push(c.blob.slice(Math.max(0, a - c.start))); }
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  };
  // Blob WebM com os últimos `secs` segundos (do quadro-chave anterior), ou null (buf.error diz por quê)
  buf.cut = async (secs) => {
    const r = await src.fetch(secs);
    if (!r?.ok) { buf.error = r?.error || 'sem resposta'; return null; }
    const nv = r.nv;
    const out = muxNativeClip(nv, buf.rec || buf.chunks.length ? { bytes: await audioBytes(), anchor: buf.anchor } : null);
    buf.last = { frames: nv.frames.length, ms: out.ms, w: nv.w, h: nv.h, codec: nv.codec || 'V_MPEG4/ISO/AVC', audio: out.audio, fps: Math.round(nv.frames.length / Math.max(0.001, out.ms / 1000)), ...(r.stats ? { src: r.stats } : {}) };
    return new Blob([out.bytes], { type: 'video/webm' });
  };
  buf.stop = () => {
    buf.stopped = true; buf.onEnd = null;
    try { if (buf.rec && buf.rec.state !== 'inactive') buf.rec.stop(); } catch { /* já parado */ }
    src.stop(); buf.chunks = []; buf.clusters = []; buf.header = null;
  };
  return buf;
}

// opts: { keep (ms), desk (window.lcDesktop) }. audio: o stream da mistura (createMixer) ou null
export function createNativeBuffer(audio, opts = {}) {
  const desk = opts.desk || window.lcDesktop;
  if (!desk?.nativeClip) return null;
  const buf = createSplicedBuffer({
    how: 'nativo', mime: 'video/webm;codecs=h264,opus',
    keep: (ms) => desk.nativeClipKeep?.(ms), stop: () => desk.nativeClipKeep?.(0),
    fetch: async (secs) => {
      const r = await desk.nativeClip(secs);
      if (!r?.ok || !r.bytes) return { ok: false, error: r?.error || 'sem resposta' };
      const nv = parseNativeClip(r.bytes);
      return nv ? { ok: true, nv } : { ok: false, error: 'arquivo do programa ilegível' };
    },
  }, audio, opts.keep || KEEP);
  buf.native = true;
  return buf;
}

// ---------- clipe da transmissão de outra pessoa: os quadros comprimidos que chegam pelo WebRTC (cliptap-worker.js) ----------
// Só pelo servidor (SFU), em VP8 ou H.264, com RTCRtpScriptTransform e sem a cifra das chamadas protegidas (que já ocupa
// o encaixe do receptor). Fora disso, quem chama usa o createBuffer (MediaRecorder). O vídeo sai na taxa e na qualidade
// em que chega (a camada que o servidor manda para você), sem o limite de FPS do clipe.
// Encaixa o worker no receptor do vídeo de uma transmissão que está chegando, DURANTE a negociação (mediasoup-client
// consume({ onRtpReceiver })): colocado depois, ou com o vídeo já chegando, não recebeu quadro nenhum. Fica só deixando os quadros
// passarem até um buffer de clipe pedir. null quando não dá.
// receptor (transmissão de outra pessoa) ou, com { send: true }, o enviador da sua (o codec vem depois: setCodec)
export function attachTap(target, codec, { send = false } = {}) {
  if (!target || target.transform || !window.RTCRtpScriptTransform || !window.Worker || (!send && !/^video\/(vp8|h264)$/i.test(codec || ''))) return null;
  try {
    const worker = new Worker(new URL('./cliptap-worker.js', import.meta.url));
    target.transform = new RTCRtpScriptTransform(worker, { codec: codec || '', side: send ? 'send' : 'recv' });
    return { worker, receiver: target, send, codec: codec || '', busy: false, close: () => worker.terminate(), setCodec(c) { this.codec = c; worker.postMessage({ cmd: 'codec', codec: c }); } };
  } catch { return null; }
}
export const canTap = (tap) => !!(tap?.worker && !tap.busy);

export function createTapBuffer(tap, audio, opts = {}) {
  if (!canTap(tap)) return null;
  const keep = opts.keep || KEEP, w = tap.worker;
  tap.busy = true;
  let seq = 0; const waits = new Map(), stats = { keyAsks: 0 };
  w.onmessage = ({ data: m }) => {
    if (m?.needKey) { stats.keyAsks++; tap.requestKey?.(); return; }
    const f = waits.get(m?.id); if (f) { waits.delete(m.id); f(m); }
  };
  const buf = createSplicedBuffer({
    how: tap.send ? 'quadros enviados' : 'quadros recebidos', mime: `video/webm;codecs=${/h264/i.test(tap.codec) ? 'h264' : 'vp8'},opus`,
    keep: (ms) => w.postMessage({ cmd: 'keep', ms }),
    // o worker continua no receptor (tirar não adianta: o Chromium não o religaria depois), só para de guardar
    stop: () => { for (const f of waits.values()) f({ ok: false, error: 'parado' }); waits.clear(); w.onmessage = null; try { w.postMessage({ cmd: 'keep', ms: 0 }); } catch { /* worker encerrado */ } tap.busy = false; },
    fetch: async (secs) => {
      const id = ++seq, m = await new Promise((res) => { waits.set(id, res); w.postMessage({ cmd: 'clip', id, secs }); setTimeout(() => { if (waits.delete(id)) res({ ok: false, error: 'o worker não respondeu' }); }, 10000); });
      if (!m.ok) return { ok: false, error: m.error + (m.stats ? ' ' + JSON.stringify(m.stats) : '') };
      const delay = Math.max(0, Math.min(1000, (await tap.delayMs?.().catch(() => 0)) || 0)), sz = tap.size?.() || {};
      const frames = []; let o = 0;
      for (let i = 0; i < m.lens.length; i++) { frames.push({ at: m.ats[i] + delay, key: m.keys[i] === 1, data: m.data.subarray(o, o + m.lens[i]) }); o += m.lens[i]; }
      return { ok: true, nv: { codec: m.codec, avcc: m.avcc, w: m.w || sz.w || 1920, h: m.h || sz.h || 1080, frames }, stats: { ...m.stats, ...stats, delay: Math.round(delay) } };
    },
  }, audio, keep);
  buf.tap = tap;
  return buf;
}
