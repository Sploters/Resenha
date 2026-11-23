// Radar (scouting do Clash): API com uma Riot falsa local (só neste teste; o produto nunca simula dados) e a tela no navegador.
// Confere: chave nunca sai do servidor, busca em fila com progresso, Riot ID inexistente, personalizada fora, cache,
// compartilhamento (quem vê), observações, Clash bloqueado sem aprovação e os cartões/relatório na tela.
// Uso: node scripts/radar-test.mjs   (SHOTS=1 salva capturas em .testshots/radar)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
const PORT = 3237, FPORT = 3238, BASE = `http://localhost:${PORT}`, OUT = '.testshots/radar', KEY = 'RGAPI-teste-secreta';
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Riot falsa ----------
const hits = {}; let badKey = 0;
const PLAYERS = { 'alfa#br1': 'p-alfa', 'bravo#br1': 'p-bravo', 'charlie#br1': 'p-charlie', 'delta#br1': 'p-delta', 'echo#br1': 'p-echo' };
const match = (id, puuid, i) => ({ metadata: { matchId: id }, info: { queueId: i === 0 ? 0 : 420, gameStartTimestamp: Date.now() - i * 86400e3, gameDuration: 1700,
  participants: [{ puuid, championId: i % 3 ? 103 : 238, championName: i % 3 ? 'Ahri' : 'Zed', teamPosition: 'MIDDLE', win: i % 2 === 0, kills: 4, deaths: 3, assists: 6, totalMinionsKilled: 180, neutralMinionsKilled: 0 }] } });
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  hits[p.replace(/[^/]+$/, '*')] = (hits[p.replace(/[^/]+$/, '*')] || 0) + 1;
  if (p.startsWith('/dd/')) {
    if (p === '/dd/api/versions.json') return send(200, ['15.1.1']);
    if (p.endsWith('/champion.json')) return send(200, { data: { Ahri: { key: '103', id: 'Ahri', name: 'Ahri' }, Zed: { key: '238', id: 'Zed', name: 'Zed' } } });
    res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (req.headers['x-riot-token'] !== KEY) { badKey++; return send(403, {}); }
  let m;
  if ((m = p.match(/^\/americas\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/))) {
    const k = `${decodeURIComponent(m[1])}#${decodeURIComponent(m[2])}`.toLowerCase(), id = PLAYERS[k];
    return id ? send(200, { puuid: id, gameName: k.split('#')[0].replace(/^./, c => c.toUpperCase()), tagLine: 'BR1' }) : send(404, {});
  }
  if ((m = p.match(/^\/br1\/lol\/summoner\/v4\/summoners\/by-puuid\/(.+)$/))) return send(200, { summonerLevel: 321, profileIconId: 29 });
  if ((m = p.match(/^\/br1\/lol\/league\/v4\/entries\/by-puuid\/(.+)$/))) return send(200, m[1] === 'p-echo' ? [] : [{ queueType: 'RANKED_SOLO_5x5', tier: m[1] === 'p-alfa' ? 'DIAMOND' : 'GOLD', rank: 'II', leaguePoints: 40, wins: 50, losses: 45 }]);
  if ((m = p.match(/^\/br1\/lol\/champion-mastery\/v4\/champion-masteries\/by-puuid\/(.+)\/top$/))) return send(200, [{ championId: 103, championLevel: 7, championPoints: 250000, lastPlayTime: Date.now() }]);
  if ((m = p.match(/^\/americas\/lol\/match\/v5\/matches\/by-puuid\/(.+)\/ids$/))) return send(200, Array.from({ length: +u.searchParams.get('count') }, (_, i) => `BR1_${m[1]}_${i}`));
  if ((m = p.match(/^\/americas\/lol\/match\/v5\/matches\/BR1_(p-\w+)_(\d+)$/))) return send(200, match(`BR1_${m[1]}_${m[2]}`, m[1], +m[2]));
  send(404, {});
});
await new Promise(r => fake.listen(FPORT, '127.0.0.1', r));

fs.rmSync('.testdata-radar', { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, HTTPS: '0', DATA_DIR: './.testdata-radar', RIOT_API_KEY: KEY,
  RIOT_API_HOST: `http://127.0.0.1:${FPORT}/{host}`, DDRAGON_BASE: `http://127.0.0.1:${FPORT}/dd`, RIOT_RATE: '200:1', RADAR_MATCHES: '12' }, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { await fetch(BASE + '/api/server-info'); break; } catch { await sleep(200); } }
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => { const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { } return Array.isArray(j) ? Object.assign(j, { status: r.status, raw: t }) : { status: r.status, raw: t, ...j }; });
const reg = async (name) => { const r = await call('', 'POST', '/register', { username: name, password: 'Teste.senha-123' }); const me = await call(r.token, 'PATCH', '/me', {}); return { tok: r.token, id: me.id }; };
let browser;
try {
  const a = await reg('ana'), b = await reg('beto'), c = await reg('caio');
  await call(a.tok, 'POST', '/relationships', { username: 'beto' }); await call(b.tok, 'PUT', `/relationships/${a.id}`, {});

  const meta = await call(a.tok, 'GET', '/radar/meta');
  ok(meta.configured === true && meta.clash === false && meta.ddragon?.champs?.['103']?.name === 'Ahri', 'meta: chave configurada, Clash desligado, campeões do Data Dragon');
  ok(!meta.raw.includes(KEY), 'a chave da Riot nunca vai para o cliente');
  ok((await call(a.tok, 'POST', '/radar', { riot_ids: ['semtag'] })).status === 400, 'Riot ID inválido recusado');
  ok((await call(a.tok, 'POST', '/radar', { riot_ids: ['Aaa#BR1', 'Bbb#BR1', 'Ccc#BR1', 'Ddd#BR1', 'Eee#BR1', 'Fff#BR1'] })).status === 400, 'mais de 5 jogadores recusado');

  const s = await call(a.tok, 'POST', '/radar', { title: 'Clash sábado', platform: 'br1', riot_ids: ['alfa#BR1', 'Bravo #BR1', 'charlie#br1', 'delta#BR1', 'Fantasma#BR1'] });
  ok(s.status === 200 && s.players.length === 5 && s.players.every(p => ['pending', 'loading'].includes(p.status)), 'scouting criado; jogadores na fila');
  ok(s.players[1].links[0].url.includes('op.gg/lol/summoners/br/Bravo-BR1'), 'links OP.GG/U.GG por jogador');
  let full; for (let i = 0; i < 60; i++) { full = await call(a.tok, 'GET', '/radar/' + s.id); if (full.players.every(p => p.status === 'done' || p.status === 'error')) break; await sleep(250); }
  const [pa, , , , pg] = full.players;
  ok(pa.status === 'done' && pa.data.ranks.solo.tier === 'DIAMOND' && pa.data.level === 321, 'jogador carregado: elo e nível');
  ok(pa.riotId === 'Alfa#BR1', 'Riot ID corrigido com o nome oficial da conta', pa.riotId);
  ok(pg.status === 'error' && /não encontrado/.test(pg.error), 'Riot ID inexistente: erro claro, sem dados inventados', pg);
  ok(pa.data.sample.listed === 12 && pa.data.stats.games === 11 && pa.data.sample.skipped === 1, 'personalizada (queueId 0) fora da amostra', pa.data.sample);
  ok(pa.data.stats.champs[0].name === 'Ahri' && pa.data.stats.champs[0].wr != null && pa.data.mastery[0].champ === 103, 'campeões com win rate e maestria');
  ok(pa.data.peaks.solo.tier === 'DIAMOND', 'maior elo observado guardado');
  ok(full.report.players === 4 && full.report.totalGames === 44 && full.report.period && full.report.limits.some(l => /1 de 5/.test(l)), 'relatório do time com amostra, período e limitações');
  ok(full.report.trends.some(t => /Ahri/.test(t.text)), 'tendência: campeão forte em vários jogadores');
  ok(badKey === 0, 'toda requisição à Riot levou a chave do servidor');

  const matchHits = hits['/americas/lol/match/v5/matches/*'];
  await call(a.tok, 'POST', `/radar/${s.id}/refresh`, {});
  for (let i = 0; i < 60; i++) { full = await call(a.tok, 'GET', '/radar/' + s.id); if (full.players.every(p => p.status === 'done' || p.status === 'error')) break; await sleep(250); }
  ok(hits['/americas/lol/match/v5/matches/*'] === matchHits, 'atualizar não busca de novo partidas já vistas (cache)', [matchHits, hits['/americas/lol/match/v5/matches/*']]);

  ok((await call(c.tok, 'GET', '/radar/' + s.id)).status === 404, 'quem não recebeu não vê o scouting');
  ok((await call(a.tok, 'POST', `/radar/${s.id}/share`, { user_ids: [c.id] })).added === 0, 'não compartilha com quem não é amigo nem divide servidor');
  ok((await call(a.tok, 'POST', `/radar/${s.id}/share`, { user_ids: [b.id] })).added === 1, 'compartilhado com amigo');
  ok((await call(b.tok, 'GET', '/radar')).some(x => x.id === s.id && !x.mine), 'amigo vê na lista');
  const n = await call(b.tok, 'POST', `/radar/${s.id}/notes`, { content: 'banir Ahri', slot: 0 });
  ok(n.notes?.length === 1 && n.notes[0].slot === 0, 'amigo anota (observação compartilhada)');
  ok((await call(b.tok, 'PATCH', '/radar/' + s.id, { title: 'x' })).status === 403, 'só o dono edita');
  ok((await call(a.tok, 'POST', '/radar/clash-team', { riot_id: 'alfa#BR1' })).status === 403, 'Clash-V1 bloqueado sem aprovação da Riot');
  const ed = await call(a.tok, 'PATCH', '/radar/' + s.id, { riot_ids: ['alfa#BR1', 'echo#BR1'] });
  ok(ed.players.length === 2 && ed.players[0].status === 'done' && ed.players[1].status !== 'done', 'trocar jogadores mantém quem continua');

  // ---------- tela ----------
  browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const pg1 = await (await browser.createBrowserContext()).newPage();
  await pg1.setViewport({ width: 1440, height: 900 });
  pg1.on('pageerror', e => { console.log('  PAGEERROR', e.message); fails++; });
  await pg1.evaluateOnNewDocument((t) => { localStorage.lc_token = t; }, a.tok);
  await pg1.goto(BASE + '/#/@me/radar'); await pg1.waitForSelector('.rd-create', { timeout: 15000 });
  ok(await pg1.$$eval('.rd-slot', els => els.length) === 5, 'tela: cinco campos de jogador');
  await pg1.type('.rd-paste', 'alfa#BR1\nbravo #BR1 entrou no saguão\ncharlie#BR1, delta#BR1');
  ok((await pg1.$$eval('.rd-slot', els => els.map(e => e.value))).filter(Boolean).length === 4, 'colar em lote preenche os campos');
  if (process.env.SHOTS) await pg1.screenshot({ path: `${OUT}/criar.png` });
  await pg1.click('.rd-actions .btn.green');
  await pg1.waitForFunction(() => document.querySelectorAll('.rd-card .rd-ranks').length === 4, { timeout: 20000 }).catch(() => { });
  ok(await pg1.$$eval('.rd-card .rd-ranks', els => els.length) === 4, 'tela: quatro cartões carregados');
  ok(await pg1.$$eval('img.rd-ci', els => els.some(e => /champion\/Ahri\.png$/.test(e.src))), 'tela: ícones de campeão do Data Dragon');
  ok(await pg1.$eval('.rd-sample', e => /partidas.*período/.test(e.textContent)), 'tela: período e amostra sempre visíveis');
  ok(await pg1.$$eval('.rd-link', els => els.some(e => e.textContent.includes('U.GG'))), 'tela: links externos');
  if (process.env.SHOTS) await pg1.screenshot({ path: `${OUT}/scouting.png`, fullPage: true });
} catch (e) { console.log('  FAIL exceção', e); fails++; }
finally { await browser?.close().catch(() => { }); srv.kill(); fake.close(); fs.rmSync('.testdata-radar', { recursive: true, force: true }); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo certo'); process.exit(fails ? 1 : 0);
