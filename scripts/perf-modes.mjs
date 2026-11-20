// Consumo por modo de uso (auditoria de recursos): CPU de TODOS os processos do Chromium de quem é medido (A), memória
// (PSS) por tipo de processo, tráfego do WebSocket de A e CPU/memória do servidor, em: ocioso, num servidor, voz com 3,
// mutado, transmitindo, assistindo, tudo junto e depois de sair. B e C ficam num navegador separado.
// Uso: node scripts/perf-modes.mjs   SECS=20 OUT=.testshots/perf-modos.json
// Atenção: em nov/2026 a 3ª pessoa não entrava na voz nesta máquina de nuvem (igual no código antigo); ver PROXIMOS-PASSOS.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { threads, diff, pct } from './proc-cpu.mjs';
const EXE = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const PORT = 3262, BASE = `http://localhost:${PORT}`, SECS = +(process.env.SECS || 20);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync('.testdata-modes', { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-modes', RTC_PORT: '41060', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const srvTicks = () => { let t = 0; const ids = [srv.pid]; for (const p of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) { try { if (+fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1] === srv.pid) ids.push(+p); } catch { } }
  for (const p of ids) { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); t += +f[11] + +f[12]; } catch { } } return t; };
const srvRss = () => { let k = 0; for (const p of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) { try { const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); if (+p === srv.pid || +st[1] === srv.pid) k += +fs.readFileSync(`/proc/${p}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]; } catch { } } return Math.round(k / 1024); };
// PSS (memória real, sem contar duas vezes o que é compartilhado) por tipo de processo
const pss = (root) => { const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)), pp = new Map(); for (const p of all) { try { pp.set(+p, +fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1]); } catch { } }
  const kids = new Set([root]); let g = true; while (g) { g = false; for (const [p, q] of pp) if (kids.has(q) && !kids.has(p)) { kids.add(p); g = true; } }
  const out = {}; let n = 0; for (const pid of kids) { try { const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); const t = (cl.match(/--type=([\w-]+)/)?.[1] || 'browser') + (cl.match(/--utility-sub-type=([\w.]+)/)?.[1]?.replace(/.*\./, ':') || ''); const v = +fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/Pss:\s+(\d+)/)[1]; out[t] = Math.round(((out[t] || 0) * 1024 + v) / 1024); n++; } catch { } }
  out.total = Object.entries(out).reduce((s, [, v]) => s + v, 0); out.procs = n; return out; };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const bA = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const bO = await puppeteer.launch({ executablePath: EXE, headless: 'new', args });
const rootA = bA.process().pid;
const R = { secs: SECS, modes: {} };
async function open(browser, tok) {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t;
    // tela falsa = câmera falsa do Chromium (sem timer da página, para não sujar a medida)
    navigator.mediaDevices.getDisplayMedia = (c) => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
    const live = new Map(), oSI = setInterval, oCI = clearInterval; window.setInterval = (f, ms, ...a) => { const id = oSI(f, ms, ...a); live.set(id, ms); return id; }; window.clearInterval = (id) => { live.delete(id); return oCI(id); };
    window.__iv = () => [...live.values()].sort((a, b) => a - b);
    const OAC = window.AudioContext; window.__acs = []; window.AudioContext = function (...a) { const c = new OAC(...a); window.__acs.push(c); return c; }; window.AudioContext.prototype = OAC.prototype;
  }, tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
  return p;
}
const ws = { rx: 0, rxB: 0, tx: 0, txB: 0, types: {} };
async function measure(name, A) {
  await sleep(3000);
  Object.assign(ws, { rx: 0, rxB: 0, tx: 0, txB: 0, types: {} });
  const t0 = threads(rootA), s0 = srvTicks();
  await sleep(SECS * 1000);
  const t1 = threads(rootA), s1 = srvTicks();
  const c = pct(diff(t0, t1), SECS, { renderer: /^renderer/, gpu: /^gpu-process/, audio: /:audio|AudioOutputDevice|AudioWorklet|audio/i, network: /network/i });
  const page = await A.evaluate(() => ({ intervals: window.__iv(), acs: window.__acs.map(c => c.state), tracks: (window.__lc?.voice?.mic?.getTracks?.() || []).map(t => t.readyState), nodes: document.getElementsByTagName('*').length, videos: document.querySelectorAll('video').length, pcs: 0 }));
  const perMin = (x) => Math.round(x * 60 / SECS);
  R.modes[name] = { cpuPctOfOneCore: c, pssMB: pss(rootA), serverCpuPct: +((s1 - s0) / SECS).toFixed(2), serverRssMB: srvRss(),
    wsPerMin: { rxMsgs: perMin(ws.rx), rxKB: +(ws.rxB * 60 / SECS / 1024).toFixed(1), txMsgs: perMin(ws.tx), txKB: +(ws.txB * 60 / SECS / 1024).toFixed(1), rxTypes: Object.fromEntries(Object.entries(ws.types).map(([k, v]) => [k, perMin(v)])) }, page };
  console.log(name, JSON.stringify(R.modes[name]));
}
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c]) await call(u.tok, 'POST', '/invites/' + inv);
  const A = await open(bA, a.tok);
  const cdp = await A.createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', (e) => { ws.rx++; ws.rxB += e.response.payloadData.length; const t = e.response.payloadData.match(/"t":"(\w+)"/)?.[1] || '?'; ws.types[t] = (ws.types[t] || 0) + 1; });
  cdp.on('Network.webSocketFrameSent', (e) => { ws.tx++; ws.txB += e.response.payloadData.length; const t = 'tx:' + (e.response.payloadData.match(/"t":"(\w+)"/)?.[1] || '?'); ws.types[t] = (ws.types[t] || 0) + 1; });
  await A.reload(); await A.waitForSelector('#rail .rail-wrap');
  // 1) aberto e ocioso, sozinho (B e C ainda fechados), na tela inicial
  await A.evaluate(() => window.__lc.go?.('@me')).catch(() => { });
  await measure('1-ocioso-sozinho', A);
  // B e C online
  const B = await open(bO, b.tok), C = await open(bO, c.tok);
  const tch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0), g.id);
  for (let i = 0; i < 100; i++) await call([a, b, c][i % 3].tok, 'POST', `/channels/${tch.id}/messages`, { content: `mensagem ${i} com **markdown** https://example.com/${i}` });
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id);
  await measure('2-servidor-sem-chamada', A);
  // janela escondida (minimizado): o Chromium sem cabeça não minimiza; simula com a aba em segundo plano
  const vch = await A.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2), g.id);
  for (const P of [A, B, C]) {
    await P.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id); await sleep(300);
    await P.evaluate(() => [...document.querySelectorAll('#stage .btn')].find(x => /Entrar/.test(x.textContent))?.click());
    await P.waitForFunction(() => window.__lc.voice?.sfu?.ready, { timeout: 20000 });
  }
  await measure('3-voz-3-pessoas', A);
  // 3b) voz com a A mutada
  await A.evaluate(() => window.__lc.voice.toggleMute()); await measure('3b-voz-mutado', A); await A.evaluate(() => window.__lc.voice.toggleMute());
  // 3c) voz voltando ao chat de texto (sala continua ativa, palco fora da tela)
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id); await measure('3c-voz-olhando-chat', A);
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch.id);
  // 4) A transmite a tela 720p30
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await measure('4-transmitindo-720p30', A);
  // 4b) A transmite 1080p60
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1500);
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 1080, fps: 60, audio: false, hint: 'motion' }));
  await measure('4b-transmitindo-1080p60', A);
  await A.evaluate(() => window.__lc.voice.toggleScreen()); await sleep(1500);
  await measure('4c-depois-de-parar-transmissao', A);
  // 5) B transmite, A assiste
  await B.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await A.waitForFunction((uid) => !!document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`) || !!document.querySelector(`.tile.screen[data-sid="${uid}"]`), { timeout: 15000 }, b.id).catch(() => { });
  await A.evaluate((uid) => document.querySelector(`.tile.cstream[data-key="s:${uid}"] .btn`)?.click(), b.id);
  await measure('5-assistindo-720p30', A);
  // 6) tudo junto: A transmite e assiste, com câmera
  await A.evaluate(() => window.__lc.voice.toggleScreen({ res: 720, fps: 30, audio: false, hint: 'motion' }));
  await A.evaluate(() => window.__lc.voice.toggleCam?.()).catch(() => { });
  await measure('6-transmite-assiste-camera', A);
  // 7) sai da chamada: o que sobra
  await B.evaluate(() => window.__lc.voice.leave()); await C.evaluate(() => window.__lc.voice.leave());
  await A.evaluate(() => window.__lc.voice.leave());
  await A.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, tch.id);
  await sleep(5000);
  await measure('7-depois-de-sair-da-chamada', A);
} catch (e) { R.error = String(e.stack || e); console.log('ERRO', e); }
finally {
  await bA.close(); await bO.close(); srv.kill();
  fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync(process.env.OUT || '.testshots/perf-modos.json', JSON.stringify(R, null, 1));
  setTimeout(() => process.exit(0), 300);
}
