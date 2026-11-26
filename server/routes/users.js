// Pessoas: amizades e bloqueios (com o aviso de amizade desfeita), perfil de alguém e a lista inteira de membros de um
// servidor grande. Devolve o friendLossesFor, que vai no READY do gateway.
// activity chega por getter (d.activity): é criado mais abaixo no index.js, então só é lido na hora da requisição
import zlib from 'node:zlib';
import { uxFirst } from '../ux.js';

export function mountUsers(app, d) {
  const { auth, wrap, bad, clean, all, get, run, lim, dispatch, getUser, userPub, pubUser, statusFor, platformsFor, privacy, reputation, guildCached, userJson, PUB_COLS } = d;
  // `by` desfez a amizade com `lost` (remover ou bloquear): `lost` recebe o aviso na hora e fica na caixa de entrada
  const FRIEND_LOSS_DAYS = 30;
  function friendLost(lost, by) {
    if (get('SELECT type FROM relationships WHERE user_id=? AND other_id=?', lost, by)?.type !== 1) return;
    const at = Date.now();
    run('INSERT INTO friend_losses(user_id,other_id,at) VALUES(?,?,?) ON CONFLICT(user_id,other_id) DO UPDATE SET at=excluded.at', lost, by, at);
    dispatch([lost], 'FRIEND_LOST', { user: userPub(by), at });
  }
  const friendLossesFor = (uid) => all('SELECT other_id, at FROM friend_losses WHERE user_id=? AND at>? ORDER BY at DESC LIMIT 50', uid, Date.now() - FRIEND_LOSS_DAYS * 864e5)
    .map(r => ({ user: userPub(r.other_id), at: r.at })).filter(r => r.user);
  function setRel(a, b, type) {
    if (type === 1) run('DELETE FROM friend_losses WHERE (user_id=? AND other_id=?) OR (user_id=? AND other_id=?)', a, b, b, a); // voltaram a ser amigos
    if (type == null) run('DELETE FROM relationships WHERE user_id=? AND other_id=?', a, b);
    else run('INSERT INTO relationships(user_id,other_id,type,since) VALUES(?,?,?,?) ON CONFLICT(user_id,other_id) DO UPDATE SET type=excluded.type, since=CASE WHEN relationships.type=excluded.type THEN relationships.since ELSE excluded.since END', a, b, type, Date.now());
    dispatch([a], 'RELATIONSHIP', { user: userPub(b), type: type ?? 0, since: get('SELECT since FROM relationships WHERE user_id=? AND other_id=?', a, b)?.since || null });
    d.activity.onFriendsChanged(a, b);
    // presença só para amigos/escolhidos: virou (ou deixou de ser) amigo, o status visível para o outro muda na hora
    for (const [x, y] of [[a, b], [b, a]]) if (privacy.restricted(x)) { const u = getUser(x); if (u) dispatch([y], 'USER_UPDATE', { ...pubUser(u), status: statusFor(y, u), platforms: platformsFor(y, u) }); }
  }
  app.post('/api/relationships', auth, wrap((req, res) => {
    // aceita "@nome" e qualquer caixa (Sploters = sploters); se a caixa diferente achar mais de uma conta, só a exata vale
    const want = clean(req.body.username, 33).replace(/^@/, '').trim();
    let t = get('SELECT * FROM users WHERE username=?', want);
    if (!t && want) { const ci = all('SELECT * FROM users WHERE lower(username)=lower(?) LIMIT 2', want); if (ci.length === 1) t = ci[0]; }
    if (!t || t.username.startsWith('bot_music_')) return bad(res, 'Usuário não encontrado. Confira o nome de usuário (o @ do perfil, não o nome de exibição).', 404);
    if (t.id === req.uid) return bad(res, 'Você não pode adicionar a si mesmo');
    if (t.friend_policy === 'none' && !get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=4', t.id, req.uid)) return bad(res, 'Este usuário não está aceitando pedidos de amizade', 403);
    const ex = get('SELECT type FROM relationships WHERE user_id=? AND other_id=?', req.uid, t.id);
    if (ex && ex.type === 1) return bad(res, 'Vocês já são amigos');
    if (get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', t.id, req.uid)) return bad(res, 'Não foi possível enviar o pedido', 403);
    const incoming = ex && ex.type === 3;
    { const why = incoming ? lim.friendAdd(req.uid, t.id) : lim.friendRequest(req.uid); if (why) return bad(res, why, 409); }
    setRel(req.uid, t.id, incoming ? 1 : 4); setRel(t.id, req.uid, incoming ? 1 : 3);
    res.json({});
  }));
  app.put('/api/relationships/:id', auth, wrap((req, res) => { // aceitar / bloquear
    const o = req.params.id;
    if (!getUser(o) || o === req.uid) return bad(res, 'Usuário não encontrado. Confira o nome de usuário (o @ do perfil, não o nome de exibição).', 404);
    if (req.body.type === 2 && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', req.uid, o)) return res.json({}); // já bloqueado
    if (req.body.type === 2) { const why = lim.block(req.uid); if (why) return bad(res, why, 409); }
    if (req.body.type === 2) { friendLost(o, req.uid); setRel(req.uid, o, 2); setRel(o, req.uid, null); reputation.onBlock(req.uid, o); } // bloquear logo depois de a pessoa falar conta como sinal (reputação)
    else if (get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=3', req.uid, o)) {
      { const why = lim.friendAdd(req.uid, o); if (why) return bad(res, why, 409); }
      setRel(req.uid, o, 1); setRel(o, req.uid, 1); uxFirst(req.uid, 'friend'); uxFirst(o, 'friend'); }
    else return bad(res, 'Sem pedido pendente');
    res.json({});
  }));
  app.delete('/api/relationships/:id', auth, wrap((req, res) => {
    const o = req.params.id, mine = get('SELECT type FROM relationships WHERE user_id=? AND other_id=?', req.uid, o);
    if (mine?.type === 1) friendLost(o, req.uid);
    setRel(req.uid, o, null);
    if (!mine || mine.type !== 2) setRel(o, req.uid, null);
    res.json({});
  }));
  app.delete('/api/friend-losses/:id', auth, wrap((req, res) => { run('DELETE FROM friend_losses WHERE user_id=? AND other_id=?', req.uid, req.params.id); dispatch([req.uid], 'FRIEND_LOSSES', { list: friendLossesFor(req.uid) }); res.json({}); }));
  app.delete('/api/friend-losses', auth, wrap((req, res) => { run('DELETE FROM friend_losses WHERE user_id=?', req.uid); dispatch([req.uid], 'FRIEND_LOSSES', { list: [] }); res.json({}); }));
  // lista inteira de um servidor grande (o READY só levou quem estava online): membros e perfis, comprimida
  app.get('/api/guilds/:id/members', auth, wrap((req, res) => {
    const gid = String(req.params.id);
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem permissão', 403);
    const c = guildCached(gid); if (!c) return bad(res, 'Não encontrado', 404);
    const users = all(`SELECT ${PUB_COLS} FROM users WHERE id IN (SELECT user_id FROM members WHERE guild_id=?)`, gid);
    const body = '{"members":' + JSON.stringify(c.obj.members) + ',"users":[' + users.map(u => userJson(u, req.uid)).join(',') + ']}';
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' });
    if (body.length > 4096 && /\bgzip\b/.test(req.get('accept-encoding') || '')) { res.set('Content-Encoding', 'gzip'); return res.end(zlib.gzipSync(body, { level: 4 })); }
    res.end(body);
  }));
  // só confere se a sessão ainda vale (o gateway pergunta quando a conexão cai): 204 = sim, 401 = sessão encerrada
  app.get('/api/auth/check', auth, (req, res) => res.sendStatus(204));
  app.get('/api/users/:id', auth, wrap((req, res) => {
    const u = getUser(req.params.id); if (!u) return bad(res, 'Não encontrado', 404);
    const mutual = all('SELECT g.id,g.name,g.icon FROM members a JOIN members b ON a.guild_id=b.guild_id JOIN guilds g ON g.id=a.guild_id WHERE a.user_id=? AND b.user_id=?', req.uid, u.id);
    const friends = u.id === req.uid ? [] : all('SELECT a.other_id id FROM relationships a JOIN relationships b ON b.other_id=a.other_id WHERE a.user_id=? AND b.user_id=? AND a.type=1 AND b.type=1', req.uid, u.id).map(r => getUser(r.id)).filter(Boolean).map(pubUser);
    res.json({ ...pubUser(u), mutual_guilds: mutual, mutual_friends: friends });
  }));
  return { friendLossesFor };
}
