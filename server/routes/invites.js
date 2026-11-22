// Convites para o servidor (criar, ver o cartão, entrar, listar, apagar) e convites para a chamada (server/callinvites.js).
// Devolve o callInv, usado também por Procurar jogadores e A fim de jogar.
// activity chega por getter (d.activity): é criado mais abaixo no index.js, então só é lido na hora da requisição
import crypto from 'node:crypto';
import { createCallInvites } from '../callinvites.js';
import { pruneHits } from '../limits.js';

export function mountInvites(app, d) {
  const { auth, wrap, bad, all, get, run, lim, P, can, audit, dispatch, userPub, pubUser, statusFor, platformsFor, conns, voice, sessions, privacy, social, joinGuild, postDm } = d;
  // Quem convida: o cargo com "Criar convite" (dono e administradores sempre) ou, com a opção do servidor "membros sem cargo
  // podem convidar" ligada (o padrão, guilds.invite_all), qualquer membro. Vale para o link e para chamar um não membro
  // para uma sala de voz do servidor (o convite para a chamada também o põe no servidor).
  const canInvite = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid)
    && (can(gid, uid, P.CREATE_INVITE) || get('SELECT invite_all FROM guilds WHERE id=?', gid)?.invite_all !== 0);
  // Invites
  app.post('/api/guilds/:id/invites', auth, wrap((req, res) => {
    if (!canInvite(req.params.id, req.uid)) return bad(res, 'Sem permissão para criar convites neste servidor', 403);
    // "Convidar pessoas" reaproveita o último convite que a pessoa criou neste servidor (como no Discord): abrir o
    // convite várias vezes não enche o servidor de códigos. Código novo só pedindo ({ new: true }, em Configurações › Convites)
    if (req.body?.new !== true) { const old = get('SELECT code FROM invites WHERE guild_id=? AND creator_id=? ORDER BY created_at DESC LIMIT 1', req.params.id, req.uid); if (old) return res.json({ code: old.code }); }
    { const why = lim.invite(req.params.id); if (why) return bad(res, why, 409); }
    const code = crypto.randomBytes(5).toString('base64url');
    run('INSERT INTO invites(code,guild_id,creator_id,created_at) VALUES(?,?,?,?)', code, req.params.id, req.uid, Date.now());
    res.json({ code });
  }));
  app.get('/api/invites/:code', wrap((req, res) => {
    const i = get('SELECT i.*,g.name,g.icon,g.banner,g.accent FROM invites i JOIN guilds g ON g.id=i.guild_id WHERE code=?', req.params.code);
    if (!i) return req.query.peek ? res.json({ gone: true }) : bad(res, 'Convite inválido ou expirado', 404); // peek: cartão no chat (sem 404 no console)
    // online: conectados que não estão invisíveis (o cartão de convite mostra os dois números)
    const ms = all('SELECT u.id,u.status FROM members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=?', i.guild_id);
    const online = ms.filter(u => conns.has(u.id) && u.status !== 'invisible').length;
    // com login: quais amigos seus já estão lá (antes de entrar). Só amigos aceitos dos dois lados; quem esconde a presença de
    // você continua aparecendo como membro (amizade não é presença), mas offline
    const me = sessions.lookup((req.headers.authorization || '').replace(/^Bearer /, ''))?.user_id;
    const friends = me ? all(`SELECT u.* FROM members m JOIN users u ON u.id=m.user_id JOIN relationships r1 ON r1.user_id=? AND r1.other_id=m.user_id AND r1.type=1
    JOIN relationships r2 ON r2.user_id=m.user_id AND r2.other_id=? AND r2.type=1 WHERE m.guild_id=? LIMIT 50`, me, me, i.guild_id).map(u => ({ ...pubUser(u), status: statusFor(me, u), platforms: platformsFor(me, u) })) : [];
    res.json({ code: i.code, guild: { id: i.guild_id, name: i.name, icon: i.icon, banner: i.banner, accent: i.accent }, members: ms.length, online, friends, games: d.activity.guildGames(i.guild_id) });
  }));
  app.post('/api/invites/:code', auth, wrap((req, res) => {
    const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
    if (!i) return bad(res, 'Convite inválido ou expirado', 404);
    if (get('SELECT 1 x FROM bans WHERE guild_id=? AND user_id=?', i.guild_id, req.uid)) return bad(res, 'Você foi banido deste servidor', 403);
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', i.guild_id, req.uid)) {
      { const why = lim.guildJoin(req.uid); if (why) return bad(res, why, 409); }
      joinGuild(i.guild_id, req.uid);
      run('UPDATE invites SET uses=uses+1 WHERE code=?', i.code);
    }
    res.json({ id: i.guild_id });
  }));

  app.get('/api/guilds/:id/invites', auth, wrap((req, res) => {
    if (!can(req.params.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    res.json(all('SELECT code,creator_id,uses,created_at FROM invites WHERE guild_id=? ORDER BY created_at DESC', req.params.id));
  }));
  app.delete('/api/invites/:code', auth, wrap((req, res) => {
    const i = get('SELECT * FROM invites WHERE code=?', req.params.code);
    if (!i || !(i.creator_id === req.uid || can(i.guild_id, req.uid, P.MANAGE_GUILD))) return bad(res, 'Sem permissão', 403);
    run('DELETE FROM invites WHERE code=?', i.code);
    audit(i.guild_id, req.uid, 'invite_delete', null, i.code);
    res.json({});
  }));
  // Convites para a chamada (server/callinvites.js)
  const callInv = createCallInvites({
    get,
    voiceChannelOf: (uid) => { for (const [cid, m] of voice) if (m.has(uid)) return cid; return null; },
    roomSize: (cid) => voice.get(cid)?.size || 0,
    isFriend: (a, b) => !!get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=1', a, b),
    isMember: (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid),
    canInvite,
    isBanned: (gid, uid) => !!get('SELECT 1 x FROM bans WHERE guild_id=? AND user_id=?', gid, uid),
    isBlocked: (a, b) => !!get('SELECT 1 x FROM relationships WHERE ((user_id=? AND other_id=?) OR (user_id=? AND other_id=?)) AND type=2', a, b, b, a),
    joinGuild: (gid, uid) => joinGuild(gid, uid), userPub, dispatch, postDm: (a, b, c) => postDm(a, b, c),
    guildFull: (uid, other) => other ? lim.guildJoinOther(uid) : lim.guildJoin(uid), // limite de servidores por conta (server/limits.js)
    canCall: (a, b) => privacy.canCall(a, b),
    onState: (i, st) => social.count('callinv', `${i.source || 'manual'}:${st}`, 1, i.to), // métricas: aceito, recusado, expirado, cancelado
  });
  const callInvRate = new Map(); pruneHits(callInvRate, 60e3); // uid -> instantes dos últimos convites (no máx. 10 por minuto)
  const callOut = (res, r) => (r.error ? bad(res, r.error, r.status) : res.json(r));
  app.post('/api/call-invites', auth, wrap((req, res) => {
    const t = Date.now(), recent = (callInvRate.get(req.uid) || []).filter(x => t - x < 60e3);
    if (recent.length >= 10) return bad(res, 'Muitos convites em pouco tempo; espere um pouco', 429);
    const r = callInv.create(req.uid, String(req.body.user_id || ''), req.body.activity === 'watch' ? { activity: 'watch', source: 'watch' } : {});
    if (r.invite && !r.repeated && !conns.has(r.invite.to)) social.pull(r.invite.to, 'call_invite');
    if (!r.error && !r.repeated) callInvRate.set(req.uid, [...recent, t]);
    callOut(res, r);
  }));
  app.get('/api/call-invites', auth, wrap((req, res) => res.json(callInv.pendingFor(req.uid))));
  app.get('/api/call-invites/:id', auth, wrap((req, res) => { const r = callInv.read(req.params.id, req.uid); if (r.error && req.query.peek) return res.json({ gone: true }); callOut(res, r); })); // peek: cartão na DM (convites ficam na memória e somem ao reiniciar)
  app.post('/api/call-invites/:id/:action(accept|decline|cancel)', auth, wrap((req, res) => { const r = callInv.respond(req.params.id, req.uid, req.params.action); if (!r.error && req.params.action === 'accept') social.acted(req.uid); callOut(res, r); }));
  return { callInv };
}
