// Conquistas e platinas: aba Conquistas na seção Jogos e no perfil de cada pessoa.
//
// De onde vem:
//   - Steam vinculada (API oficial ISteamUserStats, precisa de STEAM_API_KEY): para os jogos jogados da biblioteca (os
//     ACH_GAMES mais recentes/mais jogados), quantas conquistas o jogo tem e quais a pessoa desbloqueou, quando, e a
//     raridade de cada uma (% dos jogadores). Jogo com tudo desbloqueado = 100% (a "platina" da Steam). Sincroniza ao abrir
//     a aba (se passou de 6 h), no botão "Sincronizar agora" e de tempos em tempos para quem tem a Steam vinculada.
//   - PlayStation, Xbox, Epic, Nintendo e outras: essas plataformas não têm API pública oficial para ler troféus de outra
//     pessoa (a da Epic só existe dentro do próprio jogo). A pessoa pode registrar as platinas e os 100% dela à mão; a tela
//     marca esses como "informado" (não verificado). O jogo registrado é procurado pelo nome na loja da Steam e na da Epic
//     (server/epicstore.js): o cartão ganha a arte do jogo e as conquistas mais raras dele, com os ícones (Epic: catálogo
//     público de conquistas; Steam: GetSchemaForGame), e quantos % dos jogadores fizeram 100% (Epic).
//
// PRIVACIDADE: a mesma regra da biblioteca de jogos (users.games_share em server/games.js → canSee): servidores, só amigos
// ou ninguém; bloqueio esconde. A pessoa sempre vê as próprias.
//
// Rotas:
//   GET    /api/users/:id/achievements   -> { me, steam: { linked, configured, state, synced_at, syncing }, summary, perfect, games, recent, rare, manual }
//   POST   /api/achievements/sync        -> sincroniza a Steam agora (1 vez a cada 2 min)
//   POST   /api/achievements/manual      { platform, title, kind: 'platinum'|'complete', achieved_at? } -> platina/100% informado
//   DELETE /api/achievements/manual/:id
import { PollError } from './integrations/errors.js';
import { findEpicGame, epicAchievements } from './epicstore.js';

export const MANUAL_PLATFORMS = { psn: 'PlayStation', xbox: 'Xbox', epic: 'Epic Games', switch: 'Nintendo Switch', gog: 'GOG', ea: 'EA app', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net', other: 'Outra' };
const KINDS = ['platinum', 'complete'];
const ACH_GAMES = +process.env.ACH_GAMES || 40;   // jogos consultados por pessoa a cada sincronização
const FRESH = 6 * 3600e3, AUTO_EVERY = 24 * 3600e3, INFO_TTL = 7 * 864e5, MANUAL_GAP = 120e3, MANUAL_MAX = 300;

export function mountAchievements(app, { auth, wrap, bad, db, all, get, run, newId, getAdapter, dispatch, canSee, ensureLibrary = async () => { }, findSteamApp = async () => null, clean, log = console.log, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS ach_games(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, appid TEXT NOT NULL, title TEXT,
    total INTEGER NOT NULL DEFAULT 0, unlocked INTEGER NOT NULL DEFAULT 0, last_unlock INTEGER, checked_at INTEGER, PRIMARY KEY(user_id, platform, appid));
  CREATE TABLE IF NOT EXISTS ach_unlocks(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, appid TEXT NOT NULL, api TEXT NOT NULL,
    unlocked_at INTEGER, PRIMARY KEY(user_id, platform, appid, api));
  CREATE INDEX IF NOT EXISTS ach_unlocks_recent ON ach_unlocks(user_id, unlocked_at DESC);
  CREATE TABLE IF NOT EXISTS ach_info(platform TEXT NOT NULL, appid TEXT NOT NULL, data TEXT, fetched_at INTEGER, PRIMARY KEY(platform, appid));
  CREATE TABLE IF NOT EXISTS ach_sync(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, state TEXT, synced_at INTEGER, manual_at INTEGER, PRIMARY KEY(user_id, platform));
  CREATE TABLE IF NOT EXISTS ach_manual(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, title TEXT NOT NULL,
    kind TEXT NOT NULL, achieved_at INTEGER, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS ach_manual_user ON ach_manual(user_id, achieved_at DESC);`);
  try { db.exec('ALTER TABLE ach_manual ADD COLUMN art TEXT'); } catch { /* já existe */ }

  const steamAcct = (uid) => get("SELECT * FROM linked_accounts WHERE user_id=? AND platform='steam'", uid);
  const syncRow = (uid) => get("SELECT * FROM ach_sync WHERE user_id=? AND platform='steam'", uid);
  const setSync = (uid, patch) => {
    const cur = syncRow(uid) || {}, n = { state: null, synced_at: null, manual_at: null, ...cur, ...patch };
    run(`INSERT INTO ach_sync(user_id,platform,state,synced_at,manual_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,platform) DO UPDATE SET state=excluded.state, synced_at=excluded.synced_at, manual_at=excluded.manual_at`,
      uid, 'steam', n.state, n.synced_at, n.manual_at);
  };
  const infoOf = (appid) => { const r = get("SELECT data FROM ach_info WHERE platform='steam' AND appid=?", appid); try { return r ? JSON.parse(r.data) : null; } catch { return null; } };

  // ---- sincronização com a Steam ----
  const busy = new Set();
  async function syncSteam(uid) {
    const a = steamAcct(uid), ad = getAdapter('steam');
    if (!a || !ad?.achievements || busy.has(uid)) return null;
    if (!ad.configured()) { setSync(uid, { state: 'nokey', synced_at: now() }); return 'nokey'; }
    busy.add(uid); dispatch([uid], 'ACHIEVEMENTS_UPDATE', { syncing: true });
    let state = 'ok';
    try {
      if (!get("SELECT 1 x FROM game_library WHERE user_id=? AND platform='steam' LIMIT 1", uid)) await ensureLibrary(uid).catch(() => { }); // biblioteca ainda não veio
      const games = all(`SELECT appid, title, minutes, last_played FROM game_library WHERE user_id=? AND platform='steam' AND minutes>0
        ORDER BY COALESCE(last_played,0) DESC, minutes DESC LIMIT ?`, uid, ACH_GAMES);
      for (const g of games) {
        const prev = get("SELECT * FROM ach_games WHERE user_id=? AND platform='steam' AND appid=?", uid, g.appid);
        if (prev?.checked_at && now() - prev.checked_at < FRESH && (g.last_played || 0) <= prev.checked_at) continue; // nada novo desde a última vez
        let r;
        try { r = await ad.achievements(a.external_id, g.appid); }
        catch (e) { if (e instanceof PollError && (e.status === 401 || e.status === 403)) { state = 'nokey'; break; } state = 'error'; log('[conquistas] ' + e.message); continue; }
        if (r.private) { state = 'private'; break; }
        if (r.none) { run(`INSERT INTO ach_games(user_id,platform,appid,title,total,unlocked,last_unlock,checked_at) VALUES(?,?,?,?,0,0,NULL,?)
          ON CONFLICT(user_id,platform,appid) DO UPDATE SET title=excluded.title, total=0, unlocked=0, checked_at=excluded.checked_at`, uid, 'steam', g.appid, g.title, now()); continue; }
        const last = Math.max(0, ...r.unlocked.map(x => x.at || 0)) || null;
        db.exec('BEGIN');
        try {
          run("DELETE FROM ach_unlocks WHERE user_id=? AND platform='steam' AND appid=?", uid, g.appid);
          for (const x of r.unlocked) run('INSERT OR REPLACE INTO ach_unlocks(user_id,platform,appid,api,unlocked_at) VALUES(?,?,?,?,?)', uid, 'steam', g.appid, x.api.slice(0, 200), x.at);
          run(`INSERT INTO ach_games(user_id,platform,appid,title,total,unlocked,last_unlock,checked_at) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(user_id,platform,appid) DO UPDATE SET title=excluded.title, total=excluded.total, unlocked=excluded.unlocked, last_unlock=excluded.last_unlock, checked_at=excluded.checked_at`,
            uid, 'steam', g.appid, g.title, r.total, r.unlocked.length, last, now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        // nomes, ícones e raridade: uma vez por jogo (vale para todo mundo), renovado a cada 7 dias
        if (r.unlocked.length && !(get("SELECT fetched_at t FROM ach_info WHERE platform='steam' AND appid=?", g.appid)?.t > now() - INFO_TTL)) {
          try { const info = await ad.achievementInfo(g.appid); run("INSERT OR REPLACE INTO ach_info(platform,appid,data,fetched_at) VALUES('steam',?,?,?)", g.appid, JSON.stringify(info), now()); }
          catch (e) { log('[conquistas] detalhes de ' + g.appid + ': ' + e.message); }
        }
        await new Promise(res => setTimeout(res, +process.env.ACH_GAP_MS || 150)); // sem rajada na Steam
      }
      setSync(uid, { state, synced_at: now() });
      return state;
    } finally { busy.delete(uid); dispatch([uid], 'ACHIEVEMENTS_UPDATE', { syncing: false }); }
  }
  // de hora em hora: quem tem a Steam vinculada, compartilha os jogos e não sincroniza há 24 h (uma pessoa por vez)
  let timer = null, stopped = false;
  async function sweep() {
    const due = all(`SELECT la.user_id FROM linked_accounts la JOIN users u ON u.id=la.user_id LEFT JOIN ach_sync s ON s.user_id=la.user_id AND s.platform='steam'
      WHERE la.platform='steam' AND u.games_share<>'off' AND (s.synced_at IS NULL OR s.synced_at<?) LIMIT 10`, now() - AUTO_EVERY);
    for (const r of due) { if (stopped) return; await syncSteam(r.user_id).catch(e => log('[conquistas] ' + e.message)); }
  }
  if (process.env.ACH_SYNC !== '0') { const loop = () => { timer = setTimeout(async () => { await sweep().catch(() => { }); loop(); }, 3600e3); timer.unref?.(); }; loop(); }

  // ---- arte e conquistas das platinas registradas à mão ----
  // O jogo é procurado pelo nome na loja da Steam (arte oficial) e na Epic (arte da loja e o catálogo público de
  // conquistas). Platina/100% = todas desbloqueadas, então o cartão mostra as mais raras do jogo com os ícones e quantas
  // são. Catálogo: o da Epic para jogos da Epic (ou sem Steam); senão o da Steam (precisa da chave). Feito uma vez ao
  // registrar (e de novo depois de 7 dias se nada foi achado). art = { at, steam?, epic?: { slug, image, thumb }, total?, plat_pct?, src?, icons? }
  const ART_RETRY = 7 * 864e5, resolving = new Set();
  const rarest = (list) => list.filter(a => a.icon).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)).slice(0, 5).map(a => ({ name: a.name, desc: a.desc || '', icon: a.icon, pct: a.pct ?? null }));
  async function steamCatalog(appid) {
    let info = infoOf(appid);
    const ad = getAdapter('steam');
    if (!info && ad?.achievementInfo && ad.configured()) {
      try { info = await ad.achievementInfo(appid); run("INSERT OR REPLACE INTO ach_info(platform,appid,data,fetched_at) VALUES('steam',?,?,?)", appid, JSON.stringify(info), now()); } catch { info = null; }
    }
    const list = Object.values(info?.list || {});
    return list.length ? { total: list.length, list, src: 'steam' } : null;
  }
  async function resolveArt(m) {
    if (resolving.has(m.id)) return; resolving.add(m.id);
    try {
      const art = { at: now() };
      const [steam, epic] = await Promise.all([findSteamApp(m.title).catch(() => null), findEpicGame(m.title).catch(() => null)]);
      if (steam?.appid) art.steam = String(steam.appid);
      if (epic) art.epic = { slug: epic.slug, image: epic.image, thumb: epic.thumb };
      const fromEpic = async () => { const e = epic?.sandbox && await epicAchievements(epic.sandbox).catch(() => null); return e?.list.length ? { total: e.total, plat_pct: e.platinumPct, list: e.list, src: 'epic' } : null; };
      const fromSteam = async () => (art.steam ? steamCatalog(art.steam) : null);
      const cat = m.platform === 'epic' || !art.steam ? (await fromEpic()) || (await fromSteam()) : (await fromSteam()) || (await fromEpic());
      if (cat) Object.assign(art, { total: cat.total, src: cat.src, icons: rarest(cat.list), ...(cat.plat_pct != null ? { plat_pct: cat.plat_pct } : {}) });
      run('UPDATE ach_manual SET art=? WHERE id=?', JSON.stringify(art), m.id);
      dispatch([m.user_id], 'ACHIEVEMENTS_UPDATE', {});
    } catch (e) { log('[conquistas] arte de ' + m.title + ': ' + e.message); }
    finally { resolving.delete(m.id); }
  }
  const artOf = (m) => { try { return m.art ? JSON.parse(m.art) : null; } catch { return null; } };
  const needsArt = (m) => { const a = artOf(m); return !a || (!a.steam && !a.epic && now() - (a.at || 0) > ART_RETRY); };

  // ---- leitura ----
  function view(uid, viewer) {
    const a = steamAcct(uid), ad = getAdapter('steam'), s = syncRow(uid);
    const games = all("SELECT * FROM ach_games WHERE user_id=? AND total>0 ORDER BY COALESCE(last_unlock,0) DESC", uid);
    const infos = new Map(); const info = (appid) => { if (!infos.has(appid)) infos.set(appid, infoOf(appid)); return infos.get(appid); };
    const gameOf = (g) => ({ platform: 'steam', appid: g.appid, title: g.title || info(g.appid)?.title || 'Jogo ' + g.appid });
    const ach = (u) => { const d = info(u.appid)?.list?.[u.api]; const g = games.find(x => x.appid === u.appid); return { appid: u.appid, game: g ? gameOf(g).title : null, api: u.api, name: d?.name || u.api, desc: d?.desc || '', icon: d?.icon || null, pct: d?.pct ?? null, at: u.unlocked_at }; };
    const unlocks = all('SELECT * FROM ach_unlocks WHERE user_id=? ORDER BY COALESCE(unlocked_at,0) DESC', uid);
    // 100% da Steam: as conquistas mais raras do jogo (todas desbloqueadas) com os ícones
    const steamIcons = (appid) => rarest(Object.values(info(appid)?.list || {}));
    const perfect = games.filter(g => g.unlocked >= g.total).map(g => ({ ...gameOf(g), total: g.total, at: g.last_unlock, icons: steamIcons(g.appid) }));
    const rows = all('SELECT * FROM ach_manual WHERE user_id=? ORDER BY COALESCE(achieved_at,created_at) DESC', uid);
    for (const m of rows) if (needsArt(m)) setTimeout(() => resolveArt(m), 0); // registros antigos (ou que não acharam nada há 7 dias)
    const manual = rows.map(m => { const a = artOf(m) || {};
      return { id: m.id, platform: m.platform, platform_name: MANUAL_PLATFORMS[m.platform] || m.platform, title: m.title, kind: m.kind, at: m.achieved_at, manual: true,
        ...(a.steam ? { appid: a.steam } : {}), ...(a.epic?.thumb ? { image: a.epic.thumb, epic_url: `https://store.epicgames.com/pt-BR/p/${a.epic.slug}` } : {}),
        ...(a.total ? { total: a.total } : {}), ...(a.plat_pct != null ? { plat_pct: a.plat_pct } : {}), icons: a.icons || [], icons_from: a.src || null }; });
    const rare = unlocks.map(ach).filter(x => x.pct != null).sort((x, y) => x.pct - y.pct).slice(0, 6);
    return {
      me: uid === viewer,
      steam: { linked: !!a, configured: !!ad?.configured?.(), state: s?.state || null, synced_at: s?.synced_at || null, syncing: busy.has(uid) },
      summary: { perfect: perfect.length + manual.length, unlocked: unlocks.length, games: games.length,
        completion: games.length ? Math.round(games.reduce((n, g) => n + g.unlocked / g.total, 0) / games.length * 100) : null },
      perfect, manual,
      games: games.map(g => ({ ...gameOf(g), total: g.total, unlocked: g.unlocked, at: g.last_unlock })).sort((x, y) => (y.unlocked / y.total) - (x.unlocked / x.total) || (y.at || 0) - (x.at || 0)).slice(0, 60),
      recent: unlocks.slice(0, 24).map(ach), rare,
    };
  }

  app.get('/api/users/:id/achievements', auth, wrap((req, res) => {
    const uid = req.params.id === '@me' || req.params.id === 'me' ? req.uid : String(req.params.id);
    if (!get('SELECT 1 x FROM users WHERE id=?', uid)) return bad(res, 'Usuário não encontrado', 404);
    if (!canSee(req.uid, uid)) return bad(res, 'Essa pessoa não compartilha os jogos com você', 403);
    const s = syncRow(uid);
    // abriu a aba e os dados estão velhos (ou nunca vieram): atualiza em segundo plano; a tela recebe ACHIEVEMENTS_UPDATE
    if (steamAcct(uid) && (!s?.synced_at || now() - s.synced_at > FRESH)) setTimeout(() => syncSteam(uid).catch(e => log('[conquistas] ' + e.message)), 0);
    res.json(view(uid, req.uid));
  }));
  app.post('/api/achievements/sync', auth, wrap(async (req, res) => {
    if (!steamAcct(req.uid)) return bad(res, 'Vincule a Steam em Configurações → Conexões para trazer as conquistas');
    const s = syncRow(req.uid);
    if (s?.manual_at && now() - s.manual_at < MANUAL_GAP) return bad(res, 'Acabou de sincronizar; tente de novo em alguns minutos', 429);
    setSync(req.uid, { manual_at: now() });
    run("UPDATE ach_games SET checked_at=0 WHERE user_id=? AND platform='steam'", req.uid); // pedido explícito: consulta tudo de novo
    const state = await syncSteam(req.uid);
    res.json({ ...view(req.uid, req.uid), state });
  }));
  app.post('/api/achievements/manual', auth, wrap((req, res) => {
    const platform = String(req.body?.platform || ''), kind = String(req.body?.kind || 'platinum'), title = clean(req.body?.title, 120);
    if (!MANUAL_PLATFORMS[platform]) return bad(res, 'Plataforma inválida');
    if (!KINDS.includes(kind)) return bad(res, 'Tipo inválido');
    if (!title) return bad(res, 'Diga o nome do jogo');
    const at = req.body?.achieved_at == null || req.body.achieved_at === '' ? null : +new Date(req.body.achieved_at);
    if (at != null && (!Number.isFinite(at) || at > now() + 864e5 || at < Date.UTC(1995, 0, 1))) return bad(res, 'Data inválida');
    if ((get('SELECT COUNT(*) n FROM ach_manual WHERE user_id=?', req.uid)?.n || 0) >= MANUAL_MAX) return bad(res, `Limite de ${MANUAL_MAX} registros`, 409);
    if (get('SELECT 1 x FROM ach_manual WHERE user_id=? AND platform=? AND kind=? AND lower(title)=lower(?)', req.uid, platform, kind, title)) return bad(res, 'Você já registrou isso', 409);
    const id = newId();
    run('INSERT INTO ach_manual(id,user_id,platform,title,kind,achieved_at,created_at) VALUES(?,?,?,?,?,?,?)', id, req.uid, platform, title, kind, at, now());
    setTimeout(() => resolveArt(get('SELECT * FROM ach_manual WHERE id=?', id)), 0); // arte e conquistas do jogo chegam por ACHIEVEMENTS_UPDATE
    dispatch([req.uid], 'ACHIEVEMENTS_UPDATE', {});
    res.json(view(req.uid, req.uid));
  }));
  app.delete('/api/achievements/manual/:id', auth, wrap((req, res) => {
    run('DELETE FROM ach_manual WHERE id=? AND user_id=?', String(req.params.id), req.uid);
    dispatch([req.uid], 'ACHIEVEMENTS_UPDATE', {});
    res.json(view(req.uid, req.uid));
  }));

  return {
    syncSteam, sweep, resolveArt,
    onUnlinked(uid) { for (const t of ['ach_games', 'ach_unlocks', 'ach_sync']) run(`DELETE FROM ${t} WHERE user_id=? AND platform='steam'`, uid); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
