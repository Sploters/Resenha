// Fila do áudio "só do jogo" (public/appaudio-worklet.js), sem navegador: o Windows manda o áudio um pouco mais rápido
// ou mais devagar que o Chromium toca (relógios diferentes). A fila precisa ficar perto do alvo (~40 ms) o tempo todo,
// sem ir crescendo até ser cortada (o áudio da transmissão ficava até 250 ms atrasado em relação ao vídeo).
import fs from 'node:fs';
let Cls = null;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = (_n, c) => { Cls = c; };
new Function(fs.readFileSync(new URL('../public/appaudio-worklet.js', import.meta.url), 'utf8'))();
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
function run(ratio, secs = 60) {
  const p = new Cls(), RATE = 48000, out = [[new Float32Array(128), new Float32Array(128)]];
  let sent = 0, t = 0, ph = 0, maxQ = 0, sumQ = 0, cnt = 0, jump = 0, prev = null;
  const blocks = Math.round(secs * RATE / 128);
  for (let b = 0; b < blocks; b++) {
    t += 128 / RATE;
    const want = Math.floor(t * RATE * ratio / 480) * 480; // o Windows entrega em pedaços de 10 ms
    if (want > sent) { const n = want - sent, f = new Float32Array(n * 2); for (let i = 0; i < n; i++) { const v = Math.sin(ph); ph += 2 * Math.PI * 440 / RATE; f[i * 2] = f[i * 2 + 1] = v; } p.push(new Uint8Array(f.buffer)); sent = want; }
    p.process([], out);
    if (prev !== null) jump = Math.max(jump, Math.abs(out[0][0][0] - prev));
    prev = out[0][0][127];
    if (b * 128 > RATE * 10) { maxQ = Math.max(maxQ, p.n); sumQ += p.n; cnt++; } // depois de 10 s
  }
  return { maxMs: +(maxQ / 48).toFixed(1), avgMs: +(sumQ / cnt / 48).toFixed(1), jump: +jump.toFixed(3) };
}
for (const r of [1, 1.003, 0.997, 1.0045]) {
  const x = run(r);
  ok(x.maxMs < 55 && Math.abs(x.avgMs - 40) < 10 && x.jump < 0.1, `relógio do Windows ${((r - 1) * 100).toFixed(2)}%: fila perto de 40 ms, sem cortes nem estalos`, x);
}
console.log(fails ? `\n${fails} falha(s)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
