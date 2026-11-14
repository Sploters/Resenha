// Biblioteca e wishlist (server/games.js + public/games.js) com uma Steam FALSA local (login OpenID, biblioteca, wishlist
// e loja com jogos fictícios): sincronizar ao vincular, quem tem/quem quer no cartão do link, botão Quero, Wishlist do
// servidor (com "Em promoção"), regras de quem vê (servidores / só amigos / ninguém / bloqueio), biblioteca privada,
// item que veio da Steam, desvincular, Configurações e "Jogos e wishlist" de alguém.
// Uso: node scripts/games-test.mjs  (prints em .testshots/games)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/games', PORT = 3312, MOCK = 4592, BASE = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK}`, DATA = './.testdata-games';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const waitFor = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };
const now = Date.now(), day = 864e5, s = (t) => Math.floor(t / 1000);
const svg = (c, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="460" height="215" fill="url(#g)"/><text x="24" y="128" font-size="34" font-weight="700" font-family="sans-serif" fill="#fff">${t}</text></svg>`;
const GAMES = {
  7001: { name: 'Estrela Cadente', color: '#7b4cff', price: 'R$ 39,99', old: 'R$ 99,99', pct: 60 },
  7002: { name: 'Arena Rápida', color: '#e8484f', free: true },
  7003: { name: 'Fazendinha Tranquila 2', color: '#23a55a', soon: true },
  7004: { name: 'Corrida Neon', color: '#d946ef', price: 'R$ 44,92', old: 'R$ 59,90', pct: 25 },
  7005: { name: 'Blocos & Picaretas', color: '#f0a020', price: 'R$ 29,90' },
};
const sitem = (a) => { const g = GAMES[a]; if (!g) return { success: 0, appid: a };
  return { success: 1, appid: a, name: g.name, is_free: !!g.free, tagids: [10], assets: { asset_url_format: `img/${a}/\${FILENAME}`, header: 'h.svg', small_capsule: 's.svg' },
    basic_info: { short_description: 'Jogo fictício de teste.', developers: [{ name: 'Estúdio Teste' }] }, release: g.soon ? { is_coming_soon: true, custom_release_date_message: '2027' } : { steam_release_date: s(now - 300 * day) },
    platforms: { windows: true }, best_purchase_option: g.free || g.soon ? null : { formatted_final_price: g.price, formatted_original_price: g.old || '', discount_pct: g.pct || 0, active_discounts: g.pct ? [{ discount_end_date: s(now + 2 * day) }] : [] },
    reviews: { summary_filtered: { percent_positive: 88, review_count: 5000, review_score_label: 'Muito positivas' } } };
};
// contas da Steam fictícias: biblioteca (minutos) e wishlist
const SID = (n) => '7656119800000000' + n;
const LIB = { [SID(1)]: { 7001: 7200, 7005: 95 }, [SID(2)]: { 7001: 30, 7004: 600 }, [SID(3)]: null /* privada */ };
const WISH = { [SID(1)]: [7002, 7003, 7004], [SID(2)]: [7002], [SID(3)]: [] };
let wishCalls = 0;
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M); r.setHeader('content-type', 'application/json');
  if (u.pathname === '/openid/login' && q.method === 'POST') { r.setHeader('content-type', 'text/plain'); return r.end('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries')) return r.end(JSON.stringify({ response: { players: u.searchParams.get('steamids').split(',').map(id => ({ steamid: id, personaname: 'Steam' + id.slice(-1), communityvisibilitystate: 3, personastate: 1 })) } }));
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) { const l = LIB[u.searchParams.get('steamid')]; return r.end(JSON.stringify({ response: l ? { game_count: Object.keys(l).length, games: Object.entries(l).map(([appid, m]) => ({ appid: +appid, name: GAMES[appid].name, playtime_forever: m, rtime_last_played: s(now - day) })) } : {} })); }
  if (u.pathname.startsWith('/IWishlistService/GetWishlist')) { wishCalls++; return r.end(JSON.stringify({ response: { items: (WISH[u.searchParams.get('steamid')] || []).map((appid, i) => ({ appid, priority: i, date_added: s(now - i * day) })) } })); }
  if (u.pathname.startsWith('/sapi/IStoreBrowseService/GetItems')) return r.end(JSON.stringify({ response: { store_items: JSON.parse(u.searchParams.get('input_json')).ids.map(x => sitem(x.appid)) } }));
  if (u.pathname.startsWith('/sapi/IStoreService/GetTagList')) return r.end(JSON.stringify({ response: { tags: [{ tagid: 10, name: 'Ação' }] } }));
  if (u.pathname.startsWith('/img/')) { const a = u.pathname.split('/')[2]; r.setHeader('content-type', 'image/svg+xml'); return r.end(svg(GAMES[a]?.color || '#555', GAMES[a]?.name || '')); }
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', news: [], epic: false, tournaments: false }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', STEAM_OPENID_URL: M + '/openid/login', STEAM_API_BASE: M, STEAM_API_KEY: 'CHAVE-DE-TESTE', GAMES_SYNC: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id, name: n }; };
// vincula a Steam pelo fluxo de verdade (OpenID com o provedor falso)
async function link(U, n) {
  const { url } = await call(U.tok, 'POST', '/integrations/steam/link');
  const rt = new URL(url).searchParams.get('openid.return_to'), u = new URL(rt);
  for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': M + '/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.identity': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.return_to': rt, 'openid.response_nonce': 'n' + n, 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' })) u.searchParams.set(k, v);
  await fetch(u);
  return waitFor(async () => (await call(U.tok, 'GET', '/games/me')).steam?.synced_at);
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), beto = await reg('beto'), carla = await reg('carla'), eva = await reg('eva'), davi = await reg('davi');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' }); const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const U of [beto, carla, eva]) await call(U.tok, 'POST', '/invites/' + inv);
  ok((await call(davi.tok, 'GET', `/guilds/${g.id}/wishlist`)).status === 403, 'quem não é do servidor não vê a wishlist dele');

  ok(await link(beto, 1), 'beto vincula a Steam e a biblioteca + wishlist sincronizam sozinhas');
  ok(await link(carla, 2), 'carla vincula a Steam');
  ok(await link(eva, 3), 'eva vincula a Steam (biblioteca privada)');
  const bm = await call(beto.tok, 'GET', '/games/me'), em = await call(eva.tok, 'GET', '/games/me');
  ok(bm.steam.library_state === 'ok' && bm.steam.library_count === 2 && bm.steam.wishlist_count === 3 && bm.wishlist.length === 3 && bm.share === 'servers', 'beto: 2 jogos na biblioteca, 3 na wishlist, compartilhando com os servidores (padrão)', bm.steam);
  ok(em.steam.library_state === 'private', 'eva: biblioteca privada na Steam é avisada', em.steam);
  await call(carla.tok, 'PATCH', '/games/me', { share: 'friends' });

  // quem ana vê
  let pp = await call(ana.tok, 'GET', '/games/people?ids=7001,7002,7004,abc');
  ok(pp['7001'].owners.length === 1 && pp['7001'].owners[0].user_id === beto.id && pp['7001'].owners[0].minutes === 7200 && !pp.abc, 'ana vê beto com 120 h de Estrela Cadente; carla (só amigos) fica escondida', pp['7001']);
  ok(pp['7002'].wish.join() === beto.id && pp['7004'].wish.join() === beto.id && pp['7004'].owners.length === 0, 'ana vê o que beto quer, não o da carla', { w2: pp['7002'].wish, o4: pp['7004'].owners });
  ok((await call(davi.tok, 'GET', '/games/people?ids=7001'))['7001'].owners.length === 0, 'davi (sem servidor nem amizade em comum) não vê ninguém');
  // amizade libera a carla
  await call(ana.tok, 'POST', '/relationships', { username: 'carla' }); await call(carla.tok, 'PUT', '/relationships/' + ana.id, {});
  pp = await call(ana.tok, 'GET', '/games/people?ids=7001');
  ok(pp['7001'].owners.map(o => o.user_id).sort().join() === [beto.id, carla.id].sort().join(), 'virando amigas, ana passa a ver os jogos da carla', pp['7001'].owners);
  // ninguém / bloqueio
  await call(beto.tok, 'PATCH', '/games/me', { share: 'off' });
  ok((await call(ana.tok, 'GET', '/games/people?ids=7001'))['7001'].owners.every(o => o.user_id !== beto.id) && (await call(ana.tok, 'GET', `/users/${beto.id}/games`)).hidden, '"Ninguém": beto some dos cartões e do perfil');
  await call(beto.tok, 'PATCH', '/games/me', { share: 'servers' });
  await call(beto.tok, 'PUT', '/relationships/' + ana.id, { type: 2 });
  ok((await call(ana.tok, 'GET', '/games/people?ids=7001'))['7001'].owners.every(o => o.user_id !== beto.id), 'bloqueio esconde (mesmo compartilhando com os servidores)');
  await call(beto.tok, 'DELETE', '/relationships/' + ana.id);
  ok((await call(beto.tok, 'GET', '/games/people?ids=7001'))['7001'].owners.some(o => o.user_id === beto.id), 'a pessoa sempre se vê');
  // item da Steam não sai pela Resenha
  const del = await call(beto.tok, 'DELETE', '/wishlist/7002');
  ok(del.steam === true && del.wishlist.some(w => w.appid === '7002'), 'tirar pela Resenha um jogo que veio da Steam: continua (tira-se na Steam)');
  ok((await call(beto.tok, 'POST', '/games/sync')).steam?.syncing && (await call(beto.tok, 'POST', '/games/sync')).status === 429, 'Sincronizar agora (e no máximo 1 vez a cada 2 min)');
  ok((await call(ana.tok, 'PUT', '/wishlist/../x')).status >= 400, 'appid inválido é recusado');

  // ---------- interface ----------
  const P = await browser.newPage(); P.setDefaultTimeout(15000); await P.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  P.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await P.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, ana.tok);
  await P.goto(BASE); await P.waitForSelector('#rail .rail-wrap');
  const cid = await P.evaluate((gid) => { const c = window.__lc.S.guilds.get(gid).channels.find(x => x.type === 0); window.__lc.go(gid, c.id); return c.id; }, g.id);
  await call(beto.tok, 'POST', `/channels/${cid}/messages`, { content: 'joguei 120 h disso https://store.steampowered.com/app/7001/' });
  await call(beto.tok, 'POST', `/channels/${cid}/messages`, { content: 'bora jogar esse? https://store.steampowered.com/app/7002/' });
  await P.waitForFunction(() => document.querySelectorAll('.steamcard .sc-social').length >= 2); await sleep(500);
  const soc = await P.evaluate(() => Object.fromEntries([...document.querySelectorAll('.steamcard')].map(c => [c.dataset.app, c.querySelector('.sc-social')?.textContent || ''])));
  ok(/2 têm/.test(soc['7001']) && /2 querem/.test(soc['7002']), 'cartões: "2 têm" e "2 querem" (beto e carla)', soc);
  await P.evaluate(() => document.querySelector('.steamcard[data-app="7002"] .wishbtn').click());
  ok(await waitFor(() => P.evaluate(() => document.querySelector('.steamcard[data-app="7002"] .wishbtn').classList.contains('on') && /Na wishlist/.test(document.querySelector('.steamcard[data-app="7002"] .wishbtn').textContent))), 'Quero: botão vira "Na wishlist"');
  ok((await call(beto.tok, 'GET', '/games/people?ids=7002'))['7002'].wish.includes(ana.id), 'e os outros passam a ver que a ana quer');
  await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"]').scrollIntoView({ block: 'center' })); await sleep(300);
  await (await P.$('.steamcard[data-app="7001"]')).screenshot({ path: OUT + '/01-cartao-quem-tem.png' });
  await P.evaluate(() => document.querySelector('.steamcard[data-app="7001"] .sc-social').click());
  await P.waitForSelector('.gpmodal .gm-person'); await sleep(400);
  const gp = await P.evaluate(() => [...document.querySelectorAll('.gpmodal .gm-cap, .gpmodal .gm-person')].map(x => x.innerText.replace(/\n+/g, ' ')));
  ok(gp.some(t => /Têm o jogo · 2/i.test(t)) && gp.some(t => /beto 120 h/.test(t)) && gp.some(t => /carla 30 min/.test(t)), 'popup: quem tem, com as horas', gp);
  await (await P.$('.gpmodal')).screenshot({ path: OUT + '/02-popup-quem-tem.png' });
  await P.keyboard.press('Escape'); await P.evaluate(() => document.querySelectorAll('.backdrop').forEach(b => b.remove())); await sleep(200);

  // Wishlist do servidor
  ok(await P.evaluate(() => !!document.querySelector('#side-list .wishrow')), 'entrada "Wishlist" na lista de canais');
  await P.evaluate(() => document.querySelector('#side-list .wishrow').click());
  await P.waitForSelector('#wishview .wcard'); await sleep(1200);
  const wl = await P.evaluate(() => ({ cards: [...document.querySelectorAll('#wishview .wcard')].map(c => c.innerText.replace(/\n+/g, ' | ')), top: document.querySelector('#wishview #topbar').textContent }));
  ok(wl.cards.length === 3 && /Arena Rápida/.test(wl.cards[0]) && /3 querem/.test(wl.cards[0]) && wl.cards.some(c => /Corrida Neon.*-25%.*R\$ 44,92/.test(c)) && wl.cards.some(c => /Fazendinha/.test(c)) && /3 jogos desejados por 3 pessoas/.test(wl.top), 'Wishlist do servidor: mais desejado primeiro (ana, beto e carla), com preço e promoção', wl);
  await P.screenshot({ path: OUT + '/03-wishlist-servidor.png' });
  await P.evaluate(() => [...document.querySelectorAll('#wishview .ctab')].find(b => /promoção/.test(b.textContent)).click()); await sleep(200);
  const sale = await P.evaluate(() => [...document.querySelectorAll('#wishview .wc-title')].map(x => x.textContent));
  ok(sale.join() === 'Corrida Neon', '"Em promoção" mostra só o que está com desconto', sale);
  await P.evaluate(() => [...document.querySelectorAll('#wishview .ctab')].find(b => /Ninguém tem/.test(b.textContent)).click()); await sleep(200);
  const nob = await P.evaluate(() => [...document.querySelectorAll('#wishview .wc-title')].map(x => x.textContent).sort());
  ok(nob.join() === 'Arena Rápida,Fazendinha Tranquila 2', '"Ninguém tem" esconde os que alguém já tem (Corrida Neon é da carla)', nob);

  // Jogos e wishlist de alguém
  await P.evaluate(async (uid) => (await window.__lc.import('games.js')).userGamesModal(uid), beto.id);
  await P.waitForSelector('.gpmodal .ug-tile'); await sleep(800);
  const ug = await P.evaluate(() => [...document.querySelectorAll('.gpmodal .gm-cap, .gpmodal .ug-tile')].map(x => x.innerText.replace(/\n+/g, ' ')));
  ok(ug.some(t => /Mais jogados · 2 jogos/i.test(t)) && /Estrela Cadente 120 h/.test(ug[1]) && ug.some(t => /Wishlist · 3/i.test(t)), '"Jogos e wishlist" do beto: mais jogados e wishlist', ug);
  await (await P.$('.gpmodal')).screenshot({ path: OUT + '/04-jogos-do-beto.png' });
  await P.evaluate(() => document.querySelectorAll('.backdrop').forEach(b => b.remove()));

  // Configurações
  await P.evaluate(() => window.__lc.openSettings('connections'));
  await P.waitForFunction(() => /Minha wishlist · 1/i.test(document.body.innerText)); await sleep(600);
  const st = await P.evaluate(() => document.body.innerText);
  ok(/Quem vê meus jogos e minha wishlist/.test(st) && /Vincule a Steam acima/.test(st) && /Arena Rápida/.test(st), 'Contas vinculadas: quem vê, aviso para vincular e a minha wishlist');
  await P.evaluate(() => { const i = document.querySelector('.mw-add input'); i.value = 'https://store.steampowered.com/app/7005/Blocos/'; document.querySelector('.mw-add .btn').click(); });
  ok(await waitFor(() => P.evaluate(() => /Minha wishlist · 2/i.test(document.body.innerText) && /Blocos & Picaretas/.test(document.body.innerText))), 'colar o link da Steam adiciona à wishlist');
  await P.evaluate(() => document.querySelector('.mw-add').scrollIntoView({ block: 'start' })); await sleep(300);
  await P.screenshot({ path: OUT + '/05-configuracoes.png' });

  // desvincular apaga a biblioteca e a wishlist da Steam (os da Resenha ficam)
  await call(beto.tok, 'PUT', '/wishlist/7005');
  await call(beto.tok, 'DELETE', '/integrations/steam');
  const after = await call(beto.tok, 'GET', '/games/me');
  ok(after.wishlist.map(w => w.appid).join() === '7005' && !after.steam.linked, 'desvincular: some o que veio da Steam, fica o que foi posto na Resenha', after.wishlist);
  ok((await call(ana.tok, 'GET', '/games/people?ids=7001'))['7001'].owners.every(o => o.user_id !== beto.id), 'e a biblioteca do beto some para os outros');
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
