// Selos das abas de canal (plugins.js): o canal aberto não fica com o ponto de não lida depois de lido, e a aba de outro
// canal ganha o ponto quando chega mensagem lá e o perde ao abrir. Antes a barra de abas só era redesenhada ao navegar:
// o ponto de uma não lida já lida ficava na aba do canal aberto.
// Uso: node scripts/tab-unread-test.mjs
import puppeteer from 'puppeteer-core';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('tabunread', 3406, 41335);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const reg = async (n) => { const r = await api('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await api(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const a = await reg('alice'), b = await reg('bob');
  const g = await api(a.tok, 'POST', '/guilds', { name: 'G' }); const inv = await api(a.tok, 'POST', `/guilds/${g.id}/invites`); await api(b.tok, 'POST', `/invites/${inv.code}`);
  const c2 = await api(a.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'outro', type: 0 });
  const p = await browser.newPage(); await p.setViewport({ width: 1400, height: 900 });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.tok);
  await p.goto(BASE); await p.waitForFunction(() => window.__lc?.S?.synced, { timeout: 30000 });
  const ch = await p.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0 && c.name === 'geral')?.id || window.__lc.S.guilds.get(gid).channels.find(c => c.type === 0).id, g.id);
  // mensagem antes de abrir o canal: não lida; abrir marca como lida
  await api(b.tok, 'POST', `/channels/${ch}/messages`, { content: 'antes de abrir' }); await sleep(500);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, ch); await p.waitForSelector('#chtabs .ct-tab.active'); await sleep(800);
  const tabBadges = () => p.evaluate(() => [...document.querySelectorAll('#chtabs .ct-tab')].map(t => ({ active: t.classList.contains('active'), title: t.title, badge: t.querySelector('.ct-pill, .ct-dot')?.className || null })));
  const t1 = await tabBadges();
  ok(t1.find(t => t.active) && !t1.find(t => t.active).badge, 'canal aberto: a aba não fica com o ponto da mensagem já lida', t1);
  await api(b.tok, 'POST', `/channels/${ch}/messages`, { content: `<@${a.id}> com o canal aberto` }); await sleep(800);
  const t2 = await tabBadges();
  ok(!t2.find(t => t.active).badge, 'menção com o canal aberto: a aba continua sem selo', t2);
  // 2ª aba no outro canal; mensagem no 1º: a aba dele ganha o ponto; ao voltar, some
  await p.click('#chtabs .ct-add'); await sleep(300);
  await p.evaluate((gid, cid) => window.__lc.go(gid, cid), g.id, c2.id); await sleep(800);
  await api(b.tok, 'POST', `/channels/${ch}/messages`, { content: 'chegou com a outra aba aberta' }); await sleep(800);
  const t3 = await tabBadges(), other = t3.find(t => !t.active);
  ok(other?.badge === 'ct-dot', 'mensagem no canal da outra aba: o ponto aparece nela', t3);
  await api(b.tok, 'POST', `/channels/${ch}/messages`, { content: `<@${a.id}> menção na outra aba` }); await sleep(800);
  const t4 = await tabBadges();
  ok(t4.find(t => !t.active)?.badge === 'ct-pill', 'menção no canal da outra aba: vira o número', t4);
  await p.evaluate(() => [...document.querySelectorAll('#chtabs .ct-tab')].find(t => !t.classList.contains('active')).click()); await sleep(1000);
  const t5 = await tabBadges();
  ok(t5.every(t => !t.badge), 'voltando à aba: o selo some', t5);
} catch (e) { console.log('  FAIL', e.message); fails++; }
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
