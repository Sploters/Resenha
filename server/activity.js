// Atividade social (Fase 1): agendador, cache, backoff e eventos. Agnóstico de plataforma: só fala com os adaptadores de server/integrations.
//
// PRIVACIDADE — uma única regra decide quem vê a atividade de alguém (usada no tempo real, no READY e no feed, para não divergirem):
//   canSee(viewer, owner) = viewer === owner  OU  (linked_accounts.visibility === 'friends' E os dois são amigos aceitos).
// 'visibility' é a visibilidade da ATIVIDADE; 'link_visibility' é a visibilidade do fato de ter a conta vinculada (são independentes).
// Com visibility = 'off' nada é consultado nem guardado para aquela conta.
//
// Plataforma 'pc' (sem conta vinculada): o app desktop detecta o jogo aberto no PC (a mesma detecção da transmissão: pasta de
// loja/jogos, executável conhecido ou janela em tela cheia) e informa. Regra própria, em users.pc_activity:
//   'servers' (padrão, como o Discord) = amigos aceitos + quem divide um servidor com a pessoa; 'friends' = só amigos; 'off' = nada.
import { PollError } from './integrations/errors.js';
import { isLauncher } from './launchers.js';

const LOCAL_STALE_MS = 90000; // o app desktop informa o jogo a cada ~20 s
const MIN_SECS = 30, MAX_BACKOFF_MS = 15 * 60 * 1000, KEEP_DAYS = 30, KEEP_PER_USER = 200, STALE_X = 3;

export function createActivityService({ all, get, run, newId, dispatch, presenceOk = () => true, isInvisible = () => false, isOnline, getAdapter, listAdapters, notifyAccount = () => { }, canSeeClip = () => true, now = () => Date.now(), log = () => { } }) {
  const intervalMs = () => +process.env.ACTIVITY_POLL_MS || Math.max(MIN_SECS, +process.env.STEAM_POLL_SECS || 60) * 1000; // ACTIVITY_POLL_MS: só para testes
  const current = new Map();   // `${uid}:${platform}` -> { uid, platform, game:{id,title}, since, state, at }  (só o que está PUBLICADO)
  const cache = new Map();     // `${platform}:${external_id}` -> { snap, at }  (último snapshot, evita reconsultar)
  const health = new Map();    // platform -> { failures, nextAt, disabled, lastError, lastOk }
  let timer = null, running = false, lastTickAt = 0, stopped = false;

  // ---- regras de privacidade ----
  const friendsOf = (uid) => all(`SELECT r1.other_id id FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id
    WHERE r1.user_id=? AND r1.type=1 AND r2.type=1`, uid).map(r => r.id);
  const areFriends = (a, b) => !!get('SELECT 1 x FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id WHERE r1.user_id=? AND r1.other_id=? AND r1.type=1 AND r2.type=1', a, b);
  const acct = (uid, platform) => get('SELECT * FROM linked_accounts WHERE user_id=? AND platform=?', uid, platform);
  const pcVis = (uid) => get('SELECT pc_activity v FROM users WHERE id=?', uid)?.v || 'servers';
  const shareGuild = (a, b) => !!get('SELECT 1 x FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id=?', a, b);
  const guildPeers = (uid) => all('SELECT DISTINCT m2.user_id id FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id<>?', uid, uid).map(r => r.id);
  const canSee = (viewer, owner, platform) => {
    if (viewer === owner) return true;
    if (isInvisible(owner)) return false; // modo invisível: ninguém vê o que a pessoa está jogando (como o Discord)
    if (!presenceOk(viewer, owner)) return false; // escolheu quem vê a atividade (server/privacy.js): vale para todas as plataformas
    if (platform === 'pc') { const v = pcVis(owner); return v !== 'off' && (areFriends(viewer, owner) || (v === 'servers' && shareGuild(viewer, owner))); }
    const a = acct(owner, platform);
    return !!a && a.visibility === 'friends' && areFriends(viewer, owner);
  };
  // quem recebe os eventos de `owner`: ele mesmo + amigos aceitos, se a atividade está compartilhada
  const audience = (owner, platform) => isInvisible(owner) ? [owner] : base(owner, platform).filter(v => v === owner || presenceOk(v, owner));
  const base = (owner, platform) => {
    if (platform === 'pc') { const v = pcVis(owner); return v === 'off' ? [owner] : [...new Set([owner, ...friendsOf(owner), ...(v === 'servers' ? guildPeers(owner) : [])])]; }
    const a = acct(owner, platform);
    return a && a.visibility === 'friends' ? [owner, ...friendsOf(owner)] : [owner];
  };
  const pub = (e) => e && ({ user_id: e.uid, platform: e.platform, game: e.game, since: e.since, state: e.state });

  const publish = (uid, platform, entry /* ou null */) => { // SEMPRE filtra os destinatários antes de enviar
    dispatch(audience(uid, platform), 'ACTIVITY_UPDATE', { user_id: uid, platform, activity: pub(entry) });
  };
  const record = (uid, platform, kind, game, data) => {
    run('INSERT INTO activities(id,user_id,platform,kind,game_id,title,data,created_at) VALUES(?,?,?,?,?,?,?,?)', newId(), uid, platform, kind, game.id, game.title, data ? JSON.stringify(data) : null, now());
    run('DELETE FROM activities WHERE user_id=? AND created_at<?', uid, now() - KEEP_DAYS * 864e5);
    run('DELETE FROM activities WHERE user_id=? AND id NOT IN (SELECT id FROM activities WHERE user_id=? ORDER BY created_at DESC LIMIT ?)', uid, uid, KEEP_PER_USER);
  };
  // imagem do jogo guardada junto com o evento (o histórico mostra o ícone/arte mesmo depois que a pessoa parou de jogar)
  const artOf = (game, platform) => { const o = {}; if (game.icon) o.icon = game.icon; const st = platform === 'steam' ? game.id : game.steam; if (st) o.steam = String(st); return Object.keys(o).length ? o : null; };
  const hiddenGame = (uid, platform, gameId) => !!get('SELECT 1 x FROM game_prefs WHERE user_id=? AND platform=? AND game_id=? AND hidden=1', uid, platform, gameId);

  // encerra o que está publicado (jogo parou, conta desvinculada, privacidade desligada…)
  const clear = (uid, platform, { notify = true, why = 'stop', audienceOverride = null } = {}) => {
    const k = uid + ':' + platform, cur = current.get(k); if (!cur) return;
    current.delete(k);
    if (why === 'stop' && !cur.quiet) record(uid, platform, 'game_stop', cur.game, { seconds: Math.max(0, Math.round((now() - cur.since) / 1000)), ...artOf(cur.game, platform) });
    if (notify) dispatch(audienceOverride || audience(uid, platform), 'ACTIVITY_UPDATE', { user_id: uid, platform, activity: null });
  };

  // aplica um snapshot de uma conta: publica/atualiza/encerra
  function apply(a, snap) {
    const k = a.user_id + ':' + a.platform, prev = current.get(k);
    run('UPDATE linked_accounts SET display_name=?, avatar=?, profile_url=?, last_sync=?, sync_state=? WHERE user_id=? AND platform=?',
      snap.name ?? a.display_name, snap.avatar ?? a.avatar, snap.profileUrl ?? a.profile_url, now(), snap.visibility === 'private' ? 'private' : 'ok', a.user_id, a.platform);
    const newState = snap.visibility === 'private' ? 'private' : 'ok';
    if (a.sync_state !== newState || (snap.name && a.display_name !== snap.name) || (snap.avatar && a.avatar !== snap.avatar)) notifyAccount(a.user_id, a.platform); // a página Contas vinculadas atualiza sozinha
    const game = snap.game && !hiddenGame(a.user_id, a.platform, snap.game.id) ? snap.game : null;
    if (!game) return clear(a.user_id, a.platform);
    if (prev && prev.game.id === game.id) { prev.at = now(); prev.state = snap.state; if (prev.game.title !== game.title) prev.game = game; return; }
    if (prev) clear(a.user_id, a.platform); // trocou de jogo: fecha o anterior
    const entry = { uid: a.user_id, platform: a.platform, game, since: now(), state: snap.state, at: now(), quiet: isInvisible(a.user_id) };
    current.set(k, entry); if (!entry.quiet) record(a.user_id, a.platform, 'game_start', game, artOf(game, a.platform));
    publish(a.user_id, a.platform, entry);
  }

  // vale consultar esta conta? (sem ninguém para ver, não gasta chamada)
  const worthPolling = (a) => a.visibility !== 'off' && (isOnline(a.user_id) || friendsOf(a.user_id).some(isOnline));

  async function pollPlatform(ad) {
    const h = health.get(ad.id) || { failures: 0, nextAt: 0, disabled: null, lastError: null, lastOk: null }; health.set(ad.id, h);
    if (h.disabled || now() < h.nextAt) return;
    const accounts = all('SELECT * FROM linked_accounts WHERE platform=?', ad.id).filter(worthPolling);
    if (!accounts.length) return;
    try {
      const snaps = await ad.poll([...new Set(accounts.map(a => a.external_id))]); // UMA consulta em lote para todos
      h.failures = 0; h.lastError = null; h.lastOk = now();
      for (const a of accounts) {
        const cur = acct(a.user_id, a.platform); if (!cur || cur.external_id !== a.external_id || cur.visibility === 'off') continue; // mudou durante a consulta
        const snap = snaps.get(a.external_id);
        cache.set(a.platform + ':' + a.external_id, { snap: snap || null, at: now() });
        if (!snap) { run("UPDATE linked_accounts SET sync_state='not_found', last_sync=? WHERE user_id=? AND platform=?", now(), a.user_id, a.platform); clear(a.user_id, a.platform); continue; }
        apply(cur, snap);
      }
    } catch (e) {
      h.lastError = e.message || String(e); h.failures++;
      const st = e instanceof PollError ? e.status : 0;
      if (st === 401 || st === 403) { h.disabled = 'credencial inválida ou ausente'; log(`[atividade] ${ad.id}: ${h.disabled} — consultas suspensas`); }
      else h.nextAt = now() + Math.min(intervalMs() * 2 ** h.failures, MAX_BACKOFF_MS);
      for (const a of accounts) { const st = h.disabled ? 'unavailable' : 'error'; run('UPDATE linked_accounts SET sync_state=? WHERE user_id=? AND platform=?', st, a.user_id, a.platform); if (a.sync_state !== st) notifyAccount(a.user_id, a.platform); }
      // dados ficam como estavam; entradas velhas deixam de ser exibidas pelo critério de staleness
    }
  }

  async function tick() {
    if (running || stopped) return; running = true; lastTickAt = now();
    try {
      for (const ad of listAdapters()) { if (!ad.configured()) continue; await pollPlatform(ad).catch(e => log('[atividade] erro: ' + e.message)); }
      const stale = now() - STALE_X * intervalMs();
      for (const [k, e] of current) if (e.at < stale && !isOnline(e.uid) && !friendsOf(e.uid).some(isOnline)) current.delete(k); // ninguém vendo e dado velho
      for (const e of [...current.values()]) if (e.platform === 'pc' && now() - e.at > LOCAL_STALE_MS) clear(e.uid, 'pc'); // o app parou de informar (fechou, travou)
    } finally { running = false; }
  }
  const schedule = () => { if (stopped) return; timer = setTimeout(async () => { await tick(); schedule(); }, intervalMs()); timer.unref?.(); };

  // ---- consultas (estado inicial e feed): mesma regra canSee ----
  const fresh = (e) => now() - e.at <= STALE_X * intervalMs(); // dado velho (Steam fora do ar, ninguém consultando) não é mostrado
  function readyFor(viewer) {
    try {
      const out = [];
      for (const e of current.values()) if (fresh(e) && canSee(viewer, e.uid, e.platform)) out.push(pub(e));
      return out;
    } catch (e) { log('[atividade] readyFor: ' + e.message); return []; }
  }
  function feedFor(viewer, { limit = 40 } = {}) {
    const ids = [viewer, ...friendsOf(viewer)], now0 = now();
    const friends = ids.map(uid => {
      const accounts = all('SELECT * FROM linked_accounts WHERE user_id=?', uid);
      const playing = [...current.values()].filter(e => e.uid === uid && fresh(e) && canSee(viewer, uid, e.platform)).map(pub);
      const links = uid === viewer ? accounts : accounts.filter(a => a.link_visibility !== 'off');   // o fato de ter a conta vinculada tem regra própria
      return { user_id: uid, playing, linked: links.map(a => ({ platform: a.platform, name: a.display_name, profile_url: a.profile_url })) };
    });
    const events = all(`SELECT a.* FROM activities a LEFT JOIN linked_accounts la ON la.user_id=a.user_id AND la.platform=a.platform
      WHERE a.user_id IN (${ids.map(() => '?').join(',')}) AND (la.visibility='friends' OR a.user_id=? OR a.platform='pc') AND a.created_at>? ORDER BY a.created_at DESC LIMIT ?`, ...ids, viewer, now0 - 7 * 864e5, limit * 3)
      .filter(ev => canSee(viewer, ev.user_id, ev.platform) && !hiddenGame(ev.user_id, ev.platform, ev.game_id) && !isLauncher({ id: ev.game_id, title: ev.title })).slice(0, limit)
      .map(ev => ({ id: ev.id, user_id: ev.user_id, platform: ev.platform, kind: ev.kind, game: { id: ev.game_id, title: ev.title }, seconds: ev.data ? JSON.parse(ev.data).seconds : null, at: ev.created_at }));
    return { friends, events };
  }

  // ---- jogos que a galera mais joga num servidor (como o cartão do servidor no Discord) ----
  // Conta, para cada jogo, quantos membros jogaram nos últimos `days` dias (o histórico guarda 30) e quantos estão jogando
  // agora. Só entram contas que compartilham a atividade (PC fora de "off", conta vinculada fora de "off"), sem jogos
  // escondidos nem launchers, e só jogos com pelo menos MIN_PLAYERS pessoas (o cartão não entrega o que UMA pessoa joga).
  // hot: muita gente nesta semana (a chama do Discord). Guardado por 10 min por servidor.
  const GG_TTL = 10 * 60e3, ggCache = new Map();
  // o mesmo jogo pode vir pela Steam (appid), pelo PC com o appid ou só com o nome: casa por qualquer um dos dois
  const ggKeys = (platform, gameId, title, d) => { const st = platform === 'steam' ? gameId : d?.steam; return [st && 's:' + st, 'n:' + String(title || gameId).toLowerCase().replace(/[^a-z0-9]+/g, '')].filter(Boolean); };
  function guildGames(gid, { days = 30, limit = 8, minPlayers = +process.env.GUILD_GAMES_MIN || 2 } = {}) {
    const ck = gid + ':' + days + ':' + limit, hit = ggCache.get(ck); if (hit && now() - hit.at < GG_TTL) return hit.list;
    const since = now() - days * 864e5, week = now() - 7 * 864e5;
    const shares = (uid, platform) => platform === 'pc' ? pcVis(uid) !== 'off' : (acct(uid, platform)?.visibility || 'off') !== 'off';
    const memo = new Map(), ok = (uid, platform) => { const k = uid + ':' + platform; if (!memo.has(k)) memo.set(k, shares(uid, platform)); return memo.get(k); };
    const games = new Map(), add = (uid, platform, gameId, title, d, t, live) => {
      if (!ok(uid, platform) || hiddenGame(uid, platform, gameId) || isLauncher({ id: gameId, title })) return;
      const ks = ggKeys(platform, gameId, title, d);
      let x = ks.map(k => games.get(k)).find(Boolean);
      if (!x) x = { platform, game: { id: gameId, title }, at: 0, players: new Set(), week: new Set(), now: new Set(), secs: 0 };
      for (const k of ks) games.set(k, x);
      if (t >= x.at) { x.at = t; x.platform = platform; x.game = { id: gameId, title, ...(d?.icon ? { icon: d.icon } : x.game.icon ? { icon: x.game.icon } : {}), ...(d?.steam ? { steam: d.steam } : x.game.steam ? { steam: x.game.steam } : {}) }; }
      x.players.add(uid); if (t >= week) x.week.add(uid); if (live) x.now.add(uid);
      if (d?.seconds) x.secs += d.seconds;
    };
    for (const ev of all(`SELECT a.user_id, a.platform, a.game_id, a.title, a.data, a.created_at FROM activities a JOIN members m ON m.user_id=a.user_id AND m.guild_id=?
      WHERE a.created_at>? AND a.kind IN ('game_start','game_stop')`, gid, since)) {
      let d = null; try { d = ev.data ? JSON.parse(ev.data) : null; } catch { }
      add(ev.user_id, ev.platform, ev.game_id, ev.title, d, ev.created_at, false);
    }
    const members = new Set(all('SELECT user_id FROM members WHERE guild_id=?', gid).map(r => r.user_id));
    for (const e of current.values()) if (!e.quiet && members.has(e.uid) && !isInvisible(e.uid)) add(e.uid, e.platform, e.game.id, e.game.title, e.game, now(), true);
    const list = [...new Set(games.values())].filter(x => x.players.size >= minPlayers)
      .sort((a, b) => b.players.size - a.players.size || b.week.size - a.week.size || b.secs - a.secs || b.at - a.at).slice(0, limit)
      .map(x => ({ platform: x.platform, game: x.game, players: x.players.size, week: x.week.size, playing: x.now.size, hours: Math.round(x.secs / 360) / 10, hot: x.week.size >= 3 || x.now.size >= 3 }));
    ggCache.set(ck, { at: now(), list });
    if (ggCache.size > 500) for (const [k, v] of ggCache) if (now() - v.at > GG_TTL) ggCache.delete(k);
    return list;
  }

  // ---- a semana da galera: retrospectiva dos últimos 7 dias (você + amigos), por JOGO e não por evento ----
  // Cada jogo soma as horas de todo mundo, quantas pessoas diferentes jogaram e em que dias; entra no ranking pela nota
  //   nota = √horas + 1,5 × (pessoas − 1) + 0,5 × maior sequência de dias seguidos
  // (raiz das horas: 30 h sozinho não passa por cima de 9 h com 3 amigos). Jogo com atividade insignificante fica de fora:
  // precisa de 1 h no total, ou de 2 pessoas e 20 min. Mesma regra de privacidade de tudo (canSee + jogos escondidos).
  const TZ = process.env.TZ || 'America/Sao_Paulo';
  const dayKey = (t) => { try { return new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }); } catch { return new Date(t).toISOString().slice(0, 10); } };
  const runOf = (flags) => { let best = 0, cur = 0; for (const f of flags) { cur = f ? cur + 1 : 0; if (cur > best) best = cur; } return best; };
  const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const gameOf = (id, title, d) => ({ id, title, ...(d?.icon ? { icon: d.icon } : {}), ...(d?.steam ? { steam: d.steam } : {}) });
  //   clipes: engajamento de quem NÃO é o autor (visualizações únicas, reações, respostas, favoritos e compartilhamentos)
  //   bruto = 1 × visto + 2 × reagiu + 2 × respondeu + 3 × favoritou + 4 × compartilhou
  // Só entra com bruto ≥ CLIP_MIN (3 visualizações, ou 1 favorito, ou 1 compartilhamento…): sem engajamento não é destaque.
  // A ordem é personalizada: × idade (perde metade em 7 dias), × 1,5 se você aparece no clipe, × 1,25 se é de amigo,
  // × 1,25 se é de um jogo que você jogou na semana, × 0,85 se você já assistiu (mostra o que você ainda não viu).
  const CLIP_W = { views: 1, reacts: 2, replies: 2, favs: 3, shares: 4 }, CLIP_MIN = +process.env.CLIP_MIN_SCORE || 3;
  const WEEK_DAYS = 7;
  function weekFor(viewer, { top = 3 } = {}) {
    const t0 = now(), since = t0 - WEEK_DAYS * 864e5, fr = friendsOf(viewer), ids = [viewer, ...fr], frSet = new Set(fr);
    const days = []; for (let i = WEEK_DAYS - 1; i >= 0; i--) days.push(dayKey(t0 - i * 864e5));
    const dayIdx = new Map(days.map((k, i) => [k, i]));
    const seeMemo = new Map(), see = (uid, platform) => { const k = uid + ':' + platform; if (!seeMemo.has(k)) seeMemo.set(k, canSee(viewer, uid, platform)); return seeMemo.get(k); };
    const ok = (uid, platform, gid, title) => see(uid, platform) && !hiddenGame(uid, platform, gid) && !isLauncher({ id: gid, title });
    const games = new Map(), people = new Map(); // chave do jogo -> agregado; 'uid|jogo' -> { secs, days }
    const add = (uid, platform, gid, title, d, t, secs, live) => {
      const di = dayIdx.get(dayKey(t)); if (di === undefined) return;
      const ks = ggKeys(platform, gid, title, d);
      let x = ks.map(k => games.get(k)).find(Boolean);
      if (!x) x = { platform, game: gameOf(gid, title, d), at: 0, secs: 0, players: new Map(), day: Array(WEEK_DAYS).fill(0), active: Array(WEEK_DAYS).fill(false), live: new Set() };
      for (const k of ks) games.set(k, x);
      if (t >= x.at) { x.at = t; x.platform = platform; x.game = { ...x.game, ...gameOf(gid, title, d), ...(x.game.icon && !d?.icon ? { icon: x.game.icon } : {}), ...(x.game.steam && !d?.steam ? { steam: x.game.steam } : {}) }; }
      x.secs += secs; x.day[di] += secs; x.active[di] = true; if (live) x.live.add(uid);
      const p = x.players.get(uid) || { secs: 0, days: Array(WEEK_DAYS).fill(false) }; p.secs += secs; p.days[di] = true; x.players.set(uid, p);
    };
    for (const ev of all(`SELECT * FROM activities WHERE user_id IN (${ids.map(() => '?').join(',')}) AND created_at>? AND kind IN ('game_start','game_stop')`, ...ids, since)) {
      if (!ok(ev.user_id, ev.platform, ev.game_id, ev.title)) continue;
      const d = parse(ev.data);
      if (ev.kind === 'game_stop') {
        // a partida conta no dia em que terminou; a que começou antes da semana só conta a parte dentro dela
        const secs = Math.max(0, Math.min(+d.seconds || 0, (ev.created_at - since) / 1000));
        add(ev.user_id, ev.platform, ev.game_id, ev.title, d, ev.created_at, secs, false);
      } else add(ev.user_id, ev.platform, ev.game_id, ev.title, d, ev.created_at, 0, false); // abriu: o dia conta, as horas vêm no fim da partida
    }
    // quem está jogando agora: a partida em andamento já conta (ainda não tem game_stop)
    for (const e of current.values()) if (ids.includes(e.uid) && fresh(e) && ok(e.uid, e.platform, e.game.id, e.game.title))
      add(e.uid, e.platform, e.game.id, e.game.title, e.game, t0, Math.max(0, (t0 - Math.max(e.since || t0, since)) / 1000), true);
    const all7 = [...new Set(games.values())].map(x => {
      const players = [...x.players.entries()].sort((a, b) => b[1].secs - a[1].secs).map(([uid, p]) => ({ user_id: uid, secs: Math.round(p.secs), days: p.days.filter(Boolean).length, streak: runOf(p.days) }));
      const streak = runOf(x.active), hours = x.secs / 3600, n = players.length;
      return { platform: x.platform, game: x.game, secs: Math.round(x.secs), players, playing: [...x.live], day: x.day.map(Math.round), streak,
        score: Math.round((Math.sqrt(hours) + 1.5 * (n - 1) + 0.5 * streak) * 100) / 100, worth: x.secs >= 3600 || (n >= 2 && x.secs >= 1200) };
    });
    const ranked = all7.filter(x => x.worth).sort((a, b) => b.score - a.score || b.secs - a.secs).slice(0, top).map(({ worth, ...x }) => x);
    // por pessoa e jogo (popup do jogo: "Amigos que jogaram"), inclusive jogos fora do ranking
    const played = all7.flatMap(x => x.players.map(p => ({ ...p, platform: x.platform, game: x.game })));
    // ---- clipes da semana ----
    const myGames = new Set(all7.filter(x => x.players.some(p => p.user_id === viewer)).flatMap(x => ggKeys(x.platform, x.game.id, x.game.title, x.game)));
    const clipRows = all(`SELECT c.* FROM clips c WHERE c.created_at>? AND c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?) ORDER BY c.created_at DESC LIMIT 300`, since, viewer)
      .filter(c => canSeeClip(viewer, c));
    const count = (sql, ...a) => get(sql, ...a)?.n || 0;
    const clips = clipRows.map(c => {
      const m = {
        views: count('SELECT COUNT(*) n FROM clip_views WHERE clip_id=? AND user_id<>?', c.id, c.author_id),
        favs: count('SELECT COUNT(*) n FROM clip_favs WHERE clip_id=? AND user_id<>?', c.id, c.author_id),
        shares: count('SELECT COUNT(*) n FROM clip_shares WHERE clip_id=?', c.id),
        reacts: c.message_id ? count('SELECT COUNT(DISTINCT user_id) n FROM reactions WHERE message_id=? AND user_id<>?', c.message_id, c.author_id) : 0,
        replies: c.message_id ? count('SELECT COUNT(DISTINCT author_id) n FROM messages WHERE reply_to=? AND author_id<>?', c.message_id, c.author_id) : 0,
      };
      const recent = count('SELECT COUNT(*) n FROM clip_views WHERE clip_id=? AND user_id<>? AND at>?', c.id, c.author_id, t0 - 864e5);
      const raw = Object.entries(CLIP_W).reduce((s, [k, w]) => s + w * m[k], 0);
      const game = clipGame(c, viewer);
      const you = c.streamer_id === viewer, friend = frSet.has(c.author_id) || frSet.has(c.streamer_id);
      const mine = !!game && ggKeys(game.platform, game.game.id, game.game.title, game.game).some(k => myGames.has(k));
      const seen = !!get('SELECT 1 x FROM clip_views WHERE clip_id=? AND user_id=?', c.id, viewer);
      const age = (t0 - c.created_at) / 864e5;
      const score = raw * Math.pow(0.5, age / 7) * (you ? 1.5 : 1) * (friend ? 1.25 : 1) * (mine ? 1.25 : 1) * (seen ? 0.85 : 1);
      return { c, m, recent, raw, score, game, you, mine, seen };
    }).filter(x => x.raw >= CLIP_MIN).sort((a, b) => b.score - a.score || b.c.created_at - a.c.created_at);
    // categorias especiais: cada uma vai para UM clipe (o que mais se destaca nela), sem repetir clipe
    const tagged = new Map(), give = (kind, pick) => { const x = pick(); if (x && !tagged.has(x.c.id)) tagged.set(x.c.id, kind); };
    const best = (k, min) => clips.filter(x => x.m[k] >= min).sort((a, b) => b.m[k] - a.m[k])[0];
    give('you', () => clips.find(x => x.you));
    give('hot', () => clips.filter(x => x.recent >= 3).sort((a, b) => b.recent - a.recent)[0]);
    give('fav', () => best('favs', 2)); give('shared', () => best('shares', 2)); give('talk', () => best('replies', 2) || best('reacts', 3)); give('views', () => best('views', 3));
    give('foryou', () => clips.find(x => x.mine && !x.seen));
    // recomendação personalizada: se nenhum dos primeiros é "você aparece" ou "do seu jogo", o último lugar vai para o melhor deles
    const pick = clips.slice(0, top), personal = (x) => x.you || (x.mine && !x.seen);
    if (pick.length === top && !pick.some(personal)) { const r = clips.slice(top).find(personal); if (r) pick[top - 1] = r; }
    const outClips = pick.map((x) => ({
      id: x.c.id, title: x.c.title, url: x.c.url, secs: x.c.secs, guild_id: x.c.guild_id, channel_id: x.c.channel_id, at: x.c.created_at,
      author_id: x.c.author_id, streamer_id: x.c.streamer_id, ...(x.game ? { platform: x.game.platform, game: x.game.game } : {}),
      metrics: x.m, score: Math.round(x.score * 10) / 10, seen: x.seen, tag: tagged.get(x.c.id) || (x.mine && !x.seen ? 'foryou' : null),
    }));
    return { days, games: ranked, played, clips: outClips };
  }
  // jogo do clipe: o que o dono da transmissão (ou quem clipou) estava jogando naquela hora, se você pode ver
  function clipGame(c, viewer) {
    const uid = c.streamer_id || c.author_id;
    const st = get(`SELECT * FROM activities WHERE user_id=? AND kind='game_start' AND created_at<=? AND created_at>? ORDER BY created_at DESC LIMIT 1`, uid, c.created_at + 60e3, c.created_at - 12 * 3600e3);
    if (!st) { const e = [...current.values()].find(e => e.uid === uid && e.since <= c.created_at); return e && canSee(viewer, uid, e.platform) && !hiddenGame(uid, e.platform, e.game.id) ? { platform: e.platform, game: e.game } : null; }
    const end = get(`SELECT created_at t FROM activities WHERE user_id=? AND platform=? AND game_id=? AND kind='game_stop' AND created_at>=? ORDER BY created_at LIMIT 1`, uid, st.platform, st.game_id, st.created_at);
    if (end && end.t < c.created_at - 60e3) return null; // a partida já tinha acabado
    if (!canSee(viewer, uid, st.platform) || hiddenGame(uid, st.platform, st.game_id) || isLauncher({ id: st.game_id, title: st.title })) return null;
    return { platform: st.platform, game: gameOf(st.game_id, st.title, parse(st.data)) };
  }

  // ---- ganchos chamados pelas rotas ----
  // consulta logo (vinculou, ligou a visibilidade): vários pedidos juntos viram UMA consulta. Antes cada um agendava a sua
  // para 200 ms depois (todos passavam pela checagem antes da primeira rodar) e a Steam recebia o mesmo lote várias vezes
  let pokeTimer = null;
  const poke = () => {
    if (stopped || running || pokeTimer || now() - lastTickAt <= 10000) return;
    pokeTimer = setTimeout(() => { pokeTimer = null; tick().catch(() => { }); }, 200); pokeTimer.unref?.();
  };
  return {
    start() { stopped = false; setTimeout(() => tick().catch(() => { }), 3000).unref?.(); schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
    tick, poke, readyFor, feedFor, weekFor, guildGames, canSee, audience,
    _ggClear() { ggCache.clear(); },
    onLinked() { poke(); },
    // desvinculou: encerra a publicação (avisando o público ANTES de apagar a conta) e limpa o cache da conta
    onUnlinking(uid, platform, externalId) {
      clear(uid, platform, { why: 'unlink' });
      cache.delete(platform + ':' + externalId);
    },
    // chamado ANTES de gravar a nova visibilidade (para ainda conhecer o público atual): desligar some para todos agora; ligar consulta logo
    onVisibility(uid, platform, visibility) {
      if (visibility === 'off') clear(uid, platform, { why: 'off' });
      else setTimeout(poke, 50).unref?.();
    },
    // jogo aberto no PC, informado pelo app desktop (game = { id, title } | null). Mesmo fluxo da Steam: publica, troca, encerra.
    reportLocal(uid, game) {
      const k = uid + ':pc', prev = current.get(k);
      if (!game || isLauncher(game) || pcVis(uid) === 'off' || hiddenGame(uid, 'pc', game.id)) return clear(uid, 'pc'); // launcher (Riot Client, Steam…) não é jogo
      game = { id: game.id, title: game.title, ...(game.icon ? { icon: game.icon } : {}), ...(game.steam ? { steam: game.steam } : {}), ...(game.known ? { known: game.known } : {}) };
      if (prev && prev.game.id === game.id) {
        prev.at = now();
        if ((game.icon && prev.game.icon !== game.icon) || (game.steam && prev.game.steam !== game.steam) || prev.game.title !== game.title) { prev.game = { ...prev.game, ...game }; publish(uid, 'pc', prev); } // a imagem (ou o nome certo) chegou depois
        return;
      }
      if (prev) clear(uid, 'pc');
      const entry = { uid, platform: 'pc', game, since: now(), state: null, at: now(), quiet: isInvisible(uid) };
      current.set(k, entry); if (!entry.quiet) record(uid, 'pc', 'game_start', game, artOf(game, 'pc'));
      publish(uid, 'pc', entry);
    },
    clearLocal(uid) { clear(uid, 'pc'); }, // fechou o app (última conexão caiu)
    // mudou quem pode ver o jogo do PC: quem deixou de poder ver recebe "parou"; quem passou a poder, recebe o jogo atual
    onPcVisibility(uid, before, after) {
      const e = current.get(uid + ':pc'); if (!e) return;
      if (after === 'off') return clear(uid, 'pc', { why: 'off', audienceOverride: [...new Set([uid, ...friendsOf(uid), ...guildPeers(uid)])] });
      const all0 = new Set([...friendsOf(uid), ...guildPeers(uid)]);
      for (const v of all0) dispatch([v], 'ACTIVITY_UPDATE', { user_id: uid, platform: 'pc', activity: canSee(v, uid, 'pc') ? pub(e) : null });
      void before;
    },
    // mudou quem pode ver a atividade (privacidade da presença): cada um recebe o atual ou "parou", conforme pode ver agora
    onPresencePrivacy(uid) {
      const cands = new Set([...friendsOf(uid), ...guildPeers(uid)]);
      for (const e of current.values()) if (e.uid === uid) for (const v of cands) dispatch([v], 'ACTIVITY_UPDATE', { user_id: uid, platform: e.platform, activity: canSee(v, uid, e.platform) ? pub(e) : null });
    },
    // ficou invisível: a atividade some para todos na hora e a sessão não entra no histórico (nem o "jogou por 2 h" depois);
    // voltou a aparecer: quem pode ver recebe o jogo atual
    onInvisible(uid, invisible) {
      const cands = [...new Set([...friendsOf(uid), ...guildPeers(uid)])];
      for (const e of current.values()) if (e.uid === uid) {
        if (invisible) e.quiet = true;
        for (const v of cands) dispatch([v], 'ACTIVITY_UPDATE', { user_id: uid, platform: e.platform, activity: canSee(v, uid, e.platform) ? pub(e) : null });
      }
    },
    onGameHidden(uid, platform, gameId) { const cur = current.get(uid + ':' + platform); if (cur?.game.id === gameId) clear(uid, platform, { why: 'hidden' }); },
    // amizade criada/desfeita: cada lado passa a ver (ou deixa de ver) o que o outro está jogando, na hora
    onFriendsChanged(a, b) {
      for (const [x, y] of [[a, b], [b, a]]) for (const e of current.values()) if (e.uid === x) dispatch([y], 'ACTIVITY_UPDATE', { user_id: x, platform: e.platform, activity: canSee(y, x, e.platform) ? pub(e) : null });
    },
    status: () => ({ interval_secs: intervalMs() / 1000, platforms: Object.fromEntries([...health].map(([k, v]) => [k, { failures: v.failures, disabled: v.disabled, last_error: v.lastError, last_ok: v.lastOk, next_in_ms: Math.max(0, v.nextAt - now()) }])), published: current.size, cached: cache.size }),
    _state: { current, cache, health },
  };
}
