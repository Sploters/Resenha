// AudioWorklet do áudio "só do jogo" (app desktop): recebe o PCM do programa nativo lc-audio (float32, 48 kHz, estéreo,
// intercalado, em pedaços de tamanho qualquer) e toca como uma trilha normal. Se faltar áudio (jogo em silêncio, o Windows
// não manda nada), sai silêncio.
// Fila curta e CONSTANTE (~40 ms): o relógio do Windows e o do Chromium nunca andam igual, e antes a fila ia crescendo
// devagar até 250 ms antes de ser cortada — o áudio do jogo chegava a sair até 1/4 de segundo atrasado em relação ao
// vídeo da transmissão, e o atraso mudava com o tempo. Agora a leitura acelera ou freia até 0,5% (reamostragem linear,
// inaudível) para manter a fila no alvo; acima de 120 ms (o programa travou e mandou tudo de uma vez) corta na hora.
const RATE = 48000, TARGET = Math.round(RATE * 0.04), MAX = Math.round(RATE * 0.12), PRIME = Math.round(RATE * 0.03), MAX_SKEW = 0.005;
class LcPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(RATE * 2 * 2); // 2 s estéreo (anel)
    this.r = 0; this.n = 0; // posição de leitura e quadros guardados
    this.rest = new Uint8Array(0); this.primed = false;
    this.port.onmessage = (e) => this.push(e.data);
  }
  push(chunk) {
    let bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (this.rest.length) { const j = new Uint8Array(this.rest.length + bytes.length); j.set(this.rest); j.set(bytes, this.rest.length); bytes = j; }
    const usable = bytes.length - (bytes.length % 8); // quadro = 2 canais × 4 bytes; o pedaço pode cortar um quadro no meio
    this.rest = bytes.slice(usable);
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable)); // cópia alinhada
    const cap = this.buf.length / 2, frames = f.length / 2;
    for (let i = 0; i < frames; i++) {
      const w = ((this.r + this.n) % cap) * 2;
      this.buf[w] = f[i * 2]; this.buf[w + 1] = f[i * 2 + 1];
      if (this.n < cap) this.n++; else this.r = (this.r + 1) % cap;
    }
    if (this.n > MAX) { const drop = this.n - TARGET; this.r = (this.r + drop) % cap; this.n -= drop; } // atraso acumulado: volta para ~40 ms
    if (!this.primed && this.n >= PRIME) this.primed = true;
  }
  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], cap = this.buf.length / 2;
    if (!this.primed) { L.fill(0); R.fill(0); return true; }
    // fila média (suavizada) → velocidade de leitura: acima do alvo lê um pouco mais rápido, abaixo um pouco mais devagar
    this.avg = this.avg === undefined ? this.n : this.avg + (this.n - this.avg) * 0.02;
    const step = 1 + Math.max(-MAX_SKEW, Math.min(MAX_SKEW, (this.avg - TARGET) / RATE));
    let f = this.frac || 0;
    for (let i = 0; i < L.length; i++) {
      if (this.n < 2) { L.fill(0, i); R.fill(0, i); this.primed = false; this.avg = undefined; f = 0; break; } // acabou: espera juntar um pouco antes de voltar (sem estalos)
      const a = this.r * 2, b = ((this.r + 1) % cap) * 2;
      L[i] = this.buf[a] + (this.buf[b] - this.buf[a]) * f; R[i] = this.buf[a + 1] + (this.buf[b + 1] - this.buf[a + 1]) * f;
      f += step; const adv = f | 0; f -= adv;
      this.r = (this.r + adv) % cap; this.n -= adv;
    }
    this.frac = f;
    return true;
  }
}
registerProcessor('lc-pcm', LcPcm);
