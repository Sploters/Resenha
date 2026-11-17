// Buffer circular de uma transmissão: MediaRecorder em WebM, ~65s, e corte dos últimos N segundos. Sem imports de UI (testável).
import { findClusters, parseCluster, buildClip, videoTrack } from './webm.js';

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
