// AudioWorklet do filtro de ruído constante (ventilador, ar-condicionado, ventoinha): lógica em fanfilter-core.js.
// Entra no começo da cadeia do microfone (antes da IA de ruído): public/voice.js buildChain.
import { createFanFilter, fanParams, HOP } from './fanfilter-core.js';

class FanFilterProcessor extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = opt.processorOptions || {};
    this.on = o.on !== false; this.strength = o.strength ?? 50; this.params = o.params || {}; // params: só para medições (scripts/noise-bench.mjs FANP)
    this.f = createFanFilter(sampleRate, fanParams(this.strength, this.params));
    // o filtro trabalha em blocos de HOP (128) amostras; o Web Audio normalmente também (render quantum), mas se não for,
    // as filas abaixo fazem a ponte (com HOP amostras a mais de atraso)
    this.inQ = new Float32Array(HOP); this.inN = 0; this.outQ = new Float32Array(HOP * 4); this.outR = 0; this.outW = 0; this.outN = 0;
    this.bin = new Float32Array(HOP); this.bout = new Float32Array(HOP);
    this.destroyed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'destroy') this.destroyed = true;
      else if (d && typeof d === 'object') {
        if ('on' in d) this.on = d.on !== false;
        if ('strength' in d) { this.strength = d.strength; this.f.setParams(fanParams(this.strength, this.params)); }
      }
    };
  }
  process(inputs, outputs) {
    if (this.destroyed) return false;
    const out = outputs[0]?.[0]; if (!out) return true;
    const x = inputs[0]?.[0];
    // sem entrada (mutado: voice.js setIdle tira o microfone da cadeia e também desliga a saída deste nó, para a IA depois
    // dele não analisar zeros): só silêncio
    if (!x) { out.fill(0); return true; }
    if (x.length === HOP && this.outN === 0) { this.f.process(x, out, this.on); return true; } // caminho normal
    for (let i = 0; i < out.length; i++) {
      this.inQ[this.inN++] = x ? x[i] : 0;
      if (this.inN === HOP) {
        this.f.process(this.inQ, this.bout, this.on); this.inN = 0;
        for (let k = 0; k < HOP; k++) { this.outQ[this.outW] = this.bout[k]; this.outW = (this.outW + 1) % this.outQ.length; }
        this.outN += HOP;
      }
      if (this.outN > 0) { out[i] = this.outQ[this.outR]; this.outR = (this.outR + 1) % this.outQ.length; this.outN--; } else out[i] = 0;
    }
    return true;
  }
}
registerProcessor('lc-fanfilter', FanFilterProcessor);
