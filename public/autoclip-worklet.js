// Medidor dos clipes automáticos (public/autoclip.js): para cada voz, a cada 20 ms, o volume (dB) e o brilho (energia da
// diferença entre amostras / energia). Junta 5 quadros por mensagem. Roda na linha de áudio: com o app em segundo plano
// (jogando) os timers da página ficam lentos, mas o áudio não. Não guarda nem manda o áudio, só esses dois números.
class AutoClipMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.02); this.n = 0; this.e = 0; this.d = 0; this.prev = 0; this.out = [];
    this.on = true; this.port.onmessage = (ev) => { if (ev.data === 'stop') this.on = false; };
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0]?.[0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const x = ch[i], df = x - this.prev; this.prev = x;
      this.e += x * x; this.d += df * df;
      if (++this.n >= this.size) {
        const rms = Math.sqrt(this.e / this.n);
        this.out.push(20 * Math.log10(rms + 1e-9), this.e > 1e-12 ? this.d / this.e : 0);
        this.n = 0; this.e = 0; this.d = 0;
        if (this.out.length >= 10) { this.port.postMessage(this.out); this.out = []; }
      }
    }
    return true;
  }
}
registerProcessor('autoclip-meter', AutoClipMeter);
