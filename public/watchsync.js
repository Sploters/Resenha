// Watch Together: lógica de sincronização pura (sem DOM, sem rede). Usada pelo cliente (public/watch.js) e pelos
// testes no Node (scripts/watch-unit-test.mjs).

export const TOLERANCE = 0.5;   // s: diferença aceitável entre a posição local e a esperada
export const HARD = 2.0;        // s: acima disso corrige na hora, sem esperar a 2ª leitura
export const COOLDOWN = 2500;   // ms: intervalo mínimo entre duas correções automáticas
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

// Decide se o player precisa ser corrigido. Entrada:
//   expected, actual (s) · playing (o estado autoritativo é "tocando") · buffering (o player está carregando)
//   strikes (leituras fora da tolerância seguidas) · lastFix (ms da última correção) · now (ms) · seekLatency (s)
// Saída: { action: 'none'|'seek'|'wait', target, drift, strikes }
export function decide({ expected, actual, playing, buffering = false, strikes = 0, lastFix = 0, now = 0, seekLatency = 0.25 }) {
  const drift = actual - expected; // > 0: adiantado; < 0: atrasado
  if (buffering) return { action: 'wait', drift, strikes: 0, target: null };
  if (Math.abs(drift) <= TOLERANCE) return { action: 'none', drift, strikes: 0, target: null };
  const s = strikes + 1;
  const urgent = !playing || Math.abs(drift) >= HARD;
  if (now - lastFix < COOLDOWN && !(!playing && Math.abs(drift) > TOLERANCE)) return { action: 'none', drift, strikes: s, target: null };
  if (!urgent && s < 2) return { action: 'none', drift, strikes: s, target: null };
  // tocando: mira um pouco à frente (o tempo que o player leva para pular e voltar a tocar)
  return { action: 'seek', drift, strikes: 0, target: Math.max(0, expected + (playing ? seekLatency : 0)) };
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
  if (Math.abs(d) <= 1.0) return 'ok';
  return d > 0 ? 'ahead' : 'behind';
}

export const fmtTime = (s) => { s = Math.max(0, Math.floor(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
// "1:02:03", "12:34", "95" → segundos (para o "Estou em…" da sincronização assistida)
export function parseTime(t) {
  const p = String(t || '').trim().split(':').map(x => x.trim()); if (!p.length || p.some(x => !/^\d+(\.\d+)?$/.test(x))) return null;
  return p.reduce((a, x) => a * 60 + +x, 0);
}
