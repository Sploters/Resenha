// Conversas diretas (abrir/criar) e o relatório de problema, que vai por DM ao administrador da instalação.
// Devolve o postDm, usado pelos convites para a chamada e por Procurar jogadores.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pruneHits } from '../limits.js';

export function mountDms(app, d) {
  const { auth, wrap, bad, clean, get, run, newId, dispatch, channelAudience, dmChannelObj, messageObj, getUser, userPub, reportAdmin, UPLOAD_DIR, DATA_DIR } = d;
  // DMs & relationships
  // DM entre duas pessoas (cria se não existir) e avisa as duas
  function ensureDm(a, b) {
    let ch = get(`SELECT c.* FROM dm_participants pa JOIN dm_participants pb ON pb.channel_id=pa.channel_id AND pb.user_id=? JOIN channels c ON c.id=pa.channel_id AND c.type=1 WHERE pa.user_id=? LIMIT 1`, b, a); // pelas DMs de uma das pessoas (índice), sem varrer todos os canais
    if (!ch) {
      const id = newId();
      run('INSERT INTO channels(id,type,name,created_at) VALUES(?,1,NULL,?)', id, Date.now());
      run('INSERT INTO dm_participants VALUES(?,?)', id, a); run('INSERT INTO dm_participants VALUES(?,?)', id, b);
      ch = get('SELECT * FROM channels WHERE id=?', id);
    }
    const o = dmChannelObj(ch);
    dispatch([a, b], 'DM_CREATE', o);
    return o;
  }
  // mensagem simples numa DM, em nome de quem envia (usada pelo convite para a chamada)
  function postDm(from, to, content) {
    const dm = ensureDm(from, to), ch = get('SELECT * FROM channels WHERE id=?', dm.id), id = newId();
    run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', id, ch.id, from, content, Date.now());
    run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', from, ch.id, id);
    dispatch(channelAudience(ch), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', id)), guild_id: null, mentions: [] });
  }
  app.post('/api/dms', auth, wrap((req, res) => {
    const other = String(req.body.user_id);
    if (!getUser(other) || other === req.uid) return bad(res, 'Usuário inválido');
    res.json(ensureDm(req.uid, other));
  }));
  // ---- relatório de problema ("Algo deu errado?"): diagnóstico do app vira um arquivo .json, guardado em <dados>/reports
  // e enviado por DM ao administrador da instalação (LC_ADMIN = nome de usuário; sem isso, a conta mais antiga) ----
  const reportRate = new Map(); pruneHits(reportRate, 3600e3); // uid -> [tempos]
  app.post('/api/reports', auth, wrap((req, res) => {
    const now = Date.now(), hits = (reportRate.get(req.uid) || []).filter(t => now - t < 3600e3);
    if (hits.length >= 6) return bad(res, 'Muitos relatórios seguidos. Tente de novo daqui a pouco.', 429);
    hits.push(now); reportRate.set(req.uid, hits);
    const text = clean(req.body.text, 2000), data = req.body.data && typeof req.body.data === 'object' ? req.body.data : {};
    const u = getUser(req.uid), stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const body = Buffer.from(JSON.stringify({ quando: new Date(now).toISOString(), usuario: { id: req.uid, nome: u.username }, descricao: text, ...data }, null, 2));
    if (body.length > 900 * 1024) return bad(res, 'Relatório grande demais');
    const fname = crypto.randomBytes(12).toString('hex') + '.json', name = `relatorio-${u.username}-${stamp}.json`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), body);
    try { fs.mkdirSync(path.join(DATA_DIR, 'reports'), { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'reports', name), body); } catch { }
    const url = `/files/${fname}/${encodeURIComponent(name)}`, admin = reportAdmin();
    if (!admin || admin.id === req.uid) return res.json({ url, sent_to: null }); // o próprio administrador: só guarda
    const dm = ensureDm(req.uid, admin.id), mid = newId();
    run('INSERT INTO messages(id,channel_id,author_id,content,created_at,attachments) VALUES(?,?,?,?,?,?)', mid, dm.id, req.uid,
      `🐞 **Relatório de problema**${text ? '\n' + text : ''}`, now, JSON.stringify([{ url, name, size: body.length, type: 'application/json' }]));
    dispatch([req.uid, admin.id], 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: null, mentions: [] });
    res.json({ url, sent_to: userPub(admin.id) });
  }));
  return { ensureDm, postDm };
}
