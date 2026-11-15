// Canal de documento (tipo 17; ideia "Kinds of Channels", Stoat #1027): uma página em markdown por canal — regras,
// guias, listas de tarefas ("- [ ]" vira caixinha que dá para marcar). Quem pode escrever no canal (por padrão só quem
// gerencia mensagens; os ajustes do canal liberam para um cargo) edita; todo membro lê. Cada gravação aumenta a versão:
// quem salvou em cima de uma versão velha recebe 409 com a atual (o app junta ou pergunta), sem apagar o que o outro fez.
export const DOC_MAX = 60000;

export function mountDocChannel(app, { auth, wrap, bad, db, get, run, dispatch, guildMemberIds, canAccessChannel, chCan, CH, userPub, audit }) {
  for (const c of ['doc TEXT', 'doc_v INTEGER DEFAULT 0', 'doc_by TEXT', 'doc_at INTEGER']) { try { db.exec('ALTER TABLE channels ADD COLUMN ' + c); } catch { /* já existe */ } }
  const docObj = (ch) => ({ channel_id: ch.id, content: ch.doc || '', v: ch.doc_v || 0, by: ch.doc_by ? userPub(ch.doc_by) : null, at: ch.doc_at || null });
  const docFor = (req, res) => {
    const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
    if (!ch || ch.type !== 17 || !canAccessChannel(req.uid, ch)) { bad(res, 'Documento não encontrado', 404); return null; }
    return ch;
  };
  app.get('/api/channels/:id/doc', auth, wrap((req, res) => { const ch = docFor(req, res); if (ch) res.json({ ...docObj(ch), can_edit: chCan(ch, req.uid, CH.SEND) }); }));
  app.put('/api/channels/:id/doc', auth, wrap((req, res) => {
    const ch = docFor(req, res); if (!ch) return;
    if (!chCan(ch, req.uid, CH.SEND)) return bad(res, 'Você não pode editar este documento', 403);
    const content = String(req.body?.content ?? '').replace(/\r\n?/g, '\n');
    if (content.length > DOC_MAX) return bad(res, `Documento grande demais (máximo ${DOC_MAX.toLocaleString('pt-BR')} caracteres)`);
    const v = +req.body?.v;
    if (Number.isFinite(v) && v !== (ch.doc_v || 0)) return res.status(409).json({ error: 'Alguém salvou o documento enquanto você editava', doc: docObj(ch) });
    const now = Date.now();
    run('UPDATE channels SET doc=?, doc_v=COALESCE(doc_v,0)+1, doc_by=?, doc_at=? WHERE id=?', content, req.uid, now, ch.id);
    const cur = get('SELECT * FROM channels WHERE id=?', ch.id), d = { ...docObj(cur), guild_id: ch.guild_id };
    // auditoria só da primeira edição de cada pessoa em 10 min (marcar caixinhas não enche o registro)
    const last = lastAudit.get(ch.id + ':' + req.uid) || 0;
    if (now - last > 600000) { lastAudit.set(ch.id + ':' + req.uid, now); audit(ch.guild_id, req.uid, 'channel_update', ch.id, ch.name + ' · documento editado'); }
    dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_DOC', d);
    res.json(d);
  }));
  const lastAudit = new Map();
}
