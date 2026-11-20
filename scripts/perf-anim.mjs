// Custo de uma animação do app sozinha na tela: recálculos de estilo/s, layouts/s e % da thread principal (métricas do
// Chromium), com o app aberto e parado. Cenários: nada (base), esqueletos de carregamento (skShine: util.js skeleton e
// #boot) e a barra indeterminada da atualização (uoSlide: .updov .uo-bar.ind). Usado para levar animações ao compositor.
// Uso: node scripts/perf-anim.mjs   SECS=8 ROUNDS=3
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', SECS = +(process.env.SECS || 8), ROUNDS = +(process.env.ROUNDS || 3);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('perfanim', 3271, 41135);
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
const SCEN = {
  base: () => { },
  skeleton: async () => { const { skeleton } = await window.__lc.import('util.js'); const box = document.createElement('div'); box.id = '__anim'; box.style.cssText = 'position:fixed;left:80px;top:80px;width:600px;z-index:99999;background:#222'; box.append(skeleton('msgs', 8)); document.body.append(box); },
  updbar: () => { const box = document.createElement('div'); box.id = '__anim'; box.className = 'updov'; box.innerHTML = '<div class="uo-card"><h3>Atualizando</h3><div class="uo-prog"><div class="uo-bar ind"><div class="uo-fill"></div></div></div></div>'; document.body.append(box); },
};
try {
  const r = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, r.token);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap', { timeout: 60000 }); await sleep(3000);
  const anim = await p.evaluate(() => document.documentElement.classList.contains('anim'));
  const cdp = await p.createCDPSession(); await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const out = {};
  for (const [name, fn] of Object.entries(SCEN)) {
    const rows = [];
    for (let i = 0; i < ROUNDS; i++) {
      await p.evaluate(fn); await sleep(1000);
      const m0 = await m(); await sleep(SECS * 1000); const m1 = await m();
      rows.push({ style: (m1.RecalcStyleCount - m0.RecalcStyleCount) / SECS, layout: (m1.LayoutCount - m0.LayoutCount) / SECS, main: (m1.TaskDuration - m0.TaskDuration) / SECS * 100 });
      await p.evaluate(() => document.getElementById('__anim')?.remove()); await sleep(500);
    }
    const med = (k) => +rows.map(x => x[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(2);
    out[name] = { stylePerS: med('style'), layoutPerS: med('layout'), mainPct: med('main') };
  }
  console.log(JSON.stringify({ anim, secs: SECS, rounds: ROUNDS, mediana: out }));
} catch (e) { console.log('ERRO', e.message); }
finally { await browser.close(); process.exit(0); }
