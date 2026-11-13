// Travadas chegam ao administrador: um clique que segura a página 1,5 s aparece em GET /api/perf (travadas) com a função
// culpada e o que estava aberto; e o cronômetro da chamada usa a hora do servidor (relógio do PC adiantado 20 s não
// faz a chamada começar em 0:20).
// Uso: node scripts/freeze-report-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('freeze', 3392, 41300);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const g = await api(ra.token, 'POST', '/guilds', { name: 'Turma' });
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  // relógio deste "PC" 20 s adiantado em relação ao servidor
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; const real = Date.now; Date.now = () => real() + 20000; }, ra.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  const vc = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(x => x.type === 2).id, g.id);
  await p.evaluate(async (gid, vc) => { window.__lc.go(gid, vc); await window.__lc.voice.join(vc); for (let i = 0; i < 100 && !window.__lc.voice.sfu?.ready; i++) await new Promise(r => setTimeout(r, 100)); }, g.id, vc);
  await sleep(1500);
  const timers = await p.evaluate(() => [...document.querySelectorAll('.vtimer')].map(e => e.textContent));
  ok(timers.length > 0 && timers.every(t => /^0:0[0-4]$/.test(t)), 'cronômetro começa perto de 0:00 mesmo com o relógio do PC 20 s adiantado', timers);
  // um clique que trava 1,5 s
  // <script> de verdade (código injetado pelo DevTools não tem endereço e o Chrome não diz de quem é)
  await p.addScriptTag({ content: "const b = document.createElement('button'); b.id = 'trava'; b.textContent = 'x'; b.addEventListener('click', function travaDeTeste() { const t = performance.now(); while (performance.now() - t < 1500); }); document.body.append(b);" });
  await p.click('#trava'); await sleep(7000);
  const perf = await api(ra.token, 'GET', '/perf');
  const f = perf.travadas?.[0];
  ok(!!f && f.ms >= 1400, 'a travada chegou ao /api/perf', f && f.ms);
  ok(f?.scripts?.some(s => s.fn === 'travaDeTeste'), 'com a função culpada', f?.scripts);
  ok(f?.chamada === true, 'e sabendo que estava numa chamada', f && { chamada: f.chamada, tela: f.tela, ruido: f.ruido });
} finally { await browser.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
