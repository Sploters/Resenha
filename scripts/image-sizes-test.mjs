// Imagens no tamanho em que aparecem (util.js imgUrl): abre o servidor grande (banco do scripts/load/seed-big.mjs, todo
// mundo com avatar padrão) e mede o que os avatares custam: bytes baixados, pixels decodificados e quantas imagens
// chegaram bem maiores que o quadro. Uso: DATA_DIR=./.testdata-big node scripts/load/seed-big.mjs && node scripts/image-sizes-test.mjs
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 3317, BASE = `http://localhost:${PORT}`, D = process.env.DATA_DIR || './.testdata-big', sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const meta = JSON.parse(fs.readFileSync(D + '/big.json', 'utf8'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: D, RTC: '0' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const br = await puppeteer.launch({ executablePath: process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await br.newPage(); await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(() => { localStorage.lc_token = 'big-0'; localStorage.lc_last = '{}'; });
await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.guilds?.size >= 1, { timeout: 120000 });
await p.evaluate((g, c) => window.__lc.go(g, c), meta.guild, meta.busy[0]);
await p.waitForFunction(() => document.querySelector('#members .mem'), { timeout: 30000 });
await p.evaluate(() => [...document.querySelectorAll('#members .mgroup.col')].forEach(b => b.click()));
await p.waitForFunction(() => [...document.querySelectorAll('img')].filter(i => /\/avatars\//.test(i.src)).length > 20, { timeout: 30000 }); await sleep(2500);
const r = await p.evaluate(() => {
  const res = performance.getEntriesByType('resource').filter(e => /\/avatars\//.test(e.name));
  const imgs = [...document.querySelectorAll('img')].filter(i => /\/avatars\//.test(i.currentSrc) && i.complete && i.naturalWidth);
  const big = imgs.filter(i => { const w = i.getBoundingClientRect().width; return w > 0 && i.naturalWidth > Math.max(64, w * 2 * Math.max(1, devicePixelRatio)) + 1; });
  return { pedidos: res.length, KB: Math.round(res.reduce((n, e) => n + (e.encodedBodySize || 0), 0) / 1024), imagens: imgs.length,
    megapixels_decodificados: +(new Set(imgs.map(i => i.currentSrc)).size && [...new Map(imgs.map(i => [i.currentSrc, i.naturalWidth * i.naturalHeight])).values()].reduce((a, b) => a + b, 0) / 1e6).toFixed(2),
    maiores_que_o_quadro: big.length };
});
console.log(JSON.stringify(r));
ok(r.maiores_que_o_quadro === 0, 'nenhum avatar chega maior que o dobro do quadro (ou que a versão de 64 px)', r);
await br.close(); srv.kill(); process.exit(fails ? 1 : 0);
