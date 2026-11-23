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
  const { auth, wrap, bad, all, get, run, can, P, userPub, getUser, privacy, canAccessChannel, voiceSessions, activity, discover } = d; // d.db: tabelas da Noite
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
  // ---------- Rewind: resumo da semana, do mês ou do ano (GET /api/guilds/:id/retro?period=week|month|year&offset=0) ----------
  // offset 0 = o período atual, -1 = o anterior... ?year= (sem period) continua valendo: o ano pedido.
  // Semana: de segunda a domingo. Datas no fuso do servidor (o mesmo das noites).
  const PERIODS = new Set(['week', 'month', 'year']);
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function periodRange(period, offset, year) {
    const now = new Date();
    if (period === 'week') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * offset);
      const e = new Date(d); e.setDate(e.getDate() + 7);
      const last = new Date(e - 1), same = d.getMonth() === last.getMonth();
      return { from: d.getTime(), to: e.getTime(), label: same ? `${d.getDate()} a ${last.getDate()} de ${MES[d.getMonth()]}` : `${d.getDate()} de ${MES[d.getMonth()]} a ${last.getDate()} de ${MES[last.getMonth()]}`, year: last.getFullYear() };
    }
    if (period === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { from: d.getTime(), to: e.getTime(), label: `${MES[d.getMonth()][0].toUpperCase() + MES[d.getMonth()].slice(1)} de ${d.getFullYear()}`, year: d.getFullYear() };
    }
    const y = year || now.getFullYear() + offset;
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: String(y), year: y };
  }
  // ---------- Retrospectiva do ano (GET /api/guilds/:id/retro?year=) ----------
  // Calculada na hora a partir do que já é guardado: noites (sessões), mensagens e reações dos canais que a pessoa vê,
  // clipes, pérolas. Só dados do grupo e "o seu cartão" (só você vê). Sem ranking de pessoas; a "dupla do ano" só com
  // quem aparece pelo nome (mesmas regras das noites). Jogos: do resumo das sessões (já sem nomes e sem partidas escondidas).
  app.get('/api/guilds/:id/retro', auth, wrap((req, res) => {
    const gid = String(req.params.id), me = req.uid; if (!isMember(gid, me)) return bad(res, 'Servidor não encontrado', 404);
    const period = PERIODS.has(String(req.query.period)) ? String(req.query.period) : 'year';
    const offset = Math.max(-520, Math.min(0, Math.trunc(+req.query.offset || 0)));
    const askYear = !req.query.period && req.query.year ? Math.min(2100, Math.max(2000, +req.query.year)) : null;
    const range = periodRange(period, offset, askYear), { from, to } = range, year = range.year;
    // voltar mais: até o período em que o servidor foi criado
    const born = get('SELECT created_at FROM guilds WHERE id=?', gid)?.created_at || 0, has_prev = !born || from > born;
    const chans = all('SELECT * FROM channels WHERE guild_id=?', gid).filter(c => canAccessChannel(me, c)), cids = chans.map(c => c.id);
    const inC = cids.length ? `(${cids.map(() => '?').join(',')})` : "('')";
    // noites
    const ss = all('SELECT * FROM voice_sessions WHERE guild_id=? AND ended_at IS NOT NULL AND started_at>=? AND started_at<?', gid, from, to)
      .filter(s => { const ch = chans.find(c => c.id === s.channel_id); return ch || !get('SELECT 1 x FROM channels WHERE id=?', s.channel_id); });
    const nights = ss.map(s => nightBase(me, s, chans.find(c => c.id === s.channel_id)));
    const secsAll = nights.reduce((a, n) => a + n.secs, 0), longest = [...nights].sort((a, b) => b.secs - a.secs)[0] || null;
    const games = new Map(); for (const n of nights) for (const g of n.games) { const k = g.title; const x = games.get(k) || { title: k, mins: 0, nights: 0 }; x.mins += g.mins || 0; x.nights++; games.set(k, x); }
    const topGames = [...games.values()].sort((a, b) => b.mins - a.mins).slice(0, 3);
    const pairs = new Map();
    for (const n of nights) { const ids = n.members.map(m => m.id).sort(); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] + ':' + ids[j]; pairs.set(k, (pairs.get(k) || 0) + 1); } }
    const duo = [...pairs].sort((a, b) => b[1] - a[1])[0];
    const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'], wd = Array(7).fill(0);
    for (const n of nights) wd[new Date(n.started_at).getDay()]++;
    const bestDay = nights.length ? WD[wd.indexOf(Math.max(...wd))] : null;
    // mensagens e reações
    const msgN = get(`SELECT COUNT(*) n FROM messages WHERE channel_id IN ${inC} AND created_at>=? AND created_at<? AND COALESCE(type,0)=0`, ...cids, from, to)?.n || 0;
    const topMsg = get(`SELECT m.id, m.author_id, m.content, m.created_at, COUNT(r.user_id) n FROM messages m JOIN reactions r ON r.message_id=m.id
      WHERE m.channel_id IN ${inC} AND m.created_at>=? AND m.created_at<? AND COALESCE(m.type,0)=0 AND m.content<>'' GROUP BY m.id ORDER BY n DESC, m.created_at LIMIT 1`, ...cids, from, to);
    const topEmoji = get(`SELECT r.emoji, COUNT(*) n FROM reactions r JOIN messages m ON m.id=r.message_id WHERE m.channel_id IN ${inC} AND m.created_at>=? AND m.created_at<? GROUP BY r.emoji ORDER BY n DESC LIMIT 1`, ...cids, from, to);
    // clipes e pérolas
    const clips = all(`SELECT c.id, c.title, c.author_id, c.streamer_id, c.created_at, (SELECT COUNT(*) FROM clip_likes l WHERE l.clip_id=c.id) likes FROM clips c
      WHERE c.channel_id IN ${inC} AND c.created_at>=? AND c.created_at<? ORDER BY likes DESC, c.created_at LIMIT 200`, ...cids, from, to);
    const pearls = all(`SELECT p.*, m.author_id, m.content, m.created_at FROM pearls p JOIN messages m ON m.id=p.message_id
      WHERE p.channel_id IN ${inC} AND m.created_at>=? AND m.created_at<? ORDER BY (SELECT COUNT(*) FROM reactions r WHERE r.message_id=m.id) DESC, p.at LIMIT 50`, ...cids, from, to).map(pearlObj);
    // o seu cartão (só você vê)
    const myNights = nights.filter(n => n.members.some(m => m.id === me));
    const company = new Map(); for (const n of myNights) for (const m of n.members) if (m.id !== me) company.set(m.id, (company.get(m.id) || 0) + 1);
    const buddy = [...company].sort((a, b) => b[1] - a[1])[0];
    const mine = {
      nights: myNights.length, secs: myNights.reduce((a, n) => a + (n.members.find(m => m.id === me)?.secs || 0), 0),
      buddy: buddy ? { id: buddy[0], nights: buddy[1] } : null,
      messages: get(`SELECT COUNT(*) n FROM messages WHERE channel_id IN ${inC} AND author_id=? AND created_at>=? AND created_at<? AND COALESCE(type,0)=0`, ...cids, me, from, to)?.n || 0,
      reactions_got: get(`SELECT COUNT(*) n FROM reactions r JOIN messages m ON m.id=r.message_id WHERE m.channel_id IN ${inC} AND m.author_id=? AND r.user_id<>? AND m.created_at>=? AND m.created_at<?`, ...cids, me, me, from, to)?.n || 0,
      clips: clips.filter(c => c.author_id === me).length, clipped: clips.filter(c => c.streamer_id === me && c.author_id !== me).length,
      pearls: pearls.filter(p => p.author_id === me).length,
    };
    const out = { year, period, offset, label: range.label, from, to, has_prev, has_next: offset < 0, guild_name: get('SELECT name FROM guilds WHERE id=?', gid)?.name || '',
      group: { nights: nights.length, secs: secsAll, longest: longest && { id: longest.id, title: longest.title, secs: longest.secs, ended_at: longest.ended_at, members: longest.members.map(m => m.id) },
        games: topGames, duo: duo && { ids: duo[0].split(':'), nights: duo[1] }, best_day: bestDay, messages: msgN,
        top_message: topMsg && { id: topMsg.id, author_id: topMsg.author_id, content: String(topMsg.content).slice(0, 280), reactions: topMsg.n, created_at: topMsg.created_at },
        top_emoji: topEmoji && { emoji: topEmoji.emoji, n: topEmoji.n }, clips: clips.length, top_clip: clips[0] && clips[0].likes ? clips[0] : null,
        pearls: pearls.length, top_pearl: pearls[0] || null, first_night: nights.length ? Math.min(...nights.map(n => n.started_at)) : null },
      me: mine };
    const ids = [...(out.group.longest?.members || []), ...(out.group.duo?.ids || []), out.group.top_message?.author_id, out.group.top_clip?.author_id, out.group.top_clip?.streamer_id, out.group.top_pearl?.author_id, mine.buddy?.id];
    res.set('Cache-Control', 'no-store').json({ ...out, users: usersOf(ids) });
  }));
  // ---------- sugestões de jogos para a turma (GET /api/guilds/:id/suggestions) ----------
  // Sementes: os jogos que a galera do servidor mais jogou nos últimos 30 dias (mesmas regras do cartão "Jogos que a
  // galera mais joga": só quem compartilha a atividade, sem jogos escondidos); sem nenhum, os mais jogados das
  // bibliotecas da Steam dos membros. Fora: o que alguém já jogou no período e o que 2+ membros já têm.
  app.get('/api/guilds/:id/suggestions', auth, async (req, res) => { try {
    const gid = String(req.params.id); if (!isMember(gid, req.uid)) return bad(res, 'Servidor não encontrado', 404);
    if (!discover?.suggest || !activity?.guildGames) return res.json({ items: [], seeds: [] });
    const played = activity.guildGames(gid, { days: 30, limit: 60, minPlayers: 1 });
    const sid = (x) => (x.platform === 'steam' ? x.game.id : x.game.steam) || null;
    let seeds = played.filter(sid).map(x => ({ appid: String(sid(x)), title: x.game.title, weight: x.players * 2 + x.week + x.playing * 2 + Math.min(10, x.hours / 5) })).slice(0, 5);
    const members = all('SELECT user_id FROM members WHERE guild_id=?', gid).map(r => r.user_id), inM = members.length ? `(${members.map(() => '?').join(',')})` : "('')";
    let owned = [];
    try { owned = all(`SELECT appid, COUNT(*) n, SUM(minutes) mins, MAX(title) title FROM game_library WHERE user_id IN ${inM} GROUP BY appid`, ...members); } catch { /* sem a tabela de bibliotecas */ }
    if (!seeds.length) seeds = [...owned].sort((a, b) => b.mins - a.mins).slice(0, 5).filter(x => x.mins > 0).map(x => ({ appid: String(x.appid), title: x.title, weight: Math.sqrt(x.mins / 60) + x.n }));
    const ownN = new Map(owned.map(x => [String(x.appid), x.n]));
    const exclude = new Set([...played.map(sid).filter(Boolean).map(String), ...owned.filter(x => x.n >= 2).map(x => String(x.appid))]);
    const items = await discover.suggest(seeds, exclude, { limit: 8 }).catch(() => []);
    res.set('Cache-Control', 'private, max-age=600').json({ seeds: seeds.map(x => ({ appid: x.appid, title: x.title })), items: items.map(x => ({ ...x, owners: ownN.get(String(x.appid)) || 0 })) });
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); } });
  return { sinceFor };
}
