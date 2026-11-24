// Jogos que a galera do servidor mais joga (como o cartão do servidor no Discord): ranking por quantas pessoas jogaram
// nos últimos 30 dias, quem joga agora conta, chama na semana movimentada, privacidade (PC desligado, jogo escondido),
// mínimo de 2 pessoas, só para membros; aparece no convite e no cabeçalho do servidor. Uso: node scripts/guild-games-test.mjs
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ownServer } from './test-server.mjs';
const BASE = await ownServer('guildgames', 3404, 41580);
const EXE = process.env.BROWSER || '/opt/pw-browsers/chromium';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const reg = async (n) => { const r = await call('', 'POST', '/register', { username: n, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { n, tok: r.token, id: me.id }; };
const NAMES = ['ana', 'beto', 'caio', 'duda', 'enzo', 'fabi', 'gui', 'hugo'];
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const U = Object.fromEntries(await Promise.all(NAMES.map(async n => [n, await reg(n)])));
  const g = await call(U.ana.tok, 'POST', '/guilds', { name: 'Teamwork' }), code = (await call(U.ana.tok, 'POST', `/guilds/${g.id}/invites`, {})).code;
  for (const n of NAMES.slice(1, 7)) await call(U[n].tok, 'POST', '/invites/' + code); // hugo fica de fora
  const db = new DatabaseSync('./.testdata-guildgames/resenha.db'), day = 864e5; let k = 0;
  const ins = db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const played = (n, gameId, title, daysAgo, secs = 3600, extra = {}) => { const t = Date.now() - daysAgo * day; ins.run('t' + (++k), U[n].id, 'pc', 'game_start', gameId, title, JSON.stringify(extra), t); ins.run('t' + (++k), U[n].id, 'pc', 'game_stop', gameId, title, JSON.stringify({ seconds: secs, ...extra }), t + secs * 1000); };
  // Marvel Rivals: 4 pessoas nesta semana (chama); ARC Raiders: 3 pessoas, mas há 20 dias; UNO: 2; Palworld: só 1 (não aparece)
  for (const n of ['ana', 'beto', 'caio', 'duda']) played(n, 'marvelrivals.exe', 'Marvel Rivals', 2);
  for (const n of ['beto', 'caio', 'enzo']) played(n, 'arc-raiders.exe', 'ARC Raiders', 20, 7200);
  played('ana', 'uno.exe', 'UNO', 5); played('fabi', 'uno.exe', 'UNO', 6, 600, { steam: '470220' }); // mesmo jogo, um com appid: junta
  played('gui', 'palworld.exe', 'Palworld', 1);
  played('hugo', 'palworld.exe', 'Palworld', 1); // hugo não é membro: não conta
  played('ana', 'velho.exe', 'Jogo Antigo', 40); played('beto', 'velho.exe', 'Jogo Antigo', 40); // fora dos 30 dias
  // privacidade: duda está em "Só amigos (sem aparecer para mim)" (era "Ninguém"; continua contando aqui); enzo escondeu
  // ARC Raiders → ARC fica com 2 (beto, caio)
  db.prepare("UPDATE users SET pc_activity='off' WHERE id=?").run(U.duda.id);
  db.prepare("INSERT INTO game_prefs(user_id,platform,game_id,hidden) VALUES(?,'pc','arc-raiders.exe',1)").run(U.enzo.id);
  // gui e enzo estão jogando Palworld AGORA (app desktop): Palworld passa a ter 2 + gui = gui conta uma vez
  const live = [];
  for (const n of ['enzo']) { const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + U[n].tok); live.push(ws); await new Promise(r => ws.on('message', (raw) => { if (JSON.parse(raw).t === 'READY') r(); })); ws.send(JSON.stringify({ t: 'ACTIVITY_LOCAL', d: { game: { id: 'palworld.exe', title: 'Palworld' } } })); }
  await sleep(400);

  const r = await call(U.beto.tok, 'GET', `/guilds/${g.id}/games`), list = r.games || [], by = (t) => list.find(x => x.game.title === t);
  ok(list[0]?.game.title === 'Marvel Rivals' && by('Marvel Rivals').players === 4, 'mais jogado primeiro (Marvel Rivals, 4: duda em "Só amigos (sem aparecer para mim)" também conta)', list.map(x => [x.game.title, x.players]));
  ok(by('Marvel Rivals').hot === true, 'muita gente na semana: chama acesa');
  ok(by('ARC Raiders')?.players === 2 && !by('ARC Raiders').hot, 'jogo escondido por quem jogou não conta; jogado há 20 dias: sem chama', by('ARC Raiders'));
  ok(by('UNO')?.players === 2, 'o mesmo jogo com e sem número da Steam vira um só', by('UNO'));
  ok(by('Palworld')?.players === 2 && by('Palworld').playing === 1, 'quem está jogando agora conta (e quem não é membro, não)', by('Palworld'));
  ok(!by('Jogo Antigo'), 'mais de 30 dias: fora');
  ok((await call(U.hugo.tok, 'GET', `/guilds/${g.id}/games`)).status === 403, 'quem não é membro não consulta');
  const inv = await call('', 'GET', '/invites/' + code);
  ok(inv.games?.[0]?.game.title === 'Marvel Rivals', 'o convite mostra os jogos do servidor');

  // ---- tela: cabeçalho do servidor e cartão de convite ----
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.goto(BASE); await p.evaluate((t) => localStorage.lc_token = t, U.beto.tok); await p.reload(); await p.waitForSelector('#rail .rail-wrap');
  await p.evaluate((gid) => window.__lc.go(gid), g.id);
  // normal: faixa só com os ícones (setas quando não cabem); clicar no meio abre a lista; o título volta para a faixa
  ok(await p.waitForSelector('#members .ggp .ggp-ic', { timeout: 6000 }).then(() => true, () => false), 'a lista de membros mostra "Jogam aqui" (faixa de ícones)');
  const titles = await p.$$eval('#members .ggp-ic', els => els.map(e => e.getAttribute('title')));
  ok(titles[0]?.startsWith('Marvel Rivals — 4 pessoas jogaram'), 'passar o mouse diz o nome e quantos jogaram', titles[0]);
  ok(await p.$('#members .ggp-ic .gg-hot') !== null, 'chama no jogo movimentado');
  ok((await p.$$('#members .ggp-ic')).length === 4 && !!(await p.$('#members .ggp-bar.fits')), 'com 4 jogos, todos à vista (sem setas)');
  await p.evaluate(() => document.querySelector('#members .ggp-bar').click()); await new Promise(r => setTimeout(r, 300));
  ok((await p.$$('#members .ggp-row')).length === 4, 'clicar no meio da faixa abre a lista com os 4 jogos');
  await p.evaluate(() => document.querySelector('#members .ggp-head').click()); await new Promise(r => setTimeout(r, 300));
  ok(!(await p.$('#members .ggp-row')) && !!(await p.$('#members .ggp-head.col')) && !!(await p.$('#members .ggp-ic')), 'o título volta para a faixa de ícones');
  fs.mkdirSync('.testshots', { recursive: true }); await p.screenshot({ path: '.testshots/guild-games-members.png' });
  const dm = await call(U.beto.tok, 'POST', '/dms', { user_id: U.hugo.id });
  await call(U.beto.tok, 'POST', `/channels/${dm.id}/messages`, { content: `${BASE}/invite/${code}` });
  await p.evaluate((cid) => window.__lc.go('@me', cid), dm.id);
  ok(await p.waitForSelector('.invcard .ivgames .gg-game', { timeout: 6000 }).then(() => true, () => false), 'o cartão de convite no chat mostra os jogos');
  const card = await p.$('.invcard'); await card?.screenshot({ path: '.testshots/guild-games-invite.png' });
  for (const ws of live) ws.close();
} finally { await browser.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
