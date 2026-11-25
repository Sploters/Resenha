// Voz pelo túnel (public/voztunnel.js): processadores de áudio.
// lc-tun-cap: junta o microfone (mono) em quadros de 20 ms (960 amostras a 48 kHz) e manda para a página comprimir.
// lc-tun-play: toca a voz de uma pessoa que chega pelo túnel. Guarda um pouco (PRE) antes de começar, para os pacotes
// que chegam em rajada (TCP pelo túnel) não picotarem; se acumular demais (MAX), descarta o mais velho para o atraso não
// crescer; faltou som: silêncio e volta a guardar.
const FRAME = 960;

class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(FRAME); this.n = 0; }
  process(inputs, outputs) {
    const ch = inputs[0]?.[0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === FRAME) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(FRAME); this.n = 0; }
    }
    outputs[0]?.forEach(o => o.fill(0));
    return true;
  }
}

class Play extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o?.processorOptions || {};
    this.PRE = p.pre || 2880; this.MAX = p.max || 14400; // 60 ms para começar; acima de 300 ms, corta
    this.q = []; this.len = 0; this.off = 0; this.waiting = true; this.under = 0;
    this.port.onmessage = (e) => { const d = e.data; if (d === 'reset') { this.q = []; this.len = 0; this.off = 0; this.waiting = true; return; } this.q.push(d); this.len += d[0].length; };
  }
  process(inputs, outputs) {
    const out = outputs[0], n = out[0].length;
    if (this.len > this.MAX) { // atrasou demais (rede travou e despejou tudo de uma vez): volta para perto do PRE
      while (this.q.length && this.len - (this.q[0][0].length - this.off) >= this.PRE) { this.len -= this.q[0][0].length - this.off; this.q.shift(); this.off = 0; }
    }
    if (this.waiting && this.len < this.PRE) { out.forEach(o => o.fill(0)); return true; }
    this.waiting = false;
    let w = 0;
    while (w < n && this.q.length) {
      const f = this.q[0], k = Math.min(n - w, f[0].length - this.off);
      for (let c = 0; c < out.length; c++) out[c].set((f[c] || f[0]).subarray(this.off, this.off + k), w);
      w += k; this.off += k; this.len -= k;
      if (this.off >= f[0].length) { this.q.shift(); this.off = 0; }
    }
    if (w < n) { for (let c = 0; c < out.length; c++) out[c].fill(0, w); this.waiting = true; this.under++; if (this.under % 50 === 1) this.port.postMessage({ under: this.under }); }
    return true;
  }
}

registerProcessor('lc-tun-cap', Cap);
registerProcessor('lc-tun-play', Play);
