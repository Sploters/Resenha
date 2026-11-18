// Watch Together: lógica de sincronização pura (sem DOM, sem rede). Usada pelo cliente (public/watch.js) e pelos
// testes no Node (scripts/watch-unit-test.mjs).

// Sincronia fina: diferenças pequenas são corrigidas pela VELOCIDADE (o vídeo acelera ou freia um pouco até alcançar,
// sem pulo nem engasgo); só diferenças grandes pulam. Pausado, alinha no ponto exato.
export const IN_SYNC = 0.04;    // s: abaixo disso está em sincronia (volta para a velocidade normal)
export const RATE_START = 0.1;  // s: acima disso (em 2 leituras seguidas) começa o ajuste pela velocidade
export const MAX_NUDGE = 0.1;   // velocidade entre 0,9× e 1,1× (imperceptível na fala e na música)
export const GAIN = 0.5;        // quanto da diferença é corrigido por segundo (0,5 s de diferença → 0,9×/1,1×)
export const TOLERANCE = 0.25;  // s: sem ajuste de velocidade (player que não aceita), pula acima disso
export const PAUSE_TOL = 0.05;  // s: pausado, pula para o ponto exato acima disso
export const HARD = 1.5;        // s: acima disso pula na hora (ajustar pela velocidade demoraria demais)
export const COOLDOWN = 2500;   // ms: intervalo mínimo entre dois pulos automáticos pequenos
export const START_LEAD = 1500; // ms: o servidor marca o começo de um vídeo novo um pouco no futuro (todos carregam)

// posição (s) que o player deveria estar mostrando no instante `now` (relógio do servidor)
// pb = { status: 'idle'|'playing'|'paused'|'ended', pos, at, rate }
export function expectedPos(pb, now, duration = 0) {
  if (!pb) return 0;
  let p = pb.pos || 0;
  if (pb.status === 'playing') p += Math.max(0, now - pb.at) / 1000 * (pb.rate || 1);
  if (duration > 0) p = Math.min(p, duration);
  return Math.max(0, p);
}
// ainda não chegou a hora de começar (vídeo novo com começo marcado no futuro)
export const waitingStart = (pb, now) => pb?.status === 'playing' && now < pb.at;

// Relógio comum: amostras estilo NTP. t0 = envio (cliente), ts = hora do servidor, t3 = chegada (cliente).
// Fica com a amostra de menor ida e volta (a menos afetada por fila na rede). offset: servidor − cliente (ms).
export function createClock(nowFn = () => Date.now()) {
  let best = null; const samples = [];
  return {
    add(t0, ts, t3) {
      const rtt = Math.max(0, t3 - t0), offset = ts - (t0 + t3) / 2;
      samples.push({ rtt, offset }); if (samples.length > 12) samples.shift();
      best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      return best;
    },
    get offset() { return best ? best.offset : 0; },
    get rtt() { return best ? best.rtt : null; },
    get synced() { return !!best; },
    now() { return nowFn() + (best ? best.offset : 0); },
  };
}

// Decide a correção do player. Entrada:
//   expected, actual (s) · playing (o estado autoritativo é "tocando") · buffering (o player está carregando)
//   strikes (leituras seguidas fora da faixa) · lastFix (ms do último pulo) · now (ms) · seekLatency (s)
//   canRate (o player aceita velocidade fracionada) · rate (velocidade atual) · seekTol (tolerância sem velocidade)
// Saída: { action: 'none'|'seek'|'rate'|'wait', target, rate, drift, strikes }
export function decide({ expected, actual, playing, buffering = false, strikes = 0, lastFix = 0, now = 0, seekLatency = 0.25, canRate = false, rate = 1, seekTol = TOLERANCE }) {
  const drift = actual - expected, a = Math.abs(drift); // drift > 0: adiantado; < 0: atrasado
  const keep = (extra) => ({ action: 'none', drift, strikes: 0, target: null, rate, ...extra });
  if (buffering) return { action: rate !== 1 ? 'rate' : 'wait', drift, strikes: 0, target: null, rate: 1 };
  if (!playing) {
    if (a > PAUSE_TOL && now - lastFix > 300) return { action: 'seek', drift, strikes: 0, target: Math.max(0, expected), rate: 1 };
    return keep();
  }
  if (a >= HARD) {
    if (now - lastFix < 1000) return keep({ strikes: strikes + 1 });
    return { action: 'seek', drift, strikes: 0, target: Math.max(0, expected + seekLatency), rate: 1 };
  }
  if (canRate) {
    if (a <= IN_SYNC) return rate !== 1 ? { action: 'rate', drift, strikes: 0, target: null, rate: 1 } : keep();
    const s = strikes + 1;
    if (rate === 1 && (a <= RATE_START || s < 2)) return keep({ strikes: a > RATE_START ? s : 0 });
    // adiantado → mais devagar; atrasado → mais rápido. Arredonda em 0,01 para não mexer a cada leitura
    const r = Math.round((1 - Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift * GAIN))) * 100) / 100;
    return r !== rate ? { action: 'rate', drift, strikes: 0, target: null, rate: r } : keep();
  }
  // sem ajuste de velocidade: pula (com uma tolerância maior, porque cada pulo engasga um pouco)
  if (a <= seekTol) return keep();
  const s = strikes + 1;
  if (now - lastFix < COOLDOWN || s < 2) return keep({ strikes: s });
  return { action: 'seek', drift, strikes: 0, target: Math.max(0, expected + seekLatency), rate: 1 };
}

// rótulo de sincronia de um participante (relatório dele vs. posição esperada)
export function syncState(report, pb, now, duration = 0) {
  if (!report) return 'unknown';
  if (report.error) return 'error';
  if (report.buffering) return 'buffering';
  if (report.external) return report.ready ? 'ready' : 'external';
  if (!pb || pb.status === 'idle') return 'ok';
  const age = Math.max(0, now - report.at) / 1000;
  const theirs = report.pos + (report.state === 'playing' ? age : 0);
  const d = theirs - expectedPos(pb, now, duration);
  if (Math.abs(d) <= 0.25) return 'ok';
  return d > 0 ? 'ahead' : 'behind';
}

export const fmtTime = (s) => { s = Math.max(0, Math.floor(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
// "1:02:03", "12:34", "95" → segundos (para o "Estou em…" da sincronização assistida)
export function parseTime(t) {
  const p = String(t || '').trim().split(':').map(x => x.trim()); if (!p.length || p.some(x => !/^\d+(\.\d+)?$/.test(x))) return null;
  return p.reduce((a, x) => a * 60 + +x, 0);
}
