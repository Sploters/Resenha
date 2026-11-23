// Conquistas e platinas (server/achievements.js + public/achievements.js) com uma Steam FALSA local: sincronizar a partir
// da biblioteca, jogo 100%, raridade e nomes em português, jogo sem conquistas, perfil privado, quem vê (mesma regra da
// biblioteca), platinas informadas (PlayStation etc.), limite do "Sincronizar agora", desvincular e a aba na tela.
// Uso: node scripts/achievements-test.mjs  (prints em .testshots/achievements)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http';
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
const OUT = '.testshots/achievements', PORT = 3405, MOCK = 4594, BASE = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK}`, DATA = './.testdata-achievements';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const waitFor = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };
const now = Date.now(), day = 864e5, s = (t) => Math.floor(t / 1000);
const SID = (n) => '7656119800000000' + n;
const NAMES = { 7001: 'Estrela Cadente', 7005: 'Blocos & Picaretas', 7006: 'Jogo Sem Conquistas' };
const LIB = { [SID(1)]: { 7001: 7200, 7005: 95, 7006: 30 }, [SID(2)]: { 7001: 60 } };
const SCHEMA = { 7001: [['FIRST', 'Primeiro passo', 'Termine o tutorial', 92.5], ['BOSS', 'Chefão', 'Derrote o chefão', 41], ['ALL', 'Colecionador', 'Ache todas as estrelas', 3.2]],
  7005: [['DIG', 'Cavador', 'Cave 100 blocos', 60], ['DIAMOND', 'Diamante', 'Ache um diamante', 12], ['END', 'Fim', 'Chegue ao fim', 1.1], ['PET', 'Amigo', 'Doma um lobo', 30]] };
const MINE = { [SID(1)]: { 7001: { FIRST: now - 9 * day, BOSS: now - 5 * day, ALL: now - 2 * day }, 7005: { DIAMOND: now - 1 * day } } };
const calls = { ach: 0, info: 0 };
const mock = http.createServer((q, r) => {
  const u = new URL(q.url, M), sp = u.searchParams; r.setHeader('content-type', 'application/json');
  if (u.pathname === '/openid/login' && q.method === 'POST') { r.setHeader('content-type', 'text/plain'); return r.end('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries')) return r.end(JSON.stringify({ response: { players: sp.get('steamids').split(',').map(id => ({ steamid: id, personaname: 'S' + id.slice(-1), communityvisibilitystate: 3, personastate: 1 })) } }));
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) { const l = LIB[sp.get('steamid')] || {}; return r.end(JSON.stringify({ response: { game_count: Object.keys(l).length, games: Object.entries(l).map(([appid, m]) => ({ appid: +appid, name: NAMES[appid], playtime_forever: m, rtime_last_played: s(now - day) })) } })); }
  if (u.pathname.startsWith('/IWishlistService/GetWishlist')) return r.end(JSON.stringify({ response: { items: [] } }));
  if (u.pathname.startsWith('/ISteamUserStats/GetPlayerAchievements')) {
    calls.ach++; const sid = sp.get('steamid'), appid = sp.get('appid');
    if (sid === SID(2)) { r.statusCode = 403; return r.end(JSON.stringify({ playerstats: { error: 'Profile is not public', success: false } })); }
    if (!SCHEMA[appid]) { r.statusCode = 400; return r.end(JSON.stringify({ playerstats: { error: 'Requested app has no stats', success: false } })); }
    const mine = MINE[sid]?.[appid] || {};
    return r.end(JSON.stringify({ playerstats: { steamID: sid, gameName: NAMES[appid], success: true, achievements: SCHEMA[appid].map(([api]) => ({ apiname: api, achieved: mine[api] ? 1 : 0, unlocktime: mine[api] ? s(mine[api]) : 0 })) } }));
  }
  if (u.pathname.startsWith('/ISteamUserStats/GetSchemaForGame')) { calls.info++; const a = SCHEMA[sp.get('appid')] || []; return r.end(JSON.stringify({ game: { gameName: NAMES[sp.get('appid')], availableGameStats: { achievements: a.map(([api, n, d]) => ({ name: api, displayName: n, description: d, icon: `${M}/img/${api}.svg`, icongray: '', hidden: 0 })) } } })); }
  if (u.pathname.startsWith('/ISteamUserStats/GetGlobalAchievementPercentagesForApp')) { const a = SCHEMA[sp.get('gameid')] || []; return r.end(JSON.stringify({ achievementpercentages: { achievements: a.map(([api, , , p]) => ({ name: api, percent: String(p) })) } })); }
  // loja da Steam (busca pelo nome) e loja + conquistas públicas da Epic
  if (u.pathname === '/store/api/storesearch/') { const t = sp.get('term'); return r.end(JSON.stringify({ items: t === 'God of War Ragnarök' ? [{ type: 'app', id: 7001, name: 'God of War Ragnarök' }] : [] })); }
  if (u.pathname === '/epic/content/alan-wake-2') return r.end(JSON.stringify({ productName: 'Alan Wake 2', namespace: 'abc123abc123abc123', pages: [{ type: 'productHome', _images_: [`${M}/img/AW2.svg`], data: {} }] }));
  if (u.pathname.startsWith('/epic/content/')) { r.statusCode = 404; return r.end('{}'); }
  if (u.pathname === '/epic/ach/abc123abc123abc123/locale/pt-BR') return r.end(JSON.stringify({ totalAchievements: 3, platinumRarity: { percent: 2 }, achievements: [
    { achievement: { unlockedDisplayName: 'Escape da gravidade', unlockedDescription: 'Use um sinalizador', unlockedIconLink: `${M}/img/E1.svg`, rarity: { percent: 22 } } },
    { achievement: { unlockedDisplayName: 'Fim do pesadelo', unlockedDescription: 'Termine o jogo', unlockedIconLink: `${M}/img/E2.svg`, rarity: { percent: 4 } } },
    { achievement: { unlockedDisplayName: 'Sem ícone', unlockedDescription: '', rarity: { percent: 1 } } }] }));
  if (u.pathname.startsWith('/img/')) { r.setHeader('content-type', 'image/svg+xml'); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="8" fill="#b8860b"/><path d="M20 18h24v8a12 12 0 0 1-24 0Z" fill="#fff"/></svg>'); }
  r.statusCode = 404; r.end('{}');
}).listen(MOCK);
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(DATA + '/discover.json', JSON.stringify({ steamApi: M + '/sapi', steamAssets: M + '/', steamBase: M + '/store', news: [], epic: false, tournaments: false }));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: DATA, RTC: '0', STEAM_OPENID_URL: M + '/openid/login', STEAM_API_BASE: M, STEAM_API_KEY: 'CHAVE-DE-TESTE', GAMES_SYNC: '0', ACH_SYNC: '0', ACH_GAP_MS: '0', EPIC_CONTENT_BASE: M + '/epic/content', EPIC_ACH_BASE: M + '/epic/ach' }, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); } catch { } });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); return { tok: r.token, id: (await call(r.token, 'PATCH', '/me', {})).id, name: n }; };
async function link(U, n) {
  const { url } = await call(U.tok, 'POST', '/integrations/steam/link');
  const rt = new URL(url).searchParams.get('openid.return_to'), u = new URL(rt);
  for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': M + '/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.identity': `https://steamcommunity.com/openid/id/${SID(n)}`, 'openid.return_to': rt, 'openid.response_nonce': 'n' + n, 'openid.assoc_handle': '1', 'openid.signed': 's', 'openid.sig': 'OK' })) u.searchParams.set(k, v);
  await fetch(u);
  return waitFor(async () => (await call(U.tok, 'GET', '/games/me')).steam?.synced_at);
}
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const ana = await reg('ana'), beto = await reg('beto'), carla = await reg('carla'), davi = await reg('davi');
  const g = await call(ana.tok, 'POST', '/guilds', { name: 'Resenha' }); const inv = (await call(ana.tok, 'POST', `/guilds/${g.id}/invites`)).code;
  for (const U of [beto, carla]) await call(U.tok, 'POST', '/invites/' + inv);

  let me = await call(beto.tok, 'GET', '/users/@me/achievements');
  ok(me.me === true && me.steam.linked === false && me.summary.perfect === 0, 'sem Steam vinculada: vazio e avisa para vincular', me.steam);
  ok((await call(beto.tok, 'POST', '/achievements/sync')).status === 400, 'sincronizar sem Steam vinculada é recusado');
  ok(await link(beto, 1), 'beto vincula a Steam (a biblioteca vem junto)');
  await call(beto.tok, 'GET', '/users/@me/achievements'); // abrir a aba começa a sincronização
  ok(await waitFor(async () => (await call(beto.tok, 'GET', '/users/@me/achievements')).steam.state === 'ok'), 'abrir a aba sincroniza sozinho');
  me = await call(beto.tok, 'GET', '/users/@me/achievements');
  ok(me.perfect.length === 1 && me.perfect[0].appid === '7001' && me.perfect[0].total === 3 && me.perfect[0].title === 'Estrela Cadente', 'Estrela Cadente com tudo desbloqueado = 100%', me.perfect);
  ok(me.summary.unlocked === 4 && me.summary.games === 2 && me.summary.completion === 63, 'resumo: 4 conquistas em 2 jogos, conclusão média 63% (100% e 25%)', me.summary);
  ok(!me.games.some(x => x.appid === '7006'), 'jogo sem conquistas não aparece no progresso');
  ok(me.recent[0]?.name === 'Diamante' && me.recent[0].desc === 'Ache um diamante' && me.recent[0].game === 'Blocos & Picaretas', 'recentes: a mais nova primeiro, com nome e descrição da Steam', me.recent[0]);
  ok(me.rare.map(x => x.api).join() === 'ALL,DIAMOND,BOSS,FIRST' && me.rare[0].pct === 3.2, 'as mais raras em ordem (raridade global)', me.rare.map(x => [x.api, x.pct]));
  const infoCalls = calls.info, achCalls = calls.ach;
  await call(beto.tok, 'GET', '/users/@me/achievements'); await sleep(300);
  ok(calls.ach === achCalls && calls.info === infoCalls, 'dados frescos: abrir de novo não consulta a Steam');
  const sy = await call(beto.tok, 'POST', '/achievements/sync');
  ok(sy.state === 'ok' && calls.ach > achCalls && calls.info === infoCalls, '"Sincronizar agora" consulta de novo (os nomes e ícones ficam guardados)');
  ok((await call(beto.tok, 'POST', '/achievements/sync')).status === 429, '"Sincronizar agora" seguido: espera alguns minutos');

  // perfil privado na Steam
  ok(await link(carla, 2), 'carla vincula a Steam');
  await call(carla.tok, 'GET', '/users/@me/achievements');
  ok(await waitFor(async () => (await call(carla.tok, 'GET', '/users/@me/achievements')).steam.state === 'private'), 'perfil privado na Steam: avisa');

  // platinas informadas
  const add = (b) => call(beto.tok, 'POST', '/achievements/manual', b);
  let r = await add({ platform: 'psn', title: 'God of War Ragnarök', kind: 'platinum', achieved_at: '2025-03-10' });
  ok(r.manual?.length === 1 && r.manual[0].platform_name === 'PlayStation' && r.summary.perfect === 2, 'registra a platina da PlayStation (conta no total)', r.summary);
  ok((await add({ platform: 'psn', title: 'god of war ragnarök', kind: 'platinum' })).status === 409, 'a mesma platina duas vezes é recusada');
  ok((await add({ platform: 'nada', title: 'X', kind: 'platinum' })).status === 400, 'plataforma inválida é recusada');
  ok((await add({ platform: 'xbox', title: '', kind: 'complete' })).status === 400, 'sem o nome do jogo é recusado');
  ok((await add({ platform: 'xbox', title: 'Halo', kind: 'complete', achieved_at: '2999-01-01' })).status === 400, 'data no futuro é recusada');
  r = await add({ platform: 'epic', title: 'Alan Wake 2', kind: 'complete' });
  const epic = r.manual.find(x => x.platform === 'epic');
  ok(!!epic && epic.at === null, 'Epic: 100% sem data');
  // arte e conquistas do jogo: God of War achado pelo nome na Steam (catálogo da Steam); Alan Wake 2 na loja da Epic
  ok(await waitFor(async () => { const m = (await call(beto.tok, 'GET', '/users/@me/achievements')).manual; return m.every(x => x.icons_from); }), 'os registros ganham a arte e as conquistas do jogo');
  const mm = (await call(beto.tok, 'GET', '/users/@me/achievements')).manual, gow = mm.find(x => x.platform === 'psn'), aw = mm.find(x => x.platform === 'epic');
  ok(gow.appid === '7001' && gow.icons_from === 'steam' && gow.total === 3 && gow.icons[0].name === 'Colecionador' && gow.icons[0].icon.endsWith('/ALL.svg'), 'PlayStation: jogo achado na Steam pelo nome, com as conquistas mais raras e os ícones', gow);
  ok(aw.image?.includes('/img/AW2.svg') && aw.icons_from === 'epic' && aw.total === 3 && aw.plat_pct === 2 && aw.icons.map(x => x.name).join() === 'Fim do pesadelo,Escape da gravidade', 'Epic: arte da loja, conquistas públicas com ícones (as raras primeiro) e quantos % fizeram 100%', aw);

  // quem vê: mesma regra da biblioteca
  const seen = await call(ana.tok, 'GET', `/users/${beto.id}/achievements`);
  ok(seen.me === false && seen.perfect.length === 1 && seen.manual.length === 2, 'ana (mesmo servidor) vê as conquistas do beto');
  ok((await call(davi.tok, 'GET', `/users/${beto.id}/achievements`)).status === 403, 'davi (sem servidor nem amizade) não vê');
  ok((await call(ana.tok, 'DELETE', `/achievements/manual/${epic.id}`)) && (await call(beto.tok, 'GET', '/users/@me/achievements')).manual.length === 2, 'ninguém apaga o registro de outra pessoa');

  // ---- tela ----
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, beto.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.evaluate(() => [...document.querySelectorAll('#home .mtab')].find(b => /Descobrir/.test(b.textContent))?.click()); await sleep(800);
  await p.evaluate(() => [...document.querySelectorAll('#topbar .gtabs .dtab')].find(b => /Conquistas/.test(b.textContent))?.click());
  ok(await p.waitForSelector('#trophyview .ach-card', { timeout: 6000 }).then(() => true, () => false), 'Descobrir → Conquistas abre a aba com as platinas');
  const cards = await p.$$eval('#trophyview .ach-card b', els => els.map(e => e.textContent));
  ok(cards.length === 3 && cards.includes('Estrela Cadente') && cards.includes('God of War Ragnarök'), 'platinas da Steam e informadas juntas', cards);
  ok(await p.$$eval('#trophyview .ach-card.manual .ach-inf', els => els.length) === 2, 'as informadas aparecem marcadas como "informado"');
  ok(await p.$eval('#trophyview .ach-rar', el => el.textContent.startsWith('Ultrarrara')), 'a mais rara marcada como Ultrarrara');
  ok(await p.$$eval('#trophyview .ach-card .ach-icons img', els => els.length) >= 6 && await p.$('#trophyview .ach-card img.ach-art') !== null, 'cartões com a arte do jogo e os ícones das conquistas');
  await p.screenshot({ path: OUT + '/aba.png' });
  // registrar pela tela
  await p.evaluate(() => document.querySelector('#trophyview .ach-add').click()); await p.waitForSelector('.modal input[placeholder]');
  await p.evaluate(() => { const m = document.querySelector('.modal'); m.querySelector('select').value = 'xbox'; m.querySelector('input[placeholder]').value = 'Forza Horizon 5'; [...m.querySelectorAll('button')].find(b => b.textContent === 'Registrar').click(); });
  ok(await p.waitForFunction(() => [...document.querySelectorAll('#trophyview .ach-card b')].some(b => b.textContent === 'Forza Horizon 5'), { timeout: 5000 }).then(() => true, () => false), 'registrar platina pela tela aparece na hora');
  // perfil de outra pessoa (aba Conquistas): a ana vendo o beto
  const p2 = await (await browser.createBrowserContext()).newPage(); p2.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p2.setViewport({ width: 1280, height: 900 });
  await p2.goto(BASE); await p2.evaluate((t) => localStorage.lc_token = t, ana.tok); await p2.reload(); await p2.waitForSelector('#rail .rail-wrap');
  await p2.evaluate(async (uid) => { const m = await window.__lc.import('achievements.js'); const box = document.createElement('div'); box.id = 'achtest'; box.style.cssText = 'position:fixed;inset:20px auto auto 20px;width:420px;max-height:860px;overflow:auto;background:var(--bg-float,#111);z-index:9999;padding:12px'; box.append(m.achievementsView(uid, { compact: true })); document.body.append(box); }, beto.id);
  ok(await p2.waitForSelector('#achtest .ach-card', { timeout: 6000 }).then(() => true, () => false), 'a aba no perfil mostra as platinas de outra pessoa');
  ok(!(await p2.$('#achtest .ach-add')) && !(await p2.$('#achtest .ach-del')), 'no perfil de outra pessoa não dá para registrar nem apagar');
  await (await p2.$('#achtest')).screenshot({ path: OUT + '/perfil.png' });

  // desvincular apaga as da Steam (as informadas ficam)
  await call(beto.tok, 'DELETE', '/integrations/steam');
  me = await call(beto.tok, 'GET', '/users/@me/achievements');
  ok(me.perfect.length === 0 && me.summary.unlocked === 0 && me.manual.length === 3, 'desvincular a Steam apaga as conquistas dela; as informadas ficam', me.summary);
} finally { await browser.close(); srv.kill(); mock.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
