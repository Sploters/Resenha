// CPU de quem transmite (A, navegador próprio; todos os processos do Chromium de A, /proc) com os clipes da própria
// transmissão ligados, pelo caminho do Chromium, em 3 modos alternados por rodada (a transmissão recomeça a cada troca):
//   semclipes: clipes desligados (referência)
//   rec: MediaRecorder comprimindo a tela de novo (o jeito antigo; forçado sem RTCRtpScriptTransform)
//   tap: os quadros que o enviador já comprimiu (voice.js ownTap)
// Uso: node scripts/perf-clip-own.mjs   ROUNDS=3 SECS=15 RES=720|1080
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
import { threads, diff, pct } from './proc-cpu.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', SECS = +(process.env.SECS || 15), ROUNDS = +(process.env.ROUNDS || 3), RES = +(process.env.RES || 720);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('perfclipown', 3278, 41142);
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const root = bA.process().pid;
async function open(browser, tok) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t, res) => { localStorage.lc_token = t; window.__RST = window.RTCRtpScriptTransform;
    navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: Math.round(res * 16 / 9), height: res, frameRate: 30 }, audio: false }); }, tok, RES);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; }
const MODES = ['semclipes', 'rec', 'tap'], out = Object.fromEntries(MODES.map(m => [m, []]));
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'T' }); await call(b.tok, 'POST', '/invites/' + (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code);
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  for (let r = 0; r < ROUNDS; r++) for (const mode of MODES) {
    await A.evaluate(async (mode, res) => {
      const v = window.__lc.voice; if (v.screen) { v.toggleScreen(); await new Promise(r => setTimeout(r, 1200)); }
      window.__lc.S.prefs.clipsOn = mode !== 'semclipes'; window.RTCRtpScriptTransform = mode === 'rec' ? undefined : window.__RST;
      await v.toggleScreen({ res, fps: 30, audio: false, hint: 'motion' });
    }, mode, RES);
    await sleep(5000);
    const info = await A.evaluate(async (uid) => (await window.__lc.import('clips.js')).clipInfo('s:' + uid)?.mode || 'nenhum', a.id);
    if (process.env.DEBUG) console.log(await A.evaluate(() => { const v = window.__lc.voice, t = v._ownTap; return JSON.stringify({ tap: !!t, codec: t?.codec, own: !!v.ownTap(), prodClosed: v.sfu?.producers.screen?.closed, native: !!v.native, clipsOn: window.__lc.S.prefs.clipsOn, rst: !!window.RTCRtpScriptTransform }); }));
    const t0 = threads(root); await sleep(SECS * 1000); const c = pct(diff(t0, threads(root)), SECS);
    out[mode].push(c.total); console.log(`  rodada ${r + 1} ${mode.padEnd(9)} buffer=${info.padEnd(6)} total ${c.total}%`);
  }
  const avg = (x) => +(x.reduce((s, v) => s + v, 0) / x.length).toFixed(2);
  console.log(JSON.stringify({ res: RES, secs: SECS, rounds: ROUNDS, media: Object.fromEntries(MODES.map(m => [m, avg(out[m])])) }));
} catch (e) { console.log('ERRO', e.stack || e.message); }
finally { await bA.close(); await bB.close(); process.exit(0); }
