// Alerta de promoção da wishlist (checkDeals em server/games.js + caixa de entrada → Promoções em public/games.js),
// com uma Steam FALSA local cujos preços mudam durante o teste: jogo visto pela 1ª vez não avisa, entrar em promoção
// avisa na hora (GAME_DEAL) quem quer, com quem mais quer; "50% ou mais" e "Não avisar" respeitados; desconto que
// aumenta 10+ pontos avisa de novo; mesmo desconto não repete; aba Promoções, selo da caixa de entrada e apagar aviso.
// Uso: node scripts/deals-test.mjs  (prints em .testshots/deals)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/deals', PORT = 3313, MOCK = 4593, BASE = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK}`, DATA = './.testdata-deals', CYCLE = 1200;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const waitFor = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };
const now = Date.now(), day = 864e5, s = (t) => Math.floor(t / 1000);
const svg = (c, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="${c}"/><text x="24" y="128" font-size="34" font-weight="700" font-family="sans-serif" fill="#fff">${t}</text></svg>`;
// preços que o teste muda: centavos cheios e desconto atual
const GAMES = { 7001: { name: 'Estrela Cadente', color: '#7b4cff', cents: 9999, pct: 0 }, 7002: { name: 'Corrida Neon', color: '#d946ef', cents: 5990, pct: 0 } };
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const sitem = (a) => { const g = GAMES[a]; if (!g) return { success: 0, appid: a };
  return { success: 1, appid: a, name: g.name, tagids: [], assets: { asset_url_format: `img/${a}/\${FILENAME}`, header: 'h.svg', small_capsule: 's.svg' },
    best_purchase_option: { formatted_final_price: brl(Math.round(g.cents * (100 - g.pct) / 100)), formatted_original_price: brl(g.cents), discount_pct: g.pct, active_discounts: g.pct ? [{ discount_end_date: s(now + 3 * day) }] : [] } };
};
let storeCalls = 0;
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M); r.setHeader('content-type', 'application/json');
  if (u.pathname.startsWith('/sapi/IStoreBrowseService/GetItems')) { storeCalls++; return r.end(JSON.stringify({ response: { store_items: JSON.parse(u.searchParams.get('input_json')).ids.map(x => sitem(x.appid)) } })); }
  if (u.pathname.startsWith('/sapi/IStoreService/GetTagList')) return r.end(JSON.stringify({ response: { tags: [] } }));
  if (u.pathname.startsWith('/img/')) { const a = u.pathname.split('/')[2]; r.setHeader('content-type', 'image/svg+xml'); return r.end(svg(GAMES[a]?.color || '#555', GAMES[a]?.name || '')); }
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', news: [], epic: false, tournaments: false }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', GAMES_SYNC: '0', DEALS_MS: String(CYCLE), DEALS_FIRST_MS: '400' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id }; };
const cycles = async (n) => { const c0 = storeCalls; await waitFor(() => storeCalls >= c0 + n, CYCLE * (n + 3)); await sleep(300); };
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), beto = await reg('beto'), carla = await reg('carla'), davi = await reg('davi');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' }); const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const U of [beto, carla]) await call(U.tok, 'POST', '/invites/' + inv);
  for (const U of [ana, beto, carla, davi]) await call(U.tok, 'PUT', '/wishlist/7001');
  await call(ana.tok, 'PUT', '/wishlist/7002');
  ok((await call(beto.tok, 'PATCH', '/games/me', { deal_alerts: 'big' })).deal_alerts === 'big', 'beto: avisar só com 50% ou mais');
  await call(carla.tok, 'PATCH', '/games/me', { deal_alerts: 'off' });
  ok((await call(ana.tok, 'PATCH', '/games/me', { deal_alerts: 'xyz' })).status === 400, 'opção inválida é recusada');

  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ana.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  await P.evaluate((gid) => { const c = window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0); window.__lc.go(gid, c.id); }, g.id);

  await P.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t) window.__toasts.push(t.textContent); }).observe(document.body, { childList: true }); });
  await cycles(2); // preço visto pela 1ª vez: só guarda
  ok((await call(ana.tok, 'GET', '/deals')).alerts.length === 0, 'preço visto pela primeira vez não vira aviso');

  GAMES[7001].pct = 30; await cycles(2);
  const a1 = await call(ana.tok, 'GET', '/deals');
  ok(a1.alerts.length === 1 && a1.alerts[0].discount === 30 && a1.alerts[0].price === 'R$ 69,99' && a1.alerts[0].old === 'R$ 99,99' && a1.alerts[0].ends > now && a1.unseen === 1, 'entrou em promoção (-30%): ana é avisada com preço, preço antigo e prazo', a1.alerts[0]);
  ok(a1.alerts[0].others.sort().join() === [beto.id, carla.id].sort().join(), 'com quem mais quer e ela pode ver (beto e carla; davi não divide servidor)', a1.alerts[0].others);
  ok((await call(beto.tok, 'GET', '/deals')).alerts.length === 0 && (await call(carla.tok, 'GET', '/deals')).alerts.length === 0, '"50% ou mais" (beto) e "Não avisar" (carla) não recebem -30%');
  ok((await call(davi.tok, 'GET', '/deals')).alerts.length === 1, 'davi (fora do servidor) também é avisado, sem ver os outros');
  ok(await P.evaluate(() => window.__lc.S.deals.unseen === 1 && /1/.test(document.querySelector('.inbox-btn .ibadge')?.textContent || '')), 'na hora: aviso no app e selo na caixa de entrada', await P.evaluate(() => ({ u: window.__lc.S.deals.unseen, b: document.querySelector('.inbox-btn .ibadge')?.textContent })));
  ok(await P.evaluate(() => window.__toasts.some(t => /Estrela Cadente \(da sua wishlist\) está em promoção: -30% · R\$ 69,99/.test(t))), 'toast "Estrela Cadente (da sua wishlist) está em promoção"');

  await cycles(2);
  ok((await call(ana.tok, 'GET', '/deals')).alerts.length === 1, 'mesmo desconto nas próximas conferências: não repete');
  GAMES[7001].pct = 35; await cycles(2);
  ok((await call(ana.tok, 'GET', '/deals')).alerts.length === 1, 'desconto que sobe pouco (30 → 35%) não avisa de novo');
  GAMES[7001].pct = 60; await cycles(2);
  const a2 = await call(ana.tok, 'GET', '/deals'), b2 = await call(beto.tok, 'GET', '/deals');
  ok(a2.alerts.length === 1 && a2.alerts[0].discount === 60 && a2.unseen === 1, 'desconto maior (60%) avisa de novo e substitui o aviso de -30%', a2.alerts.map(x => x.discount));
  ok(b2.alerts.length === 1 && b2.alerts[0].discount === 60, 'beto ("50% ou mais") é avisado com -60%');
  ok((await call(carla.tok, 'GET', '/deals')).alerts.length === 0, 'carla continua sem aviso');
  ok(!a2.alerts.some(x => x.appid === '7002'), 'jogo sem desconto não avisa');

  // aba Promoções
  await P.evaluate(() => document.querySelector('.inbox-btn').click()); await sleep(500);
  await P.evaluate(() => [...document.querySelectorAll('.ib-tabs button')].find(b => /Promoções/.test(b.textContent)).click());
  await P.waitForSelector('.ib-body .deal'); await sleep(800);
  const deals = await P.evaluate(() => [...document.querySelectorAll('.ib-body .deal')].map(d => ({ txt: d.innerText.replace(/\n+/g, ' | '), isNew: d.classList.contains('new') })));
  ok(deals.length === 1 && /-60%/.test(deals[0].txt) && /R\$ 40,00/.test(deals[0].txt) && /beto e carla também querem/.test(deals[0].txt) && deals[0].isNew, 'aba Promoções: o aviso, com preço e "beto e carla também querem"', deals);
  await (await P.$('.inboxpop')).screenshot({ path: OUT + '/01-promocoes.png' });
  ok(await waitFor(() => P.evaluate(() => window.__lc.S.deals.unseen === 0 && !document.querySelector('.inbox-btn .ibadge'))), 'abrir a aba marca como visto e o selo some');
  ok((await call(ana.tok, 'GET', '/deals')).unseen === 0, 'visto também no servidor (outros aparelhos)');
  await P.evaluate(() => document.querySelector('.ib-body .deal .deal-x').click()); await sleep(400);
  ok((await call(ana.tok, 'GET', '/deals')).alerts.length === 0 && await P.evaluate(() => document.querySelectorAll('.ib-body .deal').length === 0), 'apagar um aviso');
  await P.keyboard.press('Escape'); await sleep(200);
  // Configurações
  await P.evaluate(() => window.__lc.openSettings('connections'));
  await P.waitForFunction(() => /Avisar quando um jogo da minha wishlist entrar em promoção/.test(document.body.innerText)); await sleep(300);
  ok(true, 'Configurações → Contas vinculadas: opção do alerta de promoção');
  await P.evaluate(() => [...document.querySelectorAll('.row, .srow, div')].find(e => /^Avisar quando um jogo/.test(e.innerText || ''))?.scrollIntoView({ block: 'center' })); await sleep(300);
  await P.screenshot({ path: OUT + '/02-configuracoes.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
