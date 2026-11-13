// Segurança de contas e sessões:
// - Tokens guardados com hash (SHA-256) no banco: quem ler uma cópia do resenha.db (backup, disco da VPS) não consegue
//   entrar como ninguém. O app continua com o token de verdade; o servidor só compara o hash.
// - Expiração: sessão sem uso há SESSION_IDLE_DAYS dias (padrão 30) ou criada há mais de SESSION_MAX_DAYS dias (padrão
//   180) deixa de valer; a pessoa entra de novo. Limpeza de hora em hora (e a conexão aberta dela é fechada).
// - Trocar a senha encerra as outras sessões (o aparelho em que trocou continua).
// - Tentativas de login erradas: por conta (5 erradas → espera que dobra a cada erro, até 15 min) e por IP (30 erradas
//   em 15 min → 15 min sem tentar), além do limite de 10 por minuto que já existia. Na espera nem roda o scrypt.
// - Senha nova: 8 a 256 caracteres, diferente do nome de usuário e fora da lista das mais usadas. Senhas antigas
//   continuam valendo (a regra vale ao criar a conta e ao trocar a senha).
import crypto from 'node:crypto';

const DAY = 864e5;
export const IDLE_MS = Math.max(1, +(process.env.SESSION_IDLE_DAYS || 30)) * DAY;
export const MAX_MS = Math.max(1, +(process.env.SESSION_MAX_DAYS || 180)) * DAY;
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
// comparação em tempo constante (o !== entregava, pelo tempo de resposta, quantos caracteres do hash batiam)
export function pwMatches(u, pw) {
  if (!u || typeof pw !== 'string' || pw.length > 256) return false;
  const a = Buffer.from(hashPw(pw, u.salt), 'hex'), b = Buffer.from(String(u.pass_hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- política de senha ----
// as mais usadas (vazamentos públicos, inclusive as brasileiras); comparadas sem maiúsculas/acentos
const COMMON = new Set(`123456 12345678 123456789 1234567890 12345 1234567 password password1 password123 qwerty qwerty123
qwertyuiop 1q2w3e4r 1q2w3e4r5t 1qaz2wsx abc123 abcd1234 111111 000000 11111111 00000000 123123 123123123 112233
121212 654321 666666 696969 777777 987654321 88888888 senha senha123 senha1234 senha12345 minhasenha mudar123
mudar1234 trocar123 brasil brasil123 flamengo corinthians palmeiras saopaulo vasco gremio internacional cruzeiro
iloveyou princess admin admin123 administrador welcome welcome1 monkey dragon football baseball letmein master
sunshine shadow superman batman trustno1 starwars passw0rd p@ssw0rd p@ssword 1234abcd a1b2c3d4 asdfghjkl asdf1234
zxcvbnm zxcvbnm123 resenha resenha123 discord discord123 teste teste123 teste1234 gabriel123 lucas123 amor123
jesus123 deusefiel familia família 102030 10203040 147258369 159753 159357 741852963 963852741`.split(/\s+/));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function passwordProblem(pw, username = '') {
  pw = String(pw ?? '');
  if (pw.length < 8) return 'Senha muito curta (mínimo 8 caracteres)';
  if (pw.length > 256) return 'Senha muito longa (máximo 256)';
  const n = norm(pw);
  if (username && (n === norm(username) || n.includes(norm(username)) && norm(username).length >= 4 && n.length - norm(username).length < 4)) return 'A senha não pode ser o seu nome de usuário';
  if (/^(.)\1+$/.test(n)) return 'A senha não pode ser um caractere repetido';
  if (COMMON.has(n)) return 'Essa senha é muito usada e fácil de adivinhar. Escolha outra';
  // sequência simples (12345678, abcdefgh, 87654321)
  const seq = (s) => [...s].every((c, i) => i === 0 || Math.abs(s.charCodeAt(i) - s.charCodeAt(i - 1)) === 1 && s.charCodeAt(i) - s.charCodeAt(i - 1) === s.charCodeAt(1) - s.charCodeAt(0));
  if (seq(n)) return 'A senha não pode ser uma sequência (como 12345678 ou abcdefgh)';
  return null;
}

// ---- tentativas de login erradas ----
const ACCT_FREE = 5, ACCT_BASE = 30e3, ACCT_MAX = 15 * 60e3, ACCT_WINDOW = 60 * 60e3;
const IP_MAX = 30, IP_WINDOW = 15 * 60e3, IP_LOCK = 15 * 60e3;
const acct = new Map(); // nome (minúsculo) -> { n, last, until }
const ipf = new Map(); // ip -> { at: [tempos], until }
const fmtWait = (ms) => ms >= 60e3 ? `${Math.ceil(ms / 60e3)} min` : `${Math.ceil(ms / 1e3)} s`;
// antes de conferir a senha: devolve a mensagem de espera ou null
export function loginBlocked(ip, username) {
  const now = Date.now(), a = acct.get(norm(username)), i = ipf.get(ip);
  if (i?.until > now) return `Muitas tentativas erradas daqui. Tente de novo em ${fmtWait(i.until - now)}.`;
  if (a?.until > now) return `Muitas tentativas erradas nesta conta. Tente de novo em ${fmtWait(a.until - now)}.`;
  return null;
}
export function loginFailed(ip, username) {
  const now = Date.now(), k = norm(username);
  let a = acct.get(k); if (!a || now - a.last > ACCT_WINDOW) a = { n: 0, last: 0, until: 0 };
  a.n++; a.last = now; if (a.n >= ACCT_FREE) a.until = now + Math.min(ACCT_MAX, ACCT_BASE * 2 ** (a.n - ACCT_FREE));
  acct.set(k, a);
  const i = ipf.get(ip) || { at: [], until: 0 }; i.at = i.at.filter(t => now - t < IP_WINDOW); i.at.push(now);
  if (i.at.length >= IP_MAX) { i.until = now + IP_LOCK; i.at = []; }
  ipf.set(ip, i);
}
export function loginOk(username) { acct.delete(norm(username)); }
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of acct) if (now - a.last > ACCT_WINDOW && a.until < now) acct.delete(k);
  for (const [k, i] of ipf) if (i.until < now && !i.at.some(t => now - t < IP_WINDOW)) ipf.delete(k);
}, 600e3).unref();
export const _loginState = { acct, ipf }; // para os testes

// ---- sessões ----
export function initSessions({ db, all, get, run, onRevoke }) {
  // migração única: tokens que estavam guardados como texto puro viram hash (os aparelhos continuam logados)
  if (!get("SELECT 1 x FROM meta WHERE k='sessions-hash-1'")) {
    const rows = all('SELECT token FROM sessions');
    db.exec('BEGIN');
    try {
      const up = db.prepare('UPDATE sessions SET token=? WHERE token=?');
      for (const r of rows) up.run(hashToken(r.token), r.token);
      db.prepare('INSERT INTO meta VALUES(?,?)').run('sessions-hash-1', String(Date.now()));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (rows.length) console.log(`  Sessões: ${rows.length} token(s) passaram a ser guardados com hash`);
  }
  run('UPDATE sessions SET last_seen=created_at WHERE last_seen IS NULL');

  const seen = new Map(); // hash -> último registro de uso gravado (grava no máximo a cada 10 min)
  const create = (uid, agent) => {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
    run('INSERT INTO sessions(token,user_id,created_at,agent,last_seen) VALUES(?,?,?,?,?)', hashToken(token), uid, now, agent || '', now);
    return token;
  };
  const expired = (s, now = Date.now()) => now - (s.last_seen || s.created_at || 0) > IDLE_MS || now - (s.created_at || 0) > MAX_MS;
  // token do app -> { user_id, hash } ou null (expirada = apagada na hora)
  const lookup = (token) => {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const h = hashToken(token), s = get('SELECT user_id, created_at, last_seen FROM sessions WHERE token=?', h);
    if (!s) return null;
    const now = Date.now();
    if (expired(s, now)) { run('DELETE FROM sessions WHERE token=?', h); onRevoke?.(s.user_id, (x) => x === h); return null; }
    if (now - (seen.get(h) || s.last_seen || 0) > 10 * 60e3) { seen.set(h, now); run('UPDATE sessions SET last_seen=? WHERE token=?', now, h); }
    return { user_id: s.user_id, hash: h };
  };
  // encerra sessões da pessoa (todas, ou todas menos a keep) e fecha as conexões abertas delas
  const revoke = (uid, keepHash = null) => {
    const n = keepHash ? run('DELETE FROM sessions WHERE user_id=? AND token<>?', uid, keepHash).changes : run('DELETE FROM sessions WHERE user_id=?', uid).changes;
    onRevoke?.(uid, (h) => h !== keepHash);
    return n;
  };
  const sweep = () => {
    const now = Date.now(), gone = all('SELECT token, user_id FROM sessions WHERE COALESCE(last_seen, created_at, 0) < ? OR COALESCE(created_at, 0) < ?', now - IDLE_MS, now - MAX_MS);
    for (const s of gone) { run('DELETE FROM sessions WHERE token=?', s.token); seen.delete(s.token); onRevoke?.(s.user_id, (h) => h === s.token); }
    if (gone.length) console.log(`  Sessões: ${gone.length} expirada(s) encerrada(s)`);
    if (seen.size > 50000) seen.clear();
  };
  sweep(); setInterval(sweep, 3600e3).unref();
  return { create, lookup, revoke, sweep, expired };
}
