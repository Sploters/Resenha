// PC fraco: resposta a cliques e teclas (a base do INP do Chrome) e quadros perdidos rolando o chat.
// Banco do scripts/load/seed.mjs (N pessoas no mesmo servidor, 20 canais com 1.000 mensagens). Processador CPU vezes mais
// lento (padrão 6). Cada interação é feita com mouse/teclado de verdade e medida pela Event Timing API: do toque até o
// próximo quadro pintado. > 200 ms o Chrome chama de "ruim"; até 100 ms parece instantâneo.
// Uso: DATA_DIR=./.testdata-churn node scripts/load/seed.mjs 300 && node scripts/perf-inp.mjs [rótulo]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 3294), BASE = `http://localhost:${PORT}`, DIR = process.env.DATA_DIR || './.testdata-churn';
const CPU = +(process.env.CPU || 6), LABEL = process.argv[2] || 'atual';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const meta = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const R = { label: LABEL, cpuThrottle: CPU, members: meta.n };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => {
    localStorage.lc_token = 'load-0';
    window.__ev = []; // interações: duração do toque até o quadro pintado
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ t: e.startTime, name: e.name, d: Math.round(e.duration), proc: Math.round(e.processingEnd - e.processingStart), delay: Math.round(e.processingStart - e.startTime), id: e.interactionId }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  const cdp = await p.createCDPSession();
  const t0 = Date.now(); await p.goto(BASE); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 }); R.openMs = Date.now() - t0;
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), meta.guild, meta.channels[0]);
  await p.waitForSelector('#composer textarea', { timeout: 60000 }); await sleep(4000);
  // uma etapa: zera a lista, faz a ação, espera assentar e guarda a pior interação (o INP olha a pior/quase pior)
  const step = async (name, fn) => {
    const a = await p.evaluate(() => performance.now()), w = Date.now();
    try { await fn(); } catch (e) { R[name] = { error: String(e.message || e) }; return; }
    const b = await p.evaluate(() => performance.now()); await sleep(2500); // o observador entrega depois do quadro
    const ev = await p.evaluate((a, b) => window.__ev.filter(e => e.t >= a && e.t <= b), a, b);
    const by = new Map(); for (const e of ev) { const o = by.get(e.id); if (!o || e.d > o.d) by.set(e.id, e); } // uma interação = vários eventos (pointerdown, click...)
    const list = [...by.values()].sort((a, b) => b.d - a.d);
    R[name] = { worstMs: list[0]?.d ?? 0, worstWhat: list[0] ? `${list[0].name} (espera ${list[0].delay} + código ${list[0].proc})` : '', interactions: list.length, wallMs: Date.now() - w - 2500, presentMs: list[0] ? list[0].d - list[0].delay - list[0].proc : 0 };
  };
  const click = async (sel) => { const el = await p.waitForSelector(sel, { timeout: 30000 }); await el.click(); };
  await step('digitar', async () => { await click('#composer textarea'); await p.keyboard.type('mensagem de teste para medir a resposta do campo', { delay: 30 }); });
  await step('enviar', async () => { await p.keyboard.press('Enter'); });
  await step('emojis', async () => { await p.hover('#composer .extras-btn'); await sleep(400); await click('.cx-pop .cx-opt[title="Emoji"]'); await p.waitForSelector('.emoji-picker', { timeout: 20000 }); await sleep(300); await p.keyboard.press('Escape'); });
  if (process.env.TRACE) await p.tracing.start({ path: '.testshots/inp-trace.json', categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await step('emojis2', async () => { await p.hover('#composer textarea'); await sleep(700); await p.hover('#composer .extras-btn'); await sleep(400); await click('.cx-pop .cx-opt[title="Emoji"]'); await p.waitForSelector('.emoji-picker', { timeout: 20000 }); await sleep(300); await p.keyboard.press('Escape'); });
  if (process.env.TRACE) await p.tracing.stop();
  await step('trocarCanal', async () => { for (let i = 1; i <= 4; i++) { const rows = await p.$$('#side-list .ch:not(.clipsrow)'); await rows[i].click(); await sleep(1200); } });
  await step('perfilMembro', async () => { await click('#members .mem-mecard, #members .mem'); await sleep(600); await p.keyboard.press('Escape'); });
  await step('configuracoes', async () => { await click('.pb-gear, [title="Configurações do usuário"]'); await sleep(1500); await p.keyboard.press('Escape'); });
  await step('buscarMembro', async () => { await click('#members .mem-q'); await p.keyboard.type('carga', { delay: 40 }); await sleep(500); for (let i = 0; i < 5; i++) await p.keyboard.press('Backspace'); });
  // rolar o histórico (carrega mais ao chegar no topo): quadros com mais de 50 ms entre um e outro = travadinhas
  await p.evaluate(() => { window.__fr = []; let last = performance.now(); const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(tick); }; window.__frOn = true; requestAnimationFrame(tick); });
  const box = await p.$('#msgs'); const bb = await box.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let i = 0; i < 40; i++) { await p.mouse.wheel({ deltaY: -600 }); await sleep(120); }
  await sleep(1000);
  const fr = await p.evaluate(() => { window.__frOn = false; return window.__fr; });
  R.rolar = { frames: fr.length, longFrames: fr.filter(x => x > 50).length, worstFrameMs: Math.round(Math.max(...fr)), avgFps: Math.round(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)), msgsLoaded: await p.evaluate(() => document.querySelectorAll('#msgs .msg').length) };
  // correção: o chat montado aos pedaços (histórico inserido no topo) igual a um montado do zero
  const shape = () => p.evaluate(() => [...document.querySelectorAll('#msgs > *')].map(e => e.dataset.mid ? e.dataset.mid + (e.classList.contains('first') ? 'F' : '') : e.className.split(' ')[0] + (e.classList.contains('daysep') ? ':' + e.textContent : '')).join('|'));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const pieces = await shape();
  await p.evaluate((gid, a, b) => { window.__lc.go(gid, b); return new Promise(r => setTimeout(() => { window.__lc.go(gid, a); r(); }, 800)); }, meta.guild, meta.channels[4], meta.channels[3]); await sleep(2500);
  R.rolar.sameAsFresh = pieces === await shape();
  R.inpMs = Math.max(...Object.values(R).filter(v => v?.worstMs != null).map(v => v.worstMs));
} catch (e) { R.error = String(e.stack || e); }
finally {
  await browser.close(); srv.kill();
  fs.mkdirSync('.testshots', { recursive: true }); fs.writeFileSync(`.testshots/inp-${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 1)); setTimeout(() => process.exit(0), 300);
}
