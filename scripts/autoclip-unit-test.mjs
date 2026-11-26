// Clipes automáticos (public/autoclip-core.js) com sinais de volume sintéticos, quadro a quadro (20 ms):
// risada, grito e a call toda junto disparam; conversa normal, quem fala alto sempre e batida na mesa não.
// Uso: node scripts/autoclip-unit-test.mjs
import { createDetector, FRAME_MS } from '../public/autoclip-core.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// fala normal: sílabas de ~150 ms a ~-30 dB (±3) com pausas curtas; brilho de voz
const talk = (lvl = -30) => (t) => { const syl = Math.floor(t / 150) % 4 !== 3; return syl ? [lvl + (rnd() - .5) * 6, 0.01] : [-55, 0.01]; };
const silence = () => [-70, 0.01];
// roda as vozes (id -> função(tempo) => [db, brilho]) por ms milissegundos a partir de t0; devolve os disparos
function play(det, voices, ms, t0 = 0) {
  const out = [];
  for (let t = t0; t < t0 + ms; t += FRAME_MS) for (const [id, f] of Object.entries(voices)) { const [db, br] = f(t); const r = det.frame(id, db, br, t); if (r) { out.push({ t, id, r }); det.reset(); } }
  return out;
}
const warm = (det, ids, lvl) => play(det, Object.fromEntries(ids.map(id => [id, talk(lvl)])), 20000);

{ const d = createDetector(); const w = warm(d, ['ana', 'beto']);
  ok(w.length === 0, 'conversa normal por 20 s: nada', w);
  const r = play(d, { ana: talk(), beto: talk() }, 60000, 20000); ok(r.length === 0, 'mais 1 min de conversa normal: nada', r); }
{ const d = createDetector(); warm(d, ['ana'], -14);
  const r = play(d, { ana: talk(-14) }, 60000, 20000); ok(r.length === 0, 'quem fala alto o tempo todo (-14 dB): nada', r); }
{ const d = createDetector(); warm(d, ['ana', 'beto']);
  // risada: rajadas de 100 ms a -18 dB a cada 220 ms, por 2 s
  const laugh = (t) => ((t - 20000) % 220 < 100 ? [-18, 0.02] : [-50, 0.01]);
  const r = play(d, { ana: laugh, beto: talk() }, 2000, 20000);
  ok(r.some(x => x.r === 'laugh' && x.id === 'ana'), 'risada (ha-ha-ha) dispara', r); }
{ const d = createDetector(); warm(d, ['ana', 'beto']);
  const r = play(d, { ana: () => [-12, 0.03], beto: silence }, 800, 20000);
  ok(r.length && r[0].r === 'shout' && r[0].t - 20000 <= 500, 'grito (0,4 s bem acima do normal) dispara', r); }
{ const d = createDetector(); warm(d, ['ana', 'beto', 'caio']);
  // os três empolgados (+10 dB) ao mesmo tempo, por 1 s — abaixo do nível de grito
  const ex = (t) => (Math.floor(t / 150) % 4 !== 3 ? [-20, 0.02] : [-26, 0.02]);
  const r = play(d, { ana: ex, beto: ex, caio: talk() }, 1000, 20000);
  ok(r.some(x => x.r === 'group'), 'a call explodiu (2+ pessoas empolgadas juntas) dispara', r); }
{ const d = createDetector(); warm(d, ['ana']);
  // batida na mesa / microfone esbarrando: alto, mas grave (brilho baixo)
  const knock = (t) => ((t - 20000) % 300 < 60 ? [-8, 0.0005] : [-55, 0.01]);
  const r = play(d, { ana: knock }, 3000, 20000); ok(r.length === 0, 'batidas graves e altas: nada', r); }
{ const d = createDetector(); const r = play(d, { ana: () => [-10, 0.03] }, 2000);
  ok(r.length === 0, 'nos primeiros segundos (aprendendo o normal da voz): não dispara', r); }
{ const d = createDetector(); warm(d, ['ana']);
  const one = play(d, { ana: () => [-12, 0.03] }, 400, 20000), after = play(d, { ana: () => [-12, 0.03] }, 100, 20400);
  ok(one.length === 1 && after.length === 0, 'depois de disparar, o mesmo lance não dispara de novo na hora', { one, after }); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
