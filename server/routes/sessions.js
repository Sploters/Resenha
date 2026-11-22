// "Desde a última vez" (faixa no topo do "Ativo agora") e controles da memória do grupo (server/sessions.js).
//   GET    /api/activity/since          -> { since, away_ms, items: [session | event | clip], users }
//   POST   /api/activity/seen           -> { seen_at }  "vi até agora" (vale entre aparelhos)
//   DELETE /api/voice-sessions/:id/me   -> {}  tira a própria participação
//   DELETE /api/voice-sessions/:id      -> {}  apaga a sessão (quem tem Gerenciar servidor)
// Quem vê o quê: só sessões ENCERRADAS depois de `since` (no máximo 7 dias atrás), de servidores de que a pessoa é membro,
// de salas que ela pode ver (se a sala ainda existe) e sem ela entre os participantes. Participante só aparece pelo nome
// se quem lê pode ver a presença dele (privacy.presenceVisible), se ele não está invisível agora e se ainda é membro do
// servidor; os outros viram um número (hidden: "+1 pessoa"). Jogos do resumo já vêm sem nomes (server/sessions.js).
const DEFAULT_AWAY = 3 * 864e5, MAX_BACK = 7 * 864e5, MAX_ITEMS = 6;

export function mountVoiceSessions(app, d) {
  const { auth, wrap, bad, all, get, run, can, P, userPub, getUser, privacy, canAccessChannel, voiceSessions } = d; // d.db: tabelas da Noite
  const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

  function sinceFor(viewer) {
    const t = Date.now(), seen = get('SELECT seen_at FROM memory_seen WHERE user_id=?', viewer)?.seen_at;
    // sem "vi até agora" ainda: no máximo 3 dias, mas nunca antes de a conta existir (conta nova não "saiu há 3 dias")
    const since = seen ?? Math.max(t - DEFAULT_AWAY, get('SELECT created_at FROM users WHERE id=?', viewer)?.created_at || 0), from = Math.max(since, t - MAX_BACK);
    const guildName = new Map(all('SELECT g.id, g.name FROM guilds g JOIN members m ON m.guild_id=g.id WHERE m.user_id=?', viewer).map(g => [g.id, g.name]));
    const cited = new Set(), items = [];
    const visible = (uid) => uid !== viewer && privacy.presenceVisible(viewer, uid) && getUser(uid)?.status !== 'invisible';
    // ---- sessões ----
    const rows = all(`SELECT s.* FROM voice_sessions s JOIN members m ON m.guild_id=s.guild_id AND m.user_id=?
      WHERE s.ended_at>? AND NOT EXISTS (SELECT 1 FROM voice_session_members x WHERE x.session_id=s.id AND x.user_id=?)
      ORDER BY s.ended_at DESC LIMIT 20`, viewer, from, viewer);
    for (const s of rows) {
      if (items.length >= MAX_ITEMS) break;
      const ch = get('SELECT * FROM channels WHERE id=?', s.channel_id);
      if (ch && !canAccessChannel(viewer, ch)) continue;
      const ms = all(`SELECT vm.user_id, vm.secs, (SELECT 1 FROM members m WHERE m.guild_id=? AND m.user_id=vm.user_id) inguild
        FROM voice_session_members vm WHERE vm.session_id=? ORDER BY vm.secs DESC`, s.guild_id, s.id);
      if (!ms.length) continue; // todo mundo desligou "Guardar minhas sessões": nada a contar
      const members = ms.filter(m => m.inguild && visible(m.user_id)).map(m => m.user_id);
      members.forEach(u => cited.add(u));
      const sum = parse(s.summary);
      items.push({ type: 'session', id: s.id, guild_id: s.guild_id, guild_name: guildName.get(s.guild_id) || '', channel_id: s.channel_id,
        channel_name: ch?.name || s.channel_name || '', channel_exists: !!ch, started_at: s.started_at, ended_at: s.ended_at,
        secs: Math.round((s.ended_at - s.started_at) / 1000), peak: s.peak, members, hidden: ms.length - members.length,
        games: (sum.games || []).map(g => ({ title: g.title, game_id: g.game_id, platform: g.platform, mins: g.mins, people: g.people })),
        clips: sum.clips || 0, watch: sum.watch || 0, music: sum.music || 0, event_id: s.event_id || null, intent_id: s.intent_id || null });
    }
    // ---- eventos marcados (criados depois de since, ainda por vir, não cancelados; os próprios não) ----
    const evs = (() => { try {
      return all(`SELECT e.* FROM events e JOIN members m ON m.guild_id=e.guild_id AND m.user_id=? WHERE e.created_at>? AND e.starts_at>? AND e.cancelled_at IS NULL
        AND e.author_id<>? ORDER BY e.starts_at LIMIT 3`, viewer, from, t, viewer);
    } catch { return []; } })();
    for (const e of evs) { cited.add(e.author_id); items.push({ type: 'event', id: e.id, guild_id: e.guild_id, guild_name: guildName.get(e.guild_id) || '', title: e.title, starts_at: e.starts_at, created_at: e.created_at, game: e.game || '', channel_id: e.channel_id || null, author_id: e.author_id }); }
    // ---- clipes mais vistos (de outras pessoas, nas salas que a pessoa vê) ----
    const clips = all(`SELECT c.*, (SELECT COUNT(*) FROM clip_views v WHERE v.clip_id=c.id AND v.user_id<>c.author_id) views FROM clips c
      JOIN members m ON m.guild_id=c.guild_id AND m.user_id=? WHERE c.created_at>? AND c.author_id<>? ORDER BY views DESC, c.created_at DESC LIMIT 6`, viewer, from, viewer)
      .filter(c => canAccessChannel(viewer, get('SELECT * FROM channels WHERE id=?', c.channel_id))).slice(0, 2);
    for (const c of clips) { cited.add(c.author_id); items.push({ type: 'clip', id: c.id, guild_id: c.guild_id, channel_id: c.channel_id, author_id: c.author_id, title: c.title, url: c.url, secs: c.secs, created_at: c.created_at, views: c.views }); }
    // a sua noite mais recente (sessão em que você esteve) entra no topo: "A Noite de sexta está pronta"
    const mine = get(`SELECT s.id, s.ended_at FROM voice_sessions s JOIN voice_session_members x ON x.session_id=s.id AND x.user_id=?
      WHERE s.ended_at>? ORDER BY s.ended_at DESC LIMIT 1`, viewer, from);
    if (mine) { const r = nightRow(viewer, mine.id); if (r) { const nb = nightBase(viewer, r.s, r.ch); nb.members.forEach(m => cited.add(m.id)); items.unshift({ type: 'night', ...nb, members: nb.members.map(m => m.id) }); } }
    const out = items.slice(0, MAX_ITEMS);
    const ids = new Set(); for (const it of out) { for (const u of it.members || []) ids.add(u); if (it.author_id) ids.add(it.author_id); }
    return { since, away_ms: t - since, items: out, users: [...ids].map(userPub).filter(Boolean) };
  }

  app.get('/api/activity/since', auth, wrap((req, res) => res.set('Cache-Control', 'no-store').json(sinceFor(req.uid))));
  app.post('/api/activity/seen', auth, wrap((req, res) => {
    const t = Date.now();
    run('INSERT INTO memory_seen(user_id,seen_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET seen_at=excluded.seen_at', req.uid, t);
    res.json({ seen_at: t });
  }));
  // as sessões em que a pessoa entrou (Configurações -> Privacidade), para ela poder tirar a própria participação
  app.get('/api/voice-sessions/mine', auth, wrap((req, res) => {
    res.set('Cache-Control', 'no-store').json(all(`SELECT s.id, s.channel_name, s.started_at, s.ended_at, g.name guild_name, vm.secs
      FROM voice_session_members vm JOIN voice_sessions s ON s.id=vm.session_id LEFT JOIN guilds g ON g.id=s.guild_id
      WHERE vm.user_id=? AND s.ended_at IS NOT NULL ORDER BY s.ended_at DESC LIMIT 50`, req.uid));
  }));
  app.delete('/api/voice-sessions/:id/me', auth, wrap((req, res) => {
    if (!voiceSessions.removeMember(String(req.params.id), req.uid)) return bad(res, 'Sessão não encontrada', 404);
    res.json({});
  }));
  app.delete('/api/voice-sessions/:id', auth, wrap((req, res) => {
    const s = get('SELECT id, guild_id FROM voice_sessions WHERE id=?', String(req.params.id));
    if (!s || !get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', s.guild_id, req.uid)) return bad(res, 'Sessão não encontrada', 404);
    if (!can(s.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    voiceSessions.removeSession(s.id);
    res.json({});
  }));
  // ---------- A Noite: cada sessão vira uma página (montada na leitura, a partir do que já é guardado) ----------
  //   GET  /api/nights?guild_id=&before=   -> [noite resumida]     "Nossas noites" do servidor (com as suas)
  //   GET  /api/nights/:id                 -> noite com linha do tempo, clipes, pérolas, conquistas e GG
  //   POST /api/nights/:id/gg              -> { gg, mine }         dar/tirar GG
  //   POST /api/messages/:id/pearl         -> { pearl }            guardar/tirar pérola (mensagem de canal de servidor)
  //   GET  /api/guilds/:id/pearls          -> [pérola]             mural de pérolas do servidor
  // Mesmas regras de quem aparece pelo nome que o "Desde a última vez"; quem tirou a participação não aparece.
  d.db.exec(`CREATE TABLE IF NOT EXISTS night_gg(session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL, PRIMARY KEY(session_id, user_id));
    CREATE TABLE IF NOT EXISTS pearls(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL, by_id TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS pearls_guild ON pearls(guild_id, at DESC);`);
  const isMember = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const seesName = (viewer, uid) => uid === viewer || (privacy.presenceVisible(viewer, uid) && getUser(uid)?.status !== 'invisible');
  const dur = (secs) => { const m = Math.max(1, Math.round(secs / 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
  // título por regras (sem IA): "4h12 de CS2 e Valheim de saideira", "2h de resenha na Geral"
  const nightTitle = (s, games) => {
    const secs = Math.round((s.ended_at - s.started_at) / 1000), g = games.filter(x => x.title);
    if (!g.length) return `${dur(secs)} de resenha na ${s.channel_name || 'sala'}`;
    return `${dur(secs)} de ${g[0].title}` + (g[1] ? ` e ${g[1].title} de saideira` : '');
  };
  // a noite que este leitor pode ver (ou null)
  function nightRow(viewer, id) {
    const s = get('SELECT * FROM voice_sessions WHERE id=? AND ended_at IS NOT NULL', id);
    if (!s || !isMember(s.guild_id, viewer)) return null;
    const ch = get('SELECT * FROM channels WHERE id=?', s.channel_id);
    if (ch && !canAccessChannel(viewer, ch)) return null;
    return { s, ch };
  }
  function nightBase(viewer, s, ch) {
    const ms = all('SELECT user_id, secs, first_at, last_at FROM voice_session_members WHERE session_id=? ORDER BY secs DESC', s.id);
    const shown = ms.filter(m => isMember(s.guild_id, m.user_id) && seesName(viewer, m.user_id));
    const sum = parse(s.summary), games = (sum.games || []).map(g => ({ title: g.title, game_id: g.game_id, platform: g.platform, mins: g.mins, people: g.people }));
    const gg = all('SELECT user_id FROM night_gg WHERE session_id=?', s.id).map(r => r.user_id);
    return { id: s.id, guild_id: s.guild_id, channel_id: s.channel_id, channel_name: ch?.name || s.channel_name || '', channel_exists: !!ch,
      started_at: s.started_at, ended_at: s.ended_at, secs: Math.round((s.ended_at - s.started_at) / 1000), peak: s.peak,
      title: nightTitle({ ...s, channel_name: ch?.name || s.channel_name }, games), members: shown.map(m => ({ id: m.user_id, secs: m.secs, first_at: m.first_at, last_at: m.last_at })),
      hidden: Math.max(0, Math.max(ms.length, s.peak || 0) - shown.length), was_here: ms.some(m => m.user_id === viewer), games,
      clips: sum.clips || 0, watch: sum.watch || 0, gg: gg.length, my_gg: gg.includes(viewer), event_id: s.event_id || null };
  }
  const pearlObj = (r) => ({ id: r.message_id, channel_id: r.channel_id, guild_id: r.guild_id, by_id: r.by_id, at: r.at, author_id: r.author_id, content: r.content, created_at: r.created_at });
  const usersOf = (ids) => [...new Set(ids.filter(Boolean))].map(userPub).filter(Boolean);

  app.get('/api/nights', auth, wrap((req, res) => {
    const gid = String(req.query.guild_id || ''), before = +req.query.before || Date.now() + 1;
    if (!gid || !isMember(gid, req.uid)) return bad(res, 'Servidor não encontrado', 404);
    const out = [];
    for (const s of all('SELECT * FROM voice_sessions WHERE guild_id=? AND ended_at IS NOT NULL AND ended_at<? ORDER BY ended_at DESC LIMIT 60', gid, before)) {
      const ch = get('SELECT * FROM channels WHERE id=?', s.channel_id);
      if (ch && !canAccessChannel(req.uid, ch)) continue;
      out.push(nightBase(req.uid, s, ch)); if (out.length >= 30) break;
    }
    res.set('Cache-Control', 'no-store').json({ nights: out, users: usersOf(out.flatMap(n => n.members.map(m => m.id))) });
  }));
  app.get('/api/nights/:id', auth, wrap((req, res) => {
    const r = nightRow(req.uid, String(req.params.id)); if (!r) return bad(res, 'Noite não encontrada', 404);
    const { s, ch } = r, n = nightBase(req.uid, s, ch), from = s.started_at, to = s.ended_at, names = new Set(n.members.map(m => m.id));
    // clipes da sala na janela (os que a pessoa pode ver: a sala é a mesma)
    n.clip_list = all('SELECT id, title, url, secs, author_id, streamer_id, created_at FROM clips WHERE channel_id=? AND created_at>=? AND created_at<=? ORDER BY created_at', s.channel_id, from, to + 5 * 60e3)
      .map(c => ({ ...c, likes: get('SELECT COUNT(*) n FROM clip_likes WHERE clip_id=?', c.id)?.n || 0 }));
    // pérolas: mensagens do servidor escritas durante a noite, em canais que a pessoa vê
    n.pearls = all(`SELECT p.*, m.author_id, m.content, m.created_at FROM pearls p JOIN messages m ON m.id=p.message_id
      WHERE p.guild_id=? AND m.created_at>=? AND m.created_at<=? ORDER BY m.created_at`, s.guild_id, from, to)
      .filter(p => canAccessChannel(req.uid, get('SELECT * FROM channels WHERE id=?', p.channel_id))).map(pearlObj);
    // conquistas destravadas por quem está na noite pelo nome (respeitando a regra de jogos: só de quem aparece)
    n.achievements = names.size ? all(`SELECT u.user_id, u.appid, u.unlocked_at, g.title FROM ach_unlocks u LEFT JOIN ach_games g ON g.user_id=u.user_id AND g.platform=u.platform AND g.appid=u.appid
      WHERE u.user_id IN (${[...names].map(() => '?').join(',')}) AND u.unlocked_at>=? AND u.unlocked_at<=? ORDER BY u.unlocked_at LIMIT 30`, ...names, from, to) : [];
    // linha do tempo: chegadas, clipes, pérolas e conquistas em ordem
    const tl = [];
    for (const m of n.members) tl.push({ t: Math.max(from, m.first_at), kind: 'join', user_id: m.id });
    for (const c of n.clip_list) tl.push({ t: c.created_at, kind: 'clip', clip_id: c.id, user_id: c.author_id, streamer_id: c.streamer_id, title: c.title });
    for (const p of n.pearls) tl.push({ t: p.created_at, kind: 'pearl', message_id: p.id, user_id: p.author_id, content: String(p.content || '').slice(0, 200) });
    for (const a of n.achievements) tl.push({ t: a.unlocked_at, kind: 'ach', user_id: a.user_id, title: a.title || '' });
    n.timeline = tl.sort((a, b) => a.t - b.t);
    n.top_clip = [...n.clip_list].sort((a, b) => b.likes - a.likes)[0]?.id || null;
    res.set('Cache-Control', 'no-store').json({ night: n, users: usersOf([...names, ...n.clip_list.flatMap(c => [c.author_id, c.streamer_id]), ...n.pearls.flatMap(p => [p.author_id, p.by_id])]) });
  }));
  app.post('/api/nights/:id/gg', auth, wrap((req, res) => {
    const r = nightRow(req.uid, String(req.params.id)); if (!r) return bad(res, 'Noite não encontrada', 404);
    const had = get('SELECT 1 x FROM night_gg WHERE session_id=? AND user_id=?', r.s.id, req.uid);
    if (had) run('DELETE FROM night_gg WHERE session_id=? AND user_id=?', r.s.id, req.uid);
    else run('INSERT INTO night_gg(session_id,user_id,at) VALUES(?,?,?)', r.s.id, req.uid, Date.now());
    res.json({ gg: get('SELECT COUNT(*) n FROM night_gg WHERE session_id=?', r.s.id).n, mine: !had });
  }));
  app.post('/api/messages/:id/pearl', auth, wrap((req, res) => {
    const m = get('SELECT * FROM messages WHERE id=?', String(req.params.id)), ch = m && get('SELECT * FROM channels WHERE id=?', m.channel_id);
    if (!m || !ch?.guild_id || !canAccessChannel(req.uid, ch) || !isMember(ch.guild_id, req.uid)) return bad(res, 'Mensagem não encontrada', 404);
    const had = get('SELECT by_id FROM pearls WHERE message_id=?', m.id);
    if (had) { // tira: quem guardou, o autor da mensagem ou quem gerencia mensagens
      if (had.by_id !== req.uid && m.author_id !== req.uid && !can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)) return bad(res, 'Só quem guardou ou o autor tira a pérola', 403);
      run('DELETE FROM pearls WHERE message_id=?', m.id); return res.json({ pearl: false });
    }
    if (!String(m.content || '').trim()) return bad(res, 'Só mensagens com texto viram pérola');
    run('INSERT INTO pearls(message_id,guild_id,channel_id,by_id,at) VALUES(?,?,?,?,?)', m.id, ch.guild_id, ch.id, req.uid, Date.now());
    res.json({ pearl: true });
  }));
  app.get('/api/guilds/:id/pearls', auth, wrap((req, res) => {
    const gid = String(req.params.id); if (!isMember(gid, req.uid)) return bad(res, 'Servidor não encontrado', 404);
    const list = all(`SELECT p.*, m.author_id, m.content, m.created_at FROM pearls p JOIN messages m ON m.id=p.message_id WHERE p.guild_id=? ORDER BY p.at DESC LIMIT 200`, gid)
      .filter(p => canAccessChannel(req.uid, get('SELECT * FROM channels WHERE id=?', p.channel_id))).map(pearlObj);
    res.set('Cache-Control', 'no-store').json({ pearls: list, users: usersOf(list.flatMap(p => [p.author_id, p.by_id])) });
  }));
  return { sinceFor };
}
