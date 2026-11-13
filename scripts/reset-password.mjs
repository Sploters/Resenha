// Redefinir a senha de alguém (para o administrador do servidor; o Resenha não tem e-mail de recuperação).
//   node scripts/reset-password.mjs <nome de usuário> <senha nova>
//   Docker:  docker exec -it <container> node scripts/reset-password.mjs fulano novaSenha123
// Mesma pasta de dados do servidor (variável DATA_DIR). Encerra as sessões abertas da pessoa: ela entra de novo com a senha nova.
import crypto from 'node:crypto';
import { db } from '../server/db.js';
import { passwordProblem } from '../server/accounts.js';

const [username, pw] = process.argv.slice(2);
if (!username || !pw) { console.log('Uso: node scripts/reset-password.mjs <nome de usuário> <senha nova>'); process.exit(1); }
{ const why = passwordProblem(pw, username); if (why) { console.log(why + '.'); process.exit(1); } }
const u = db.prepare('SELECT id, username FROM users WHERE username=?').get(username);
if (!u) { console.log(`Usuário "${username}" não encontrado.`); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex'), hash = crypto.scryptSync(pw, salt, 64).toString('hex');
db.prepare('UPDATE users SET pass_hash=?, salt=? WHERE id=?').run(hash, salt, u.id);
const n = db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id).changes;
console.log(`Senha de ${u.username} redefinida. ${n} sessão(ões) encerrada(s).`);
