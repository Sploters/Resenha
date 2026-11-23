// Arte dos jogos no histórico: partida guardada sem o número da Steam (a loja respondeu depois, jogo da Epic, partida
// antiga) herda o número de outra partida do mesmo jogo (server/activity.js artFor), no "Ativo agora" e no ranking da
// semana, não importa a ordem em que as partidas são lidas. Sem isso o ícone virava o controle genérico.
// Uso: node scripts/gameart-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { ownServer } from './test-server.mjs';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const BASE = await ownServer('gameart', 3393, 41393, { DISCOVER_OFF: '1' });
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const r = await call('', 'POST', '/register', { username: 'alice', password: 'Teste.senha-123' });
const me = await call(r.token, 'PATCH', '/me', {});
const db = new DatabaseSync('./.testdata-gameart/resenha.db'); const t = Date.now();
const ins = db.prepare('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)');
const icon = 'a'.repeat(64);
// Deadlock: a partida mais NOVA não tem o número (e o ícone só está na mais antiga)
ins.run('d1', me.id, 'pc', 'game_start', 'deadlock', 'Deadlock', JSON.stringify({ steam: '1422450', icon }), t - 5 * 3600e3);
ins.run('d2', me.id, 'pc', 'game_stop', 'deadlock', 'Deadlock', JSON.stringify({ seconds: 3000, steam: '1422450', icon }), t - 4 * 3600e3);
ins.run('d3', me.id, 'pc', 'game_start', 'deadlock', 'Deadlock', null, t - 2 * 3600e3);
ins.run('d4', me.id, 'pc', 'game_stop', 'deadlock', 'Deadlock', JSON.stringify({ seconds: 3000 }), t - 3600e3);
// Isaac: mesmo jogo com outro executável, achado pelo nome
ins.run('i1', me.id, 'pc', 'game_stop', 'isaac', 'The Binding of Isaac: Rebirth', JSON.stringify({ seconds: 4000, steam: '250900' }), t - 6 * 3600e3);
ins.run('i2', me.id, 'pc', 'game_stop', 'isaac-ng', 'The Binding of Isaac: Rebirth', JSON.stringify({ seconds: 4000 }), t - 600e3);
const f = await call(r.token, 'GET', '/activity/feed');
const ev = (id) => f.events.find(e => e.id === id)?.game;
ok(ev('d4')?.steam === '1422450' && ev('d4')?.icon === icon, 'histórico: partida sem número herda o número e o ícone de outra do mesmo jogo', ev('d4'));
ok(ev('d3')?.steam === '1422450', 'histórico: início de partida sem número também', ev('d3'));
ok(ev('i2')?.steam === '250900', 'histórico: mesmo jogo por outro executável, achado pelo nome', ev('i2'));
const w = f.week?.games || [];
const dl = w.find(x => /deadlock/i.test(x.game.title)), is = w.find(x => /isaac/i.test(x.game.title));
ok(dl?.game.steam === '1422450' && dl?.game.icon === icon, 'semana: o jogo juntado de várias partidas fica com o número e o ícone', dl?.game);
ok(is?.game.steam === '250900', 'semana: Isaac com o número da Steam', is?.game);
console.log(fails ? `\n${fails} FALHA(S)` : '\nGAME ART OK'); process.exit(fails ? 1 : 0);
