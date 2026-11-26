// Clipes automáticos: a decisão de "a call explodiu" (sem navegador; testado em scripts/autoclip-unit-test.mjs).
// Recebe, para cada voz da call, quadros de 20 ms com o volume (dB) e o "brilho" (energia da diferença entre amostras sobre
// a energia: grito e risada têm muito agudo; batida na mesa e ruído grave, pouco). Cada voz tem a própria referência (o
// volume normal dela falando, média lenta), então quem fala alto sempre não dispara: só o que foge do normal de cada um.
// Três gatilhos:
// - risada: rajadas curtas e seguidas ("ha-ha-ha", 3 a 8 por segundo) acima do normal da pessoa;
// - grito: bem acima do normal (+13 dB) e alto de verdade, por pelo menos ~0,35 s;
// - a call explodiu: duas ou mais pessoas empolgadas (+8 dB acima do normal) ao mesmo tempo.
// Nada disso é gravado nem enviado: só o número do volume de cada quadro passa por aqui, e só neste aparelho.
export const FRAME_MS = 20;
const N = (ms) => Math.round(ms / FRAME_MS);

export function createDetector(o = {}) {
  const p = {
    floor: -48, // abaixo disso é silêncio (não mexe na referência)
    hotRel: 8, hotAbs: -33, // empolgado: acima do normal da pessoa e alto
    shoutRel: 13, shoutAbs: -24, shoutMs: 340, shoutWinMs: 520,
    laughWinMs: 1800, laughMin: 5, laughMax: 15, burstMinMs: 40, burstMaxMs: 300,
    groupWinMs: 1500, groupMin: 2, excitedMs: 120,
    bright: 0.003, // brilho mínimo: ~(2π·f/48000)² — voz (500 Hz+) passa; batida na mesa e zumbido grave (<250 Hz) ficam abaixo
    baseMs: 15000, baseInit: -30, warmMs: 4000, // referência: média lenta do volume falando; os primeiros segundos não disparam
    ...o,
  };
  const voices = new Map(); // id -> estado
  const alpha = FRAME_MS / p.baseMs;
  const hist = () => ({ hot: [], loud: [] });
  function st(id) {
    let s = voices.get(id);
    if (!s) voices.set(id, s = { base: p.baseInit, n: 0, ...hist(), run: 0, excitedAt: -1e9, t: 0 });
    return s;
  }
  const push = (arr, v, max) => { arr.push(v); if (arr.length > max) arr.shift(); };
  const laughWin = N(p.laughWinMs), shoutWin = N(p.shoutWinMs);

  // um quadro de uma voz; t em ms. Devolve 'laugh' | 'shout' | 'group' | null
  function frame(id, db, bright, t) {
    const s = st(id); s.t = t; s.n++;
    const speaking = db > p.floor;
    if (speaking) s.base += (Math.min(db, s.base + 20) - s.base) * alpha; // um grito não puxa a referência de uma vez
    const hot = speaking && bright >= p.bright && db > Math.max(s.base + p.hotRel, p.hotAbs);
    const loud = speaking && bright >= p.bright && db > Math.max(s.base + p.shoutRel, p.shoutAbs);
    push(s.hot, hot ? 1 : 0, laughWin); push(s.loud, loud ? 1 : 0, shoutWin);
    s.run = hot ? s.run + 1 : 0;
    if (s.run >= N(p.excitedMs)) s.excitedAt = t;
    if (s.n * FRAME_MS < p.warmMs) return null; // ainda aprendendo o normal dessa voz

    // grito: quase toda a janela curta bem acima do normal
    if (s.loud.reduce((a, b) => a + b, 0) >= N(p.shoutMs)) return 'shout';
    // risada: conta rajadas (trechos empolgados curtos separados por pausas) na janela
    if (s.hot.length >= laughWin) {
      let bursts = 0, len = 0, longest = 0;
      for (let i = 0; i <= s.hot.length; i++) {
        if (i < s.hot.length && s.hot[i]) { len++; continue; }
        if (len >= N(p.burstMinMs) && len <= N(p.burstMaxMs)) bursts++;
        longest = Math.max(longest, len); len = 0;
      }
      if (bursts >= p.laughMin && bursts <= p.laughMax && longest <= N(p.burstMaxMs) * 2) return 'laugh';
    }
    // a call explodiu: várias vozes empolgadas juntas
    if (hot) {
      let n = 0; for (const v of voices.values()) if (t - v.excitedAt <= p.groupWinMs) n++;
      if (n >= p.groupMin) return 'group';
    }
    return null;
  }
  // depois de disparar: limpa as janelas para o mesmo lance não disparar de novo
  function reset() { for (const s of voices.values()) { Object.assign(s, hist()); s.run = 0; s.excitedAt = -1e9; } }
  const drop = (id) => voices.delete(id);
  return { frame, reset, drop, voices, params: p };
}
