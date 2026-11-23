// Ganho automático do Resenha (lógica pura, sem Web Audio): usado pelo worklet public/agc-worklet.js e pelos testes em
// Node (scripts/agc-unit-test.mjs).
//
// Por que não o do navegador: o ganho automático do Chromium (autoGainControl) também mexe no VOLUME DO MICROFONE NO
// SISTEMA (o nível do dispositivo no Windows). Ele baixa esse volume quando você fala alto, ri ou bate no microfone, e
// quase nunca sobe de volta: com o tempo o microfone fica cada vez mais baixo, até nas outras apps. Este aqui é só
// digital, dentro do app: nunca toca no volume do sistema, e sobe tanto quanto desce.
//
// Como funciona, a cada quadro de 10 ms:
// - Mede o nível (RMS em dB) e o ruído de fundo (mínimo dos últimos ~2 s). Só conta como FALA o quadro bem acima do
//   fundo (speechOverDb) e acima de um mínimo absoluto. Nas pausas o ganho fica parado: não aumenta o ruído nem a voz de
//   quem está ao fundo (o problema do ganho automático antigo).
// - Nível da fala: média dos quadros de fala, com memória de ~1,5 s (sobe mais rápido do que desce, como o ouvido).
// - Alvo: targetDb. Ganho desejado = alvo - nível da fala, limitado entre minDb e maxDb (sobe até +maxDb, desce até
//   minDb). O ganho real anda devagar em dB: sobe até upDbS por segundo e desce até downDbS por segundo (sem "bombear").
// - Limitador de pico: se um pico com o ganho passasse de limit, o ganho cai na hora para caber (risada, grito, tosse);
//   depois volta suave (releaseMs). Nada estoura.
export const FRAME_MS = 10;

export function agcParams(over = {}) {
  return {
    targetDb: -20,        // nível RMS da fala na saída (dBFS)
    maxDb: 18,            // ganho máximo (microfone muito baixo / longe)
    minDb: -12,           // atenuação máxima (microfone alto demais / muito perto)
    upDbS: 4,             // velocidade máxima subindo (dB por segundo)
    downDbS: 8,           // ...descendo (fala alta pede correção mais rápida)
    speechOverDb: 9,      // quadro de fala: tanto acima do ruído de fundo...
    absMinDb: -62,        // ...e acima disso (dBFS)
    floorWinMs: 2000,     // janela do ruído de fundo (mínimo)
    levelUpMs: 400,       // memória do nível da fala quando ele sobe...
    levelDownMs: 1500,    // ...e quando desce
    limit: 0.89,          // pico máximo na saída (~ -1 dBFS)
    releaseMs: 120,       // volta do limitador
    ...over,
  };
}

export function createAgc(sampleRate = 48000, params = agcParams()) {
  let p = params;
  const fs = Math.round(sampleRate * FRAME_MS / 1000);
  let n = 0, acc = 0, peak = 0;
  let floorWin = new Float32Array(Math.max(1, Math.round(p.floorWinMs / FRAME_MS))).fill(0), fi = 0, filled = 0;
  let level = null, gainDb = 0, limGain = 1, speechFrames = 0;
  const relCoef = () => Math.exp(-1 / (p.releaseMs / 1000 * sampleRate));
  let rel = relCoef();
  const lin = (db) => 10 ** (db / 20);
  let gLin = 1;
  // fim de um quadro de 10 ms: atualiza ruído, nível da fala e o ganho alvo
  function frame(rmsDb) {
    floorWin[fi] = rmsDb; fi = (fi + 1) % floorWin.length; if (filled < floorWin.length) filled++;
    let floor = Infinity; for (let i = 0; i < filled; i++) if (floorWin[i] < floor) floor = floorWin[i];
    const speech = rmsDb > p.absMinDb && rmsDb > floor + p.speechOverDb;
    if (speech) {
      speechFrames++;
      if (level == null) level = rmsDb;
      else { const ms = rmsDb > level ? p.levelUpMs : p.levelDownMs, a = Math.exp(-FRAME_MS / ms); level = a * level + (1 - a) * rmsDb; }
      // ganho desejado; só anda enquanto há fala (nas pausas fica onde está)
      const want = Math.max(p.minDb, Math.min(p.maxDb, p.targetDb - level));
      const step = (want > gainDb ? p.upDbS : p.downDbS) * FRAME_MS / 1000;
      gainDb = want > gainDb ? Math.min(want, gainDb + step) : Math.max(want, gainDb - step);
    }
    gLin = lin(gainDb);
  }
  return {
    get gainDb() { return gainDb; }, get levelDb() { return level; }, get speechFrames() { return speechFrames; },
    setParams(np) { p = { ...p, ...np }; rel = relCoef(); if (np.floorWinMs) { floorWin = new Float32Array(Math.max(1, Math.round(p.floorWinMs / FRAME_MS))); fi = 0; filled = 0; } },
    // aplica no bloco (x -> y; podem ser o mesmo array). O ganho do quadro atual vale para as amostras dele; o limitador
    // trabalha amostra a amostra.
    process(x, y, on = true) {
      for (let i = 0; i < x.length; i++) {
        const v = x[i]; acc += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a;
        if (++n >= fs) { frame(10 * Math.log10(acc / n + 1e-12)); n = 0; acc = 0; peak = 0; }
        if (!on) { y[i] = v; continue; }
        let o = v * gLin;
        const ao = o < 0 ? -o : o;
        // limitador: pico passaria do teto -> ganho cai na hora; volta exponencial
        if (ao * limGain > p.limit) limGain = p.limit / ao;
        else limGain = 1 - (1 - limGain) * rel;
        o *= limGain; y[i] = o;
      }
    },
  };
}
