// Voz pelo túnel: quando a mídia não alcança o servidor direto (servidor atrás de CGNAT, rede só IPv4, sem VPN), a voz
// vai e volta pela conexão do site (WebSocket /voz-tunel, que passa pelo Cloudflare Tunnel como o resto do app).
// O servidor põe a pessoa na sala como outra qualquer (server/sfu.js sfuTunnelAttach; server/voztunnel.js).
// - Microfone: o mesmo da chamada (com filtro de ruído etc.), em quadros de 20 ms (voztunnel-worklet.js) comprimidos em
//   Opus pelo navegador (WebCodecs AudioEncoder) e mandados com o carimbo de tempo em amostras de 48 kHz.
// - Vozes que chegam: cada uma (microfone, áudio de transmissão, bot de música) num AudioDecoder e num tocador com um
//   pouco de folga contra as rajadas do TCP; vira um MediaStream entregue ao app como qualquer voz (volume por pessoa,
//   "falando", saída escolhida: voice.attachAudio).
// Só áudio: câmera e transmissão de tela continuam precisando da conexão direta.
const RATE = 48000, FRAME = 960;
export const tunnelSupported = () => typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function' && typeof WebSocket === 'function';

export class VoiceTunnel {
  // host: { cid, token, onReady, onAdd(uid, source, stream), onDel(uid, source), onFail(msg), kbps() }
  constructor(host) {
    this.h = host; this.slots = new Map(); this.closed = false; this.ready = false; this.off = false;
    this.rtt = null; this.tries = 0; this.stats = { frames: 0, sent: 0 }; this.ts = 0; this.track = null; this.sentKbps = 0; this._bytes = 0;
  }
  async start() {
    this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('/voztunnel-worklet.js');
    this.ctx.resume().catch(() => { });
    this.connect();
    this.pingT = setInterval(() => this.ping(), 2000);
    this.kbpsT = setInterval(() => { this.sentKbps = Math.round(this._bytes * 8 / 1000 / 2); this._bytes = 0; }, 2000);
  }
  connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(`${proto}//${location.host}/voz-tunel?token=${encodeURIComponent(this.h.token())}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.attach();
    ws.onmessage = (e) => (typeof e.data === 'string' ? this.onMsg(JSON.parse(e.data)) : this.onFrame(new DataView(e.data)));
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.ready = false; this.dropAll();
      // caiu (rede oscilou, app do servidor reiniciou): tenta de novo, com espera crescente
      const wait = [500, 1000, 2000, 5000][Math.min(this.tries++, 3)];
      if (this.tries > 8) return this.h.onFail('a conexão de voz pelo túnel caiu e não voltou');
      this.h.onUpdate?.();
      this.retryT = setTimeout(() => this.connect(), wait);
    };
  }
  attach() { this.sendJ({ t: 'attach', cid: this.h.cid(), off: this.off }); }
  sendJ(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  ping() { this._pingAt = performance.now(); this.sendJ({ t: 'ping', n: ++this._pn || (this._pn = 1) }); }
  onMsg(m) {
    if (m.t === 'ready') { this.ready = true; this.tries = 0; this.attachTries = 0; this.h.onReady(); return; }
    if (m.t === 'pong') { this.rtt = Math.round(performance.now() - this._pingAt); return; }
    if (m.t === 'add') return this.addSlot(m.slot, m.uid, m.source);
    if (m.t === 'del') return this.delSlot(m.slot);
    // fora da sala no servidor (a sala foi refeita, ou a entrada pelo gateway ainda não chegou): tenta entrar de novo
    if (m.t === 'detached' || m.t === 'error') {
      this.ready = false; this.dropAll(); this.h.onUpdate?.();
      if ((this.attachTries = (this.attachTries || 0) + 1) > 10) return this.h.onFail(m.msg || 'saiu da sala');
      if (this.attachTries === 3) this.h.rejoin?.(); // continua fora da sala: pede ao servidor para refazer a entrada (responde com VOICE_JOINED)
      clearTimeout(this.attT); this.attT = setTimeout(() => this.attach(), Math.min(5000, 500 * this.attachTries));
    }
  }
  // ---------- chegada ----------
  addSlot(slot, uid, source) {
    this.delSlot(slot);
    const node = new AudioWorkletNode(this.ctx, 'lc-tun-play', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const dest = this.ctx.createMediaStreamDestination(); node.connect(dest);
    const dec = new AudioDecoder({
      output: (ad) => {
        try {
          const n = ad.numberOfFrames, chans = [];
          for (let c = 0; c < Math.min(2, ad.numberOfChannels); c++) { const a = new Float32Array(n); ad.copyTo(a, { planeIndex: c, format: 'f32-planar' }); chans.push(a); }
          node.port.postMessage(chans, chans.map(a => a.buffer));
        } catch { } finally { ad.close(); }
      },
      error: () => { },
    });
    dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 2 });
    const s = { slot, uid, source, node, dest, dec, lastSeq: -1 };
    this.slots.set(slot, s);
    this.h.onAdd(uid, source, dest.stream);
  }
  delSlot(slot) {
    const s = this.slots.get(slot); if (!s) return;
    this.slots.delete(slot);
    try { s.dec.close(); } catch { } try { s.node.disconnect(); } catch { }
    this.h.onDel(s.uid, s.source);
  }
  dropAll() { for (const slot of [...this.slots.keys()]) this.delSlot(slot); }
  onFrame(dv) {
    if (dv.byteLength < 9 || dv.getUint8(0) !== 2) return;
    const s = this.slots.get(dv.getUint8(1)); if (!s || s.dec.state !== 'configured') return;
    const seq = dv.getUint16(2), ts = dv.getUint32(4);
    if (s.lastSeq >= 0 && ((seq - s.lastSeq) & 0xffff) > 0x8000) return; // atrasado/repetido
    s.lastSeq = seq; this.stats.frames++;
    s.base ??= ts; // carimbo em microssegundos, a partir do primeiro pacote
    try { s.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(((ts - s.base) >>> 0) * 1e6 / RATE), data: new Uint8Array(dv.buffer, dv.byteOffset + 8, dv.byteLength - 8) })); } catch { }
  }
  setOff(off) { off = !!off; if (off === this.off) return; this.off = off; this.sendJ({ t: 'off', on: off }); }
  // ---------- microfone ----------
  async setMic(track) {
    if (this.closed || track === this.track) return;
    this.track = track;
    this.capNode?.disconnect(); this.capSrc?.disconnect(); this.capNode = this.capSrc = null;
    try { if (this.enc?.state !== 'closed') this.enc?.close(); } catch { } this.enc = null;
    if (!track) return;
    const kbps = Math.min(64, this.h.kbps?.() || 48);
    const base = { codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: kbps * 1000 };
    let cfg = { ...base, opus: { frameDuration: 20000, usedtx: true, useinbandfec: false, complexity: 7 } };
    try { if (!(await AudioEncoder.isConfigSupported(cfg)).supported) cfg = base; } catch { cfg = base; }
    if (this.closed || this.track !== track) return;
    const enc = this.enc = new AudioEncoder({
      output: (chunk) => {
        if (this.ws?.readyState !== 1 || !this.ready) return;
        const b = new Uint8Array(5 + chunk.byteLength), dv = new DataView(b.buffer);
        b[0] = 1; dv.setUint32(1, Math.round(chunk.timestamp * RATE / 1e6) >>> 0); chunk.copyTo(b.subarray(5));
        if (this.ws.bufferedAmount < 64 * 1024) { this.ws.send(b); this._bytes += b.length; this.stats.sent++; } // rede travada: descarta em vez de atrasar
      },
      error: () => { },
    });
    enc.configure(cfg);
    this.capSrc = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.capNode = new AudioWorkletNode(this.ctx, 'lc-tun-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.capNode.port.onmessage = (e) => {
      const ts = this.ts; this.ts += FRAME;
      // microfone fechado (mudo, apertar-para-falar solto, moderação): não manda nada; o carimbo continua andando
      if (!track.enabled || track.readyState !== 'live' || enc.state !== 'configured' || !this.ready) return;
      if (enc.encodeQueueSize > 5) return; // processador atrasado: pula um quadro em vez de acumular atraso
      try { const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: Math.round(ts * 1e6 / RATE), data: e.data }); enc.encode(ad); ad.close(); } catch { }
    };
    this.capSrc.connect(this.capNode); this.capNode.connect(this.ctx.destination); // a saída é silêncio; ligar ao destino mantém o processador rodando
  }
  close() {
    if (this.closed) return; this.closed = true; this.ready = false;
    clearInterval(this.pingT); clearInterval(this.kbpsT); clearTimeout(this.retryT); clearTimeout(this.attT);
    this.dropAll();
    try { this.ws?.close(); } catch { }
    try { this.enc?.close(); } catch { }
    this.capNode?.disconnect(); this.capSrc?.disconnect();
    this.ctx?.close().catch(() => { });
  }
}
