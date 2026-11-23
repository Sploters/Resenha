// Filtro de ruído constante (ventilador, ar-condicionado, ventoinha do PC, chiado do microfone): lógica pura, sem Web
// Audio. O worklet public/fanfilter-worklet.js a usa e os testes em Node (scripts/fanfilter-unit-test.mjs) também.
//
// Por que existe: a IA de ruído (RNNoise) é ótima com barulho que vem e vai (latido, teclado), mas com um ventilador
// ligado ela deixa passar um "chiado" por baixo da voz — enquanto você fala ela tira pouco para não estragar a fala, e o
// ventilador fica ali o tempo todo. Ruído constante é justamente o mais fácil de medir: este filtro aprende o espectro do
// ruído de fundo e tira só ele, faixa por faixa, ANTES da IA (que assim recebe a voz já mais limpa, e o detector de voz
// da porta se engana menos).
//
// Como funciona (redução espectral clássica, com os cuidados para não soar "metálico"):
// - Quadros de 512 amostras (10,7 ms) a cada 128 (um bloco do Web Audio), janela raiz de Hann na análise e na síntese.
//   Atraso: 384 amostras (8 ms).
// - Ruído de cada faixa: mínimo da potência suavizada nos últimos ~2,5 s (estatística de mínimo), corrigido pelo viés.
//   A fala tem pausas entre sílabas, então não vira "ruído"; o ventilador nunca para, então vira.
// - Ganho de cada faixa: subtração de potência sobre a potência suavizada (sobe em 4 ms, desce em 40 ms): o ruído que
//   sobra não vira os "assobios" (ruído musical) da subtração simples e a fala fraca não é esmagada. Nunca abaixo de
//   floorDb (não esvazia o som).
// - O ganho é suavizado entre faixas vizinhas, e faixas abaixo de 60 Hz e acima de 20 kHz seguem o mesmo princípio.
// Sem ventilador (sala silenciosa), o ruído medido é quase nada e o ganho fica em 1: o filtro não mexe na voz.

export const N = 512, HOP = 128, BINS = N / 2 + 1;

// FFT complexa in-place, raiz 2 (N potência de 2); re/im: Float64Array
function makeFft(n) {
  const lg = Math.log2(n), rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < lg; b++) r |= ((i >> b) & 1) << (lg - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  return (re, im, inverse = false) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = inverse ? -sin[k * step] : sin[k * step];
        const a = s + k, b = a + half, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
}

// strength 0-100 (Configurações): mais alto = tira mais (piso mais baixo, um pouco mais de "sobressubtração")
export function fanParams(strength = 50, over = {}) {
  const s = Math.max(0, Math.min(100, Number.isFinite(+strength) ? +strength : 50)) / 100, lerp = (a, b) => a + (b - a) * s;
  return {
    floorDb: lerp(-9, -20),   // atenuação máxima de uma faixa (só ruído)
    overSub: lerp(1.0, 2.0),  // o ruído medido é multiplicado por isso antes de calcular o ganho
    attackMs: 4,              // potência usada no ganho: sobe rápido (começo das palavras inteiro)...
    releaseMs: 40,            // ...e desce devagar (o ruído que sobra não "pisca")
    smoothMs: 25,             // suavização da potência de cada faixa (antes do mínimo)
    minWinMs: 2500,           // janela da estatística de mínimo (1,5 s cortava mais voz distante com eco; 4 s reage devagar)
    bias: 2.2,                // correção do viés do mínimo: com ruído branco o mínimo fica em ~0,39 da média (medido); um
                              // pouco abaixo de 1/0,39 para não confundir fala fraca com ruído
    ...over,
  };
}

export function createFanFilter(sampleRate = 48000, params = fanParams()) {
  let p = params;
  const fft = makeFft(N), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // raiz de Hann periódica
  // análise x síntese com raiz de Hann = Hann; a 75% de sobreposição a soma dá 2: normaliza na saída
  const OLA = 0.5;
  const inBuf = new Float64Array(N), outBuf = new Float64Array(N + HOP);
  const re = new Float64Array(N), im = new Float64Array(N);
  const smooth = new Float64Array(BINS), noise = new Float64Array(BINS).fill(1e-12), gp = new Float64Array(BINS);
  const gain = new Float64Array(BINS), gs = new Float64Array(BINS);
  const fps = sampleRate / HOP; // quadros por segundo (375 a 48 kHz)
  // estatística de mínimo: U janelas parciais de D quadros; o ruído é o menor mínimo entre elas
  const U = 6;
  let D, aS, aA, aR, subMin, curMin, sub = 0, cnt = 0, frames = 0;
  const setup = () => {
    D = Math.max(4, Math.round(p.minWinMs / 1000 * fps / U));
    aS = Math.exp(-1 / (p.smoothMs / 1000 * fps)); aA = Math.exp(-1 / (p.attackMs / 1000 * fps)); aR = Math.exp(-1 / (p.releaseMs / 1000 * fps));
    subMin = Array.from({ length: U }, () => new Float64Array(BINS).fill(Infinity)); curMin = new Float64Array(BINS).fill(Infinity);
    sub = 0; cnt = 0;
  };
  setup();
  const fl = () => 10 ** (p.floorDb / 20);
  let gMin = fl(), gMin2 = gMin * gMin;
  const g = {
    get noise() { return noise; }, get frames() { return frames; },
    setParams(np) { p = np; gMin = fl(); gMin2 = gMin * gMin; const keep = noise.slice(); setup(); noise.set(keep); },
    // processa um bloco de HOP amostras (entrada x, saída y; podem ser o mesmo array) — atraso de N - HOP amostras
    process(x, y, on = true) {
      inBuf.copyWithin(0, HOP); for (let i = 0; i < HOP; i++) inBuf[N - HOP + i] = x[i];
      for (let i = 0; i < N; i++) { re[i] = inBuf[i] * win[i]; im[i] = 0; }
      fft(re, im);
      frames++;
      const first = frames <= 1;
      for (let k = 0; k < BINS; k++) {
        const P = re[k] * re[k] + im[k] * im[k];
        smooth[k] = first ? P : aS * smooth[k] + (1 - aS) * P;
        if (smooth[k] < curMin[k]) curMin[k] = smooth[k];
      }
      // fim de uma janela parcial: guarda o mínimo dela e recalcula o ruído (menor mínimo das últimas U)
      if (++cnt >= D) {
        subMin[sub].set(curMin); sub = (sub + 1) % U; curMin.fill(Infinity); cnt = 0;
      }
      for (let k = 0; k < BINS; k++) {
        let m = curMin[k]; for (let u = 0; u < U; u++) if (subMin[u][k] < m) m = subMin[u][k];
        // no começo (antes de completar a janela) o mínimo é o de até agora: vale do mesmo jeito
        noise[k] = Number.isFinite(m) ? Math.max(m * p.bias, 1e-12) : 1e-12;
      }
      // ganho: subtração de potência sobre a potência suavizada com ataque rápido e soltura lenta (gp). Ataque rápido:
      // o começo das palavras passa inteiro; soltura lenta: o ruído que sobra não "pisca" (sem ruído musical). Antes era
      // Wiener com SNR por decisão dirigida, que a 375 quadros/s esmagava a fala fraca (-18 dB com SNR de 5 dB).
      for (let k = 0; k < BINS; k++) {
        const P = re[k] * re[k] + im[k] * im[k];
        gp[k] = P > gp[k] ? aA * gp[k] + (1 - aA) * P : aR * gp[k] + (1 - aR) * P;
        const r = 1 - p.overSub * noise[k] / Math.max(gp[k], 1e-15);
        gain[k] = r <= gMin2 ? gMin : Math.sqrt(r);
      }
      // suaviza entre faixas vizinhas (menos ruído musical); o maior dos dois mantém os harmônicos da voz inteiros
      for (let k = 0; k < BINS; k++) { const a = gain[k > 0 ? k - 1 : 0], b = gain[k], c = gain[k < BINS - 1 ? k + 1 : k]; gs[k] = Math.max(b, 0.25 * a + 0.5 * b + 0.25 * c); }
      if (!on) gs.fill(1);
      for (let k = 0; k < BINS; k++) { re[k] *= gs[k]; im[k] *= gs[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
      fft(re, im, true);
      for (let i = 0; i < N; i++) outBuf[i] += re[i] * win[i] * OLA;
      for (let i = 0; i < HOP; i++) y[i] = outBuf[i];
      outBuf.copyWithin(0, HOP); outBuf.fill(0, N - HOP);
    },
  };
  return g;
}
export const LATENCY = N - HOP;
