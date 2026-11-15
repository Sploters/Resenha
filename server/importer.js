// Importar histórico do Discord (ideia "Import Discord Chat History", Stoat #1355). O app lê o arquivo do
// DiscordChatExporter (JSON, HTML ou TXT) no aparelho e manda as mensagens em lotes; aqui elas entram no canal com a data
// original (o id é montado a partir da data, então ficam no lugar certo da conversa).
// - Conversa direta: cada nome do Discord vira "eu", "a outra pessoa" ou fica com o nome original. As duas pessoas veem a
//   marca "importada do Discord" e qualquer uma das duas pode desfazer a importação inteira.
// - Canal de servidor: precisa gerenciar canais; os nomes do Discord viram "eu" ou ficam com o nome original.
// Importada não notifica ninguém, não marca ninguém e não conta como não lida. No fim entra um aviso com o resumo.
const BATCH_MAX = 500, TOTAL_MAX = 50000;
const SNOW_EPOCH = 1420070400000; // início dos ids do Discord

export function mountImporter(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, channelAudience, canAccessChannel, can, P, userPub, clean, audit }) {
  try { db.exec('ALTER TABLE messages ADD COLUMN imp TEXT'); } catch { /* já existe */ }
  try { db.exec('ALTER TABLE messages ADD COLUMN imp_batch TEXT'); } catch { /* já existe */ }
  db.exec('CREATE INDEX IF NOT EXISTS messages_imp_batch ON messages(imp_batch) WHERE imp_batch IS NOT NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, source TEXT, count INTEGER DEFAULT 0,
    first_at INTEGER, last_at INTEGER, created_at INTEGER, done INTEGER DEFAULT 0)`);

  const chFor = (req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !canAccessChannel(req.uid, ch)) { bad(res, 'Canal não encontrado', 404); return null; }
    if (![0, 1, 3, 5, 16].includes(ch.type)) { bad(res, 'Este tipo de canal não recebe mensagens importadas'); return null; }
    if (ch.guild_id && !can(ch.guild_id, req.uid, P.MANAGE_CHANNELS)) { bad(res, 'Só quem gerencia canais importa histórico num servidor', 403); return null; }
    return ch;
  };
  const peerOf = (ch, uid) => ch.type === 1 ? all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, uid)[0]?.user_id || null : null;
  // id na posição da data: ms * 1000 + sequência (o mesmo formato do newId); pula os que já existem
  const idAt = (ts) => { let n = BigInt(ts) * 1000n; for (let i = 0; i < 1000; i++, n++) if (!get('SELECT 1 x FROM messages WHERE id=?', n.toString())) return n.toString(); return newId(); };
  // menções do Discord (<@123>, <#123>, <@&123>) não existem aqui: viram texto
  const scrub = (t) => String(t || '').replace(/<@!?(\d+)>/g, '@alguém').replace(/<@&(\d+)>/g, '@cargo').replace(/<#(\d+)>/g, '#canal').replace(/@(everyone|here)\b/g, '@​$1');

  // lote: { batch?, source, messages: [{ ts | discord_id, name, content, as: 'me'|'peer'|null, files: [url], reply_name? }] }
  app.post('/api/channels/:id/import', auth, wrap((req, res) => {
    const ch = chFor(req, res); if (!ch) return;
    const list = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, BATCH_MAX) : [];
    let imp = req.body?.batch ? get('SELECT * FROM imports WHERE id=? AND channel_id=? AND user_id=? AND done=0', String(req.body.batch), ch.id, req.uid) : null;
    if (req.body?.batch && !imp) return bad(res, 'Importação não encontrada');
    if (!imp) {
      const id = newId();
      run('INSERT INTO imports(id,channel_id,user_id,source,created_at) VALUES(?,?,?,?,?)', id, ch.id, req.uid, clean(req.body?.source, 20) || 'discord', Date.now());
      imp = get('SELECT * FROM imports WHERE id=?', id);
    }
    if (imp.count + list.length > TOTAL_MAX) return bad(res, `No máximo ${TOTAL_MAX.toLocaleString('pt-BR')} mensagens por importação`);
    const peer = peerOf(ch, req.uid), now = Date.now();
    let n = 0, first = imp.first_at, last = imp.last_at;
    db.exec('BEGIN');
    try {
      for (const m of list) {
        let ts = +m?.ts;
        if (!Number.isFinite(ts) && /^\d{15,20}$/.test(String(m?.discord_id || ''))) ts = Number(BigInt(m.discord_id) >> 22n) + SNOW_EPOCH;
        if (!Number.isFinite(ts) || ts < SNOW_EPOCH || ts > now) continue; // sem data confiável: fica de fora
        const files = (Array.isArray(m.files) ? m.files : []).filter(u => typeof u === 'string' && /^https?:\/\/\S{1,600}$/.test(u)).slice(0, 10);
        let content = scrub(clean(m.content, 4000));
        if (files.length) content = (content ? content + '\n' : '') + files.join('\n');
        if (!content.trim()) continue;
        const as = m.as === 'me' ? 'me' : m.as === 'peer' && peer ? 'peer' : null;
        const author = as === 'peer' ? peer : req.uid;
        const meta = { src: 'discord', by: req.uid, ...(as ? {} : { n: clean(m.name, 64) || 'Desconhecido' }), ...(m.reply_name ? { re: clean(m.reply_name, 64) } : {}) };
        run('INSERT INTO messages(id,channel_id,author_id,content,created_at,attachments,imp,imp_batch) VALUES(?,?,?,?,?,?,?,?)', idAt(ts), ch.id, author, content, ts, '[]', JSON.stringify(meta), imp.id);
        n++; first = first ? Math.min(first, ts) : ts; last = last ? Math.max(last, ts) : ts;
      }
      run('UPDATE imports SET count=count+?, first_at=?, last_at=? WHERE id=?', n, first, last, imp.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ batch: imp.id, added: n, total: imp.count + n });
  }));
  // terminou: aviso na conversa com o resumo e todos os aparelhos recarregam o canal
  app.post('/api/channels/:id/import/:batch/finish', auth, wrap((req, res) => {
    const ch = chFor(req, res); if (!ch) return;
    const imp = get('SELECT * FROM imports WHERE id=? AND channel_id=? AND user_id=?', req.params.batch, ch.id, req.uid);
    if (!imp) return bad(res, 'Importação não encontrada', 404);
    if (!imp.done) {
      run('UPDATE imports SET done=1 WHERE id=?', imp.id);
      if (imp.count) {
        const d = (t) => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const mid = newId();
        run("INSERT INTO messages(id,channel_id,author_id,content,created_at,type) VALUES(?,?,?,?,?,1)", mid, ch.id, req.uid,
          `importou ${imp.count.toLocaleString('pt-BR')} mensage${imp.count === 1 ? 'm' : 'ns'} do Discord (${d(imp.first_at)} a ${d(imp.last_at)}).`, Date.now());
        if (ch.guild_id) audit(ch.guild_id, req.uid, 'channel_update', ch.id, `${ch.name} · ${imp.count} mensagens importadas do Discord`);
      }
    }
    dispatch(channelAudience(ch), 'MESSAGES_IMPORTED', { channel_id: ch.id, guild_id: ch.guild_id || null, batch: imp.id, count: imp.count, by: userPub(req.uid) });
    res.json({ count: imp.count });
  }));
  // importações do canal (para desfazer)
  app.get('/api/channels/:id/imports', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !canAccessChannel(req.uid, ch)) return bad(res, 'Canal não encontrado', 404);
    res.json(all('SELECT id, user_id, count, first_at, last_at, created_at FROM imports WHERE channel_id=? AND count>0 ORDER BY created_at DESC', ch.id)
      .map(i => ({ ...i, by: userPub(i.user_id), can_undo: undoOk(ch, i, req.uid) })));
  }));
  // desfazer: quem importou, a outra pessoa da conversa direta ou um moderador do servidor
  const undoOk = (ch, imp, uid) => imp.user_id === uid || (ch.type === 1 && !!get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', ch.id, uid)) || (ch.guild_id && can(ch.guild_id, uid, P.MANAGE_MESSAGES));
  app.delete('/api/channels/:id/imports/:batch', auth, wrap((req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || !canAccessChannel(req.uid, ch)) return bad(res, 'Canal não encontrado', 404);
    const imp = get('SELECT * FROM imports WHERE id=? AND channel_id=?', req.params.batch, ch.id);
    if (!imp) return bad(res, 'Importação não encontrada', 404);
    if (!undoOk(ch, imp, req.uid)) return bad(res, 'Sem permissão', 403);
    const n = run('DELETE FROM messages WHERE imp_batch=? AND channel_id=?', imp.id, ch.id).changes;
    run('DELETE FROM imports WHERE id=?', imp.id);
    if (ch.guild_id) audit(ch.guild_id, req.uid, 'channel_update', ch.id, `${ch.name} · importação desfeita (${n} mensagens)`);
    dispatch(channelAudience(ch), 'MESSAGES_IMPORTED', { channel_id: ch.id, guild_id: ch.guild_id || null, batch: imp.id, removed: n, by: userPub(req.uid) });
    res.json({ removed: n });
  }));
}
