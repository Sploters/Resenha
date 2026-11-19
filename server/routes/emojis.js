// Emojis personalizados e soundboard do servidor.
export function mountEmojis(app, d) {
  const { auth, wrap, bad, clean, all, get, run, newId, P, can, isFileUrl, dispatch, guildMemberIds } = d;
  // Emojis personalizados
  app.post('/api/guilds/:id/emojis', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    const name = clean(req.body.name, 32).replace(/[^\w]/g, '_'), url = String(req.body.url || '');
    if (name.length < 2 || !isFileUrl(url)) return bad(res, 'Nome (mín. 2 letras) e imagem obrigatórios');
    if (get('SELECT COUNT(*) n FROM emojis WHERE guild_id=?', gid).n >= 100) return bad(res, 'Limite de 100 emojis');
    const id = newId();
    run('INSERT INTO emojis VALUES(?,?,?,?,?,?)', id, gid, name, url, req.uid, Date.now());
    dispatch(guildMemberIds(gid), 'EMOJIS_UPDATE', { guild_id: gid, emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', gid) });
    res.json({ id });
  }));
  app.delete('/api/emojis/:id', auth, wrap((req, res) => {
    const e = get('SELECT * FROM emojis WHERE id=?', req.params.id);
    if (!e || !can(e.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    run('DELETE FROM emojis WHERE id=?', e.id);
    dispatch(guildMemberIds(e.guild_id), 'EMOJIS_UPDATE', { guild_id: e.guild_id, emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', e.guild_id) });
    res.json({});
  }));

  // Soundboard do servidor
  const soundsOf = (gid) => all('SELECT id,name,emoji,url,volume FROM sounds WHERE guild_id=? ORDER BY created_at', gid);
  app.post('/api/guilds/:id/sounds', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    const name = clean(req.body.name, 32), url = String(req.body.url || ''), vol = Math.max(1, Math.min(200, +req.body.volume || 100));
    if (!name || !isFileUrl(url)) return bad(res, 'Nome e arquivo de áudio obrigatórios');
    if (get('SELECT COUNT(*) n FROM sounds WHERE guild_id=?', gid).n >= 48) return bad(res, 'Limite de 48 sons por servidor');
    const id = newId();
    run('INSERT INTO sounds VALUES(?,?,?,?,?,?,?,?)', id, gid, name, clean(req.body.emoji, 16), url, vol, req.uid, Date.now());
    dispatch(guildMemberIds(gid), 'SOUNDS_UPDATE', { guild_id: gid, sounds: soundsOf(gid) });
    res.json({ id });
  }));
  app.patch('/api/sounds/:id', auth, wrap((req, res) => {
    const o = get('SELECT * FROM sounds WHERE id=?', req.params.id);
    if (!o || !can(o.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    run('UPDATE sounds SET name=?,emoji=?,volume=? WHERE id=?', clean(req.body.name, 32) || o.name, req.body.emoji !== undefined ? clean(req.body.emoji, 16) : o.emoji, req.body.volume !== undefined ? Math.max(1, Math.min(200, +req.body.volume || 100)) : o.volume, o.id);
    dispatch(guildMemberIds(o.guild_id), 'SOUNDS_UPDATE', { guild_id: o.guild_id, sounds: soundsOf(o.guild_id) });
    res.json({});
  }));
  app.delete('/api/sounds/:id', auth, wrap((req, res) => {
    const o = get('SELECT * FROM sounds WHERE id=?', req.params.id);
    if (!o || !can(o.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    run('DELETE FROM sounds WHERE id=?', o.id);
    dispatch(guildMemberIds(o.guild_id), 'SOUNDS_UPDATE', { guild_id: o.guild_id, sounds: soundsOf(o.guild_id) });
    res.json({});
  }));
}
