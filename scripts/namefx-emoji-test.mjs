// Nome com Arco-íris/Brilho no chat e 1ª abertura do painel de emojis (trace de 2026-11-11: INP 328 ms).
// Mede, com o processador 6x mais lento: (1) repinturas do chat em 3 s parado com autores de nome animado na tela;
// (2) o toque que abre o painel de emojis pela 1ª vez (Event Timing), e se os emojis do topo aparecem.
// Uso: node scripts/namefx-emoji-test.mjs [rótulo]   (copia o banco do .testdata-churn; ver scripts/perf-inp.mjs)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 3297, BASE = `http://localhost:${PORT}`, SRC = './.testdata-churn', DIR = './.testdata-namefx', CPU = 6;
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DIR, { recursive: true, force: true }); fs.cpSync(SRC, DIR, { recursive: true });
const meta = JSON.parse(fs.readFileSync(DIR + '/load.json', 'utf8'));
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sql = `UPDATE users SET name_style='{"font":"script","effect":"rainbow","c1":"#ffffff","c2":"#ffffff"}' WHERE rowid % 2 = 0; UPDATE users SET name_style='{"font":"default","effect":"shimmer","c1":"#ff8800","c2":"#ffffff"}' WHERE rowid % 2 = 1;`;
if (DatabaseSync) { const db = new DatabaseSync(DIR + '/resenha.db'); db.exec(sql); db.close(); } else execFileSync('sqlite3', [DIR + '/resenha.db', sql]);
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DIR, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const R = { label: process.argv[2] || 'atual' };
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => {
    localStorage.lc_token = 'load-0'; window.__ev = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ name: e.name, d: Math.round(e.duration), id: e.interactionId }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  const cdp = await p.createCDPSession();
  await p.goto(BASE); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await p.waitForSelector('#rail .rail-wrap', { timeout: 120000 });
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), meta.guild, meta.channels[0]);
  await p.waitForSelector('#composer textarea', { timeout: 60000 }); await sleep(5000);
  R.animatedNames = await p.evaluate(() => [...document.querySelectorAll('#msgs .ne-rainbow, #msgs .ne-shimmer')].filter(e => getComputedStyle(e).animationName !== 'none').length);
  R.namesOnScreen = await p.evaluate(() => document.querySelectorAll('#msgs .ne-rainbow, #msgs .ne-shimmer').length);
  await p.mouse.move(5, 450); // mouse fora do chat
  await p.tracing.start({ categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] }); await sleep(3000);
  const tr = JSON.parse(Buffer.from(await p.tracing.stop()).toString());
  R.idlePaints3s = tr.traceEvents.filter(e => e.name === 'Paint').length;
  R.idleFrames3s = tr.traceEvents.filter(e => e.name === 'DrawFrame').length;
  // hover numa mensagem: o nome dela anima
  const heads = await p.$$('#msgs .msg .head .author'), head = heads[heads.length - 1]; const bb = head && await head.boundingBox();
  if (bb) { await p.mouse.move(bb.x + bb.width + 60, bb.y + 4); await sleep(300); R.animatedOnHover = await p.evaluate(() => [...document.querySelectorAll('#msgs .ne-rainbow, #msgs .ne-shimmer')].filter(e => getComputedStyle(e).animationName !== 'none').length); }
  // 1ª abertura do painel de emojis
  await p.mouse.move(5, 450); await sleep(500);
  await p.evaluate(() => { window.__ev = []; });
  await p.hover('#composer .extras-btn'); await sleep(500);
  await (await p.waitForSelector('.cx-pop .cx-opt[title="Emoji"]')).click();
  await p.waitForSelector('.emoji-picker'); await sleep(2500);
  const ev = await p.evaluate(() => window.__ev); const by = new Map(); for (const e of ev) if (!by.has(e.id) || by.get(e.id).d < e.d) by.set(e.id, e);
  R.emojiOpenMs = Math.max(0, ...[...by.values()].filter(e => /pointer|click|mouse/.test(e.name)).map(e => e.d));
  R.emojiVisible = await p.evaluate(() => { const g = document.querySelector('.emoji-grid'), r = g.getBoundingClientRect(); return [...g.querySelectorAll('span')].filter(s => { const b = s.getBoundingClientRect(); return b.width > 0 && b.top >= r.top && b.bottom <= r.bottom; }).length; });
  R.emojiTotal = await p.evaluate(() => document.querySelectorAll('.emoji-grid span').length);
  // rola até o fim do painel: os blocos de baixo aparecem
  await p.evaluate(() => { const g = document.querySelector('.emoji-grid'); g.scrollTop = g.scrollHeight; }); await sleep(600);
  R.emojiVisibleAtEnd = await p.evaluate(() => { const g = document.querySelector('.emoji-grid'), r = g.getBoundingClientRect(); return [...g.querySelectorAll('span')].filter(s => { const b = s.getBoundingClientRect(); return b.width > 0 && b.top >= r.top && b.bottom <= r.bottom; }).length; });
  await p.screenshot({ path: '.testshots/emoji-' + R.label + '.png' });
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify(R));
