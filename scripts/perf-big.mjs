// Dados grandes (banco do scripts/load/seed-big.mjs): 5.000 pessoas num servidor com 1.000 canais, 100 mil mensagens,
// 500 conversas diretas, ONLINE pessoas conectadas (gateway em Node). Mede o READY no servidor, a abertura do app, abrir o
// servidor grande, trocar de canal, a lista de membros, a lista de conversas diretas, a busca e GET mensagens.
// Uso: DATA_DIR=./.testdata-big node scripts/load/seed-big.mjs && node scripts/perf-big.mjs [rótulo]
// CPU=4 deixa o navegador 4x mais lento (PC fraco). Resultado em scripts/perf-big-<rótulo>.json
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import zlib from 'node:zlib'; import WebSocket from 'ws';
const PORT = 3314, BASE = `http://localhost:${PORT}`, D = process.env.DATA_DIR || './.testdata-big', LABEL = process.argv[2] || 'atual', CPU = +(process.env.CPU || 1), ONLINE = +(process.env.ONLINE || 600);
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[s.length >> 1]); }, p95 = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * .95)].toFixed(1); };
const meta = JSON.parse(fs.readFileSync(D + '/big.json', 'utf8'));
const srv = spawn('node', ['--expose-gc', 'server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0', PERF: '1' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const out = { label: LABEL, cpu: CPU, online: ONLINE };
const api = async (tok, p) => { const t = performance.now(); const r = await fetch(BASE + '/api' + p, { headers: { authorization: 'Bearer ' + tok } }); const b = await r.text(); return { ms: performance.now() - t, bytes: b.length, json: () => JSON.parse(b) }; };

// ---- READY no servidor (sem compressão do WebSocket, para medir o texto inteiro) ----
const ready = (tok) => new Promise((res, rej) => {
  const t0 = performance.now(), ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=${tok}`, { perMessageDeflate: false });
  ws.on('message', (raw) => { const s = raw.toString(); if (s.startsWith('{"t":"READY"')) { const ms = performance.now() - t0; ws.close(); res({ ms, bytes: s.length, gz: zlib.deflateRawSync(s, { level: 4 }).length }); } });
  ws.on('error', rej);
});
for (const [k, tok] of [['dono (5.000 membros, 500 DMs)', 'big-0'], ['membro comum', 'big-7']]) {
  const rs = []; for (let i = 0; i < 6; i++) rs.push(await ready(tok));
  out['READY ' + k] = { ms: med(rs.slice(1).map(r => r.ms)), KB: Math.round(rs[0].bytes / 1024), KB_comprimido: Math.round(rs[0].gz / 1024) };
}
// gente online (o app mostra quem está online na lista de membros)
const conns = []; for (let i = 1; i <= ONLINE; i++) { const ws = new WebSocket(`ws://localhost:${PORT}/gateway?token=big-${i * 7 % meta.n || 1}`); conns.push(ws); if (i % 50 === 0) await sleep(100); }
await sleep(2000);

// ---- servidor: mensagens e busca ----
{ const t = []; for (let i = 0; i < 60; i++) t.push((await api('big-0', `/channels/${meta.busy[i % 10]}/messages?limit=50`)).ms); out['GET mensagens (canal com 7 mil)'] = { p50: +med(t), p95: p95(t) }; }
{ const old = (await api('big-0', `/channels/${meta.busy[0]}/messages?limit=50`)).json(); const before = old.at(-1)?.id || old[0]?.id; const t = []; for (let i = 0; i < 30; i++) t.push((await api('big-0', `/channels/${meta.busy[0]}/messages?limit=50&before=${before}`)).ms); out['GET mensagens antigas'] = { p50: med(t), p95: p95(t) }; }
{ const t = []; for (const q of ['mensagem 500', 'conteúdo', 'link', 'zzz', 'teste']) t.push((await api('big-0', `/search?q=${encodeURIComponent(q)}&guild_id=${meta.guild}`)).ms); out['busca no servidor'] = { p50: med(t), max: Math.round(Math.max(...t)) }; }

// ---- navegador ----
const br = await puppeteer.launch({ executablePath: process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900 });
const cdp = await p.createCDPSession(); if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await p.evaluateOnNewDocument(() => {
  localStorage.lc_token = 'big-0'; localStorage.lc_last = '{}';
  window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] });
});
const lt = () => p.evaluate(() => { const a = window.__lt; window.__lt = []; return { soma: Math.round(a.reduce((x, y) => x + y, 0)), maior: Math.round(Math.max(0, ...a)) }; });
const t0 = Date.now(); await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.guilds?.size >= 4, { timeout: 180000, polling: 50 });
out['abrir o app'] = { ms: Date.now() - t0, tarefas_longas: await lt() };
await sleep(1500); await lt();
const step = async (name, fn, until) => {
  const r = await p.evaluate(async (fn, until) => {
    const t = performance.now(); await (0, eval)(fn)();
    while (!(0, eval)(until)() && performance.now() - t < 60000) await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(() => setTimeout(r)));
    return Math.round(performance.now() - t);
  }, fn, until);
  out[name] = { ms: r, tarefas_longas: await lt() }; await sleep(400); await lt();
};
await step('abrir o servidor grande (1.000 canais)', `() => window.__lc.go('${meta.guild}', '${meta.busy[0]}')`, `() => document.querySelectorAll('#msgs > .msg').length > 10 && document.querySelector('#members .mem')`);
const sw = [];
for (let i = 1; i <= 8; i++) { await step('_sw', `() => window.__lc.go('${meta.guild}', '${meta.busy[i % 10]}')`, `() => document.querySelector('#msgs > .msg') && location.hash.endsWith('${meta.busy[i % 10]}') && !document.querySelector('#msgs .skel')`); sw.push(out._sw); }
delete out._sw; out['trocar de canal (mediana de 8)'] = { ms: med(sw.map(x => x.ms)), maior_tarefa: Math.max(...sw.map(x => x.tarefas_longas.maior)) };
await step('abrir os offline na lista de membros', `() => { [...document.querySelectorAll('#members .mgroup.col')].forEach(b => b.click()); }`, `() => document.querySelectorAll('#members .mem').length > 150`);
out['lista de membros: linhas na tela'] = await p.evaluate(() => document.querySelectorAll('#members .mem').length);
await step('rolar a lista de membros até o fim', `async () => { const m = document.querySelector('#members'); for (let i = 0; i < 20; i++) { m.scrollTop += m.scrollHeight / 20; await new Promise(r => requestAnimationFrame(r)); } }`, `() => true`);
out['lista de membros: linhas depois de rolar'] = await p.evaluate(() => document.querySelectorAll('#members .mem').length);
await step('buscar membro', `() => { const q = document.querySelector('#members .mem-q'); q.value = 'Pessoa Grande 49'; q.dispatchEvent(new Event('input')); }`, `() => document.querySelectorAll('#members .mem').length < 200`);
await step('rolar a lista de canais até o fim', `async () => { const m = document.querySelector('#side-list'); for (let i = 0; i < 20; i++) { m.scrollTop += m.scrollHeight / 20; await new Promise(r => requestAnimationFrame(r)); } }`, `() => true`);
await step('abrir conversas diretas (500)', `() => window.__lc.go('@me', '${meta.dms[0]}')`, `() => document.querySelectorAll('#msgs > .msg').length > 1`);
out['conversas diretas: linhas montadas'] = await p.evaluate(() => document.querySelectorAll('#side-list .dmrow').length);
await step('rolar a lista de conversas até o fim', `async () => { const m = document.querySelector('#side-list'); for (let i = 0; i < 20; i++) { m.scrollTop += m.scrollHeight / 20; await new Promise(r => requestAnimationFrame(r)); } }`, `() => true`);
out['conversas diretas: linhas depois de rolar'] = await p.evaluate(() => document.querySelectorAll('#side-list .dmrow').length);
await step('voltar ao servidor grande', `() => window.__lc.go('${meta.guild}', '${meta.busy[0]}')`, `() => document.querySelectorAll('#msgs > .msg').length > 10 && location.hash.endsWith('${meta.busy[0]}')`);
const m = await p.evaluate(() => ({ elementos: document.getElementsByTagName('*').length, memoria_js_MB: Math.round(performance.memory.usedJSHeapSize / 1048576) }));
out['página no fim'] = m;
await br.close(); for (const ws of conns) ws.terminate(); srv.kill();
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`scripts/perf-big-${LABEL}.json`, JSON.stringify(out, null, 1));
process.exit(0);
