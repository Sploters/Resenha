// Vigia do microfone (public/micwatch.js): captura morta (zero absoluto, trilha terminada ou muda, motor de áudio parado)
// pede remontagem; silêncio normal, microfone que dá zero de propósito e laços não.
// Uso: node scripts/micwatch-unit-test.mjs
import { newMicWatch, micWatchStep, MICWATCH } from '../public/micwatch.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const base = { graph: 1, ended: false, muted: false, ctxRunning: true };
const run = (w, n, s) => { const out = []; for (let i = 0; i < n; i++) out.push(micWatchStep(w, { ...base, ...s })); return out; };
const rebuilds = (a) => a.filter(r => r?.rebuild).map(r => r.rebuild);
const NOISE = 2e-4, ZERO = 0;

{ // fala/chiado normal por 10 min: nada
  const w = newMicWatch(); ok(rebuilds(run(w, 600, { peak: NOISE })).length === 0, 'chiado de fundo constante não remonta');
}
{ // tinha som e virou zero absoluto: remonta depois de ZERO_S
  const w = newMicWatch(); run(w, 30, { peak: NOISE }); const r = run(w, MICWATCH.ZERO_S, { peak: ZERO });
  ok(r[MICWATCH.ZERO_S - 1]?.rebuild === 'silence' && rebuilds(r).length === 1, 'zero absoluto depois de som remonta', r.map(x => x?.rebuild || 0));
  // a captura nova tem som: tudo normal, e outra morte depois também é tratada
  run(w, 30, { graph: 2, peak: NOISE }); const r2 = run(w, 10, { graph: 2, peak: ZERO });
  ok(rebuilds(r2).join() === 'silence', 'morreu de novo mais tarde: remonta de novo');
}
{ // microfone com porta de ruído embutida (zero de propósito): uma remontagem no silêncio e depois para
  const w = newMicWatch(); run(w, 10, { peak: NOISE }); const a = rebuilds(run(w, 10, { peak: ZERO }));
  const b = rebuilds(run(w, 120, { graph: 2, peak: ZERO })); run(w, 5, { graph: 2, peak: NOISE }); const c = rebuilds(run(w, 120, { graph: 2, peak: ZERO }));
  ok(a.length === 1 && b.length === 0 && c.length === 0, 'dispositivo que dá zero: só a 1ª remontagem', { a, b, c });
}
{ // captura que nasce zerada (nunca teve som): não remonta à toa
  const w = newMicWatch(); ok(rebuilds(run(w, 120, { peak: ZERO })).length === 0, 'nunca teve som: não remonta');
}
{ // trilha terminou: na hora; laço limitado
  const w = newMicWatch(); const r = run(w, 1, { ended: true }); ok(r[0]?.rebuild === 'ended', 'trilha terminada remonta na hora');
  const many = rebuilds(run(w, 600, { ended: true })); ok(many.length === MICWATCH.MAX - 1, 'dispositivo morto de vez: no máximo MAX tentativas', many.length);
  const gaps = []; let last = -1; const w2 = newMicWatch();
  for (let i = 0; i < 200; i++) if (micWatchStep(w2, { ...base, ended: true })?.rebuild) { if (last >= 0) gaps.push(i - last); last = i; }
  ok(gaps.every(g => g >= MICWATCH.GAP_S), 'tentativas espaçadas', gaps);
}
{ // trilha muda pelo sistema
  const w = newMicWatch(); run(w, 5, { peak: NOISE }); const r = rebuilds(run(w, MICWATCH.MUTE_S, { muted: true, peak: ZERO }));
  ok(r.join() === 'muted', 'trilha muda por alguns segundos remonta'); const w2 = newMicWatch();
  ok(rebuilds(run(w2, 2, { muted: true })).length === 0, 'mudinha rápida não remonta');
}
{ // motor de áudio parado: pede para voltar, e remonta se não voltar
  const w = newMicWatch(); const r = run(w, MICWATCH.CTX_S, { ctxRunning: false, peak: ZERO });
  ok(r[0] === 'resume' && r[MICWATCH.CTX_S - 1]?.rebuild === 'ctx', 'áudio suspenso: resume e depois remonta', r);
  const w2 = newMicWatch(); run(w2, 5, { peak: NOISE }); ok(rebuilds(run(w2, 20, { ctxRunning: false, peak: ZERO })).length <= 2, 'áudio suspenso não conta como zero da captura');
}
{ // depois de várias recuperações que deram certo, a conta zera (chamada longa com o problema várias vezes)
  const w = newMicWatch(); let g = 1, n = 0;
  for (let k = 0; k < 10; k++) { run(w, 20, { graph: g, peak: NOISE }); n += rebuilds(run(w, 10, { graph: g, peak: ZERO })).length; g++; }
  ok(n === 10, 'dez quedas numa chamada longa: dez recuperações', n);
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo'); process.exit(fails ? 1 : 0);
