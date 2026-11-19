// Microfone mutado com a redução de ruído por IA (voice.js createMic → setIdle): o microfone sai da cadeia e a porta por
// voz (public/vadgate-worklet.js) para de rodar o RNNoise — antes ela seguia analisando zeros a cada 10 ms e o mudo
// custava tanto quanto falar. Confere, nos modos RNNoise e GTCRN, com o microfone falso tocando "fala":
//  - falando, a porta analisa ~100 quadros por segundo; mutado, nenhum; desmutado, volta a analisar;
//  - mutado sai silêncio; depois de desmutar o som volta no mesmo nível de antes e sem faltar amostra.
// MUTE_SPEECH=arquivo.wav usa uma gravação de voz no lugar da "fala" sintética (o GTCRN abafa a sintética, então o nível
// só é comparado nele quando há som de verdade antes de mutar).
// Uso: node scripts/mute-idle-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('muteidle', 3344, 41345);
let WAV = process.env.MUTE_SPEECH;
if (!WAV) { // "fala" (tom com vibrato e sílabas) e pausas, com chiado por baixo — o mesmo sinal de scripts/noise-cpu.mjs
  WAV = './.testdata-muteidle.wav';
  const rate = 48000, n = rate * 12, pcm = new Int16Array(n);
  let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) { const t = i / rate, talk = (t % 3) < 1.8, env = talk ? 0.35 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    pcm[i] = Math.round(32767 * Math.max(-1, Math.min(1, env * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 5 * t)) * t) + 0.04 * rnd()))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE + '/vendor/ns/LICENSE');
  await page.evaluate(async () => {
    window.V = await import('/voice.js');
    window.stats = () => new Promise((ok) => { const p = window.mic.vadGate.port, f = (e) => { if (e.data?.frames !== undefined) { p.removeEventListener('message', f); ok(e.data); } }; p.addEventListener('message', f); p.start?.(); p.postMessage('stats'); setTimeout(() => ok(null), 2000); });
    // nível médio (dBFS) na saída da cadeia durante ms
    window.level = async (ms) => { const a = window.mic.analyser, b = new Float32Array(a.fftSize); let s = 0, n = 0; const end = performance.now() + ms;
      while (performance.now() < end) { a.getFloatTimeDomainData(b); for (const x of b) s += x * x; n += b.length; await new Promise(r => setTimeout(r, 40)); }
      return +(10 * Math.log10(s / n + 1e-15)).toFixed(1); };
  });
  for (const mode of ['rnnoise', 'gtcrn']) {
    const info = await page.evaluate(async (prefs) => {
      window.ctx = window.V.newAudioContext(); await window.ctx.resume();
      window.mic = await window.V.createMic(prefs, window.ctx);
      for (let i = 0; i < 50 && !(await window.stats())?.ready; i++) await new Promise(r => setTimeout(r, 100));
      return { err: window.mic.error, gate: !!window.mic.vadGate };
    }, { noiseMode: mode });
    ok(!info.err && info.gate, `${mode}: microfone com a proteção por voz montado`, info);
    if (!info.gate) continue;
    const frames = async (ms) => { const a = await page.evaluate(() => window.stats()); await sleep(ms); const b = await page.evaluate(() => window.stats()); return { n: b.frames - a.frames, underruns: b.underruns }; };
    await sleep(1000);
    const talk = await frames(1500), before = await page.evaluate(() => window.level(3000));
    await page.evaluate(() => window.mic.setIdle(true)); await sleep(300);
    const muted = await frames(1500), mutedLvl = await page.evaluate(() => window.level(1000));
    await page.evaluate(() => window.mic.setIdle(false)); await sleep(500);
    const back = await frames(1500), after = await page.evaluate(() => window.level(3000));
    const u0 = (await page.evaluate(() => window.stats())).underruns;
    ok(talk.n >= 100, `${mode}: falando, a porta analisa (~100 quadros/s)`, talk);
    ok(muted.n === 0, `${mode}: mutado, a porta para de analisar`, muted);
    ok(mutedLvl < -90, `${mode}: mutado sai silêncio`, mutedLvl);
    ok(back.n >= 100, `${mode}: desmutado, volta a analisar`, back);
    if (before > -60) ok(Math.abs(after - before) < 6, `${mode}: depois de desmutar o som volta no mesmo nível`, { before, after });
    else console.log(`  (${mode}: sem som de verdade na saída antes de mutar (${before} dBFS) — o nível não é comparado; use MUTE_SPEECH)`);
    ok(u0 === talk.underruns, `${mode}: nenhuma amostra faltando depois de desmutar`, { antes: talk.underruns, depois: u0 });
    await page.evaluate(async () => { window.mic.dispose(); await window.ctx.close(); });
  }
} finally { await browser.close(); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nMUTE IDLE OK'); process.exit(fails ? 1 : 0);
