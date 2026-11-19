// Engajamento, ranking semanal e recomendações de clipes. Reaproveita as tabelas que já existiam (clips, clip_views,
// clip_favs, clip_shares) e acrescenta só o que faltava: as sessões de exibição (clip_watch) e as curtidas (clip_likes).
//
// MÉTRICAS (só conta quem NÃO é o autor do clipe)
//   visualização qualificada — a pessoa assistiu de verdade: cobriu pelo menos min(6 s, 40% do clipe) e passou tempo de
//     relógio compatível com isso. Abrir o player e fechar, ou clicar sem querer, não conta. Uma por pessoa, para sempre.
//   curtida     — uma por pessoa (clip_likes); o autor não curte o próprio clipe.
//   compartilhamento — pessoas diferentes que mandaram o link do clipe numa conversa ou canal (clip_shares + autor da
//     mensagem). Mandar o mesmo clipe em 10 canais conta uma vez.
//   retenção    — por pessoa, a MELHOR sessão: % do clipe coberto (sem contar trechos repetidos) e tempo assistido, limitado
//     à duração do clipe. Deixar em loop não soma nada.
//
// PROTEÇÕES (applyBeat / regras de sessão): o servidor cria a sessão e guarda a hora de início; cada batida do player
//   só pode avançar o que o relógio permite (até 2× a velocidade, a maior do player); valores nunca diminuem nem passam
//   da duração; batidas em rajada são ignoradas; só qualifica depois de passar no relógio pelo menos metade do tempo
//   exigido (2×); há teto de sessões por pessoa e clipe (e por pessoa no total).
//
// RANKING SEMANAL (weeklyRanking): nota = 35% retenção + 25% curtidas/visualização + 25% compartilhamentos/visualização
//   + 15% visualizações. As taxas são suavizadas (média bayesiana com 5 visualizações "fantasmas" na média da semana) e
//   cada componente é dividido pelo maior da semana (0–1). Visualizações entram em escala log: 100 views não esmagam 10.
//   Assim um clipe de alguém com pouca audiência que prende quem assiste disputa de igual com o do mais popular.
//   Mínimo para entrar: 3 visualizações qualificadas (2 em grupos pequenos, onde 3 é impossível).
//
// RECOMENDAÇÕES (recommend): soma explicável de sinais — jogo que você assiste/joga, criador com quem você interage,
//   amigos que curtiram/compartilharam/assistiram, qualidade do clipe e se você aparece nele — com um bônus de novidade.
//   Cada recomendação leva o motivo principal ("Porque você assiste VALORANT", "3 amigos curtiram").

export const CFG = {
  QUAL_MS: 6000, QUAL_FRAC: 0.4, QUAL_MIN_MS: 2000, // visualização qualificada: min(6 s, 40%), nunca menos de 2 s
  MAX_RATE: 2, SLACK_MS: 1500,                     // velocidade máxima do player e folga de rede/relógio
  BEAT_MIN_GAP_MS: 900,                            // batidas mais próximas que isso são ignoradas
  SESSION_TTL_MS: 2 * 3600e3,                      // sessão vale 2 h
  SESSIONS_PER_CLIP_DAY: 20, SESSIONS_PER_USER_HOUR: 300,
  LIKE_TOGGLES_PER_MIN: 30,
  MIN_VIEWS: +process.env.CLIP_MIN_VIEWS || 3, PRIOR_K: 5, TOP_MAX: 5,
  W: { retention: 0.35, likes: 0.25, shares: 0.25, views: 0.15 },
  RECENT_MS: 48 * 3600e3, KEEP_SESSIONS_MS: 8 * 864e5,
};

// ---------------------------------------------------------------- regras puras (testadas em scripts/clipstats-unit-test.mjs)
export const qualifyMs = (durationMs) => Math.max(CFG.QUAL_MIN_MS, Math.min(CFG.QUAL_MS, CFG.QUAL_FRAC * durationMs));
export const durationOf = (c) => Math.max(1000, Math.round((+c.secs || 0) * 1000));

// uma batida do player: { watched_ms (tempo tocado), covered_ms (partes distintas do clipe já vistas) }
// devolve os novos valores da sessão já limitados, e por que algo foi cortado (para os testes e o diagnóstico)
export function applyBeat(sess, rep, { now, durationMs }) {
  const out = { watched_ms: sess.watched_ms, covered_ms: sess.covered_ms, clamped: [], ignored: null };
  if (now - sess.started_at > CFG.SESSION_TTL_MS) return { ...out, ignored: 'expired' };
  if (sess.last_at && now - sess.last_at < CFG.BEAT_MIN_GAP_MS) return { ...out, ignored: 'burst' };
  let w = Math.max(0, Math.round(+rep.watched_ms || 0)), cv = Math.max(0, Math.round(+rep.covered_ms || 0));
  if (!Number.isFinite(w) || !Number.isFinite(cv)) return { ...out, ignored: 'invalid' };
  // nada anda mais rápido que o relógio (2× no máximo), nem desde o início nem desde a última batida
  const byStart = (now - sess.started_at) * CFG.MAX_RATE + CFG.SLACK_MS;
  const byLast = sess.watched_ms + (now - (sess.last_at || sess.started_at)) * CFG.MAX_RATE + CFG.SLACK_MS;
  const cap = Math.min(byStart, byLast);
  if (w > cap) { w = Math.floor(cap); out.clamped.push('rate'); }
  if (cv > durationMs) { cv = durationMs; out.clamped.push('duration'); }
  if (cv > w) { cv = w; out.clamped.push('covered>watched'); }
  out.watched_ms = Math.max(sess.watched_ms, w); // nunca volta
  out.covered_ms = Math.max(sess.covered_ms, cv);
  return out;
}
export const isQualified = (coveredMs, durationMs) => coveredMs >= qualifyMs(durationMs);

// mínimo de visualizações para o ranking: 3, ou menos em grupo pequeno (nunca menos de 2)
export const minViewsFor = (audience) => Math.max(2, Math.min(CFG.MIN_VIEWS, (audience || 0) - 1));
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => Math.round(x * 1000) / 1000;

// items: [{ id, views, likes, shares, comp_sum, watch_sum, recent, created_at, min_views, baseline }]
//   comp_sum = soma do % concluído (0–1) de cada visualização qualificada; baseline = mediana de views dos outros clipes do criador
export function weeklyRanking(items, { top = CFG.TOP_MAX } = {}) {
  const elig = items.filter(x => x.views >= (x.min_views ?? CFG.MIN_VIEWS));
  const sum = (k) => elig.reduce((s, x) => s + x[k], 0), V = sum('views');
  // médias da semana (com valores de partida quando há pouca coisa): a base da suavização
  const pL = V ? Math.min(1, sum('likes') / V) : 0.2, pS = V ? Math.min(1, sum('shares') / V) : 0.05, pR = V ? sum('comp_sum') / V : 0.5, K = CFG.PRIOR_K;
  const rated = elig.map(x => ({ x,
    retention: (x.comp_sum + K * pR) / (x.views + K),
    likeRate: Math.min(1, (x.likes + K * pL) / (x.views + K)),
    shareRate: Math.min(1, (x.shares + K * pS) / (x.views + K)),
    viewsLog: Math.log1p(x.views) }));
  const max = (k) => Math.max(1e-9, ...rated.map(r => r[k]));
  const mx = { retention: max('retention'), likeRate: max('likeRate'), shareRate: max('shareRate'), viewsLog: max('viewsLog') };
  for (const r of rated) {
    r.parts = { retention: r.retention / mx.retention, likes: r.likeRate / mx.likeRate, shares: r.shareRate / mx.shareRate, views: r.viewsLog / mx.viewsLog };
    r.score = Object.entries(CFG.W).reduce((s, [k, w]) => s + w * r.parts[k], 0);
    r.quality = (CFG.W.retention * r.parts.retention + CFG.W.likes * r.parts.likes + CFG.W.shares * r.parts.shares) / (1 - CFG.W.views);
  }
  rated.sort((a, b) => b.score - a.score || b.x.views - a.x.views || b.x.created_at - a.x.created_at);
  const topList = rated.slice(0, top);
  // categorias: cada uma vai para o clipe que de fato se destaca nela (mesmo que já esteja no Top), um clipe por categoria;
  // sem candidato com dado suficiente, a categoria não aparece. A interface mostra o selo no cartão do ranking ou, se o
  // clipe não está à vista, na seção "Destaques especiais"
  const taken = new Set(), cats = [];
  const give = (kind, list, why) => { const r = list.find(r => !taken.has(r.x.id)) || null; if (r) { taken.add(r.x.id); cats.push({ kind, id: r.x.id, why: why(r) }); } };
  give('popular', [...rated].sort((a, b) => b.x.views - a.x.views || b.score - a.score), r => `${r.x.views} visualizações`);
  give('crowd', rated.filter(r => r.x.likes >= 2).sort((a, b) => b.x.likes - a.x.likes || b.likeRate - a.likeRate), r => `${r.x.likes} curtidas`);
  // surpresa: muitas visualizações nas últimas 48 h comparado ao normal de quem postou
  const growth = (r) => r.x.recent / Math.max(1, r.x.baseline || 0);
  give('surprise', rated.filter(r => r.x.recent >= Math.max(2, r.x.min_views ?? CFG.MIN_VIEWS) && growth(r) >= 1.5).sort((a, b) => growth(b) - growth(a) || b.x.recent - a.x.recent),
    r => r.x.baseline ? `${Math.round(growth(r) * 10) / 10}× o normal de quem postou` : `${r.x.recent} visualizações em 48 h`);
  // descoberta: poucas visualizações (até a mediana da semana) e engajamento acima da média
  const medV = median(rated.map(r => r.x.views)), qAvg = rated.reduce((s, r) => s + r.quality, 0) / (rated.length || 1);
  // (só fora do Top 3: a ideia é mostrar o que está fora do radar)
  const top3 = new Set(rated.slice(0, 3).map(r => r.x.id));
  give('discovery', rated.filter(r => !top3.has(r.x.id) && r.x.views <= Math.max(r.x.min_views ?? CFG.MIN_VIEWS, medV) && r.x.views <= 15 && r.quality >= qAvg).sort((a, b) => b.quality - a.quality),
    () => 'Pouca gente viu, quem viu curtiu');
  return {
    top: topList.map(r => ({ id: r.x.id, score: Math.round(r.score * 100), parts: Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, r2(v)])) })),
    categories: cats, eligible: elig.length, candidates: items.length,
    quiet: elig.length < 3, // semana devagar: a interface avisa em vez de inventar destaque
  };
}

// recomendações. cands: [{ id, created_at, game_keys[], game_title, creators[], friend_author, you, friend_likes, friend_shares,
//   friend_views, quality (0–1 ou null), views }]; prof: { games: Map(key -> peso), gameTitles: Map, creators: Map(uid -> peso) }
export function recommend(cands, prof, { now, limit = 4 } = {}) {
  const gMax = Math.max(1e-9, ...prof.games.values()), cMax = Math.max(1e-9, ...prof.creators.values());
  const out = cands.map(c => {
    const game = Math.max(0, ...c.game_keys.map(k => (prof.games.get(k) || 0) / gMax));
    const creator = Math.max(0, ...c.creators.map(u => (prof.creators.get(u) || 0) / cMax));
    const fx = c.friend_likes * 2 + c.friend_shares * 3 + c.friend_views, friends = 1 - Math.exp(-fx / 3);
    const quality = c.quality ?? Math.min(0.5, Math.log1p(c.views || 0) / 5);
    const fresh = Math.pow(0.5, (now - c.created_at) / (7 * 864e5));
    const sig = { you: c.you ? 0.35 : 0, game: 0.3 * game, creator: 0.25 * creator, friends: 0.25 * friends, quality: 0.2 * quality, buddy: c.friend_author ? 0.08 : 0 };
    const score = Object.values(sig).reduce((a, b) => a + b, 0) * (0.5 + 0.5 * fresh);
    const main = Object.entries(sig).sort((a, b) => b[1] - a[1])[0];
    const nf = c.friend_likes || c.friend_shares || c.friend_views;
    const reason = main[1] <= 0 ? null
      : main[0] === 'you' ? { kind: 'you', text: 'Você aparece neste clipe' }
      : main[0] === 'game' ? { kind: 'game', text: `Porque você curte ${c.game_title || 'este jogo'}` }
      : main[0] === 'creator' ? { kind: 'creator', text: 'De quem você mais assiste' }
      : main[0] === 'friends' ? { kind: 'friends', text: c.friend_likes ? `${c.friend_likes} ${c.friend_likes === 1 ? 'amigo curtiu' : 'amigos curtiram'}` : c.friend_shares ? `${c.friend_shares} ${c.friend_shares === 1 ? 'amigo compartilhou' : 'amigos compartilharam'}` : `${nf} ${nf === 1 ? 'amigo assistiu' : 'amigos assistiram'}` }
      : main[0] === 'buddy' ? { kind: 'buddy', text: 'Clipe novo de um amigo' }
      : { kind: 'quality', text: 'Em alta na galera' };
    return { id: c.id, score: r2(score), reason, sig: Object.fromEntries(Object.entries(sig).map(([k, v]) => [k, r2(v)])) };
  }).filter(x => x.reason && x.score >= 0.02).sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- serviço (banco)
export function createClipStats({ db, all, get, run, newId, friendsOf, canSeeClip, clipGame = () => null, gameKeys = () => [], now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS clip_watch(id TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    started_at INTEGER NOT NULL, last_at INTEGER, watched_ms INTEGER NOT NULL DEFAULT 0, covered_ms INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS idx_clip_watch_user ON clip_watch(user_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_clip_watch_clip ON clip_watch(clip_id, user_id, started_at);
  CREATE TABLE IF NOT EXISTS clip_likes(user_id TEXT NOT NULL, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE, at INTEGER NOT NULL, PRIMARY KEY(user_id, clip_id));
  CREATE INDEX IF NOT EXISTS idx_clip_likes_clip ON clip_likes(clip_id);`);
  const addCol = (c, d) => { try { db.exec(`ALTER TABLE clip_views ADD COLUMN ${c} ${d}`); } catch { /* já existe */ } };
  // clip_views continua "quem abriu" (marca de visto); ganha o melhor resultado da pessoa e quando a visualização qualificou
  addCol('watch_ms', 'INTEGER NOT NULL DEFAULT 0'); addCol('completion', 'REAL NOT NULL DEFAULT 0'); addCol('qualified_at', 'INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_clip_views_q ON clip_views(clip_id, qualified_at)');
  const likeHits = new Map(); // uid -> [instantes] (limite de curtir/descurtir)
  const n = (sql, ...a) => get(sql, ...a)?.n || 0;
  const J = (ids) => JSON.stringify(ids);

  // abriu o player: marca "visto" e abre uma sessão (null se passou do limite: o vídeo toca, mas não conta)
  function startWatch(uid, c) {
    const t = now();
    run('INSERT INTO clip_views(clip_id,user_id,at) VALUES(?,?,?) ON CONFLICT(clip_id,user_id) DO UPDATE SET at=excluded.at', c.id, uid, t);
    if (n('SELECT COUNT(*) n FROM clip_watch WHERE clip_id=? AND user_id=? AND started_at>?', c.id, uid, t - 864e5) >= CFG.SESSIONS_PER_CLIP_DAY) return null;
    if (n('SELECT COUNT(*) n FROM clip_watch WHERE user_id=? AND started_at>?', uid, t - 3600e3) >= CFG.SESSIONS_PER_USER_HOUR) return null;
    const id = newId();
    run('INSERT INTO clip_watch(id,clip_id,user_id,started_at) VALUES(?,?,?,?)', id, c.id, uid, t);
    if (Math.random() < 0.02) run('DELETE FROM clip_watch WHERE started_at<?', t - CFG.KEEP_SESSIONS_MS); // limpeza de vez em quando
    return id;
  }
  // batida do player (a cada ~5 s tocando, e ao fechar/trocar de clipe)
  function beat(uid, c, sid, rep) {
    const s = get('SELECT * FROM clip_watch WHERE id=? AND clip_id=? AND user_id=?', String(sid || ''), c.id, uid);
    if (!s) return { ok: false, why: 'session' };
    const dur = durationOf(c), t = now(), r = applyBeat(s, rep, { now: t, durationMs: dur });
    if (r.ignored) return { ok: false, why: r.ignored };
    run('UPDATE clip_watch SET watched_ms=?, covered_ms=?, last_at=? WHERE id=?', r.watched_ms, r.covered_ms, t, s.id);
    const comp = Math.min(1, r.covered_ms / dur), wms = Math.min(r.watched_ms, dur); // loop não passa de uma volta
    // qualifica só com tempo de RELÓGIO compatível (a folga de rede não entra): ninguém assiste 3 s em 1 s
    const qual = uid !== c.author_id && isQualified(r.covered_ms, dur) && t - s.started_at >= qualifyMs(dur) / CFG.MAX_RATE;
    const before = get('SELECT watch_ms, completion, qualified_at FROM clip_views WHERE clip_id=? AND user_id=?', c.id, uid);
    run(`UPDATE clip_views SET watch_ms=MAX(watch_ms,?), completion=MAX(completion,?), qualified_at=COALESCE(qualified_at, ?) WHERE clip_id=? AND user_id=?`,
      wms, comp, qual ? t : null, c.id, uid);
    // changed: mudou o que todo mundo vê (nova visualização qualificada, ou a retenção de quem já contava subiu)
    const wasQ = before?.qualified_at != null, isQ = wasQ || qual;
    const changed = isQ && (!wasQ || comp > (before?.completion || 0) + 1e-6 || wms > (before?.watch_ms || 0));
    return { ok: true, qualified: isQ, completion: r2(comp), clamped: r.clamped, changed };
  }
  function setLike(uid, c, on) {
    if (uid === c.author_id) return 'Você não pode curtir o próprio clipe';
    const t = now(), hs = (likeHits.get(uid) || []).filter(x => t - x < 60e3);
    if (hs.length >= CFG.LIKE_TOGGLES_PER_MIN) return 'Calma! Tente de novo em instantes';
    hs.push(t); likeHits.set(uid, hs);
    if (on) run('INSERT OR IGNORE INTO clip_likes(user_id,clip_id,at) VALUES(?,?,?)', uid, c.id, t);
    else run('DELETE FROM clip_likes WHERE user_id=? AND clip_id=?', uid, c.id);
    return null;
  }

  // métricas de vários clipes de uma vez (GROUP BY: sem uma consulta por clipe)
  function metrics(ids) {
    const m = new Map(ids.map(id => [id, { views: 0, likes: 0, shares: 0, comp_sum: 0, watch_sum: 0, recent: 0, opens: 0, reacts: 0, replies: 0 }]));
    if (!ids.length) return m;
    const t = now(), q = J(ids);
    for (const r of all(`SELECT v.clip_id id, COUNT(*) n, SUM(CASE WHEN v.qualified_at IS NOT NULL THEN 1 ELSE 0 END) q, SUM(CASE WHEN v.qualified_at IS NOT NULL THEN v.completion ELSE 0 END) comp,
      SUM(CASE WHEN v.qualified_at IS NOT NULL THEN v.watch_ms ELSE 0 END) w, SUM(CASE WHEN v.qualified_at>? THEN 1 ELSE 0 END) rc
      FROM clip_views v JOIN clips c ON c.id=v.clip_id WHERE v.clip_id IN (SELECT value FROM json_each(?)) AND v.user_id<>c.author_id GROUP BY v.clip_id`, t - CFG.RECENT_MS, q))
      Object.assign(m.get(r.id), { opens: r.n, views: r.q || 0, comp_sum: r.comp || 0, watch_sum: r.w || 0, recent: r.rc || 0 });
    for (const r of all(`SELECT l.clip_id id, COUNT(*) n FROM clip_likes l JOIN clips c ON c.id=l.clip_id WHERE l.clip_id IN (SELECT value FROM json_each(?)) AND l.user_id<>c.author_id GROUP BY l.clip_id`, q)) m.get(r.id).likes = r.n;
    for (const r of all(`SELECT s.clip_id id, COUNT(DISTINCT ms.author_id) n FROM clip_shares s JOIN messages ms ON ms.id=s.message_id JOIN clips c ON c.id=s.clip_id
      WHERE s.clip_id IN (SELECT value FROM json_each(?)) AND ms.author_id<>c.author_id GROUP BY s.clip_id`, q)) m.get(r.id).shares = r.n;
    for (const r of all(`SELECT c.id, (SELECT COUNT(DISTINCT user_id) FROM reactions WHERE message_id=c.message_id AND user_id<>c.author_id) re,
      (SELECT COUNT(DISTINCT author_id) FROM messages WHERE reply_to=c.message_id AND author_id<>c.author_id) rp FROM clips c WHERE c.id IN (SELECT value FROM json_each(?)) AND c.message_id IS NOT NULL`, q))
      Object.assign(m.get(r.id), { reacts: r.re, replies: r.rp });
    return m;
  }
  // o que aparece no cartão e no player
  const pubStats = (x) => ({ views: x.views, likes: x.likes, shares: x.shares, retention: x.views ? Math.round(x.comp_sum / x.views * 100) : null, avg_watch_s: x.views ? Math.round(x.watch_sum / x.views / 100) / 10 : null });
  function statsFor(ids, uid) {
    const m = metrics(ids), liked = new Set(ids.length ? all('SELECT clip_id FROM clip_likes WHERE user_id=? AND clip_id IN (SELECT value FROM json_each(?))', uid, J(ids)).map(r => r.clip_id) : []);
    return new Map(ids.map(id => [id, { stats: pubStats(m.get(id)), liked: liked.has(id) }]));
  }

  const audienceOf = (gid) => n('SELECT COUNT(*) n FROM members WHERE guild_id=?', gid);
  function baselineOf(uid, exceptId) { // mediana de visualizações dos outros clipes recentes do criador
    const rows = all(`SELECT c.id, (SELECT COUNT(*) FROM clip_views v WHERE v.clip_id=c.id AND v.qualified_at IS NOT NULL AND v.qualified_at<? AND v.user_id<>c.author_id) n
      FROM clips c WHERE c.author_id=? AND c.id<>? AND c.created_at>? ORDER BY c.created_at DESC LIMIT 20`, now() - CFG.RECENT_MS, uid, exceptId, now() - 30 * 864e5);
    return median(rows.map(r => r.n));
  }
  const visibleClips = (viewer, since, limit) => all(`SELECT c.* FROM clips c WHERE c.created_at>? AND c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?) ORDER BY c.created_at DESC LIMIT ?`, since, viewer, limit)
    .filter(c => canSeeClip(viewer, c));

  // ranking da semana como o viewer vê (só clipes a que ele tem acesso). Métricas de todo mundo, sem personalização.
  function week(viewer, { days = 7 } = {}) {
    const rows = visibleClips(viewer, now() - days * 864e5, 300), m = metrics(rows.map(c => c.id)), byId = new Map(rows.map(c => [c.id, c]));
    const aud = new Map();
    const items = rows.map(c => { if (!aud.has(c.guild_id)) aud.set(c.guild_id, audienceOf(c.guild_id)); const x = m.get(c.id);
      return { id: c.id, ...x, created_at: c.created_at, min_views: minViewsFor(aud.get(c.guild_id)), baseline: x.recent ? baselineOf(c.author_id, c.id) : 0 }; });
    const rk = weeklyRanking(items);
    return { ...rk, rows: byId, metrics: m };
  }

  // recomendações para o viewer: clipes dos últimos 30 dias que ele ainda não assistiu de verdade
  function recsFor(viewer, { limit = 4, exclude = new Set(), quality = new Map(), played = new Set() } = {}) {
    const t = now(), fr = new Set(friendsOf(viewer));
    // perfil: jogos e criadores dos clipes que você assistiu (peso pela conclusão), curtiu (×2) e compartilhou (×3), nos últimos 60 dias
    const games = new Map(), gameTitles = new Map(), creators = new Map();
    const bump = (map, k, w) => map.set(k, (map.get(k) || 0) + w);
    const hist = all(`SELECT c.*, v.completion comp, (SELECT 1 FROM clip_likes l WHERE l.clip_id=c.id AND l.user_id=?) liked,
      (SELECT 1 FROM clip_shares s JOIN messages ms ON ms.id=s.message_id WHERE s.clip_id=c.id AND ms.author_id=? LIMIT 1) shared
      FROM clip_views v JOIN clips c ON c.id=v.clip_id WHERE v.user_id=? AND v.qualified_at IS NOT NULL AND c.author_id<>? AND v.at>? ORDER BY v.at DESC LIMIT 200`, viewer, viewer, viewer, viewer, t - 60 * 864e5);
    const likedOnly = all(`SELECT c.* FROM clip_likes l JOIN clips c ON c.id=l.clip_id WHERE l.user_id=? AND l.at>? AND NOT EXISTS(SELECT 1 FROM clip_views v WHERE v.clip_id=c.id AND v.user_id=? AND v.qualified_at IS NOT NULL) LIMIT 100`, viewer, t - 60 * 864e5, viewer);
    for (const c of [...hist, ...likedOnly.map(c => ({ ...c, comp: 0.5, liked: 1 }))]) {
      const w = (c.comp || 0.3) + (c.liked ? 2 : 0) + (c.shared ? 3 : 0);
      const g = clipGame(c, viewer); if (g) for (const k of gameKeys(g)) { bump(games, k, w); gameTitles.set(k, g.game.title); }
      for (const u of new Set([c.author_id, c.streamer_id].filter(x => x && x !== viewer))) bump(creators, u, w);
    }
    for (const k of played) bump(games, k, 1); // jogos que você jogou na semana
    const rows = visibleClips(viewer, t - 30 * 864e5, 300).filter(c => c.author_id !== viewer && !exclude.has(c.id));
    if (!rows.length) return [];
    const ids = rows.map(c => c.id), m = metrics(ids);
    const watched = new Set(all('SELECT clip_id FROM clip_views WHERE user_id=? AND qualified_at IS NOT NULL AND clip_id IN (SELECT value FROM json_each(?))', viewer, J(ids)).map(r => r.clip_id));
    const frs = [...fr], frJ = J(frs);
    const fcount = (sql) => new Map(frs.length ? all(sql, J(ids), frJ).map(r => [r.id, r.n]) : []);
    const fl = fcount('SELECT clip_id id, COUNT(*) n FROM clip_likes WHERE clip_id IN (SELECT value FROM json_each(?)) AND user_id IN (SELECT value FROM json_each(?)) GROUP BY clip_id');
    const fv = fcount('SELECT clip_id id, COUNT(*) n FROM clip_views WHERE qualified_at IS NOT NULL AND clip_id IN (SELECT value FROM json_each(?)) AND user_id IN (SELECT value FROM json_each(?)) GROUP BY clip_id');
    const fs = fcount('SELECT s.clip_id id, COUNT(DISTINCT ms.author_id) n FROM clip_shares s JOIN messages ms ON ms.id=s.message_id WHERE s.clip_id IN (SELECT value FROM json_each(?)) AND ms.author_id IN (SELECT value FROM json_each(?)) GROUP BY s.clip_id');
    const cands = rows.filter(c => !watched.has(c.id)).map(c => {
      const g = clipGame(c, viewer), keys = g ? gameKeys(g) : [];
      return { id: c.id, created_at: c.created_at, game_keys: keys, game_title: keys.map(k => gameTitles.get(k)).find(Boolean) || g?.game.title,
        creators: [c.author_id, c.streamer_id].filter(Boolean), friend_author: fr.has(c.author_id) || fr.has(c.streamer_id), you: c.streamer_id === viewer, friend_likes: fl.get(c.id) || 0, friend_shares: fs.get(c.id) || 0,
        friend_views: fv.get(c.id) || 0, quality: quality.has(c.id) ? quality.get(c.id) : null, views: m.get(c.id).views };
    });
    return recommend(cands, { games, gameTitles, creators }, { now: t, limit });
  }
  return { startWatch, beat, setLike, metrics, statsFor, pubStats, week, recsFor };
}
