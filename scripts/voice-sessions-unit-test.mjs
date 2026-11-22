// Memória do grupo (server/sessions.js) e resumo diário de jogos (server/activity.js, activity_daily), sem servidor:
// banco de verdade (server/db.js) numa pasta temporária, relógio falso e salas de voz simuladas.
// Uso: node scripts/voice-sessions-unit-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'resenha-vsess-'));
process.env.DATA_DIR = DIR; process.env.DB_CHECK = 'off';
const { db, all, get, run, closeDb } = await import('../server/db.js');
const { createVoiceSessions } = await import('../server/sessions.js');
const { createActivityService } = await import('../server/activity.js');

let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
let T = Date.UTC(2026, 10, 20, 18, 0, 0); const now = () => T, min = (n) => { T += n * 60e3; }, sec = (n) => { T += n * 1000; };
let nid = 0; const newId = () => String(1e6 + nid++);
// tabelas dos módulos que não entram aqui (eventos e intenções), só com as colunas que a memória lê
db.exec(`CREATE TABLE events(id TEXT PRIMARY KEY, guild_id TEXT, author_id TEXT, title TEXT, channel_id TEXT, starts_at INTEGER, duration_min INTEGER, created_at INTEGER, cancelled_at INTEGER, started_at INTEGER, game TEXT);
  CREATE TABLE play_intents(id TEXT PRIMARY KEY, channel_id TEXT, formed_at INTEGER, ended_at INTEGER);`);
for (const u of ['ana', 'beto', 'caio', 'dani', 'eva']) run("INSERT INTO users(id,username,pass_hash,salt,created_at) VALUES(?,?,'x','x',0)", u, u);
run("INSERT INTO guilds(id,name,owner_id) VALUES('g1','Turma','ana')");
for (const u of ['ana', 'beto', 'caio', 'dani', 'eva']) run("INSERT INTO members(guild_id,user_id) VALUES('g1',?)", u);
run("INSERT INTO channels(id,guild_id,type,name) VALUES('v1','g1',2,'Geral'),('v2','g1',2,'Jogos'),('v3','g1',2,'Temporária'),('t1','g1',0,'chat')");
run("INSERT INTO channels(id,guild_id,type,name) VALUES('dm1',NULL,1,NULL)");

// salas de voz: cid -> Map(uid -> { bot, at })
const rooms = new Map();
const roomOf = (cid) => [...(rooms.get(cid) || [])].map(([id, st]) => ({ id, ...st }));
const optOut = new Set();
const A = createActivityService({ all, get, run, newId, now, dispatch: () => { }, isInvisible: (u) => get('SELECT status FROM users WHERE id=?', u)?.status === 'invisible',
  inVoice: (u) => [...rooms.values()].some(r => r.has(u)), isOnline: () => true, getAdapter: () => null, listAdapters: () => [] });
const mk = () => createVoiceSessions({ db, all, get, run, newId, now, schedule: () => { },
  roomOf, channelOf: (cid) => get('SELECT guild_id, name FROM channels WHERE id=?', cid), remembers: (u) => !optOut.has(u),
  gamesDuring: (uids, a, b) => A.gamesDuring(uids, a, b) });
let S = mk();
const join = (cid, uid, bot = false) => { (rooms.get(cid) || rooms.set(cid, new Map()).get(cid)).set(uid, { bot, at: T }); A.onVoice(uid); S.onVoice(cid); };
const leave = (cid, uid) => { rooms.get(cid)?.delete(uid); A.onVoice(uid); S.onVoice(cid); };
const sess = (cid) => all('SELECT * FROM voice_sessions WHERE channel_id=? ORDER BY started_at', cid);
const mem = (id) => Object.fromEntries(all('SELECT user_id, secs, first_at, last_at FROM voice_session_members WHERE session_id=?', id).map(m => [m.user_id, m]));

// ---- 1) abre com 2, pico, soma dos trechos de quem sai e volta ----
const t0 = T;
join('v1', 'ana'); ok(sess('v1').length === 0, 'uma pessoa sozinha não abre sessão');
min(1); join('v1', 'beto');
let s1 = sess('v1'); ok(s1.length === 1 && s1[0].started_at === t0 + 60e3 && s1[0].ended_at === null && s1[0].channel_name === 'Geral', 'abre ao chegar a 2 pessoas', s1[0]);
min(5); join('v1', 'caio');
min(10); leave('v1', 'caio');                 // caio: 10 min
min(5); join('v1', 'caio'); min(5); leave('v1', 'caio'); // + 5 min
min(10);
// cai para 1 por 30 s e volta: mesma sessão
leave('v1', 'beto'); sec(30); S.sweep(); join('v1', 'beto');
ok(sess('v1').length === 1 && !S._state.live.get('v1').dropAt, 'caiu para 1 e voltou na carência de 60 s: a mesma sessão');
min(4); const drop = T; leave('v1', 'beto'); sec(59); S.sweep();
ok(sess('v1')[0].ended_at === null, 'ainda na carência (59 s): não fechou');
sec(2); S.sweep(); s1 = sess('v1')[0];
ok(s1.ended_at === drop, 'fechou depois de 60 s com 1 pessoa, com o fim em quando caiu para 1', { ended: s1.ended_at, drop });
ok(s1.peak === 3, 'pico = 3', s1.peak);
let m1 = mem(s1.id);
ok(m1.caio?.secs === 15 * 60, 'caio saiu e voltou: 10 + 5 min somados', m1.caio);
ok(m1.beto?.secs === 39 * 60, 'beto: 35 + 4 min (sem os 30 s fora)', m1.beto);
ok(m1.ana?.secs === (drop - (t0 + 60e3)) / 1000 && m1.ana.first_at === t0 + 60e3, 'ana: do início da sessão até cair para 1 (antes de abrir não conta)', m1.ana);
leave('v1', 'ana');

// ---- 2) sessão curta é descartada ----
min(10); join('v2', 'ana'); join('v2', 'beto'); min(2); leave('v2', 'beto'); leave('v2', 'ana'); min(2); S.sweep();
ok(sess('v2').length === 0 && !get("SELECT 1 x FROM voice_session_members vm LEFT JOIN voice_sessions s ON s.id=vm.session_id WHERE s.id IS NULL"), 'sessão de 2 min: descartada (sem sobras)');

// ---- 3) DM e bot ficam de fora; opção desligada não vira participante ----
join('dm1', 'ana'); join('dm1', 'beto'); min(10); leave('dm1', 'ana'); leave('dm1', 'beto'); min(2); S.sweep();
ok(sess('dm1').length === 0, 'ligação na DM não vira sessão');
join('v2', 'bot_music_1', true); join('v2', 'ana'); min(5);
ok(sess('v2').length === 0, 'bot + 1 pessoa não é sessão');
optOut.add('dani'); join('v2', 'dani'); min(1); join('v2', 'eva'); min(10);
let s2 = sess('v2')[0];
ok(s2 && !mem(s2.id).dani && !mem(s2.id).bot_music_1 && mem(s2.id).ana && mem(s2.id).eva, 'dani (opção desligada) e o bot não viram participantes', mem(s2?.id));
for (const u of ['bot_music_1', 'ana', 'dani', 'eva']) leave('v2', u);
min(2); S.sweep(); s2 = sess('v2')[0];
ok(s2.ended_at && s2.peak === 3, 'pico conta a dani (3 pessoas, sem o bot)', s2.peak);
optOut.delete('dani');

// ---- 4) resumo: jogos sem escondido nem privado, clipes, evento e intenção; sala apagada mantém a sessão ----
run("UPDATE users SET status='invisible' WHERE id='caio'");
const ts = T;
run("INSERT INTO events(id,guild_id,author_id,title,channel_id,starts_at,duration_min,created_at,started_at) VALUES('ev1','g1','ana','CS sexta','v3',?,120,?,?)", ts, ts - 864e5, ts);
run("INSERT INTO play_intents(id,channel_id,formed_at) VALUES('it1','v3',?)", ts - 60e3);
join('v3', 'ana'); join('v3', 'beto'); join('v3', 'caio');
A.reportLocal('ana', { id: 'cs2', title: 'Counter-Strike 2' }); A.reportLocal('beto', { id: 'cs2', title: 'Counter-Strike 2' });
A.reportLocal('caio', { id: 'peak', title: 'PEAK' }); // invisível: partida privada
A.reportLocal('eva', { id: 'segredo', title: 'Jogo Secreto' }); join('v3', 'eva');
min(20); A.reportLocal('eva', null); // eva parou; depois esconde o jogo
run("INSERT INTO game_prefs(user_id,platform,game_id,hidden) VALUES('eva','pc','segredo',1)");
min(1); run("INSERT INTO clips(id,guild_id,channel_id,author_id,title,url,created_at) VALUES('c1','g1','v3','ana','Clutch','/files/x.webm/a',?)", T);
min(19); for (const u of ['ana', 'beto', 'caio']) A.reportLocal(u, null);
A.reportLocal('ana', { id: 'cs2', title: 'Counter-Strike 2' }); // continua jogando (partida em andamento conta)
for (const u of ['ana', 'beto', 'caio', 'eva']) leave('v3', u);
min(2); S.sweep();
const s3 = sess('v3')[0], sum = s3 && JSON.parse(s3.summary || '{}');
run("DELETE FROM channels WHERE id='v3'"); // a sala temporária é apagada depois
ok(sess('v3').length === 1 && s3.ended_at && s3.channel_name === 'Temporária', 'sala apagada: a sessão continua guardada com o nome da época', s3 && { name: s3.channel_name, ended: !!s3.ended_at });
// sala apagada no meio da carência (a sala temporária da intenção some quando esvazia): fecha e guarda do mesmo jeito
run("INSERT INTO channels(id,guild_id,type,name) VALUES('v6','g1',2,'Grupo de CS')");
join('v6', 'ana'); join('v6', 'beto'); min(10); leave('v6', 'beto'); leave('v6', 'ana'); run("DELETE FROM channels WHERE id='v6'");
min(2); S.sweep();
ok(sess('v6').length === 1 && sess('v6')[0].ended_at && sess('v6')[0].channel_name === 'Grupo de CS', 'sala apagada durante a carência: sessão fechada e mantida');
ok(sum.games?.length === 1 && sum.games[0].title === 'Counter-Strike 2' && sum.games[0].people === 2 && sum.games[0].mins === 40, 'jogos: só CS2 (2 pessoas, 40 min); PEAK (invisível) e o jogo escondido ficam de fora', sum.games);
ok(!JSON.stringify(sum).match(/ana|beto|caio|eva/), 'resumo sem nomes', sum);
ok(sum.clips === 1 && s3.event_id === 'ev1' && s3.intent_id === 'it1', 'clipe, evento e intenção da sala associados', { clips: sum.clips, ev: s3.event_id, it: s3.intent_id });
run("UPDATE users SET status=NULL WHERE id='caio'"); A.reportLocal('ana', null);

// ---- 5) reinício: a sessão aberta é reaproveitada; sem ninguém, fecha em 3 min com o último last_at ----
run("INSERT INTO channels(id,guild_id,type,name) VALUES('v4','g1',2,'Noite'),('v5','g1',2,'Madrugada')");
join('v4', 'ana'); join('v4', 'beto'); join('v5', 'caio'); join('v5', 'dani');
min(30); S.flush(); const flushedAt = T; min(2);
const id4 = sess('v4')[0].id, id5 = sess('v5')[0].id;
S.stop(); // encerramento do app: grava o tempo de quem está em chamada
const lastAt = T;
min(1); S = mk(); // app novo (a voz continuou: ana e beto ainda na v4; caio e dani caíram de vez da v5)
rooms.get('v5').clear();
ok(S._state.pending.size === 2, 'subiu com as 2 sessões abertas esperando a carência', S._state.pending.size);
min(1); join('v4', 'caio'); // aviso de entrada na v4: a sessão é reaproveitada
ok(sess('v4').length === 1 && S._state.live.get('v4')?.id === id4, 'v4 com gente: a mesma sessão continua');
min(1); S.sweep(); ok(sess('v5')[0].ended_at === null, 'v5 vazia: espera os 3 min');
min(2); S.sweep();
const s5 = get('SELECT * FROM voice_sessions WHERE id=?', id5);
ok(s5?.ended_at === lastAt && flushedAt < lastAt, 'v5: fechou com o último last_at gravado (o do encerramento)', { ended: s5?.ended_at, lastAt });
min(30); for (const u of ['ana', 'beto', 'caio']) leave('v4', u); min(2); S.sweep();
const s4 = get('SELECT * FROM voice_sessions WHERE id=?', id4), m4 = mem(id4);
ok(s4.ended_at && sess('v4').length === 1, 'v4 fecha normalmente depois (uma sessão só)');
ok(m4.ana.secs === 66 * 60, 'ana: 32 min antes + 34 min depois do reinício (o minuto da troca não conta)', m4.ana.secs);

// ---- 6) tirar a própria participação no meio da sessão: não volta a entrar nela ----
join('v1', 'ana'); join('v1', 'beto'); min(1);
const id6 = sess('v1').at(-1).id;
ok(S.removeMember(id6, 'beto') && !mem(id6).beto, 'beto tira a participação');
leave('v1', 'beto'); join('v1', 'beto'); min(5);
ok(!mem(id6).beto, 'beto saiu e voltou: continua fora dessa sessão');
leave('v1', 'beto'); leave('v1', 'ana'); min(2); S.sweep();

// ---- 7) activity_daily: soma por dia, sem partida privada nem jogo escondido ----
const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'America/Sao_Paulo' });
const daily = (u, g) => all('SELECT * FROM activity_daily WHERE user_id=? AND game_id=?', u, g);
let d = daily('ana', 'cs2');
ok(d.length && d.reduce((a, r) => a + r.sessions, 0) === 2 && d.every(r => r.secs_call > 0), 'ana/CS2: 2 partidas registradas no resumo diário', d);
ok(daily('caio', 'peak').length === 0, 'partida privada (invisível) não entra');
ok(daily('eva', 'segredo').length === 1, 'jogo escondido DEPOIS de jogar: a partida já tinha entrado (esconder vale dali em diante)');
join('v1', 'dani'); A.reportLocal('dani', { id: 'val', title: 'VALORANT' }); min(30); A.reportLocal('dani', null);
A.reportLocal('dani', { id: 'val', title: 'VALORANT' }); min(15); A.reportLocal('dani', null); leave('v1', 'dani');
d = daily('dani', 'val');
ok(d.length === 1 && d[0].sessions === 2 && d[0].secs_call === 45 * 60 && d[0].day === day(T), 'dani/VALORANT: 2 partidas no mesmo dia somam 45 min', d[0]);
A.reportLocal('dani', { id: 'escondido', title: 'Outro' }); run("INSERT INTO game_prefs(user_id,platform,game_id,hidden) VALUES('dani','pc','escondido',1)"); min(5); A.reportLocal('dani', null);
ok(daily('dani', 'escondido').length === 0, 'jogo escondido ao terminar a partida: não entra');

S.stop(); A.stop(); closeDb(); fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
