// Eventos com vagas por função, lista de espera e evento semanal (server/events.js), sem servidor: banco na memória,
// rotas chamadas direto e relógio simulado (o semanal precisa que o evento termine).
// Uso: node scripts/events-roles-unit-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { mountEvents } from '../server/events.js';
process.env.EVENTS_TICK_MS = '3600000'; // o tick roda só quando o teste chama
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE guilds(id TEXT PRIMARY KEY, owner_id TEXT);
  CREATE TABLE members(guild_id TEXT, user_id TEXT); CREATE TABLE channels(id TEXT PRIMARY KEY, guild_id TEXT, type INTEGER, name TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY, channel_id TEXT, author_id TEXT, content TEXT, created_at INTEGER); CREATE TABLE read_states(user_id TEXT, channel_id TEXT, last_id TEXT, PRIMARY KEY(user_id,channel_id));`);
const all = (q, ...a) => db.prepare(q).all(...a), get = (q, ...a) => db.prepare(q).get(...a), run = (q, ...a) => db.prepare(q).run(...a);
let clock = Date.UTC(2026, 10, 20, 12), seq = 0;
const sent = [];
const routes = {}; const app = {}; for (const m of ['get', 'post', 'patch', 'put', 'delete']) app[m] = (p, ...hs) => { routes[m.toUpperCase() + ' ' + p] = hs[hs.length - 1]; };
const ev = mountEvents(app, { auth: null, wrap: (f) => f, bad: (res, msg, code = 400) => res.status(code).json({ error: msg }), db, all, get, run, newId: () => String(++seq).padStart(6, '0'),
  dispatch: (ids, t, d) => sent.push({ ids, t, d }), guildMemberIds: (g) => all('SELECT user_id FROM members WHERE guild_id=?', g).map(x => x.user_id),
  can: () => false, P: { MANAGE_GUILD: 2 }, userPub: (id) => ({ id }), clean: (s, n) => String(s ?? '').trim().slice(0, n), messageObj: (m) => m, now: () => clock, log: () => { } });
function call(method, path, uid, body = {}, params = {}, query = {}) {
  const key = Object.keys(routes).find(k => { const [m, p] = k.split(' '); if (m !== method) return false; const re = new RegExp('^' + p.replace(/:[a-z]+/g, '([^/]+)').replace('.', '\\.') + '$'); return re.test(path); });
  const [, p] = key.split(' '), names = [...p.matchAll(/:([a-z]+)/g)].map(m => m[1]), vals = path.match(new RegExp('^' + p.replace(/:[a-z]+/g, '([^/]+)').replace('.', '\\.') + '$')).slice(1);
  let out = null, status = 200;
  const res = { status(c) { status = c; return res; }, json(j) { out = j; return res; }, set() { return res; }, send(x) { out = x; return res; } };
  routes[key]({ uid, body, params: { ...Object.fromEntries(names.map((n, i) => [n, vals[i]])), ...params }, query }, res);
  return { status, ...out };
}
for (const u of ['lider', 'ana', 'bia', 'caio', 'duda', 'eli']) run('INSERT INTO users VALUES(?)', u);
run("INSERT INTO guilds VALUES('g', 'lider')");
for (const u of ['lider', 'ana', 'bia', 'caio', 'duda', 'eli']) run("INSERT INTO members VALUES('g', ?)", u);
run("INSERT INTO channels VALUES('txt', 'g', 0, 'geral')"); run("INSERT INTO channels VALUES('voz', 'g', 2, 'Raid')");

// raid com funções: 1 tanque, 1 cura, 2 dano
const roles = [{ id: 'r1', emoji: '🛡️', name: 'Tanque', slots: 1 }, { id: 'r2', emoji: '💚', name: 'Cura', slots: 1 }, { id: 'r3', emoji: '⚔️', name: 'Dano', slots: 2 }];
const start = clock + 864e5;
let e = call('POST', '/api/guilds/g/events', 'lider', { title: 'Raid de quinta', starts_at: start, duration_min: 120, channel_id: 'voz', announce_id: 'txt', roles, weekly: true, my_role: 'r1' });
ok(!e.error && e.roles?.length === 3 && e.weekly === true, 'evento com 3 funções e semanal', e);
ok(e.roles?.[0].yes.join() === 'lider' && e.picks?.lider === 'r1', 'quem marca entra na função escolhida (tanque)');
const id = e.id, rsvp = (u, b) => call('PUT', `/api/events/${id}/rsvp`, u, b, { id });
ok(!!rsvp('ana', { state: 'yes' }).error, '"Vou" sem função é recusado num evento com funções');
e = rsvp('ana', { state: 'yes', role: 'r1' });
ok(e.wait?.join() === 'ana' && e.roles[0].wait.join() === 'ana', 'tanque cheio: ana vai para a espera do tanque', e.roles?.[0]);
e = rsvp('bia', { state: 'yes', role: 'r1' });
ok(e.roles[0].wait.join() === 'ana,bia', 'bia entra depois da ana na espera (ordem de chegada)');
e = rsvp('caio', { state: 'yes', role: 'r3' }); e = rsvp('duda', { state: 'yes', role: 'r3' });
ok(e.roles[2].yes.length === 2 && !e.wait.includes('caio'), 'dano: 2 de 2 confirmados');
e = rsvp('eli', { state: 'yes', role: 'r3' });
ok(e.roles[2].wait.join() === 'eli', 'eli na espera do dano');
// abre vaga
sent.length = 0;
e = call('PUT', `/api/events/${id}/rsvp`, 'lider', { state: 'no' }, { id });
ok(e.roles[0].yes.join() === 'ana' && e.roles[0].wait.join() === 'bia', 'líder sai do tanque: ana sobe sozinha, bia continua esperando');
ok(sent.some(s => s.t === 'EVENT_REMINDER' && s.d.kind === 'promoted' && s.ids.join() === 'ana'), 'ana recebe o aviso de que entrou');
// trocar de função: caio (dano) vai para cura (vaga livre) e eli sobe no dano
e = rsvp('caio', { state: 'yes', role: 'r2' });
ok(e.roles[1].yes.join() === 'caio' && e.roles[2].yes.includes('eli'), 'caio troca para cura e eli sobe no dano');
// quem espera e desiste sai da fila
e = rsvp('bia', { state: 'maybe' });
ok(!e.wait.includes('bia') && e.maybe.includes('bia'), 'bia desiste da espera: vira Talvez');
// editar funções: aumentar o tanque para 2 promove; tirar a cura devolve o caio para Talvez
e = call('PUT', `/api/events/${id}/rsvp`, 'bia', { state: 'yes', role: 'r1' }, { id });
ok(e.roles[0].wait.join() === 'bia', 'bia volta para a espera do tanque');
e = call('PATCH', `/api/events/${id}`, 'lider', { roles: [{ id: 'r1', name: 'Tanque', emoji: '🛡️', slots: 2 }, { id: 'r3', name: 'Dano', emoji: '⚔️', slots: 2 }, { name: 'Bardo', slots: 1 }] }, { id });
ok(e.roles[0].yes.join() === 'ana,bia', 'tanque com 2 vagas: bia sobe da espera');
ok(e.maybe.includes('caio') && !e.picks.caio, 'função Cura tirada: caio fica como Talvez, sem função');
ok(e.roles[2].name === 'Bardo' && e.roles[2].id !== 'r2', 'função nova ganha id novo (não herda quem era da Cura)', e.roles[2]);

// evento sem funções: cheio vira espera e sobe sozinho
let s2 = call('POST', '/api/guilds/g/events', 'lider', { title: 'CS2', starts_at: start, duration_min: 60, slots: 2 });
const r2 = (u, st) => call('PUT', `/api/events/${s2.id}/rsvp`, u, { state: st }, { id: s2.id });
r2('ana', 'yes'); s2 = r2('bia', 'yes');
ok(s2.yes.length === 2 && s2.wait.join() === 'bia', 'sem funções: 3ª pessoa fica na espera (2 vagas)');
s2 = r2('ana', 'no');
ok(s2.yes.includes('bia') && !s2.wait.length, 'ana desiste: bia sobe');

// semanal: termina -> o da semana que vem é marcado, com as funções, e quem foi é avisado
sent.length = 0;
clock = start + 121 * 60e3; ev.tick();
const next = all("SELECT * FROM events WHERE title='Raid de quinta' AND id<>?", id);
ok(next.length === 1 && next[0].starts_at === start + 7 * 864e5, 'o da próxima semana foi marcado no mesmo horário', next.map(x => x.starts_at - start));
const n0 = next[0] && call('GET', '/api/guilds/g/events', 'ana', {}, { id: 'g' }).events.find(x => x.id === next[0].id);
ok(n0?.roles?.length === 3 && n0.weekly && n0.yes.join() === 'lider', 'mesmas funções, continua semanal, só o líder confirmado', n0 && { roles: n0.roles.length, yes: n0.yes });
ok(sent.some(s => s.t === 'EVENT_REMINDER' && s.d.kind === 'weekly' && s.ids.includes('ana') && s.ids.includes('eli')), 'quem foi recebe "confirme a próxima semana"');
ok(next[0] && get('SELECT message_id FROM events WHERE id=?', next[0].id).message_id, 'anunciado de novo no canal');
ev.tick();
ok(all("SELECT id FROM events WHERE title='Raid de quinta'").length === 2, 'não duplica no tick seguinte');
// cancelar a série
const nid = next[0].id;
call('DELETE', `/api/events/${nid}`, 'lider', {}, { id: nid }, { serie: '1' });
clock = start + 7 * 864e5 + 121 * 60e3; ev.tick();
ok(all("SELECT id FROM events WHERE title='Raid de quinta'").length === 2, 'série cancelada: não marca a seguinte');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
