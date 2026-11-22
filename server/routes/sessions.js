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
  const { auth, wrap, bad, all, get, run, can, P, userPub, getUser, privacy, canAccessChannel, voiceSessions } = d;
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
  return { sinceFor };
}
