// "A fim de jogar": disponibilidade social + intenção de jogar + LFG invertido.
// Quem está a fim diz o jogo, até quando e com quantas pessoas. O servidor descobre quem do círculo (amigos e quem divide
// servidor, menos bloqueios) tem ou joga aquele jogo, convida só essas pessoas (com o motivo), e quando o mínimo topa,
// escolhe a sala e manda o convite para a chamada (server/callinvites.js). Ninguém é colocado na sala à força.
// As regras (compatibilidade, limites, formação, validade) ficam em server/intentmatch.js; aqui só se juntam os dados.
//
// Sinais usados, SEMPRE pelas regras de privacidade de cada sistema, do ponto de vista de quem cria a intenção:
//   "Jogando…" e histórico (activity.canSee), biblioteca/wishlist da Steam (games.canSee), perfil do jogo no LFG (o mesmo
//   público do LFG), presença (privacy.presenceVisible: quem esconde aparece offline e recebe em silêncio).
// Preferências de quem recebe (Configurações → Notificações, users.settings):
//   intentNotify: 'all' (padrão) | 'friends' | 'off';  intentMuted: { [gameKey | '*']: até quando (ms) | true }
//
// Rotas:
//   GET  /api/intents/games            sugestões de jogo (o que estou jogando, joguei, catálogo do LFG, biblioteca)
//   POST /api/intents/preview          { game } -> quem seria chamado, por quê e como (com som / em silêncio)
//   POST /api/intents                  cria (409 code=duplicate: já existe uma do mesmo jogo no círculo; own_open: já tenho uma)
//   GET  /api/intents                  { mine, invites } vivas (e as minhas que acabaram há pouco, para ver o resultado)
//   GET  /api/intents/:id
//   POST /api/intents/:id/respond      { action: join | decline | leave }
//   POST /api/intents/:id/more         chama a próxima rodada de compatíveis
//   POST /api/intents/:id/cancel       (quem criou)
//   POST /api/intents/:id/enter        grupo formado: devolve a sala (entra no servidor se ainda não for membro)
//   POST /api/intents/:id/fallback     plano B: dados para publicar no mural do LFG
import { LIMITS, gameKeyOf, normTitle, rankCandidates, validity, sizeRules, groupState, statusOf, canJoin, findDuplicate } from './intentmatch.js';
import { formBucket } from './social.js';

const RECENT_DAYS = 14, KEEP_DAYS = 30, MAX_PER_HOUR = 6, RECENT_DONE = 30 * 60e3;

export function mountIntents(app, d) {
  const { auth, wrap, bad, db, get, all, run, newId, dispatch, userPub, clean, audienceOf, isFriend, presenceVisible, realStatus, prefsOf, activity, games,
    lfgGames, guildsOf, isMember, joinGuild, guildFull = () => null, canConnect, voiceChannelOf, roomPeople, createVoiceChannel, deleteChannel, callInvite, social, isOnline, log = console.log, now = () => Date.now() } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS play_intents(
    id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_key TEXT NOT NULL, game_name TEXT NOT NULL, appid TEXT, lfg_game TEXT,
    availability TEXT NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    min_size INTEGER NOT NULL, max_size INTEGER, guild_id TEXT, note TEXT,
    state TEXT NOT NULL DEFAULT 'open', channel_id TEXT, temp_channel INTEGER NOT NULL DEFAULT 0, fallback INTEGER NOT NULL DEFAULT 0,
    responded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, formed_at INTEGER, ended_at INTEGER, end_reason TEXT);
  CREATE INDEX IF NOT EXISTS play_intents_live ON play_intents(state, expires_at);
  CREATE INDEX IF NOT EXISTS play_intents_author ON play_intents(author_id, created_at);
  CREATE TABLE IF NOT EXISTS intent_members(
    intent_id TEXT NOT NULL REFERENCES play_intents(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL, delivery TEXT, reasons TEXT, invited_at INTEGER, responded_at INTEGER, entered_at INTEGER,
    PRIMARY KEY(intent_id, user_id));
  CREATE INDEX IF NOT EXISTS intent_members_user ON intent_members(user_id, invited_at);`);
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const CAT = new Map(lfgGames.map(g => [g.id, g]));
  const LIVE = "state IN ('open','formed')";

  // ---------------------------------------------------------------- jogo
  const libTitle = (appid) => get('SELECT title FROM game_library WHERE appid=? AND title IS NOT NULL LIMIT 1', appid)?.title || null;
  // { name, appid?, lfg? } vindo do app -> descritor validado
  function gameFrom(b) {
    if (!b || typeof b !== 'object') return { error: 'Escolha o jogo' };
    let lfg = b.lfg && CAT.has(String(b.lfg)) ? String(b.lfg) : null;
    // nome digitado ou vindo do "Jogando…" ("VALORANT", "Counter-Strike 2"): é o jogo do catálogo do LFG (mesma chave, sem duplicar)
    if (!lfg || lfg === 'other') { const n = normTitle(b.name), a0 = b.appid && String(b.appid); const c = [...CAT.values()].find(c => c.id !== 'other' && ((n && normTitle(c.name) === n) || (a0 && c.steam === a0))); if (c) lfg = c.id; }
    const cat = lfg && lfg !== 'other' ? CAT.get(lfg) : null;
    let appid = b.appid && /^\d{1,10}$/.test(String(b.appid)) ? String(b.appid) : (cat?.steam || null);
    const name = cat ? cat.name : clean(b.name, 60) || (appid && libTitle(appid));
    if (!name) return { error: 'Escreva o nome do jogo' };
    // jogo digitado: se alguém da instalação tem na Steam com esse nome, ganha o appid (melhora "quem tem")
    if (!appid && !cat) appid = get('SELECT appid FROM game_library WHERE lower(title)=lower(?) LIMIT 1', name)?.appid || null;
    return { key: gameKeyOf({ appid, lfg: cat ? lfg : null, title: name }), name, appid, lfg: cat ? lfg : null };
  }
  const titleKeys = (g) => { const s = new Set([normTitle(g.name)]); if (g.lfg) s.add(normTitle(CAT.get(g.lfg)?.name)); return s; };
  const sameGame = (g, titles, x /* { title, steam } */) => (g.appid && x.steam && String(x.steam) === String(g.appid)) || titles.has(normTitle(x.title));

  // ---------------------------------------------------------------- sinais de cada candidato (visão de quem cria)
  function signals(author, uid, g, titles, t) {
    const fr = isFriend(author, uid), u = userPub(uid);
    const s = { uid, name: u?.display_name || '', friend: fr, playingNow: false, playedDaysAgo: null, ownsMinutes: null, wishlist: false, lfgProfile: false };
    for (const e of activity._state.current.values()) {
      if (e.uid !== uid || !activity.canSee(author, uid, e.platform)) continue;
      if (sameGame(g, titles, { title: e.game.title, steam: e.platform === 'steam' ? e.game.id : e.game.steam })) s.playingNow = true;
    }
    if (!s.playingNow) {
      for (const r of all('SELECT platform, game_id, title, data, MAX(created_at) at FROM activities WHERE user_id=? AND created_at>? GROUP BY platform, game_id', uid, t - RECENT_DAYS * 864e5)) {
        if (!activity.canSee(author, uid, r.platform)) continue;
        let steam = r.platform === 'steam' ? r.game_id : null; try { steam ||= JSON.parse(r.data || '{}').steam || null; } catch { }
        if (sameGame(g, titles, { title: r.title, steam })) { const days = Math.floor((t - r.at) / 864e5); if (s.playedDaysAgo == null || days < s.playedDaysAgo) s.playedDaysAgo = days; }
      }
    }
    if (g.appid && games.canSee(author, uid)) {
      const own = get('SELECT minutes FROM game_library WHERE user_id=? AND appid=?', uid, g.appid);
      if (own) s.ownsMinutes = own.minutes || 0;
      s.wishlist = !!get('SELECT 1 x FROM wishlist WHERE user_id=? AND appid=?', uid, g.appid);
    }
    if (g.lfg) s.lfgProfile = !!get('SELECT 1 x FROM lfg_profiles WHERE user_id=? AND game=?', uid, g.lfg);
    // presença: a de verdade decide como avisar; quem esconde a presença de quem cria aparece como offline nos motivos
    const real = realStatus(uid);
    s.status = real === 'invisible' ? 'offline' : real; s.shownStatus = presenceVisible(author, uid) ? s.status : 'offline';
    const p = prefsOf(uid) || {};
    s.prefs = { mode: ['all', 'friends', 'off'].includes(p.intentNotify) ? p.intentNotify : 'all', muted: p.intentMuted && typeof p.intentMuted === 'object' ? p.intentMuted : {} };
    s.receivedLastHour = get("SELECT COUNT(*) n FROM intent_members WHERE user_id=? AND delivery='push' AND invited_at>?", uid, t - 3600e3).n;
    s.lastFromAuthorAt = get("SELECT MAX(m.invited_at) t FROM intent_members m JOIN play_intents i ON i.id=m.intent_id WHERE i.author_id=? AND m.user_id=? AND m.delivery='push'", author, uid)?.t || null;
    s.ignoredRecent = get("SELECT COUNT(*) n FROM intent_members m JOIN play_intents i ON i.id=m.intent_id WHERE i.author_id=? AND m.user_id=? AND m.state='ignored' AND m.invited_at>?", author, uid, t - 14 * 864e5).n;
    return s;
  }
  function rank(author, g, { skip = new Set(), fanout } = {}) {
    const t = now(), titles = titleKeys(g);
    const cands = audienceOf(author).filter(u => u !== author && !skip.has(u) && !get("SELECT 1 x FROM users WHERE id=? AND username LIKE 'bot\\_%' ESCAPE '\\'", u)).map(u => signals(author, u, g, titles, t));
    const by = new Map(cands.map(s => [s.uid, s]));
    const r = rankCandidates(cands, g.key, { now: t, fanout });
    return { ...r, by };
  }
  const WHY = { offline: 'Offline: vê quando abrir o Resenha', dnd: 'Não perturbe: sem som', limit: 'Já recebeu muitos convites agora: sem som', cooldown: 'Você chamou há pouco: sem som' };
  const candPub = (c, s) => ({ user: userPub(c.uid), reasons: c.reasons, delivery: c.delivery, why: c.why ? (c.why === 'dnd' && s.shownStatus !== 'dnd' ? WHY.offline : WHY[c.why]) : null, selected: c.selected });

  // ---------------------------------------------------------------- objeto público
  const members = (id) => all('SELECT * FROM intent_members WHERE intent_id=? ORDER BY invited_at, user_id', id);
  const joinedIds = (id) => all("SELECT user_id FROM intent_members WHERE intent_id=? AND state='joined' ORDER BY responded_at", id).map(r => r.user_id);
  function obj(it, viewer) {
    const t = now(), ms = members(it.id), mine = viewer === it.author_id, me = ms.find(m => m.user_id === viewer);
    const joined = ms.filter(m => m.state === 'joined'), st = statusOf(it, t), gs = groupState({ min: it.min_size, max: it.max_size, joined: joined.length });
    const g = it.guild_id && get('SELECT id,name,icon FROM guilds WHERE id=?', it.guild_id);
    const ch = it.channel_id && get('SELECT id,name,guild_id FROM channels WHERE id=?', it.channel_id);
    const inGroup = mine || me?.state === 'joined';
    const cnt = (s) => ms.filter(m => m.state === s).length;
    return {
      id: it.id, author: userPub(it.author_id), mine, status: st, state: it.state,
      game: { key: it.game_key, name: it.game_name, appid: it.appid, lfg: it.lfg_game },
      availability: it.availability, starts_at: it.starts_at, expires_at: it.expires_at, created_at: it.created_at, formed_at: it.formed_at,
      min_size: it.min_size, max_size: it.max_size, note: it.note, fallback: !!it.fallback, end_reason: it.end_reason,
      size: gs.size, missing: gs.missing, free: gs.free, full: gs.full,
      guild: g ? { id: g.id, name: g.name, icon: g.icon } : null,
      channel: ch && inGroup && st === 'formed' ? { id: ch.id, name: ch.name, guild_id: ch.guild_id, in_call: roomPeople(ch.id).length, temp: !!it.temp_channel } : null,
      group: [userPub(it.author_id), ...joined.map(m => userPub(m.user_id))],
      counts: { invited: cnt('invited'), joined: joined.length, declined: cnt('declined'), ignored: cnt('ignored') },
      members: mine ? ms.map(m => ({ user: userPub(m.user_id), state: m.state, delivery: m.delivery, reasons: JSON.parse(m.reasons || '[]'), entered: !!m.entered_at })) : undefined,
      me: me && !mine ? { state: me.state, delivery: me.delivery, reasons: JSON.parse(me.reasons || '[]') } : null,
    };
  }
  const audienceOfIntent = (it) => [it.author_id, ...members(it.id).map(m => m.user_id)];
  const broadcast = (it, type = 'INTENT_UPDATE', extra = {}) => { for (const u of audienceOfIntent(it)) dispatch([u], type, { ...obj(it, u), ...extra }); };
  const byId = (id) => get('SELECT * FROM play_intents WHERE id=?', String(id));
  const liveIntents = () => all(`SELECT * FROM play_intents WHERE ${LIVE} AND expires_at>?`, now());

  // ---------------------------------------------------------------- convidar
  function invite(it, list, by) {
    const t = now(), sent = [];
    for (const c of list) {
      if (get('SELECT 1 x FROM intent_members WHERE intent_id=? AND user_id=?', it.id, c.uid)) continue;
      run('INSERT INTO intent_members(intent_id,user_id,state,delivery,reasons,invited_at) VALUES(?,?,?,?,?,?)', it.id, c.uid, 'invited', c.delivery, JSON.stringify(c.reasons), t);
      sent.push(c);
      social.count('invite', c.delivery === 'push' ? 'sent_push' : 'sent_quiet', 1, c.uid);
      if (!isOnline(c.uid)) social.pull(c.uid, 'intent_invite');
    }
    const cur = byId(it.id);
    for (const c of sent) dispatch([c.uid], 'INTENT_INVITE', { ...obj(cur, c.uid), delivery: c.delivery });
    void by;
    return sent.length;
  }

  // ---------------------------------------------------------------- sala
  const liveRoom = (cid, except) => !!get(`SELECT 1 x FROM play_intents WHERE channel_id=? AND id<>? AND ${LIVE} AND expires_at>?`, cid, except, now());
  function pickRoom(it, people) {
    // 1) quem criou já está numa sala de voz de um servidor: o grupo vai para lá
    const cur = voiceChannelOf(it.author_id), curCh = cur && get('SELECT * FROM channels WHERE id=?', cur);
    if (curCh?.guild_id && curCh.type === 2) return { ch: curCh, temp: false, why: 'author_room' };
    const gid = it.guild_id;
    // 2) uma sala vazia do servidor em que todos (que já são membros) podem entrar e que nenhuma outra intenção pegou
    const rooms = all('SELECT * FROM channels WHERE guild_id=? AND type=2 ORDER BY position, id', gid);
    for (const ch of rooms) {
      if (roomPeople(ch.id).length || liveRoom(ch.id, it.id)) continue;
      if (people.every(u => !isMember(gid, u) || canConnect(ch, u))) return { ch, temp: false, why: 'empty_room' };
    }
    // 3) sala temporária: criada pelo Resenha e apagada quando esvazia
    const ch = createVoiceChannel(gid, `🎮 ${it.game_name}`.slice(0, 100), it.author_id);
    return { ch, temp: true, why: 'temp_room' };
  }

  // formação: dentro da mesma transação da entrada que completou o mínimo (nunca duas salas, nunca formar duas vezes)
  function formIfReady(it) {
    const joined = joinedIds(it.id);
    if (it.state !== 'open' || !groupState({ min: it.min_size, max: it.max_size, joined: joined.length }).reached) return null;
    const room = pickRoom(it, [it.author_id, ...joined]);
    const r = run("UPDATE play_intents SET state='formed', formed_at=?, channel_id=?, temp_channel=? WHERE id=? AND state='open'", now(), room.ch.id, room.temp ? 1 : 0, it.id);
    if (!r.changes) return null;
    return room;
  }
  // depois da transação: convites para a chamada (quem topou) e o aviso para quem criou
  function afterFormed(it, room, toInvite) {
    social.count('intent', 'formed'); social.count('intent_form_min', formBucket(now() - it.created_at));
    const cur = byId(it.id);
    for (const uid of toInvite) inviteToRoom(cur, uid);
    if (voiceChannelOf(it.author_id) !== room.ch.id) { dispatch([it.author_id], 'INTENT_FORMED', obj(cur, it.author_id)); if (!isOnline(it.author_id)) social.pull(it.author_id, 'intent_formed'); }
    broadcast(cur);
    if (groupState({ min: cur.min_size, max: cur.max_size, joined: joinedIds(cur.id).length }).full) closeFull(cur);
  }
  // convite para a chamada de sempre (toque + cartão na DM); se a pessoa não aceita ligações, o cartão da intenção avisa
  function inviteToRoom(it, uid) {
    if (voiceChannelOf(uid) === it.channel_id) return;
    const r = callInvite(it.author_id, uid, { channelId: it.channel_id, source: 'intent' });
    if (r.error) { dispatch([uid], 'INTENT_FORMED', obj(it, uid)); if (!isOnline(uid)) social.pull(uid, 'intent_formed'); }
  }
  // grupo completo: quem ainda não respondeu deixa de estar convidado (não conta como "ignorou")
  function closeFull(it) {
    const left = all("SELECT user_id FROM intent_members WHERE intent_id=? AND state='invited'", it.id).map(r => r.user_id);
    if (!left.length) return;
    run("UPDATE intent_members SET state='full' WHERE intent_id=? AND state='invited'", it.id);
    const cur = byId(it.id); for (const u of left) dispatch([u], 'INTENT_UPDATE', obj(cur, u));
  }

  // ---------------------------------------------------------------- rotas
  app.get('/api/intents/games', auth, wrap((req, res) => {
    const out = [], seen = new Set(), push = (g, source) => { const k = gameKeyOf({ appid: g.appid, lfg: g.lfg, title: g.name }); if (!k || seen.has(k)) return; seen.add(k); out.push({ ...g, key: k, source }); };
    for (const e of activity._state.current.values()) if (e.uid === req.uid) push({ name: e.game.title, appid: (e.platform === 'steam' ? e.game.id : e.game.steam) || null }, 'playing');
    for (const r of all('SELECT platform, game_id, title, data, MAX(created_at) at FROM activities WHERE user_id=? AND created_at>? GROUP BY platform, game_id ORDER BY at DESC LIMIT 6', req.uid, now() - RECENT_DAYS * 864e5)) {
      let steam = r.platform === 'steam' ? r.game_id : null; try { steam ||= JSON.parse(r.data || '{}').steam || null; } catch { }
      push({ name: r.title, appid: steam }, 'recent');
    }
    for (const g of lfgGames) if (g.id !== 'other') push({ name: g.name, lfg: g.id, appid: g.steam || null }, 'catalog');
    for (const r of all('SELECT appid, title FROM game_library WHERE user_id=? AND title IS NOT NULL ORDER BY minutes DESC LIMIT 8', req.uid)) push({ name: r.title, appid: r.appid }, 'library');
    res.json(out.map(x => ({ ...x, lfg: x.lfg || (CAT.has(x.lfg) ? x.lfg : [...CAT.values()].find(c => c.id !== 'other' && (normTitle(c.name) === normTitle(x.name) || (c.steam && c.steam === x.appid)))?.id || null) })));
  }));

  app.post('/api/intents/preview', auth, wrap((req, res) => {
    const g = gameFrom(req.body?.game); if (g.error) return bad(res, g.error);
    const r = rank(req.uid, g), dup = duplicateFor(req.uid, g.key);
    res.json({ game: g, fallback: r.fallback, candidates: r.list.map(c => candPub(c, r.by.get(c.uid))), excluded: r.excluded.length, fanout: LIMITS.fanout,
      duplicate: dup ? obj(dup, req.uid) : null, own: ownLive(req.uid) ? obj(ownLive(req.uid), req.uid) : null, guilds: guildChoices(req.uid, r.list.filter(c => c.selected).map(c => c.uid)) });
  }));
  const ownLive = (uid) => get(`SELECT * FROM play_intents WHERE author_id=? AND ${LIVE} AND expires_at>? ORDER BY created_at DESC LIMIT 1`, uid, now());
  function duplicateFor(uid, key) {
    const live = liveIntents().filter(it => it.game_key === key).map(it => ({ ...it, invited: members(it.id).map(m => m.user_id) }));
    const circle = new Set(audienceOf(uid));
    return findDuplicate(live, { gameKey: key, me: uid, visible: (a) => circle.has(a) }, now());
  }
  // servidores para a sala: os meus, com quantos dos convidados já são membros (o primeiro é o sugerido)
  function guildChoices(uid, invitees) {
    return guildsOf(uid).map(g => ({ id: g.id, name: g.name, members: invitees.filter(u => isMember(g.id, u)).length })).sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
  }

  app.post('/api/intents', auth, wrap((req, res) => {
    const b = req.body || {}, t = now();
    const g = gameFrom(b.game); if (g.error) return bad(res, g.error);
    const v = validity({ availability: b.availability, startsAt: b.starts_at, validMin: b.valid_min ?? 60 }, t); if (v.error) return bad(res, v.error);
    const sz = sizeRules({ min: b.min_size ?? 2, max: b.max_size }); if (sz.error) return bad(res, sz.error);
    const own = ownLive(req.uid); if (own) return res.status(409).json({ error: 'Você já está chamando para um jogo. Cancele antes de criar outra.', code: 'own_open', intent: obj(own, req.uid) });
    if (get('SELECT COUNT(*) n FROM play_intents WHERE author_id=? AND created_at>?', req.uid, t - 3600e3).n >= MAX_PER_HOUR) return bad(res, 'Muitas chamadas em pouco tempo; espere um pouco', 429);
    if (!b.force) { const dup = duplicateFor(req.uid, g.key); if (dup) return res.status(409).json({ error: `${userPub(dup.author_id).display_name} já está chamando para ${dup.game_name}`, code: 'duplicate', intent: obj(dup, req.uid) }); }
    const r = rank(req.uid, g, { fanout: LIMITS.fanout });
    let list = r.list;
    if (Array.isArray(b.invite_ids)) { const want = new Set(b.invite_ids.map(String)); list = list.filter(c => want.has(c.uid)); } else list = list.filter(c => c.selected);
    list = list.slice(0, LIMITS.maxInvitees);
    if (!list.length) return res.status(400).json({ error: r.list.length ? 'Escolha pelo menos uma pessoa' : 'Ninguém do seu círculo combina com esse jogo agora. Que tal publicar no mural do LFG?', code: r.list.length ? 'none_selected' : 'no_candidates' });
    let gid = b.guild_id ? String(b.guild_id) : null;
    if (gid && !isMember(gid, req.uid)) return bad(res, 'Servidor inválido');
    gid ||= guildChoices(req.uid, list.map(c => c.uid))[0]?.id || null;
    if (!gid) return bad(res, 'Entre ou crie um servidor para o Resenha montar a sala do grupo', 400);
    const id = newId();
    run(`INSERT INTO play_intents(id,author_id,game_key,game_name,appid,lfg_game,availability,starts_at,expires_at,min_size,max_size,guild_id,note,fallback,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, req.uid, g.key, g.name, g.appid, g.lfg, b.availability === 'later' ? 'later' : 'now', v.startsAt, v.expiresAt, sz.min, sz.max, gid, clean(b.note, 140) || null, r.fallback ? 1 : 0, t);
    social.count('intent', 'created', 1, req.uid);
    const it = byId(id); invite(it, list, req.uid);
    const cur = byId(id); dispatch([req.uid], 'INTENT_UPDATE', obj(cur, req.uid));
    res.json(obj(cur, req.uid));
  }));

  app.get('/api/intents', auth, wrap((req, res) => {
    const t = now();
    const mine = all(`SELECT * FROM play_intents WHERE author_id=? AND ((${LIVE} AND expires_at>?) OR COALESCE(ended_at, expires_at) > ?) ORDER BY created_at DESC LIMIT 3`, req.uid, t, t - RECENT_DONE);
    const inv = all(`SELECT i.* FROM play_intents i JOIN intent_members m ON m.intent_id=i.id WHERE m.user_id=? AND m.state IN ('invited','joined') AND i.${LIVE} AND i.expires_at>? ORDER BY i.created_at DESC LIMIT 10`, req.uid, t);
    res.json({ mine: mine.map(it => obj(it, req.uid)), invites: inv.map(it => obj(it, req.uid)), limits: { fanout: LIMITS.fanout, rx_per_hour: LIMITS.rxPerHour } });
  }));
  const intentFor = (req, res) => {
    const it = byId(req.params.id);
    if (!it || !(it.author_id === req.uid || get('SELECT 1 x FROM intent_members WHERE intent_id=? AND user_id=?', it.id, req.uid) || audienceOf(it.author_id).includes(req.uid))) { bad(res, 'Intenção não encontrada', 404); return null; }
    return it;
  };
  app.get('/api/intents/:id', auth, wrap((req, res) => { const it = intentFor(req, res); if (it) res.json(obj(it, req.uid)); }));

  app.post('/api/intents/:id/respond', auth, wrap((req, res) => {
    const it0 = intentFor(req, res); if (!it0) return;
    const action = String(req.body?.action || '');
    if (it0.author_id === req.uid) return bad(res, 'A intenção é sua');
    if (!['join', 'decline', 'leave'].includes(action)) return bad(res, 'Ação inválida');
    let formed = null, joinedNow = false, err = null;
    tx(() => {
      const it = byId(it0.id), m = get('SELECT * FROM intent_members WHERE intent_id=? AND user_id=?', it.id, req.uid), t = now();
      if (action === 'join') {
        if (m?.state === 'joined') return;
        const ok = canJoin(it, joinedIds(it.id).length, t); if (!ok.ok) { err = ok; return; }
        if (m) run("UPDATE intent_members SET state='joined', responded_at=? WHERE intent_id=? AND user_id=?", t, it.id, req.uid);
        else run("INSERT INTO intent_members(intent_id,user_id,state,delivery,reasons,invited_at,responded_at) VALUES(?,?,'joined','self','[]',?,?)", it.id, req.uid, t, t); // achou pela deduplicação
        joinedNow = true;
        formed = formIfReady(byId(it.id));
      } else if (action === 'decline') {
        if (!m || m.state !== 'invited') { err = { error: 'Nada para recusar', code: 'state' }; return; }
        run("UPDATE intent_members SET state='declined', responded_at=? WHERE intent_id=? AND user_id=?", t, it.id, req.uid);
      } else {
        if (!m || m.state !== 'joined') { err = { error: 'Você não está no grupo', code: 'state' }; return; }
        run("UPDATE intent_members SET state='left', responded_at=? WHERE intent_id=? AND user_id=?", t, it.id, req.uid);
      }
    });
    if (err) return res.status(err.code === 'full' || err.code === 'expired' || err.code === 'canceled' ? 409 : 400).json({ error: err.error, code: err.code, intent: obj(byId(it0.id), req.uid) });
    const it = byId(it0.id);
    social.count('interaction', action, 1, req.uid);
    if (action === 'join' && joinedNow) social.count('invite', 'joined', 1, req.uid);
    else if (action === 'decline') social.count('invite', 'declined', 1, req.uid);
    else if (action === 'leave') social.count('invite', 'left', 1, req.uid);
    if (action !== 'leave' && !it.responded) { run('UPDATE play_intents SET responded=1 WHERE id=?', it.id); social.count('intent_responded'); }
    if (action === 'join') social.acted(req.uid);
    if (formed) afterFormed(it, formed, joinedIds(it.id));
    else {
      if (action === 'join' && joinedNow && it.state === 'formed') inviteToRoom(it, req.uid); // grupo já formado: convite direto para a sala
      dispatch([it.author_id], 'INTENT_RESPONSE', { intent_id: it.id, action, user: userPub(req.uid), game_name: it.game_name });
      broadcast(byId(it.id));
      if (action === 'join' && it.state === 'formed' && groupState({ min: it.min_size, max: it.max_size, joined: joinedIds(it.id).length }).full) closeFull(byId(it.id));
    }
    res.json(obj(byId(it.id), req.uid));
  }));

  app.post('/api/intents/:id/more', auth, wrap((req, res) => {
    const it = intentFor(req, res); if (!it) return;
    if (it.author_id !== req.uid) return bad(res, 'Só quem chamou', 403);
    const st = statusOf(it, now()); if (st !== 'open' && st !== 'formed') return bad(res, 'Essa intenção já acabou', 409);
    const have = members(it.id); if (have.length >= LIMITS.maxInvitees) return bad(res, `No máximo ${LIMITS.maxInvitees} convidados por intenção`, 409);
    const r = rank(req.uid, { key: it.game_key, name: it.game_name, appid: it.appid, lfg: it.lfg_game }, { skip: new Set(have.map(m => m.user_id)), fanout: Math.min(LIMITS.fanout, LIMITS.maxInvitees - have.length) });
    const n = invite(it, r.list.filter(c => c.selected), req.uid);
    social.count('interaction', 'more', 1, req.uid);
    broadcast(byId(it.id));
    res.json({ ...obj(byId(it.id), req.uid), added: n });
  }));

  app.post('/api/intents/:id/cancel', auth, wrap((req, res) => {
    const it = intentFor(req, res); if (!it) return;
    if (it.author_id !== req.uid) return bad(res, 'Só quem chamou', 403);
    if (it.state === 'open' || it.state === 'formed') {
      run("UPDATE play_intents SET state='canceled', ended_at=?, end_reason='canceled' WHERE id=?", now(), it.id);
      social.count('intent', 'canceled', 1, req.uid); social.count('interaction', 'cancel', 1, req.uid);
      broadcast(byId(it.id)); dropTempIfEmpty(byId(it.id));
    }
    res.json(obj(byId(it.id), req.uid));
  }));

  app.post('/api/intents/:id/enter', auth, wrap((req, res) => {
    const it = intentFor(req, res); if (!it) return;
    const m = get('SELECT state FROM intent_members WHERE intent_id=? AND user_id=?', it.id, req.uid);
    if (it.author_id !== req.uid && m?.state !== 'joined') return bad(res, 'Topa primeiro para entrar na sala', 403);
    if (statusOf(it, now()) !== 'formed' || !it.channel_id) return res.status(409).json({ error: statusOf(it, now()) === 'open' ? 'O grupo ainda não fechou' : 'Essa sala já foi encerrada', code: 'not_formed' });
    const ch = get('SELECT * FROM channels WHERE id=?', it.channel_id); if (!ch) return res.status(410).json({ error: 'A sala não existe mais', code: 'gone' });
    if (!isMember(ch.guild_id, req.uid)) { const why = guildFull(req.uid); if (why) return res.status(409).json({ error: why, code: 'guild_limit' }); joinGuild(ch.guild_id, req.uid); } // amigo de fora do servidor (como no convite para a chamada)
    social.count('interaction', 'enter', 1, req.uid); social.acted(req.uid);
    res.json({ guild_id: ch.guild_id, channel_id: ch.id });
  }));

  app.post('/api/intents/:id/fallback', auth, wrap((req, res) => {
    const it = intentFor(req, res); if (!it) return;
    if (it.author_id !== req.uid) return bad(res, 'Só quem chamou', 403);
    social.count('interaction', 'lfg_fallback', 1, req.uid);
    const cat = it.lfg_game && CAT.get(it.lfg_game);
    res.json({ game: cat ? cat.id : 'other', game_name: it.game_name, mode: cat ? cat.modes[0] : 'Casual', slots: Math.max(1, Math.min(9, (it.max_size || it.min_size) - 1)), note: it.note || '' });
  }));

  // ---------------------------------------------------------------- tempo: expiração, fim, salas temporárias
  const busyAt = new Map(); // sala temporária -> última vez que tinha gente
  const TEMP_IDLE = () => +process.env.INTENT_TEMP_IDLE_MS || 15 * 60e3, TEMP_AFTER = () => +process.env.INTENT_TEMP_AFTER_MS || 3 * 60e3;
  function dropTemp(it, why) {
    const ch = it.channel_id && get('SELECT * FROM channels WHERE id=?', it.channel_id); busyAt.delete(it.channel_id);
    if (ch) deleteChannel(ch);
    run('UPDATE play_intents SET channel_id=NULL WHERE id=?', it.id);
    if (it.state === 'formed') { run("UPDATE play_intents SET state='ended', ended_at=?, end_reason=? WHERE id=? AND state='formed'", now(), why, it.id); social.count('intent', 'ended'); broadcast(byId(it.id)); }
  }
  const dropTempIfEmpty = (it) => { if (it.temp_channel && it.channel_id && !roomPeople(it.channel_id).length) dropTemp(it, 'room_closed'); };
  function sweep() {
    const t = now();
    for (const it of all(`SELECT * FROM play_intents WHERE ${LIVE} AND expires_at<=?`, t)) {
      const formed = it.state === 'formed';
      const r = run(`UPDATE play_intents SET state=?, ended_at=?, end_reason=? WHERE id=? AND ${LIVE}`, formed ? 'ended' : 'expired', t, formed ? 'time' : 'expired', it.id);
      if (!r.changes) continue;
      const ignored = all("SELECT user_id FROM intent_members WHERE intent_id=? AND state='invited'", it.id).map(x => x.user_id);
      run("UPDATE intent_members SET state='ignored' WHERE intent_id=? AND state='invited'", it.id);
      for (const u of ignored) social.count('invite', 'ignored', 1, u);
      social.count('intent', formed ? 'ended' : 'expired');
      const cur = byId(it.id); broadcast(cur);
      if (!formed) dispatch([it.author_id], 'INTENT_EXPIRED', obj(cur, it.author_id)); // quem criou: "ninguém topou a tempo" + plano B
      dropTempIfEmpty(cur);
    }
    // salas temporárias: apagadas quando esvaziam (3 min depois de alguém ter usado; 15 min se ninguém entrou)
    for (const it of all('SELECT * FROM play_intents WHERE temp_channel=1 AND channel_id IS NOT NULL')) {
      if (roomPeople(it.channel_id).length) { busyAt.set(it.channel_id, t); continue; }
      const used = busyAt.get(it.channel_id), since = used || it.formed_at || it.created_at;
      if (it.state !== 'formed' || t - since >= (used ? TEMP_AFTER() : TEMP_IDLE())) dropTemp(it, 'room_closed');
    }
    run('DELETE FROM play_intents WHERE created_at<? AND state NOT IN (\'open\',\'formed\')', t - KEEP_DAYS * 864e5);
  }
  const timer = setInterval(() => { try { sweep(); } catch (e) { log('[intenções] ' + e.message); } }, +process.env.INTENT_SWEEP_MS || 15000); timer.unref?.();

  return {
    sweep, stop: () => clearInterval(timer),
    // alguém entrou numa sala de voz: marca quem do grupo entrou (métrica) e se a sala é de uma intenção
    onVoiceJoin(uid, cid) {
      busyAt.set(cid, now());
      const it = get(`SELECT * FROM play_intents WHERE channel_id=? AND state='formed'`, cid);
      if (it) run('UPDATE intent_members SET entered_at=COALESCE(entered_at, ?) WHERE intent_id=? AND user_id=?', now(), it.id, uid);
      return !!it;
    },
    isIntentRoom: (cid) => !!get("SELECT 1 x FROM play_intents WHERE channel_id=? AND state='formed'", cid),
    // canal apagado por alguém (moderação): a intenção formada perde a sala
    onChannelDeleted(cid) { for (const it of all('SELECT * FROM play_intents WHERE channel_id=?', cid)) { run('UPDATE play_intents SET channel_id=NULL WHERE id=?', it.id); if (it.state === 'formed') { run("UPDATE play_intents SET state='ended', ended_at=?, end_reason='room_closed' WHERE id=?", now(), it.id); broadcast(byId(it.id)); } } },
  };
}
