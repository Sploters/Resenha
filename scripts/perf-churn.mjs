// Servidor grande com gente entrando, saindo e mudando de status: quanto custa para quem está com a lista de membros
// aberta? Banco do scripts/load/seed.mjs (N pessoas no mesmo servidor). Mede, durante SECS segundos de "agitação"
// (pessoas conectando/desconectando ~RATE vezes por segundo), a thread principal da página: CPU, layout, estilo, script.
// Uso: DATA_DIR=./.testdata-churn node scripts/load/seed.mjs 300 && node scripts/perf-churn.mjs [rótulo]   (PROFILE=1: funções mais caras; CPU=4: PC fraco)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = +(process.env.PORT || 3292), BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-churn';
const SECS = +(process.env.SECS || 15), RATE = +(process.env.RATE || 6), CPU = +(process.env.CPU || 1), LABEL = process.argv[2] || 'atual';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const meta = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const R = { label: LABEL, members: meta.n, rate: RATE, cpuThrottle: CPU };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const socks = new Map();
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'load-0'; });
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 90000 });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), meta.guild, meta.channels[0]); await sleep(3000);
  // metade já online
  const open = (i) => new Promise((res) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=load-' + i); ws.on('open', () => res(ws)); ws.on('error', () => res(null)); ws.on('message', () => { }); socks.set(i, ws); });
  for (let i = 1; i < meta.n; i += 2) await open(i);
  await sleep(3000);
  const cdp = await p.createCDPSession(); await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const a = await m(); let events = 0; const t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) { // alterna alguém: conecta quem está fora, desconecta quem está dentro
    const i = 1 + Math.floor(Math.random() * (meta.n - 1)), ws = socks.get(i);
    if (ws && ws.readyState === 1) { ws.close(); socks.delete(i); } else open(i);
    events++; await sleep(1000 / RATE);
  }
  if (process.env.PROFILE) { const { profile } = await cdp.send('Profiler.stop'); const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])), dt = profile.timeDeltas; const tot = {};
    profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + f.url.split('/').pop().split('?')[0] + ':' + (f.lineNumber + 1); tot[k] = (tot[k] || 0) + (dt[i] || 0); });
    R.topSelf = Object.entries(tot).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, v]) => (v / 1e4 / SECS).toFixed(2) + '% ' + k); }
  const b = await m(), d = (k) => +((b[k] - a[k]) / SECS * 100).toFixed(1);
  R.mainCpuPct = d('TaskDuration'); R.layoutPct = d('LayoutDuration'); R.stylePct = d('RecalcStyleDuration'); R.scriptPct = d('ScriptDuration');
  // correção: a lista atualizada aos pedaços tem que ser igual a uma montada do zero
  await sleep(1500); if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const snap = () => p.evaluate(() => document.querySelector('#members .mem-list')?.innerHTML || '');
  const inc = await snap();
  await p.evaluate((gid, cid) => { document.querySelector('#members')?.replaceChildren(); window.__lc.go(gid, cid); }, meta.guild, meta.channels[1]); await sleep(1500);
  R.sameAsFresh = inc === await snap(); R.rows = await p.evaluate(() => document.querySelectorAll('#members .mem').length);
  R.layoutsPerS = +((b.LayoutCount - a.LayoutCount) / SECS).toFixed(1); R.events = events; R.nodes = b.Nodes;
} catch (e) { R.error = String(e.stack || e); }
finally {
  for (const ws of socks.values()) try { ws.close(); } catch { }
  await browser.close(); srv.kill();
  fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync(`.testshots/churn-${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R)); setTimeout(() => process.exit(0), 300);
}
