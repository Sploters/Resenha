// CPU de uma chamada de 2 pessoas por estado de quem é medido (A, navegador próprio): alterna os estados em rodadas e
// soma o tempo de CPU de TODOS os processos do Chromium de A (/proc), mais a thread de áudio da página (RNNoise/GTCRN).
// Uso: node scripts/perf-call-states.mjs   STATES=ligado,mutado,ensurdecido ROUNDS=2 SECS=15 NOISE=rnnoise|gtcrn|standard
//   WAV=voz.wav (opcional: voz de verdade no microfone falso) JSON=saida.json
//   Estado próprio: STATES="nome:() => { código na página }" (ex.: apertar-para-falar solto, ver docs/PROXIMOS-PASSOS.md)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { threads, diff, pct } from './proc-cpu.mjs';
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', PORT = 3265, BASE = `http://localhost:${PORT}`;
const SECS = +(process.env.SECS || 15), ROUNDS = +(process.env.ROUNDS || 2), NOISE = process.env.NOISE || 'rnnoise';
const STATES = (process.env.STATES || 'ligado,mutado').split(',');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-callbench', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-callbench', RTC_PORT: '41090', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const WAV = process.env.WAV; // gravação de voz (WAV); sem ela, o bipe do microfone falso do Chromium
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(WAV ? ['--use-file-for-fake-audio-capture=' + WAV] : []), '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bO = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const root = bA.process().pid;
async function open(browser, tok) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t, noise) => { localStorage.lc_token = t; window.__noise = noise; }, tok, NOISE);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; }
const R = { noise: NOISE, secs: SECS, rounds: ROUNDS, states: {} };
const SET = {
  ligado: async (A) => { await A.evaluate(() => { const v = window.__lc.voice; if (v.muted) v.toggleMute(); }); },
  mutado: async (A) => { await A.evaluate(() => { const v = window.__lc.voice; if (!v.muted) v.toggleMute(); }); },
  ensurdecido: async (A) => { await A.evaluate(() => { const v = window.__lc.voice; if (!v.deafened) v.toggleDeaf(); }); },
};
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'T' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + inv);
  const A = await open(bA, a.tok), B = await open(bO, b.tok);
  for (const P of [A, B]) await P.evaluate((n) => { window.__lc.S.prefs.noiseMode = n; }, NOISE);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  R.info = await A.evaluate(() => { const v = window.__lc.voice; return { noise: v.prefs?.noiseMode, gate: !!v.micGraph?.vadGate, processed: v.micGraph?.processed }; });
  await sleep(3000);
  for (let r = 0; r < ROUNDS; r++) for (const st of STATES) {
    if (SET[st]) await SET[st](A); else await A.evaluate(new Function('return (' + st.slice(st.indexOf(':') + 1) + ')()'));
    await sleep(2500);
    const t0 = threads(root); await sleep(SECS * 1000); const c = pct(diff(t0, threads(root)), SECS, { audioWorklet: /Realtime AudioW/ });
    (R.states[st.split(':')[0]] ||= []).push({ total: c.total, worklet: c.audioWorklet }); if (process.env.TOP) console.log('    ', JSON.stringify(Object.entries(diff(t0, threads(root))).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, x]) => [k, +(x / SECS).toFixed(2)])));
    console.log(`  rodada ${r + 1} ${st.split(':')[0].padEnd(12)} total ${c.total}%  thread de áudio ${c.audioWorklet}%`);
  }
  await SET.ligado(A);
  R.avg = Object.fromEntries(Object.entries(R.states).map(([k, xs]) => [k, { total: +(xs.reduce((s, x) => s + x.total, 0) / xs.length).toFixed(2), worklet: +(xs.reduce((s, x) => s + x.worklet, 0) / xs.length).toFixed(2) }]));
} catch (e) { R.error = String(e.stack || e); console.log(R.error); }
finally { console.log(JSON.stringify({ info: R.info, avg: R.avg })); if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(R, null, 1)); await bA.close(); await bO.close(); srv.kill(); setTimeout(() => process.exit(0), 300); }
