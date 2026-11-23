// AudioWorklet do ganho automático próprio (lógica em agc-core.js): só digital, nunca mexe no volume do microfone no
// sistema (o ganho automático do navegador mexia, e só baixava). Fica depois da redução de ruído: public/voice.js createMic.
import { createAgc, agcParams } from './agc-core.js';

class AgcProcessor extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = opt.processorOptions || {};
    this.on = o.on !== false; this.a = createAgc(sampleRate, agcParams(o.params || {})); this.destroyed = false; this.t = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'destroy') this.destroyed = true;
      else if (d === 'stats') this.port.postMessage({ gainDb: this.a.gainDb, levelDb: this.a.levelDb, speechFrames: this.a.speechFrames });
      else if (d && typeof d === 'object') { if ('on' in d) this.on = d.on !== false; if (d.params) this.a.setParams(d.params); }
    };
  }
  process(inputs, outputs) {
    if (this.destroyed) return false;
    const out = outputs[0]?.[0]; if (!out) return true;
    const x = inputs[0]?.[0];
    if (!x) { out.fill(0); return true; }
    this.a.process(x, out, this.on);
    return true;
  }
}
registerProcessor('lc-agc', AgcProcessor);
