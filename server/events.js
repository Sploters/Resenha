// Eventos do servidor: "Sexta 21h, CS2 na sala Geral" com Vou / Talvez / Não vou, lembrete 15 min antes e aviso
// quando começa (com "Entrar na sala").
//
// Cada evento é anunciado num canal de texto como uma mensagem ("📅 título") que o app desenha como cartão (igual às
// enquetes: messageObj junta o evento pela mensagem). Muda alguma coisa (resposta, edição, cancelamento) -> MESSAGE_UPDATE
// do anúncio + EVENT_UPDATE para os membros (tela Eventos do servidor).
//
// Quem pode: criar = qualquer membro (sem castigo); editar/cancelar = quem criou ou quem tem Gerenciar servidor.
// Horário: guardado em ms (UTC); cada app mostra no fuso e formato de quem lê.
//
// Rotas:
//   GET    /api/guilds/:id/events            -> [evento] (próximos e acontecendo; ?past=1 inclui os de até 7 dias atrás)
//   POST   /api/guilds/:id/events            { title, starts_at, duration_min, channel_id (sala de voz), announce_id (canal de texto), slots, game, appid, description }
//   PATCH  /api/events/:id                   (mesmos campos)          DELETE /api/events/:id -> cancela (fica no chat como "Cancelado")
//   PUT    /api/events/:id/rsvp              { state: 'yes' | 'maybe' | 'no' | null }
//   GET    /api/events/:id.ics               -> arquivo de agenda (iCalendar)
// Eventos em tempo real: EVENT_UPDATE { event }, EVENT_REMINDER { event, kind: 'soon' | 'start' } (só para quem respondeu Vou/Talvez).
export const REMIND_MIN = 15;
const DURATIONS = new Set([30, 60, 90, 120, 180, 240, 360]);

export function mountEvents(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, guildMemberIds, can, P, userPub, clean, messageObj, timedOut = () => false, now = () => Date.now(), log = console.log }) {
  db.exec(`CREATE TABLE IF NOT EXISTS events(
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, author_id TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT, game TEXT, appid TEXT, channel_id TEXT, announce_id TEXT, message_id TEXT,
    starts_at INTEGER NOT NULL, duration_min INTEGER NOT NULL DEFAULT 120, slots INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, cancelled_at INTEGER, reminded_at INTEGER, started_at INTEGER);
  CREATE INDEX IF NOT EXISTS events_guild ON events(guild_id, starts_at);
  CREATE INDEX IF NOT EXISTS events_message ON events(message_id);
  CREATE TABLE IF NOT EXISTS event_rsvps(
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY(event_id, user_id));`);

  const member = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const ends = (e) => e.starts_at + e.duration_min * 60e3;
  const status = (e) => (e.cancelled_at ? 'cancelled' : now() >= ends(e) ? 'ended' : now() >= e.starts_at ? 'live' : 'scheduled');
  function eventObj(e) {
    if (!e) return null;
    const r = all('SELECT user_id, state FROM event_rsvps WHERE event_id=? ORDER BY updated_at', e.id);
    const of = (s) => r.filter(x => x.state === s).map(x => x.user_id);
    return { id: e.id, guild_id: e.guild_id, author_id: e.author_id, title: e.title, description: e.description || '', game: e.game || '', appid: e.appid || null,
      channel_id: e.channel_id || null, announce_id: e.announce_id || null, message_id: e.message_id || null, starts_at: e.starts_at, duration_min: e.duration_min,
      ends_at: ends(e), slots: e.slots || 0, created_at: e.created_at, status: status(e), yes: of('yes'), maybe: of('maybe'), no: of('no') };
  }
  const byId = (id) => get('SELECT * FROM events WHERE id=?', id);
  // avisa: o anúncio no chat (MESSAGE_UPDATE) e a tela Eventos (EVENT_UPDATE)
  function changed(e) {
    const ev = eventObj(e), ids = guildMemberIds(e.guild_id);
    dispatch(ids, 'EVENT_UPDATE', { event: ev });
    const m = e.message_id && get('SELECT * FROM messages WHERE id=?', e.message_id);
    if (m) dispatch(ids, 'MESSAGE_UPDATE', { ...messageObj(m), guild_id: e.guild_id });
    return ev;
  }

  // ---- validação ----
  function read(b, gid, cur = {}) {
    const out = {};
    if (b.title !== undefined || !cur.id) { out.title = clean(b.title, 100); if (!out.title) throw new Error('Dê um nome ao evento'); }
    if (b.description !== undefined) out.description = clean(b.description, 1000);
    if (b.game !== undefined) out.game = clean(b.game, 80);
    if (b.appid !== undefined) { out.appid = b.appid ? String(b.appid) : null; if (out.appid && !/^\d{1,10}$/.test(out.appid)) throw new Error('Jogo da Steam inválido'); }
    if (b.starts_at !== undefined || !cur.id) {
      const t = Math.round(+b.starts_at);
      if (!isFinite(t) || t < now() - 5 * 60e3) throw new Error('Escolha um horário no futuro');
      if (t > now() + 90 * 864e5) throw new Error('No máximo 90 dias para a frente');
      out.starts_at = t;
    }
    if (b.duration_min !== undefined || !cur.id) { const d = +b.duration_min || 120; if (!DURATIONS.has(d)) throw new Error('Duração inválida'); out.duration_min = d; }
    if (b.slots !== undefined) { const s = Math.round(+b.slots || 0); if (s < 0 || s > 100) throw new Error('Vagas: de 0 (sem limite) a 100'); out.slots = s; }
    if (b.channel_id !== undefined) {
      out.channel_id = b.channel_id || null;
      if (out.channel_id && !get('SELECT 1 x FROM channels WHERE id=? AND guild_id=? AND type=2', out.channel_id, gid)) throw new Error('Sala de voz não encontrada');
    }
    return out;
  }
  const canManage = (e, uid) => e.author_id === uid || can(e.guild_id, uid, P.MANAGE_GUILD);

  // ---- rotas ----
  app.get('/api/guilds/:id/events', auth, wrap((req, res) => {
    const gid = req.params.id; if (!member(gid, req.uid)) return bad(res, 'Sem acesso', 403);
    const since = req.query.past ? now() - 7 * 864e5 : now() - 12 * 3600e3;
    const list = all('SELECT * FROM events WHERE guild_id=? AND starts_at + duration_min*60000 > ? ORDER BY starts_at LIMIT 100', gid, since).map(eventObj)
      .filter(e => req.query.past || e.status === 'scheduled' || e.status === 'live');
    const uids = [...new Set(list.flatMap(e => [e.author_id, ...e.yes, ...e.maybe]))];
    res.json({ events: list, users: uids.map(userPub).filter(Boolean) });
  }));
  app.post('/api/guilds/:id/events', auth, wrap((req, res) => {
    const gid = req.params.id; if (!member(gid, req.uid)) return bad(res, 'Sem acesso', 403);
    if (timedOut(gid, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
    if (get('SELECT COUNT(*) n FROM events WHERE guild_id=? AND cancelled_at IS NULL AND starts_at>?', gid, now()).n >= 50) return bad(res, 'Este servidor já tem 50 eventos marcados');
    let v; try { v = read(req.body || {}, gid); } catch (e) { return bad(res, e.message); }
    const ann = req.body?.announce_id ? get('SELECT * FROM channels WHERE id=? AND guild_id=?', req.body.announce_id, gid) : null;
    if (req.body?.announce_id && (!ann || ann.type !== 0)) return bad(res, 'Canal de texto não encontrado');
    const id = newId(), t = now();
    run(`INSERT INTO events(id,guild_id,author_id,title,description,game,appid,channel_id,announce_id,starts_at,duration_min,slots,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, gid, req.uid, v.title, v.description || '', v.game || '', v.appid || null, v.channel_id || null, ann?.id || null, v.starts_at, v.duration_min, v.slots || 0, t);
    run('INSERT INTO event_rsvps(event_id,user_id,state,updated_at) VALUES(?,?,?,?)', id, req.uid, 'yes', t); // quem marca vai
    if (ann) { // anúncio no canal: o app desenha o cartão do evento
      const mid = newId();
      run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', mid, ann.id, req.uid, '📅 ' + v.title, t);
      run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ann.id, mid);
      run('UPDATE events SET message_id=? WHERE id=?', mid, id);
      dispatch(guildMemberIds(gid), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: gid, mentions: [] });
    }
    res.json(changed(byId(id)));
  }));
  app.patch('/api/events/:id', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    if (!canManage(e, req.uid)) return bad(res, 'Só quem criou (ou quem gerencia o servidor) pode editar', 403);
    if (e.cancelled_at) return bad(res, 'Evento cancelado');
    let v; try { v = read(req.body || {}, e.guild_id, e); } catch (x) { return bad(res, x.message); }
    const keys = Object.keys(v); if (!keys.length) return bad(res, 'Nada para alterar');
    run(`UPDATE events SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => v[k]), e.id);
    if (v.starts_at && v.starts_at !== e.starts_at) run('UPDATE events SET reminded_at=NULL, started_at=NULL WHERE id=?', e.id); // mudou a hora: avisa de novo
    if (v.title && e.message_id) run('UPDATE messages SET content=? WHERE id=?', '📅 ' + v.title, e.message_id);
    res.json(changed(byId(e.id)));
  }));
  app.delete('/api/events/:id', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    if (!canManage(e, req.uid)) return bad(res, 'Só quem criou (ou quem gerencia o servidor) pode cancelar', 403);
    if (!e.cancelled_at) run('UPDATE events SET cancelled_at=? WHERE id=?', now(), e.id);
    const ev = changed(byId(e.id));
    dispatch([...ev.yes, ...ev.maybe].filter(u => u !== req.uid), 'EVENT_REMINDER', { event: ev, kind: 'cancelled' });
    res.json(ev);
  }));
  app.put('/api/events/:id/rsvp', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    const st = req.body?.state ?? null;
    if (st !== null && !['yes', 'maybe', 'no'].includes(st)) return bad(res, 'Resposta inválida');
    const s = status(e); if (s === 'cancelled' || s === 'ended') return bad(res, s === 'cancelled' ? 'Evento cancelado' : 'Evento encerrado');
    if (st === 'yes' && e.slots) {
      const cur = get('SELECT state FROM event_rsvps WHERE event_id=? AND user_id=?', e.id, req.uid)?.state;
      if (cur !== 'yes' && get("SELECT COUNT(*) n FROM event_rsvps WHERE event_id=? AND state='yes'", e.id).n >= e.slots) return bad(res, 'Vagas esgotadas: marque Talvez para ficar na espera');
    }
    if (st === null) run('DELETE FROM event_rsvps WHERE event_id=? AND user_id=?', e.id, req.uid);
    else run('INSERT INTO event_rsvps(event_id,user_id,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at', e.id, req.uid, st, now());
    res.json(changed(e));
  }));
  // arquivo de agenda: abre no Google Agenda, Outlook, calendário do celular…
  const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  app.get('/api/events/:id.ics', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    const g = get('SELECT name FROM guilds WHERE id=?', e.guild_id), room = e.channel_id && get('SELECT name FROM channels WHERE id=?', e.channel_id);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resenha//Eventos//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${e.id}@resenha`, `DTSTAMP:${icsDate(now())}`, `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(ends(e))}`, `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText([e.game && 'Jogo: ' + e.game, e.description].filter(Boolean).join('\n'))}`, `LOCATION:${icsText('Resenha · ' + (g?.name || '') + (room ? ' · ' + room.name : ''))}`,
      e.cancelled_at ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:-PT${REMIND_MIN}M`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="evento-${e.id}.ics"`).send(lines.join('\r\n') + '\r\n');
  }));

  // ---- lembretes: 15 min antes e na hora (só quem respondeu Vou ou Talvez) ----
  function tick() {
    const t = now();
    for (const e of all('SELECT * FROM events WHERE cancelled_at IS NULL AND reminded_at IS NULL AND starts_at>? AND starts_at<=?', t, t + REMIND_MIN * 60e3)) {
      run('UPDATE events SET reminded_at=? WHERE id=?', t, e.id);
      const ev = eventObj(e); dispatch([...ev.yes, ...ev.maybe], 'EVENT_REMINDER', { event: ev, kind: 'soon' });
    }
    for (const e of all('SELECT * FROM events WHERE cancelled_at IS NULL AND started_at IS NULL AND starts_at<=? AND starts_at>?', t, t - 30 * 60e3)) {
      run('UPDATE events SET started_at=?, reminded_at=COALESCE(reminded_at, ?) WHERE id=?', t, t, e.id);
      const ev = changed(byId(e.id)); dispatch([...ev.yes, ...ev.maybe], 'EVENT_REMINDER', { event: ev, kind: 'start' });
    }
    // terminou: o cartão passa a "Encerrado" (uma vez)
    for (const e of all('SELECT * FROM events WHERE cancelled_at IS NULL AND started_at IS NOT NULL AND started_at < starts_at + duration_min*60000 AND starts_at + duration_min*60000 <= ? AND starts_at + duration_min*60000 > ?', t, t - 2 * (+process.env.EVENTS_TICK_MS || 30e3))) changed(e);
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { log('[eventos] ' + e.message); } }, +process.env.EVENTS_TICK_MS || 30e3); timer.unref?.();

  return { ofMessage: (mid) => { const e = get('SELECT * FROM events WHERE message_id=?', mid); return e ? { event: eventObj(e) } : {}; }, tick };
}
