// Servidores: criar, editar, excluir; membros (expulsar, banir, castigo, apelido, cargos), moderação de voz, registro de
// auditoria, jogos do servidor e cargos (com a hierarquia: só se mexe em quem/no que está abaixo).
// activity chega por getter (d.activity): é criado mais abaixo no index.js, então só é lido na hora da requisição
import { sfuModerate } from '../sfuapi.js';

export function mountGuilds(app, d) {
  const { auth, wrap, bad, clean, db, all, get, run, newId, tx, lim, P, CH, chp, can, memberPerms, rankOf, outranks, ABOVE, ROLE_ABOVE, renumberRoles, dispatch, send, guildMemberIds, channelAudience, guildFull, memberObj, vsObj, getUser, userPub, audit, auditSince, AUDIT_DAYS, isFileUrl, cssColor, voice, leaveVoice, currentVoice, refreshVoicePerms, dropViewers, removeMember, allowMove } = d;
  function createGuild(owner, name) {
    const gid = newId(), now = Date.now();
    run('INSERT INTO guilds(id,name,owner_id,created_at) VALUES(?,?,?,?)', gid, name, owner, now);
    run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', gid, owner, now);
    const cat1 = newId(), cat2 = newId();
    run('INSERT INTO channels(id,guild_id,type,name,position,created_at) VALUES(?,?,4,?,0,?)', cat1, gid, 'Canais de texto', now);
    run('INSERT INTO channels(id,guild_id,type,name,position,created_at) VALUES(?,?,4,?,10,?)', cat2, gid, 'Canais de voz', now);
    run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,0,?,1,?,?)', newId(), gid, 'geral', cat1, now);
    run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,2,?,11,?,?)', newId(), gid, 'Geral', cat2, now);
    return gid;
  }

  // Guilds
  app.post('/api/guilds', auth, wrap((req, res) => {
    const name = clean(req.body.name, 100); if (!name) return bad(res, 'Nome obrigatório');
    { const why = lim.guildJoin(req.uid); if (why) return bad(res, why, 409); }
    const gid = createGuild(req.uid, name);
    dispatch([req.uid], 'GUILD_CREATE', guildFull(gid));
    res.json({ id: gid });
  }));
  app.patch('/api/guilds/:id', auth, wrap((req, res) => {
    const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
    if (!g || !can(g.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    if (req.body.owner_id !== undefined) { // transferir propriedade (só o dono atual)
      if (g.owner_id !== req.uid) return bad(res, 'Apenas o dono pode transferir o servidor', 403);
      if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', g.id, String(req.body.owner_id))) return bad(res, 'Membro inválido');
      run('UPDATE guilds SET owner_id=? WHERE id=?', String(req.body.owner_id), g.id);
    }
    const b = req.body, file = (v, old) => v === undefined ? old : (isFileUrl(v) ? v : null);
    run('UPDATE guilds SET name=?,icon=?,banner=?,description=?,accent=? WHERE id=?', clean(b.name, 100) || g.name, file(b.icon, g.icon), file(b.banner, g.banner),
      b.description !== undefined ? clean(b.description, 300) : g.description, b.accent !== undefined ? cssColor(b.accent) ?? g.accent : g.accent, g.id);
    if (b.invite_all !== undefined) run('UPDATE guilds SET invite_all=? WHERE id=?', b.invite_all ? 1 : 0, g.id); // membros sem cargo podem convidar
    const n = get('SELECT * FROM guilds WHERE id=?', g.id);
    audit(g.id, req.uid, req.body.owner_id !== undefined ? 'guild_transfer' : 'guild_update', req.body.owner_id !== undefined ? String(req.body.owner_id) : null, n.name);
    dispatch(guildMemberIds(g.id), 'GUILD_UPDATE', { id: n.id, name: n.name, icon: n.icon, banner: n.banner, description: n.description, accent: n.accent, owner_id: n.owner_id, invite_all: n.invite_all });
    res.json({});
  }));
  app.delete('/api/guilds/:id', auth, wrap((req, res) => {
    const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
    if (!g || g.owner_id !== req.uid) return bad(res, 'Apenas o dono pode excluir', 403);
    const ids = guildMemberIds(g.id);
    for (const [cid, m] of voice) for (const u of [...m.keys()]) if (get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', cid, g.id)) leaveVoice(u, cid);
    run('DELETE FROM guilds WHERE id=?', g.id);
    dispatch(ids, 'GUILD_DELETE', { id: g.id }); dropViewers(g.id);
    res.json({});
  }));
  app.delete('/api/guilds/:id/members/:uid', auth, wrap((req, res) => {
    const gid = req.params.id, target = req.params.uid === 'me' ? req.uid : req.params.uid;
    const g = get('SELECT * FROM guilds WHERE id=?', gid);
    if (!g) return bad(res, 'Servidor não encontrado', 404);
    if (target === g.owner_id) return bad(res, 'O dono não pode sair/ser expulso; exclua o servidor', 400);
    if (target !== req.uid && !can(gid, req.uid, P.KICK)) return bad(res, 'Sem permissão', 403);
    if (target !== req.uid && !outranks(gid, req.uid, target)) return bad(res, ABOVE, 403);
    removeMember(gid, target, target !== req.uid);
    if (target !== req.uid) audit(gid, req.uid, 'member_kick', target, clean(req.query.reason, 300));
    res.json({});
  }));
  // Banimentos
  app.get('/api/guilds/:id/bans', auth, wrap((req, res) => {
    if (!can(req.params.id, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
    res.json(all('SELECT user_id,reason,by_id,created_at FROM bans WHERE guild_id=? ORDER BY created_at DESC', req.params.id).map(b => ({ ...b, user: userPub(b.user_id) })));
  }));
  app.put('/api/guilds/:id/bans/:uid', auth, wrap((req, res) => {
    const gid = req.params.id, target = req.params.uid, g = get('SELECT * FROM guilds WHERE id=?', gid);
    if (!g || !can(gid, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
    if (target === g.owner_id || target === req.uid || !getUser(target)) return bad(res, 'Não é possível banir este usuário');
    if (!outranks(gid, req.uid, target)) return bad(res, ABOVE, 403);
    const reason = clean(req.body.reason, 300);
    run('INSERT INTO bans(guild_id,user_id,reason,by_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason', gid, target, reason, req.uid, Date.now());
    if (get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, target)) removeMember(gid, target, true);
    if (req.body.delete_messages) { // apaga as mensagens das últimas 24 h
      for (const m of all('SELECT m.*, c.name ch_name FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.guild_id=? AND m.author_id=? AND m.created_at>?', gid, target, Date.now() - 86400000)) {
        run('DELETE FROM messages WHERE id=?', m.id);
        d.msglog.record('delete', { id: m.channel_id, guild_id: gid, name: m.ch_name }, m, req.uid);
        dispatch(guildMemberIds(gid), 'MESSAGE_DELETE', { id: m.id, channel_id: m.channel_id, guild_id: gid });
      }
    }
    audit(gid, req.uid, 'member_ban', target, reason);
    res.json({});
  }));
  app.delete('/api/guilds/:id/bans/:uid', auth, wrap((req, res) => {
    if (!can(req.params.id, req.uid, P.BAN)) return bad(res, 'Sem permissão', 403);
    run('DELETE FROM bans WHERE guild_id=? AND user_id=?', req.params.id, req.params.uid);
    audit(req.params.id, req.uid, 'member_unban', req.params.uid);
    res.json({});
  }));
  // jogos que a galera do servidor mais joga (cabeçalho do servidor e cartão de convite; server/activity.js → guildGames)
  app.get('/api/guilds/:id/games', auth, wrap((req, res) => {
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', req.params.id, req.uid)) return bad(res, 'Sem permissão', 403);
    res.json({ games: d.activity.guildGames(req.params.id) });
  }));
  app.get('/api/guilds/:id/audit', auth, wrap((req, res) => {
    if (!can(req.params.id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    const rows = req.query.before ? all('SELECT * FROM audit_log WHERE guild_id=? AND id<? AND created_at>=? ORDER BY id DESC LIMIT 100', req.params.id, String(req.query.before), auditSince())
      : all('SELECT * FROM audit_log WHERE guild_id=? AND created_at>=? ORDER BY id DESC LIMIT 100', req.params.id, auditSince());
    const ids = new Set(rows.flatMap(r => [r.actor_id, r.target_id]).filter(Boolean));
    res.json({ entries: rows, users: [...ids].map(userPub).filter(Boolean), keep_days: AUDIT_DAYS });
  }));
  app.patch('/api/guilds/:id/members/:uid', auth, wrap((req, res) => {
    const gid = req.params.id, target = req.params.uid === 'me' ? req.uid : req.params.uid;
    const own = target === req.uid;
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem permissão', 403);
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, target)) return bad(res, 'Membro não encontrado', 404);
    if (req.body.nickname !== undefined) {
      if (!own && !can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
      if (!own && !outranks(gid, req.uid, target)) return bad(res, ABOVE, 403);
      run('UPDATE members SET nickname=? WHERE guild_id=? AND user_id=?', clean(req.body.nickname, 32) || null, gid, target);
    }
    if (req.body.timeout_until !== undefined) { // castigo (null = remover)
      const g = get('SELECT owner_id FROM guilds WHERE id=?', gid);
      if (!can(gid, req.uid, P.MODERATE) || own || target === g.owner_id) return bad(res, 'Sem permissão', 403);
      if (!outranks(gid, req.uid, target)) return bad(res, ABOVE, 403);
      const until = req.body.timeout_until ? Math.min(+req.body.timeout_until, Date.now() + 28 * 86400000) : null;
      if (until !== null && !(until > Date.now())) return bad(res, 'Duração inválida');
      run('UPDATE members SET timeout_until=? WHERE guild_id=? AND user_id=?', until, gid, target);
      if (until) { const c = currentVoice(target); if (c && get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', c, gid)) leaveVoice(target, c); }
      audit(gid, req.uid, until ? 'member_timeout' : 'member_timeout_remove', target, until ? new Date(until).toISOString() + (req.body.reason ? ' — ' + clean(req.body.reason, 300) : '') : '');
    }
    if (Array.isArray(req.body.roles)) {
      if (!can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
      if (!own && !outranks(gid, req.uid, target)) return bad(res, ABOVE, 403);
      // só entram e saem cargos abaixo do seu; os que estão acima ficam como estavam
      const mine = rankOf(gid, req.uid), want = new Set(req.body.roles.map(String));
      const cur = new Set(all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', gid, target).map(r => r.role_id));
      const roles = all('SELECT id,name,position FROM roles WHERE guild_id=?', gid);
      if (roles.some(r => want.has(r.id) !== cur.has(r.id) && r.position >= mine)) return bad(res, ROLE_ABOVE, 403);
      audit(gid, req.uid, 'member_roles', target, roles.filter(r => want.has(r.id)).sort((a, b) => b.position - a.position).map(r => r.name).join(', ') || '(nenhum)');
      run('DELETE FROM member_roles WHERE guild_id=? AND user_id=?', gid, target);
      for (const r of roles) if (want.has(r.id)) run('INSERT OR IGNORE INTO member_roles VALUES(?,?,?)', gid, target, r.id);
    }
    dispatch(guildMemberIds(gid), 'MEMBER_UPDATE', { guild_id: gid, ...memberObj(gid, target) });
    if (Array.isArray(req.body.roles)) refreshVoicePerms(gid);
    res.json({});
  }));
  // Moderação de voz (Moderar voz + hierarquia): mutar/ensurdecer para o servidor (vale em todas as salas e continua ao
  // sair e voltar, até alguém tirar), mover para outra sala e desconectar da chamada
  try { db.exec('ALTER TABLE members ADD COLUMN voice_mute INTEGER DEFAULT 0'); } catch { }
  try { db.exec('ALTER TABLE members ADD COLUMN voice_deaf INTEGER DEFAULT 0'); } catch { }
  app.patch('/api/guilds/:id/voice/:uid', auth, wrap((req, res) => {
    const gid = req.params.id, target = req.params.uid, b = req.body || {};
    if (!can(gid, req.uid, P.VOICE_MOD)) return bad(res, 'Sem permissão', 403);
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, target)) return bad(res, 'Membro não encontrado', 404);
    if (!outranks(gid, req.uid, target)) return bad(res, target === req.uid ? 'Use os seus próprios botões de microfone e fone' : ABOVE, 403);
    const c = currentVoice(target), ch = c && get('SELECT * FROM channels WHERE id=?', c), here = ch?.guild_id === gid ? ch : null;
    const st = here && voice.get(c).get(target);
    if (typeof b.mute === 'boolean' || typeof b.deaf === 'boolean') {
      const cur = get('SELECT voice_mute m, voice_deaf d FROM members WHERE guild_id=? AND user_id=?', gid, target);
      const mute = typeof b.mute === 'boolean' ? b.mute : !!cur.m, deaf = typeof b.deaf === 'boolean' ? b.deaf : !!cur.d;
      run('UPDATE members SET voice_mute=?, voice_deaf=? WHERE guild_id=? AND user_id=?', mute ? 1 : 0, deaf ? 1 : 0, gid, target);
      if (mute !== !!cur.m) audit(gid, req.uid, mute ? 'voice_mute' : 'voice_unmute', target);
      if (deaf !== !!cur.d) audit(gid, req.uid, deaf ? 'voice_deaf' : 'voice_undeaf', target);
      if (st) {
        st.modMute = mute; st.modDeaf = deaf; sfuModerate(c, target, { mute: mute || !!st.noSpeak, deaf });
        dispatch(channelAudience(here), 'VOICE_STATE', { ...vsObj(c, target, st), guild_id: gid });
      }
    }
    if (b.channel_id !== undefined || b.disconnect === true) {
      if (!st) return bad(res, 'A pessoa não está numa sala de voz deste servidor', 409);
      if (b.disconnect === true) {
        send(st.ws, 'VOICE_MODERATED', { action: 'disconnect', channel_id: c, by: req.uid });
        leaveVoice(target, c, 'kicked');
        audit(gid, req.uid, 'voice_disconnect', target, here.name);
      } else {
        const to = get('SELECT * FROM channels WHERE id=? AND guild_id=? AND type=2', String(b.channel_id), gid);
        if (!to) return bad(res, 'Sala de voz não encontrada');
        if (to.id !== c) {
          // o app da pessoa entra na sala nova sozinho (a mídia é refeita lá); sala trancada para ela também vale para quem move
          if (!chp.chCan(to, req.uid, CH.CONNECT)) return bad(res, 'Você não pode entrar nessa sala, então não pode mover ninguém para ela', 403);
          allowMove(target, to.id); // pode ser uma sala trancada para a pessoa: entra mesmo assim, só desta vez
          send(st.ws, 'VOICE_MODERATED', { action: 'move', channel_id: to.id, from: c, by: req.uid });
          audit(gid, req.uid, 'voice_move', target, `${here.name} → ${to.name}`);
        }
      }
    }
    res.json({});
  }));
  // Roles
  app.post('/api/guilds/:id/roles', auth, wrap((req, res) => {
    if (!can(req.params.id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    const gid = req.params.id, id = newId(), perms = Number(req.body.perms) | 0;
    if (perms & ~memberPerms(gid, req.uid)) return bad(res, 'Você não pode dar uma permissão que não tem', 403);
    { const why = lim.role(gid); if (why) return bad(res, why, 409); }
    // cargo novo entra no fim da lista (posição 1), abaixo de quem criou; os outros sobem uma posição
    const ids = guildMemberIds(gid);
    tx(() => {
      run('UPDATE roles SET position=position+1 WHERE guild_id=?', gid);
      run('INSERT INTO roles(id,guild_id,name,color,perms,position) VALUES(?,?,?,?,?,?)', id, gid, clean(req.body.name, 50) || 'novo cargo', clean(req.body.color, 9) || '#99aab5', perms, 1);
    });
    for (const r of all('SELECT * FROM roles WHERE guild_id=?', gid)) dispatch(ids, 'ROLE_UPDATE', { guild_id: gid, role: r });
    audit(req.params.id, req.uid, 'role_create', id, clean(req.body.name, 50) || 'novo cargo');
    res.json({ id });
  }));
  app.patch('/api/roles/:id', auth, wrap((req, res) => {
    const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
    if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    if (r.position >= rankOf(r.guild_id, req.uid)) return bad(res, ROLE_ABOVE, 403);
    if (req.body.perms !== undefined && ((Number(req.body.perms) | 0) ^ r.perms) & ~memberPerms(r.guild_id, req.uid)) return bad(res, 'Você não pode dar ou tirar uma permissão que não tem', 403);
    run('UPDATE roles SET name=?,color=?,perms=? WHERE id=?', clean(req.body.name, 50) || r.name, clean(req.body.color, 9) || r.color, req.body.perms !== undefined ? Number(req.body.perms) | 0 : r.perms, r.id);
    dispatch(guildMemberIds(r.guild_id), 'ROLE_UPDATE', { guild_id: r.guild_id, role: get('SELECT * FROM roles WHERE id=?', r.id) });
    audit(r.guild_id, req.uid, 'role_update', r.id, get('SELECT name FROM roles WHERE id=?', r.id).name);
    refreshVoicePerms(r.guild_id); // virar administrador / gerenciar canais libera Falar e Vídeo
    res.json({});
  }));
  // reordenar: ids do mais alto para o mais baixo (todos os cargos do servidor). Os cargos do seu nível para cima não mudam de lugar.
  app.put('/api/guilds/:id/roles/order', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!can(gid, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    const roles = all('SELECT id,position FROM roles WHERE guild_id=?', gid), ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    if (ids.length !== roles.length || new Set(ids).size !== ids.length || !roles.every(r => ids.includes(r.id))) return bad(res, 'Lista de cargos inválida');
    const mine = rankOf(gid, req.uid), next = new Map(ids.map((id, i) => [id, ids.length - i]));
    if (roles.some(r => (r.position >= mine || next.get(r.id) >= mine) && r.position !== next.get(r.id))) return bad(res, ROLE_ABOVE, 403);
    const changed = roles.filter(r => r.position !== next.get(r.id));
    if (changed.length) {
      tx(() => { for (const r of changed) run('UPDATE roles SET position=? WHERE id=?', next.get(r.id), r.id); });
      const mids = guildMemberIds(gid);
      for (const r of changed) dispatch(mids, 'ROLE_UPDATE', { guild_id: gid, role: get('SELECT * FROM roles WHERE id=?', r.id) });
      audit(gid, req.uid, 'role_update', null, 'ordem dos cargos');
    }
    res.json({});
  }));
  app.delete('/api/roles/:id', auth, wrap((req, res) => {
    const r = get('SELECT * FROM roles WHERE id=?', req.params.id);
    if (!r || !can(r.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    if (r.position >= rankOf(r.guild_id, req.uid)) return bad(res, ROLE_ABOVE, 403);
    run('DELETE FROM roles WHERE id=?', r.id);
    run('DELETE FROM channel_perms WHERE target=?', r.id); // ajustes de canal do cargo apagado
    audit(r.guild_id, req.uid, 'role_delete', r.id, r.name);
    const mids = guildMemberIds(r.guild_id);
    dispatch(mids, 'ROLE_DELETE', { guild_id: r.guild_id, id: r.id });
    renumberRoles(r.guild_id); // fecha o buraco na ordem
    for (const x of all('SELECT * FROM roles WHERE guild_id=? AND position>=?', r.guild_id, r.position)) dispatch(mids, 'ROLE_UPDATE', { guild_id: r.guild_id, role: x });
    refreshVoicePerms(r.guild_id);
    res.json({});
  }));
}
