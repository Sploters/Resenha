import fs from 'node:fs';
import path from 'node:path';
import { createArt, catalogGame, ART_CATALOG } from './eventart.js';
// Eventos do servidor: "Sexta 21h, CS2 na sala Geral" com Vou / Talvez / Não vou, lembrete 30 min antes e aviso
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
//   POST   /api/guilds/:id/events            { title, starts_at, duration_min, channel_id (sala de voz), announce_id (canal de texto), slots, game, appid, description,
//                                              banner (capa: arquivo desta instalação, /files/...), banner_link (de onde veio a capa, só para mostrar) }
//   POST   /api/guilds/:id/event-art         { url } | { game } -> { url, title, source } capa de um link (Epic, Riot, Battle.net, imagem…) ou do catálogo
//   GET    /api/event-art/catalog            -> [{ name, store }] jogos fora da Steam que já têm capa automática
//   PATCH  /api/events/:id                   (mesmos campos + roles, weekly)   DELETE /api/events/:id[?serie=1] -> cancela (fica no chat como "Cancelado"; serie=1 para de repetir)
//   PUT    /api/events/:id/rsvp              { state: 'yes' | 'maybe' | 'no' | null, role? }
//
// Vagas por função (raid, time): roles = [{ id, name, emoji, slots }] no evento; "Vou" pede a função. Função cheia (ou o
// evento cheio, sem funções) põe a pessoa na lista de espera (state 'wait', na ordem de chegada); quando abre uma vaga,
// o primeiro da espera daquela função sobe sozinho e recebe EVENT_REMINDER kind 'promoted'.
// Semanal (weekly = 1, "raid fixa"): quando o evento termina, o da semana seguinte é marcado sozinho (mesmo horário,
// funções, sala e canal); quem foi recebe EVENT_REMINDER kind 'weekly' para confirmar de novo.
//   GET    /api/events/:id.ics               -> arquivo de agenda (iCalendar)
// Eventos em tempo real: EVENT_UPDATE { event }, EVENT_REMINDER { event, kind: 'soon' | 'start' } (só para quem respondeu Vou/Talvez).
export const REMIND_MIN = 30;
const DURATIONS = new Set([30, 60, 90, 120, 180, 240, 360]);

export function mountEvents(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, guildMemberIds, can, P, userPub, clean, messageObj, timedOut = () => false, now = () => Date.now(), log = console.log, uploadDir = null, artPrivate = false }) {
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
  for (const col of ['banner TEXT', 'banner_link TEXT', 'roles TEXT', 'weekly INTEGER DEFAULT 0', 'next_id TEXT']) try { db.exec('ALTER TABLE events ADD COLUMN ' + col); } catch { } // capa; funções, semanal
  try { db.exec('ALTER TABLE event_rsvps ADD COLUMN role TEXT'); } catch { } // função escolhida no "Vou" (ou na espera)
  const art = uploadDir ? createArt({ uploadDir, allowPrivate: artPrivate, log }) : null;

  const member = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const ends = (e) => e.starts_at + e.duration_min * 60e3;
  const status = (e) => (e.cancelled_at ? 'cancelled' : now() >= ends(e) ? 'ended' : now() >= e.starts_at ? 'live' : 'scheduled');
  const rolesOf = (e) => { try { const r = JSON.parse(e.roles || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
  function eventObj(e) {
    if (!e) return null;
    const r = all('SELECT user_id, state, role FROM event_rsvps WHERE event_id=? ORDER BY updated_at, rowid', e.id);
    const of = (s) => r.filter(x => x.state === s).map(x => x.user_id);
    const roles = rolesOf(e).map(x => ({ ...x, yes: r.filter(y => y.state === 'yes' && y.role === x.id).map(y => y.user_id), wait: r.filter(y => y.state === 'wait' && y.role === x.id).map(y => y.user_id) }));
    const picks = {}; for (const x of r) if (x.role && (x.state === 'yes' || x.state === 'wait')) picks[x.user_id] = x.role;
    return { id: e.id, guild_id: e.guild_id, author_id: e.author_id, title: e.title, description: e.description || '', game: e.game || '', appid: e.appid || null,
      banner: e.banner || null, banner_link: e.banner_link || null,
      channel_id: e.channel_id || null, announce_id: e.announce_id || null, message_id: e.message_id || null, starts_at: e.starts_at, duration_min: e.duration_min,
      ends_at: ends(e), slots: e.slots || 0, created_at: e.created_at, status: status(e), yes: of('yes'), maybe: of('maybe'), no: of('no'),
      wait: of('wait'), roles, picks, weekly: !!e.weekly, next_id: e.next_id || null };
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
    if (b.banner !== undefined) { // só arquivo de imagem desta instalação (enviado ou baixado pelo /event-art)
      out.banner = b.banner ? String(b.banner) : null;
      const f = out.banner && out.banner.match(/^\/files\/([a-f0-9]{24}\.(png|jpe?g|webp|gif|avif))(\/[^/?#]{0,200})?$/i);
      if (out.banner && (!f || (uploadDir && !fs.existsSync(path.join(uploadDir, f[1]))))) throw new Error('Imagem de capa inválida');
    }
    if (b.banner_link !== undefined) { out.banner_link = b.banner_link ? String(b.banner_link).slice(0, 500) : null; if (out.banner_link && !/^https?:\/\//i.test(out.banner_link)) out.banner_link = null; }
    if (b.starts_at !== undefined || !cur.id) {
      const t = Math.round(+b.starts_at);
      if (!isFinite(t) || t < now() - 5 * 60e3) throw new Error('Escolha um horário no futuro');
      if (t > now() + 90 * 864e5) throw new Error('No máximo 90 dias para a frente');
      out.starts_at = t;
    }
    if (b.duration_min !== undefined || !cur.id) { const d = +b.duration_min || 120; if (!DURATIONS.has(d)) throw new Error('Duração inválida'); out.duration_min = d; }
    if (b.slots !== undefined) { const s = Math.round(+b.slots || 0); if (s < 0 || s > 100) throw new Error('Vagas: de 0 (sem limite) a 100'); out.slots = s; }
    if (b.weekly !== undefined) out.weekly = b.weekly ? 1 : 0;
    if (b.roles !== undefined) {
      const list = Array.isArray(b.roles) ? b.roles : [];
      if (list.length > 12) throw new Error('No máximo 12 funções');
      const prev = new Map(rolesOf(cur).map(x => [x.id, x])), used = new Set();
      const roles = list.map((x) => {
        const name = clean(x?.name, 30); if (!name) throw new Error('Dê um nome a cada função');
        const slots = Math.round(+x?.slots || 0); if (slots < 1 || slots > 50) throw new Error('Cada função tem de 1 a 50 vagas');
        // função que já existia mantém o id (e quem estava nela); nova ganha um id que nunca foi de outra
        let id = String(x?.id || '');
        if (!/^r\d{1,3}$/.test(id) || used.has(id) || (!prev.has(id) && cur.id)) { let n = 1; while (used.has('r' + n) || prev.has('r' + n) || list.some(y => y?.id === 'r' + n)) n++; id = 'r' + n; }
        used.add(id);
        return { id, name, emoji: clean(x?.emoji, 8) || '', slots };
      });
      out.roles = roles.length ? JSON.stringify(roles) : null;
    }
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
    if (req.body?.announce_id && (!ann || ![0, 5].includes(ann.type))) return bad(res, 'Canal de texto não encontrado');
    // quem marca vai (com a função que escolheu, se o evento tem funções)
    const list = v.roles ? JSON.parse(v.roles) : [], myRole = list.find(x => x.id === req.body?.my_role) || list[0] || null;
    const id = create(gid, req.uid, { ...v, announce_id: ann?.id || null }, myRole?.id || null);
    res.json(changed(byId(id)));
  }));
  // cria o evento (e o anúncio no canal); usado pela rota e pelo evento semanal
  function create(gid, author, v, authorRole = null) {
    const id = newId(), t = now();
    run(`INSERT INTO events(id,guild_id,author_id,title,description,game,appid,channel_id,announce_id,starts_at,duration_min,slots,created_at,banner,banner_link,roles,weekly) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, gid, author, v.title, v.description || '', v.game || '', v.appid || null, v.channel_id || null, v.announce_id || null, v.starts_at, v.duration_min, v.slots || 0, t, v.banner || null, v.banner_link || null, v.roles || null, v.weekly ? 1 : 0);
    run('INSERT INTO event_rsvps(event_id,user_id,state,updated_at,role) VALUES(?,?,?,?,?)', id, author, 'yes', t, authorRole);
    if (v.starts_at - t <= REMIND_MIN * 60e3) run('UPDATE events SET reminded_at=? WHERE id=?', t, id); // marcado em cima da hora: não manda "começa em 30 min" para quem acabou de marcar
    const ann = v.announce_id && get('SELECT * FROM channels WHERE id=? AND guild_id=?', v.announce_id, gid);
    if (ann) { // anúncio no canal: o app desenha o cartão do evento
      const mid = newId();
      run('INSERT INTO messages(id,channel_id,author_id,content,created_at) VALUES(?,?,?,?,?)', mid, ann.id, author, '📅 ' + v.title, t);
      run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', author, ann.id, mid);
      run('UPDATE events SET message_id=? WHERE id=?', mid, id);
      dispatch(guildMemberIds(gid), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: gid, mentions: [] });
    }
    return id;
  }
  // abre vaga -> o primeiro da espera (da função, ou do evento sem funções) sobe; devolve quem subiu
  function promote(e) {
    const up = [], roles = rolesOf(e);
    const fill = (cap, roleId) => {
      const cond = roleId === undefined ? '' : ' AND role IS ?';
      const args = roleId === undefined ? [] : [roleId];
      let free = cap - get(`SELECT COUNT(*) n FROM event_rsvps WHERE event_id=? AND state='yes'${cond}`, e.id, ...args).n;
      if (free <= 0) return;
      for (const w of all(`SELECT user_id FROM event_rsvps WHERE event_id=? AND state='wait'${cond} ORDER BY updated_at, rowid LIMIT ?`, e.id, ...args, free)) {
        run("UPDATE event_rsvps SET state='yes' WHERE event_id=? AND user_id=?", e.id, w.user_id); up.push(w.user_id); free--;
      }
    };
    if (roles.length) for (const r of roles) fill(r.slots, r.id);
    else if (e.slots) fill(e.slots, undefined);
    else run("UPDATE event_rsvps SET state='yes' WHERE event_id=? AND state='wait'", e.id); // sem limite: ninguém espera
    return up;
  }
  function afterChange(e, skip) {
    const up = promote(e).filter(u => u !== skip), ev = changed(byId(e.id));
    if (up.length) dispatch(up, 'EVENT_REMINDER', { event: ev, kind: 'promoted' });
    return ev;
  }
  app.patch('/api/events/:id', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    if (!canManage(e, req.uid)) return bad(res, 'Só quem criou (ou quem gerencia o servidor) pode editar', 403);
    if (e.cancelled_at) return bad(res, 'Evento cancelado');
    let v; try { v = read(req.body || {}, e.guild_id, e); } catch (x) { return bad(res, x.message); }
    const keys = Object.keys(v); if (!keys.length) return bad(res, 'Nada para alterar');
    run(`UPDATE events SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => v[k]), e.id);
    if (v.starts_at && v.starts_at !== e.starts_at) run('UPDATE events SET reminded_at=NULL, started_at=NULL WHERE id=?', e.id); // mudou a hora: avisa de novo
    if (v.title && e.message_id) run('UPDATE messages SET content=? WHERE id=?', '📅 ' + v.title, e.message_id);
    if (v.roles !== undefined) { // função que saiu: quem estava nela fica como Talvez (sem função)
      const keep = new Set((v.roles ? JSON.parse(v.roles) : []).map(x => x.id));
      for (const x of all("SELECT user_id, role FROM event_rsvps WHERE event_id=? AND role IS NOT NULL", e.id)) if (!keep.has(x.role)) run("UPDATE event_rsvps SET state='maybe', role=NULL WHERE event_id=? AND user_id=?", e.id, x.user_id);
      if (keep.size) run("UPDATE event_rsvps SET state='maybe' WHERE event_id=? AND state IN ('yes','wait') AND role IS NULL", e.id); // virou evento com funções: quem ia sem função escolhe uma
    }
    res.json(afterChange(byId(e.id)));
  }));
  app.delete('/api/events/:id', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    if (!canManage(e, req.uid)) return bad(res, 'Só quem criou (ou quem gerencia o servidor) pode cancelar', 403);
    if (!e.cancelled_at) run('UPDATE events SET cancelled_at=? WHERE id=?', now(), e.id);
    if (req.query.serie === '1') run('UPDATE events SET weekly=0 WHERE id=?', e.id); // semanal: cancelar a série inteira (não marca a próxima)
    const ev = changed(byId(e.id));
    if (!e.cancelled_at) dispatch([...ev.yes, ...ev.maybe].filter(u => u !== req.uid), 'EVENT_REMINDER', { event: ev, kind: 'cancelled' });
    res.json(ev);
  }));
  app.put('/api/events/:id/rsvp', auth, wrap((req, res) => {
    const e = byId(req.params.id); if (!e || !member(e.guild_id, req.uid)) return bad(res, 'Evento não encontrado', 404);
    let st = req.body?.state ?? null;
    if (st !== null && !['yes', 'maybe', 'no'].includes(st)) return bad(res, 'Resposta inválida');
    const s = status(e); if (s === 'cancelled' || s === 'ended') return bad(res, s === 'cancelled' ? 'Evento cancelado' : 'Evento encerrado');
    const roles = rolesOf(e), cur = get('SELECT state, role FROM event_rsvps WHERE event_id=? AND user_id=?', e.id, req.uid);
    let role = null;
    if (st === 'yes') {
      if (roles.length) { role = roles.find(x => x.id === String(req.body?.role || cur?.role || ''))?.id; if (!role) return bad(res, 'Escolha uma função'); }
      const same = cur && (cur.state === 'yes' || cur.state === 'wait') && (cur.role || null) === role;
      if (same) st = cur.state; // já está nessa função (confirmado ou na espera): nada muda
      else {
        const cap = roles.length ? roles.find(x => x.id === role).slots : e.slots;
        const taken = cap ? get(`SELECT COUNT(*) n FROM event_rsvps WHERE event_id=? AND state='yes' AND user_id<>?${roles.length ? ' AND role=?' : ''}`, e.id, req.uid, ...(roles.length ? [role] : [])).n : 0;
        // cheia e alguém já esperando: entra no fim da fila (não fura); cheia: espera
        if (cap && (taken >= cap || get(`SELECT 1 x FROM event_rsvps WHERE event_id=? AND state='wait' AND user_id<>?${roles.length ? ' AND role=?' : ''}`, e.id, req.uid, ...(roles.length ? [role] : [])))) st = 'wait';
      }
    }
    if (st === null) run('DELETE FROM event_rsvps WHERE event_id=? AND user_id=?', e.id, req.uid);
    else if (!(cur && cur.state === st && (cur.role || null) === role)) run('INSERT INTO event_rsvps(event_id,user_id,state,updated_at,role) VALUES(?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, role=excluded.role', e.id, req.uid, st, now(), role);
    res.json(afterChange(e, req.uid));
  }));
  // capa a partir de um link (página da loja/site do jogo ou imagem) ou de um jogo do catálogo
  const artBusy = new Map(); // uid -> último pedido (1 a cada 2 s)
  app.post('/api/guilds/:id/event-art', auth, async (req, res) => {
    try {
      const gid = req.params.id; if (!member(gid, req.uid)) return bad(res, 'Sem acesso', 403);
      if (!art) return bad(res, 'Indisponível', 503);
      if (now() - (artBusy.get(req.uid) || 0) < 2000) return bad(res, 'Calma, um de cada vez', 429);
      artBusy.set(req.uid, now()); if (artBusy.size > 1000) artBusy.clear();
      const cat = req.body?.game ? catalogGame(req.body.game) : null;
      const link = cat ? cat.page : String(req.body?.url || '').trim().slice(0, 1000);
      if (!/^https?:\/\/\S+$/i.test(link)) return bad(res, cat === null && req.body?.game ? 'Jogo fora do catálogo: cole um link ou envie uma imagem' : 'Cole um link (https://…)');
      const r = await art(link);
      res.json({ ...r, ...(cat ? { title: cat.name, store: cat.store } : {}) });
    } catch (e) { if (!res.headersSent) bad(res, e.message || 'Não consegui pegar a imagem', 422); }
  });
  app.get('/api/event-art/catalog', auth, (req, res) => res.json(ART_CATALOG.map(g => ({ name: g.name, store: g.store }))));
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

  // ---- lembretes: 30 min antes e na hora (só quem respondeu Vou ou Talvez) ----
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
    // semanal: terminou (ou foi cancelado só este) -> marca o da semana seguinte, uma vez
    for (const e of all('SELECT * FROM events WHERE weekly=1 AND next_id IS NULL AND starts_at + duration_min*60000 <= ?', t)) {
      if (!get('SELECT 1 x FROM guilds WHERE id=?', e.guild_id)) continue;
      let at = e.starts_at; while (at <= t) at += 7 * 864e5;
      const author = get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', e.guild_id, e.author_id) ? e.author_id : null;
      if (!author) { run('UPDATE events SET next_id=? WHERE id=?', '-', e.id); continue; } // quem marcava saiu do servidor: para de repetir
      const was = all("SELECT user_id FROM event_rsvps WHERE event_id=? AND state IN ('yes','wait') AND user_id<>?", e.id, author).map(x => x.user_id);
      const role = get('SELECT role FROM event_rsvps WHERE event_id=? AND user_id=?', e.id, author)?.role || null;
      const nid = create(e.guild_id, author, { ...e, starts_at: at }, rolesOf(e).some(x => x.id === role) ? role : null);
      run('UPDATE events SET next_id=? WHERE id=?', nid, e.id);
      const ev = changed(byId(nid));
      if (was.length) dispatch(was, 'EVENT_REMINDER', { event: ev, kind: 'weekly' });
    }
    // terminou: o cartão passa a "Encerrado" (uma vez)
    for (const e of all('SELECT * FROM events WHERE cancelled_at IS NULL AND started_at IS NOT NULL AND started_at < starts_at + duration_min*60000 AND starts_at + duration_min*60000 <= ? AND starts_at + duration_min*60000 > ?', t, t - 2 * (+process.env.EVENTS_TICK_MS || 30e3))) changed(e);
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { log('[eventos] ' + e.message); } }, +process.env.EVENTS_TICK_MS || 30e3); timer.unref?.();

  return { ofMessage: (mid) => { const e = get('SELECT * FROM events WHERE message_id=?', mid); return e ? { event: eventObj(e) } : {}; }, tick };
}
