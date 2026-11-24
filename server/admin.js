// Gerenciamento de usuários pelo administrador da instalação (o mesmo do painel de Estatísticas de uso: LC_ADMIN ou a
// primeira conta criada). Listar e buscar contas, suspender/reativar (a conta inteira, não só num servidor), redefinir a
// senha (gera uma senha temporária mostrada uma vez ao admin e encerra as sessões), encerrar sessões e excluir a conta.
// Tudo fica registrado em admin_log (quem, o quê, em quem, quando), visível no próprio painel.
//
// Rotas (só o administrador):
//   GET  /api/admin/users?q=          contas (até 200, mais recentes primeiro; q busca no usuário e no nome)
//   POST /api/admin/users/:id/ban     { reason }   suspende: sai de todos os aparelhos e não entra mais
//   POST /api/admin/users/:id/unban
//   POST /api/admin/users/:id/password             → { password } temporária
//   POST /api/admin/users/:id/logout               encerra todas as sessões
//   POST /api/admin/users/:id/delete  { confirm }  confirm = nome de usuário da conta
//   GET  /api/admin/guilds?user=&q=   servidores da instalação (ou só os de uma conta): dono, membros, canais e última
//                                      mensagem. Não mostra conteúdo: para ver o que tem dentro, o admin entra
//   POST /api/admin/guilds/:id/join    o admin entra no servidor como membro (aparece para todos: "entrou no servidor")
//   POST /api/admin/guilds/:id/delete  { confirm } confirm = nome do servidor
//   GET  /api/admin/log                últimas 100 ações
import crypto from 'node:crypto';
import { hashPw } from './accounts.js';

export function mountAdmin(app, d) {
  const { auth, wrap, bad, db, all, get, run, clean, isAdmin, sessions, conns, banned, deleteAccount, joinGuild, guildMemberIds, dispatch, voice, leaveVoice, dropViewers } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS admin_log(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT, action TEXT NOT NULL,
    target_id TEXT, target_name TEXT, detail TEXT)`);
  const log = (actor, action, u, detail = '') => run('INSERT INTO admin_log(at, actor_id, action, target_id, target_name, detail) VALUES(?,?,?,?,?,?)', Date.now(), actor, action, u.id, u.username, detail);
  const only = (fn) => wrap((req, res) => { if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403); fn(req, res); });
  const target = (req, res, { notSelf = true } = {}) => {
    const u = get('SELECT * FROM users WHERE id=?', String(req.params.id));
    if (!u) { bad(res, 'Conta não encontrada', 404); return null; }
    if (notSelf && u.id === req.uid) { bad(res, 'Isso não vale para a sua própria conta'); return null; }
    return u;
  };
  // senha temporária legível: 3 grupos de 4 (sem letras que confundem)
  const tempPassword = () => { const A = 'abcdefghjkmnpqrstuvwxyz23456789', b = crypto.randomBytes(12); return [0, 4, 8].map(i => [...b.subarray(i, i + 4)].map(x => A[x % A.length]).join('')).join('-'); };

  app.get('/api/admin/users', auth, only((req, res) => {
    const q = clean(req.query.q, 40).toLowerCase().replace(/[%_\\]/g, '');
    const rows = all(`SELECT u.id, u.username, u.display_name, u.avatar, u.created_at, u.banned_at, u.banned_reason,
        (SELECT MAX(COALESCE(s.last_seen, s.created_at)) FROM sessions s WHERE s.user_id=u.id) last_seen,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) sessions,
        (SELECT COUNT(*) FROM members m WHERE m.user_id=u.id) guilds,
        (SELECT COUNT(*) FROM guilds g WHERE g.owner_id=u.id) owns
      FROM users u WHERE u.username NOT LIKE 'bot\\_%' ESCAPE '\\' ${q ? "AND (lower(u.username) LIKE ? OR lower(u.display_name) LIKE ?)" : ''}
      ORDER BY u.created_at DESC LIMIT 200`, ...(q ? ['%' + q + '%', '%' + q + '%'] : []));
    res.json({ users: rows.map(r => ({ ...r, online: conns.has(r.id), admin: isAdmin(r.id) })), total: get("SELECT COUNT(*) n FROM users WHERE username NOT LIKE 'bot\\_%' ESCAPE '\\'").n });
  }));
  app.post('/api/admin/users/:id/ban', auth, only((req, res) => {
    const u = target(req, res); if (!u) return;
    const reason = clean(req.body?.reason, 200);
    run('UPDATE users SET banned_at=?, banned_reason=? WHERE id=?', Date.now(), reason || null, u.id);
    banned.add(u.id);
    const ended = sessions.revoke(u.id); // sai de todos os aparelhos (fecha as conexões abertas)
    for (const ws of conns.get(u.id) || []) try { ws.close(4003, 'conta suspensa'); } catch { }
    log(req.uid, 'ban', u, reason); res.json({ ended });
  }));
  app.post('/api/admin/users/:id/unban', auth, only((req, res) => {
    const u = target(req, res); if (!u) return;
    run('UPDATE users SET banned_at=NULL, banned_reason=NULL WHERE id=?', u.id); banned.delete(u.id);
    log(req.uid, 'unban', u); res.json({});
  }));
  app.post('/api/admin/users/:id/password', auth, only((req, res) => {
    const u = target(req, res); if (!u) return;
    const pw = tempPassword(), salt = crypto.randomBytes(16).toString('hex');
    run('UPDATE users SET pass_hash=?, salt=? WHERE id=?', hashPw(pw, salt), salt, u.id);
    const ended = sessions.revoke(u.id);
    log(req.uid, 'password', u); res.json({ password: pw, ended });
  }));
  app.post('/api/admin/users/:id/logout', auth, only((req, res) => {
    const u = target(req, res); if (!u) return;
    const ended = sessions.revoke(u.id); log(req.uid, 'logout', u, String(ended)); res.json({ ended });
  }));
  app.post('/api/admin/users/:id/delete', auth, only((req, res) => {
    const u = target(req, res); if (!u) return;
    if (String(req.body?.confirm || '') !== u.username) return bad(res, 'Digite o nome de usuário da conta para confirmar');
    const owns = get('SELECT COUNT(*) n FROM guilds WHERE owner_id=?', u.id).n;
    log(req.uid, 'delete', u, owns ? `${owns} servidor(es) apagado(s) junto` : '');
    deleteAccount(u.id); banned.delete(u.id);
    res.json({});
  }));
  const glog = (actor, action, g, detail = '') => run('INSERT INTO admin_log(at, actor_id, action, target_id, target_name, detail) VALUES(?,?,?,?,?,?)', Date.now(), actor, action, g.id, g.name, detail);
  app.get('/api/admin/guilds', auth, only((req, res) => {
    const uid = req.query.user ? String(req.query.user) : null, q = clean(req.query.q, 60).toLowerCase().replace(/[%_\\]/g, '');
    const rows = all(`SELECT g.id, g.name, g.icon, g.created_at, g.owner_id, o.username owner_name,
        (SELECT COUNT(*) FROM members m WHERE m.guild_id=g.id) members,
        (SELECT COUNT(*) FROM channels c WHERE c.guild_id=g.id AND c.type<>4) channels,
        (SELECT MAX(x.created_at) FROM messages x JOIN channels c ON c.id=x.channel_id WHERE c.guild_id=g.id) last_message,
        EXISTS(SELECT 1 FROM members m WHERE m.guild_id=g.id AND m.user_id=?) mine
      FROM guilds g LEFT JOIN users o ON o.id=g.owner_id
      WHERE 1=1 ${uid ? 'AND g.id IN (SELECT guild_id FROM members WHERE user_id=?)' : ''} ${q ? 'AND lower(g.name) LIKE ?' : ''}
      ORDER BY g.created_at DESC LIMIT 300`, req.uid, ...(uid ? [uid] : []), ...(q ? ['%' + q + '%'] : []));
    res.json({ guilds: rows.map(r => ({ ...r, mine: !!r.mine })), user: uid ? get('SELECT id, username FROM users WHERE id=?', uid) || null : null });
  }));
  const guildOf = (req, res) => { const g = get('SELECT * FROM guilds WHERE id=?', String(req.params.id)); if (!g) bad(res, 'Servidor não encontrado', 404); return g; };
  app.post('/api/admin/guilds/:id/join', auth, only((req, res) => {
    const g = guildOf(req, res); if (!g) return;
    if (get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', g.id, req.uid)) return res.json({ already: true });
    joinGuild(g.id, req.uid); glog(req.uid, 'guild_join', g); res.json({});
  }));
  app.post('/api/admin/guilds/:id/delete', auth, only((req, res) => {
    const g = guildOf(req, res); if (!g) return;
    if (String(req.body?.confirm || '') !== g.name) return bad(res, 'Digite o nome do servidor para confirmar');
    const ids = guildMemberIds(g.id);
    for (const [cid, m] of voice) for (const u of [...m.keys()]) if (get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', cid, g.id)) leaveVoice(u, cid);
    glog(req.uid, 'guild_delete', g, `dono @${get('SELECT username FROM users WHERE id=?', g.owner_id)?.username || '?'}`);
    run('DELETE FROM guilds WHERE id=?', g.id);
    dispatch(ids, 'GUILD_DELETE', { id: g.id }); dropViewers?.(g.id);
    res.json({});
  }));
  app.get('/api/admin/log', auth, only((req, res) => {
    res.json({ entries: all('SELECT l.*, a.username actor_name FROM admin_log l LEFT JOIN users a ON a.id=l.actor_id ORDER BY l.id DESC LIMIT 100') });
  }));
}
