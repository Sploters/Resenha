// Benchmark (não é teste da suíte: o resultado depende do processador da máquina). ana transmite 1080p60 pelo Chromium
// (conteúdo que muda todo quadro, codificador por software no Linux sem GPU), beto assiste. A cada 3 s: o que o controle
// da transmissão decidiu (public/voice.js govTick), o que chega ao espectador e cada camada enviada (fps, kbps, limite).
// Uso: node scripts/screen-cpu-bench.mjs   (SECS=45)
//   ONE=1    uma camada só desde o início (sem simulcast)
//   OFF=1    desliga as camadas leves 3 s depois de começar (active:false), como o controle faz
//   FIX=1.5,60,maintain-resolution   desliga o controle e fixa escala, fps e preferência de degradação
//   LOWPREF=1  quem assiste pede a camada "Baixa"
// Resultados de 2026-11-15 em docs/historico/FASE2-CAPTURA.md.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3341, BASE = `http://localhost:${PORT}`, DATA = process.env.DATA || './.testdata-screenbench', SECS = +(process.env.SECS || 45);
const EXE = process.env.BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41340', RTC_IPS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const srvLog = []; srv.stdout.on('data', d => srvLog.push(String(d))); srv.stderr.on('data', d => srvLog.push(String(d)));
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
async function session(tok) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.evaluateOnNewDocument((t) => {
    localStorage.lc_token = t;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); let n = 0;
      setInterval(() => { n++; for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${(n * 7 + i * 31) % 360} 70% ${30 + (i * 13 + n) % 40}%)`; x.fillRect((i * 197 + n * 23) % 1800, (i * 113 + n * 11) % 1000, 160, 120); } x.fillStyle = '#fff'; x.font = '80px sans-serif'; x.fillText(String(n), 900, 540); }, 16);
      return c.captureStream(60);
    };
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
  return p;
}
const ra = await api('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' }), rb = await api('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' });
const g = await api(ra.token, 'POST', '/guilds', { name: 'Live' }); const inv = await api(ra.token, 'POST', `/guilds/${g.id}/invites`); await api(rb.token, 'POST', `/invites/${inv.code}`);
const A = await session(ra.token), B = await session(rb.token);
const aid = await A.evaluate(() => window.__lc.S.me.id);
const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2), g.id);
for (const p of [A, B]) { await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(500); await p.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(b => /Entrar/.test(b.textContent))?.click()); }
await sleep(3000);
await A.evaluate((one) => { if (one) { const v = window.__lc.voice, f = v.sfuEncodings.bind(v); v.sfuEncodings = (src, t) => src === 'screen' ? [f(src, t)[2]].map(({ rid, scaleResolutionDownBy, ...e }) => e) : f(src, t); } }, !!process.env.ONE);
await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 1080, fps: 60, audio: false, hint: 'motion' }));
if (process.env.DEG) await A.evaluate(async (d) => { const v = window.__lc.voice; await new Promise(r => setTimeout(r, 1200)); const s = v.sfu.producers.screen.rtpSender, prm = s.getParameters(); prm.degradationPreference = d; await s.setParameters(prm); v.sfuTuneScreen = async () => { }; }, process.env.DEG);
await sleep(1500);
await B.evaluate((uid) => { const v = window.__lc.voice; v.openStream?.(uid); }, aid);
if (process.env.OFF) { await sleep(3000); console.log('off', await A.evaluate(async () => { const s = window.__lc.voice.sfu.producers.screen.rtpSender, p = s.getParameters(); p.encodings.forEach((e, i) => { if (i < p.encodings.length - 1) e.active = false; }); await s.setParameters(p); return s.getParameters().encodings.map(e => e.active); })); }
if (process.env.FIX) { await sleep(1000); console.log('fix', await A.evaluate(async (fx) => { const v = window.__lc.voice; clearInterval(v._gt); v.gov = null; const [sc, fps, deg] = fx.split(','); const s = v.sfu.producers.screen.rtpSender, p = s.getParameters(), n = p.encodings.length; p.encodings.forEach((e, i) => { e.scaleResolutionDownBy = +sc * 2 ** (n - 1 - i); e.maxFramerate = +fps; if (i < n - 1) e.active = false; }); p.degradationPreference = deg; await s.setParameters(p); return s.getParameters().encodings.map(e => [e.active, e.scaleResolutionDownBy, e.maxFramerate]); }, process.env.FIX)); }
if (process.env.LOWPREF) { await sleep(1000); await B.evaluate((uid) => window.__lc.voice.setLayerPref(uid, 0), aid); }
const rows = [];
for (let t = 0; t <= SECS; t += 3) {
  await sleep(3000);
  const r = await B.evaluate((uid) => window.__lc.voice.streamStats(uid), aid);
  const s = await A.evaluate(() => window.__lc.voice.screenStats?.());
  const gv = await A.evaluate(() => { const g = window.__lc.voice.gov; return g ? `L${g.level}${g.layersOff ? ' off' : ''} ${g.note}` : null; });
  const row = { t: t + 3, gov: gv, enc: (s || [])[0]?.enc, recv: r ? `${r.w}x${r.h}@${r.fps} ${r.kbps}kbps loss${r.loss} layer${r.layer}` : null, send: (s || []).map(l => `${l.rid}:${l.w}x${l.h}@${l.fps} ${l.kbps}k ${l.limit}`).join(' | ') };
  rows.push(row); console.log(JSON.stringify(row));
}
await browser.close(); srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
const sfuLines = srvLog.join('').split('\n').filter(l => /bwe|SFU/i.test(l)).slice(-20); if (sfuLines.length) console.log(sfuLines.join('\n'));
process.exit(0);
