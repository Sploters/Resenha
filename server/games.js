// Biblioteca e lista de desejos (wishlist): quem da Resenha tem cada jogo e quem quer.
//
// De onde vem:
//   - Steam vinculada: a biblioteca (jogos e horas, GetOwnedGames, precisa de STEAM_API_KEY) e a wishlist da Steam são
//     copiadas ao vincular, a cada 12 h e no botão "Sincronizar agora". Perfil ou "Detalhes do jogo" privados na Steam:
//     a Steam devolve vazio e a página mostra o aviso.
//   - Wishlist da Resenha: qualquer pessoa adiciona um jogo da Steam (botão "Quero" no cartão do link, ou colando o link),
//     com ou sem conta vinculada. Os itens da Steam só saem tirando na Steam (a próxima sincronização traz de novo).
//
// PRIVACIDADE (users.games_share), a mesma regra em tudo (cartões, perfil, wishlist do servidor):
//   'servers' (padrão) = amigos + quem divide um servidor com a pessoa; 'friends' = só amigos; 'off' = ninguém.
//   Bloqueio (de qualquer lado) esconde sempre. A pessoa sempre vê o próprio.
//
// Rotas:
//   GET    /api/games/people?ids=1,2      -> { appid: { owners: [{ user_id, minutes }], wish: [user_id] } }  (só quem você pode ver)
//   GET    /api/games/me                  -> { share, steam: { linked, configured, library_state, library_count, wishlist_state, wishlist_count, synced_at }, wishlist: [{ appid, sources, added_at }] }
//   PATCH  /api/games/me                  { share }
//   POST   /api/games/sync                -> sincroniza a Steam agora (1 vez a cada 2 min)
//   PUT    /api/wishlist/:appid           -> põe na wishlist da Resenha        DELETE /api/wishlist/:appid -> tira (só os da Resenha)
//   GET    /api/users/:id/games           -> { wishlist: [{ appid, added_at }], top: [{ appid, title, minutes }], count } (se pode ver)
//   GET    /api/guilds/:id/wishlist       -> { items: [{ appid, wish: [uids], owners: [uids] }], members, wishers } (membros que você pode ver)
import { PollError } from './integrations/errors.js';

export const SHARE = ['servers', 'friends', 'off'];
const SYNC_EVERY = 12 * 3600e3, MANUAL_GAP = 120e3;
const appidOk = (x) => /^\d{1,10}$/.test(String(x || ''));

export function mountGames(app, { auth, wrap, bad, db, all, get, run, getAdapter, dispatch, userPub, log = console.log, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS game_library(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, appid TEXT NOT NULL, title TEXT,
    minutes INTEGER NOT NULL DEFAULT 0, last_played INTEGER, PRIMARY KEY(user_id, platform, appid));
  CREATE INDEX IF NOT EXISTS game_library_app ON game_library(appid);
  CREATE TABLE IF NOT EXISTS wishlist(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, appid TEXT NOT NULL, source TEXT NOT NULL, added_at INTEGER,
    PRIMARY KEY(user_id, appid, source));
  CREATE INDEX IF NOT EXISTS wishlist_app ON wishlist(appid);
  CREATE TABLE IF NOT EXISTS game_sync(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, library_state TEXT, library_count INTEGER,
    wishlist_state TEXT, wishlist_count INTEGER, synced_at INTEGER, PRIMARY KEY(user_id, platform));`);
  try { db.exec("ALTER TABLE users ADD COLUMN games_share TEXT NOT NULL DEFAULT 'servers'"); } catch { /* já existe */ }

  // ---- privacidade ----
  const shareOf = (uid) => get('SELECT games_share v FROM users WHERE id=?', uid)?.v || 'servers';
  const areFriends = (a, b) => !!get('SELECT 1 x FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id WHERE r1.user_id=? AND r1.other_id=? AND r1.type=1 AND r2.type=1', a, b);
  const shareGuild = (a, b) => !!get('SELECT 1 x FROM members m1 JOIN members m2 ON m2.guild_id=m1.guild_id WHERE m1.user_id=? AND m2.user_id=?', a, b);
  const blocked = (a, b) => !!get('SELECT 1 x FROM relationships WHERE ((user_id=? AND other_id=?) OR (user_id=? AND other_id=?)) AND type=2', a, b, b, a);
  const canSee = (viewer, owner) => {
    if (viewer === owner) return true;
    const s = shareOf(owner); if (s === 'off' || blocked(viewer, owner)) return false;
    return areFriends(viewer, owner) || (s === 'servers' && shareGuild(viewer, owner));
  };
  const seer = (viewer) => { const memo = new Map(); return (owner) => { if (!memo.has(owner)) memo.set(owner, canSee(viewer, owner)); return memo.get(owner); }; };

  // ---- sincronização com a Steam ----
  const steamAcct = (uid) => get("SELECT * FROM linked_accounts WHERE user_id=? AND platform='steam'", uid);
  const syncRow = (uid) => get("SELECT * FROM game_sync WHERE user_id=? AND platform='steam'", uid);
  const busy = new Set();
  async function syncSteam(uid) {
    const a = steamAcct(uid), ad = getAdapter('steam'); if (!a || !ad?.library || busy.has(uid)) return null;
    busy.add(uid);
    const st = { library_state: null, library_count: 0, wishlist_state: null, wishlist_count: 0 };
    try {
      try {
        if (!ad.configured()) st.library_state = 'nokey';
        else {
          const lib = await ad.library(a.external_id);
          if (lib.private) st.library_state = 'private';
          else {
            st.library_state = 'ok'; st.library_count = lib.games.length;
            db.exec('BEGIN');
            try {
              run("DELETE FROM game_library WHERE user_id=? AND platform='steam'", uid);
              for (const g of lib.games) run("INSERT OR REPLACE INTO game_library(user_id,platform,appid,title,minutes,last_played) VALUES(?,?,?,?,?,?)", uid, 'steam', g.appid, g.title ? String(g.title).slice(0, 200) : null, g.minutes, g.last);
              db.exec('COMMIT');
            } catch (e) { db.exec('ROLLBACK'); throw e; }
          }
        }
      } catch (e) { st.library_state = e instanceof PollError && (e.status === 401 || e.status === 403) ? 'nokey' : 'error'; log('[jogos] biblioteca: ' + e.message); }
      try {
        const w = await ad.wishlist(a.external_id);
        st.wishlist_state = 'ok'; st.wishlist_count = w.items.length;
        db.exec('BEGIN');
        try {
          const keep = new Set(w.items.map(x => x.appid));
          for (const r of all("SELECT appid FROM wishlist WHERE user_id=? AND source='steam'", uid)) if (!keep.has(r.appid)) run("DELETE FROM wishlist WHERE user_id=? AND appid=? AND source='steam'", uid, r.appid);
          for (const x of w.items) run("INSERT INTO wishlist(user_id,appid,source,added_at) VALUES(?,?,?,?) ON CONFLICT(user_id,appid,source) DO UPDATE SET added_at=excluded.added_at", uid, x.appid, 'steam', x.added || now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      } catch (e) { st.wishlist_state = 'error'; log('[jogos] wishlist: ' + e.message); }
      // se a Steam falhou, guarda o estado mas mantém a última contagem boa
      const prev = syncRow(uid);
      if (st.library_state !== 'ok' && st.library_state !== 'private') st.library_count = prev?.library_count || 0;
      if (st.wishlist_state !== 'ok') st.wishlist_count = prev?.wishlist_count || 0;
      run(`INSERT INTO game_sync(user_id,platform,library_state,library_count,wishlist_state,wishlist_count,synced_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(user_id,platform) DO UPDATE SET library_state=excluded.library_state, library_count=excluded.library_count, wishlist_state=excluded.wishlist_state, wishlist_count=excluded.wishlist_count, synced_at=excluded.synced_at`,
        uid, 'steam', st.library_state, st.library_count, st.wishlist_state, st.wishlist_count, now());
      dispatch([uid], 'GAMES_UPDATE', {});
      return st;
    } finally { busy.delete(uid); }
  }
  // de tempos em tempos: contas vinculadas que compartilham e não sincronizam há 12 h, uma por vez
  let timer = null, stopped = false;
  async function sweep() {
    const due = all(`SELECT la.user_id FROM linked_accounts la JOIN users u ON u.id=la.user_id LEFT JOIN game_sync gs ON gs.user_id=la.user_id AND gs.platform='steam'
      WHERE la.platform='steam' AND u.games_share<>'off' AND (gs.synced_at IS NULL OR gs.synced_at<?) LIMIT 50`, now() - SYNC_EVERY);
    for (const r of due) { if (stopped) return; await syncSteam(r.user_id).catch(() => { }); await new Promise(r => setTimeout(r, 1500)); }
  }
  const schedule = () => { if (stopped) return; timer = setTimeout(async () => { await sweep().catch(() => { }); schedule(); }, +process.env.GAMES_SWEEP_MS || 30 * 60e3); timer.unref?.(); };
  if (process.env.GAMES_SYNC !== '0') { setTimeout(() => sweep().catch(() => { }), 20000).unref?.(); schedule(); }

  // ---- leitura ----
  const wishOf = (uid) => all('SELECT appid, GROUP_CONCAT(source) sources, MIN(added_at) added_at FROM wishlist WHERE user_id=? GROUP BY appid ORDER BY MIN(added_at) DESC', uid)
    .map(r => ({ appid: r.appid, sources: String(r.sources || '').split(','), added_at: r.added_at }));

  app.get('/api/games/people', auth, wrap((req, res) => {
    const ids = [...new Set(String(req.query.ids || '').split(',').filter(appidOk))].slice(0, 30);
    const out = Object.fromEntries(ids.map(id => [id, { owners: [], wish: [] }]));
    if (!ids.length) return res.json(out);
    const ph = ids.map(() => '?').join(','), see = seer(req.uid);
    for (const r of all(`SELECT appid, user_id, MAX(minutes) minutes FROM game_library WHERE appid IN (${ph}) GROUP BY appid, user_id`, ...ids)) if (see(r.user_id)) out[r.appid].owners.push({ user_id: r.user_id, minutes: r.minutes });
    for (const r of all(`SELECT DISTINCT appid, user_id FROM wishlist WHERE appid IN (${ph})`, ...ids)) if (see(r.user_id)) out[r.appid].wish.push(r.user_id);
    for (const v of Object.values(out)) v.owners.sort((a, b) => b.minutes - a.minutes);
    res.set('Cache-Control', 'private, no-cache'); res.json(out);
  }));

  const mine = (uid) => {
    const a = steamAcct(uid), s = syncRow(uid), ad = getAdapter('steam');
    return { share: shareOf(uid), wishlist: wishOf(uid),
      steam: { linked: !!a, configured: !!ad?.configured(), library_state: s?.library_state || (a ? 'pending' : null), library_count: s?.library_count || 0,
        wishlist_state: s?.wishlist_state || (a ? 'pending' : null), wishlist_count: s?.wishlist_count || 0, synced_at: s?.synced_at || null, syncing: busy.has(uid) } };
  };
  app.get('/api/games/me', auth, wrap((req, res) => res.json(mine(req.uid))));
  app.patch('/api/games/me', auth, wrap((req, res) => {
    const s = req.body?.share; if (!SHARE.includes(s)) return bad(res, 'Opção inválida');
    run('UPDATE users SET games_share=? WHERE id=?', s, req.uid);
    if (s !== 'off' && steamAcct(req.uid) && !syncRow(req.uid)) syncSteam(req.uid).catch(() => { });
    res.json(mine(req.uid));
  }));
  const lastManual = new Map();
  app.post('/api/games/sync', auth, wrap((req, res) => {
    if (!steamAcct(req.uid)) return bad(res, 'Vincule a Steam primeiro', 404);
    const t = lastManual.get(req.uid) || 0; if (now() - t < MANUAL_GAP) return bad(res, 'Espere um pouco para sincronizar de novo', 429);
    lastManual.set(req.uid, now());
    syncSteam(req.uid).then(() => { }, () => { });
    res.json({ ...mine(req.uid), steam: { ...mine(req.uid).steam, syncing: true } });
  }));
  app.put('/api/wishlist/:appid', auth, wrap((req, res) => {
    const id = req.params.appid; if (!appidOk(id)) return bad(res, 'Jogo inválido');
    if (get('SELECT COUNT(*) n FROM wishlist WHERE user_id=? AND source=?', req.uid, 'resenha').n >= 500) return bad(res, 'Sua wishlist da Resenha chegou a 500 jogos');
    run('INSERT OR IGNORE INTO wishlist(user_id,appid,source,added_at) VALUES(?,?,?,?)', req.uid, id, 'resenha', now());
    dispatch([req.uid], 'GAMES_UPDATE', { appid: id });
    res.json({ wishlist: wishOf(req.uid) });
  }));
  app.delete('/api/wishlist/:appid', auth, wrap((req, res) => {
    const id = req.params.appid; if (!appidOk(id)) return bad(res, 'Jogo inválido');
    run("DELETE FROM wishlist WHERE user_id=? AND appid=? AND source='resenha'", req.uid, id);
    const still = get("SELECT 1 x FROM wishlist WHERE user_id=? AND appid=? AND source='steam'", req.uid, id);
    dispatch([req.uid], 'GAMES_UPDATE', { appid: id });
    res.json({ wishlist: wishOf(req.uid), steam: !!still });
  }));
  app.get('/api/users/:id/games', auth, wrap((req, res) => {
    const uid = req.params.id; if (!get('SELECT 1 x FROM users WHERE id=?', uid)) return bad(res, 'Usuário não encontrado', 404);
    if (!canSee(req.uid, uid)) return res.json({ hidden: true, wishlist: [], top: [], count: 0 });
    res.json({ wishlist: wishOf(uid).slice(0, 200).map(({ appid, added_at }) => ({ appid, added_at })),
      top: all("SELECT appid, title, minutes FROM game_library WHERE user_id=? AND minutes>0 ORDER BY minutes DESC LIMIT 12", uid),
      count: get('SELECT COUNT(DISTINCT appid) n FROM game_library WHERE user_id=?', uid).n });
  }));
  app.get('/api/guilds/:id/wishlist', auth, wrap((req, res) => {
    const gid = req.params.id; if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem acesso', 403);
    const see = seer(req.uid), members = all('SELECT user_id FROM members WHERE guild_id=?', gid).map(r => r.user_id).filter(see);
    if (!members.length) return res.json({ items: [], members: 0 });
    const ph = members.map(() => '?').join(','), by = new Map();
    for (const r of all(`SELECT DISTINCT appid, user_id FROM wishlist WHERE user_id IN (${ph})`, ...members)) { if (!by.has(r.appid)) by.set(r.appid, { appid: r.appid, wish: [], owners: [] }); by.get(r.appid).wish.push(r.user_id); }
    const top = [...by.values()].sort((a, b) => b.wish.length - a.wish.length || Number(b.appid) - Number(a.appid)).slice(0, 120);
    if (top.length) {
      const ids = top.map(x => x.appid), m = new Map(top.map(x => [x.appid, x]));
      for (const r of all(`SELECT DISTINCT appid, user_id FROM game_library WHERE appid IN (${ids.map(() => '?').join(',')}) AND user_id IN (${ph})`, ...ids, ...members)) m.get(r.appid).owners.push(r.user_id);
    }
    const uids = [...new Set(top.flatMap(x => [...x.wish, ...x.owners]))];
    res.set('Cache-Control', 'private, no-cache');
    res.json({ items: top, members: members.length, wishers: new Set([...by.values()].flatMap(x => x.wish)).size, users: uids.map(userPub).filter(Boolean) });
  }));

  return {
    canSee, syncSteam,
    onLinked(uid) { if (shareOf(uid) !== 'off') setTimeout(() => syncSteam(uid).catch(() => { }), 500).unref?.(); },
    onUnlinked(uid) { run("DELETE FROM game_library WHERE user_id=? AND platform='steam'", uid); run("DELETE FROM wishlist WHERE user_id=? AND source='steam'", uid); run("DELETE FROM game_sync WHERE user_id=? AND platform='steam'", uid); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
