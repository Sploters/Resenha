// Limites de conta e de servidor (server/limits.js), com números pequenos para chegar neles rápido: servidores por conta
// (criar, link de convite, anúncio do LFG com sala), cargos, canais, categorias, canais por categoria (criar e mover),
// convites (e o "Convidar pessoas" que reaproveita o último), amigos, pedidos sem resposta e bloqueados.
// O convite para a chamada e a sala do "A fim de jogar" usam a mesma checagem (guildFull) e têm teste de unidade abaixo.
// Uso: node scripts/limits-test.mjs
import { ownServer } from './test-server.mjs';
import { createCallInvites } from '../server/callinvites.js';
import { DatabaseSync } from 'node:sqlite';
const BASE = await ownServer('limits', 3396, 41520, {
  LIMIT_GUILDS: '2', LIMIT_ROLES: '2', LIMIT_CHANNELS: '8', LIMIT_CATEGORIES: '3', LIMIT_PER_CATEGORY: '2', LIMIT_INVITES: '2',
  LIMIT_FRIENDS: '1', LIMIT_PENDING_OUT: '1', LIMIT_BLOCKED: '1',
});
const db = new DatabaseSync('./.testdata-limits/resenha.db'); // só para ler ids e conferir (o servidor é quem escreve)
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const call = (tok, m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, ...(await r.json()) }));
const reg = async (u) => (await call('', 'POST', '/register', { username: u, password: 'Teste.senha-123' })).token;
const refused = (r) => r.status === 409 && !!r.error;
try {
  const [A, B, C, D, E] = await Promise.all(['ana', 'beto', 'caio', 'duda', 'enzo'].map(reg));
  const id = (u) => db.prepare('SELECT id FROM users WHERE username=?').get(u).id;
  ok((await call('', 'GET', '/server-info')).limits?.guilds === 2, 'server-info expõe os limites');

  // servidores por conta
  const g1 = await call(A, 'POST', '/guilds', { name: 'um' }), g2 = await call(A, 'POST', '/guilds', { name: 'dois' });
  ok(g1.id && g2.id, 'cria até o limite de servidores');
  const g3 = await call(A, 'POST', '/guilds', { name: 'três' }); ok(refused(g3), 'passando do limite, criar servidor é recusado', g3.error);
  await call(B, 'POST', '/guilds', { name: 'b1' }); const gb2 = await call(B, 'POST', '/guilds', { name: 'b2' });
  const inv = await call(A, 'POST', `/guilds/${g1.id}/invites`, {});
  const j = await call(B, 'POST', '/invites/' + inv.code); ok(refused(j), 'entrar por link estando no limite é recusado', j.error);
  await call(B, 'DELETE', `/guilds/${gb2.id}`);
  ok(!!(await call(B, 'POST', '/invites/' + inv.code)).id, 'saindo de um, o link volta a funcionar');

  // convites
  const inv2 = await call(A, 'POST', `/guilds/${g1.id}/invites`, {});
  ok(inv2.code === inv.code, '"Convidar pessoas" reaproveita o último convite de quem convida');
  ok(!!(await call(A, 'POST', `/guilds/${g1.id}/invites`, { new: true })).code, 'código novo pedido explicitamente');
  ok(refused(await call(A, 'POST', `/guilds/${g1.id}/invites`, { new: true })), 'passando do limite de convites, criar é recusado');
  ok(refused(await call(B, 'POST', `/guilds/${g1.id}/invites`, {})), 'quem ainda não tem convite também esbarra no limite');

  // cargos
  ok(!!(await call(A, 'POST', `/guilds/${g1.id}/roles`, { name: 'r1' })).id && !!(await call(A, 'POST', `/guilds/${g1.id}/roles`, { name: 'r2' })).id, 'cria até o limite de cargos');
  ok(refused(await call(A, 'POST', `/guilds/${g1.id}/roles`, { name: 'r3' })), 'passando do limite de cargos, criar é recusado');

  // canais: o servidor nasce com 2 categorias + 2 canais; limite 8 canais, 3 categorias, 2 por categoria
  const cat = await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'cat', type: 4 });
  ok(refused(await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'cat2', type: 4 })), 'passando do limite de categorias, criar é recusado');
  const c1 = await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'a', parent_id: cat.id });
  const c2 = await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'b', parent_id: cat.id });
  ok(c1.id && c2.id, 'cria canais dentro da categoria até o limite dela');
  ok(refused(await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'x', parent_id: cat.id })), 'categoria cheia: canal novo nela é recusado');
  const loose = await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'c' });
  const mv = await call(A, 'PATCH', `/channels/${loose.id}`, { parent_id: cat.id, name: 'nao-muda' });
  ok(refused(mv), 'mover canal para categoria cheia é recusado', mv.error);
  ok(db.prepare('SELECT name FROM channels WHERE id=?').get(loose.id).name === 'c', 'recusado, nada muda (nem o nome)');
  ok(refused(await call(A, 'POST', `/guilds/${g1.id}/channels`, { name: 'd' })), 'passando do limite de canais, criar é recusado');
  ok(refused(await call(A, 'POST', `/channels/${loose.id}/duplicate`, {})), 'duplicar canal também respeita o limite');

  // amigos, pedidos sem resposta e bloqueados
  ok(!(await call(C, 'POST', '/relationships', { username: 'duda' })).error, 'pede amizade');
  ok(refused(await call(C, 'POST', '/relationships', { username: 'enzo' })), 'passando do limite de pedidos sem resposta, pedir é recusado');
  ok(!(await call(D, 'PUT', '/relationships/' + id('caio'), {})).error, 'aceita amizade');
  await call(E, 'POST', '/relationships', { username: 'caio' });
  ok(refused(await call(C, 'PUT', '/relationships/' + id('enzo'), {})), 'passando do limite de amigos, aceitar é recusado');
  ok(!(await call(E, 'PUT', '/relationships/' + id('caio'), { type: 2 })).error, 'bloqueia');
  ok(!(await call(E, 'PUT', '/relationships/' + id('caio'), { type: 2 })).error, 'bloquear de novo quem já está bloqueado não esbarra no limite');
  ok(refused(await call(E, 'PUT', '/relationships/' + id('ana'), { type: 2 })), 'passando do limite de bloqueados, bloquear é recusado');

  // LFG: anúncio com sala num servidor em que beto não está; ele já está no limite (b1 + um)
  const meta = await call(A, 'GET', '/lfg/meta'), game = meta.games[0];
  const vc = db.prepare('SELECT id FROM channels WHERE guild_id=? AND type=2').get(g2.id).id;
  for (const mode of ['open', 'ask']) {
    const p = await call(A, 'POST', '/lfg/posts', { game: game.id, game_name: 'x', mode: game.modes[0], slots: 2, rank_min: '', rank_max: '', channel_id: vc, join_mode: mode });
    const r = await call(B, 'POST', `/lfg/posts/${p.id}/request`, {});
    ok(refused(r), `LFG (${mode === 'open' ? 'entrada direta' : 'pedir para entrar'}): quem está no limite não entra no grupo de uma sala de outro servidor`, r.error);
    if (mode === 'ask') { // pedido feito antes de chegar no limite: o autor não consegue aceitar
      db.prepare("INSERT INTO lfg_requests(post_id,user_id,state,created_at) VALUES(?,?,'pending',?)").run(p.id, id('beto'), Date.now());
      const a = await call(A, 'POST', `/lfg/posts/${p.id}/answer`, { user_id: id('beto'), accept: true });
      ok(refused(a), 'LFG: o autor aceitar quem está no limite é recusado', a.error);
    }
    await call(A, 'POST', `/lfg/posts/${p.id}/close`);
  }
  ok(db.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(id('beto')).n === 2, 'beto continua em 2 servidores');
} finally {
  // convite para a chamada: unidade (sem precisar de gente na sala por WebSocket)
  let full = false; const joined = [];
  const get = (sql, id) => sql.includes('FROM channels') ? { id, guild_id: 'g1', type: 2, name: 'sala' } : sql.includes('FROM users') ? { id } : sql.includes('FROM guilds') ? { id: 'g1', name: 'G' } : null;
  const ci = createCallInvites({ get, voiceChannelOf: () => null, roomSize: () => 1, isFriend: () => true, isMember: () => false, isBanned: () => false, isBlocked: () => false,
    joinGuild: (g, u) => joined.push(u), userPub: (u) => ({ id: u }), dispatch() { }, postDm() { }, guildFull: (uid, other) => full ? (other ? 'outro' : 'eu') : null });
  full = true; ok(ci.create('a', 'b', { channelId: 'c1' }).status === 409, 'convite para a chamada: não convida quem está no limite de servidores');
  full = false; const r = ci.create('a', 'b', { channelId: 'c1' });
  full = true; ok(ci.respond(r.invite.id, 'b', 'accept').status === 409 && !joined.length, 'convite para a chamada: aceitar no limite é recusado e não entra no servidor');
  full = false; ok(ci.respond(r.invite.id, 'b', 'accept').channel_id === 'c1' && joined.length === 1, 'convite para a chamada: abaixo do limite entra');
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
