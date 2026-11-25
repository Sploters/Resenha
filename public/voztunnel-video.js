// Vídeo pelo túnel (câmera e transmissão de tela para quem não alcança a mídia direto; ver public/voztunnel.js).
// - VideoSender: comprime a faixa no navegador (WebCodecs VideoEncoder: H.264 pela placa quando houver, senão VP8),
//   empacota em RTP aqui mesmo e manda pela conexão do site. O servidor só repassa os pacotes ao producer da sala
//   (server/sfu.js sfuTunnelAttach), então quem assiste direto recebe como uma transmissão qualquer.
//   Rede travada: pula quadros ANTES de comprimir (descartar quadro já comprimido quebraria o vídeo de todos).
// - VideoReceiver: monta os quadros a partir do RTP que chega (VP8 ou H.264), descomprime (VideoDecoder) e entrega uma
//   faixa de vídeo comum ao app. Faltou pacote (a rede descartou): espera o próximo quadro-chave e pede um.
const MTU = 1100, CLOCK = 90;
export const videoTunnelSupported = () => typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function' && typeof VideoFrame === 'function';

// ---------------------------------------------------------------- envio
const H264 = { codec: 'avc1.42e034', avc: { format: 'annexb' } };
async function pickCodec(w, h, bitrate, fps) {
  const base = { width: w, height: h, bitrate, framerate: fps, latencyMode: 'realtime', bitrateMode: 'variable' };
  const tries = [
    ['h264', { ...base, ...H264, hardwareAcceleration: 'prefer-hardware' }],
    ['vp8', { ...base, codec: 'vp8' }],
    ['h264', { ...base, ...H264 }],
  ];
  for (const [name, cfg] of tries) {
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { name, cfg: r.config || cfg }; } catch { }
  }
  return null;
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export class VideoSender {
  // io: { send(bytes), json(obj), buffered(), ready() }; opts: { source: 'cam'|'screen', maxH, fps, kbps }
  constructor(track, io, opts) {
    this.track = track; this.io = io; this.o = opts; this.closed = false;
    this.ssrc = (Math.random() * 0xfffffff0 >>> 0) + 1; this.seq = Math.random() * 65535 | 0; this.pid = Math.random() * 32767 | 0;
    this.wantKey = true; this.lastKey = 0; this.lastAt = -1e9; this.started = false; this.sentFrames = 0; this.skipped = 0;
  }
  async start() {
    const src = this.o.source === 'cam' ? 1 : 2; this.srcByte = src;
    if (typeof MediaStreamTrackProcessor === 'function') {
      this.reader = new MediaStreamTrackProcessor({ track: this.track }).readable.getReader();
      (async () => {
        while (!this.closed) {
          let r; try { r = await this.reader.read(); } catch { break; }
          if (r.done) break;
          this.onFrame(r.value);
        }
      })();
    } else { // sem o processador de faixa (Firefox): lê os quadros de um <video> escondido
      const v = this.video = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([this.track]);
      v.play().catch(() => { });
      const tick = () => {
        if (this.closed) return;
        if (v.videoWidth) { try { this.onFrame(new VideoFrame(v, { timestamp: performance.now() * 1000 })); } catch { } }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else setTimeout(tick, 1000 / (this.o.fps || 30));
      };
      tick();
    }
  }
  async configure(fw, fh) {
    const maxH = this.o.maxH || 1080, scale = Math.min(1, maxH / fh, 1920 / fw);
    const w = even(fw * scale), h = even(fh * scale), fps = this.o.fps || 30, br = (this.o.kbps || 2500) * 1000;
    this.cfgBusy = true;
    const pick = await pickCodec(w, h, br, fps);
    this.cfgBusy = false;
    if (this.closed) return;
    if (!pick) { this.failed = true; this.o.onFail?.('este navegador não comprime vídeo (WebCodecs)'); return; }
    if (this.codec && this.codec !== pick.name) { this.io.json({ t: 'stop', source: this.o.source }); this.started = false; }
    this.codec = pick.name; this.size = { fw, fh };
    try { this.enc?.close(); } catch { }
    this.enc = new VideoEncoder({ output: (chunk) => this.onChunk(chunk), error: (e) => { console.warn('tunnel video encoder', e); this.size = null; } });
    this.enc.configure(pick.cfg);
    this.wantKey = true;
    if (!this.started) { this.started = true; this.io.json({ t: 'vstart', source: this.o.source, codec: this.codec, ssrc: this.ssrc }); }
  }
  onFrame(frame) {
    try {
      if (this.closed || this.failed || !this.io.ready()) return;
      const fps = this.o.fps || 30, t = frame.timestamp / 1000; // ms
      if (t - this.lastAt < 1000 / fps - 2) return; // limite de quadros por segundo
      if (!this.size || this.size.fw !== frame.displayWidth || this.size.fh !== frame.displayHeight) { if (!this.cfgBusy) this.configure(frame.displayWidth, frame.displayHeight); return; }
      if (!this.enc || this.enc.state !== 'configured') return;
      // rede ou processador atrasados: pula este quadro (antes de comprimir) e o próximo sai como quadro-chave
      if (this.io.buffered() > 512 * 1024 || this.enc.encodeQueueSize > 2) { this.skipped++; return; }
      this.lastAt = t;
      const now = performance.now(), key = this.wantKey || now - this.lastKey > 10000;
      if (key) { this.wantKey = false; this.lastKey = now; }
      this.enc.encode(frame, { keyFrame: key });
    } finally { frame.close(); }
  }
  requestKey() { const now = performance.now(); if (now - this.lastKey > 300) this.wantKey = true; }
  onChunk(chunk) {
    if (this.closed) return;
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    const ts = Math.round(chunk.timestamp * CLOCK / 1000) >>> 0;
    const pkts = this.codec === 'vp8' ? this.vp8(data, chunk.type === 'key') : this.h264(data);
    this.pid = (this.pid + 1) & 0x7fff;
    // em blocos de até ~60 KB por mensagem: [4][fonte]([tamanho][pacote])...
    let batch = [], size = 2;
    const flush = () => {
      if (!batch.length) return;
      const b = new Uint8Array(size); b[0] = 4; b[1] = this.srcByte; let o = 2;
      for (const p of batch) { b[o] = p.length >> 8; b[o + 1] = p.length & 0xff; b.set(p, o + 2); o += 2 + p.length; }
      this.io.send(b); batch = []; size = 2;
    };
    pkts.forEach((payload, i) => {
      const p = new Uint8Array(12 + payload.length), dv = new DataView(p.buffer);
      p[0] = 0x80; p[1] = (i === pkts.length - 1 ? 0x80 : 0) | (this.codec === 'vp8' ? 101 : 102);
      dv.setUint16(2, this.seq = (this.seq + 1) & 0xffff); dv.setUint32(4, ts); dv.setUint32(8, this.ssrc);
      p.set(payload, 12);
      if (size + 2 + p.length > 60000) flush();
      batch.push(p); size += 2 + p.length;
    });
    flush(); this.sentFrames++;
  }
  // VP8 (RFC 7741): descritor de 4 bytes com o número do quadro (picture id de 15 bits)
  vp8(data) {
    const out = [];
    for (let o = 0, first = true; o < data.length; first = false) {
      const n = Math.min(MTU, data.length - o), p = new Uint8Array(4 + n);
      p[0] = 0x80 | (first ? 0x10 : 0); p[1] = 0x80; p[2] = 0x80 | (this.pid >> 8); p[3] = this.pid & 0xff;
      p.set(data.subarray(o, o + n), 4); out.push(p); o += n;
    }
    return out;
  }
  // H.264 (RFC 6184): cada NAL num pacote; as grandes em pedaços (FU-A)
  h264(data) {
    const out = [];
    for (const nal of splitAnnexB(data)) {
      if (nal.length <= MTU) { out.push(nal); continue; }
      const hdr = nal[0], body = nal.subarray(1);
      for (let o = 0; o < body.length;) {
        const n = Math.min(MTU - 2, body.length - o), p = new Uint8Array(2 + n);
        p[0] = (hdr & 0xe0) | 28; p[1] = (o === 0 ? 0x80 : 0) | (o + n >= body.length ? 0x40 : 0) | (hdr & 0x1f);
        p.set(body.subarray(o, o + n), 2); out.push(p); o += n;
      }
    }
    return out;
  }
  close() {
    if (this.closed) return; this.closed = true;
    try { this.reader?.cancel(); } catch { }
    if (this.video) { this.video.srcObject = null; this.video = null; }
    try { if (this.enc?.state !== 'closed') this.enc?.close(); } catch { }
    if (this.started) this.io.json({ t: 'stop', source: this.o.source });
  }
}
function splitAnnexB(d) {
  const nals = []; let start = -1;
  for (let i = 0; i + 2 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && (d[i + 2] === 1 || (d[i + 2] === 0 && d[i + 3] === 1))) {
      const sc = d[i + 2] === 1 ? 3 : 4;
      if (start >= 0) { let end = i; while (end > start && d[end - 1] === 0) end--; if (end > start) nals.push(d.subarray(start, end)); }
      i += sc - 1; start = i + 1;
    }
  }
  if (start >= 0 && start < d.length) nals.push(d.subarray(start));
  else if (start < 0 && d.length) nals.push(d); // sem código de início
  return nals;
}

// ---------------------------------------------------------------- chegada
const SC = new Uint8Array([0, 0, 0, 1]);
export class VideoReceiver {
  // codec: { mime, profile } (do servidor); askKey(): pede quadro-chave a quem transmite
  constructor(codec, askKey) {
    this.kind = /vp8/i.test(codec?.mime || '') ? 'vp8' : /h264/i.test(codec?.mime || '') ? 'h264' : null;
    this.decCodec = this.kind === 'vp8' ? 'vp8' : 'avc1.' + (codec?.profile || '42e01f');
    this.askKey = askKey; this.needKey = true; this.lastSeq = -1; this.curTs = null; this.parts = []; this.lost = false;
    this.frames = 0; this.lastAsk = 0; this.closed = false;
    if (typeof MediaStreamTrackGenerator === 'function') {
      this.gen = new MediaStreamTrackGenerator({ kind: 'video' }); this.writer = this.gen.writable.getWriter();
      this.stream = new MediaStream([this.gen]);
    } else { // sem o gerador de faixa: desenha num canvas e usa a faixa dele
      this.canvas = document.createElement('canvas'); this.canvas.width = 16; this.canvas.height = 9;
      this.c2d = this.canvas.getContext('2d'); this.stream = this.canvas.captureStream(60);
    }
    this.track = this.stream.getVideoTracks()[0];
  }
  wantKey() {
    this.needKey = true;
    const now = performance.now(); if (now - this.lastAsk > 700) { this.lastAsk = now; this.askKey(); }
  }
  push(pkt) { // pacote RTP inteiro
    if (this.closed || !this.kind || pkt.length < 12) return;
    const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    let o = 12 + 4 * (pkt[0] & 0x0f);
    if (pkt[0] & 0x10) { if (pkt.length < o + 4) return; o += 4 + 4 * dv.getUint16(o + 2); }
    const end = pkt.length - (pkt[0] & 0x20 ? pkt[pkt.length - 1] : 0);
    const marker = !!(pkt[1] & 0x80), seq = dv.getUint16(2), ts = dv.getUint32(4);
    if (this.lastSeq >= 0) { const d = (seq - this.lastSeq) & 0xffff; if (d === 0 || d > 0x8000) return; } // repetido/atrasado
    const gap = this.lastSeq >= 0 && ((seq - this.lastSeq) & 0xffff) !== 1;
    this.lastSeq = seq;
    if (ts !== this.curTs) { this.curTs = ts; this.parts = []; this.key = false; this.started = false; this.fu = false; this.lost = false; }
    // faltou pacote (a rede descartou): este quadro e os seguintes até um quadro-chave não servem
    if (gap) { this.lost = true; this.wantKey(); }
    if (end <= o) { if (marker) this.finish(ts); return; }
    const pl = pkt.subarray(o, end);
    if (this.kind === 'vp8') this.vp8(pl); else this.h264(pl);
    if (marker) this.finish(ts);
  }
  vp8(p) {
    const b0 = p[0]; let o = 1;
    if (b0 & 0x80) { const x = p[1]; o = 2; if (x & 0x80) o += (p[o] & 0x80) ? 2 : 1; if (x & 0x40) o++; if (x & 0x30) o++; }
    const data = p.subarray(o); if (!data.length) return;
    if ((b0 & 0x10) && (b0 & 0x07) === 0) { this.started = true; this.key = (data[0] & 0x01) === 0; this.parts = []; }
    if (!this.started) { this.lost = true; return; }
    this.parts.push(data);
  }
  h264(p) {
    const t = p[0] & 0x1f;
    const nal = (n) => { const nt = n[0] & 0x1f; if (nt === 5 || nt === 7) this.key = true; this.parts.push(SC, n); };
    if (t >= 1 && t <= 23) { nal(p); this.started = true; }
    else if (t === 24) { for (let o = 1; o + 2 <= p.length;) { const n = (p[o] << 8) | p[o + 1]; o += 2; if (o + n > p.length) break; nal(p.subarray(o, o + n)); o += n; } this.started = true; }
    else if (t === 28 && p.length > 2) {
      const s = p[1] & 0x80, nt = p[1] & 0x1f;
      if (s) { if (nt === 5 || nt === 7) this.key = true; this.parts.push(SC, new Uint8Array([(p[0] & 0xe0) | nt])); this.started = true; this.fu = true; }
      else if (!this.fu) { this.lost = true; return; }
      this.parts.push(p.subarray(2));
      if (p[1] & 0x40) this.fu = false;
    }
  }
  finish(ts) {
    const parts = this.parts, key = this.key, lost = this.lost || !this.started;
    this.parts = []; this.curTs = null; this.lost = false; this.started = false; this.fu = false;
    if (!parts.length) return;
    if (lost || (this.needKey && !key)) { this.wantKey(); return; }
    let n = 0; for (const x of parts) n += x.length;
    const data = new Uint8Array(n); let o = 0; for (const x of parts) { data.set(x, o); o += x.length; }
    if (!this.dec || this.dec.state === 'closed') {
      if (!key) return this.wantKey();
      this.dec = new VideoDecoder({ output: (f) => this.out(f), error: (e) => { console.warn('tunnel video decoder', e); this.dec = null; this.wantKey(); } });
      try { this.dec.configure({ codec: this.decCodec, optimizeForLatency: true }); } catch (e) { console.warn('tunnel video decoder', e); this.dec = null; this.kind = null; return; }
    }
    if (this.dec.decodeQueueSize > 8) { this.wantKey(); return; } // processador atrasado: pula até o próximo quadro-chave
    try {
      this.dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(ts * 1000 / CLOCK), data }));
      this.needKey = false; this.frames++;
    } catch { this.wantKey(); }
  }
  out(f) {
    if (this.closed) { f.close(); return; }
    if (this.writer) { this.writer.write(f).catch(() => { }); return; } // o gerador fecha o quadro
    try {
      if (this.canvas.width !== f.displayWidth || this.canvas.height !== f.displayHeight) { this.canvas.width = f.displayWidth; this.canvas.height = f.displayHeight; }
      this.c2d.drawImage(f, 0, 0);
    } finally { f.close(); }
  }
  close() {
    if (this.closed) return; this.closed = true;
    try { if (this.dec?.state !== 'closed') this.dec?.close(); } catch { }
    try { this.writer?.close(); } catch { }
    try { this.track?.stop(); } catch { }
  }
}
