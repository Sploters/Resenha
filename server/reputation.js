// Moderação comunitária por reputação (anti-toxicidade dinâmica).
// Entre "nada acontece" e "banido" existe um meio-termo automático: quando VÁRIAS pessoas diferentes marcam mensagens de
// alguém como spam/ofensivas (ou bloqueiam a pessoa logo depois de ela falar) num intervalo curto, o próprio servidor
// aplica um "soft-mute" preventivo: a pessoa continua no chat, mas só envia 1 mensagem a cada N segundos (padrão 2 min)
// até um moderador analisar o caso. Ninguém é banido por robô; o moderador decide (liberar, castigo ou banir).
// Proteções contra uso injusto:
// - conta 1 voto por pessoa (não importa quantas mensagens ela marque) e só sinais dos últimos 10 min;
// - quem entrou no servidor há menos de 10 min não conta (contas novas de "brigada");
// - quem marcou e o moderador considerou falso alarme 2+ vezes em 30 dias deixa de contar;
// - donos e moderadores (Moderar membros / Gerenciar mensagens) nunca são limitados;
// - liberar um caso zera os sinais anteriores; o limite some sozinho em 24 h se ninguém analisar.
const WINDOW = 10 * 60e3, MSG_AGE = 30 * 60e3, NEW_MEMBER = 10 * 60e3, AUTO_EXPIRE = 24 * 3600e3, FALSE_WINDOW = 30 * 86400e3;
const KINDS = new Set(['spam', 'toxic', 'block']);
export const REP_DEFAULTS = { on: true, threshold: 3, slow: 120 };

export function createReputation({ db, all, get, run, newId, can, P, dispatch, guildMemberIds, memberObj, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS rep_flags(message_id TEXT NOT NULL, guild_id TEXT NOT NULL, target_id TEXT NOT NULL, user_id TEXT NOT NULL,
      kind TEXT NOT NULL, created_at INTEGER NOT NULL, outcome TEXT, PRIMARY KEY(message_id, user_id));
    CREATE INDEX IF NOT EXISTS idx_rep_flags_target ON rep_flags(guild_id, target_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rep_flags_user ON rep_flags(user_id, outcome, created_at);
    CREATE TABLE IF NOT EXISTS rep_cases(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
      state TEXT NOT NULL, flaggers INTEGER DEFAULT 0, created_at INTEGER, resolved_by TEXT, resolved_at INTEGER, outcome TEXT);
    CREATE INDEX IF NOT EXISTS idx_rep_cases_guild ON rep_cases(guild_id, state, created_at);`);
  try { db.exec('ALTER TABLE members ADD COLUMN softmute_until INTEGER'); } catch { /* já existe */ }
  try { db.exec('ALTER TABLE guilds ADD COLUMN rep_settings TEXT'); } catch { /* já existe */ }

  const settings = (gid) => { let s = {}; try { s = JSON.parse(get('SELECT rep_settings s FROM guilds WHERE id=?', gid)?.s || '{}'); } catch { } return { ...REP_DEFAULTS, ...s }; };
  const immune = (gid, uid) => get('SELECT owner_id o FROM guilds WHERE id=?', gid)?.o === uid || can(gid, uid, P.MODERATE) || can(gid, uid, P.MANAGE_MESSAGES);
  const isMod = immune;
  const modsOf = (gid) => guildMemberIds(gid).filter(u => isMod(gid, u));
  const until = (gid, uid) => get('SELECT softmute_until t FROM members WHERE guild_id=? AND user_id=?', gid, uid)?.t || 0;
  const openCase = (gid, uid) => get("SELECT * FROM rep_cases WHERE guild_id=? AND user_id=? AND state='open' ORDER BY created_at DESC LIMIT 1", gid, uid);
  const lastCleared = (gid, uid) => get("SELECT MAX(resolved_at) t FROM rep_cases WHERE guild_id=? AND user_id=? AND state<>'open'", gid, uid)?.t || 0;
  const memberUpdate = (gid, uid) => dispatch(guildMemberIds(gid), 'MEMBER_UPDATE', { guild_id: gid, ...memberObj(gid, uid) });

  // quem pode votar agora: membro há 10+ min e sem histórico de falso alarme
  function counts(gid, voter, now) {
    const m = get('SELECT joined_at j FROM members WHERE guild_id=? AND user_id=?', gid, voter);
    if (!m || now - (m.j || 0) < NEW_MEMBER) return false;
    return (get("SELECT COUNT(*) n FROM rep_flags WHERE user_id=? AND outcome='false' AND created_at>?", voter, now - FALSE_WINDOW)?.n || 0) < 2;
  }
  // pessoas diferentes que marcaram `target` na janela (depois do último caso resolvido)
  function voters(gid, target, now) {
    const from = Math.max(now - WINDOW, lastCleared(gid, target));
    return [...new Set(all('SELECT user_id FROM rep_flags WHERE guild_id=? AND target_id=? AND created_at>? AND outcome IS NULL', gid, target, from).map(r => r.user_id))]
      .filter(v => counts(gid, v, now));
  }
  function evaluate(gid, target) {
    const s = settings(gid), now = Date.now();
    if (!s.on || immune(gid, target)) return null;
    const v = voters(gid, target, now), c = openCase(gid, target);
    if (c) { run('UPDATE rep_cases SET flaggers=? WHERE id=?', Math.max(c.flaggers, v.length), c.id); return null; }
    if (v.length < s.threshold || until(gid, target) > now) return null;
    const id = newId();
    run('INSERT INTO rep_cases(id,guild_id,user_id,state,flaggers,created_at) VALUES(?,?,?,?,?,?)', id, gid, target, 'open', v.length, now);
    run('UPDATE members SET softmute_until=? WHERE guild_id=? AND user_id=?', now + AUTO_EXPIRE, gid, target);
    audit(gid, null, 'member_softmute', target, `${v.length} pessoas marcaram em 10 min`);
    memberUpdate(gid, target);
    dispatch(modsOf(gid), 'REP_CASE', { guild_id: gid, user_id: target, case_id: id, flaggers: v.length });
    return id;
  }

  // sinal de uma pessoa sobre uma mensagem (menu da mensagem → Marcar como spam / Denunciar como ofensiva)
  function flag(uid, msg, ch, kind) {
    if (!ch.guild_id) return { error: 'Só em servidores' };
    if (!KINDS.has(kind)) return { error: 'Tipo inválido' };
    if (msg.author_id === uid) return { error: 'Não dá para marcar a própria mensagem' };
    const now = Date.now();
    run('INSERT OR IGNORE INTO rep_flags(message_id,guild_id,target_id,user_id,kind,created_at) VALUES(?,?,?,?,?,?)', msg.id, ch.guild_id, msg.author_id, uid, kind, now);
    // mensagem antiga: fica registrada para a moderação, mas não dispara o limite (a proteção é para o chat em tempo real)
    const fresh = now - (msg.created_at || 0) <= MSG_AGE;
    return { ok: true, counted: fresh && counts(ch.guild_id, uid, now), case_id: fresh ? evaluate(ch.guild_id, msg.author_id) : null };
  }
  const unflag = (uid, mid) => run('DELETE FROM rep_flags WHERE message_id=? AND user_id=? AND outcome IS NULL', mid, uid);
  // bloquear alguém logo depois de ele falar num servidor em comum também é um sinal (na mensagem mais recente dele)
  function onBlock(uid, target) {
    const since = Date.now() - WINDOW;
    for (const r of all(`SELECT m.id, m.author_id, m.created_at, c.guild_id FROM messages m JOIN channels c ON c.id=m.channel_id
        WHERE m.author_id=? AND m.created_at>? AND c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?)
        AND m.id = (SELECT MAX(m2.id) FROM messages m2 JOIN channels c2 ON c2.id=m2.channel_id WHERE m2.author_id=m.author_id AND c2.guild_id=c.guild_id)`, target, since, uid))
      flag(uid, r, { guild_id: r.guild_id }, 'block');
  }
  // antes de enviar: limitado? devolve em quantos segundos pode mandar a próxima (0 = pode agora)
  function slowWait(gid, uid) {
    if (!gid) return 0;
    const t = until(gid, uid), now = Date.now(); if (!(t > now)) return 0;
    const s = settings(gid);
    const last = get('SELECT MAX(m.created_at) t FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.author_id=? AND c.guild_id=?', uid, gid)?.t || 0;
    return Math.max(0, Math.ceil((last + s.slow * 1000 - now) / 1000));
  }
  // moderador resolve: 'clear' (falso alarme: libera e quem marcou perde peso) ou 'confirm' (era mesmo: libera o limite,
  // normalmente seguido de castigo/banimento pelo moderador; quem marcou ganha razão)
  function resolve(gid, target, by, action) {
    const now = Date.now(), c = openCase(gid, target);
    const outcome = action === 'confirm' ? 'true' : 'false';
    run('UPDATE rep_flags SET outcome=? WHERE guild_id=? AND target_id=? AND outcome IS NULL', outcome, gid, target);
    if (c) run('UPDATE rep_cases SET state=?, resolved_by=?, resolved_at=?, outcome=? WHERE id=?', action === 'confirm' ? 'confirmed' : 'cleared', by, now, outcome, c.id);
    run('UPDATE members SET softmute_until=NULL WHERE guild_id=? AND user_id=?', gid, target);
    audit(gid, by, action === 'confirm' ? 'member_softmute_confirm' : 'member_softmute_clear', target, '');
    memberUpdate(gid, target);
    dispatch(modsOf(gid), 'REP_CASE', { guild_id: gid, user_id: target, resolved: true });
  }
  // casos que expiraram sem análise (de hora em hora)
  setInterval(() => {
    const now = Date.now();
    for (const m of all('SELECT guild_id, user_id FROM members WHERE softmute_until IS NOT NULL AND softmute_until<=?', now)) {
      run('UPDATE members SET softmute_until=NULL WHERE guild_id=? AND user_id=?', m.guild_id, m.user_id);
      run("UPDATE rep_cases SET state='expired', resolved_at=? WHERE guild_id=? AND user_id=? AND state='open'", now, m.guild_id, m.user_id);
      memberUpdate(m.guild_id, m.user_id);
    }
  }, 3600e3).unref();

  function caseList(gid, state) {
    const rows = state === 'open'
      ? all("SELECT * FROM rep_cases WHERE guild_id=? AND state='open' ORDER BY created_at DESC LIMIT 100", gid)
      : all("SELECT * FROM rep_cases WHERE guild_id=? AND state<>'open' ORDER BY resolved_at DESC LIMIT 50", gid);
    return rows.map(c => {
      const from = c.created_at - WINDOW - MSG_AGE;
      const msgs = all(`SELECT m.id, m.channel_id, m.content, m.created_at, COUNT(f.user_id) n, GROUP_CONCAT(DISTINCT f.kind) kinds
        FROM rep_flags f JOIN messages m ON m.id=f.message_id WHERE f.guild_id=? AND f.target_id=? AND f.created_at>=? AND f.created_at<=?
        GROUP BY m.id ORDER BY m.id DESC LIMIT 10`, gid, c.user_id, from, c.resolved_at || Date.now());
      return { ...c, softmute_until: c.state === 'open' ? until(gid, c.user_id) || null : null, messages: msgs.map(m => ({ ...m, content: String(m.content || '').slice(0, 400), kinds: String(m.kinds || '').split(',') })) };
    });
  }

  function mount(app, { auth, wrap, bad, channelFor }) {
    app.post('/api/channels/:id/messages/:mid/flag', auth, wrap((req, res) => {
      const ch = channelFor(req, res); if (!ch) return;
      const m = get('SELECT id, author_id, created_at FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
      if (!m) return bad(res, 'Mensagem não encontrada', 404);
      const r = flag(req.uid, m, ch, String(req.body.kind || 'spam'));
      if (r.error) return bad(res, r.error);
      res.json(r);
    }));
    app.delete('/api/channels/:id/messages/:mid/flag', auth, wrap((req, res) => {
      const ch = channelFor(req, res); if (!ch) return;
      unflag(req.uid, String(req.params.mid)); res.json({});
    }));
    const modOnly = (req, res) => { const gid = req.params.gid; if (!isMod(gid, req.uid)) { bad(res, 'Sem permissão', 403); return null; } return gid; };
    app.get('/api/guilds/:gid/reputation', auth, wrap((req, res) => {
      const gid = modOnly(req, res); if (!gid) return;
      res.json({ settings: settings(gid), open: caseList(gid, 'open'), closed: caseList(gid, 'closed') });
    }));
    app.patch('/api/guilds/:gid/reputation', auth, wrap((req, res) => {
      const gid = req.params.gid;
      if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
      const s = settings(gid), b = req.body || {};
      if (typeof b.on === 'boolean') s.on = b.on;
      if (b.threshold !== undefined) s.threshold = Math.max(2, Math.min(20, Math.round(+b.threshold) || 3));
      if (b.slow !== undefined) s.slow = Math.max(30, Math.min(3600, Math.round(+b.slow) || 120));
      run('UPDATE guilds SET rep_settings=? WHERE id=?', JSON.stringify(s), gid);
      audit(gid, req.uid, 'guild_update', null, 'reputação: ' + (s.on ? `ligada, ${s.threshold} pessoas, 1 msg a cada ${s.slow}s` : 'desligada'));
      res.json(s);
    }));
    app.post('/api/guilds/:gid/reputation/:uid/resolve', auth, wrap((req, res) => {
      const gid = modOnly(req, res); if (!gid) return;
      const action = req.body?.action === 'confirm' ? 'confirm' : 'clear';
      if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.params.uid) && !openCase(gid, req.params.uid)) return bad(res, 'Membro não encontrado', 404);
      resolve(gid, req.params.uid, req.uid, action); res.json({});
    }));
  }
  return { flag, onBlock, slowWait, settings, mount, evaluate };
}
