// "O que jogar hoje?" na sala de voz (GET /api/voice/:cid/games em server/games.js + openGameNight em public/games.js),
// com uma Steam FALSA local e 4 pessoas de verdade na sala: jogos que todo mundo tem (os mais jogados primeiro),
// "falta só 1", "querem juntos", quem esconde os jogos, quem está fora da chamada, sortear (resultado no chat da sala
// com o cartão da Steam) e votar (enquete no chat da sala).
// Uso: node scripts/gamenight-test.mjs  (prints em .testshots/gamenight)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
const OUT = '.testshots/gamenight', PORT = 3314, MOCK = 4594, BASE = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK}`, DATA = './.testdata-gamenight';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const waitFor = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };
const now = Date.now(), s = (t) => Math.floor(t / 1000);
const svg = (c, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="460" height="215" fill="url(#g)"/><text x="24" y="128" font-size="32" font-weight="700" font-family="sans-serif" fill="#fff">${t}</text></svg>`;
const GAMES = { 7001: ['Estrela Cadente', '#7b4cff', 'R$ 39,99', 60], 7002: ['Arena Rápida', '#e8484f', 'Gratuito', 0], 7003: ['Fazendinha Tranquila 2', '#23a55a', 'R$ 49,90', 0],
  7004: ['Corrida Neon', '#d946ef', 'R$ 44,92', 25], 7005: ['Blocos & Picaretas', '#f0a020', 'R$ 29,90', 0] };
const sitem = (a) => { const g = GAMES[a]; if (!g) return { success: 0, appid: a };
  return { success: 1, appid: a, name: g[0], is_free: g[2] === 'Gratuito', tagids: [], assets: { asset_url_format: `img/${a}/\${FILENAME}`, header: 'h.svg', small_capsule: 's.svg' },
    best_purchase_option: g[2] === 'Gratuito' ? null : { formatted_final_price: g[2], formatted_original_price: 'R$ 99,90', discount_pct: g[3] } };
};
const SID = (n) => '7656119800000000' + n;
const LIB = { [SID(1)]: { 7001: 600, 7002: 30, 7005: 10 }, [SID(2)]: { 7001: 7200, 7002: 100, 7004: 50 }, [SID(3)]: { 7001: 60, 7002: 0, 7005: 5 }, [SID(4)]: { 7001: 99999 } };
const WISH = { [SID(1)]: [7003], [SID(2)]: [7003], [SID(3)]: [7004], [SID(4)]: [7003] };
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M); r.setHeader('content-type', 'application/json');
  if (u.pathname === '/openid/login' && q.method === 'POST') { r.setHeader('content-type', 'text/plain'); return r.end('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries')) return r.end(JSON.stringify({ response: { players: [] } }));
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) { const l = LIB[u.searchParams.get('steamid')]; return r.end(JSON.stringify({ response: { game_count: Object.keys(l).length, games: Object.entries(l).map(([appid, m]) => ({ appid: +appid, name: GAMES[appid][0], playtime_forever: m, rtime_last_played: s(now) })) } })); }
  if (u.pathname.startsWith('/IWishlistService/GetWishlist')) return r.end(JSON.stringify({ response: { items: (WISH[u.searchParams.get('steamid')] || []).map(appid => ({ appid, date_added: s(now) })) } }));
  if (u.pathname.startsWith('/sapi/IStoreBrowseService/GetItems')) return r.end(JSON.stringify({ response: { store_items: JSON.parse(u.searchParams.get('input_json')).ids.map(x => sitem(x.appid)) } }));
  if (u.pathname.startsWith('/sapi/IStoreService/GetTagList')) return r.end(JSON.stringify({ response: { tags: [] } }));
  if (u.pathname.startsWith('/img/')) { const a = u.pathname.split('/')[2]; r.setHeader('content-type', 'image/svg+xml'); return r.end(svg(GAMES[a]?.[1] || '#555', GAMES[a]?.[0] || '')); }
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', news: [], epic: false, tournaments: false }));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC_PORT: '41098', RTC_IPS: '127.0.0.1', STEAM_OPENID_URL: M + '/openid/login', STEAM_API_BASE: M, STEAM_API_KEY: 'CHAVE-DE-TESTE', GAMES_SYNC: '0', DEALS: '0' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); return Array.isArray(j) ? j : { status: r.status, ...j }; });
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id, name: n }; };
async function link(U, n) {
  const { url } = await call(U.tok, 'POST', '/integrations/steam/link');
  const rt = new URL(url).searchParams.get('openid.return_to'), u = new URL(rt);
  for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': M + '/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.identity': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.return_to': rt, 'openid.response_nonce': 'n' + n, 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' })) u.searchParams.set(k, v);
  await fetch(u);
  return waitFor(async () => (await call(U.tok, 'GET', '/games/me')).steam?.synced_at);
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ana = await reg('ana'), beto = await reg('beto'), carla = await reg('carla'), eva = await reg('eva'), davi = await reg('davi');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' }); const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const U of [beto, carla, eva, davi]) await call(U.tok, 'POST', '/invites/' + inv);
  for (const [U, n] of [[ana, 1], [beto, 2], [carla, 3], [eva, 4]]) ok(await link(U, n), U.name + ' vincula a Steam');
  await call(eva.tok, 'PATCH', '/games/me', { share: 'off' });

  const open = async (U, w = 1280) => { const c = await browser.createBrowserContext(), p = await c.newPage(); p.setDefaultTimeout(15000); await p.setViewport({ width: w, height: 900, deviceScaleFactor: 2 });
    p.on('pageerror', e => { console.log('  PAGEERROR', U.name, e.message); fails++; });
    await p.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, U.tok); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap'); return p; };
  const pages = {}; for (const U of [ana, beto, carla, eva]) pages[U.name] = await open(U);
  const vid = await pages.ana.evaluate((gid) => window.__lc.S.guilds.get(gid).channels.find(c => c.type === 2).id, g.id);
  ok((await call(ana.tok, 'GET', `/voice/${vid}/games`)).status === 403, 'fora da chamada: recusado');
  for (const P of Object.values(pages)) await P.evaluate((gid, cid) => { window.__lc.go(gid, cid); return window.__lc.voice.join(cid); }, g.id, vid);
  await sleep(2500);
  ok((await call(davi.tok, 'GET', `/voice/${vid}/games`)).status === 403, 'davi (no servidor, fora da chamada) não consegue');

  const api = await call(ana.tok, 'GET', `/voice/${vid}/games`);
  ok(api.pool === 3 && api.people.find(p => p.user_id === eva.id)?.shared === false, '3 bibliotecas cruzadas; eva (Ninguém) fica de fora', api.people);
  ok(api.all.map(x => x.appid).join() === '7001,7002' && api.all[0].minutes === 7860, 'todo mundo tem: Estrela Cadente (131 h no grupo) e Arena Rápida, mais jogado primeiro', api.all);
  ok(api.almost.length === 1 && api.almost[0].appid === '7005' && api.almost[0].missing.join() === beto.id, 'falta só 1: Blocos & Picaretas (falta o beto)', api.almost);
  ok(api.wish.length === 1 && api.wish[0].appid === '7003' && api.wish[0].wish.length === 2, 'querem juntos: Fazendinha (ana e beto; a da eva fica escondida)', api.wish);
  ok(!JSON.stringify(api).includes('99999'), 'nada da biblioteca da eva vaza');

  // interface
  const A = pages.ana; await A.bringToFront();
  const btn = await A.waitForSelector('button.roundbtn[title^="O que jogar hoje?"]');
  ok(!!btn, 'botão "O que jogar hoje?" na barra da sala de voz');
  await btn.click(); await A.waitForSelector('.gnmodal .gn-tile'); await sleep(1000);
  const ui = await A.evaluate(() => ({ people: [...document.querySelectorAll('.gn-person')].map(p => p.innerText.replace(/\n+/g, ' ')), tabs: [...document.querySelectorAll('.gn-bar .ctab')].map(t => t.innerText.replace(/\n+/g, ' ')),
    tiles: [...document.querySelectorAll('.gn-tile')].map(t => t.innerText.replace(/\n+/g, ' | ')) }));
  ok(ui.people.length === 4 && ui.people.some(p => /eva escondido/.test(p)) && ui.people.some(p => /beto 3 jogos/.test(p)), 'quem está na chamada, com quantos jogos (eva: escondido)', ui.people);
  ok(ui.tabs.join() === 'Todo mundo tem 2,Falta só 1 1,Querem juntos 1', 'abas com as contagens', ui.tabs);
  ok(/Estrela Cadente \| 131 h no grupo/.test(ui.tiles[0]) && /Arena Rápida/.test(ui.tiles[1]), 'cartões: o mais jogado pelo grupo primeiro', ui.tiles);
  await A.screenshot({ path: OUT + '/01-todo-mundo-tem.png' });
  await A.evaluate(() => [...document.querySelectorAll('.gn-bar .ctab')][1].click()); await sleep(500);
  ok(await A.evaluate(() => /Blocos & Picaretas \| falta beto/.test(document.querySelector('.gn-tile').innerText.replace(/\n+/g, ' | '))), 'aba Falta só 1: "falta beto" com o preço');
  await A.evaluate(() => [...document.querySelectorAll('.gn-bar .ctab')][2].click()); await sleep(500);
  ok(await A.evaluate(() => /Fazendinha Tranquila 2 \| 2 querem/.test(document.querySelector('.gn-tile').innerText.replace(/\n+/g, ' | '))), 'aba Querem juntos: "2 querem"');
  await A.evaluate(() => [...document.querySelectorAll('.gn-bar .ctab')][0].click()); await sleep(300);

  // sortear entre os 2 da aba (sem escolher)
  await A.evaluate(() => [...document.querySelectorAll('.gn-foot .btn')].find(b => /Sortear/.test(b.textContent)).click());
  ok(await waitFor(() => A.evaluate(() => !!document.querySelector('.gn-rollbox.done'))), 'sorteio termina e mostra o jogo');
  const win = await A.evaluate(() => document.querySelector('.gn-rollbox.done .gn-roll').textContent);
  const msgs = await call(ana.tok, 'GET', `/channels/${vid}/messages?limit=5`), rollMsg = (Array.isArray(msgs) ? msgs : msgs.messages || []).find(m => /Sorteio do "O que jogar hoje\?"/.test(m.content));
  ok(['Estrela Cadente', 'Arena Rápida'].includes(win) && rollMsg && rollMsg.content.includes(win) && /store\.steampowered\.com\/app\/700[12]\//.test(rollMsg.content), 'resultado vai para o chat da sala com o link (vira cartão da Steam)', { win, msg: rollMsg?.content });
  await A.screenshot({ path: OUT + '/02-sorteio.png' });
  // votar: escolhe os 2 e abre a enquete
  await A.evaluate(() => document.querySelectorAll('.gn-tile')[0].click()); await sleep(100);
  await A.evaluate(() => document.querySelectorAll('.gn-tile')[1].click()); await sleep(100);
  ok(await A.evaluate(() => document.querySelectorAll('.gn-tile.on').length === 2 && /2 escolhidos/.test(document.querySelector('.gn-hint').textContent)), 'escolher jogos (marcados)');
  await A.evaluate(() => [...document.querySelectorAll('.gn-foot .btn')].find(b => /Votar/.test(b.textContent)).click());
  ok(await waitFor(() => A.evaluate(() => !document.querySelector('.gnmodal'))), 'votação abre e o painel fecha');
  const msgs2 = await call(ana.tok, 'GET', `/channels/${vid}/messages?limit=5`), poll = (Array.isArray(msgs2) ? msgs2 : msgs2.messages || []).find(m => m.poll);
  ok(poll && poll.poll.question === 'O que jogar hoje?' && poll.poll.options.map(o => o.text).join() === 'Estrela Cadente,Arena Rápida' && poll.poll.multi, 'enquete no chat da sala com os jogos escolhidos', poll?.poll);
  // beto vê a enquete e o cartão do sorteio no chat da sala
  const B = pages.beto; await B.bringToFront();
  ok(await waitFor(() => B.evaluate(() => !!document.querySelector('.steamcard') && [...document.querySelectorAll('.msg, .message')].some(m => /O que jogar hoje\?/.test(m.textContent)))), 'beto vê no chat da sala o cartão do sorteio e a enquete');
  await B.screenshot({ path: OUT + '/03-chat-da-sala.png' });
} catch (e) { console.log('ERRO', e); fails++; }
await browser.close(); srv.kill(); mock.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
