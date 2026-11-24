// Entrar e criar conta: registro, login e logout, com limite de tentativas por IP (o scrypt da senha é caro).
// Devolve o ipLimited, usado também pelo login por QR Code (server/qrlogin.js).
import crypto from 'node:crypto';
import { hashPw, pwMatches, passwordProblem, loginBlocked, loginFailed, loginOk } from '../accounts.js';
import { uxSignup } from '../ux.js';

export function mountAuth(app, d) {
  const { auth, wrap, bad, clean, get, run, newId, sessions, OPEN_REGISTRATION, COLORS, DEFAULT_AVATARS } = d;
  // avatar padrão menos usado (empate: sorteio), para duas pessoas da turma não começarem com o mesmo rosto
  const pickAvatar = () => {
    if (!DEFAULT_AVATARS.length) return null;
    const used = (a) => get('SELECT COUNT(*) n FROM users WHERE avatar=?', a)?.n || 0;
    const counts = DEFAULT_AVATARS.map(a => [a, used(a)]), min = Math.min(...counts.map(c => c[1]));
    const free = counts.filter(c => c[1] === min);
    return free[Math.floor(Math.random() * free.length)][0];
  };
  // tentativas por IP: o scrypt da senha trava o servidor ~50 ms por chamada; sem limite, alguém podia testar senhas sem parar
  // (força bruta) ou derrubar a voz/chat de todos só mandando logins. Login: 10 por minuto por IP + conta (a turma atrás do
  // mesmo IP, ex.: proxy do Docker, não se bloqueia entre si). Registro: 20 contas por hora por IP.
  const ipHits = new Map(); // `${tipo}:${ip}` -> [tempos]
  function ipLimited(req, kind, max, ms, extra = '') {
    const k = kind + ':' + (req.socket.remoteAddress || '?') + extra, now = Date.now(), a = (ipHits.get(k) || []).filter(t => now - t < ms);
    if (a.length >= max) { ipHits.set(k, a); return true; }
    a.push(now); ipHits.set(k, a); return false;
  }
  setInterval(() => { const now = Date.now(); for (const [k, a] of ipHits) if (!a.length || now - a[a.length - 1] > 3600e3) ipHits.delete(k); }, 600e3).unref();
  app.post('/api/register', wrap((req, res) => {
    if (!OPEN_REGISTRATION) return bad(res, 'Registro desativado', 403);
    if (ipLimited(req, 'reg', 20, 3600e3)) return bad(res, 'Muitas contas criadas daqui. Tente mais tarde.', 429);
    const username = clean(req.body.username, 32), pw = String(req.body.password || '');
    if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(username)) return bad(res, 'Nome de usuário inválido (2-32 caracteres: letras, números, _ . -)');
    { const why = passwordProblem(pw, username); if (why) return bad(res, why); }
    if (get('SELECT 1 x FROM users WHERE username=?', username) || /^bot_music_/i.test(username)) return bad(res, 'Esse nome de usuário já existe', 409);
    const id = newId(), salt = crypto.randomBytes(16).toString('hex');
    run('INSERT INTO users(id,username,display_name,pass_hash,salt,color,avatar,created_at) VALUES(?,?,?,?,?,?,?,?)',
      id, username, clean(req.body.display_name, 32) || username, hashPw(pw, salt), salt, COLORS[Math.floor(Math.random() * COLORS.length)],
      pickAvatar(), Date.now());
    const token = sessions.create(id, clean(req.headers['user-agent'], 200));
    uxSignup(id); // telemetria: começa a "turma" do dia (funil do usuário novo e retenção), sem guardar quem
    res.json({ token });
  }));
  app.post('/api/login', wrap((req, res) => {
    if (ipLimited(req, 'login', 10, 60e3, ':' + clean(req.body.username, 32).toLowerCase())) return bad(res, 'Muitas tentativas. Espere um minuto.', 429);
    const name = clean(req.body.username, 32), ip = req.socket.remoteAddress || '?';
    // muitas erradas (nesta conta ou deste IP): espera, sem nem conferir a senha
    { const wait = loginBlocked(ip, name); if (wait) return bad(res, wait, 429); }
    const u = get('SELECT * FROM users WHERE username=?', name);
    // conta que não existe também gasta o scrypt: o tempo da resposta não diz se o nome existe
    const ok = u ? pwMatches(u, String(req.body.password ?? '')) : (hashPw('x', 'resenha-nao-existe'), false);
    if (!ok) { loginFailed(ip, name); return bad(res, 'Usuário ou senha inválidos', 401); }
    if (d.banned?.has(u.id)) return bad(res, 'Esta conta foi suspensa pelo administrador', 403); // server/admin.js
    loginOk(name);
    res.json({ token: sessions.create(u.id, clean(req.headers['user-agent'], 200)) });
  }));
  app.post('/api/logout', auth, wrap((req, res) => { run('DELETE FROM sessions WHERE token=?', req.tokenHash); res.json({}); }));
  return { ipLimited };
}
