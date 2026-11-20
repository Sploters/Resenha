// Abertura do app (conta com login, cache vazio a cada rodada): tempo até os dados chegarem (S.synced), tempo da thread
// principal por tipo (script, estilo, layout) até lá, bytes baixados (como chegaram: comprimidos se o servidor comprimir),
// quantos arquivos, e quanto do JS e do CSS baixado foi usado até a tela parar (cobertura do Chromium).
// CPU=4 simula um PC 4x mais lento (Emulation.setCPUThrottlingRate). Mediana das rodadas.
// BLOCK=watch.css,ux.css: experimento, bloqueia esses arquivos (teto do ganho de não carregá-los na abertura)
// Uso: node scripts/perf-open.mjs   RUNS=5 CPU=4
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
import { DatabaseSync } from 'node:sqlite';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', RUNS = +(process.env.RUNS || 5), CPU = +(process.env.CPU || 1);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BLOCK = (process.env.BLOCK || '').split(',').filter(Boolean);
const BASE = await ownServer('perfopen', 3272, 41136);
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
try {
  const r = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const g = await call(r.token, 'POST', '/guilds', { name: 'Turma' });
  // 30 mensagens no #geral (o canal que abre)
  { const db = new DatabaseSync('./.testdata-perfopen/resenha.db', { readOnly: true }); const ch = db.prepare('SELECT id FROM channels WHERE guild_id=? AND type=0').get(g.id).id; db.close();
    for (let i = 0; i < 30; i++) await call(r.token, 'POST', `/channels/${ch}/messages`, { content: 'mensagem ' + i }); }
  const rows = [];
  for (let run = 0; run < RUNS + 1; run++) { // a 1ª aquece o servidor (minificação em memória) e não conta
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
    const cdp = await p.createCDPSession(); await cdp.send('Performance.enable'); await cdp.send('Network.enable');
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (BLOCK.length) { await cdp.send('Network.setBlockedURLs', { urls: BLOCK.map(f => '*/' + f + '*') }); }
    let bytes = 0, files = 0; cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; files++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
    await Promise.all([p.coverage.startJSCoverage({ resetOnNavigation: false }), p.coverage.startCSSCoverage({ resetOnNavigation: false })]);
    const t0 = Date.now();
    await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 120000, polling: 20 });
    const ready = Date.now() - t0;
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    await sleep(1500 * CPU);
    const [js, css] = await Promise.all([p.coverage.stopJSCoverage(), p.coverage.stopCSSCoverage()]);
    const used = (list) => { let tot = 0, u = 0; for (const e of list) { if (!e.url.startsWith(BASE)) continue; tot += e.text.length; for (const rg of e.ranges) u += rg.end - rg.start; } return { kb: Math.round(tot / 1024), usedPct: tot ? Math.round(u / tot * 100) : 0 }; };
    if (run > 0) rows.push({ ready, script: m.ScriptDuration * 1000, style: m.RecalcStyleDuration * 1000, layout: m.LayoutDuration * 1000, task: m.TaskDuration * 1000, kb: bytes / 1024, files, js: used(js), css: used(css) });
    await ctx.close();
  }
  const k = (f) => Math.round(med(rows.map(f)));
  console.log(JSON.stringify({ runs: RUNS, cpu: CPU, block: BLOCK.join(',') || undefined, mediana: { prontoMs: k(x => x.ready), threadMs: k(x => x.task), scriptMs: k(x => x.script), estiloMs: k(x => x.style), layoutMs: k(x => x.layout), baixadoKB: k(x => x.kb), arquivos: k(x => x.files),
    jsKB: rows[0].js.kb, jsUsado: k(x => x.js.usedPct) + '%', cssKB: rows[0].css.kb, cssUsado: k(x => x.css.usedPct) + '%' }, prontoMs: rows.map(x => x.ready) }));
} catch (e) { console.log('ERRO', e.message); }
finally { await browser.close(); process.exit(0); }
