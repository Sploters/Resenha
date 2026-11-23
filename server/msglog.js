// Registro de mensagens editadas e excluídas nos servidores (parte do Registro de auditoria).
// - Só canais de servidor: DMs nunca entram (record() ignora canal sem guild_id).
// - Guarda o mínimo: autor, quem fez, canal (id e nome na hora), texto antes/depois (até 4000 caracteres) e, de anexo,
//   só os nomes dos arquivos. Nada de IP, aparelho ou conteúdo de anexo.
// - Retenção por servidor (guilds.msglog_days: 0 = desligado, padrão 30; até 180). Desligar apaga o que havia.
// - Imutável: uma trava no banco (trigger) recusa qualquer UPDATE; as linhas só saem pela retenção, ao desligar
//   ou com o servidor (ON DELETE CASCADE). Não existe rota de editar ou apagar entradas.
// - Quem lê: dono, Administrador ou cargo com "Ver registro de mensagens" (P.VIEW_MSGLOG). Mudar a retenção:
//   quem gerencia o servidor; a mudança entra no registro de auditoria comum.
export const MSGLOG_DAYS = [0, 7, 30, 90, 180];
const MAX = 4000, DEF_DAYS = 30;

export function mountMsgLog(app, { auth, wrap, bad, db, all, get, run, newId, can, P, userPub, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_log(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id TEXT, channel_name TEXT DEFAULT '', message_id TEXT, author_id TEXT, actor_id TEXT, kind TEXT NOT NULL,
    before TEXT DEFAULT '', after TEXT DEFAULT '', created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_msglog_guild ON message_log(guild_id, id);
  CREATE TRIGGER IF NOT EXISTS msglog_no_update BEFORE UPDATE ON message_log BEGIN SELECT RAISE(ABORT, 'registro de mensagens não pode ser alterado'); END;`);
  try { db.exec(`ALTER TABLE guilds ADD COLUMN msglog_days INTEGER DEFAULT ${DEF_DAYS}`); } catch { /* já existe */ }

  const daysOf = (gid) => { const d = get('SELECT msglog_days d FROM guilds WHERE id=?', gid)?.d; return d == null ? DEF_DAYS : d; };
  const files = (m) => { try { return JSON.parse(m.attachments || '[]').map(a => a?.name).filter(Boolean); } catch { return []; } };
  const text = (m) => { const f = files(m); return (String(m.content || '') + (f.length ? `\n[anexo: ${f.join(', ')}]` : '')).trim().slice(0, MAX); };

  // kind: 'edit' (after = texto novo) ou 'delete'. Chamado depois da mudança feita no banco.
  function record(kind, ch, m, actor, after = '') {
    if (!ch?.guild_id || !m) return; // DMs e conversas privadas: nunca
    if (!daysOf(ch.guild_id)) return; // registro desligado neste servidor
    const before = text(m), now = String(after || '').slice(0, MAX);
    if (kind === 'edit' && before === text({ ...m, content: now })) return; // nada mudou de fato
    run('INSERT INTO message_log(id,guild_id,channel_id,channel_name,message_id,author_id,actor_id,kind,before,after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      newId(), ch.guild_id, ch.id, String(ch.name || '').slice(0, 100), m.id, m.author_id, actor, kind, before, kind === 'edit' ? now : '', Date.now());
  }
  const prune = () => {
    run('DELETE FROM message_log WHERE guild_id IN (SELECT id FROM guilds WHERE msglog_days=0)');
    run('DELETE FROM message_log WHERE created_at < ? - COALESCE((SELECT msglog_days FROM guilds g WHERE g.id=message_log.guild_id), ?) * 86400000', Date.now(), DEF_DAYS);
  };
  prune(); setInterval(prune, 6 * 3600e3).unref();

  const canRead = (gid, uid) => can(gid, uid, P.VIEW_MSGLOG);
  app.get('/api/guilds/:id/msglog', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!canRead(gid, req.uid)) return bad(res, 'Sem permissão para ver o registro de mensagens', 403);
    const q = req.query, days = daysOf(gid), w = ['guild_id=?', 'created_at>=?'], p = [gid, Date.now() - days * 864e5];
    if (q.kind === 'edit' || q.kind === 'delete') { w.push('kind=?'); p.push(q.kind); }
    if (q.channel) { w.push('channel_id=?'); p.push(String(q.channel)); }
    if (q.user) { w.push('(author_id=? OR actor_id=?)'); p.push(String(q.user), String(q.user)); }
    if (+q.from > 0) { w.push('created_at>=?'); p.push(+q.from); }
    if (+q.to > 0) { w.push('created_at<=?'); p.push(+q.to); }
    if (q.q) { const like = '%' + String(q.q).slice(0, 100).replace(/[\\%_]/g, (c) => '\\' + c) + '%'; w.push("(before LIKE ? ESCAPE '\\' OR after LIKE ? ESCAPE '\\')"); p.push(like, like); }
    if (q.before) { w.push('id<?'); p.push(String(q.before)); }
    const rows = days ? all(`SELECT * FROM message_log WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 50`, ...p) : [];
    const ids = new Set(rows.flatMap(r => [r.author_id, r.actor_id]).filter(Boolean));
    res.json({ entries: rows, users: [...ids].map(userPub).filter(Boolean), keep_days: days, can_configure: can(gid, req.uid, P.MANAGE_GUILD) });
  }));
  app.patch('/api/guilds/:id/msglog', auth, wrap((req, res) => {
    const gid = req.params.id, d = +req.body?.days;
    if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    if (!MSGLOG_DAYS.includes(d)) return bad(res, 'Prazo inválido');
    run('UPDATE guilds SET msglog_days=? WHERE id=?', d, gid);
    audit(gid, req.uid, 'msglog_settings', null, d ? `${d} dias` : 'desligado');
    prune();
    res.json({ keep_days: d });
  }));
  return { record };
}
