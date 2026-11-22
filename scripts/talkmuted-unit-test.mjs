// "Você está mutado" (public/micwatch.js talkMutedStep): falar com o mudo ligado avisa; teclado, clique, tosse, ruído de
// fundo alto (ventilador) e o fim da frase logo depois de mutar não avisam; sem repetir o aviso em seguida.
// Também o aviso de microfone sem som depois de esgotar as remontagens (micWatchStep → w.deadNew).
// Uso: node scripts/talkmuted-unit-test.mjs
import { newTalkMuted, talkMutedStep, TALKMUTED, newMicWatch, micWatchStep, MICWATCH } from '../public/micwatch.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const FLOOR = 0.0015; // chiado de um microfone comum (~-56 dBFS)
// seq: lista de rms por trecho de 250 ms; devolve em que trechos avisou
const run = (w, seq, muted = true) => seq.map(r => talkMutedStep(w, { muted, rms: r })).flatMap((v, i) => v ? [i] : []);
const rep = (v, n) => Array(n).fill(v);
// fala: sílabas de 0,04–0,08 com pausas curtas (trechos de 250 ms quase todos com voz)
const speech = (n, lvl = 0.05) => Array.from({ length: n }, (_, i) => i % 5 === 4 ? FLOOR * 2 : lvl * (0.8 + 0.4 * ((i * 7) % 3) / 2));

{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false); const a = run(w, [...rep(FLOOR, 8), ...speech(12)]);
  ok(a.length === 1 && a[0] - 8 <= 7, 'mutado e falando: avisa em ~1,5 s de fala', a); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false); const a = run(w, [...rep(FLOOR, 8), ...speech(12, 0.009)]);
  ok(a.length === 1, 'microfone baixo (~-41 dBFS) também avisa', a); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false); ok(run(w, speech(40), false).length === 0, 'desmutado: nunca avisa'); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false);
  const keys = Array.from({ length: 240 }, (_, i) => i % 3 === 0 ? 0.08 : FLOOR); // digitando rápido: uma tecla a cada 750 ms por 1 min
  ok(run(w, keys).length === 0, 'teclado/cliques soltos não avisam'); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false);
  const cough = [...rep(FLOOR, 8), 0.2, 0.15, 0.1, ...rep(FLOOR, 20), 0.3, 0.2, ...rep(FLOOR, 20)];
  ok(run(w, cough).length === 0, 'tosse e porta batendo (curtas) não avisam'); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false);
  const fan = [...rep(FLOOR, 8), ...rep(0.02, 400)]; // ventilador ligado perto do microfone por 100 s (~-34 dBFS constante)
  const a = run(w, fan); ok(a.length <= 1, 'ruído de fundo constante: no máximo um aviso no começo, depois o chão acompanha', a);
  ok(run(w, speech(16, 0.12)).length === 1, 'com o ventilador ligado, fala de verdade (bem acima dele) ainda avisa'); }
{ const w = newTalkMuted(); run(w, speech(20), false); // estava falando e mutou no meio da frase
  ok(run(w, [...speech(4), ...rep(FLOOR, 30)]).length === 0, 'mutou no fim da frase: não avisa'); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false); const a = run(w, speech(4 * 60)); // falando mutado 1 min sem parar
  const gaps = a.slice(1).map((x, i) => (x - a[i]) / 4);
  ok(a.length >= 2 && gaps.every(g => g >= TALKMUTED.COOL_S), 'falando mutado sem parar: repete o aviso, mas espaçado', { a, gaps }); }
{ const w = newTalkMuted(); run(w, rep(FLOOR, 20), false); ok(run(w, rep(null, 40)).length === 0, 'sem leitura (motor de áudio parado): não avisa'); }

// microfone morto de vez: depois das MAX remontagens, avisa UMA vez; o som voltando rearma
{ const w = newMicWatch(); let dead = 0;
  for (let i = 0; i < 600; i++) { micWatchStep(w, { graph: 1, ended: true, muted: false, ctxRunning: true }); if (w.deadNew) { dead++; w.deadNew = false; } }
  ok(dead === 1, 'esgotou as remontagens: um aviso de microfone sem som', dead);
  micWatchStep(w, { graph: 2, ended: false, muted: false, ctxRunning: true, peak: 1e-3 });
  ok(!w.dead && w.fixes === 0, 'o som voltou: rearma o aviso e a conta');
  let again = 0; for (let i = 0; i < 600; i++) { micWatchStep(w, { graph: 2, ended: true, muted: false, ctxRunning: true }); if (w.deadNew) { again++; w.deadNew = false; } }
  ok(again === 1 && MICWATCH.MAX > 1, 'morreu de novo depois: avisa de novo', again); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
