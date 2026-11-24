// Central de boas-vindas do servidor: o que um membro novo vê ao entrar (apresentação, regras, perguntas de interesse e
// canais recomendados), configurada pelo admin nas configurações do servidor, sem bot.
//
// Configuração (uma por servidor, guild_onboarding.data em JSON):
//   { enabled, intro, rules: [texto], require_rules, channels: [ids recomendados para todos],
//     questions: [{ id, title, multi, options: [{ id, label, emoji, desc, roles: [ids], channels: [ids] }] }] }
// Cargos das opções: só os abaixo do cargo mais alto de quem configura e sem permissão de moderação/administração (a
// resposta do membro dá o cargo sozinha, então não pode virar porta para permissões). Conferido de novo ao concluir.
// Regras obrigatórias: até aceitar, o membro não manda mensagem no servidor (server/routes/messages.js → mustAccept);
// quem gerencia o servidor não passa por isso.
//
// Membro (member_onboarding): rules_at (aceitou), done_at (concluiu), answers ({ pergunta: [opções] }). Sai do servidor:
// a linha some junto (FK), e ao voltar a central aparece de novo.
//
// Rotas:
//   GET  /api/guilds/:id/onboarding            { config, me: { rules_at, done_at, answers } }
//   PUT  /api/guilds/:id/onboarding            (Gerenciar servidor) a configuração inteira
//   POST /api/guilds/:id/onboarding/complete   { rules: bool, answers } → dá/tira os cargos das opções escolhidas
// Evento: GUILD_ONBOARDING_UPDATE { guild_id, onboarding: summary } para os membros quando a configuração muda.
export const LIMITS = { intro: 1000, rules: 20, rule: 300, questions: 6, options: 12, title: 100, label: 60, desc: 100, emoji: 16, roles: 5, channels: 10 };

export function mountOnboarding(app, d) {
  const { auth, wrap, bad, db, all, get, run, dispatch, guildMemberIds, memberObj, refreshVoicePerms, can, P, rankOf, audit, clean } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS guild_onboarding(guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER);
  CREATE TABLE IF NOT EXISTS member_onboarding(guild_id TEXT NOT NULL, user_id TEXT NOT NULL, rules_at INTEGER, done_at INTEGER, answers TEXT DEFAULT '{}',
    PRIMARY KEY(guild_id, user_id), FOREIGN KEY(guild_id, user_id) REFERENCES members(guild_id, user_id) ON DELETE CASCADE);`);
  // permissões que um cargo dado pela resposta do membro não pode ter
  const DANGER = P.ADMIN | P.MANAGE_GUILD | P.MANAGE_CHANNELS | P.MANAGE_MESSAGES | P.KICK | P.MANAGE_ROLES | P.BAN | P.MODERATE | P.VOICE_MOD | P.VIEW_MSGLOG;
  const cache = new Map(); // guild_id -> config (ou null)
  const EMPTY = { enabled: false, intro: '', rules: [], require_rules: false, channels: [], questions: [] };
  function config(gid) {
    if (cache.has(gid)) return cache.get(gid);
    const r = get('SELECT data, updated_at FROM guild_onboarding WHERE guild_id=?', gid);
    let c = null; if (r) { try { c = { ...EMPTY, ...JSON.parse(r.data), v: r.updated_at || 0 }; } catch { c = null; } }
    cache.set(gid, c); return c;
  }
  // o que vai no guildFull (todo mundo do servidor): ligado, regras obrigatórias e a versão
  const summary = (gid) => { const c = config(gid); return c?.enabled ? { enabled: true, require_rules: !!(c.require_rules && c.rules.length), v: c.v } : null; };
  const isMember = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const meOf = (gid, uid) => { const r = get('SELECT rules_at, done_at, answers FROM member_onboarding WHERE guild_id=? AND user_id=?', gid, uid); let answers = {}; try { answers = JSON.parse(r?.answers || '{}') || {}; } catch { } return { rules_at: r?.rules_at || null, done_at: r?.done_at || null, answers }; };
  const exempt = (gid, uid) => get('SELECT owner_id FROM guilds WHERE id=?', gid)?.owner_id === uid || can(gid, uid, P.MANAGE_GUILD);
  // regras obrigatórias ainda não aceitas: não manda mensagem (texto do erro mostrado no app)
  function mustAccept(gid, uid) {
    if (!gid) return false;
    const c = config(gid); if (!c?.enabled || !c.require_rules || !c.rules.length) return false;
    return !get('SELECT rules_at FROM member_onboarding WHERE guild_id=? AND user_id=?', gid, uid)?.rules_at && !exempt(gid, uid);
  }
  const safeRole = (r) => r && !((r.perms | 0) & DANGER);

  // ---- validação da configuração (o que não vale é descartado; cargo proibido = erro, para o admin saber) ----
  function sanitize(gid, uid, b) {
    const txt = (v, n) => clean(String(v ?? ''), n) || '';
    const id = (v, used) => { let s = /^[a-z0-9]{1,16}$/i.test(String(v || '')) ? String(v) : ''; while (!s || used.has(s)) s = Math.random().toString(36).slice(2, 10); used.add(s); return s; };
    const roles = new Map(all('SELECT id, name, perms, position FROM roles WHERE guild_id=?', gid).map(r => [r.id, r]));
    const chans = new Set(all('SELECT id FROM channels WHERE guild_id=? AND type NOT IN (4, 11)', gid).map(c => c.id));
    const mine = rankOf(gid, uid);
    const chList = (l) => [...new Set((Array.isArray(l) ? l : []).map(String))].filter(x => chans.has(x)).slice(0, LIMITS.channels);
    const roleList = (l) => {
      const out = [];
      for (const rid of [...new Set((Array.isArray(l) ? l : []).map(String))].slice(0, LIMITS.roles)) {
        const r = roles.get(rid); if (!r) continue;
        if (!safeRole(r)) throw new Error(`O cargo "${r.name}" tem permissões de moderação ou administração e não pode ser dado pelas respostas`);
        if (r.position >= mine) throw new Error(`O cargo "${r.name}" está igual ou acima do seu cargo mais alto`);
        out.push(rid);
      }
      return out;
    };
    const qIds = new Set();
    const questions = (Array.isArray(b.questions) ? b.questions : []).slice(0, LIMITS.questions).map(q => {
      const oIds = new Set();
      const options = (Array.isArray(q?.options) ? q.options : []).slice(0, LIMITS.options).map(o => ({ id: id(o?.id, oIds), label: txt(o?.label, LIMITS.label), emoji: txt(o?.emoji, LIMITS.emoji), desc: txt(o?.desc, LIMITS.desc), roles: roleList(o?.roles), channels: chList(o?.channels) })).filter(o => o.label);
      return { id: id(q?.id, qIds), title: txt(q?.title, LIMITS.title), multi: q?.multi !== false, options };
    }).filter(q => q.title && q.options.length);
    const rules = (Array.isArray(b.rules) ? b.rules : []).map(r => txt(r, LIMITS.rule)).filter(Boolean).slice(0, LIMITS.rules);
    return { enabled: !!b.enabled, intro: txt(b.intro, LIMITS.intro), rules, require_rules: !!b.require_rules && rules.length > 0, channels: chList(b.channels), questions };
  }

  app.get('/api/guilds/:id/onboarding', auth, wrap((req, res) => {
    const gid = req.params.id; if (!isMember(gid, req.uid)) return bad(res, 'Sem permissão', 403);
    const c = config(gid), { v, ...cfg } = c || EMPTY;
    res.json({ config: cfg, v: v || 0, me: meOf(gid, req.uid), can_edit: can(gid, req.uid, P.MANAGE_GUILD) });
  }));
  app.put('/api/guilds/:id/onboarding', auth, wrap((req, res) => {
    const gid = req.params.id; if (!can(gid, req.uid, P.MANAGE_GUILD)) return bad(res, 'Sem permissão', 403);
    let c; try { c = sanitize(gid, req.uid, req.body || {}); } catch (e) { return bad(res, e.message); }
    if (c.enabled && !c.intro && !c.rules.length && !c.questions.length && !c.channels.length) return bad(res, 'Escreva uma apresentação, regras, perguntas ou canais recomendados antes de ligar');
    const now = Date.now();
    run('INSERT INTO guild_onboarding(guild_id, data, updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', gid, JSON.stringify(c), now);
    cache.delete(gid);
    audit?.(gid, req.uid, 'onboarding_update', null, c.enabled ? 'ligada' : 'desligada');
    dispatch(guildMemberIds(gid), 'GUILD_ONBOARDING_UPDATE', { guild_id: gid, onboarding: summary(gid) });
    res.json({ config: c, v: now });
  }));
  app.post('/api/guilds/:id/onboarding/complete', auth, wrap((req, res) => {
    const gid = req.params.id, uid = req.uid; if (!isMember(gid, uid)) return bad(res, 'Sem permissão', 403);
    const c = config(gid); if (!c?.enabled) return bad(res, 'A central de boas-vindas está desligada');
    const prev = meOf(gid, uid), now = Date.now();
    const rulesOk = !!prev.rules_at || !!req.body?.rules;
    if (c.require_rules && c.rules.length && !rulesOk) return bad(res, 'Aceite as regras para continuar');
    // respostas válidas na configuração atual (pergunta de escolha única guarda só a primeira)
    const raw = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {}, answers = {};
    for (const q of c.questions) {
      const ids = new Set(q.options.map(o => o.id)), got = [...new Set((Array.isArray(raw[q.id]) ? raw[q.id] : []).map(String))].filter(x => ids.has(x));
      if (got.length) answers[q.id] = q.multi ? got : got.slice(0, 1);
    }
    const rolesFrom = (ans) => new Set(c.questions.flatMap(q => q.options.filter(o => (ans[q.id] || []).includes(o.id)).flatMap(o => o.roles)));
    const want = rolesFrom(answers), had = rolesFrom(prev.answers);
    const roles = new Map(all('SELECT id, perms FROM roles WHERE guild_id=?', gid).map(r => [r.id, r]));
    const cur = new Set(all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid).map(r => r.role_id));
    const added = [], removed = [];
    for (const rid of want) if (!cur.has(rid) && safeRole(roles.get(rid))) { run('INSERT OR IGNORE INTO member_roles VALUES(?,?,?)', gid, uid, rid); added.push(rid); }
    for (const rid of had) if (!want.has(rid) && cur.has(rid) && safeRole(roles.get(rid))) { run('DELETE FROM member_roles WHERE guild_id=? AND user_id=? AND role_id=?', gid, uid, rid); removed.push(rid); }
    run(`INSERT INTO member_onboarding(guild_id, user_id, rules_at, done_at, answers) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET rules_at=COALESCE(member_onboarding.rules_at, excluded.rules_at), done_at=excluded.done_at, answers=excluded.answers`,
      gid, uid, rulesOk ? (prev.rules_at || now) : null, now, JSON.stringify(answers));
    if (added.length || removed.length) {
      dispatch(guildMemberIds(gid), 'MEMBER_UPDATE', { guild_id: gid, ...memberObj(gid, uid) });
      refreshVoicePerms?.(gid);
    }
    res.json({ me: meOf(gid, uid), added, removed });
  }));
  return { summary, mustAccept, config };
}
