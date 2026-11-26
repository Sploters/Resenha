// "Times e fila" (server/lobby.js) sem servidor: fila, passar a vez, rodízio, queda e volta, times e resultado.
// Uso: node scripts/lobby-unit-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { createLobby } from '../server/lobby.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
const get = (q, ...a) => db.prepare(q).get(...a), all = (q, ...a) => db.prepare(q).all(...a), run = (q, ...a) => db.prepare(q).run(...a);
let t = 1e6; const now = () => t;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const L = createLobby({ db, get, run, all, rnd, now });
const a = {}, members = ['ana', 'beto', 'caio', 'duda', 'edu', 'fer', 'gui'];
const op = (uid, d, m = members) => L.op(a, { uid, members: m, scope: 'g1' }, d);
const st = () => L.state(a.lobby);

op('ana', { op: 'open', game: 'Counter-Strike 2', slots: 5 });
ok(st().playing.join() === 'ana,beto,caio,duda,edu' && st().queue.join() === 'fer,gui', 'abre: 5 jogando na ordem de entrada, 2 na fila', st());
op('beto', { op: 'pass' });
ok(st().playing.join() === 'ana,caio,duda,edu,fer' && st().queue.join() === 'gui,beto', 'passar a vez: o 1º da fila sobe e quem passou vai pro fim', st());
L.onLeave(a, 'caio');
ok(st().playing.includes('gui') && !st().playing.includes('caio'), 'saiu da call: o próximo da fila sobe', st());
t += 30e3; L.onJoin(a, 'caio');
ok(st().queue[0] === 'caio' || st().playing.includes('caio'), 'voltou em 30 s: não vai pro fim (lobby cheio: frente da fila)', st());
op('duda', { op: 'out' });
ok(!st().playing.includes('duda') && !st().queue.includes('duda') && st().playing.length === 5, 'só resenhar: sai das listas e a vaga é preenchida', st());
op('ana', { op: 'join' });
ok(st().queue.at(-1) !== 'ana' || st().playing.includes('ana'), 'entrar na fila de quem já está não duplica');
const before = st();
op('edu', { op: 'rotate' });
const s1 = st();
ok(s1.round === 2 && s1.playing.length === 5 && before.queue.every(u => s1.playing.includes(u)), 'fim da partida: quem estava na fila entra', { before, s1 });
ok(before.playing.slice(0, before.queue.length).every(u => s1.queue.includes(u)), 'quem jogava há mais tempo vai para a fila');
op('ana', { op: 'open', game: 'Counter-Strike 2', slots: 3 });
ok(st().playing.length === 3 && st().queue.length === s1.queue.length + 2, 'menos vagas: os últimos voltam para a frente da fila', st());
ok(op('ana', { op: 'move', uid: 'duda', to: 'playing' }) === 'full', 'pôr para jogar com lobby cheio: recusa');
op('ana', { op: 'open', game: 'Counter-Strike 2', slots: 5 });

// times
op('ana', { op: 'teams', mode: 'luck', pool: 'playing', maps: ['Mirage', 'Inferno'], agents: [] });
let T = st().teams;
ok(T && T.a.length + T.b.length === 5 && Math.abs(T.a.length - T.b.length) === 1 && ['Mirage', 'Inferno'].includes(T.map), 'na sorte: 2 times e um mapa', T);
op('ana', { op: 'teams', mode: 'luck', pool: 'call', maps: [], agents: ['Jett', 'Sage', 'Omen'] });
T = st().teams;
ok(T.a.length + T.b.length === 7 && T.map === null && Object.keys(T.picks).length === 7, 'a call toda: 7 pessoas, cada uma com agente', T);
ok(new Set(T.a.map(u => T.picks[u])).size === Math.min(3, T.a.length), 'agentes não repetem no time enquanto a lista der');
// força: ana+beto ganham sempre juntos → no equilibrado ficam separados
for (let i = 0; i < 6; i++) {
  a.lobby.teams = { a: ['ana', 'beto'], b: ['caio', 'duda'], maps: [], agents: [], picks: {}, result: null };
  op('x', { op: 'result', win: 'a' });
}
ok(st().stats.ana?.g === 6 && st().stats.ana?.w === 6 && st().stats.caio?.w === 0, 'resultado conta vitórias e partidas', st().stats);
const r = (u) => get('SELECT rating FROM team_ratings WHERE user_id=?', u).rating;
ok(r('ana') > 1050 && r('caio') < 950, 'Elo sobe para quem vence', { ana: r('ana'), caio: r('caio') });
op('ana', { op: 'undo_result' });
ok(st().stats.ana?.g === 5 && Math.abs(r('ana') - r('beto')) < 1e-9, 'desfazer resultado devolve partida e força', { g: st().stats.ana, ana: r('ana') });
let sep = 0;
for (let i = 0; i < 10; i++) { op('ana', { op: 'teams', mode: 'balanced', pool: 'call', maps: [], agents: [] }, ['ana', 'beto', 'caio', 'duda']); T = st().teams; if (T.a.includes('ana') !== T.a.includes('beto')) sep++; }
ok(sep === 10, 'equilibrado: os dois mais fortes ficam em times diferentes', sep);
ok(op('ana', { op: 'teams', mode: 'luck', pool: 'call' }, ['ana']) === 'few', 'sortear com 1 pessoa: recusa');
op('ana', { op: 'close' });
ok(st() === null, 'fechar lobby');
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
