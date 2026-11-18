// Banco de medição da redução de ruído: compara a cadeia antiga (RNNoise/GTCRN puros, e RNNoise + porta por volume) com a
// porta guiada por voz (public/vadgate-*.js), com áudio real:
//   voz: MS-SNSD clean_test (Microsoft); latidos, motores, teclado e aspirador: ESC-50 (K. Piczak, CC BY-NC) — baixados para
//   .testdata-noisefix/ na 1ª vez (não vão para o repositório). Ventilador e ar ambiente são sintéticos.
// Cada cenário é renderizado num OfflineAudioContext do Chromium com a MESMA cadeia do app (voice.js buildChain).
// Mede, em quadros de 10 ms (com a saída alinhada pela latência de cada cadeia):
//   ruído que passa (nas pausas, onde há ruído): atenuação, nível que sobra e % de quadros audíveis;
//   porta aberta por engano (falsos positivos); voz preservada em relação à cadeia antiga (toda, a mais baixa, começo e
//   fim das falas, % de quadros cortados); relação voz/ruído na saída durante a fala; latência; custo de CPU.
// Uso: node scripts/noise-bench.mjs   (SENS=50; ONLY=cenario1,cenario2; WAV=1 grava as saídas; JSON=arquivo)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ownServer } from './test-server.mjs';

const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SR = 48000, FR = 480, CACHE = '.testdata-noisefix';
const SENS = +(process.env.SENS ?? 50), PARAMS = process.env.PARAMS ? JSON.parse(process.env.PARAMS) : undefined; // PARAMS='{"lookahead":0}'
fs.mkdirSync(CACHE, { recursive: true });

// ---------- amostras ----------
const SPEECH = [1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 15, 16, 20, 21, 22, 23, 30, 50].map(i => [`clnsp${i}`, `https://raw.githubusercontent.com/microsoft/MS-SNSD/master/clean_test/clnsp${i}.wav`]);
const ESC = 'https://raw.githubusercontent.com/karolpiczak/ESC-50/master/audio/';
const DOG = ['1-100032-A-0', '1-110389-A-0', '1-30226-A-0', '1-30344-A-0'], ENGINE = ['1-18527-A-44', '1-18527-B-44', '1-22882-A-44', '1-50454-A-44'],
  KEYS = ['1-137-A-32', '1-53501-A-32', '1-61212-A-32', '1-62594-A-32'];
const VACUUM = ['1-100210-A-36', '1-19840-A-36']; // aspirador (aparelho ligado no cômodo)
const files = [...SPEECH, ...[...DOG, ...ENGINE, ...KEYS, ...VACUUM].map(n => [n, ESC + n + '.wav'])];
for (const [n, url] of files) {
  const raw = `${CACHE}/${n}.f32`; if (fs.existsSync(raw)) continue;
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(`${CACHE}/${n}.wav`, Buffer.from(await r.arrayBuffer()));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${CACHE}/${n}.wav`, '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw]);
}
const load = (n) => { const b = fs.readFileSync(`${CACHE}/${n}.f32`); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };

// ---------- utilidades de sinal ----------
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const db = (e) => 10 * Math.log10(e + 1e-15);
const frameE = (x, k) => { let s = 0; for (let i = k * FR, e = Math.min(x.length, i + FR); i < e; i++) s += x[i] * x[i]; return s / FR; };
const frames = (x) => Array.from({ length: Math.floor(x.length / FR) }, (_, k) => frameE(x, k));
// nível "ativo": média dos quadros a menos de 40 dB do mais forte (não conta silêncio)
const activeDb = (x) => { const f = frames(x), mx = Math.max(...f), a = f.filter(e => e > mx * 1e-4); return db(a.reduce((s, e) => s + e, 0) / a.length); };
const scaleTo = (x, target) => { const a = activeDb(x); if (!Number.isFinite(a)) throw new Error('trecho sem som'); const g = 10 ** ((target - a) / 20); return x.map(v => v * g); };
const add = (dst, src, at, g = 1) => { for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * g; };
const fade = (x, ms) => { const n = Math.round(ms * SR / 1000); for (let i = 0; i < n && i < x.length; i++) { const g = i / n; x[i] *= g; x[x.length - 1 - i] *= g; } return x; };
const pink = (n, target) => { let b0 = 0, b1 = 0, b2 = 0; const x = new Float32Array(n); for (let i = 0; i < n; i++) { const w = rnd(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; x[i] = b0 + b1 + b2 + w * 0.1848; } return scaleTo(x, target); };
const fan = (n, target) => { const x = pink(n, 0); let lp = 0; for (let i = 0; i < n; i++) { lp += (x[i] - lp) * 0.08; const t = i / SR; x[i] = lp + 0.04 * Math.sin(2 * Math.PI * 118 * t) * (1 + 0.2 * Math.sin(2 * Math.PI * 0.7 * t)); } return scaleTo(x, target); };
// sala (Schroeder: 4 pentes + 2 passa-tudo) — voz distante: pouco som direto e muita reflexão
function room(x, wet = 0.8, dry = 0.35) {
  const combs = [1557, 1617, 1491, 1422].map(d => ({ b: new Float32Array(d), i: 0, f: 0.8 })), aps = [225, 556].map(d => ({ b: new Float32Array(d), i: 0 }));
  const y = new Float32Array(x.length); let lp = 0;
  for (let n = 0; n < x.length; n++) {
    let s = 0; for (const c of combs) { const o = c.b[c.i]; c.b[c.i] = x[n] + o * c.f; c.i = (c.i + 1) % c.b.length; s += o; }
    for (const a of aps) { const o = a.b[a.i], v = s + o * 0.5; a.b[a.i] = v; a.i = (a.i + 1) % a.b.length; s = o - v * 0.5; }
    lp += (s - lp) * 0.35; y[n] = dry * x[n] + wet * 0.25 * lp;
  }
  return y;
}
// fala: frases separadas por pausas; devolve a trilha e os trechos [início, fim] de cada frase
function talk(ids, gaps, level, lead = 1.5) {
  const parts = ids.map(i => scaleTo(load(`clnsp${i}`), level));
  const total = Math.round((lead + parts.reduce((s, p) => s + p.length / SR, 0) + gaps.reduce((s, g) => s + g, 0) + 1.5) * SR);
  const x = new Float32Array(total), segs = []; let at = Math.round(lead * SR);
  parts.forEach((p, i) => { add(x, p, at); segs.push([at, at + p.length]); at += p.length + Math.round((gaps[i] ?? 0) * SR); });
  return { x, segs };
}
// trecho de um som: começa no 1º quadro com som (os clipes do ESC-50 têm silêncio em volta)
const clip = (n, secs, level, fadeMs = 40) => {
  const c = load(n), f = frames(c), mx = Math.max(...f), k0 = Math.max(0, f.findIndex(e => e > mx * 1e-3) - 2);
  return fade(scaleTo(c.slice(k0 * FR, Math.min(c.length, k0 * FR + Math.round(secs * SR))), level), fadeMs);
};

// ---------- cenários ----------
const SPEECH_DB = -26;
const SCEN = {
  latido_silencio: () => { // latidos só nas pausas
    const t = talk([1, 2, 3], [3.5, 3.5], SPEECH_DB, 3), n = new Float32Array(t.x.length);
    add(n, clip(DOG[0], 2, -22), Math.round(0.6 * SR));
    t.segs.slice(0, -1).forEach(([, e], i) => add(n, clip(DOG[(i + 1) % DOG.length], 2.2, -22), e + Math.round(0.6 * SR)));
    return { s: t.x, n, desc: 'latidos de cachorro (-22 dBFS) durante o silêncio' };
  },
  moto_silencio: () => { // escapamento nas pausas
    const t = talk([5, 8, 12], [4, 4], SPEECH_DB, 3.5), n = new Float32Array(t.x.length);
    add(n, clip(ENGINE[0], 2.6, -20, 300), Math.round(0.4 * SR));
    t.segs.slice(0, -1).forEach(([, e], i) => add(n, clip(ENGINE[(i + 1) % ENGINE.length], 3, -20, 300), e + Math.round(0.5 * SR)));
    return { s: t.x, n, desc: 'motor/escapamento alto (-20 dBFS) durante o silêncio' };
  },
  moto_fala: () => { // moto passando enquanto fala: sobe, passa (-16 dBFS no pico) e some
    const t = talk([20, 30, 50], [0.6, 0.6], SPEECH_DB), n = new Float32Array(t.x.length);
    const eng = new Float32Array(Math.round(12 * SR)); for (let k = 0; k < 4; k++) add(eng, fade(load(ENGINE[k]).slice(0, Math.round(3.2 * SR)), 200), Math.round(k * 2.9 * SR));
    const g = scaleTo(eng, -16); for (let i = 0; i < g.length; i++) { const u = (i / g.length - 0.5) / 0.22; g[i] *= Math.exp(-u * u); }
    add(n, g, t.segs[0][0] + Math.round(2 * SR));
    return { s: t.x, n, desc: 'moto passando (pico -16 dBFS) enquanto fala' };
  },
  latido_fala: () => {
    const t = talk([1, 5, 12], [0.6, 0.6], SPEECH_DB), n = new Float32Array(t.x.length);
    t.segs.forEach(([a, e], i) => add(n, clip(DOG[i % DOG.length], 1.5, -22), Math.round((a + e) / 2)));
    return { s: t.x, n, desc: 'latidos (-22 dBFS) por cima da fala' };
  },
  voz_baixa: () => { // longe do microfone: baixa e com eco de sala, ar ambiente por baixo
    const t = talk([2, 8], [2.5], -40);
    const s = scaleTo(room(t.x), -42), n = pink(s.length, -66);
    return { s, n, dry: t.x, desc: 'voz baixa e distante (-42 dBFS, com sala) e ar ambiente (-66)' };
  },
  fala_pausas: () => {
    const t = talk([3, 8, 12, 20], [0.35, 0.9, 1.6], SPEECH_DB);
    return { s: t.x, n: pink(t.x.length, -68), desc: 'fala normal com pausas curtas e longas, sala quieta' };
  },
  aparelho_ambiente: () => { // gravação real de aparelho ligado (aspirador, longe: -50 dBFS) o tempo todo
    const t = talk([30, 50], [3], SPEECH_DB), n = new Float32Array(t.x.length);
    for (let at = 0, k = 0; at < n.length; at += Math.round(4.8 * SR), k++) add(n, clip(VACUUM[k % VACUUM.length], 5, -50, 100), at);
    return { s: t.x, n, desc: 'aparelho ligado no cômodo (aspirador gravado, -50 dBFS)' };
  },
  // voz de outra pessoa no cômodo ao lado (mãe, namorada): mais baixa, com eco de sala, nas suas pausas
  voz_fundo_fem: () => {
    const t = talk([1, 5, 8], [3.5, 3.5], SPEECH_DB, 3), n = new Float32Array(t.x.length);
    const bg = [2, 7, 11, 15, 16].map(i => scaleTo(room(load(`clnsp${i}`).slice(0, Math.round(3 * SR)), 0.8, 0.5), -40));
    add(n, bg[0], Math.round(0.2 * SR)); t.segs.slice(0, -1).forEach(([, e], i) => add(n, bg[i + 1], e + Math.round(0.3 * SR)));
    return { s: t.x, n, desc: 'voz feminina de fundo (-40 dBFS, outro cômodo) nas pausas' };
  },
  voz_fundo_masc: () => { // mesma situação, voz de fundo também masculina: só o volume separa
    const t = talk([1, 5, 8], [3.5, 3.5], SPEECH_DB, 3), n = new Float32Array(t.x.length);
    const bg = [9, 21, 23, 4].map(i => scaleTo(room(load(`clnsp${i}`).slice(0, Math.round(3 * SR)), 0.8, 0.5), -40));
    add(n, bg[0], Math.round(0.2 * SR)); t.segs.slice(0, -1).forEach(([, e], i) => add(n, bg[i + 1], e + Math.round(0.3 * SR)));
    return { s: t.x, n, desc: 'voz masculina de fundo (-40 dBFS, outro cômodo) nas pausas' };
  },
  voz_fem_dona: () => { // quem fala no microfone é mulher e a voz de fundo, homem
    const t = talk([3, 16, 22], [3.5, 3.5], SPEECH_DB, 3), n = new Float32Array(t.x.length);
    const bg = [9, 21, 23, 4].map(i => scaleTo(room(load(`clnsp${i}`).slice(0, Math.round(3 * SR)), 0.8, 0.5), -38));
    add(n, bg[0], Math.round(0.2 * SR)); t.segs.slice(0, -1).forEach(([, e], i) => add(n, bg[i + 1], e + Math.round(0.3 * SR)));
    return { s: t.x, n, desc: 'você com voz feminina; voz masculina de fundo (-38 dBFS)' };
  },
  teclado_ventilador: () => {
    const t = talk([30, 50], [3], SPEECH_DB), n = fan(t.x.length, -50);
    for (let at = Math.round(0.3 * SR), k = 0; at < n.length; at += Math.round(4.6 * SR), k++) add(n, clip(KEYS[k % KEYS.length], 4.5, -34, 20), at);
    return { s: t.x, n, desc: 'teclado (-34 dBFS) o tempo todo e ventilador (-50)' };
  },
};
const ONLY = process.env.ONLY?.split(',');
const scen = Object.entries(SCEN).filter(([k]) => !ONLY || ONLY.includes(k)).map(([name, f]) => {
  const r = f(); const mix = new Float32Array(r.s.length); for (let i = 0; i < mix.length; i++) mix[i] = r.s[i] + r.n[i];
  let peak = 0; for (const v of mix) peak = Math.max(peak, Math.abs(v)); if (peak > 0.99) { const g = 0.99 / peak; for (const a of [mix, r.s, r.n]) for (let i = 0; i < a.length; i++) a[i] *= g; }
  return { name, ...r, mix };
});

// ---------- cadeias ----------
const CHAINS = {
  'rnnoise': { noiseMode: 'rnnoise', vadGate: false },
  'rnnoise+porta': { noiseMode: 'rnnoise', vadGate: false, gate: true, gateDb: -45 },
  'rnnoise+voz': { noiseMode: 'rnnoise', vadGate: true, vadSens: SENS, vadParams: PARAMS, voiceLock: false },
  'rnnoise+trava': { noiseMode: 'rnnoise', vadGate: true, vadSens: SENS, vadParams: PARAMS },
  'gtcrn': { noiseMode: 'gtcrn', vadGate: false },
  'gtcrn+voz': { noiseMode: 'gtcrn', vadGate: true, vadSens: SENS, vadParams: PARAMS, voiceLock: false },
  'gtcrn+trava': { noiseMode: 'gtcrn', vadGate: true, vadSens: SENS, vadParams: PARAMS },
};
if (process.env.CHAINS) { const keep = process.env.CHAINS.split(','); for (const c of Object.keys(CHAINS)) if (!keep.includes(c) && !keep.includes(c.split('+')[0])) delete CHAINS[c]; }
const BASEOF = Object.fromEntries(Object.keys(CHAINS).map(c => [c, c.split('+')[0]]));

const BASE = await ownServer('noisebench', 3341, 41320);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('  PAGEERROR', e.message));
page.on('console', m => { if (/error|warn/i.test(m.type())) console.log('  console', m.text()); });
const blobs = new Map();
await page.setRequestInterception(true);
page.on('request', (r) => { const m = r.url().match(/\/__bench\/(\w+)$/); if (m && blobs.has(m[1])) r.respond({ status: 200, contentType: 'application/octet-stream', body: blobs.get(m[1]) }); else r.continue(); });
await page.goto(BASE + '/vendor/ns/LICENSE');
await page.evaluate(async () => { window.V = await import('/voice.js'); });
const START = 1024; // amostras: o áudio começa depois que os modelos carregaram (renderização pausada antes)
async function render(id, x, prefs) {
  blobs.set(id, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  const r = await page.evaluate(async (id, prefs, START) => {
    const buf = new Float32Array(await (await fetch('/__bench/' + id)).arrayBuffer());
    const ctx = new OfflineAudioContext(1, buf.length + START + 9600, 48000);
    const ab = ctx.createBuffer(1, buf.length, 48000); ab.copyToChannel(buf, 0);
    const src = ctx.createBufferSource(); src.buffer = ab;
    const out = await window.V.buildChain(ctx, src, { ...prefs, vadDebug: true });
    if (out.error) throw new Error(out.error);
    out.last.connect(ctx.destination); src.start(START / 48000);
    let t0 = 0;
    ctx.suspend(256 / 48000).then(async () => { await new Promise(r => setTimeout(r, 700)); t0 = performance.now(); ctx.resume(); });
    const res = await ctx.startRendering(); const ms = performance.now() - t0;
    let stats = null;
    if (out.vadGate) stats = await new Promise((ok) => { out.vadGate.port.onmessage = (e) => e.data?.stats !== undefined && ok(e.data); out.vadGate.port.postMessage('stats'); setTimeout(() => ok(null), 3000); });
    const y = res.getChannelData(0), bytes = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), ms, underruns: stats?.underruns ?? null, latency: stats?.latency ?? null, dbg: stats?.stats };
  }, id, prefs, START);
  blobs.delete(id);
  const b = Buffer.from(r.b64, 'base64'); return { y: new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(START), ms: r.ms, underruns: r.underruns, dbg: r.dbg };
}
// atraso da cadeia: melhor correlação entre entrada e saída (até 100 ms)
function lagOf(x, y) {
  const a = Math.round(2 * SR), len = Math.round(4 * SR); let best = 0, bl = 0;
  for (let l = 0; l <= 4800; l++) { let s = 0, e = 0; for (let i = a; i < a + len; i += 2) { s += x[i] * y[i + l]; e += y[i + l] * y[i + l]; } const c = s / Math.sqrt(e + 1e-12); if (c > best) { best = c; bl = l; } }
  return bl;
}
const shift = (y, l, n) => { const o = new Float32Array(n); o.set(y.subarray(l, l + n)); return o; };

// latência de cada cadeia (fala quase limpa)
const latRef = scen.find(s => s.name === 'fala_pausas') || scen[0];
const LAT = {};
for (const [c, prefs] of Object.entries(CHAINS)) LAT[c] = lagOf(latRef.mix, (await render('lat', latRef.mix, prefs)).y);
console.log('latência (ms):', Object.fromEntries(Object.entries(LAT).map(([c, l]) => [c, +(l / 48).toFixed(1)])));

const DIAGLOG = [];
const RES = {}, cpu = Object.fromEntries(Object.keys(CHAINS).map(c => [c, { ms: 0, secs: 0 }]));
for (const S of scen) {
  const N = S.mix.length, out = {}, ref = {}, DBG = {};
  for (const [c, prefs] of Object.entries(CHAINS)) {
    const r = await render('mix', S.mix, prefs); out[c] = shift(r.y, LAT[c], N); if (r.dbg) DBG[c] = r.dbg; cpu[c].ms += r.ms; cpu[c].secs += N / SR;
    if (r.underruns) console.log(`  AVISO ${c} faltou amostra ${r.underruns}x`);
    if (process.env.WAV) wav(`${CACHE}/out/${S.name}-${c}.wav`, out[c]);
  }
  for (const b of new Set(Object.values(BASEOF))) ref[b] = shift((await render('ref', S.s, CHAINS[b])).y, LAT[b], N); // voz limpa pela cadeia antiga
  if (process.env.WAV) { wav(`${CACHE}/out/${S.name}-0entrada.wav`, S.mix); }
  // rótulos (quadros de 10 ms)
  const K = Math.floor(N / FR), dry = S.dry || S.s, dryF = frames(dry), sLvl = activeDb(dry);
  const sp = dryF.map(e => db(e) > sLvl - 35);
  const near = sp.map((_, k) => sp.slice(Math.max(0, k - 10), k + 11).some(Boolean));
  const nF = frames(S.n), nLvl = activeDb(S.n), nEv = nF.map(e => db(e) > Math.max(nLvl - 25, -62));
  const quiet = (() => { const v = sp.map((x, k) => (x ? dryF[k] : Infinity)).filter(Number.isFinite).sort((a, b) => a - b); return v[Math.floor(v.length * 0.2)]; })();
  const onsets = [], offsets = [];
  for (let k = 20; k < K - 20; k++) { if (sp[k] && !sp.slice(k - 20, k).some(Boolean)) onsets.push(k); if (sp[k] && !sp.slice(k + 1, k + 21).some(Boolean)) offsets.push(k); }
  const mixF = frames(S.mix), sF = frames(S.s), nnF = frames(S.n);
  const sum = (arr, pred) => arr.reduce((s, e, k) => s + (pred(k) ? e : 0), 0);
  const noiseOnly = (k) => !near[k] && nEv[k];
  const R = (RES[S.name] = { desc: S.desc, frames: { fala: sp.filter(Boolean).length, ruidoNaPausa: sp.map((_, k) => noiseOnly(k)).filter(Boolean).length, inicios: onsets.length } , input: {
    ruidoPausaDb: +db(sum(mixF, noiseOnly) / Math.max(1, sp.filter((_, k) => noiseOnly(k)).length)).toFixed(1),
    snrFalaDb: +db(sum(sF, k => sp[k]) / Math.max(1e-15, sum(nnF, k => sp[k]))).toFixed(1) }, cadeias: {} });
  for (const c of Object.keys(CHAINS)) {
    const yF = frames(out[c]), oF = frames(out[BASEOF[c]]), rF = ref[BASEOF[c]];
    const nNo = sp.filter((_, k) => noiseOnly(k)).length || 1;
    const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = out[c][i] - rF[i];
    const dF = frames(d), refF = frames(rF);
    const ratio = (pred) => +db(sum(yF, pred) / Math.max(1e-15, sum(oF, pred))).toFixed(1);
    // só conta o que a cadeia antiga entregava audível (> -60 dBFS): perder o que o próprio filtro já apagava não é perda
    const perSeg = (ks, len) => ks.map(k0 => { let a = 0, b = 0; for (let k = k0; k < k0 + len; k++) if (db(oF[k] || 0) > -60) { a += yF[k] || 0; b += oF[k] || 0; } return b > 0 ? db(a / b) : null; });
    const onRaw = perSeg(onsets, 5), on = onRaw.filter(v => v != null), off = perSeg(offsets.map(k => k - 9), 10).filter(v => v != null);
    if (process.env.DIAG && DBG[c] && c === (process.env.DIAGC || "rnnoise+trava") && on.length) { // os piores inícios: probabilidade de voz e porta, quadro a quadro
      const d0 = Math.round(START / FR);
      for (const i of onRaw.map((v, i) => [v, i]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]).slice(0, 4).map(x => x[1])) {
        const k0 = onsets[i]; DIAGLOG.push(`   ${c} início em ${(k0 / 100).toFixed(2)}s perda ${onRaw[i].toFixed(1)} dB  ruído ${DBG[c].noise[k0 + d0]?.toFixed(0)}`);
        DIAGLOG.push('     vad  ' + Array.from({ length: 16 }, (_, j) => (DBG[c].vad[k0 + d0 - 6 + j] ?? 0).toFixed(2)).join(' '));
        DIAGLOG.push('     lvl  ' + Array.from({ length: 16 }, (_, j) => String(Math.round(DBG[c].lvl[k0 + d0 - 6 + j] ?? 0)).padStart(4)).join(' '));
        DIAGLOG.push('     seco ' + Array.from({ length: 16 }, (_, j) => String(Math.round(db(dryF[k0 - 6 + j]))).padStart(4)).join(' '));
        DIAGLOG.push('     open ' + Array.from({ length: 16 }, (_, j) => String(DBG[c].open[k0 + d0 - 6 + j] ?? '-').padStart(4)).join(' '));
      }
    }
    if (process.env.DIAG && DBG[c] && c === (process.env.DIAGC || "rnnoise+trava")) { // probabilidade de voz nos quadros de ruído sem fala
      const d0 = Math.round(START / FR);
      const v = sp.map((_, k) => (noiseOnly(k) ? DBG[c].vad[k + d0] : null)).filter(x => x != null), hi = (t) => (100 * v.filter(x => x >= t).length / (v.length || 1)).toFixed(1);
      const lo = sp.map((_, k) => (noiseOnly(k) ? DBG[c].low[k + d0] : null)).filter(x => x != null).sort((a, b) => a - b);
      DIAGLOG.push(`   ${c} vad no ruído: >=0.3 ${hi(0.3)}%  >=0.5 ${hi(0.5)}%  >=0.7 ${hi(0.7)}%  >=0.9 ${hi(0.9)}%   graves (mediana) ${lo[lo.length >> 1]?.toFixed(2)}`);
      const sv = sp.map((x, k) => (x ? DBG[c].low[k + d0] : null)).filter(x => x != null).sort((a, b) => a - b);
      const stc = (pred) => { const a = sp.map((_, k) => (pred(k) ? DBG[c].st[k + d0] : null)).filter(x => x != null); return ['fechada', 'aberta', 'segurando', 'provisória'].map((n, i) => `${n} ${(100 * a.filter(x => x === i).length / (a.length || 1)).toFixed(1)}%`).join('  '); };
      DIAGLOG.push(`   ${c} estado no ruído sem fala: ${stc(noiseOnly)}`);
      DIAGLOG.push(`   ${c} estado na fala:           ${stc(k => sp[k])}`);
      const cut = sp.map((x, k) => (x && DBG[c].st[k + d0] === 0 ? k : null)).filter(x => x != null);
      if (cut.length) { const vv = cut.map(k => DBG[c].vad[k + d0]).sort((a, b) => a - b), mm = cut.map(k => DBG[c].lvl[k + d0] - DBG[c].noise[k + d0]).sort((a, b) => a - b);
        const hh = cut.map(k => DBG[c].hf[k + d0]).sort((a, b) => a - b);
        DIAGLOG.push(`   ${c} fala com porta fechada (${cut.length} quadros): agudos mediana ${hh[hh.length >> 1].toFixed(2)}; vad mediana ${vv[vv.length >> 1].toFixed(2)} p75 ${vv[Math.floor(vv.length * .75)].toFixed(2)}; nível-fundo mediana ${mm[mm.length >> 1].toFixed(1)} dB p25 ${mm[Math.floor(mm.length * .25)].toFixed(1)}`); }
      DIAGLOG.push(`   ${c} graves na fala (mediana) ${sv[sv.length >> 1]?.toFixed(2)}  p90 ${sv[Math.floor(sv.length * 0.9)]?.toFixed(2)}`);
    }
    R.cadeias[c] = {
      ruidoPassaDb: +db(sum(yF, noiseOnly) / Math.max(1e-15, sum(mixF, noiseOnly))).toFixed(1),       // atenuação do ruído nas pausas
      ruidoNivelDb: +db(sum(yF, noiseOnly) / nNo).toFixed(1),                                           // nível que sobra (dBFS)
      ruidoAudivelPct: +(100 * sp.filter((_, k) => noiseOnly(k) && db(yF[k]) > -55).length / nNo).toFixed(1),
      portaAbertaPct: c.includes('+') ? +(100 * sp.filter((_, k) => noiseOnly(k) && db(oF[k]) > -60 && yF[k] > oF[k] * 0.25).length / nNo).toFixed(1) : null,
      vozDb: ratio(k => sp[k]),                                                                        // voz em relação à cadeia antiga
      vozBaixaDb: ratio(k => sp[k] && dryF[k] <= quiet),
      vozCortadaPct: +(100 * sp.filter((x, k) => x && db(oF[k]) > -70 && yF[k] < oF[k] * 0.25).length / Math.max(1, sp.filter(Boolean).length)).toFixed(2),
      inicioDb: on.length ? +(on.reduce((a, b) => a + b, 0) / on.length).toFixed(1) : null, inicioPiorDb: on.length ? +Math.min(...on).toFixed(1) : null,
      fimDb: off.length ? +(off.reduce((a, b) => a + b, 0) / off.length).toFixed(1) : null, fimPiorDb: off.length ? +Math.min(...off).toFixed(1) : null,
      snrFalaDb: +db(sum(refF, k => sp[k]) / Math.max(1e-15, sum(dF, k => sp[k]))).toFixed(1),       // voz/ruído na saída durante a fala
    };
  }
  console.log(`\n== ${S.name}: ${S.desc}`); if (DIAGLOG.length) { console.log(DIAGLOG.join('\n')); DIAGLOG.length = 0; }
  console.log(`   entrada: ruído nas pausas ${R.input.ruidoPausaDb} dBFS, voz/ruído durante a fala ${R.input.snrFalaDb} dB  (${R.frames.ruidoNaPausa} quadros de ruído na pausa, ${R.frames.inicios} inícios de fala)`);
  console.log('   cadeia           ruído passa  sobra dBFS  audível%  porta abre%  voz dB  voz baixa  cortada%  início(pior)   fim(pior)    voz/ruído na fala');
  for (const [c, m] of Object.entries(R.cadeias)) console.log(`   ${c.padEnd(16)} ${String(m.ruidoPassaDb).padStart(9)}  ${String(m.ruidoNivelDb).padStart(10)}  ${String(m.ruidoAudivelPct).padStart(8)}  ${String(m.portaAbertaPct ?? '—').padStart(11)}  ${String(m.vozDb).padStart(6)}  ${String(m.vozBaixaDb).padStart(9)}  ${String(m.vozCortadaPct).padStart(8)}  ${`${m.inicioDb}(${m.inicioPiorDb})`.padStart(12)}  ${`${m.fimDb}(${m.fimPiorDb})`.padStart(10)}  ${String(m.snrFalaDb).padStart(8)}`);
}
const CPU = Object.fromEntries(Object.entries(cpu).map(([c, v]) => [c, +(100 * v.ms / 1000 / v.secs).toFixed(2)]));
console.log('\nCPU (renderização offline, % de um núcleo por segundo de áudio — a cadeia inteira):', CPU);
console.log('latência (ms):', Object.fromEntries(Object.entries(LAT).map(([c, l]) => [c, +(l / 48).toFixed(1)])));
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ sens: SENS, latenciaMs: Object.fromEntries(Object.entries(LAT).map(([c, l]) => [c, +(l / 48).toFixed(1)])), cpuPct: CPU, cenarios: RES }, null, 1));
await browser.close(); process.exit(0);

function wav(file, x) {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
  const pcm = new Int16Array(x.length); for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length * 2, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length * 2, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(pcm.buffer)]));
}
