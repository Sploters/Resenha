// CPU de cada redução de ruído (Configurações → Voz): o microfone processado do app (voice.js createMic) com um microfone
// falso tocando "fala" com chiado de fundo, cada modo por SECS segundos, em rodadas alternadas. Mede o tempo de CPU de
// todos os processos do Chromium (/proc, em ticks) e separa a thread de áudio da página (AudioWorklet, onde rodam
// RNNoise/GTCRN) do resto. "Padrão" é a supressão do próprio WebRTC (roda no serviço de áudio, fora da página).
// Uso: node scripts/noise-cpu.mjs   (SECS=15, ROUNDS=2; JSON=arquivo grava o resultado)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
import { threads as procThreads, diff, TICK } from './proc-cpu.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SECS = +(process.env.SECS || 15), ROUNDS = +(process.env.ROUNDS || 2);
const MODES = (process.env.MODES || 'off,standard,rnnoise,gtcrn').split(',');
const BASE = await ownServer('noisecpu', 3338, 41290);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// "fala" (tom com vibrato e sílabas) e pausas, sempre com chiado por baixo
const WAV = './.testdata-noisecpu.wav';
{
  const rate = 48000, secs = 12, n = rate * secs, pcm = new Int16Array(n);
  let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) { const t = i / rate, talk = (t % 3) < 1.8, env = talk ? 0.35 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    pcm[i] = Math.round(32767 * Math.max(-1, Math.min(1, env * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 5 * t)) * t) + 0.04 * rnd()))); }
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + n * 2, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22);
  hd.writeUInt32LE(rate, 24); hd.writeUInt32LE(rate * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(WAV, Buffer.concat([hd, Buffer.from(pcm.buffer)]));
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 120000,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const root = browser.process().pid;
const threads = () => procThreads(root);
const page = await browser.newPage();
page.on('pageerror', e => console.log('  PAGEERROR', e.message));
await page.goto(BASE + '/vendor/ns/LICENSE'); // página parada da mesma origem (a tela do app desenhando entraria na conta)
await page.evaluate(async () => { window.V = await import('/voice.js'); });
const R = Object.fromEntries(MODES.map(m => [m, []]));
for (let r = 0; r < ROUNDS; r++) for (const mode of MODES) {
  const info = await page.evaluate(async (mode) => {
    window.ctx = window.V.newAudioContext(); await window.ctx.resume();
    window.mic = await window.V.createMic({ noiseMode: mode }, window.ctx);
    return { err: window.mic.error, processed: window.mic.processed, ns: window.mic.raw.getAudioTracks()[0].getSettings().noiseSuppression };
  }, mode);
  if (info.err) console.log('  ', mode, info.err);
  await sleep(2000); // aquece (carregar o wasm, modelo)
  const a = threads(), t0 = Date.now(); await sleep(SECS * 1000); const b = threads(), secs = (Date.now() - t0) / 1000;
  const d = diff(a, b), pct = (x) => +(x / TICK / secs * 100).toFixed(2);
  const total = pct(Object.values(d).reduce((s, x) => s + x, 0));
  const worklet = pct(Object.entries(d).filter(([k]) => /^renderer \/ .*(AudioWorklet|Audio)/i.test(k)).reduce((s, [, x]) => s + x, 0));
  const audioSvc = pct(Object.entries(d).filter(([k]) => /^utility:audio/.test(k)).reduce((s, [, x]) => s + x, 0));
  R[mode].push({ total, worklet, audioSvc, top: Object.entries(d).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, x]) => [k, pct(x)]) });
  console.log(`  rodada ${r + 1} ${mode.padEnd(8)} total ${total}%  thread de áudio da página ${worklet}%  serviço de áudio ${audioSvc}%   (supressão do navegador: ${info.ns})`);
  if (process.env.DEBUG) console.log('     ', JSON.stringify(R[mode].at(-1).top));
  await page.evaluate(async () => { window.mic.dispose(); await window.ctx.close(); });
  await sleep(1000);
}
const avg = (xs, k) => +(xs.reduce((s, x) => s + x[k], 0) / xs.length).toFixed(2);
const base = avg(R.off || R[MODES[0]], 'total');
console.log('\nMédia (% de um núcleo; diferença para "Nenhuma"):');
const out = {};
for (const m of MODES) { out[m] = { total: avg(R[m], 'total'), worklet: avg(R[m], 'worklet'), audioSvc: avg(R[m], 'audioSvc') }; out[m].extra = +(out[m].total - base).toFixed(2);
  console.log(`  ${m.padEnd(8)} total ${out[m].total}%  (+${out[m].extra})   thread de áudio da página ${out[m].worklet}%   serviço de áudio ${out[m].audioSvc}%`); }
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ secs: SECS, rounds: ROUNDS, cores: (await import('node:os')).cpus().length, cpu: (await import('node:os')).cpus()[0]?.model, modes: out }, null, 2));
await browser.close(); fs.rmSync(WAV, { force: true }); setTimeout(() => process.exit(0), 200);
