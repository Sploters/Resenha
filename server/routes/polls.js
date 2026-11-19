// Enquetes: criar (vira uma mensagem 📊), votar e encerrar; o prazo avisa todo mundo na hora em que acaba.
// O cartão da enquete (pollObj) fica no index.js porque faz parte do messageObj.
export function mountPolls(app, d) {
  const { auth, wrap, bad, clean, all, get, run, newId, P, can, dispatch, channelAudience, channelFor, canAccessChannel, messageObj, pollObj } = d;
  // ---------- Enquetes ----------
  const POLL_DURATIONS = new Set([0, 1, 4, 8, 24, 72, 168]); // horas (0 = sem prazo)
  const pollTimers = new Map();
  const pollUpdate = (p) => { const m = get('SELECT * FROM messages WHERE id=?', p.message_id), ch = m && get('SELECT * FROM channels WHERE id=?', m.channel_id); if (ch) dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(m), guild_id: ch.guild_id }); };
  // avisa todo mundo na hora em que o prazo acaba (o cartão passa a mostrar o resultado)
  function schedulePollEnd(p) {
    clearTimeout(pollTimers.get(p.id));
    if (!p.ends_at || p.closed_at) return;
    const ms = p.ends_at - Date.now(); if (ms > 7 * 86400e3 + 60e3) return;
    pollTimers.set(p.id, setTimeout(() => { pollTimers.delete(p.id); const cur = get('SELECT * FROM polls WHERE id=?', p.id); if (cur && !cur.closed_at) pollUpdate(cur); }, Math.max(0, ms) + 250));
  }
  for (const p of all('SELECT * FROM polls WHERE ends_at IS NOT NULL AND closed_at IS NULL AND ends_at > ?', Date.now())) schedulePollEnd(p);
  app.post('/api/channels/:id/polls', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    if (ch.type === 1) { const other = all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, req.uid)[0]; if (other && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', other.user_id, req.uid)) return bad(res, 'Você não pode enviar mensagens para este usuário', 403); }
    const question = clean(req.body.question, 300);
    const texts = (Array.isArray(req.body.options) ? req.body.options : []).map(o => clean(o, 80)).filter(Boolean);
    if (!question) return bad(res, 'Escreva a pergunta');
    if (texts.length < 2) return bad(res, 'A enquete precisa de pelo menos 2 opções');
    if (texts.length > 10) return bad(res, 'No máximo 10 opções');
    if (new Set(texts.map(t => t.toLowerCase())).size !== texts.length) return bad(res, 'Há opções repetidas');
    const hours = Number(req.body.duration_h || 0); if (!POLL_DURATIONS.has(hours) && !(process.env.POLL_TEST_FAST === '1' && hours > 0 && hours < 0.01)) return bad(res, 'Prazo inválido'); // POLL_TEST_FAST: prazo de segundos, só nos testes
    const now = Date.now(), mid = newId(), pid = newId();
    run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', mid, ch.id, req.uid, '📊 ' + question, now);
    run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, mid);
    run('INSERT INTO polls(id,message_id,channel_id,author_id,question,options,multi,ends_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      pid, mid, ch.id, req.uid, question, JSON.stringify(texts.map((text, i) => ({ id: String(i + 1), text }))), req.body.multi ? 1 : 0, hours ? now + hours * 3600e3 : null, now);
    schedulePollEnd(get('SELECT * FROM polls WHERE id=?', pid));
    const msg = { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] };
    dispatch(channelAudience(ch), 'MESSAGE_CREATE', msg);
    res.json(msg);
  }));
  const pollFor = (req, res) => {
    const p = get('SELECT * FROM polls WHERE id=?', req.params.id), ch = p && get('SELECT * FROM channels WHERE id=?', p.channel_id);
    if (!p || !canAccessChannel(req.uid, ch)) { bad(res, 'Enquete não encontrada', 404); return null; }
    return { p, ch };
  };
  // votar: substitui os votos da pessoa (lista vazia = tirar o voto)
  app.put('/api/polls/:id/vote', auth, wrap((req, res) => {
    const f = pollFor(req, res); if (!f) return;
    const { p } = f;
    if (p.closed_at || (p.ends_at && p.ends_at <= Date.now())) return bad(res, 'A enquete já foi encerrada', 409);
    const valid = new Set(JSON.parse(p.options).map(o => o.id));
    const pick = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(String))];
    if (pick.some(o => !valid.has(o))) return bad(res, 'Opção inválida');
    if (!p.multi && pick.length > 1) return bad(res, 'Esta enquete aceita só uma resposta');
    run('DELETE FROM poll_votes WHERE poll_id=? AND user_id=?', p.id, req.uid);
    const now = Date.now(); for (const o of pick) run('INSERT INTO poll_votes VALUES(?,?,?,?)', p.id, req.uid, o, now);
    pollUpdate(p);
    res.json(pollObj(get('SELECT * FROM polls WHERE id=?', p.id)));
  }));
  app.post('/api/polls/:id/close', auth, wrap((req, res) => {
    const f = pollFor(req, res); if (!f) return;
    const { p, ch } = f;
    if (p.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES))) return bad(res, 'Só quem criou (ou um moderador) pode encerrar', 403);
    if (!p.closed_at && !(p.ends_at && p.ends_at <= Date.now())) { run('UPDATE polls SET closed_at=? WHERE id=?', Date.now(), p.id); clearTimeout(pollTimers.get(p.id)); }
    const n = get('SELECT * FROM polls WHERE id=?', p.id); pollUpdate(n);
    res.json(pollObj(n));
  }));
}
