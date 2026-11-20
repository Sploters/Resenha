// Custo para quem transmite (A, navegador próprio): recálculos de estilo/s, layouts/s, CPU da thread principal e de
// todos os processos, em rodadas, com B na chamada. Usado no selo AO VIVO e no detector de tela preta.
// Uso: node scripts/perf-streamer.mjs   ROUNDS=2 SECS=15 JSON=saida.json
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { threads, diff, pct } from './proc-cpu.mjs';
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', PORT = 3266, BASE = `http://localhost:${PORT}`, SECS = +(process.env.SECS || 15), ROUNDS = +(process.env.ROUNDS || 2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-livebench', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-livebench', RTC_PORT: '41100', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const root = bA.process().pid;
async function open(browser, tok) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false }); }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; }
const R = { rounds: [] };
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'T' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + inv);
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await A.waitForFunction(() => document.querySelector(".live-dot"), { timeout: 15000 }).catch(() => { });
  await sleep(4000);
  const cdp = await A.createCDPSession(); await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  R.liveDots = await A.evaluate(() => document.querySelectorAll('.live-dot').length);
  R.anims = await A.evaluate(() => document.getAnimations().map(x => x.animationName + ' @ ' + x.effect?.target?.className + (x.effect?.pseudoElement || '')));
  for (let r = 0; r < ROUNDS; r++) {
    const m0 = await m(), t0 = threads(root); await sleep(SECS * 1000); const m1 = await m(), c = pct(diff(t0, threads(root)), SECS, { main: /^renderer \/ chrome$/, compositor: /Compositor|Viz/ });
    const x = { stylePerS: +((m1.RecalcStyleCount - m0.RecalcStyleCount) / SECS).toFixed(1), layoutPerS: +((m1.LayoutCount - m0.LayoutCount) / SECS).toFixed(1), mainTaskPct: +((m1.TaskDuration - m0.TaskDuration) / SECS * 100).toFixed(2), cpuTotal: c.total, cpuMain: c.main, cpuCompositor: c.compositor };
    R.rounds.push(x); console.log('  rodada', r + 1, JSON.stringify(x));
  }
} catch (e) { R.error = String(e.stack || e); console.log(R.error); }
finally { console.log(JSON.stringify({ liveDots: R.liveDots, anims: R.anims })); if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(R, null, 1)); await bA.close(); await bB.close(); srv.kill(); setTimeout(() => process.exit(0), 300); }
