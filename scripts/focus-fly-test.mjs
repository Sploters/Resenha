// Modo foco no cartão do avatar: clicar liga "até eu desligar" (e clicar de novo desliga) sem fechar o cartão; passar o
// mouse (ou clicar na seta) abre os horários ao lado, como o Status; "24 horas" no lugar de "Até amanhã".
// Uso: node scripts/focus-fly-test.mjs   (SHOT=arquivo.png salva a tela com os horários abertos)
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('focusfly', 3393, 41310);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ra = await api('', 'POST', '/register', { username: 'alice', password: 'senha123' });
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ra.token);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 60000 });
  await p.click('.pb-av'); await sleep(300);
  if (!await p.$('.mepop .meitem')) { await p.click('#userbar .me').catch(() => { }); }
  await p.waitForSelector('.mepop .meitem', { timeout: 5000 });
  const focusRow = () => p.evaluateHandle(() => [...document.querySelectorAll('.mepop .meitem')].find(e => e.textContent.includes('Modo foco')));
  // clique: liga até eu desligar, cartão continua aberto
  await (await focusRow()).click(); await sleep(300);
  const s1 = await p.evaluate(() => ({ f: window.__lc.S.prefs.focusUntil, card: !!document.querySelector('.mepop'), menu: !!document.querySelector('.menu') }));
  ok(s1.f === true && s1.card && !s1.menu, 'clique liga "até eu desligar" e o cartão não some', s1);
  // passar o mouse abre os horários ao lado
  await p.mouse.move(5, 5); await sleep(300);
  const r = await (await focusRow()).boundingBox(); await p.mouse.move(r.x + 40, r.y + r.height / 2); await sleep(300);
  const fly = await p.evaluate(() => ({ items: [...document.querySelectorAll('.mefly .stat')].map(e => e.textContent.trim()), on: document.querySelector('.mefly .stat.on')?.textContent, card: !!document.querySelector('.mepop') }));
  ok(fly.items.includes('24 horas') && !fly.items.some(t => t.includes('amanhã')) && fly.card, 'mouse em cima abre os horários ao lado, com "24 horas"', fly.items);
  ok(fly.on === 'Até eu desligar', '"Até eu desligar" aparece marcado', fly.on);
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  // escolhe 1 hora
  const t0 = Date.now();
  await (await p.evaluateHandle(() => [...document.querySelectorAll('.mefly .stat')].find(e => e.textContent.trim() === '1 hora'))).click(); await sleep(300); // com o mouse, como a pessoa
  const s2 = await p.evaluate(() => ({ f: window.__lc.S.prefs.focusUntil, card: !!document.querySelector('.mepop'), fly: !!document.querySelector('.mefly') }));
  ok(typeof s2.f === 'number' && Math.abs(s2.f - t0 - 3600e3) < 10e3 && s2.card && !s2.fly, '1 hora: liga por 1 h, horários fecham, cartão fica', s2);
  // clique de novo desliga
  await (await focusRow()).click(); await sleep(300);
  ok(await p.evaluate(() => !window.__lc.S.prefs.focusUntil), 'clicar de novo desliga');
  // seta abre os horários (celular), sem ligar
  await p.evaluate(() => [...document.querySelectorAll('.mepop .meitem')].find(e => e.textContent.includes('Modo foco')).querySelector('.mearrow').click()); await sleep(200);
  ok(await p.evaluate(() => !!document.querySelector('.mefly .mflyhead') && !window.__lc.S.prefs.focusUntil), 'clique na seta abre os horários sem ligar');
} finally { await browser.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
