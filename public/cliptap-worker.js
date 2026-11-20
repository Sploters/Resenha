// Clipe da transmissão de OUTRA pessoa sem recomprimir: ligado ao receptor do WebRTC (RTCRtpScriptTransform, o mesmo
// encaixe da cifra das chamadas protegidas), vê cada quadro ainda comprimido (VP8 ou H.264, como chegou do servidor),
// guarda uma cópia e o deixa seguir intacto para o decodificador. Antes o MediaRecorder recomprimia o vídeo já
// decodificado o tempo todo (~18% de um núcleo por transmissão em 1080p30 sem a placa). Um worker por transmissão.
//
// - O buffer começa sempre num quadro-chave. O Chromium quase não manda um sozinho: passando de KEY_EVERY sem nenhum, pede
//   à página (que pede ao servidor, que limita por transmissão: o quadro-chave sai para todos que assistem).
// - Tempo de cada quadro: o carimbo RTP (90 kHz, sem o tremor da rede) ancorado na hora do relógio pela chegada mais
//   rápida vista (a de menos atraso de rede); salto grande no carimbo (transmissão recomeçou) recomeça o buffer.
// - Mensagens da página: { cmd: 'clip', id, secs } -> { id, ok, codec, w, h, avcc, ats, keys, lens, data } (transferido);
//   { cmd: 'keep', ms } (0 = só deixa passar). Para a página: { needKey: true }.
// No ENVIADOR da sua própria transmissão (side 'send', voice.js sfuProduce): os quadros que o Chromium acabou de comprimir,
// em vez do MediaRecorder comprimindo a tela de novo (~18% de um núcleo). O enviador manda 3 camadas (simulcast), cada
// uma no seu ssrc: guarda só a maior (o ssrc cujo quadro-chave é o mais largo; se ela parar por 3 s, a próxima maior
// assume e o buffer recomeça). Quadro-chave: pedido ao próprio codificador (generateKeyFrame), sem passar pelo servidor.
// O codec chega depois ({ cmd: 'codec' }): o encaixe entra antes do produce saber se ficou H.264 ou VP8.
// Colocado num receptor que já recebe vídeo (ou logo depois do consume), o encaixe não recebe quadros: a página liga o worker quando a transmissão chega
// (voice.js onSfuProducer) e ele fica só deixando os quadros passarem (keep 0) até um buffer de clipe pedir para guardar.
const KEY_EVERY = 5000, MAX_BYTES = 300 << 20, WRAP = 2 ** 32;
let st = null;

function reset(s) { s.frames = []; s.bytes = 0; s.off = Infinity; s.lastKeyMs = -Infinity; }
onrtctransform = (ev) => {
  const t = ev.transformer, o = t.options || {};
  const s = st = { keep: pendingKeep || +o.keep || 0, codec: String(o.codec || ''), frames: [], bytes: 0, off: Infinity, lastRtp: null, wraps: 0, lastKeyMs: -Infinity, lastAsk: 0, n: 0, keys: 0, all: 0, err: '' };
  s.send = o.side === 'send'; s.t = t; s.top = null; s.topW = 0; s.topAt = 0; if (pendingCodec) s.codec = pendingCodec;
  t.readable.pipeThrough(new TransformStream({ transform(frame, ctl) { s.all++; if (s.keep > 0) { try { if (!s.send || isTop(s, frame)) take(s, frame); } catch (e) { s.err = String(e?.message || e); } } ctl.enqueue(frame); } }))
    .pipeTo(t.writable).catch(() => { });
};

// enviador: o quadro é da camada maior? (escolhe pelo quadro-chave mais largo; troca de camada recomeça o buffer)
function isTop(s, frame) {
  const md = frame.getMetadata?.() || {}, ssrc = md.synchronizationSource, w = md.width || 0, now = Date.now();
  if (frame.type === 'key' && w > 0) {
    if (ssrc === s.top) s.topW = w;
    else if (s.top == null || w > s.topW || now - s.topAt > 3000) { if (s.top != null) reset(s); s.top = ssrc; s.topW = w; s.topAt = now; }
  }
  if (ssrc !== s.top) return false;
  s.topAt = now; return true;
}
function askKey(s) {
  if (!s.send) { postMessage({ needKey: true }); return; }
  try { s.t.generateKeyFrame?.()?.catch?.(() => { }); } catch { /* sem suporte: o buffer espera o próximo quadro-chave */ }
}
function take(s, frame) {
  const now = Date.now(), md = frame.getMetadata?.() || {}, key = frame.type === 'key';
  let rtp = md.rtpTimestamp ?? frame.timestamp; if (!(rtp >= 0)) return;
  if (s.lastRtp != null && rtp < s.lastRtp && s.lastRtp - rtp > WRAP / 2) s.wraps++; // volta do relógio de 90 kHz (~13 h)
  else if (s.lastRtp != null && rtp > s.lastRtp && rtp - s.lastRtp > WRAP / 2) return; // atrasado de antes da volta
  s.lastRtp = rtp;
  const ms = (s.wraps * WRAP + rtp) / 90, d = now - ms;
  // âncora: a chegada com menos atraso. Muito acima dela = o carimbo saltou (outra fonte, recomeço): começa de novo
  if (d < s.off) s.off = d;
  else if (d - s.off > 5000) { reset(s); s.off = d; }
  if (key) { s.lastKeyMs = ms; s.keys++; }
  if (now - s.lastAsk > 2000 && (!s.frames.length || ms - s.lastKeyMs > KEY_EVERY)) { s.lastAsk = now; askKey(s); }
  if (!s.frames.length && !key) return;
  const data = frame.data.slice(0); // cópia: o original segue para o decodificador
  s.frames.push({ ms, key, w: md.width || 0, h: md.height || 0, data }); s.bytes += data.byteLength; s.n++;
  // guarda `keep` ms (e no máximo MAX_BYTES), sempre a partir de um quadro-chave
  const cut = ms - s.keep; let dropped = false;
  while (s.frames.length > 1) {
    const f = s.frames[0];
    if (f.ms < cut || s.bytes > MAX_BYTES || (dropped && !f.key)) { s.frames.shift(); s.bytes -= f.data.byteLength; dropped = true; } else break;
  }
}

// ---------- H.264: Annex B (como o WebRTC entrega) -> AVC (tamanho na frente), que é o que o WebM guarda ----------
function nalsOf(b) {
  const out = []; let start = -1;
  for (let i = 0; i + 2 < b.length;) {
    if (b[i + 2] > 1) { i += 3; continue; }
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      if (start >= 0) { let e = i; while (e > start && b[e - 1] === 0) e--; out.push(b.subarray(start, e)); }
      start = i + 3; i += 3;
    } else i++;
  }
  if (start >= 0 && start < b.length) out.push(b.subarray(start)); else if (start < 0 && b.length) out.push(b);
  return out;
}
function toAvc(buf, ps) {
  const nals = nalsOf(new Uint8Array(buf)).filter(n => n.length && (n[0] & 0x1f) !== 9); // sem AUD
  for (const n of nals) { const t = n[0] & 0x1f; if (t === 7 && !ps.sps) ps.sps = n.slice(); else if (t === 8 && !ps.pps) ps.pps = n.slice(); }
  let len = 0; for (const n of nals) len += 4 + n.length;
  const out = new Uint8Array(len), dv = new DataView(out.buffer); let o = 0;
  for (const n of nals) { dv.setUint32(o, n.length); out.set(n, o + 4); o += 4 + n.length; }
  return out;
}
// AVCDecoderConfigurationRecord; perfis High levam a extensão (4:2:0, 8 bits: o que o WebRTC manda)
function avcc(sps, pps) {
  const ext = [100, 110, 122, 144].includes(sps[1]) ? [0xfd, 0xf8, 0xf8, 0] : [];
  return Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps, ...ext]);
}

function clip(s, secs) {
  const fr = s.frames; if (!fr.length) return { ok: false, error: 'ainda não chegou um quadro-chave' };
  const want = fr[fr.length - 1].ms - secs * 1000;
  let from = -1; for (let i = 0; i < fr.length && (from < 0 || fr[i].ms <= want); i++) if (fr[i].key) from = i;
  if (from < 0) return { ok: false, error: 'sem quadro-chave' };
  const sel = fr.slice(from), h264 = /h264/i.test(s.codec), ps = {};
  const datas = sel.map(f => (h264 ? toAvc(f.data, ps) : new Uint8Array(f.data)));
  if (h264 && !(ps.sps && ps.pps)) return { ok: false, error: 'H.264 sem SPS/PPS no quadro-chave' };
  let total = 0; for (const d of datas) total += d.length;
  const data = new Uint8Array(total), ats = new Float64Array(sel.length), keys = new Uint8Array(sel.length), lens = new Uint32Array(sel.length);
  let o = 0; sel.forEach((f, i) => { data.set(datas[i], o); o += datas[i].length; ats[i] = f.ms + s.off; keys[i] = f.key ? 1 : 0; lens[i] = datas[i].length; });
  const k = sel.find(f => f.key && f.w) || {};
  return { ok: true, codec: h264 ? 'V_MPEG4/ISO/AVC' : 'V_VP8', w: k.w || 0, h: k.h || 0, avcc: h264 ? avcc(ps.sps, ps.pps) : null, ats, keys, lens, data };
}

let pendingKeep = 0, pendingCodec = ''; // 'keep'/'codec' que chegaram antes do primeiro quadro (o encaixe ainda não tinha disparado)
onmessage = ({ data: m }) => {
  if (m?.cmd === 'codec') { pendingCodec = String(m.codec || ''); if (st) st.codec = pendingCodec; return; }
  if (m?.cmd === 'keep' && !st) { pendingKeep = Math.max(0, +m.ms || 0); return; }
  if (!m || !st) { if (m?.cmd === 'clip') postMessage({ id: m.id, ok: false, error: 'o vídeo ainda não chegou' }); return; }
  if (m.cmd === 'clip') {
    const r = clip(st, Math.max(1, +m.secs || 30));
    postMessage({ id: m.id, ...r, stats: { all: st.all, frames: st.n, keys: st.keys, held: st.frames.length, bytes: st.bytes, err: st.err || undefined } }, r.ok ? [r.data.buffer, r.ats.buffer, r.keys.buffer, r.lens.buffer] : []);
  } else if (m.cmd === 'keep') { st.keep = Math.max(0, +m.ms || 0); if (!st.keep) reset(st); }
};
