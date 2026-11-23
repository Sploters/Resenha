// "Bora?": chamar a turma do servidor para jogar (ou só resenhar), agora ou num horário de hoje, com contador ao vivo.
//
// Quem chama escolhe o jogo (ou nenhum: "só resenhar"), quando (agora ou um horário nas próximas 18 h) e quantos precisam
// topar (contando quem chamou). Todo mundo do servidor vê o cartão com "3/5 topam" e responde Tô dentro / Mais tarde /
// Hoje não. Quando o número bate (e, se marcado, perto do horário), o cartão vira "Formou! Sala X" com Entrar, e quem
// disse "Tô dentro" ou "Mais tarde" recebe o aviso (e no celular, se configurou: server/push.js). No horário marcado
// chega o "Começou". Outro dia não é Bora: o app abre a criação de evento (server/events.js), que já tem RSVP e lembretes.
//
// Avisos: BORA_NEW (aviso com som) para os membros que não desligaram (prefs.boraNotify === 'off' desliga; Não perturbe
// fica sem som); BORA_UPDATE (o cartão, para todos os membros); BORA_FORMED e BORA_START (para quem topou ou disse mais
// tarde). Validade: sem formar, some 2 h depois de criado (ou do horário marcado); formado, 4 h depois de formar.
//
// Rotas:
//   GET  /api/bora                         Bora vivos (e os que acabaram há menos de 30 min) dos meus servidores
//   POST /api/guilds/:id/bora              { game?, appid?, at? (ms; sem = agora), min? (2-10), note? }
//   POST /api/bora/:id/answer              { state: 'in' | 'later' | 'out' }
//   POST /api/bora/:id/cancel              (quem chamou ou quem gerencia o servidor)
export const MIN_SIZE = 2, MAX_SIZE = 10, LATER_MAX_MS = 18 * 3600e3, OPEN_MS = 2 * 3600e3, FORMED_MS = 4 * 3600e3, PER_HOUR = 4, NEAR_MS = 10 * 60e3;

export function mountBora(app, d) {
  const { auth, wrap, bad, db, all, get, run, newId, dispatch, guildMemberIds, userPub, clean, can, P, prefsOf = () => ({}), voiceChannelOf = () => null,
    canConnect = () => true, push = null, now = () => Date.now(), log = console.log } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS bora(
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT, appid TEXT, starts_at INTEGER, min_size INTEGER NOT NULL, note TEXT, state TEXT NOT NULL DEFAULT 'open', end_reason TEXT,
    channel_id TEXT, created_at INTEGER NOT NULL, formed_at INTEGER, started_at INTEGER, ended_at INTEGER);
  CREATE INDEX IF NOT EXISTS bora_guild ON bora(guild_id, state);
  CREATE INDEX IF NOT EXISTS bora_author ON bora(author_id, created_at);
  CREATE TABLE IF NOT EXISTS bora_answers(bora_id TEXT NOT NULL REFERENCES bora(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(bora_id, user_id));`);
  const isMember = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const isBot = (uid) => !!get("SELECT 1 x FROM users WHERE id=? AND username LIKE 'bot\\_%' ESCAPE '\\'", uid);
  const people = (gid) => guildMemberIds(gid).filter(u => !isBot(u));
  const answers = (id) => all('SELECT user_id, state, at FROM bora_answers WHERE bora_id=? ORDER BY at', id);
  const inIds = (b) => [b.author_id, ...answers(b.id).filter(a => a.state === 'in' && a.user_id !== b.author_id).map(a => a.user_id)];
  const endsAt = (b) => (b.state === 'formed' ? (b.formed_at || b.created_at) + FORMED_MS : (b.starts_at || b.created_at) + OPEN_MS);
  const live = (b) => b && b.state !== 'ended' && now() < endsAt(b);

  function obj(b, viewer) {
    const as = answers(b.id), ins = inIds(b), mine = as.find(a => a.user_id === viewer);
    const ch = b.channel_id && get('SELECT id,name,guild_id FROM channels WHERE id=?', b.channel_id), g = get('SELECT id,name,icon FROM guilds WHERE id=?', b.guild_id);
    return { id: b.id, guild: g ? { id: g.id, name: g.name, icon: g.icon } : { id: b.guild_id, name: '' }, author: userPub(b.author_id),
      game: b.game ? { name: b.game, appid: b.appid || null } : null, starts_at: b.starts_at || null, min: b.min_size, note: b.note || null,
      state: live(b) ? b.state : 'ended', end_reason: live(b) ? null : (b.end_reason || 'expired'), created_at: b.created_at, formed_at: b.formed_at || null, ends_at: endsAt(b),
      channel: ch ? { id: ch.id, name: ch.name } : null,
      in: ins.map(userPub).filter(Boolean), later: as.filter(a => a.state === 'later').map(a => userPub(a.user_id)).filter(Boolean), out: as.filter(a => a.state === 'out').length,
      me: viewer === b.author_id ? 'author' : mine?.state || null };
  }
  const label = (b) => `${b.game ? 'Bora ' + b.game : 'Bora resenhar'}${b.starts_at ? ' às ' + hhmm(b.starts_at) : ''}`;
  const hhmm = (t) => { try { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'America/Sao_Paulo' }); } catch { return new Date(t).toISOString().slice(11, 16); } };
  // cartão atualizado para cada membro (cada um vê a própria resposta em `me`)
  const broadcast = (b, type = 'BORA_UPDATE', to = null) => { for (const u of to || people(b.guild_id)) dispatch([u], type, obj(b, u)); };

  // sala do grupo: onde quem chamou está (neste servidor); senão a sala com mais gente que topou; senão a primeira sala de voz
  function pickRoom(b, ins) {
    const vc = voiceChannelOf(b.author_id), mine = vc && get('SELECT id FROM channels WHERE id=? AND guild_id=? AND type=2', vc, b.guild_id);
    if (mine) return mine.id;
    const count = new Map(); for (const u of ins) { const c = voiceChannelOf(u); if (c && get('SELECT 1 x FROM channels WHERE id=? AND guild_id=? AND type=2', c, b.guild_id)) count.set(c, (count.get(c) || 0) + 1); }
    const best = [...count].sort((a, x) => x[1] - a[1])[0]; if (best) return best[0];
    const rooms = all('SELECT id FROM channels WHERE guild_id=? AND type=2 ORDER BY position, id', b.guild_id);
    return (rooms.find(r => canConnect(b.author_id, r.id)) || rooms[0])?.id || null;
  }
  function notify(b, kind, users) {
    const ch = b.channel_id && get('SELECT name FROM channels WHERE id=?', b.channel_id)?.name;
    for (const u of users) {
      if (!push) break;
      if (kind === 'new') push.send(u, 'bora', { title: `${userPub(b.author_id)?.display_name || 'Alguém'}: ${label(b)}?`, body: `${inIds(b).length}/${b.min_size} topam · responda no Resenha`, tags: 'video_game', path: '/' });
      else if (kind === 'formed') push.send(u, 'bora', { title: `Formou! ${label(b)}`, body: ch ? `Sala ${ch} · entre quando quiser` : 'Entre quando quiser', tags: 'tada', priority: 4, path: '/' });
      else if (kind === 'start') push.send(u, 'bora', { title: `Começou: ${label(b)}`, body: ch ? `Sala ${ch}` : 'A turma está chegando', tags: 'alarm_clock', priority: 4, path: '/' });
    }
  }
  // formou? (o número bateu e, se marcado para mais tarde, faltam menos de 10 min)
  function checkFormed(b) {
    if (b.state !== 'open' || !live(b)) return false;
    const ins = inIds(b); if (ins.length < b.min_size) return false;
    if (b.starts_at && now() < b.starts_at - NEAR_MS) return false;
    const room = pickRoom(b, ins);
    run("UPDATE bora SET state='formed', formed_at=?, channel_id=? WHERE id=?", now(), room, b.id);
    const nb = get('SELECT * FROM bora WHERE id=?', b.id);
    const to = [...new Set([...ins, ...answers(b.id).filter(a => a.state === 'later').map(a => a.user_id)])];
    broadcast(nb); for (const u of to) dispatch([u], 'BORA_FORMED', obj(nb, u)); notify(nb, 'formed', to);
    return true;
  }
  // relógio: formação no horário, "Começou" no horário marcado e fim da validade
  function tick() {
    for (const b of all("SELECT * FROM bora WHERE state IN ('open','formed')")) {
      if (!live(b)) { run("UPDATE bora SET state='ended', end_reason=?, ended_at=? WHERE id=?", b.state === 'formed' ? 'done' : 'expired', now(), b.id); broadcast(get('SELECT * FROM bora WHERE id=?', b.id)); continue; }
      if (b.state === 'open') checkFormed(b);
      const cur = get('SELECT * FROM bora WHERE id=?', b.id);
      if (cur.starts_at && !cur.started_at && now() >= cur.starts_at && cur.state === 'formed') {
        run('UPDATE bora SET started_at=? WHERE id=?', now(), cur.id);
        const to = [...new Set([...inIds(cur), ...answers(cur.id).filter(a => a.state === 'later').map(a => a.user_id)])];
        for (const u of to) dispatch([u], 'BORA_START', obj(cur, u)); notify(cur, 'start', to);
      }
    }
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { log('[bora] ' + e.message); } }, 30e3); timer.unref?.();

  // ---------------------------------------------------------------- rotas
  app.get('/api/bora', auth, wrap((req, res) => {
    const gids = all('SELECT guild_id FROM members WHERE user_id=?', req.uid).map(r => r.guild_id); if (!gids.length) return res.json([]);
    const list = all(`SELECT * FROM bora WHERE guild_id IN (${gids.map(() => '?').join(',')}) AND (state<>'ended' OR ended_at>?) ORDER BY created_at DESC LIMIT 50`, ...gids, now() - 30 * 60e3);
    res.set('Cache-Control', 'no-store').json(list.filter(b => live(b) || now() - (b.ended_at || endsAt(b)) < 30 * 60e3).map(b => obj(b, req.uid)));
  }));
  app.post('/api/guilds/:id/bora', auth, wrap((req, res) => {
    const gid = String(req.params.id), uid = req.uid, b0 = req.body || {};
    if (!isMember(gid, uid)) return bad(res, 'Servidor não encontrado', 404);
    const mine = all("SELECT * FROM bora WHERE guild_id=? AND author_id=? AND state<>'ended'", gid, uid).find(live);
    if (mine) return res.status(409).json({ error: 'Você já chamou a turma deste servidor. Cancele o Bora anterior para chamar de novo.', code: 'own_open', bora: obj(mine, uid) });
    if (get('SELECT COUNT(*) n FROM bora WHERE author_id=? AND created_at>?', uid, now() - 3600e3).n >= PER_HOUR) return bad(res, 'Muitos Bora em pouco tempo; espere um pouco', 429);
    const game = clean(b0.game, 60) || null, appid = game && /^\d{1,10}$/.test(String(b0.appid || '')) ? String(b0.appid) : null;
    let at = b0.at == null || b0.at === '' ? null : Math.round(+b0.at);
    if (at != null) {
      if (!Number.isFinite(at)) return bad(res, 'Horário inválido');
      if (at <= now() + 2 * 60e3) at = null; // "daqui a pouco" que já chegou: é agora
      else if (at > now() + LATER_MAX_MS) return bad(res, 'Para outro dia, marque um evento');
    }
    const min = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(+b0.min || 3)));
    const id = newId(), note = clean(b0.note, 120) || null;
    run('INSERT INTO bora(id,guild_id,author_id,game,appid,starts_at,min_size,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, gid, uid, game, appid, at, min, note, now());
    const b = get('SELECT * FROM bora WHERE id=?', id);
    broadcast(b);
    // aviso com som para quem não desligou (Não perturbe recebe o cartão, sem som: o app decide pelo status)
    const to = people(gid).filter(u => u !== uid && (prefsOf(u) || {}).boraNotify !== 'off');
    for (const u of to) dispatch([u], 'BORA_NEW', obj(b, u));
    notify(b, 'new', to);
    res.json(obj(b, uid));
  }));
  const boraFor = (req, res) => { const b = get('SELECT * FROM bora WHERE id=?', String(req.params.id)); if (!b || !isMember(b.guild_id, req.uid)) { bad(res, 'Bora não encontrado', 404); return null; } return b; };
  app.post('/api/bora/:id/answer', auth, wrap((req, res) => {
    const b = boraFor(req, res); if (!b) return;
    if (!live(b)) return res.status(410).json({ error: 'Esse Bora já acabou', bora: obj(b, req.uid) });
    if (b.author_id === req.uid) return bad(res, 'Você chamou: já conta como dentro');
    const st = String(req.body?.state || ''); if (!['in', 'later', 'out'].includes(st)) return bad(res, 'Resposta inválida');
    const prev = get('SELECT state FROM bora_answers WHERE bora_id=? AND user_id=?', b.id, req.uid)?.state;
    run('INSERT INTO bora_answers(bora_id,user_id,state,at) VALUES(?,?,?,?) ON CONFLICT(bora_id,user_id) DO UPDATE SET state=excluded.state, at=excluded.at', b.id, req.uid, st, now());
    if (!checkFormed(b)) broadcast(get('SELECT * FROM bora WHERE id=?', b.id));
    // quem chamou fica sabendo de quem topou (só na primeira vez que topa)
    if (st === 'in' && prev !== 'in') dispatch([b.author_id], 'BORA_ANSWER', { id: b.id, user: userPub(req.uid), state: st, label: label(b) });
    res.json(obj(get('SELECT * FROM bora WHERE id=?', b.id), req.uid));
  }));
  app.post('/api/bora/:id/cancel', auth, wrap((req, res) => {
    const b = boraFor(req, res); if (!b) return;
    if (b.author_id !== req.uid && !can(b.guild_id, req.uid, P.MANAGE_GUILD)) return bad(res, 'Só quem chamou pode cancelar', 403);
    if (b.state !== 'ended') { run("UPDATE bora SET state='ended', end_reason='canceled', ended_at=? WHERE id=?", now(), b.id); broadcast(get('SELECT * FROM bora WHERE id=?', b.id)); }
    res.json(obj(get('SELECT * FROM bora WHERE id=?', b.id), req.uid));
  }));
  return { tick, stop: () => clearInterval(timer) };
}
