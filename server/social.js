// Métricas sociais: o Resenha está fazendo os amigos se encontrarem? Mesmo cuidado de server/ux.js:
// só CONTAGENS por dia (métrica, detalhe, n), nada de quem fez; quem desligou "Enviar estatísticas de uso" não entra nas
// contagens que dependem de uma pessoa; tudo some depois de 60 dias; UX_TELEMETRY=0 desliga.
//
// O que é medido:
//   session2          sessões de voz com 2+ pessoas (detalhe intent|other) e session2_min (minutos somados)
//   return            pessoa que estava fora e voltou ao app por causa de um chamado: intent_invite | call_invite |
//                     intent_formed (avisos que chegaram com ela offline) | activity (voltou e em até 15 min entrou numa
//                     sala onde um amigo estava, depois de 30+ min fora)
//   return_acted      voltou por um chamado e agiu (topou, entrou na sala) em até 30 min
//   intent            created | formed | expired | canceled | ended
//   intent_form_min   tempo até formar o grupo (faixas)
//   intent_responded  intenção que teve resposta de outra pessoa (topou ou recusou): a "segunda interação"
//   invite            convites das intenções: sent_push | sent_quiet | joined | declined | ignored | left
//   callinv           convites para a chamada: "<origem>:<resultado>" (origem intent|manual; accepted|declined|expired|canceled)
//   interaction       ações geradas pelas intenções: join | decline | leave | more | enter | lfg_fallback | cancel
// GET /api/social/metrics?days=30 (só o administrador da instalação).
export const SOCIAL_KEEP_DAYS = 60;
const RETURN_WINDOW = 12 * 3600e3, ACT_WINDOW = 30 * 60e3, AWAY_MIN = 30 * 60e3, ACTIVITY_JOIN = 15 * 60e3;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const formBucket = (ms) => { const m = ms / 60e3; return m < 5 ? '0-5' : m < 15 ? '5-15' : m < 30 ? '15-30' : '30+'; };

export function createSocial({ db, all, get, run, optedOut = () => false, enabled = () => process.env.UX_TELEMETRY !== '0', isOnline = () => false, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS social_daily(day TEXT NOT NULL, metric TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, metric, detail)) WITHOUT ROWID`);
  const add = db.prepare('INSERT INTO social_daily(day,metric,detail,n) VALUES(?,?,?,?) ON CONFLICT(day,metric,detail) DO UPDATE SET n = n + excluded.n');
  const clean = () => run('DELETE FROM social_daily WHERE day < ?', day(now() - SOCIAL_KEEP_DAYS * 864e5));
  clean(); setInterval(clean, 6 * 3600e3).unref?.();

  // uid null = contagem sem pessoa (ex.: sessão de voz); com uid, respeita quem desligou as estatísticas
  function count(metric, detail = '', n = 1, uid = null) {
    if (!enabled() || (uid && optedOut(uid))) return;
    add.run(day(now()), metric, String(detail).slice(0, 40), Math.round(n));
  }

  // ---- retornos ----
  const pulls = new Map();     // uid -> { source, at }: chamado que chegou com a pessoa fora do app
  const returned = new Map();  // uid -> { source, at }: voltou por um chamado (para "agiu" em até 30 min)
  const away = new Map();      // uid -> instante em que a última conexão caiu
  const back = new Map();      // uid -> instante em que voltou depois de 30+ min fora (para "activity")
  function pull(uid, source) { if (!isOnline(uid) && !pulls.has(uid)) pulls.set(uid, { source, at: now() }); }
  function onConnect(uid) {
    const t = now(), p = pulls.get(uid); pulls.delete(uid);
    if (p && t - p.at <= RETURN_WINDOW) { count('return', p.source, 1, uid); returned.set(uid, { source: p.source, at: t }); }
    else { const a = away.get(uid); if (a && t - a >= AWAY_MIN) back.set(uid, t); }
    away.delete(uid);
  }
  function onDisconnect(uid) { away.set(uid, now()); returned.delete(uid); back.delete(uid); }
  // agiu depois de voltar (topou a intenção, aceitou o convite, entrou na sala)
  function acted(uid) {
    const r = returned.get(uid); if (!r) return;
    returned.delete(uid); if (now() - r.at <= ACT_WINDOW) count('return_acted', r.source, 1, uid);
  }

  // ---- sessões de voz com 2+ pessoas ----
  const sessions = new Map(); // cid -> { start, peak, intent }
  // chamado depois de cada entrada/saída: people = quantas pessoas (sem bots) estão na sala
  function onVoice(cid, people, { intent = false, joined = null, friendThere = false } = {}) {
    const t = now(), s = sessions.get(cid);
    if (people >= 2 && !s) sessions.set(cid, { start: t, peak: people, intent });
    else if (s && people >= 2) { s.peak = Math.max(s.peak, people); if (intent) s.intent = true; }
    else if (s && people < 2) { sessions.delete(cid); endSession(s, t); }
    if (joined) {
      acted(joined);
      const b = back.get(joined); if (b && friendThere && t - b <= ACTIVITY_JOIN) { back.delete(joined); count('return', 'activity', 1, joined); }
    }
  }
  function endSession(s, t) {
    const k = s.intent ? 'intent' : 'other';
    count('session2', k); count('session2_min', k, Math.max(1, Math.round((t - s.start) / 60e3)));
    count('session2_peak', s.peak >= 5 ? '5+' : String(s.peak));
  }

  function metrics(days = 30) {
    const since = day(now() - (Math.max(1, days) - 1) * 864e5);
    const rows = all('SELECT metric, detail, SUM(n) n FROM social_daily WHERE day >= ? GROUP BY metric, detail', since);
    const m = {}; for (const r of rows) (m[r.metric] ||= {})[r.detail] = r.n;
    const v = (k, d = '') => m[k]?.[d] || 0, sum = (k) => Object.values(m[k] || {}).reduce((a, b) => a + b, 0), pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
    // sessões que ainda estão acontecendo entram como "agora" (não somam minutos até acabar)
    const live = { intent: 0, other: 0 }; for (const s of sessions.values()) live[s.intent ? 'intent' : 'other']++;
    const created = v('intent', 'created'), formed = v('intent', 'formed');
    const sentPush = v('invite', 'sent_push'), sentQuiet = v('invite', 'sent_quiet'), sent = sentPush + sentQuiet;
    const joined = v('invite', 'joined'), declined = v('invite', 'declined'), ignored = v('invite', 'ignored');
    const callinv = {}; for (const [d, n] of Object.entries(m.callinv || {})) { const [src, st] = d.split(':'); (callinv[src] ||= { accepted: 0, declined: 0, expired: 0, canceled: 0 })[st] = n; }
    for (const c of Object.values(callinv)) { const total = c.accepted + c.declined + c.expired + c.canceled; c.total = total; c.taxa_aceite = pct(c.accepted, total); }
    return {
      desde: since, dias: days, ligado: enabled(),
      sessoes: { intent: { n: v('session2', 'intent'), minutos: v('session2_min', 'intent'), agora: live.intent }, other: { n: v('session2', 'other'), minutos: v('session2_min', 'other'), agora: live.other }, pico: m.session2_peak || {} },
      retornos: { total: sum('return'), por_origem: m.return || {}, agiram: sum('return_acted'), agiram_por_origem: m.return_acted || {} },
      intencoes: { criadas: created, formadas: formed, expiradas: v('intent', 'expired'), canceladas: v('intent', 'canceled'), encerradas: v('intent', 'ended'),
        taxa_formacao: pct(formed, created), tempo_para_formar: m.intent_form_min || {}, com_resposta: v('intent_responded'), taxa_resposta: pct(v('intent_responded'), created) },
      convites: { enviados: sent, com_aviso: sentPush, em_silencio: sentQuiet, toparam: joined, recusaram: declined, ignoraram: ignored, sairam: v('invite', 'left'),
        taxa_aceite: pct(joined, joined + declined + ignored), taxa_recusa: pct(declined, joined + declined + ignored), taxa_ignorado: pct(ignored, joined + declined + ignored) },
      convites_chamada: callinv,
      interacoes: m.interaction || {},
      por_dia: all("SELECT day, metric, SUM(n) n FROM social_daily WHERE day >= ? AND metric IN ('intent','session2','return','invite') GROUP BY day, metric ORDER BY day", since),
    };
  }

  return { count, pull, onConnect, onDisconnect, acted, onVoice, metrics, _state: { pulls, returned, away, back, sessions } };
}

export function mountSocial(app, { auth, wrap, bad, isAdmin, social }) {
  app.get('/api/social/metrics', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    res.json(social.metrics(Math.min(SOCIAL_KEEP_DAYS, Math.max(1, +req.query.days || 30))));
  }));
}
