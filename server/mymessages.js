// Apagar as próprias mensagens em massa (pedido recorrente de quem usa Vencord/BetterDiscord: lá só dá com scripts
// que apagam uma por uma e arriscam a conta). Aqui o servidor é nosso, então é uma ferramenta oficial:
// - só mensagens de quem pede (author_id), em qualquer lugar onde ela já escreveu — inclusive servidores de que saiu
//   e conversas que não aparecem mais na lista
// - filtros: onde (tudo / só DMs / só servidores / um servidor / conversas escolhidas), período, texto contido,
//   tipo (só texto, com arquivos, com links) e manter as fixadas
// - POST /api/me/messages/scan: conta e mostra por conversa, sem apagar (com "corte": o que for enviado depois da
//   prévia nunca entra); POST /api/me/messages/export: baixa uma cópia (JSON) antes; POST /api/me/messages/delete:
//   apaga em lotes (o app repete até acabar, mostrando o progresso)
// Quem está na conversa recebe MESSAGE_DELETE_BULK (uma vez por conversa e lote). Os arquivos anexados saem do disco
// quando nada mais usa (unlinkIfUnused) e os clipes dessas mensagens saem da galeria.
const DAY = 86400e3, BATCH = 2000;

export function mountMyMessages(app, d) {
  const { auth, wrap, bad, all, get, run, db, dispatch, channelAudience, unlinkIfUnused, dropClipsOfMessage, clean } = d;

  // filtros do corpo -> SQL (sempre com m.author_id = quem pede)
  function where(uid, b = {}) {
    const w = ['m.author_id = ?'], p = [uid];
    const scope = ['all', 'dms', 'guilds'].includes(b.scope) ? b.scope : 'all';
    if (scope === 'dms') w.push('c.guild_id IS NULL'); else if (scope === 'guilds') w.push('c.guild_id IS NOT NULL');
    if (b.guild_id) { w.push('c.guild_id = ?'); p.push(String(b.guild_id)); }
    const places = Array.isArray(b.places) ? b.places.slice(0, 500).map(String) : [];
    if (places.length) { w.push(`m.channel_id IN (${places.map(() => '?').join(',')})`); p.push(...places); }
    const after = +b.after || 0, cut = Math.min(+b.before || Infinity, +b.until || Infinity);
    if (after > 0) { w.push('m.created_at >= ?'); p.push(after); }
    if (isFinite(cut)) { w.push('m.created_at < ?'); p.push(cut); }
    const days = Math.max(0, Math.min(3650, +b.olderThanDays || 0));
    if (days) { w.push('m.created_at < ?'); p.push(Date.now() - days * DAY); }
    const q = clean(b.contains, 200);
    if (q) { w.push("lower(m.content) LIKE ? ESCAPE '\\'"); p.push('%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%'); }
    if (b.only === 'text') w.push("(m.attachments IS NULL OR m.attachments = '[]')");
    else if (b.only === 'files') w.push("m.attachments IS NOT NULL AND m.attachments <> '[]'");
    else if (b.only === 'links') w.push("(m.content LIKE '%http://%' OR m.content LIKE '%https://%')");
    if (b.keepPinned !== false) w.push('COALESCE(m.pinned, 0) = 0');
    return { sql: w.join(' AND '), p };
  }
  const FROM = 'FROM messages m JOIN channels c ON c.id = m.channel_id';

  // nome do lugar do ponto de vista de quem pede; `left`: não está mais no servidor / na conversa
  const placeOf = (ch, uid) => {
    if (ch.guild_id) {
      const g = get('SELECT name FROM guilds WHERE id=?', ch.guild_id);
      return { guild_id: ch.guild_id, guild: g?.name || 'Servidor', channel: '#' + (ch.name || 'canal'), left: !get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, uid) };
    }
    const others = all('SELECT COALESCE(u.display_name, u.username) n FROM dm_participants p JOIN users u ON u.id = p.user_id WHERE p.channel_id=? AND p.user_id<>?', ch.id, uid).map(r => r.n);
    return { guild_id: null, guild: null, channel: ch.name || (others.length ? others.join(', ') : 'Conversa'), left: !get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', ch.id, uid) };
  };

  app.post('/api/me/messages/scan', auth, wrap((req, res) => {
    const { sql, p } = where(req.uid, req.body);
    const rows = all(`SELECT m.channel_id, COUNT(*) n, MIN(m.created_at) first, MAX(m.created_at) last,
      SUM(CASE WHEN m.attachments IS NOT NULL AND m.attachments <> '[]' THEN 1 ELSE 0 END) files ${FROM} WHERE ${sql} GROUP BY m.channel_id ORDER BY n DESC`, ...p);
    const places = rows.map(r => { const ch = get('SELECT * FROM channels WHERE id=?', r.channel_id); return ch && { channel_id: r.channel_id, ...placeOf(ch, req.uid), count: r.n, files: r.files, first: r.first, last: r.last }; }).filter(Boolean);
    const sample = all(`SELECT m.id, m.channel_id, m.content, m.created_at, m.attachments ${FROM} WHERE ${sql} ORDER BY m.created_at DESC LIMIT 5`, ...p)
      .map(m => ({ id: m.id, channel_id: m.channel_id, content: String(m.content || '').startsWith('e2ee:') ? m.content : String(m.content || '').slice(0, 160), created_at: m.created_at, files: (() => { try { return JSON.parse(m.attachments || '[]').length; } catch { return 0; } })() }));
    const wp = where(req.uid, { ...req.body, keepPinned: false });
    const pinned = req.body?.keepPinned !== false ? (get(`SELECT COUNT(*) n ${FROM} WHERE ${wp.sql} AND m.pinned = 1`, ...wp.p)?.n || 0) : 0;
    res.json({ total: places.reduce((t, x) => t + x.count, 0), places, sample, pinnedKept: pinned, until: Date.now() });
  }));

  // cópia antes de apagar: texto, data, lugar e os endereços dos anexos (até 50 mil mensagens)
  app.post('/api/me/messages/export', auth, wrap((req, res) => {
    const { sql, p } = where(req.uid, req.body), names = new Map();
    const list = all(`SELECT m.id, m.channel_id, m.content, m.created_at, m.edited_at, m.reply_to, m.attachments ${FROM} WHERE ${sql} ORDER BY m.created_at LIMIT 50000`, ...p).map(m => {
      if (!names.has(m.channel_id)) { const ch = get('SELECT * FROM channels WHERE id=?', m.channel_id); const pl = ch ? placeOf(ch, req.uid) : {}; names.set(m.channel_id, (pl.guild ? pl.guild + ' › ' : '') + (pl.channel || '')); }
      let atts = []; try { atts = JSON.parse(m.attachments || '[]').map(a => ({ name: a.name, url: a.url || null, size: a.size || 0, type: a.type || '' })); } catch { }
      return { id: m.id, lugar: names.get(m.channel_id), canal: m.channel_id, quando: new Date(m.created_at).toISOString(), editada: m.edited_at ? new Date(m.edited_at).toISOString() : null, resposta_a: m.reply_to || null, texto: m.content || '', anexos: atts };
    });
    res.set('content-disposition', `attachment; filename="minhas-mensagens-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportado_em: new Date().toISOString(), total: list.length, mensagens: list });
  }));

  app.post('/api/me/messages/delete', auth, wrap((req, res) => {
    const b = req.body || {};
    if (!(+b.until > 0)) return bad(res, 'Faça a prévia antes de apagar'); // o que for enviado depois da prévia nunca entra
    const { sql, p } = where(req.uid, b);
    const rows = all(`SELECT m.id, m.channel_id, m.attachments ${FROM} WHERE ${sql} ORDER BY m.created_at LIMIT ${BATCH}`, ...p);
    const byCh = new Map(), urls = [];
    db.exec('BEGIN');
    try {
      for (const m of rows) {
        run('DELETE FROM messages WHERE id=?', m.id);
        dropClipsOfMessage(m.id);
        try { for (const a of JSON.parse(m.attachments || '[]')) if (a?.url) urls.push(a.url); } catch { }
        if (!byCh.has(m.channel_id)) byCh.set(m.channel_id, []); byCh.get(m.channel_id).push(m.id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const [cid, ids] of byCh) { const ch = get('SELECT * FROM channels WHERE id=?', cid); if (ch) dispatch(channelAudience(ch), 'MESSAGE_DELETE_BULK', { channel_id: cid, guild_id: ch.guild_id, ids }); }
    for (const u of new Set(urls)) unlinkIfUnused(u);
    const left = rows.length < BATCH ? 0 : (get(`SELECT COUNT(*) n ${FROM} WHERE ${sql}`, ...p)?.n || 0);
    res.json({ deleted: rows.length, left });
  }));
}
