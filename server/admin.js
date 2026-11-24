// Gerenciamento de usuários pelo administrador da instalação (o mesmo do painel de Estatísticas de uso: LC_ADMIN ou a
// primeira conta criada). Listar e buscar contas, suspender/reativar (a conta inteira, não só num servidor), redefinir a
// senha (gera uma senha temporária mostrada uma vez ao admin e encerra as sessões), encerrar sessões e excluir a conta.
// Tudo fica registrado em admin_log (quem, o quê, em quem, quando), visível no próprio painel.
// Não mexe nas escolhas de privacidade de ninguém: essas só a própria pessoa muda.
//
// Rotas (só o administrador):
//   GET  /api/admin/users?q=          contas (até 200, mais recentes primeiro; q busca no usuário e no nome)
//   POST /api/admin/users/:id/ban     { reason }   suspende: sai de todos os aparelhos e não entra mais
//   POST /api/admin/users/:id/unban
//   POST /api/admin/users/:id/password             → { password } temporária
//   POST /api/admin/users/:id/logout               encerra todas as sessões
//   POST /api/admin/users/:id/delete  { confirm }  confirm = nome de usuário da conta
//   GET  /api/admin/log                últimas 100 ações
import crypto from 'node:crypto';
import { hashPw } from './accounts.js';

export function mountAdmin(app, d) {
  const { auth, wrap, bad, db, all, get, run, clean, isAdmin, sessions, conns, banned, deleteAccount } = d;
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
  app.get('/api/admin/log', auth, only((req, res) => {
    res.json({ entries: all('SELECT l.*, a.username actor_name FROM admin_log l LEFT JOIN users a ON a.id=l.actor_id ORDER BY l.id DESC LIMIT 100') });
  }));
}
