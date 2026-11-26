// "Pausar a Máxima no silêncio" (experimental, prefs.gtcrnPause; voice.js buildChain + vadgate-worklet.js pauseStep):
// com a redução Máxima (GTCRN) e a proteção por voz, 2 s de silêncio tiram o GTCRN da cadeia e a fala volta a ligá-lo.
// Microfone falso: 1,5 s de "fala", 4 s de silêncio (com chiado baixo), em laço. Confere que pausa no silêncio, religa
// na fala (com som saindo), que desligado nunca pausa e que mutar/desmutar com o GTCRN pausado não o religa por engano.
// Uso: node scripts/gtcrn-pause-test.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('gtcrnpause', 3435, 41800);
const WAV = './.testdata-gtcrnpause.wav';
{
  const rate = 48000, n = rate * 11, pcm = new Int16Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) { const t = i / rate, ph = t % 5.5, talk = ph < 1.5, env = talk ? 0.4 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    pcm[i] = Math.round(32767 * Math.max(-1, Math.min(1, env * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 5 * t)) * t) + 0.01 * rnd()))); }
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
  await page.evaluate(async () => { window.V = await import('/voice.js'); });
  // linha do tempo de 12 s: a cada 100 ms, pausado ou não e o nível que sai da cadeia
  const run = (prefs, muteAt) => page.evaluate(async (prefs, muteAt) => {
    window.mutedAt = window.unmutedAt = 0;
    const ctx = window.V.newAudioContext(); await ctx.resume();
    const mic = await window.V.createMic(prefs, ctx); window.mic = mic;
    const a = mic.analyser, b = new Float32Array(a.fftSize), out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      const t = performance.now() - t0;
      // mutar assim que pausar e desmutar 600 ms depois (marca o momento do desmute)
      if (muteAt && mic.gtcrnPaused && !window.mutedAt) { window.mutedAt = t; mic.setIdle(true); }
      if (muteAt && window.mutedAt && mic.idle && t > window.mutedAt + 600) { mic.setIdle(false); window.unmutedAt = t; }
      a.getFloatTimeDomainData(b); let s = 0; for (const x of b) s += x * x;
      out.push([Math.round(t), mic.gtcrnPaused ? 1 : 0, +(10 * Math.log10(s / b.length + 1e-15)).toFixed(1)]);
      await new Promise(r => setTimeout(r, 100));
    }
    const r = { err: mic.error, gate: !!mic.vadGate, pauses: mic.gtcrnPauses || 0, out, unmutedAt: window.unmutedAt };
    mic.dispose(); await ctx.close(); return r;
  }, prefs, muteAt);
  const on = await run({ noiseMode: 'gtcrn', gtcrnPause: true });
  ok(!on.err && on.gate, 'GTCRN com a proteção por voz montado', { err: on.err });
  ok(on.pauses >= 1, 'pausa no silêncio (2 s sem fala)', on.pauses);
  const pausedSpans = on.out.filter(x => x[1]).length;
  ok(pausedSpans > 5, 'fica pausado durante o silêncio', pausedSpans);
  // depois de uma pausa, a fala religa e sai som
  let resumedLoud = false;
  // (o GTCRN abafa muito a "fala" sintética: compara com o silêncio de antes, que sai em ~-135 dB)
  for (let i = 1; i < on.out.length; i++) if (on.out[i - 1][1] === 1 && on.out[i][1] === 0) { const after = on.out.slice(i, i + 8).map(x => x[2]); if (Math.max(...after) > -90) resumedLoud = true; }
  ok(resumedLoud, 'a fala religa o GTCRN e o som sai de novo');
  const off = await run({ noiseMode: 'gtcrn' });
  ok(!off.err && off.pauses === 0 && !off.out.some(x => x[1]), 'desligado (padrão): nunca pausa');
  // mutar e desmutar no meio do silêncio (pausado): continua pausado até a fala voltar, e a fala ainda religa
  const mu = await run({ noiseMode: 'gtcrn', gtcrnPause: true }, true);
  const after = mu.out.filter(x => x[0] > mu.unmutedAt && x[0] < mu.unmutedAt + 300);
  ok(mu.unmutedAt > 0 && after.length && after.every(x => x[1] === 0), 'desmutar (ou apertar para falar) com o GTCRN pausado religa na hora', { at: mu.unmutedAt, after });
  ok(mu.out.some(x => x[0] > mu.unmutedAt + 2000 && x[1] === 1), 'e pausa de novo depois de 2 s sem fala');
} catch (e) { ok(false, 'erro: ' + e.message); }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
