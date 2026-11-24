// Horas de jogo só contam em call + invisível conta na semana da galera sem identificar + jogo do PC sempre aparece para
// os amigos (server/activity.js).
// Testa o serviço direto, com banco em memória e relógio falso (não sobe o servidor).
// Uso: node scripts/activity-voice-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { createActivityService } from '../server/activity.js';

let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, pc_activity TEXT DEFAULT 'servers', status TEXT, pc_notice_at INTEGER);
  CREATE TABLE relationships(user_id TEXT, other_id TEXT, type INTEGER);
  CREATE TABLE members(guild_id TEXT, user_id TEXT);
  CREATE TABLE linked_accounts(user_id TEXT, platform TEXT, visibility TEXT, link_visibility TEXT, external_id TEXT);
  CREATE TABLE game_prefs(user_id TEXT, platform TEXT, game_id TEXT, hidden INTEGER);
  CREATE TABLE activities(id TEXT, user_id TEXT, platform TEXT, kind TEXT, game_id TEXT, title TEXT, data TEXT, created_at INTEGER);`);
const all = (q, ...a) => db.prepare(q).all(...a), get = (q, ...a) => db.prepare(q).get(...a), run = (q, ...a) => db.prepare(q).run(...a);
for (const u of ['eu', 'ana', 'beto', 'caio']) run('INSERT INTO users(id) VALUES(?)', u);
for (const [a, b] of [['eu', 'ana'], ['eu', 'beto'], ['eu', 'caio']]) { run('INSERT INTO relationships VALUES(?,?,1)', a, b); run('INSERT INTO relationships VALUES(?,?,1)', b, a); }

let T = Date.UTC(2026, 10, 18, 15, 0, 0); const now = () => T, min = (n) => { T += n * 60e3; };
const voice = new Set(), sent = []; let nid = 0;
const A = createActivityService({ all, get, run, newId: () => 'a' + nid++, now, dispatch: (to, t, d) => sent.push({ to, t, d }),
  isInvisible: (u) => get('SELECT status FROM users WHERE id=?', u)?.status === 'invisible', inVoice: (u) => voice.has(u), isOnline: () => true,
  getAdapter: () => null, listAdapters: () => [] });
const join = (u) => { voice.add(u); A.onVoice(u); }, leave = (u) => { voice.delete(u); A.onVoice(u); };
const stops = (u) => all("SELECT data FROM activities WHERE user_id=? AND kind='game_stop'", u).map(r => JSON.parse(r.data));
const VAL = { id: 'valorant', title: 'VALORANT' };

// 1) jogo aberto sem call: aparece ao vivo, mas não soma horas
A.reportLocal('ana', VAL);
ok(sent.some(e => e.to.includes('eu') && e.d.activity?.game.id === 'valorant'), 'jogo aberto sem call: o amigo vê ao vivo');
min(60); A.reportLocal('ana', VAL);
// 2) entrou na call: 30 min contam; mutada/na espera é a mesma coisa (continua na sala)
join('ana'); min(30); A.reportLocal('ana', VAL);
leave('ana'); min(45); A.reportLocal('ana', VAL);
// 3) voltou para uma ligação na DM: mais 20 min
join('ana'); min(20); A.reportLocal('ana', null); leave('ana');
let s = stops('ana').at(-1);
ok(s.seconds === 50 * 60 && s.open === 155 * 60, 'só os minutos em call contam (50 de 155 com o jogo aberto)', s);
let w = A.weekFor('eu').played.find(p => p.user_id === 'ana');
ok(w?.secs === 50 * 60, 'semana da galera usa só as horas em call', w);

// 4) partida inteira fora de call: não conta nem o dia
A.reportLocal('beto', { id: 'peak', title: 'PEAK' }); min(120); A.reportLocal('beto', null);
ok(stops('beto').at(-1).seconds === 0 && !A.weekFor('eu').played.some(p => p.user_id === 'beto'), 'sem call: 0 h e o dia não conta');

// 5) jogo do PC sempre visível para amigos (a opção "Quem pode ver meu jogo do PC" saiu em 24/11/2026): o amigo vê ao vivo,
// no READY e no feed; conta com nome
sent.length = 0;
join('beto'); A.reportLocal('beto', { id: 'hades', title: 'Hades' });
ok(sent.some(e => e.to.includes('eu') && e.d.activity?.game.id === 'hades'), 'jogo do PC: o amigo recebe o jogo', sent.map(e => e.to));
ok(A.readyFor('eu').length === 1 && A.readyFor('beto').length === 1, 'aparece no READY do amigo (Ativo agora)');
min(90); A.reportLocal('beto', { id: 'hades', title: 'Hades' }); A.reportLocal('beto', null); leave('beto');
ok(!stops('beto').at(-1).priv, 'a partida não fica privada');
ok(A.feedFor('eu').events.some(e => e.user_id === 'beto' && e.game.id === 'hades'), 'o feed do amigo mostra a partida');
ok(A.weekFor('eu', { top: 5 }).played.some(p => p.user_id === 'beto' && p.game.id === 'hades'), 'e conta na semana com o nome');

// 6) invisível: ninguém vê ao vivo; conta sem nome
run("UPDATE users SET status='invisible' WHERE id='ana'"); sent.length = 0;
join('ana'); A.reportLocal('ana', { id: 'cs2', title: 'Counter-Strike 2' });
ok(sent.every(e => e.to.length === 1 && e.to[0] === 'ana'), 'invisível: só a própria ana recebe');
min(60); A.reportLocal('ana', null); leave('ana');
let g = A.weekFor('eu', { top: 5 }).games.find(x => x.game.id === 'cs2');
ok(g?.secs === 3600 && g.anon === 1 && g.players.length === 0, 'invisível: a hora entra na semana sem identificar', g);

// 7) ficou invisível no meio da partida: some para os outros, a partida segue e conta
run("UPDATE users SET status=NULL WHERE id='ana'");
join('ana'); A.reportLocal('ana', VAL); min(10); sent.length = 0;
run("UPDATE users SET status='invisible' WHERE id='ana'"); A.onInvisible('ana', true);
ok(sent.some(e => e.to[0] === 'eu' && e.d.activity === null), 'ficou invisível: o amigo recebe "parou"');
min(10); A.reportLocal('ana', null); leave('ana');
const st = stops('ana').slice(-2);
ok(st[0].seconds === 600 && !st[0].priv && st[1].seconds === 600 && st[1].priv === 1, 'a partida segue em dois trechos: 10 min visível + 10 min privado (sem nome)', st);

// 8) voltou a aparecer no meio da partida: o trecho privado continua sem nome, o novo aparece
run("UPDATE users SET status='invisible' WHERE id='beto'");
join('beto'); A.reportLocal('beto', { id: 'dota', title: 'Dota 2' });
min(15); A.reportLocal('beto', { id: 'dota', title: 'Dota 2' }); sent.length = 0;
run("UPDATE users SET status=NULL WHERE id='beto'"); A.onInvisible('beto', false);
ok(sent.some(e => e.to[0] === 'eu' && e.d.activity?.game.id === 'dota'), 'voltou a aparecer: o amigo volta a ver o jogo atual');
min(15); A.reportLocal('beto', null); leave('beto');
const dota = A.weekFor('eu', { top: 9 }).played.find(p => p.user_id === 'beto' && p.game.id === 'dota');
ok(dota?.secs === 900, 'na semana, com nome só o trecho visível (15 min)', dota);
ok(!A.feedFor('eu').events.some(e => e.user_id === 'beto' && e.game.id === 'dota' && e.data?.priv), 'o trecho invisível não aparece com nome no feed');

// 9) está invisível AGORA, mas jogou às claras antes: na semana e no feed aparece com nome (antes contava só no número)
// (a ana segue invisível desde o passo 7; jogou VALORANT visível nos passos 3 e 7)
const wk = A.weekFor('eu', { top: 9 }), val = wk.games.find(x => x.game.id === 'valorant');
ok(wk.played.some(p => p.user_id === 'ana' && p.game.id === 'valorant'), 'invisível agora: o que jogou visível aparece com nome na semana', wk.played.filter(p => p.user_id === 'ana'));
ok(val?.players.some(p => p.user_id === 'ana') && val.anon === 0, 'e o rosto entra no jogo (não fica só no número)', val && { players: val.players.map(p => p.user_id), anon: val.anon });
ok(A.feedFor('eu').events.some(e => e.user_id === 'ana' && e.game.id === 'valorant'), 'e no feed ("Nos últimos dias")');
ok(!A.readyFor('eu').some(a => a.user_id === 'ana'), 'ao vivo continua escondida (invisível)');
const cs = wk.games.find(x => x.game.id === 'cs2');
ok(cs?.anon === 1 && cs.players.length === 0, 'a partida jogada invisível continua sem nome', cs && { anon: cs.anon, players: cs.players });

// 10) partida do PC gravada no "Ninguém" antigo (priv), antes de a opção sair: agora aparece com nome
db.exec('CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)');
const legacyAt = T - 3600e3;
run("INSERT INTO activities VALUES('old1','caio','pc','game_stop','hades2','Hades II',?,?)", JSON.stringify({ seconds: 5400, priv: 1 }), legacyAt);
run("INSERT INTO meta VALUES('pc-always-on-1',?)", String(T - 60e3)); run("UPDATE users SET pc_notice_at=? WHERE id='caio'", T - 60e3);
const h2 = A.weekFor('eu', { top: 9 }).games.find(x => x.game.id === 'hades2');
ok(h2?.players.some(p => p.user_id === 'caio') && h2.anon === 0, '"Ninguém" antigo: a partida aparece com nome e rosto', h2 && { players: h2.players.map(p => p.user_id), anon: h2.anon });
ok(A.feedFor('eu').events.some(e => e.user_id === 'caio' && e.game.id === 'hades2'), '"Ninguém" antigo: aparece no feed');
// a mesma marca numa partida de DEPOIS da mudança é invisível de verdade: continua sem nome
run("INSERT INTO activities VALUES('new1','caio','pc','game_stop','celeste','Celeste',?,?)", JSON.stringify({ seconds: 4000, priv: 1 }), T);
const ce = A.weekFor('eu', { top: 9 }).games.find(x => x.game.id === 'celeste');
ok(ce?.anon === 1 && ce.players.length === 0, 'priv depois da mudança (invisível): continua sem nome', ce && { anon: ce.anon, players: ce.players });

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
