// Filtro de ruído constante (public/fanfilter-core.js) e ganho automático próprio (public/agc-core.js), sem navegador.
import assert from 'node:assert/strict';
import { createFanFilter, fanParams, HOP, LATENCY } from '../public/fanfilter-core.js';
import { createAgc, agcParams } from '../public/agc-core.js';

const SR = 48000;
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const db = (e) => 10 * Math.log10(e + 1e-15);
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const run = (f, x, on = true) => { const y = new Float32Array(x.length), bx = new Float32Array(HOP), by = new Float32Array(HOP); for (let i = 0; i + HOP <= x.length; i += HOP) { bx.set(x.subarray(i, i + HOP)); f.process(bx, by, on); y.set(by, i); } return y; };
// "ventilador": ruído rosa filtrado + zumbido de 118 Hz (o mesmo do scripts/noise-bench.mjs)
function fan(n, amp) { let b0 = 0, b1 = 0, b2 = 0, lp = 0; const x = new Float32Array(n); for (let i = 0; i < n; i++) { const w = rnd(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; const pk = b0 + b1 + b2 + w * 0.1848; lp += (pk - lp) * 0.08; x[i] = lp + 0.04 * Math.sin(2 * Math.PI * 118 * i / SR); } const g = amp / rms(x); return x.map(v => v * g); }
// "voz": vogais com harmônicos (tom 140 Hz, formantes), sílabas de 180 ms com pausas de 70 ms
function voice(n, amp, from = 0, to = n) {
  const x = new Float32Array(n);
  for (let i = from; i < to; i++) { const t = (i - from) / SR, syl = t % 0.25; if (syl > 0.18) continue; const env = Math.sin(Math.PI * syl / 0.18); let v = 0; for (let k = 1; k <= 25; k++) { const f = 140 * k, fm = Math.exp(-((f - 700) ** 2) / 2e5) + 0.6 * Math.exp(-((f - 1200) ** 2) / 3e5) + 0.3 * Math.exp(-((f - 2600) ** 2) / 6e5); v += fm * Math.sin(2 * Math.PI * f * t + k); } x[i] = v * env; }
  const g = amp / rms(x, from, to) * Math.sqrt((to - from) / n) * Math.sqrt(1); return x.map(v => v * g);
}

// 1) passagem limpa: com o filtro desligado a saída é a entrada atrasada em LATENCY (reconstrução perfeita)
{
  const f = createFanFilter(SR), x = new Float32Array(SR).map(() => rnd() * 0.3), y = run(f, x, false);
  let err = 0; for (let i = LATENCY + 1024; i < x.length - 1024; i++) err = Math.max(err, Math.abs(y[i] - x[i - LATENCY]));
  assert.ok(err < 1e-6, 'reconstrução: erro ' + err);
  console.log('ok  reconstrução perfeita, atraso', LATENCY, 'amostras (' + (LATENCY / 48).toFixed(1) + ' ms)');
}
// 2) ventilador sozinho: depois de aprender (2 s), cai bastante
{
  const f = createFanFilter(SR), x = fan(SR * 6, 10 ** (-40 / 20)), y = run(f, x);
  const inDb = 20 * Math.log10(rms(x, SR * 3, SR * 6)), outDb = 20 * Math.log10(rms(y, SR * 3, SR * 6));
  console.log(`ok  ventilador sozinho: ${inDb.toFixed(1)} -> ${outDb.toFixed(1)} dBFS (${(outDb - inDb).toFixed(1)} dB)`);
  assert.ok(outDb - inDb < -7, 'ventilador devia cair mais de 7 dB: ' + (outDb - inDb));
}
// 3) voz + ventilador: a voz fica (perde pouco), o ruído nas pausas longas cai
{
  const n = SR * 8, fn = fan(n, 10 ** (-40 / 20)), vo = voice(n, 10 ** (-24 / 20), SR * 3, SR * 6);
  const mix = fn.map((v, i) => v + vo[i]);
  const f = createFanFilter(SR), y = run(f, mix);
  // voz preservada: compara a saída com a voz pura atrasada, onde a voz é forte (envelope)
  const fy = createFanFilter(SR); const yv = run(fy, vo, false); // referência atrasada
  let sv = 0, se = 0; for (let i = SR * 3 + LATENCY; i < SR * 6; i++) { sv += yv[i] * yv[i]; const e = y[i] - yv[i]; se += e * e; }
  const snrIn = db(rms(vo, SR * 3, SR * 6) ** 2) - db(rms(fn, SR * 3, SR * 6) ** 2), snrOut = db(sv) - db(se);
  const tail = 20 * Math.log10(rms(y, SR * 6.5, SR * 8) / rms(mix, SR * 6.5, SR * 8));
  const voiceKeep = 20 * Math.log10(rms(y, SR * 3 + LATENCY, SR * 6) / rms(mix, SR * 3, SR * 6 - LATENCY));
  console.log(`ok  voz + ventilador: relação voz/erro ${snrIn.toFixed(1)} -> ${snrOut.toFixed(1)} dB; nível na fala ${voiceKeep.toFixed(1)} dB; ruído depois da fala ${tail.toFixed(1)} dB`);
  assert.ok(snrOut > snrIn + 3, 'a relação voz/ruído devia melhorar');
  assert.ok(voiceKeep > -3, 'voz perdeu demais: ' + voiceKeep);
  assert.ok(tail < -7, 'ruído depois da fala devia cair: ' + tail);
}
// 4) sala silenciosa: voz sozinha quase não muda
{
  const n = SR * 5, vo = voice(n, 10 ** (-24 / 20), SR, SR * 4), flo = new Float32Array(n).map(() => rnd() * 1e-4), x = vo.map((v, i) => v + flo[i]);
  const y = run(createFanFilter(SR), x), ref = run(createFanFilter(SR), x, false);
  const d = 20 * Math.log10(rms(y, SR + LATENCY, SR * 4) / rms(ref, SR + LATENCY, SR * 4));
  console.log(`ok  sala silenciosa: voz ${d.toFixed(2)} dB`);
  assert.ok(Math.abs(d) < 1, 'voz mudou numa sala silenciosa: ' + d);
}
// 5) força: mais forte tira mais
{
  const x = fan(SR * 5, 0.01); const a = run(createFanFilter(SR, fanParams(0)), x), b = run(createFanFilter(SR, fanParams(100)), x);
  assert.ok(rms(b, SR * 3) < rms(a, SR * 3), 'força 100 devia tirar mais que 0');
  console.log('ok  força: 0 ->', (20 * Math.log10(rms(a, SR * 3) / rms(x, SR * 3))).toFixed(1), 'dB · 100 ->', (20 * Math.log10(rms(b, SR * 3) / rms(x, SR * 3))).toFixed(1), 'dB');
}

// ---------- ganho automático ----------
const agcRun = (x, p) => { const a = createAgc(SR, agcParams(p)), y = new Float32Array(x.length); for (let i = 0; i < x.length; i += 128) a.process(x.subarray(i, i + 128), y.subarray(i, i + 128)); return { a, y }; };
// 6) voz baixa sobe até perto do alvo e voz alta desce: nos DOIS sentidos (o do navegador só descia)
{
  const low = voice(SR * 12, 10 ** (-36 / 20)), { a: al, y: yl } = agcRun(low);
  const high = voice(SR * 12, 10 ** (-8 / 20)), { a: ah, y: yh } = agcRun(high);
  const outL = 20 * Math.log10(rms(yl, SR * 9)), outH = 20 * Math.log10(rms(yh, SR * 9));
  console.log(`ok  ganho: voz baixa -36 -> ${outL.toFixed(1)} dB (ganho ${al.gainDb.toFixed(1)}), voz alta -8 -> ${outH.toFixed(1)} dB (ganho ${ah.gainDb.toFixed(1)})`);
  assert.ok(al.gainDb > 8, 'voz baixa devia subir');
  assert.ok(ah.gainDb < -4, 'voz alta devia descer');
}
// 7) depois de um grito, volta a subir quando a pessoa volta a falar normal (o problema relatado: só descia)
{
  const n = SR * 30, x = new Float32Array(n);
  const norm = voice(n, 10 ** (-30 / 20)), loud = voice(n, 10 ** (-6 / 20));
  for (let i = 0; i < n; i++) x[i] = i >= SR * 8 && i < SR * 11 ? loud[i] : norm[i];
  const a = createAgc(SR), y = new Float32Array(n); let gAfterShout = 0;
  for (let i = 0; i < n; i += 128) { a.process(x.subarray(i, i + 128), y.subarray(i, i + 128)); if (i >= SR * 11 && !gAfterShout) gAfterShout = a.gainDb; }
  console.log(`ok  depois do grito: ganho ${gAfterShout.toFixed(1)} dB -> ${a.gainDb.toFixed(1)} dB 19 s depois`);
  assert.ok(a.gainDb > gAfterShout + 6, 'o ganho devia voltar a subir');
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); assert.ok(pk <= 0.9, 'limitador deixou passar ' + pk);
}
// 8) nas pausas o ganho não anda (ruído de fundo não sobe)
{
  const n = SR * 10, x = new Float32Array(n), vo = voice(n, 10 ** (-34 / 20), 0, SR * 4), bg = fan(n, 10 ** (-60 / 20));
  for (let i = 0; i < n; i++) x[i] = vo[i] + bg[i];
  const a = createAgc(SR), y = new Float32Array(n); let g4 = null;
  for (let i = 0; i < n; i += 128) { a.process(x.subarray(i, i + 128), y.subarray(i, i + 128)); if (i >= SR * 4.3 && g4 == null) g4 = a.gainDb; }
  console.log(`ok  pausa: ganho ${g4.toFixed(2)} -> ${a.gainDb.toFixed(2)} dB em 5,7 s de silêncio`);
  assert.ok(Math.abs(a.gainDb - g4) < 0.5, 'o ganho mudou na pausa');
}
console.log('fanfilter-unit-test: tudo certo');
