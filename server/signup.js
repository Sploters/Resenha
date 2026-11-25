// Cadastro por código de convite. O administrador da instalação (LC_ADMIN ou a primeira conta) escolhe como contas novas
// entram e, no modo "convite", gera códigos para mandar à galera. O link /convite/<código> abre a tela de criar conta com
// o código preenchido; o código pode já colocar a pessoa num servidor.
//
// Modo (tabela meta, chave 'registration'; muda pelo painel sem reiniciar nada):
//   open    qualquer pessoa cria conta (o padrão, como sempre foi)
//   invite  só com um código válido
//   closed  ninguém cria conta
// OPEN_REGISTRATION=0 no ambiente continua fechando tudo, acima do que estiver no painel.
// A primeira conta da instalação nunca precisa de código (é ela que vira administradora e gera os convites).
//
// Código: 10 letras/números sem os que confundem (0/O, 1/I/L), com limite de usos (0 = sem limite), validade opcional,
// recado para o admin lembrar para quem foi, e servidor opcional em que a pessoa entra ao criar a conta. Revogar vale na
// hora. Cada uso fica registrado (quem criou conta com qual código), visível no painel.
//
// Rotas:
//   GET  /api/signup/:code                   { ok, guild? } se o código vale (limite por IP), para a tela de cadastro
//   GET  /api/admin/signup                   { mode, forced, codes: [...], guilds: [...] }       (só o administrador)
//   POST /api/admin/signup/mode              { mode }
//   POST /api/admin/signup/codes             { max_uses, days, note, guild_id } -> { code }
//   POST /api/admin/signup/codes/:code/revoke
import crypto from 'node:crypto';

export const MODES = ['open', 'invite', 'closed'];
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { const b = crypto.randomBytes(10); let s = ''; for (const x of b) s += ALPHA[x % ALPHA.length]; return s; };
// o código é digitado à mão às vezes: ignora espaços, traços e maiúsculas/minúsculas
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);

export function createSignup(d) {
  const { db, get, run, envClosed } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS signup_codes(code TEXT PRIMARY KEY, created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER,
      max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, note TEXT, guild_id TEXT, revoked_at INTEGER);
    CREATE TABLE IF NOT EXISTS signup_uses(code TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(code, user_id));`);
  const stored = () => { const v = get("SELECT v FROM meta WHERE k='registration'")?.v; return MODES.includes(v) ? v : 'open'; };
  const mode = () => (envClosed ? 'closed' : stored());
  const firstAccount = () => !get('SELECT 1 x FROM users LIMIT 1');
  // código que ainda vale (sem gastar)
  const valid = (code) => {
    const c = get('SELECT * FROM signup_codes WHERE code=?', normCode(code)); if (!c) return null;
    if (c.revoked_at || (c.expires_at && c.expires_at <= Date.now()) || (c.max_uses > 0 && c.uses >= c.max_uses)) return null;
    return c;
  };
  // gasta um uso de forma atômica (duas pessoas com o último uso ao mesmo tempo: só uma consegue)
  const consume = (code) => {
    const c = normCode(code), now = Date.now();
    const r = run('UPDATE signup_codes SET uses=uses+1 WHERE code=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (max_uses=0 OR uses<max_uses)', c, now);
    return r.changes === 1 ? get('SELECT * FROM signup_codes WHERE code=?', c) : null;
  };
  // antes de criar a conta: null = pode; string = motivo da recusa
  function gate(code) {
    if (firstAccount()) return null;
    const m = mode();
    if (m === 'closed') return 'O cadastro de contas novas está fechado neste servidor';
    if (m === 'invite') { if (!normCode(code)) return 'Para criar uma conta aqui você precisa de um código de convite. Peça a quem administra o servidor.'; if (!valid(code)) return 'Código de convite inválido, expirado ou já usado'; }
    return null;
  }
  // depois que a conta passou nas outras validações: gasta o código (se houver) e devolve o servidor em que ela entra
  function use(code, uid) {
    if (!normCode(code)) return { ok: mode() !== 'invite' || firstAccount() };
    const c = consume(code);
    if (!c) return { ok: mode() !== 'invite' || firstAccount() }; // modo aberto com código vencido: cria a conta do mesmo jeito
    run('INSERT OR IGNORE INTO signup_uses(code,user_id,at) VALUES(?,?,?)', c.code, uid, Date.now());
    return { ok: true, guild_id: c.guild_id && get('SELECT 1 x FROM guilds WHERE id=?', c.guild_id) ? c.guild_id : null };
  }
  return { mode, stored, gate, use, valid, firstAccount, newCode };
}

export function mountSignup(app, d) {
  const { auth, wrap, bad, get, all, run, clean, isAdmin, signup, ipLimited } = d;
  // histórico do painel de administração (mesma tabela do server/admin.js; o alvo aqui é o modo ou o código, não uma conta)
  const adminLog = (actor, action, target, detail = '') => { try { run('INSERT INTO admin_log(at, actor_id, action, target_id, target_name, detail) VALUES(?,?,?,?,?,?)', Date.now(), actor, action, null, target, detail || null); } catch { /* tabela criada pelo admin.js */ } };
  const only = (fn) => wrap((req, res) => { if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403); fn(req, res); });

  app.get('/api/signup/:code', wrap((req, res) => {
    if (ipLimited(req, 'signupcheck', 30, 600e3)) return bad(res, 'Muitas tentativas. Espere alguns minutos.', 429);
    const c = signup.valid(req.params.code);
    if (!c) return res.json({ ok: false });
    const g = c.guild_id && get('SELECT name FROM guilds WHERE id=?', c.guild_id);
    res.json({ ok: true, ...(g ? { guild: g.name } : {}) });
  }));

  const pub = (c) => ({ code: c.code, created_at: c.created_at, expires_at: c.expires_at, max_uses: c.max_uses, uses: c.uses, note: c.note || '',
    guild_id: c.guild_id, guild_name: c.guild_name || null, revoked: !!c.revoked_at,
    state: c.revoked_at ? 'revoked' : c.expires_at && c.expires_at <= Date.now() ? 'expired' : c.max_uses > 0 && c.uses >= c.max_uses ? 'used' : 'active',
    users: all('SELECT u.id,u.username,u.display_name,s.at FROM signup_uses s JOIN users u ON u.id=s.user_id WHERE s.code=? ORDER BY s.at', c.code) });
  app.get('/api/admin/signup', auth, only((req, res) => {
    const codes = all('SELECT c.*, g.name guild_name FROM signup_codes c LEFT JOIN guilds g ON g.id=c.guild_id ORDER BY c.created_at DESC LIMIT 200');
    const guilds = all('SELECT g.id,g.name FROM guilds g JOIN members m ON m.guild_id=g.id AND m.user_id=? ORDER BY g.name', req.uid);
    res.json({ mode: signup.mode(), forced: signup.mode() !== signup.stored(), codes: codes.map(pub), guilds });
  }));
  app.post('/api/admin/signup/mode', auth, only((req, res) => {
    const m = String(req.body?.mode || ''); if (!['open', 'invite', 'closed'].includes(m)) return bad(res, 'Modo inválido');
    run("INSERT INTO meta(k,v) VALUES('registration',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", m);
    adminLog(req.uid, 'signup_mode', m);
    res.json({ mode: signup.mode(), forced: signup.mode() !== m });
  }));
  app.post('/api/admin/signup/codes', auth, only((req, res) => {
    const max = Math.max(0, Math.min(1000, Math.floor(+req.body?.max_uses || 0)));
    const days = Math.max(0, Math.min(365, +req.body?.days || 0));
    const gid = req.body?.guild_id ? String(req.body.guild_id) : null;
    if (gid && !get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Servidor não encontrado');
    if ((get('SELECT COUNT(*) n FROM signup_codes WHERE revoked_at IS NULL')?.n || 0) >= 500) return bad(res, 'Limite de 500 códigos ativos: revogue alguns antigos', 409);
    let code; do code = signup.newCode(); while (get('SELECT 1 x FROM signup_codes WHERE code=?', code));
    run('INSERT INTO signup_codes(code,created_by,created_at,expires_at,max_uses,note,guild_id) VALUES(?,?,?,?,?,?,?)',
      code, req.uid, Date.now(), days ? Date.now() + days * 864e5 : null, max, clean(req.body?.note, 80) || null, gid);
    adminLog(req.uid, 'signup_code', code, clean(req.body?.note, 80));
    res.json({ code });
  }));
  app.post('/api/admin/signup/codes/:code/revoke', auth, only((req, res) => {
    const r = run('UPDATE signup_codes SET revoked_at=? WHERE code=? AND revoked_at IS NULL', Date.now(), String(req.params.code));
    if (!r.changes) return bad(res, 'Código não encontrado', 404);
    adminLog(req.uid, 'signup_revoke', String(req.params.code));
    res.json({});
  }));
}
