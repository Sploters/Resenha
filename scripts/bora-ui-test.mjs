// "Bora?" na interface, com duas pessoas: Ana abre a janela pelo topo dos canais, escolhe "Só resenhar", "Agora" e 2
// pessoas, manda; Beto recebe o aviso com Tô dentro / Mais tarde / Hoje não, topa; os dois veem "Formou!" com Entrar, e
// o cartão com o contador aparece no topo dos canais. Uso: node scripts/bora-ui-test.mjs  (capturas em .testshots/bora-*.png)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { ownServer } from './test-server.mjs';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', SH = '.testshots';
fs.mkdirSync(SH, { recursive: true });
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = await ownServer('boraui', 3398, 41398, { DISCOVER_OFF: '1' });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const ana = await reg('ana'), beto = await reg('beto');
const g = await call(ana.tok, 'POST', '/guilds', { name: 'Turma' }); await call(beto.tok, 'POST', '/invites/' + (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code);
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
async function page(u) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, u.tok);
  await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p;
}
try {
  const A = await page(ana), B = await page(beto);
  for (const P of [A, B]) await P.evaluate((gid) => window.__lc.go(gid), g.id);
  await A.waitForSelector('#side-list .borarow');
  await A.click('#side-list .borarow');
  await A.waitForSelector('.bora-modal .bora-chip');
  await A.evaluate(() => { [...document.querySelectorAll('.bora-modal .bora-chip')].find(b => /Só resenhar/.test(b.textContent)).click(); });
  await A.evaluate(() => { [...document.querySelectorAll('.bora-modal .bora-chip')].find(b => /^2/.test(b.textContent)).click(); });
  await A.type('.bora-modal > input', 'quem topa uma resenha?');
  await sleep(200); await A.screenshot({ path: `${SH}/bora-janela.png` });
  await A.evaluate(() => document.querySelector('.bora-foot .btn.green').click());
  await A.waitForSelector('#side-list .side-bora .bora-card', { timeout: 5000 }).catch(() => { });
  ok(await A.evaluate(() => /Bora resenhar\?/.test(document.querySelector('#side-list .side-bora .bora-card')?.textContent || '')), 'Ana: o cartão "Bora resenhar?" aparece no topo dos canais');
  await B.waitForSelector('#bora-banner', { timeout: 6000 }).catch(() => { });
  const ban = await B.evaluate(() => document.querySelector('#bora-banner')?.textContent || '');
  ok(/ana: Bora resenhar\?/.test(ban) && /Tô dentro/.test(ban) && /Mais tarde/.test(ban) && /Hoje não/.test(ban), 'Beto: aviso com Tô dentro / Mais tarde / Hoje não', ban.slice(0, 90));
  ok(await B.evaluate(() => /1\/2 topa/.test(document.querySelector('#side-list .bora-card')?.textContent || '')), 'Beto: contador 1/2 no cartão da lista de canais');
  await sleep(300); await B.screenshot({ path: `${SH}/bora-aviso.png` });
  await B.evaluate(() => [...document.querySelectorAll('#bora-banner .btn')].find(b => /Tô dentro/.test(b.textContent)).click());
  await B.waitForFunction(() => /Formou/.test(document.querySelector('#bora-banner')?.textContent || ''), { timeout: 6000 }).catch(() => { });
  ok(await B.evaluate(() => /Formou/.test(document.querySelector('#bora-banner')?.textContent || '') && /Entrar/.test(document.querySelector('#bora-banner')?.textContent || '')), 'Beto: "Formou!" com Entrar');
  await A.waitForFunction(() => /Formou! Sala/.test(document.querySelector('#side-list .bora-card')?.textContent || ''), { timeout: 6000 }).catch(() => { });
  ok(await A.evaluate(() => /Formou! Sala/.test(document.querySelector('#side-list .bora-card')?.textContent || '') && /2\/2|Formou/.test(document.querySelector('#side-list .bora-card')?.textContent || '')), 'Ana: o cartão vira "Formou! Sala …" ao vivo');
  await sleep(300); await A.screenshot({ path: `${SH}/bora-formou.png` });
  await B.evaluate(() => [...document.querySelectorAll('#bora-banner .btn')].find(b => /Entrar/.test(b.textContent)).click());
  await B.waitForFunction(() => window.__lc.voice?.channelId, { timeout: 15000 }).catch(() => { });
  ok(await B.evaluate(() => !!window.__lc.voice?.channelId), 'Beto: Entrar coloca na sala de voz');
  // Ativo agora mostra o Bora e o botão
  await A.evaluate(() => window.__lc.go('@me')); await sleep(800);
  ok(await A.evaluate(() => !!document.querySelector('#active-now .play-cta') && !!document.querySelector('.an-bora .bora-card')), 'Ativo agora: o Bora com o contador e o botão único "Bora jogar?"');
  await A.evaluate(() => document.querySelector('.an-bora')?.scrollIntoView()); await sleep(300); await A.screenshot({ path: `${SH}/bora-ativo.png` });
  // Configurações → Notificações: Bora e celular
  await A.evaluate(async () => { const n = await window.__lc.import('nav.js'); n.openSettings('notifications', n.ctxSettings()); }); await sleep(800);
  ok(await A.evaluate(() => !!document.querySelector('.bora-push .bora-topic input')), 'Configurações → Notificações: avisos no celular (ntfy)');
  await A.evaluate(() => document.querySelector('.bora-push')?.scrollIntoView()); await sleep(300); await A.screenshot({ path: `${SH}/bora-config.png` });
} catch (e) { console.log('  ERRO', e); fails++; }
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nBORA UI OK'); process.exit(fails ? 1 : 0);
