// Memória do grupo: sessões de voz de servidor guardadas para sempre (quem esteve, quando, quanto tempo e o que rolou),
// para o "Desde a última vez" (server/routes/sessions.js) e o que vier depois (Nesta data, retrospectivas).
//
// REGRAS
//   sessão = período com 2+ pessoas (sem bots) numa sala de voz de SERVIDOR; DM fica de fora (é 1:1 e cifrada).
//   abre ao chegar a 2+; fecha quando cai para <2 e continua assim por GRACE (60 s): voltou a 2+ na carência, é a mesma.
//   ended_at = quando caiu para <2. Durou menos que MIN (3 min): descartada (apaga as linhas).
//   cada pessoa: first_at, last_at e secs = soma dos trechos em que esteve na sala (sai e volta: soma).
//   quem desligou "Guardar minhas sessões no histórico do grupo" (privacy.memory.sessions) não vira participante; só conta
//   no pico (peak), sem nome.
//   summary (JSON, no fechamento): { games: [{ title, game_id, platform, mins, people }], clips, watch, music } — jogos
//   sem nomes, só partidas não privadas e não escondidas (activity.gamesDuring); clipes da sala na janela; vídeos do
//   Assistir junto que começaram na sala (contados em memória); música: 0 (o bot não informa as faixas a ninguém).
//   event_id / intent_id: evento acontecendo naquela sala ou intenção formada nela durante a sessão.
//   sala apagada: a sessão fica (channel_id sem chave estrangeira; o nome da época fica em channel_name).
// ESCRITAS: uma linha ao abrir, uma por pessoa ao entrar, uma ao sair, o fechamento; e, para sobreviver a uma queda do
//   processo, um retrato a cada FLUSH (5 min) e no encerramento (só o tempo de quem está na sala). Nada por segundo.
// REINÍCIO DO APP: as chamadas continuam no processo da voz e os apps retomam. Sessões com ended_at nulo ganham RECOVER
//   (3 min): se a sala tiver 2+ pessoas (no próximo aviso de entrada/saída ou ao fim do prazo), a sessão continua; senão
//   fecha com o maior last_at dos participantes.
// Testes: scripts/voice-sessions-unit-test.mjs (sem servidor) e scripts/memory-since-test.mjs (servidor real).
const envMs = (k, d) => (+process.env[k] > 0 ? +process.env[k] : d); // VOICE_SESSION_*: só para os testes
export const SESSION_MIN_MS = envMs('VOICE_SESSION_MIN_MS', 3 * 60e3);
export const SESSION_GRACE_MS = envMs('VOICE_SESSION_GRACE_MS', 60e3);
export const SESSION_RECOVER_MS = envMs('VOICE_SESSION_RECOVER_MS', 3 * 60e3);
const FLUSH_MS = 5 * 60e3;

export function createVoiceSessions({ db, all, get, run, newId, now = () => Date.now(), log = () => { },
  roomOf = () => [],           // cid -> [{ id, bot, at }] quem está na sala agora (at = quando entrou)
  channelOf = () => null,      // cid -> { guild_id, name } (DM: guild_id nulo; apagada: null)
  remembers = () => true,      // uid -> entra como participante? (privacy.memory.sessions)
  gamesDuring = () => [],      // (uids, from, to) -> [{ title, game_id, platform, mins, people }]
  schedule = (fn, ms) => setTimeout(fn, ms).unref?.(), // testes passam um que não faz nada e chamam sweep()
  minMs = SESSION_MIN_MS, graceMs = SESSION_GRACE_MS, recoverMs = SESSION_RECOVER_MS } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS voice_sessions(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL, channel_name TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, peak INTEGER NOT NULL DEFAULT 2,
    intent_id TEXT, event_id TEXT, summary TEXT);
  CREATE INDEX IF NOT EXISTS voice_sessions_guild ON voice_sessions(guild_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS voice_sessions_ended ON voice_sessions(ended_at);
  CREATE TABLE IF NOT EXISTS voice_session_members(session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
    secs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id, user_id));
  CREATE INDEX IF NOT EXISTS voice_session_members_user ON voice_session_members(user_id, first_at DESC);
  CREATE TABLE IF NOT EXISTS memory_seen(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, seen_at INTEGER NOT NULL);`);

  const bootAt = now();
  // cid -> { id, gid, start, peak, members: Map<uid, segStart|null>, dropAt, watch }
  const live = new Map();
  // sessões que estavam abertas quando o app parou: cid -> { row, deadline }
  const pending = new Map();
  for (const r of all('SELECT * FROM voice_sessions WHERE ended_at IS NULL')) pending.set(r.channel_id, { row: r, deadline: bootAt + recoverMs });
  if (pending.size) schedule(sweep, recoverMs + 50);

  const people = (cid) => roomOf(cid).filter(p => p && !p.bot && !String(p.id).startsWith('bot_'));
  const safe = (what, fn) => { try { return fn(); } catch (e) { log(`[sessões] ${what}: ${e.message}`); return null; } };

  function addMember(s, uid, t) {
    if (s.members.has(uid)) { if (s.members.get(uid) == null) s.members.set(uid, t); return; }
    if (s.out.has(uid) || !remembers(uid)) return; // só conta no pico
    s.members.set(uid, t);
    safe('participante', () => run('INSERT INTO voice_session_members(session_id,user_id,first_at,last_at,secs) VALUES(?,?,?,?,0) ON CONFLICT(session_id,user_id) DO NOTHING', s.id, uid, t, t));
  }
  // fecha o trecho de quem saiu (ou de todos, no fechamento/retrato): soma os segundos e marca last_at
  function endSeg(s, uid, t) {
    const seg = s.members.get(uid); if (seg == null) return;
    const ms = Math.max(0, t - seg);
    s.members.set(uid, null);
    safe('saída', () => run('UPDATE voice_session_members SET secs=secs+?, last_at=MAX(last_at,?) WHERE session_id=? AND user_id=?', Math.round(ms / 1000), Math.max(seg, t), s.id, uid));
  }
  function open(cid, ch, ps, t) {
    const s = { id: newId(), gid: ch.guild_id, cid, start: t, peak: ps.length, members: new Map(), out: new Set(), dropAt: null, watch: 0 };
    run('INSERT INTO voice_sessions(id,guild_id,channel_id,channel_name,started_at,peak) VALUES(?,?,?,?,?,?)', s.id, ch.guild_id, cid, ch.name || null, t, ps.length);
    live.set(cid, s);
    return s;
  }
  // reaproveita a sessão que estava aberta antes do reinício: quem está na sala agora continua de onde o app voltou
  function adopt(cid) {
    const p = pending.get(cid); pending.delete(cid);
    const r = p.row, s = { id: r.id, gid: r.guild_id, cid, start: r.started_at, peak: r.peak, members: new Map(), out: new Set(), dropAt: null, watch: 0 };
    for (const m of all('SELECT user_id FROM voice_session_members WHERE session_id=?', r.id)) s.members.set(m.user_id, null);
    live.set(cid, s);
    for (const x of people(cid)) { if (s.members.has(x.id)) s.members.set(x.id, Math.max(bootAt, +x.at || bootAt)); else addMember(s, x.id, Math.max(bootAt, +x.at || bootAt)); }
    log(`[sessões] sessão ${r.id} continua depois do reinício`);
    return s;
  }

  // chamado depois de cada entrada/saída de uma sala (o mesmo gancho das métricas sociais)
  function onVoice(cid) {
    return safe('onVoice', () => {
      const t = now(), ps = people(cid);
      let s = live.get(cid);
      if (!s && pending.has(cid) && ps.length >= 2) s = adopt(cid);
      if (!s) {
        if (ps.length < 2) return;
        const ch = channelOf(cid); if (!ch?.guild_id) return; // DM (ou sala que não existe mais)
        s = open(cid, ch, ps, t);
      }
      const here = new Set(ps.map(p => p.id));
      for (const [uid, seg] of s.members) if (seg != null && !here.has(uid)) endSeg(s, uid, t);
      for (const p of ps) addMember(s, p.id, t);
      s.peak = Math.max(s.peak, ps.length);
      if (ps.length >= 2) s.dropAt = null;
      else if (s.dropAt == null) { s.dropAt = t; schedule(sweep, graceMs + 50); }
    });
  }

  function summarize(s, start, end) {
    const uids = [...s.members.keys()];
    const games = safe('jogos', () => gamesDuring(uids, start, end)) || [];
    const clips = safe('clipes', () => get('SELECT COUNT(*) n FROM clips WHERE channel_id=? AND created_at>=? AND created_at<=?', s.cid, start, end)?.n) || 0;
    const ev = safe('evento', () => get(`SELECT id FROM events WHERE guild_id=? AND channel_id=? AND cancelled_at IS NULL AND started_at IS NOT NULL
      AND starts_at<=? AND starts_at + duration_min*60000 >= ? ORDER BY starts_at DESC LIMIT 1`, s.gid, s.cid, end, start)?.id) || null;
    const it = safe('intenção', () => get(`SELECT id FROM play_intents WHERE channel_id=? AND formed_at IS NOT NULL AND formed_at<=? AND (ended_at IS NULL OR ended_at>=?)
      ORDER BY formed_at DESC LIMIT 1`, s.cid, end, start)?.id) || null;
    return { summary: { games, clips, watch: s.watch || 0, music: 0 }, event_id: ev, intent_id: it };
  }
  function close(s, end) {
    live.delete(s.cid);
    if (end - s.start < minMs) { discard(s.id); return null; }
    for (const uid of s.members.keys()) endSeg(s, uid, end);
    const x = summarize(s, s.start, end);
    safe('fechamento', () => run('UPDATE voice_sessions SET ended_at=?, peak=?, summary=?, event_id=?, intent_id=? WHERE id=?', end, s.peak, JSON.stringify(x.summary), x.event_id, x.intent_id, s.id));
    return s.id;
  }
  const discard = (id) => safe('descarte', () => { run('DELETE FROM voice_session_members WHERE session_id=?', id); run('DELETE FROM voice_sessions WHERE id=?', id); });

  // prazos vencidos: carência de 60 s das salas que caíram para <2 e a de 3 min das sessões de antes do reinício
  function sweep() {
    return safe('sweep', () => {
      const t = now();
      for (const s of [...live.values()]) if (s.dropAt != null && t - s.dropAt >= graceMs) {
        if (people(s.cid).length >= 2) s.dropAt = null; else close(s, s.dropAt);
      }
      for (const [cid, p] of [...pending]) if (t >= p.deadline) {
        if (people(cid).length >= 2) { adopt(cid); onVoice(cid); continue; }
        pending.delete(cid);
        const r = p.row, last = get('SELECT MAX(last_at) t FROM voice_session_members WHERE session_id=?', r.id)?.t || r.started_at;
        const s = { id: r.id, gid: r.guild_id, cid, start: r.started_at, peak: r.peak, members: new Map(all('SELECT user_id FROM voice_session_members WHERE session_id=?', r.id).map(m => [m.user_id, null])), watch: 0 };
        close(s, Math.max(r.started_at, last));
      }
    });
  }
  // retrato: soma o tempo de quem está na sala (sem fechar nada), para uma queda do processo não perder a sessão
  function flush() {
    const t = now();
    for (const s of live.values()) {
      for (const [uid, seg] of s.members) if (seg != null) { endSeg(s, uid, t); s.members.set(uid, t); }
      safe('retrato', () => run('UPDATE voice_sessions SET peak=? WHERE id=?', s.peak, s.id));
    }
  }
  const flushT = setInterval(flush, FLUSH_MS); flushT.unref?.();

  return {
    onVoice, sweep, flush,
    stop() { clearInterval(flushT); flush(); },
    // vídeo do Assistir junto começou nesta sala (server/watch.js)
    onWatch(cid) { const s = live.get(cid); if (s) s.watch++; },
    // a pessoa tirou a própria participação: sai da sessão (inclusive da que está acontecendo) e não volta a entrar nela
    removeMember(id, uid) {
      const r = run('DELETE FROM voice_session_members WHERE session_id=? AND user_id=?', id, uid);
      for (const s of live.values()) if (s.id === id) { s.members.delete(uid); s.out.add(uid); }
      return r.changes > 0;
    },
    removeSession(id) {
      for (const s of [...live.values()]) if (s.id === id) live.delete(s.cid);
      for (const [cid, p] of [...pending]) if (p.row.id === id) pending.delete(cid);
      const ok = !!get('SELECT 1 x FROM voice_sessions WHERE id=?', id); discard(id); return ok;
    },
    _state: { live, pending },
  };
}
