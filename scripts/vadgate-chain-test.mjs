// Cadeia do microfone com a proteção por voz (voice.js buildChain + public/vadgate-worklet.js), renderizada num
// OfflineAudioContext do Chromium: RNNoise e GTCRN com a porta ligada (padrão) e desligada. Confere que a porta é o nó
// RNNoise (sem RNNoise duplicado) no modo RNNoise e um detector à parte no GTCRN, que o ruído sem voz sai bem mais baixo
// com ela, que um tom com cara de voz passa inteiro, que não falta amostra, a latência e o ajuste ao vivo.
// (Chiado branco artificial não serve de "ruído sem voz": o detector do RNNoise o confunde com voz.)
// Uso: node scripts/vadgate-chain-test.mjs   (as medições com áudio real ficam em scripts/noise-bench.mjs)
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
import { gateParams } from '../public/vadgate-core.js';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const BASE = await ownServer('vadgate', 3343, 41340);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE + '/vendor/ns/LICENSE');
  await page.evaluate(async () => { window.V = await import('/voice.js'); });
  // ruído de fundo (~-45 dBFS, graves) o tempo todo e, de 1 s a 2,5 s, uma "vogal" (harmônicos de 140 Hz com vibrato)
  const run = (prefs) => page.evaluate(async (prefs) => {
    const R = 48000, seg = [1, 1.5, 1, 0.6, 1.2], n = Math.round(seg.reduce((a, b) => a + b) * R), x = new Float32Array(n);
    let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let i = R; i < 2.5 * R; i++) { const t = i / R, f0 = 140 + 6 * Math.sin(2 * Math.PI * 5 * t); let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h; x[i] = 0.06 * v * (0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * t)); }
    let lp = 0; for (let i = 0; i < n; i++) { lp += (rnd() - lp) * 0.05; x[i] += 0.03 * lp; }
    const START = 1024, ctx = new OfflineAudioContext(1, n + START + 4800, R);
    const ab = ctx.createBuffer(1, n, R); ab.copyToChannel(x, 0);
    const src = ctx.createBufferSource(); src.buffer = ab;
    const out = await window.V.buildChain(ctx, src, prefs);
    out.last.connect(ctx.destination); src.start(START / R);
    ctx.suspend(256 / R).then(async () => { await new Promise(r => setTimeout(r, 700)); out.setVadGate({ sens: prefs.vadSens ?? 50 }); ctx.resume(); });
    const y = (await ctx.startRendering()).getChannelData(0).subarray(START);
    const dbgOn = prefs.vadDebug; const stats = out.vadGate ? await new Promise((ok) => { out.vadGate.port.onmessage = (e) => e.data?.stats !== undefined && ok(e.data); out.vadGate.port.postMessage('stats'); setTimeout(() => ok(null), 3000); }) : null;
    const rms = (a, b) => { let s = 0; for (let i = Math.round(a * R); i < Math.round(b * R); i++) s += y[i] * y[i]; return +(10 * Math.log10(s / ((b - a) * R) + 1e-15)).toFixed(1); };
    const types = out.nodes.map(nd => nd.constructor.name + (nd instanceof AudioWorkletNode ? `(${nd.numberOfInputs})` : ''));
    const d = stats?.stats, dsum = d && [300, 330, 360, 400, 450].map(k => [k, +d.vad[k].toFixed(2), Math.round(d.lvl[k]), Math.round(d.noise[k]), d.st[k]]);
    return { dsum, err: out.error, vowel: rms(1.2, 2.4), hiss: rms(3.6, 5), types, gate: !!out.vadGate, underruns: stats?.underruns, latency: stats?.latency, ready: stats?.ready };
  }, prefs);
  const r = {};
  for (const [k, p] of Object.entries({ rnOff: { noiseMode: 'rnnoise', vadGate: false }, rnOn: { noiseMode: 'rnnoise', vadDebug: !!process.env.DEBUG }, gtOff: { noiseMode: 'gtcrn', vadGate: false }, gtOn: { noiseMode: 'gtcrn' }, off: { noiseMode: 'off' }, std: { noiseMode: 'standard' } })) {
    r[k] = await run(p); if (process.env.DEBUG) console.log(k, JSON.stringify(r[k]));
  }
  ok(!r.rnOn.err && !r.gtOn.err, 'cadeias com a proteção por voz montam sem erro', [r.rnOn.err, r.gtOn.err]);
  ok(r.rnOn.gate && r.gtOn.gate && !r.rnOff.gate && !r.gtOff.gate && !r.off.gate && !r.std.gate, 'proteção ligada por padrão só nos modos de IA (e desliga com vadGate: false)');
  ok(r.rnOn.types.filter(t => t.startsWith('RnnoiseWorkletNode')).length === 0 && r.rnOn.types.filter(t => t.startsWith('AudioWorkletNode')).length === 1,
    'RNNoise + proteção: um nó só (a porta reaproveita a probabilidade de voz do próprio RNNoise)', r.rnOn.types);
  ok(r.gtOn.types.includes('GtcrnWorkletNode(1)') && r.gtOn.types.includes('AudioWorkletNode(2)'), 'GTCRN + proteção: GTCRN e o detector à parte (2 entradas: limpo e original)', r.gtOn.types);
  ok(r.rnOn.ready && r.gtOn.ready && r.rnOn.underruns === 0 && r.gtOn.underruns === 0, 'modelo carregado e nenhuma amostra faltando', { rn: r.rnOn.underruns, gt: r.gtOn.underruns });
  ok(r.rnOn.latency === 480 && r.gtOn.latency === 0, 'atraso da porta: 10 ms no RNNoise (montar o quadro; o nó RNNoise antigo atrasava 13 ms), 0 no GTCRN', { rn: r.rnOn.latency, gt: r.gtOn.latency });
  ok(Math.abs(r.rnOn.vowel - r.rnOff.vowel) < 1.5 && Math.abs(r.gtOn.vowel - r.gtOff.vowel) < 1.5, 'som com cara de voz passa inteiro', { rn: [r.rnOff.vowel, r.rnOn.vowel], gt: [r.gtOff.vowel, r.gtOn.vowel] });
  ok(r.rnOn.hiss < r.rnOff.hiss - 15 && r.gtOn.hiss < r.gtOff.hiss - 15, 'ruído de fundo sem voz: a proteção abafa (15 dB a mais, no mínimo)', { rn: [r.rnOff.hiss, r.rnOn.hiss], gt: [r.gtOff.hiss, r.gtOn.hiss] });
  const fl = gateParams(50).floorDb; // atenuação da porta fechada (sensibilidade 50)
  ok(r.rnOn.hiss - r.rnOff.hiss > fl - 2 && r.gtOn.hiss - r.gtOff.hiss > fl - 2, `abafa (~${-Math.round(fl)} dB), não emudece`, { rn: r.rnOn.hiss - r.rnOff.hiss, gt: r.gtOn.hiss - r.gtOff.hiss });
  const off = await run({ noiseMode: 'rnnoise', vadSens: 50, vadParams: undefined, vadGate: true, vadDebug: false });
  ok(!off.err, 'ajuste de sensibilidade ao vivo (setVadGate) sem erro');
} finally { await browser.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nVADGATE CHAIN OK'); process.exit(fails ? 1 : 0);
