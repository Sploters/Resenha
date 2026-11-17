// Corte EXATO de um clipe WebM. Sem recomprimir, um corte só pode começar num quadro-chave (os clipes têm um a cada ~1 s):
// o vídeo começava até 1 s antes do ponto escolhido. Aqui o trecho é decodificado a partir do quadro-chave anterior e
// recodificado (WebCodecs, na placa de vídeo quando dá) começando exatamente no ponto marcado; o áudio é copiado como está.
// Sem imports de UI. Lança erro quando não dá (navegador sem WebCodecs, codec desconhecido): quem chama usa o corte rápido.
import { splitWebm, parseCluster, readId, readSize } from './webm.js';

const uint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
const txt = (b, p, n) => new TextDecoder().decode(b.subarray(p, p + n)).replace(/\0+$/, '');
// filhos de um elemento EBML: [{ id, data, end, from }]
function children(b, from, to) {
  const out = [];
  for (let q = from; q < to;) {
    const id = readId(b, q); const s = id && readSize(b, q + id.len); if (!s || s.unknown) break;
    const data = q + id.len + s.len, end = Math.min(to, data + s.value);
    out.push({ id: id.id, data, end, from: q }); q = data + s.value;
  }
  return out;
}

// trilhas do cabeçalho: [{ num, type (1 vídeo, 2 áudio), codec, priv, w, h, raw (o TrackEntry inteiro) }]
function tracksOf(h) {
  for (let i = 0; i < h.length - 4; i++) {
    if (h[i] !== 0x16 || h[i + 1] !== 0x54 || h[i + 2] !== 0xae || h[i + 3] !== 0x6b) continue;
    const s = readSize(h, i + 4); if (!s) return [];
    const end = s.unknown ? h.length : Math.min(h.length, i + 4 + s.len + s.value);
    return children(h, i + 4 + s.len, end).filter(e => e.id === 0xae).map((e) => {
      const t = { num: 0, type: 0, codec: '', priv: null, w: 0, h: 0, raw: h.subarray(e.from, e.end) };
      for (const c of children(h, e.data, e.end)) {
        if (c.id === 0xd7) t.num = uint(h, c.data, c.end - c.data);
        else if (c.id === 0x83) t.type = uint(h, c.data, c.end - c.data);
        else if (c.id === 0x86) t.codec = txt(h, c.data, c.end - c.data);
        else if (c.id === 0x63a2) t.priv = h.slice(c.data, c.end);
        else if (c.id === 0xe0) for (const v of children(h, c.data, c.end)) { if (v.id === 0xb0) t.w = uint(h, v.data, v.end - v.data); else if (v.id === 0xba) t.h = uint(h, v.data, v.end - v.data); }
      }
      return t;
    });
  }
  return [];
}

// todos os quadros: [{ track, t (ms desde o início do arquivo), key, data }]
function framesOf(sp) {
  const out = []; let base = null;
  for (const c of sp.clusters) {
    const x = parseCluster(c); if (!x) throw new Error('cluster ilegível');
    base ??= x.ts;
    for (const e of children(c, x.body, x.end)) {
      let blk = -1, end = e.end, key = false;
      if (e.id === 0xa3) blk = e.data;
      else if (e.id === 0xa0) { let ref = false; for (const g of children(c, e.data, e.end)) { if (g.id === 0xa1) { blk = g.data; end = g.end; } else if (g.id === 0xfb) ref = true; } key = !ref; }
      if (blk < 0) continue;
      const tr = readSize(c, blk); if (!tr) continue;
      const p = blk + tr.len, v = (c[p] << 8) | c[p + 1], flags = c[p + 2];
      if (flags & 0x06) throw new Error('quadros agrupados (lacing) não suportados');
      if (e.id === 0xa3) key = !!(flags & 0x80);
      out.push({ track: tr.value, t: x.ts - base + (v & 0x8000 ? v - 0x10000 : v), key, data: c.subarray(p + 3, end) });
    }
  }
  return out;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
function decoderConfig(t) {
  if (t.codec === 'V_VP8') return { codec: 'vp8' };
  if (t.codec === 'V_VP9') return { codec: 'vp09.00.10.08' };
  if (t.codec === 'V_AV1') return { codec: 'av01.0.08M.08', ...(t.priv?.length > 4 ? { description: t.priv.subarray(4) } : {}) };
  if (t.codec === 'V_MPEG4/ISO/AVC') {
    const p = t.priv;
    if (p && p.length > 6 && p[0] === 1) return { codec: `avc1.${hex2(p[1])}${hex2(p[2])}${hex2(p[3])}`, description: p };
    return { codec: 'avc1.640033' }; // sem avcC: Annex B
  }
  throw new Error('codec de vídeo não suportado: ' + t.codec);
}

// codificador para a saída: H.264 na placa de vídeo primeiro (rápido), depois VP9 e VP8
async function pickEncoder(w, h, bitrate, framerate, srcCodec) {
  const avc = [{ codec: 'avc1.640033', avc: { format: 'avc' } }, { codec: 'avc1.4d0033', avc: { format: 'avc' } }, { codec: 'avc1.42e033', avc: { format: 'avc' } }];
  const vp = [{ codec: 'vp09.00.40.08' }, { codec: 'vp8' }];
  const order = srcCodec === 'V_MPEG4/ISO/AVC' ? [...avc, ...vp] : [...vp, ...avc];
  for (const hw of ['prefer-hardware', 'no-preference']) for (const c of order) {
    const cfg = { ...c, width: w, height: h, bitrate, framerate, bitrateMode: 'variable', latencyMode: 'quality', hardwareAcceleration: hw };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, id: c.codec.startsWith('avc') ? 'V_MPEG4/ISO/AVC' : c.codec === 'vp8' ? 'V_VP8' : 'V_VP9' }; } catch { /* tenta o próximo */ }
  }
  throw new Error('nenhum codificador de vídeo disponível');
}

// ---------- escrita do WebM ----------
const vint8 = (v) => { const o = new Uint8Array(8); o[0] = 0x01; for (let i = 7; i >= 1; i--) { o[i] = v % 256; v = Math.floor(v / 256); } return o; };
const idBytes = (id) => { const o = []; while (id > 0) { o.unshift(id & 255); id = Math.floor(id / 256); } return o; };
const cat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const el = (id, ...payload) => { const body = cat(payload.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)))); return cat([Uint8Array.from(idBytes(id)), vint8(body.length), body]); };
const uel = (id, v) => { const b = []; do { b.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return el(id, b); };
const sel = (id, s) => el(id, new TextEncoder().encode(s));
const fel = (id, v) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, v); return el(id, new Uint8Array(dv.buffer)); };

// ebml: bytes do cabeçalho EBML original (antes do Segment). frames: [{ track, t (ms), key, data }] já na ordem do tempo
function writeWebm(ebml, video, audioRaw, durMs, frames) {
  const vEntry = el(0xae, uel(0xd7, video.num), uel(0x73c5, video.num), uel(0x83, 1), sel(0x86, video.codec),
    ...(video.priv ? [el(0x63a2, video.priv)] : []), el(0xe0, uel(0xb0, video.w), uel(0xba, video.h)));
  const parts = [ebml, Uint8Array.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    el(0x1549a966, uel(0x2ad7b1, 1000000), sel(0x4d80, 'Resenha'), sel(0x5741, 'Resenha'), fel(0x4489, durMs)),
    el(0x1654ae6b, vEntry, ...(audioRaw ? [audioRaw] : []))];
  let cl = null; // { t, blocks: [] }
  const flush = () => { if (cl) parts.push(el(0x1f43b675, uel(0xe7, cl.t), ...cl.blocks)); cl = null; };
  for (const f of frames) {
    // cluster novo em cada quadro-chave de vídeo (é onde um corte futuro pode começar) ou quando o tempo relativo estoura
    if (!cl || (f.track === video.num && f.key) || f.t - cl.t > 30000) { flush(); cl = { t: f.t, blocks: [] }; }
    const rel = f.t - cl.t;
    cl.blocks.push(el(0xa3, Uint8Array.from([0x80 | f.track, (rel >> 8) & 255, rel & 255, f.key ? 0x80 : 0]), f.data));
  }
  flush();
  return cat(parts);
}

// espera a fila do codec baixar (sem isso, um clipe de 2 min põe milhares de quadros na memória da placa)
const below = (c, n) => (c.state !== 'configured' || (c.decodeQueueSize ?? c.encodeQueueSize) <= n ? null
  : new Promise(r => { c.addEventListener('dequeue', r, { once: true }); setTimeout(r, 2000); }));

/**
 * Corta bytes (WebM) entre startMs e endMs exatamente. onProgress(0..1). Devolve { bytes, startMs, endMs }.
 */
export async function exactTrim(bytes, startMs, endMs, onProgress) {
  if (!window.VideoDecoder || !window.VideoEncoder) throw new Error('este navegador não tem WebCodecs');
  const sp = splitWebm(bytes); if (!sp) throw new Error('arquivo ilegível');
  const tracks = tracksOf(sp.header), vt = tracks.find(t => t.type === 1), at = tracks.find(t => t.type === 2);
  if (!vt || vt.num > 126 || (at && at.num > 126)) throw new Error('trilhas inesperadas');
  const all = framesOf(sp), vid = all.filter(f => f.track === vt.num);
  const a = Math.max(0, startMs), b = endMs;
  let from = -1; for (let i = 0; i < vid.length; i++) if (vid[i].key && vid[i].t <= a) from = i;
  if (from < 0) from = vid.findIndex(f => f.key);
  if (from < 0) throw new Error('sem quadro-chave');
  const todo = []; for (let i = from; i < vid.length && vid[i].t < b; i++) todo.push(vid[i]);
  // o quadro que está na tela no instante `a` (o último que começa até ele) entra como o primeiro, no tempo 0
  const firstKeep = todo.reduce((k, f, i) => (f.t <= a ? i : k), 0), keepFrom = todo[firstKeep].t;
  const kept = todo.length - firstKeep; if (kept < 1) throw new Error('trecho sem vídeo');
  const span = Math.max(1, b - a);
  const srcBytes = todo.slice(firstKeep).reduce((n, f) => n + f.data.length, 0);
  const bitrate = Math.round(Math.min(25e6, Math.max(2e6, (srcBytes * 8) / (span / 1000) * 1.2)));
  const framerate = Math.min(240, Math.max(1, Math.round(kept / (span / 1000))));

  let err = null, enc = null, vinfo = null, lastKey = -Infinity, done = 0;
  const out = [];
  const fail = (e) => { err ||= e instanceof Error ? e : new Error(String(e?.message || e)); };
  const startEnc = async (w, h) => {
    const pick = await pickEncoder(w & ~1, h & ~1, bitrate, framerate, vt.codec);
    vinfo = { num: vt.num, codec: pick.id, priv: null, w: w & ~1, h: h & ~1 };
    enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description && !vinfo.priv) { const d = meta.decoderConfig.description; vinfo.priv = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0)); }
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        out.push({ track: vt.num, t: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key', data });
        onProgress?.(Math.min(0.99, ++done / kept));
      },
      error: fail,
    });
    enc.configure(pick.cfg);
  };
  let encReady = null, pend = [];
  const dec = new VideoDecoder({
    output: (frame) => {
      const t = Math.round(frame.timestamp / 1000);
      if (t < keepFrom || t >= b || err) { frame.close(); return; }
      pend.push(frame);
      encReady ||= startEnc(frame.displayWidth, frame.displayHeight).catch(fail);
    },
    error: fail,
  });
  dec.configure({ ...decoderConfig(vt), hardwareAcceleration: 'no-preference', optimizeForLatency: false });
  // os quadros decodificados vão para o codificador com o tempo novo (a partir de 0) e um quadro-chave a cada ~1 s
  const pump = async () => {
    if (!pend.length) return;
    await encReady; if (err) { pend.forEach(f => f.close()); pend = []; return; }
    while (pend.length) {
      const f = pend.shift(), t = Math.max(0, Math.round(f.timestamp / 1000) - a);
      const nf = new VideoFrame(f, { timestamp: t * 1000, duration: f.duration ?? undefined }); f.close();
      const key = t - lastKey >= 1000; if (key) lastKey = t;
      enc.encode(nf, { keyFrame: key }); nf.close();
      await below(enc, 6);
    }
  };
  try {
    for (const f of todo) {
      if (err) break;
      dec.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.t * 1000, data: f.data }));
      await below(dec, 6);
      await pump();
    }
    if (!err) await dec.flush().catch(fail);
    await pump();
    if (!err && enc) await enc.flush().catch(fail);
  } finally {
    try { dec.close(); } catch { /* já fechado */ }
    try { enc?.close(); } catch { /* já fechado */ }
    pend.forEach(f => f.close());
  }
  if (err) throw err;
  if (!out.length || !vinfo) throw new Error('nada foi codificado');
  if (vinfo.codec === 'V_MPEG4/ISO/AVC' && !vinfo.priv) throw new Error('codificador H.264 sem avcC');
  // áudio: os blocos do trecho, copiados, no tempo novo
  const aud = at ? all.filter(f => f.track === at.num && f.t >= a && f.t < b).map(f => ({ ...f, t: f.t - a, key: true })) : [];
  out.sort((x, y) => x.t - y.t);
  const frames = [...out, ...aud].sort((x, y) => x.t - y.t || (x.track === vt.num ? -1 : 1));
  // cabeçalho EBML original (antes do Segment)
  let seg = -1; for (let i = 0; i < Math.min(sp.header.length - 4, 64); i++) if (sp.header[i] === 0x18 && sp.header[i + 1] === 0x53 && sp.header[i + 2] === 0x80 && sp.header[i + 3] === 0x67) { seg = i; break; }
  if (seg < 0) throw new Error('cabeçalho sem Segment');
  const res = writeWebm(sp.header.subarray(0, seg), vinfo, at ? at.raw : null, span, frames);
  onProgress?.(1);
  return { bytes: res, startMs: a, endMs: b };
}
