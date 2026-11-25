// Voz pelo túnel: quando a mídia não alcança o servidor direto (servidor atrás de CGNAT, rede só IPv4, sem VPN), a voz
// vai e volta pela conexão do site (WebSocket /voz-tunel, que passa pelo Cloudflare Tunnel como o resto do app).
// O servidor põe a pessoa na sala como outra qualquer (server/sfu.js sfuTunnelAttach; server/voztunnel.js).
// - Microfone: o mesmo da chamada (com filtro de ruído etc.), em quadros de 20 ms (voztunnel-worklet.js) comprimidos em
//   Opus pelo navegador (WebCodecs AudioEncoder) e mandados com o carimbo de tempo em amostras de 48 kHz.
// - Vozes que chegam: cada uma (microfone, áudio de transmissão, bot de música) num AudioDecoder e num tocador com um
//   pouco de folga contra as rajadas do TCP; vira um MediaStream entregue ao app como qualquer voz (volume por pessoa,
//   "falando", saída escolhida: voice.attachAudio).
// - Câmera e transmissão de tela (com o áudio dela): comprimidas no navegador e empacotadas em RTP
//   (public/voztunnel-video.js); as que chegam viram faixas de vídeo comuns no app. O vídeo que chega só anda enquanto
//   o app assiste (pause), como na mídia direta.
import { VideoSender, VideoReceiver, videoTunnelSupported } from './voztunnel-video.js';
const RATE = 48000, FRAME = 960;
export { videoTunnelSupported };
export const tunnelSupported = () => typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function' && typeof WebSocket === 'function';

export class VoiceTunnel {
  // host: { cid, token, onReady, onAdd(uid, source, stream), onDel(uid, source), onFail(msg), kbps() }
  constructor(host) {
    this.h = host; this.slots = new Map(); this.closed = false; this.ready = false; this.off = false;
    this.rtt = null; this.tries = 0; this.stats = { frames: 0, sent: 0, vframes: 0 }; this.sentKbps = 0; this._bytes = 0;
    this.aud = new Map(); // fonte de áudio que mando ('mic' | 'screenaudio') -> { track, enc, node, src, ts }
    this.vids = new Map(); // vídeo que mando ('cam' | 'screen') -> { track, opts, sender }
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
      this.ready = false; this.dropAll(); this.stopVideoSenders();
      // caiu (rede oscilou, app do servidor reiniciou): tenta de novo, com espera crescente
      const wait = [500, 1000, 2000, 5000][Math.min(this.tries++, 3)];
      if (this.tries > 8) return this.h.onFail('a conexão de voz pelo túnel caiu e não voltou');
      this.h.onUpdate?.();
      this.retryT = setTimeout(() => this.connect(), wait);
    };
  }
  attach() { this.stopVideoSenders(); this.sendJ({ t: 'attach', cid: this.h.cid(), off: this.off }); }
  sendJ(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  ping() { this._pingAt = performance.now(); this.sendJ({ t: 'ping', n: ++this._pn || (this._pn = 1) }); }
  onMsg(m) {
    if (m.t === 'ready') { this.ready = true; this.tries = 0; this.attachTries = 0; this.h.onReady(); this.startVideoSenders(); return; }
    if (m.t === 'key') { this.vids.get(m.source)?.sender?.requestKey(); return; }
    if (m.t === 'vstarted') { if (!m.ok) this.h.onVideoRefused?.(m.source); return; }
    if (m.t === 'pong') { this.rtt = Math.round(performance.now() - this._pingAt); return; }
    if (m.t === 'add') return m.kind === 'video' ? this.addVideo(m.slot, m.uid, m.source, m.codec) : this.addSlot(m.slot, m.uid, m.source);
    if (m.t === 'del') return this.delSlot(m.slot);
    // fora da sala no servidor (a sala foi refeita, ou a entrada pelo gateway ainda não chegou): tenta entrar de novo
    if (m.t === 'detached' || m.t === 'error') {
      this.ready = false; this.dropAll(); this.stopVideoSenders(); this.h.onUpdate?.();
      if ((this.attachTries = (this.attachTries || 0) + 1) > 10) return this.h.onFail(m.msg || 'saiu da sala');
      if (this.attachTries === 3) this.h.rejoin?.(); // continua fora da sala: pede ao servidor para refazer a entrada (responde com VOICE_JOINED)
      clearTimeout(this.attT); this.attT = setTimeout(() => this.attach(), Math.min(5000, 500 * this.attachTries));
    }
  }
  // ---------- chegada ----------
  addSlot(slot, uid, source) {
    this.delSlot(slot);
    // a mesma voz chegou por outro slot (a pessoa trocou de caminho ou de microfone; o servidor avisa o "del" do antigo
    // só depois do "add" do novo): o antigo sai calado, senão o "del" atrasado apagava a voz nova (um ouvia, o outro não)
    for (const o of [...this.slots.values()]) if (o.uid === uid && o.source === source) this.delSlot(o.slot, true);
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
  // vídeo que chega (câmera ou tela de alguém): começa pausado no servidor; o app diz se assiste (pause)
  addVideo(slot, uid, source, codec) {
    this.delSlot(slot);
    for (const o of [...this.slots.values()]) if (o.uid === uid && o.source === source) this.delSlot(o.slot, true);
    const rx = new VideoReceiver(codec, () => this.sendJ({ t: 'key', slot }));
    if (!rx.kind) { rx.close(); return; }
    this.slots.set(slot, { slot, uid, source, rx, video: true });
    this.h.onAdd(uid, source, rx.stream, slot);
  }
  // assistir (paused=false) ou não o que chega de alguém: fontes 'screen', 'screenaudio', 'cam'
  pause(uid, sources, paused) {
    for (const s of this.slots.values()) if (s.uid === uid && sources.includes(s.source)) {
      if (s.paused === paused) continue; s.paused = paused;
      this.sendJ({ t: 'pause', slot: s.slot, on: paused });
      if (!paused && s.rx) s.rx.wantKey();
    }
  }
  delSlot(slot, quiet = false) {
    const s = this.slots.get(slot); if (!s) return;
    this.slots.delete(slot);
    if (s.rx) s.rx.close();
    else { try { s.dec.close(); } catch { } try { s.node.disconnect(); } catch { } }
    if (!quiet) this.h.onDel(s.uid, s.source);
  }
  dropAll() { for (const slot of [...this.slots.keys()]) this.delSlot(slot); }
  onFrame(dv) {
    if (dv.byteLength > 14 && dv.getUint8(0) === 3) { const s = this.slots.get(dv.getUint8(1)); if (s?.rx) { s.rx.push(new Uint8Array(dv.buffer, dv.byteOffset + 2, dv.byteLength - 2)); this.stats.vframes = s.rx.frames; } return; }
    if (dv.byteLength < 9 || dv.getUint8(0) !== 2) return;
    const s = this.slots.get(dv.getUint8(1)); if (!s || !s.dec || s.dec.state !== 'configured') return;
    const seq = dv.getUint16(2), ts = dv.getUint32(4);
    if (s.lastSeq >= 0 && ((seq - s.lastSeq) & 0xffff) > 0x8000) return; // atrasado/repetido
    s.lastSeq = seq; this.stats.frames++;
    s.base ??= ts; // carimbo em microssegundos, a partir do primeiro pacote
    try { s.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(((ts - s.base) >>> 0) * 1e6 / RATE), data: new Uint8Array(dv.buffer, dv.byteOffset + 8, dv.byteLength - 8) })); } catch { }
  }
  setOff(off) { off = !!off; if (off === this.off) return; this.off = off; this.sendJ({ t: 'off', on: off }); }
  // ---------- microfone e áudio da transmissão ----------
  setMic(track) { return this.setAudio('mic', track); }
  async setAudio(source, track) {
    if (this.closed) return;
    const cur = this.aud.get(source);
    if ((cur?.track || null) === (track || null)) return;
    if (cur) { cur.node?.disconnect(); cur.src?.disconnect(); try { if (cur.enc?.state !== 'closed') cur.enc?.close(); } catch { } }
    if (!track) { this.aud.delete(source); if (source !== 'mic' && cur) this.sendJ({ t: 'stop', source }); return; }
    const st = { track, ts: cur?.ts || 0 }; this.aud.set(source, st);
    const stereo = source === 'screenaudio', kind = stereo ? 5 : 1, ch = stereo ? 2 : 1;
    const kbps = stereo ? 96 : Math.min(64, this.h.kbps?.() || 48);
    const base = { codec: 'opus', sampleRate: RATE, numberOfChannels: ch, bitrate: kbps * 1000 };
    let cfg = { ...base, opus: { frameDuration: 20000, usedtx: !stereo, useinbandfec: false, complexity: 7 } };
    try { if (!(await AudioEncoder.isConfigSupported(cfg)).supported) cfg = base; } catch { cfg = base; }
    if (this.closed || this.aud.get(source) !== st) return;
    const enc = st.enc = new AudioEncoder({
      output: (chunk) => {
        if (this.ws?.readyState !== 1 || !this.ready) return;
        const b = new Uint8Array(5 + chunk.byteLength), dv = new DataView(b.buffer);
        b[0] = kind; dv.setUint32(1, Math.round(chunk.timestamp * RATE / 1e6) >>> 0); chunk.copyTo(b.subarray(5));
        if (this.ws.bufferedAmount < 256 * 1024) { this.ws.send(b); this._bytes += b.length; this.stats.sent++; } // rede travada: descarta em vez de atrasar
      },
      error: () => { },
    });
    enc.configure(cfg);
    st.src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    st.node = new AudioWorkletNode(this.ctx, stereo ? 'lc-tun-cap2' : 'lc-tun-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], ...(stereo ? { channelCount: 2, channelCountMode: 'explicit' } : {}) });
    st.node.port.onmessage = (e) => {
      const ts = st.ts; st.ts += FRAME;
      // microfone fechado (mudo, apertar-para-falar solto, moderação): não manda nada; o carimbo continua andando
      if (!track.enabled || track.readyState !== 'live' || enc.state !== 'configured' || !this.ready) return;
      if (enc.encodeQueueSize > 5) return; // processador atrasado: pula um quadro em vez de acumular atraso
      try { const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: ch, timestamp: Math.round(ts * 1e6 / RATE), data: e.data }); enc.encode(ad); ad.close(); } catch { }
    };
    st.src.connect(st.node); st.node.connect(this.ctx.destination); // a saída é silêncio; ligar ao destino mantém o processador rodando
  }
  // ---------- câmera e tela ----------
  // opts: { maxH, fps, kbps }. Sem conexão pronta: guarda e começa quando a sala aceitar (ready)
  setVideo(source, track, opts = {}) {
    const cur = this.vids.get(source);
    if (cur && cur.track === track) { cur.opts = opts; if (cur.sender) { Object.assign(cur.sender.o, opts); cur.sender.size = null; } return; } // qualidade mudou: reconfigura no próximo quadro
    cur?.sender?.close(); this.vids.delete(source);
    if (!track) return;
    const v = { track, opts }; this.vids.set(source, v);
    if (this.ready) this.startVideo(source, v);
  }
  startVideo(source, v) {
    v.sender?.close();
    const io = { send: (b) => { if (this.ws?.readyState === 1) { this.ws.send(b); this._bytes += b.length; } }, json: (o) => this.sendJ(o), buffered: () => this.ws?.bufferedAmount ?? 1e9, ready: () => this.ready && this.ws?.readyState === 1 };
    v.sender = new VideoSender(v.track, io, { source, ...v.opts, onFail: (msg) => this.h.onVideoRefused?.(source, msg) });
    v.sender.start().catch(() => { });
  }
  startVideoSenders() { for (const [source, v] of this.vids) if (v.track.readyState === 'live') this.startVideo(source, v); }
  stopVideoSenders() { for (const v of this.vids.values()) { if (v.sender) { v.sender.started = false; v.sender.close(); v.sender = null; } } }
  close() {
    if (this.closed) return; this.closed = true; this.ready = false;
    clearInterval(this.pingT); clearInterval(this.kbpsT); clearTimeout(this.retryT); clearTimeout(this.attT);
    this.dropAll();
    try { this.ws?.close(); } catch { }
    for (const st of this.aud.values()) { st.node?.disconnect(); st.src?.disconnect(); try { if (st.enc?.state !== 'closed') st.enc?.close(); } catch { } }
    this.aud.clear(); this.stopVideoSenders(); this.vids.clear();
    this.ctx?.close().catch(() => { });
  }
}
