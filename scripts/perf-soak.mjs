// Sessão longa: vazamentos que só aparecem com o tempo. Call de 3 pessoas aberta o tempo todo, gente entrando e saindo,
// mensagens chegando, e quem é medido (alice) usando o app em ciclos: troca de canal, configurações, emojis, mutar,
// voltar à call. A cada minuto: memória JS da página (depois de forçar a coleta de lixo), elementos, ouvintes, memória
// do navegador inteiro, do servidor e do mediasoup, e objetos do SFU. No fim: tendência (por hora) de cada um.
// Uso: MIN=30 node scripts/perf-soak.mjs [rótulo]   -> .testshots/soak-<rótulo>.json
// Para achar a causa: ISOLATE=1 mede quanto cada ação deixa para trás (12 repetições cada); SNAPEND=1 salva um heap snapshot
// no fim (.testshots/soak.heapsnapshot; abra no DevTools > Memory e procure "Detached"); SNAP=1 / ISOLATE2=1 focam no envio.
// Atenção ao escrever ações: elemento pego com page.$() fica preso enquanto a referência existir — use page.click(seletor).
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
const PORT = 3296, BASE = `http://localhost:${PORT}`, D = './.testdata-soak', MIN = +(process.env.MIN || 30), LABEL = process.argv[2] || 'atual';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(D, { recursive: true, force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC_PORT: '41320', RTC_IPS: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'senha123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const tree = (root) => { const out = execFileSync('ps', ['-o', 'pid=,ppid=', '-A']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)); const k = new Set([root]); for (let i = 0; i < 4; i++) for (const [p, pp] of out) if (k.has(pp)) k.add(p); return [...k]; };
const rss = (pids) => Math.round(pids.reduce((s, pid) => { try { return s + +fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096; } catch { return s; } }, 0) / 1048576);
const R = { label: LABEL, minutes: MIN, samples: [] };
const browsers = [], socks = [];
try {
  const a = await reg('alice'), b = await reg('bruno'), c = await reg('carla');
  const g = await call(a.tok, 'POST', '/guilds', { name: 'Turma' }); const inv = (await call(a.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const u of [b, c]) await call(u.tok, 'POST', '/invites/' + inv);
  const extra = []; for (let i = 0; i < 20; i++) { const u = await reg('figurante' + i); await call(u.tok, 'POST', '/invites/' + inv); extra.push(u); }
  const open = async (tok) => {
    const br = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
    browsers.push(br); const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 });
    return { br, p };
  };
  const A = await open(a.tok), B = await open(b.tok), C = await open(c.tok);
  const chans = await A.p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.map(x => ({ id: x.id, type: x.type })), g.id);
  const texts = chans.filter(x => x.type === 0).map(x => x.id), vch = chans.find(x => x.type === 2).id;
  for (const P of [A, B, C]) await P.p.evaluate(async (cid) => { await window.__lc.voice.join(cid); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, vch);
  const cdp = await A.p.createCDPSession(); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable');
  const srvPids = () => tree(srv.pid), sfu = () => call(a.tok, 'GET', '/sfu/load').then(r => r.current).catch(() => null);
  // agitação de fundo: figurantes entram/saem e mandam mensagens
  let stop = false;
  (async () => { while (!stop) { const u = extra[Math.floor(Math.random() * extra.length)]; const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + u.tok); ws.on('error', () => { }); socks.push(ws); await sleep(2000);
    call(u.tok, 'POST', `/channels/${texts[0]}/messages`, { content: 'mensagem de fundo ' + Date.now() + ' **negrito** https://example.com' }).catch(() => { }); await sleep(2000); try { ws.close(); } catch { } } })();
  // alice usando o app em ciclos
  const actions = [
    () => A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]),
    () => A.p.evaluate(() => window.__lc.openSettings('voice')).then(() => sleep(1500)).then(() => A.p.keyboard.press('Escape')),
    () => A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, vch),
    () => A.p.evaluate(() => { window.__lc.voice.toggleMute(); setTimeout(() => window.__lc.voice.toggleMute(), 800); }),
    () => A.p.evaluate(() => window.__lc.go('@me')),
    () => A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]).then(() => sleep(800)).then(async () => { await A.p.click('#composer textarea'); await A.p.keyboard.type('oi', { delay: 30 }); await A.p.keyboard.press('Enter'); }),
  ];
  if (process.env.SNAP) { // reproduz (ação 5 x12) e tira um heap snapshot para achar quem segura os elementos soltos
    stop = true; await sleep(3000);
    for (let k = 0; k < 12; k++) { await actions[5]().catch(() => { }); await sleep(1500); }
    await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]); await sleep(1500); await cdp.send('HeapProfiler.collectGarbage');
    const chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    fs.writeFileSync('.testshots/soak.heapsnapshot', chunks.join('')); throw new Error('snapshot salvo');
  }
  if (process.env.ISOLATE2) { // só as variantes da ação 5
    actions.length = 0;
    actions.push(
      async () => { await A.p.click('#composer textarea'); await A.p.keyboard.type('oi', { delay: 30 }); await A.p.keyboard.press('Backspace'); await A.p.keyboard.press('Backspace'); }, // só digitar
      () => call(a.tok, 'POST', `/channels/${texts[0]}/messages`, { content: 'oi pela api' }), // alice manda por fora (chega pelo gateway)
      () => call(b.tok, 'POST', `/channels/${texts[0]}/messages`, { content: 'oi do bruno' }), // outra pessoa manda
      async () => { await A.p.click('#composer textarea'); await A.p.keyboard.type('oi', { delay: 30 }); await A.p.keyboard.press('Enter'); }); // enviar pelo app
  }
  if (process.env.ISOLATE || process.env.ISOLATE2) { // quanto cada ação deixa para trás (12 repetições, elementos/ouvintes depois da coleta de lixo)
    const meas = async () => { await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]); await sleep(1200); await cdp.send('HeapProfiler.collectGarbage'); const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])); return [m.Nodes, m.JSEventListeners]; };
    stop = true; await sleep(4000);
    R.isolate = {};
    const quiet = await meas(); await sleep(30000); const q2 = await meas(); R.isolate.parado30s = [q2[0] - quiet[0], q2[1] - quiet[1]];
    for (let i = 0; i < actions.length; i++) { const b0 = await meas(); for (let k = 0; k < 12; k++) { await actions[i]().catch(() => { }); await sleep(1500); } const b1 = await meas(); R.isolate['acao' + i] = [b1[0] - b0[0], b1[1] - b0[1]]; console.log('acao', i, R.isolate['acao' + i]); }
    stop = false; const f0 = await meas(); await sleep(60000); const f1 = await meas(); R.isolate.fundo60s = [f1[0] - f0[0], f1[1] - f0[1]]; console.log('fundo 60s', R.isolate.fundo60s);
    throw new Error('fim do isolamento');
  }
  const t0 = Date.now(); let n = 0, nextSample = 0;
  while (Date.now() - t0 < MIN * 60e3) {
    await actions[n++ % actions.length]().catch(() => { }); await sleep(5000);
    if (Date.now() - t0 >= nextSample) {
      nextSample += 60e3;
      await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]); await sleep(1500); // sempre na mesma tela ao medir
      await cdp.send('HeapProfiler.collectGarbage');
      const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
      const s = { min: +((Date.now() - t0) / 60e3).toFixed(1), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents,
        browserMB: rss(tree(A.br.process().pid)), serverMB: rss(srvPids()), sfu: await sfu(), msgsInDom: await A.p.evaluate(() => document.querySelectorAll('#msgs .msg').length),
        audioEls: await A.p.evaluate(() => document.querySelectorAll('audio').length), inCall: await A.p.evaluate(() => !!window.__lc.voice.sfu?.ready) };
      R.samples.push(s); console.log(JSON.stringify(s));
    }
  }
  stop = true;
  if (process.env.SNAPEND) { // heap snapshot no fim do ciclo misturado
    await sleep(3000); await A.p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, texts[0]); await sleep(1500); await cdp.send('HeapProfiler.collectGarbage');
    const chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); fs.writeFileSync('.testshots/soak.heapsnapshot', chunks.join(''));
  }
  // tendência por hora (mínimos quadrados), ignorando os 3 primeiros minutos (caches enchendo)
  const fit = (k) => { const pts = R.samples.filter(s => s.min >= 3).map(s => [s.min, typeof k === 'function' ? k(s) : s[k]]); if (pts.length < 3) return null;
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    const sl = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0); return +(sl * 60).toFixed(2); };
  R.perHour = { heapMB: fit('heapMB'), nodes: fit('nodes'), listeners: fit('listeners'), browserMB: fit('browserMB'), serverMB: fit('serverMB'), sfuConsumers: fit(s => s.sfu?.consumers ?? 0) };
} catch (e) { R.error = String(e.stack || e); console.log('ERRO', e); }
finally {
  for (const ws of socks) try { ws.close(); } catch { }
  for (const b of browsers) await b.close().catch(() => { });
  srv.kill(); fs.rmSync(D, { recursive: true, force: true });
  fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync(`.testshots/soak-${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log('por hora:', JSON.stringify(R.perHour)); setTimeout(() => process.exit(0), 300);
}
