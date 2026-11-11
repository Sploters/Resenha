// Criptografia de ponta a ponta nas conversas diretas (1:1). O servidor só guarda e repassa:
//  - a chave pública de cada pessoa (P-256, ECDH), identificada pelo kid = 16 primeiros bytes do SHA-256 dela (hex);
//  - a chave privada EMBRULHADA no aparelho com uma frase que só a pessoa sabe (PBKDF2 + AES-GCM). Sem a frase o
//    servidor não consegue abrir a chave nem ler as mensagens;
//  - as mensagens como "e2ee:1:<kid de quem enviou>.<kid de quem recebe>:<iv>:<texto cifrado>".
// Toda a cifragem acontece no app (public/e2ee.js). Uma pessoa pode ter várias chaves (trocou de chave): as antigas
// ficam para continuar lendo o histórico; só uma é a ativa, a usada nas mensagens novas.
import crypto from 'node:crypto';

export const E2EE_PREFIX = 'e2ee:1:';
export const E2EE_RE = /^e2ee:1:([0-9a-f]{32})\.([0-9a-f]{32}):([A-Za-z0-9+/=]{16,24}):([A-Za-z0-9+/=]{24,40000})$/;
export const isE2ee = (s) => typeof s === 'string' && s.startsWith(E2EE_PREFIX);
const B64 = /^[A-Za-z0-9+/=]+$/;
export const kidOf = (pubB64) => crypto.createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 32);

// chave privada embrulhada: { v: 1, salt, iter, iv, ct } (base64) — só formato; o conteúdo é opaco para o servidor
function cleanWrapped(w) {
  if (!w || typeof w !== 'object') return null;
  const o = { v: 1, salt: String(w.salt || ''), iter: Math.floor(+w.iter || 0), iv: String(w.iv || ''), ct: String(w.ct || '') };
  if (!B64.test(o.salt) || o.salt.length > 64 || !B64.test(o.iv) || o.iv.length > 32 || !B64.test(o.ct) || o.ct.length > 2000) return null;
  if (o.iter < 100000 || o.iter > 5000000) return null;
  return o;
}
// chave pública P-256 "raw" (65 bytes, começa com 0x04) em base64
function cleanPub(p) {
  const s = String(p || ''); if (!B64.test(s) || s.length > 120) return null;
  const b = Buffer.from(s, 'base64'); return b.length === 65 && b[0] === 4 ? s : null;
}

export function mountE2ee(app, d) {
  const { auth, wrap, bad, all, get, run, db, dispatch } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS e2ee_keys(kid TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pub TEXT NOT NULL, wrapped TEXT NOT NULL, active INTEGER DEFAULT 1, created_at INTEGER);
  CREATE INDEX IF NOT EXISTS idx_e2ee_user ON e2ee_keys(user_id, created_at);`);

  const pubOut = (k) => k && { kid: k.kid, user_id: k.user_id, pub: k.pub, created_at: k.created_at, active: !!k.active };
  const activeOf = (uid) => get('SELECT * FROM e2ee_keys WHERE user_id=? AND active=1 ORDER BY created_at DESC LIMIT 1', uid);
  // quem precisa saber que a chave de alguém mudou: as pessoas com quem ela tem conversa direta
  const dmPeers = (uid) => all('SELECT DISTINCT p2.user_id id FROM dm_participants p1 JOIN dm_participants p2 ON p1.channel_id=p2.channel_id WHERE p1.user_id=? AND p2.user_id<>?', uid, uid).map(r => r.id);
  const announce = (uid) => { const k = activeOf(uid); dispatch([uid, ...dmPeers(uid)], 'E2EE_KEY', { user_id: uid, active: pubOut(k) || null }); };

  // minhas chaves (com as privadas embrulhadas: o app abre com a frase)
  app.get('/api/e2ee/me', auth, wrap((req, res) => {
    res.json({ keys: all('SELECT * FROM e2ee_keys WHERE user_id=? ORDER BY created_at', req.uid).map(k => ({ ...pubOut(k), wrapped: JSON.parse(k.wrapped) })) });
  }));
  // chave nova (ativar pela primeira vez ou trocar de chave): vira a ativa; as antigas continuam para ler o histórico
  app.post('/api/e2ee/me', auth, wrap((req, res) => {
    const pub = cleanPub(req.body.pub), wrapped = cleanWrapped(req.body.wrapped);
    if (!pub || !wrapped) return bad(res, 'Chave inválida');
    const kid = kidOf(pub);
    if (req.body.kid && req.body.kid !== kid) return bad(res, 'Identificador da chave não confere');
    if (get('SELECT 1 x FROM e2ee_keys WHERE kid=?', kid)) return bad(res, 'Chave já cadastrada', 409);
    if ((get('SELECT COUNT(*) n FROM e2ee_keys WHERE user_id=?', req.uid)?.n || 0) >= 20) return bad(res, 'Chaves demais: apague as antigas antes');
    run('UPDATE e2ee_keys SET active=0 WHERE user_id=?', req.uid);
    run('INSERT INTO e2ee_keys(kid,user_id,pub,wrapped,active,created_at) VALUES(?,?,?,?,1,?)', kid, req.uid, pub, JSON.stringify(wrapped), Date.now());
    announce(req.uid);
    res.json({ kid });
  }));
  // trocar a frase: o app manda as mesmas chaves embrulhadas com a frase nova (todas de uma vez)
  app.put('/api/e2ee/me/wrap', auth, wrap((req, res) => {
    const list = Array.isArray(req.body.keys) ? req.body.keys : [];
    const mine = new Set(all('SELECT kid FROM e2ee_keys WHERE user_id=?', req.uid).map(k => k.kid));
    const ok = list.map(k => ({ kid: String(k.kid || ''), wrapped: cleanWrapped(k.wrapped) }));
    if (!ok.length || ok.length !== mine.size || ok.some(k => !mine.has(k.kid) || !k.wrapped)) return bad(res, 'Mande todas as suas chaves embrulhadas com a frase nova');
    db.exec('BEGIN'); try { for (const k of ok) run('UPDATE e2ee_keys SET wrapped=? WHERE kid=? AND user_id=?', JSON.stringify(k.wrapped), k.kid, req.uid); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({});
  }));
  // pausar (as pessoas voltam a te mandar sem criptografia) ou retomar com a chave mais nova
  app.put('/api/e2ee/me/active', auth, wrap((req, res) => {
    if (req.body.on) {
      const last = get('SELECT kid FROM e2ee_keys WHERE user_id=? ORDER BY created_at DESC LIMIT 1', req.uid);
      if (!last) return bad(res, 'Ative a criptografia primeiro');
      run('UPDATE e2ee_keys SET active=(kid=?) WHERE user_id=?', last.kid, req.uid);
    } else run('UPDATE e2ee_keys SET active=0 WHERE user_id=?', req.uid);
    announce(req.uid);
    res.json({});
  }));
  // esqueceu a frase: apaga todas as chaves (as mensagens protegidas antigas ficam ilegíveis para sempre)
  app.delete('/api/e2ee/me', auth, wrap((req, res) => {
    run('DELETE FROM e2ee_keys WHERE user_id=?', req.uid);
    announce(req.uid);
    res.json({});
  }));
  // chave pública de alguém (a ativa) e uma chave pelo kid (mensagens antigas)
  app.get('/api/e2ee/users/:uid', auth, wrap((req, res) => res.json({ active: pubOut(activeOf(String(req.params.uid))) || null })));
  app.get('/api/e2ee/keys/:kid', auth, wrap((req, res) => {
    const k = get('SELECT * FROM e2ee_keys WHERE kid=?', String(req.params.kid));
    if (!k) return bad(res, 'Chave não encontrada', 404);
    res.json(pubOut(k));
  }));
}

// texto de mensagem vindo do app: limite de 4000 caracteres para texto comum; protegida só em conversa direta (1:1),
// com formato válido, e cabe o texto cifrado de 4000 caracteres (até ~16 KB em base64)
export function messageContent(raw, ch) {
  const s = String(raw ?? '');
  if (!isE2ee(s)) return { content: s.slice(0, 4000) };
  if (ch.type !== 1) return { error: 'Mensagens protegidas só existem em conversas diretas' };
  if (s.length > 24000 || !E2EE_RE.test(s)) return { error: 'Mensagem protegida inválida' };
  return { content: s, e2ee: true };
}
