// Memória de quem transmite ao iniciar e parar transmissões (etapa 3 da auditoria): A (navegador próprio, medido) e B
// na chamada; CYCLES ciclos de "transmite 720p30 por ON ms, para". Depois de cada ciclo: coleta de lixo, PSS por processo,
// heap JS, contadores do DOM, trilhas, conexões WebRTC e produtores. No fim: sai da chamada e simula pressão de memória
// (o que volta é cache). Uso: node scripts/perf-stream-memory.mjs   CYCLES=10 ON=5000 JSON=saida.json
//   DUMP=1: memória por alocador (memory-infra) · SNAPSHOT=1: heap snapshot · AWAY=1: A olhando o chat (sem prévia)
//   NOMETERS=meterBlack,meterCapture: desliga vigias da transmissão (bisseção) · MODE=capture: só captura, sem WebRTC
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', PORT = 3268, BASE = `http://localhost:${PORT}`;
const CYCLES = +(process.env.CYCLES || 20), ON = +(process.env.ON || 5000), WATCH = !!process.env.WATCH;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-mem', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-mem', RTC_PORT: '41120', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--js-flags=--expose-gc'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args }), bB = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const pssOf = (root) => { const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)), pp = new Map(); for (const p of all) { try { pp.set(+p, +fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1]); } catch { } }
  const kids = new Set([root]); let g = true; while (g) { g = false; for (const [p, q] of pp) if (kids.has(q) && !kids.has(p)) { kids.add(p); g = true; } }
  const out = {}; for (const pid of kids) { try { const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); const t = (cl.match(/--type=([\w-]+)/)?.[1] || 'browser') + (cl.match(/--utility-sub-type=([\w.]+)/)?.[1]?.replace(/.*\./, ':') || ''); const v = +fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/Pss:\s+(\d+)/)[1]; out[t] = (out[t] || 0) + v; } catch { } }
  for (const k in out) out[k] = Math.round(out[k] / 1024); return out; };
async function open(browser, tok) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
    const tracks = window.__tracks = new Set(); const keep = (s) => { for (const t of s.getTracks()) tracks.add(new WeakRef(t)); return s; };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => gum(c).then(keep);
    navigator.mediaDevices.getDisplayMedia = () => gum({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false }).then(keep);
    const pcs = window.__pcs = new Set(); const OPC = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new OPC(...a); pcs.add(new WeakRef(pc)); return pc; }; window.RTCPeerConnection.prototype = OPC.prototype; Object.setPrototypeOf(window.RTCPeerConnection, OPC);
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); return p; }

// despejo do memory-infra (todos os processos): tamanho por alocador de cada processo
async function memDump(browser) {
  const t = await browser.target().createCDPSession(); const evs = [];
  t.on('Tracing.dataCollected', (e) => evs.push(...e.value));
  const done = new Promise((r) => t.once('Tracing.tracingComplete', r));
  await t.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
  await t.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  await t.send('Tracing.end'); await done;
  const out = {};
  for (const e of evs) { const al = e.args?.dumps?.allocators; if (!al) continue; const per = {};
    for (const [k, v] of Object.entries(al)) { if (k.split('/').length !== 1) continue; const sz = v.attrs?.size?.value; if (sz) per[k] = Math.round(parseInt(sz, 16) / 1048576 * 10) / 10; }
    let ty = 'browser'; try { const cl = fs.readFileSync(`/proc/${e.pid}/cmdline`, 'utf8'); ty = (cl.match(/--type=([\w-]+)/)?.[1] || 'browser') + (cl.match(/--utility-sub-type=([\w.]+)/)?.[1]?.replace(/.*\./, ':') || ''); } catch { }
    out[ty + ':' + e.pid] = per; }
  return out;
}
const R = { cycles: [], dumps: {} };
try {
  const a = await reg('alice'), b = await reg('bruno');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'T' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code; await call(b.tok, 'POST', '/invites/' + inv);
  const A = await open(bA, a.tok), B = await open(bB, b.tok);
  const cdp = await A.createCDPSession(); await cdp.send('HeapProfiler.enable');
  const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await A.evaluate(() => window.gc?.()); await cdp.send('HeapProfiler.collectGarbage'); await sleep(1500); };
  const snap = async (label) => { await gc(); const dom = await cdp.send('Memory.getDOMCounters');
    const pg = await A.evaluate(() => { const v = window.__lc.voice, s = v?.sfu; let live = 0, ended = 0; for (const w of window.__tracks) { const t = w.deref(); if (!t) continue; t.readyState === 'live' ? live++ : ended++; }
      let pcOpen = 0, pcClosed = 0; for (const w of window.__pcs) { const pc = w.deref(); if (!pc) continue; pc.connectionState === 'closed' || pc.signalingState === 'closed' ? pcClosed++ : pcOpen++; }
      const tx = []; for (const w of window.__pcs) { const pc = w.deref(); if (!pc || pc.signalingState === 'closed') continue; const ts = pc.getTransceivers(); tx.push(ts.length + ':' + ts.filter(t => t.sender.track).length + 's/' + ts.filter(t => t.currentDirection === 'inactive' || t.stopped).length + 'i/' + (pc.localDescription?.sdp.match(/^m=/gm) || []).length + 'm'); }
      return { tx: tx.join(' '), heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2), tracksLive: live, tracksEnded: ended, pcOpen, pcClosed, producers: s ? Object.keys(s.producers || {}).length : null, consumers: s?.consumers?.size ?? null, videos: document.querySelectorAll('video').length }; });
    if (process.env.DUMP && /^(na-chamada|ciclo-10|ciclo-20|saiu\+30s|pressao)$/.test(label)) R.dumps[label] = await memDump(bA);
    const x = { label, pss: pssOf(bA.process().pid), ...pg, nodes: dom.nodes, docs: dom.documents, listeners: dom.jsEventListeners }; R.cycles.push(x);
    console.log(label.padEnd(14), 'renderer', x.pss.renderer, 'gpu', x.pss['gpu-process'], 'browser', x.pss.browser, 'heap', x.heapMB, 'tracks', x.tracksLive + '/' + x.tracksEnded, 'pc', x.pcOpen + '/' + x.pcClosed, 'prod', x.producers, 'cons', x.consumers, 'video', x.videos, 'nodes', x.nodes, 'tx', x.tx); };
  await snap('antes-chamada');
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B]) { await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 }); }
  if (process.env.AWAY) { const tch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id); await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); }
  if (process.env.NOMETERS) await A.evaluate((ms) => { const P = Object.getPrototypeOf(window.__lc.voice); for (const m of ms.split(',')) P[m] = function () { }; }, process.env.NOMETERS);
  await sleep(3000); await snap('na-chamada');
  for (let i = 1; i <= CYCLES; i++) {
    if (process.env.MODE === 'capture') await A.evaluate(() => navigator.mediaDevices.getDisplayMedia().then(s => { window.__cap = s; }));
    else await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
    if (WATCH && i === 1) { await B.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`), { timeout: 15000 }, a.id).catch(() => { }); await B.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), a.id); }
    await sleep(ON);
    if (process.env.MODE === 'capture') await A.evaluate(() => { window.__cap.getTracks().forEach(t => t.stop()); window.__cap = null; });
    else await A.evaluate(() => window.__lc.voice.toggleScreen());
    await sleep(2000);
    if (i <= 5 || i % 5 === 0) await snap('ciclo-' + i);
  }
  if (process.env.SNAPSHOT) { await gc(); const chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk)); await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync('.testshots/heap.heapsnapshot', chunks.join('')); console.log('snapshot salvo'); }
  await A.evaluate(() => window.__lc.voice.leave()); await sleep(3000); await snap('saiu');
  await sleep(30000); await snap('saiu+30s');
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' }); await sleep(3000); await snap('pressao');
} catch (e) { R.error = String(e.stack || e); console.log(R.error); }
finally { if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(R, null, 1)); await bA.close(); await bB.close(); srv.kill(); setTimeout(() => process.exit(0), 300); }
