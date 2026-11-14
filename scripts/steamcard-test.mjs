// Cartão de links da loja da Steam no chat (public/steamcard.js + /api/steam-apps em server/discover.js), com uma Steam
// FALSA local (jogos fictícios): capa, nome, descrição, tags, avaliações, lançamento, preço com desconto e prazo, Steam
// Deck, "Em breve", vários formatos de link, link de jogo que não existe (fica só o link), "jogando agora" e a opção
// de desligar prévias de links.
// Uso: node scripts/steamcard-test.mjs  (prints em .testshots/steamcard)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/steamcard', PORT = 3311, MOCK = 4591, BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`, DATA = './.testdata-steamcard';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const svg = (c, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="460" height="215" fill="url(#g)"/><text x="28" y="130" font-size="40" font-weight="700" font-family="sans-serif" fill="#fff">${t}</text></svg>`;
const now = Date.now(), day = 864e5, s = (t) => Math.floor(t / 1000);
const GAMES = {
  7001: { name: 'Estrela Cadente', color: '#7b4cff', desc: 'Explore uma galáxia viva com até 4 amigos, construa sua nave e descubra planetas gerados a cada partida.', dev: 'Estúdio Órbita',
    price: 'R$ 39,99', old: 'R$ 99,99', pct: 60, end: now + 3 * day, rel: now - 400 * day, tags: [10, 11, 13], reviews: [94, 18342, 'Extremamente positivas'], deck: 3, mac: true, linux: true },
  7002: { name: 'Arena Rápida', color: '#e8484f', desc: 'Tiro tático 5v5 gratuito com partidas de 20 minutos.', dev: 'Fliperama Games', free: true, rel: now - 900 * day, tags: [10, 12], reviews: [58, 412003, 'Neutras'], deck: 1 },
  7003: { name: 'Fazendinha Tranquila 2', color: '#23a55a', desc: 'Plante, pesque e faça amigos na vila.', dev: 'Pato Studio', soon: true, when: 'Primeiro trimestre de 2027', tags: [12, 14], early: false },
};
const TAGS = { 10: 'Ação', 11: 'Exploração', 12: 'Multijogador', 13: 'Cooperativo', 14: 'Simulação' };
const sitem = (a) => { const g = GAMES[a]; if (!g) return { success: 0, appid: a };
  return { success: 1, appid: a, name: g.name, is_free: !!g.free, tagids: g.tags, assets: { asset_url_format: `img/${a}/\${FILENAME}`, header: 'h.svg', small_capsule: 's.svg' },
    basic_info: { short_description: g.desc, developers: [{ name: g.dev }] },
    release: g.soon ? { is_coming_soon: true, custom_release_date_message: g.when, coming_soon_display: 'text_comingsoon' } : { steam_release_date: s(g.rel) },
    platforms: { windows: true, mac: !!g.mac, steamos_linux: !!g.linux, steam_deck_compat_category: g.deck || 0 },
    best_purchase_option: g.free || g.soon ? null : { formatted_final_price: g.price, formatted_original_price: g.old, discount_pct: g.pct, active_discounts: [{ discount_end_date: s(g.end) }] },
    reviews: g.reviews ? { summary_filtered: { percent_positive: g.reviews[0], review_count: g.reviews[1], review_score_label: g.reviews[2] } } : null };
};
let hits = 0;
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M);
  if (u.pathname.startsWith('/sapi/')) { const k = u.pathname.slice(6).replace(/\/v1\/?$/, ''); r.setHeader('content-type', 'application/json');
    if (k === 'IStoreBrowseService/GetItems') { hits++; return r.end(JSON.stringify({ response: { store_items: JSON.parse(u.searchParams.get('input_json')).ids.map(x => sitem(x.appid)) } })); }
    if (k === 'IStoreService/GetTagList') return r.end(JSON.stringify({ response: { tags: Object.entries(TAGS).map(([tagid, name]) => ({ tagid: +tagid, name })) } }));
    return r.end('{}'); }
  if (u.pathname.startsWith('/img/')) { const a = +u.pathname.split('/')[2]; r.setHeader('content-type', 'image/svg+xml'); return r.end(svg(GAMES[a]?.color || '#555', GAMES[a]?.name || '')); }
  r.statusCode = 404; r.end();
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', news: [], epic: false, tournaments: false }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ta = (await call('', 'POST', '/register', { username: 'ana', password: 'Teste.senha-123' })).token;
  const tb = (await call('', 'POST', '/register', { username: 'beto', password: 'Teste.senha-123' })).token;
  const g = await call(ta, 'POST', '/guilds', { name: 'Resenha' }); await call(tb, 'POST', '/invites/' + (await call(ta, 'POST', `/guilds/${g.id}/invites`)).code);
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ta);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const cid = await P.evaluate((gid) => { const c = window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0); window.__lc.go(gid, c.id); return c.id; }, g.id);
  // a API do servidor
  const api = await call(ta, 'GET', '/steam-apps?ids=7001,7003,999');
  ok(api['7001']?.desc && api['7001'].discount === 60 && api['7001'].ends > now && api['7001'].deck === 'verified' && api['7001'].platforms.join() === 'windows,mac,linux' && api['7001'].released, '/api/steam-apps: descrição, desconto com prazo, Deck e plataformas', api['7001']);
  ok(api['7003']?.soon && api['7003'].when === 'Primeiro trimestre de 2027' && !api['999'], '/api/steam-apps: "em breve" com a mensagem da loja; jogo que não existe fica de fora', api['7003']);
  const h0 = hits; await call(ta, 'GET', '/steam-apps?ids=7001'); ok(hits === h0, 'jogo já buscado vem do cache do servidor (a Steam não é chamada de novo)');
  ok(Object.keys(await call(ta, 'GET', '/steam-apps?ids=abc,../x')).length === 0, 'ids inválidos são ignorados');

  await call(tb, 'POST', `/channels/${cid}/messages`, { content: 'olha essa promo https://store.steampowered.com/app/7001/Estrela_Cadente/?utm_source=x' });
  await call(tb, 'POST', `/channels/${cid}/messages`, { content: 'bora? https://s.team/a/7002 e esse que vai sair https://steamcommunity.com/app/7003' });
  await call(tb, 'POST', `/channels/${cid}/messages`, { content: 'esse não existe https://store.steampowered.com/app/999/' });
  await P.waitForFunction(() => document.querySelectorAll('.steamcard:not(.loading)').length >= 3); await sleep(800);
  const cards = await P.evaluate(() => [...document.querySelectorAll('.steamcard')].map(c => ({ app: c.dataset.app, title: c.querySelector('.sc-title')?.textContent, price: c.querySelector('.sc-price')?.innerText.replace(/\s+/g, ' '),
    ends: c.querySelector('.sc-ends')?.textContent || '', tags: [...c.querySelectorAll('.sc-tag')].map(t => t.textContent), meta: c.querySelector('.sc-meta')?.innerText.replace(/\s+/g, ' '), img: !!c.querySelector('.sc-hero img') })));
  ok(cards.length === 3 && !cards.some(c => c.app === '999'), '3 cartões (o jogo que não existe fica só como link)', cards.map(c => c.app));
  const c1 = cards.find(c => c.app === '7001'), c2 = cards.find(c => c.app === '7002'), c3 = cards.find(c => c.app === '7003');
  ok(c1.title === 'Estrela Cadente' && /-60%/.test(c1.price) && /R\$ 99,99/.test(c1.price) && /R\$ 39,99/.test(c1.price) && /Promoção até/.test(c1.ends) && c1.img, 'promoção: -60%, preço antigo riscado, novo e até quando', c1);
  ok(c1.tags.includes('Ação') && c1.tags.includes('Verificado no Steam Deck') && /Extremamente positivas · 94%/.test(c1.meta) && /Lançado em/.test(c1.meta) && /Linux/.test(c1.meta), 'tags, Deck, avaliações, lançamento e plataformas', c1);
  ok(/Gratuito/.test(c2.price) && /Neutras/.test(c2.meta) && !c2.tags.some(t => /Deck/.test(t)), 'gratuito e avaliação neutra (link s.team)', c2);
  ok(!c3.price && /Primeiro trimestre de 2027/.test(c3.meta), 'em breve: sem preço, com a data da loja (link da comunidade)', c3);
  ok(await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"] .sc-rev').classList.contains('good') && document.querySelector('.steamcard[data-app="7002"] .sc-rev').classList.contains('mixed')), 'cor da avaliação pela porcentagem');
  ok(await P.evaluate(() => [...document.querySelectorAll('.steamcard[data-app="7001"] a')].every(a => a.href.startsWith('steam://store/7001') || a.href === 'https://store.steampowered.com/app/7001/')), 'links vão para a loja (sem o utm do link original) e para o app da Steam');
  ok(await P.evaluate(() => !document.querySelector('.steamcard[data-app="7001"] .sc-now').childElementCount), 'sem ninguém jogando: sem a linha "jogando agora"');
  // beto começa a jogar Estrela Cadente
  await P.evaluate(async () => { const S = window.__lc.S, b = [...S.users.values()].find(u => u.username === 'beto'); const m = await window.__lc.import('activity.js');
    m.onActivityUpdate({ user_id: b.id, platform: 'steam', activity: { user_id: b.id, platform: 'steam', game: { id: '7001', title: 'Estrela Cadente' }, since: Date.now() - 600e3 } }); });
  await sleep(200);
  const nowTxt = await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"] .sc-now').textContent);
  ok(/beto está jogando agora/i.test(nowTxt), '"jogando agora" aparece na hora em que a atividade muda', nowTxt);
  await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"]').scrollIntoView({ block: 'center' })); await sleep(300);
  await P.screenshot({ path: OUT + '/01-cartoes.png' });
  await (await P.$('.steamcard[data-app="7001"]')).screenshot({ path: OUT + '/02-cartao-promocao.png' });
  await P.evaluate(() => [...document.querySelectorAll('.steamcard[data-app="7001"] .sc-btn')].find(b => /Quem joga/.test(b.textContent)).click()); await sleep(400);
  ok(await P.evaluate(() => /Estrela Cadente/.test(document.querySelector('.gamemodal h2')?.textContent || '')), '"Quem joga" abre o popup do jogo');
  await P.screenshot({ path: OUT + '/03-quem-joga.png' });
  await P.evaluate(() => document.querySelector('.gm-x').click()); await sleep(300);
  ok(await P.evaluate(() => !document.querySelector('.gamemodal')), 'popup fecha');
  // celular
  await P.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await sleep(500);
  const wide = await P.evaluate(() => { const c = document.querySelector('.steamcard[data-app="7001"]'); return { over: document.documentElement.scrollWidth > innerWidth, w: c.getBoundingClientRect().width }; });
  ok(!wide.over && wide.w <= 390, 'no celular o cartão cabe na tela', wide);
  await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"]').scrollIntoView({ block: 'center' })); await sleep(300);
  await P.screenshot({ path: OUT + '/04-celular.png' });
  await P.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  // desligar prévias
  await P.evaluate(async () => { window.__lc.S.prefs.embedLinks = false; window.__lc.renderMessages?.(true); }); await sleep(400);
  const off = await P.evaluate(() => document.querySelectorAll('.steamcard').length);
  if (off) { await P.reload(); await P.waitForSelector('#rail .rail-wrap'); await P.evaluate((gid, cid) => { window.__lc.S.prefs.embedLinks = false; window.__lc.go(gid, cid); }, g.id, cid); await sleep(1200); }
  ok(await P.evaluate(() => document.querySelectorAll('.steamcard').length === 0), 'com "Mostrar prévias de links" desligado não aparece cartão');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
