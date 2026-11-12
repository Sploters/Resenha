// Chat grande, DM e servidor, com conteúdo de verdade (scripts/load/seed-rich.mjs) e a CPU 4x mais lenta: abrir, rolar 10
// páginas para cima, receber 60 mensagens (4/s) estando no fim, digitar no compositor e alternar DM <-> canal. Mede o
// trabalho da página em cada fase (script, estilo, layout pelo CDP), o pior quadro (Long Animation Frame), os cliques e
// teclas (Event Timing) e quantos elementos ficam. Grava em JSON (padrão scripts/perf-chat.json) para comparar.
// Uso: DATA_DIR=./.testdata-rich node scripts/load/seed-rich.mjs 3000 && node scripts/perf-chat.mjs [saida.json]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3394, BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-rich', OUT = process.argv[2] || 'scripts/perf-chat.json';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', CPU = +(process.env.CPU || 4);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const meta = JSON.parse(fs.readFileSync(DIR + '/rich.json', 'utf8'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { } });
for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(100); } }
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox'] });
const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
p.on('pageerror', e => console.log('  PAGEERROR', e.message));
await p.evaluateOnNewDocument(() => {
  localStorage.lc_token = 'rich-0'; window.__loaf = []; window.__ev = [];
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__loaf.push({ t: e.startTime, d: e.duration, scripts: e.scripts.filter(s => s.duration > 20).map(s => `${Math.round(s.duration)}ms ${s.invoker} ${s.sourceFunctionName} ${(s.sourceURL || '').split('/').pop().split('?')[0]}:${s.sourceCharPosition}`) }))).observe({ type: 'long-animation-frame', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => e.interactionId && window.__ev.push({ t: e.startTime, d: e.duration, n: e.name }))).observe({ type: 'event', durationThreshold: 16, buffered: true });
});
await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
const cdp = await p.createCDPSession(); await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const out = { cpu: CPU, mensagens_por_chat: null };
async function phase(name, fn) {
  const a = await metrics(), t0 = await p.evaluate(() => { window.__loaf.length = 0; window.__ev.length = 0; return performance.now(); }); const w0 = Date.now();
  const extra = await fn();
  const b = await metrics(), r = await p.evaluate(() => ({ loaf: window.__loaf.slice(), ev: window.__ev.slice(), els: document.getElementsByTagName('*').length, msgs: document.querySelectorAll('#msgs > .msg').length, heap: performance.memory?.usedJSHeapSize }));
  const ms = (k) => Math.round((b[k] - a[k]) * 1000);
  const worst = r.loaf.sort((x, y) => y.d - x.d)[0];
  const o = { parede_ms: Date.now() - w0, script_ms: ms('ScriptDuration'), estilo_ms: ms('RecalcStyleDuration'), layout_ms: ms('LayoutDuration'), tarefas_ms: ms('TaskDuration'),
    pior_quadro_ms: Math.round(worst?.d || 0), quadros_longos: r.loaf.filter(x => x.d > 50).length, pior_interacao_ms: Math.round(Math.max(0, ...r.ev.filter(e => e.t >= t0).map(e => e.d))),
    elementos: r.els, mensagens_no_chat: r.msgs, heap_mb: +(r.heap / 2 ** 20).toFixed(1), ...extra };
  if (worst?.scripts?.length) o.pior_quadro_scripts = worst.scripts.slice(0, 3);
  const wi = r.ev.filter(e => e.t >= t0).sort((x, y) => y.d - x.d)[0]; if (wi && wi.d > 200) o.pior_interacao = `${wi.n} em +${Math.round(wi.t - t0)} ms`;
  out[name] = o; console.log(name.padEnd(28), JSON.stringify(o));
}
const waitMsgs = () => p.waitForFunction(() => document.querySelectorAll('#msgs > .msg').length > 5, { timeout: 60000 });
// recebendo: a DM tem uma pessoa só do outro lado (1 por segundo, abaixo do limite anti-spam); no canal, 6 pessoas a 4/s
for (const [label, gid, cid, senders, gap, n] of [['dm', '@me', meta.dm, ['rich-1'], 1000, 30], ['canal', meta.guild, meta.channel, ['rich-1', 'rich-2', 'rich-3', 'rich-4', 'rich-5', 'rich-6'], 250, 60]]) {
  await p.evaluate(() => window.__lc.go('@me')); await sleep(800);
  await phase(`${label}: abrir`, async () => { await p.evaluate((g, c) => window.__lc.go(g, c), gid, cid); await waitMsgs(); await sleep(1500); });
  await phase(`${label}: rolar 10 páginas`, async () => {
    const times = [];
    for (let i = 0; i < 10; i++) {
      const t = await p.evaluate(async () => {
        const m = document.querySelector('#msgs'), first = m.querySelector('.msg')?.dataset.mid, t0 = performance.now();
        // rola de verdade até o topo em passos (como a roda do mouse), não um salto
        for (let k = 0; k < 40 && m.scrollTop > 0; k++) { m.scrollTop = Math.max(0, m.scrollTop - 1200); await new Promise(r => requestAnimationFrame(r)); }
        for (let k = 0; k < 100; k++) { if (m.querySelector('.msg')?.dataset.mid !== first) break; await new Promise(r => setTimeout(r, 50)); }
        return Math.round(performance.now() - t0);
      });
      times.push(t);
    }
    await sleep(800); return { por_pagina_ms: times };
  });
  // volta ao presente
  await p.evaluate((g, c) => window.__lc.go(g, c), gid, cid); await sleep(300); await p.evaluate(() => window.__lc.go('@me')); await sleep(300);
  await p.evaluate((g, c) => window.__lc.go(g, c), gid, cid); await waitMsgs(); await sleep(1500);
  await p.evaluate(() => { const m = document.querySelector('#msgs'); m.scrollTop = m.scrollHeight; });
  await phase(`${label}: receber ${n} (${1000 / gap}/s)`, async () => {
    let rej = 0;
    for (let i = 0; i < n; i++) { const r = await api(senders[i % senders.length], 'POST', `/channels/${cid}/messages`, { content: i % 5 === 0 ? `**nova ${i}** <@${meta.users[0]}> 😂 https://example.com/x${i}` : `nova mensagem ${i} bora jogar` }); if (!r.id) rej++; await sleep(gap); }
    await sleep(1500); const last = n - 1;
    return { recusadas: rej, ultima_na_tela_e_no_fim: await p.evaluate((last) => { const m = document.querySelector('#msgs'), els = m.querySelectorAll(':scope > .msg'); return new RegExp(`nova( mensagem)? ${last}\\b`).test(els[els.length - 1]?.textContent || '') && m.scrollHeight - m.scrollTop - m.clientHeight < 30; }, last) };
  });
  await phase(`${label}: digitar 40 letras`, async () => {
    await p.click('#composer textarea, .composer [contenteditable], #msg-input, textarea').catch(() => { });
    await p.keyboard.type('testando o compositor num chat grande kkk', { delay: 60 }); await sleep(500);
    await p.evaluate(() => { const t = document.activeElement; if (t && 'value' in t) t.value = ''; else if (t) t.textContent = ''; });
  });
}
await phase('alternar dm <-> canal (10x)', async () => {
  const times = [];
  for (let i = 0; i < 10; i++) {
    const [g, c] = i % 2 ? ['@me', meta.dm] : [meta.guild, meta.channel];
    times.push(await p.evaluate(async (g, c) => { const t0 = performance.now(); window.__lc.go(g, c); for (let k = 0; k < 200; k++) { await new Promise(r => requestAnimationFrame(r)); if (document.querySelectorAll('#msgs > .msg').length > 5 && window.__lc.S.view.cid === c) break; } return Math.round(performance.now() - t0); }, g, c));
    await sleep(400);
  }
  times.sort((a, b) => a - b); return { mediana_ms: times[5], pior_ms: times[9] };
});
out.mensagens_por_chat = 3000;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close(); process.exit(0);
