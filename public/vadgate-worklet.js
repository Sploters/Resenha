// AudioWorklet da porta guiada por voz (lógica em vadgate-core.js). Dois jeitos de usar:
// - denoise: true  (modo RNNoise) → substitui o nó RNNoise: limpa o áudio e usa a probabilidade de voz que o próprio
//   RNNoise já calcula naquele quadro (nada roda duas vezes). Os quadros de 10 ms ficam numa fila curta (lookahead): a
//   decisão de um quadro vale também para os anteriores, então a porta já está abrindo quando a palavra começa.
// - denoise: false (modo GTCRN) → duas entradas: 0 = áudio já limpo pelo GTCRN, 1 = o microfone antes dele. Um RNNoise
//   separado analisa a entrada 1 só como detector de voz (a saída dele é descartada). Como o GTCRN atrasa o áudio ~30 ms,
//   a decisão chega antes do áudio correspondente: antecedência de graça, e o áudio passa sem atraso nenhum a mais.
// O ganho anda em dB, em rampa (abre em attackMs, fecha em releaseMs); fechada a porta atenua, não emudece.
import { Rnnoise } from './vendor/ns/vadgate/rnnoise.js';
import { FRAME, createGate, gateParams, createBand, createPitch, levelDb, ST } from './vadgate-core.js';

const RING = 8192; // fila de saída do modo RNNoise (amostras)

class VadGateProcessor extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = opt.processorOptions || {};
    this.denoise = o.denoise !== false; this.gateOn = o.gate !== false;
    this.sens = o.sens ?? 50; this.params = o.params; this.lock = o.lock !== false;
    this.gate = createGate(this.mkParams());
    this.lowBand = createBand('low', 300, sampleRate); this.hfBand = createBand('high', 2500, sampleRate); this.pitch = createPitch(sampleRate);
    this.inBuf = new Float32Array(FRAME); this.inN = 0;
    this.scaled = new Float32Array(FRAME); this.clean = new Float32Array(FRAME);
    this.queue = []; this.pool = []; // modo RNNoise: quadros esperando a antecedência { y, t }
    this.ring = new Float32Array(RING); this.r = 0; this.w = 0;
    this.gDb = this.gate.p.floorDb; this.tgtDb = this.gate.p.floorDb; this.underruns = 0; this.frames = 0; // quadros analisados (testes)
    this.latency = this.denoise ? FRAME * (1 + this.gate.p.lookahead) : 0; this.w = this.latency;
    this.dbg = o.debug ? { vad: [], lvl: [], noise: [], low: [], hf: [], open: [], st: [], pitch: [], harm: [], spk: [], med: [] } : null;
    // modo GTCRN com "pausar no silêncio" (experimental, processorOptions.pauseMs): porta fechada por pauseMs seguidos ->
    // avisa o app para tirar o GTCRN da cadeia (sem entrada ele não processa nada); a fala volta -> avisa para religar.
    // O detector continua ouvindo o microfone cru (entrada 1), então percebe a fala mesmo com o GTCRN parado.
    this.pauseFrames = !this.denoise && o.pauseMs > 0 ? Math.round(o.pauseMs / 10) : 0; this.quiet = 0; this.paused = false;
    this.destroyed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'destroy') this.destroy();
      else if (d === 'stats') this.port.postMessage({ stats: this.dbg, underruns: this.underruns, latency: this.latency, ready: !!this.st, frames: this.frames });
      else if (d && typeof d === 'object') { // ajuste ao vivo (sensibilidade, liga/desliga) sem refazer o microfone
        if (d.gtcrnReset) { this.paused = false; this.quiet = 0; } // o app religou o GTCRN (desmutou / apertou para falar)
        if ('gate' in d) this.gateOn = d.gate !== false;
        if ('sens' in d) this.sens = d.sens;
        if ('lock' in d) this.lock = d.lock !== false;
        if ('params' in d) this.params = d.params;
        if ('sens' in d || 'params' in d || 'lock' in d) this.gate.setParams(this.mkParams());
      }
    };
    Rnnoise.loadBinary(o.wasmBinary).then((m) => {
      if (this.destroyed) return;
      this.st = m.createDenoiseState(); this.port.postMessage({ ready: true });
    }).catch((e) => { this.failed = true; this.port.postMessage({ error: String(e?.message || e) }); });
  }
  // lock: trava na voz de quem está no microfone (vadgate-core.js); lookahead fixo depois de criado (muda a latência)
  mkParams() { return gateParams(this.sens, { ...this.params, lock: this.lock, ...(this.gate ? { lookahead: this.gate.p.lookahead } : {}) }); }
  // analisa o quadro de inBuf: probabilidade de voz + nível; devolve o ganho alvo (e deixa o áudio limpo em this.clean)
  analyze() {
    const x = this.inBuf, s = this.scaled, y = this.clean; this.frames++;
    for (let i = 0; i < FRAME; i++) s[i] = x[i] * 32767;
    const vad = this.st.processFrame(s); // limpa "s" no lugar e devolve a probabilidade de voz
    for (let i = 0; i < FRAME; i++) y[i] = s[i] / 32767;
    const low = this.lowBand(x), lvl = levelDb(y), hf = this.hfBand(y), { st, harm } = this.pitch(y); // tom da voz já limpa
    const t = this.gateOn ? this.gate.step({ vad, lvl, low, hf, st, harm }) : 1;
    if (this.dbg) { const d = this.dbg; d.vad.push(vad); d.lvl.push(lvl); d.noise.push(this.gate.noiseDb); d.low.push(low); d.hf.push(hf); d.open.push(t >= 1 ? 1 : 0); d.st.push(this.gate.state); d.pitch.push(st); d.harm.push(harm); d.spk.push(this.gate.speechDb); d.med.push(this.gate.pitch); }
    return t;
  }
  // modo RNNoise: o quadro limpo entra na fila; o mais antigo sai com o maior alvo da fila (abre antes da palavra)
  pushFrame(t) {
    const y = this.pool.pop() || new Float32Array(FRAME); y.set(this.clean);
    this.queue.push({ y, t });
    if (this.queue.length <= this.gate.p.lookahead) return;
    const f = this.queue.shift(); let tgt = f.t; for (const q of this.queue) tgt = Math.max(tgt, q.t);
    this.tgtDb = tgt >= 1 ? 0 : Math.max(this.gate.p.floorDb, 20 * Math.log10(tgt));
    for (let i = 0; i < FRAME; i++) { this.ring[this.w] = f.y[i] * this.gain(); this.w = (this.w + 1) % RING; }
    this.pool.push(f.y);
  }
  // uma amostra da rampa de ganho (dB, linear no tempo) rumo a tgtDb
  gain() {
    const p = this.gate.p, span = -p.floorDb || 1, t = this.tgtDb; let g = this.gDb;
    if (g < t) g = Math.min(t, g + span / (p.attackMs * sampleRate / 1000)); else if (g > t) g = Math.max(t, g - span / (p.releaseMs * sampleRate / 1000));
    this.gDb = g; return g >= 0 ? 1 : 10 ** (g / 20);
  }
  process(inputs, outputs) {
    if (this.destroyed) return false;
    const out = outputs[0]?.[0]; if (!out) return true;
    const n = out.length;
    if (!this.st) { // modelo ainda carregando (alguns ms): silêncio, como o nó RNNoise original; se falhou, o áudio passa direto
      const a = inputs[0]?.[0]; if (this.failed && a) out.set(a); else out.fill(0); return true;
    }
    const ana = (this.denoise ? inputs[0]?.[0] : inputs[1]?.[0]) || null;
    // sem entrada (microfone mutado: voice.js setIdle tira o microfone da cadeia): não roda o RNNoise sobre zeros, que
    // custava tanto quanto falar (às vezes mais). Sai silêncio e a fila volta ao estado de um microfone recém-aberto.
    if (!ana) { if (!this.idle) this.goIdle(); out.fill(0); for (let c = 1; c < outputs[0].length; c++) outputs[0][c].fill(0); return true; }
    this.idle = false;
    for (let i = 0; i < n; i++) {
      this.inBuf[this.inN++] = ana ? ana[i] : 0;
      if (this.inN === FRAME) { this.inN = 0; const t = this.analyze(); if (this.denoise) this.pushFrame(t); else { this.tgtDb = t >= 1 ? 0 : Math.max(this.gate.p.floorDb, 20 * Math.log10(t)); if (this.pauseFrames) this.pauseStep(); } }
    }
    if (this.denoise) {
      for (let i = 0; i < n; i++) { if (this.r === this.w) { out[i] = 0; this.underruns++; continue; } out[i] = this.ring[this.r]; this.r = (this.r + 1) % RING; }
    } else {
      const a = inputs[0]?.[0];
      for (let i = 0; i < n; i++) out[i] = a ? a[i] * this.gain() : 0;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
  pauseStep() {
    const talking = !this.gateOn || this.gate.state !== ST.CLOSED;
    if (talking) { this.quiet = 0; if (this.paused) { this.paused = false; this.port.postMessage({ gtcrn: 'resume' }); } return; }
    if (++this.quiet >= this.pauseFrames && !this.paused) { this.paused = true; this.port.postMessage({ gtcrn: 'pause' }); }
  }
  // ao ficar sem entrada: descarta o que estava na fila e recomeça como no construtor (porta fechada, antecedência de
  // silêncio já na saída); o estado do RNNoise e o nível de ruído aprendido pela porta continuam
  goIdle() {
    this.idle = true; this.inN = 0;
    while (this.queue.length) this.pool.push(this.queue.pop().y);
    this.ring.fill(0); this.r = 0; this.w = this.latency;
    this.gDb = this.tgtDb = this.gate.p.floorDb;
  }
  destroy() { this.destroyed = true; try { this.st?.destroy(); } catch { } this.st = null; }
}
registerProcessor('lc-vadgate', VadGateProcessor);
