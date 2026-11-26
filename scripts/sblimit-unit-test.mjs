// Anti-spam do soundboard (server/sblimit.js): 6 sons livres em 10 s, castigo de 10 s que cresce (20, 40, 60) para quem
// insiste e esfria depois de 2 min sem estourar. Uso: node scripts/sblimit-unit-test.mjs
import { createSbLimiter, BURST } from '../server/sblimit.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
let t = 1e9; const L = createSbLimiter({ now: () => t });
const spam = (n, gap = 100) => { const out = []; for (let i = 0; i < n; i++) { out.push(L.hit('ana')); t += gap; } return out; };
let r = spam(BURST, 50);
ok(r.every(x => x.ok), `${BURST} sons seguidos (50 ms entre eles): todos tocam`);
r = L.hit('ana'); ok(!r.ok && r.fresh && r.secs === 10, '7º em menos de 10 s: espera de 10 s', r);
t += 3000; r = L.hit('ana'); ok(!r.ok && !r.fresh && r.secs === 7, 'durante a espera: ignorado, sem aumentar a espera', r);
ok(L.hit('beto').ok, 'outra pessoa não é afetada');
t += 7100; r = spam(BURST, 50); ok(r.every(x => x.ok), 'liberou: rajada livre de novo');
r = L.hit('ana'); ok(!r.ok && r.secs === 20, 'estourou de novo logo depois: 20 s', r);
t += 20100; spam(BURST, 10); r = L.hit('ana'); ok(r.secs === 40, 'de novo: 40 s', r);
t += 40100; spam(BURST, 10); r = L.hit('ana'); ok(r.secs === 60, 'de novo: 60 s', r);
t += 60100; spam(BURST, 10); r = L.hit('ana'); ok(r.secs === 60, 'não passa de 60 s', r);
t += 60100 + 121e3; spam(BURST, 10); r = L.hit('ana'); ok(r.secs === 10, '2 min sem estourar: volta para 10 s', r);
t += 10100; r = spam(12, 1700); ok(r.every(x => x.ok), 'ritmo normal (1 som a cada 1,7 s, 12 sons): nunca bloqueia');
L.prune(); t += 400e3; L.prune(); ok(L.users.size === 0, 'limpeza tira quem parou de usar');
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
