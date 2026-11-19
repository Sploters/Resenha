// Canais e categorias: criar, editar, excluir, duplicar e permissões por canal/categoria (com sincronia da categoria).
// forum e intents chegam por getter (d.forum, d.intents): são criados mais abaixo no index.js, então só são lidos na hora da requisição
export function mountChannels(app, d) {
  const { auth, wrap, bad, clean, db, all, get, run, newId, lim, P, chp, can, rankOf, ROLE_ABOVE, dispatch, guildMemberIds, audit, voice, leaveVoice, refreshVoicePerms } = d;
  // Channels
  // tipos: 0 texto, 2 voz, 4 categoria, 5 anúncios (só a moderação escreve, por padrão), 15 fórum, 16 galeria (cada post é
  // uma foto ou vídeo; o canal abre em grade), 17 documento (uma página em markdown: server/docchannel.js)
  const CH_TYPES = [0, 2, 4, 5, 15, 16, 17], SLUG_TYPES = [0, 5, 15, 16, 17];
  app.post('/api/guilds/:id/channels', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!can(gid, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
    const type = CH_TYPES.includes(+req.body.type) ? +req.body.type : 0;
    let name = clean(req.body.name, 100);
    if (SLUG_TYPES.includes(type)) name = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-');
    name = name || 'novo-canal';
    const id = newId(), pos = (get('SELECT MAX(position) m FROM channels WHERE guild_id=?', gid).m ?? 0) + 1;
    const parent = get('SELECT id FROM channels WHERE id=? AND guild_id=? AND type=4', String(req.body.parent_id ?? ''), gid) ? String(req.body.parent_id) : null;
    { const why = lim.channel(gid, type, type === 4 ? null : parent); if (why) return bad(res, why, 409); }
    run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)', id, gid, type, name, pos, parent, Date.now());
    if (type === 15) run('UPDATE channels SET forum=? WHERE id=?', JSON.stringify({ tags: [['Discussão', '💬'], ['Dúvida', '❓'], ['Mídia', '🎬'], ['Jogatina', '🎮']].map(([n, e], i) => ({ id: 't' + (i + 1), name: n, emoji: e, color: d.forum.TAG_COLORS[i] })), guidelines: '' }), id); // fórum novo já vem com tags
    dispatch(guildMemberIds(gid), 'CHANNEL_CREATE', get('SELECT * FROM channels WHERE id=?', id));
    audit(gid, req.uid, 'channel_create', id, name);
    res.json({ id });
  }));
  app.patch('/api/channels/:id', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
    const np = req.body.parent_id !== undefined && ch.type !== 4 && ch.type !== 11
      ? (req.body.parent_id && get('SELECT id FROM channels WHERE id=? AND guild_id=? AND type=4', String(req.body.parent_id), ch.guild_id)?.id || null) : undefined;
    if (np && np !== ch.parent_id) { const why = lim.inCategory(np); if (why) return bad(res, why, 409); }
    run('UPDATE channels SET name=?,topic=?,position=? WHERE id=?', clean(req.body.name, 100) || ch.name, req.body.topic !== undefined ? clean(req.body.topic, 1024) : ch.topic, Number.isFinite(+req.body.position) && req.body.position !== undefined ? +req.body.position : ch.position, ch.id);
    // mudar de categoria (null: sem categoria). Sincronizado continua sincronizado: passa a seguir a categoria nova
    if (np !== undefined && np !== (ch.parent_id || null)) run('UPDATE channels SET parent_id=? WHERE id=?', np, ch.id);
    dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_UPDATE', get('SELECT * FROM channels WHERE id=?', ch.id));
    if (req.body.name !== undefined || req.body.topic !== undefined) audit(ch.guild_id, req.uid, 'channel_update', ch.id, get('SELECT name FROM channels WHERE id=?', ch.id).name);
    res.json({});
  }));
  app.delete('/api/channels/:id', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !ch.guild_id || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
    if (voice.has(ch.id)) for (const u of [...voice.get(ch.id).keys()]) leaveVoice(u, ch.id);
    if (ch.type === 15) d.forum.dropForum(ch.id); // os posts vão junto
    run('UPDATE channels SET parent_id=NULL WHERE parent_id=?', ch.id);
    run('DELETE FROM channels WHERE id=?', ch.id);
    audit(ch.guild_id, req.uid, 'channel_delete', ch.id, ch.name);
    d.intents.onChannelDeleted(ch.id);
    dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_DELETE', { id: ch.id, guild_id: ch.guild_id });
    res.json({});
  }));
  // permissões do canal ou da categoria: { overwrites: [{ target: cargo|'everyone', allow, deny }] } ou { sync: true }
  // (volta a seguir a categoria). Ajustar um canal sincronizado tira a sincronia; na categoria, vale para os sincronizados.
  const chPermsEvent = (ch) => { refreshVoicePerms(ch.guild_id); dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_PERMS', { guild_id: ch.guild_id, channel_id: ch.id, overwrites: chp.overwrites(ch.id), perm_sync: ch.perm_sync ?? 1 }); };
  app.put('/api/channels/:id/perms', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !ch.guild_id || ch.type === 11 || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS) || !can(ch.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    // hierarquia: o ajuste de um cargo do seu nível para cima não muda (nem some ao sincronizar)
    const mine = rankOf(ch.guild_id, req.uid), high = new Set(all('SELECT id FROM roles WHERE guild_id=? AND position>=?', ch.guild_id, mine).map(r => r.id));
    if (high.size) {
      const key = (o) => o ? `${(+o.allow | 0) & 15}/${(+o.deny | 0) & 15 & ~((+o.allow | 0) & 15)}` : '0/0';
      const cur = new Map(chp.overwrites(ch.id).map(o => [o.target, o]));
      const next = req.body?.sync === true ? new Map() : new Map((Array.isArray(req.body?.overwrites) ? req.body.overwrites : []).map(o => [String(o?.target || ''), o]));
      if ([...high].some(t => key(cur.get(t)) !== key(next.get(t)))) return bad(res, ROLE_ABOVE, 403);
    }
    if (req.body?.sync === true) {
      if (ch.type === 4 || !ch.parent_id) return bad(res, 'O canal não está numa categoria');
      run('DELETE FROM channel_perms WHERE channel_id=?', ch.id); run('UPDATE channels SET perm_sync=1 WHERE id=?', ch.id);
      audit(ch.guild_id, req.uid, 'channel_perms', ch.id, ch.name + ' · sincronizado com a categoria');
    } else {
      chp.setOverwrites(ch, req.body?.overwrites);
      if (ch.type !== 4) run('UPDATE channels SET perm_sync=0 WHERE id=?', ch.id);
      audit(ch.guild_id, req.uid, 'channel_perms', ch.id, ch.name);
    }
    chPermsEvent(get('SELECT * FROM channels WHERE id=?', ch.id));
    res.json({});
  }));
  // categoria: todos os canais dela voltam a seguir a categoria
  app.post('/api/channels/:id/sync-children', auth, wrap((req, res) => {
    const cat = get('SELECT * FROM channels WHERE id=? AND type=4', req.params.id);
    if (!cat || !can(cat.guild_id, req.uid, P.MANAGE_CHANNELS) || !can(cat.guild_id, req.uid, P.MANAGE_ROLES)) return bad(res, 'Sem permissão', 403);
    const kids = all('SELECT * FROM channels WHERE parent_id=? AND guild_id=? AND type<>11 AND perm_sync=0', cat.id, cat.guild_id);
    for (const k of kids) { run('DELETE FROM channel_perms WHERE channel_id=?', k.id); run('UPDATE channels SET perm_sync=1 WHERE id=?', k.id); chPermsEvent({ ...k, perm_sync: 1 }); }
    if (kids.length) audit(cat.guild_id, req.uid, 'channel_perms', cat.id, `${cat.name} · ${kids.length} canais sincronizados`);
    res.json({ synced: kids.length });
  }));
  // duplicar canal (ou categoria, sem os canais): mesmo tipo, categoria, tópico, permissões e config de fórum; logo abaixo do original
  app.post('/api/channels/:id/duplicate', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !ch.guild_id || !CH_TYPES.includes(ch.type) || !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
    let name = clean(req.body?.name, 100) || ch.name;
    if (SLUG_TYPES.includes(ch.type)) name = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-') || ch.name;
    { const why = lim.channel(ch.guild_id, ch.type, ch.type === 4 ? null : ch.parent_id); if (why) return bad(res, why, 409); }
    const id = newId();
    db.exec('BEGIN');
    try {
      run('UPDATE channels SET position=position+1 WHERE guild_id=? AND position>?', ch.guild_id, ch.position ?? 0);
      run('INSERT INTO channels(id,guild_id,type,name,topic,position,parent_id,created_at,perm_sync) VALUES(?,?,?,?,?,?,?,?,?)', id, ch.guild_id, ch.type, name, ch.topic || '', (ch.position ?? 0) + 1, ch.parent_id, Date.now(), ch.perm_sync ?? 1);
      if (ch.type === 15 && ch.forum) run('UPDATE channels SET forum=? WHERE id=?', ch.forum, id);
      chp.copyOverwrites(ch.id, id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const ids = guildMemberIds(ch.guild_id);
    for (const c of all('SELECT * FROM channels WHERE guild_id=? AND position>? AND id<>? AND type<>11', ch.guild_id, ch.position ?? 0, id)) dispatch(ids, 'CHANNEL_UPDATE', c);
    dispatch(ids, 'CHANNEL_CREATE', get('SELECT * FROM channels WHERE id=?', id));
    if (chp.overwrites(id).length) chPermsEvent(get('SELECT * FROM channels WHERE id=?', id));
    audit(ch.guild_id, req.uid, 'channel_create', id, name + ' (cópia de ' + ch.name + ')');
    res.json({ id });
  }));
}
