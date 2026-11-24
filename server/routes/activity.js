// Rotas da atividade de jogos (o serviço fica em server/activity.js): vincular contas das plataformas (integrações), feed
// do "Ativo agora", jogos escondidos e o jogo aberto no PC (ícones e visibilidade). Devolve accountPub/accountOf (avisos
// do serviço de atividade) e resolveLocalGame/saveGameIcon/localNames (ACTIVITY_LOCAL do gateway).
import crypto from 'node:crypto';
import { getAdapter, listAdapters } from '../integrations/index.js';
import { knownGame } from '../../public/gamecatalog.js';

export function mountActivity(app, d) {
  const { auth, wrap, bad, clean, all, get, run, dispatch, getUser, userPub, activity, games, achievements, discover } = d;
  const linkStates = new Map(); // state -> { uid, platform, returnTo, exp } (uso único, 10 min)
  const publicBase = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const accountPub = (a) => !a ? null : ({ platform: a.platform, external_id: a.external_id, display_name: a.display_name, avatar: a.avatar, profile_url: a.profile_url, visibility: a.visibility, link_visibility: a.link_visibility, linked_at: a.linked_at, last_sync: a.last_sync, sync_state: a.sync_state });
  const accountOf = (uid, platform) => get('SELECT * FROM linked_accounts WHERE user_id=? AND platform=?', uid, platform);
  app.get('/api/integrations', auth, wrap((req, res) => {
    res.json(listAdapters().map(ad => ({ id: ad.id, name: ad.name, capabilities: ad.capabilities, configured: ad.configured(), account: accountPub(accountOf(req.uid, ad.id)) })));
  }));
  app.post('/api/integrations/:platform/link', auth, wrap((req, res) => {
    const ad = getAdapter(req.params.platform); if (!ad) return bad(res, 'Plataforma desconhecida', 404);
    const now = Date.now(); for (const [k, v] of linkStates) if (v.exp < now || (v.uid === req.uid && v.platform === ad.id)) linkStates.delete(k); // só um pedido pendente por conta
    const state = crypto.randomBytes(24).toString('hex'), base = publicBase(req);
    const returnTo = `${base}/api/integrations/${ad.id}/callback?state=${state}`;
    linkStates.set(state, { uid: req.uid, platform: ad.id, returnTo, exp: now + 10 * 60 * 1000 });
    res.json({ url: ad.startLink({ returnTo, realm: base }) });
  }));
  app.get('/api/integrations/:platform/callback', (req, res) => { // aberto: quem chama é o navegador voltando da plataforma; o 'state' liga ao usuário
    const page = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resenha</title><body style="font-family:system-ui;background:#1e1f22;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="text-align:center;max-width:420px;padding:24px"><div style="width:56px;height:56px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:${ok ? '#23a55a' : '#f0b232'}"><svg viewBox="0 0 24 24" width="32" height="32" fill="#fff"><path d="${ok ? 'm9 16.2-3.5-3.5L4 14.1 9 19 20 8l-1.4-1.4Z' : 'M11 7h2v7h-2Zm0 9h2v2h-2Z'}"/></svg></div><h2 style="margin:0 0 8px">${String(msg).replace(/[<>&]/g, '')}</h2><p style="opacity:.7">${ok ? 'Pode fechar esta janela e voltar à Resenha.' : 'Feche esta janela e tente vincular de novo pela Resenha.'}</p></div></body>`);
    const ad = getAdapter(req.params.platform), state = String(req.query.state || ''), st = linkStates.get(state);
    if (!ad || !st || st.platform !== ad.id) return page(false, 'Pedido expirado ou inválido');
    linkStates.delete(state); // uso único
    if (st.exp < Date.now()) return page(false, 'Pedido expirado');
    ad.finishLink(req.query, { returnTo: st.returnTo }).then(({ external_id }) => {
      const other = get('SELECT user_id FROM linked_accounts WHERE platform=? AND external_id=?', ad.id, external_id);
      if (other && other.user_id !== st.uid) return page(false, 'Esta conta já está vinculada a outro usuário');
      run('DELETE FROM linked_accounts WHERE user_id=? AND platform=?', st.uid, ad.id);
      run('INSERT INTO linked_accounts(user_id,platform,external_id,visibility,linked_at,sync_state) VALUES(?,?,?,?,?,?)', st.uid, ad.id, external_id, 'friends', Date.now(), 'pending');
      dispatch([st.uid], 'INTEGRATION_UPDATE', { platform: ad.id, account: accountPub(accountOf(st.uid, ad.id)) });
      activity.onLinked(); if (ad.id === 'steam') games.onLinked(st.uid);
      page(true, 'Conta ' + ad.name + ' vinculada!');
    }).catch(e => page(false, e.message || 'Falha ao vincular'));
  });
  app.patch('/api/integrations/:platform', auth, wrap((req, res) => {
    const a = accountOf(req.uid, req.params.platform); if (!a) return bad(res, 'Conta não vinculada', 404);
    const { visibility, link_visibility } = req.body || {};
    if (visibility !== undefined && !['friends', 'off'].includes(visibility)) return bad(res, 'Visibilidade inválida');
    if (link_visibility !== undefined && !['friends', 'off'].includes(link_visibility)) return bad(res, 'Visibilidade inválida');
    if (visibility === undefined && link_visibility === undefined) return bad(res, 'Nada para alterar');
    if (visibility !== undefined && visibility !== a.visibility) { activity.onVisibility(req.uid, a.platform, visibility); run('UPDATE linked_accounts SET visibility=? WHERE user_id=? AND platform=?', visibility, req.uid, a.platform); }
    if (link_visibility !== undefined) run('UPDATE linked_accounts SET link_visibility=? WHERE user_id=? AND platform=?', link_visibility, req.uid, a.platform);
    dispatch([req.uid], 'INTEGRATION_UPDATE', { platform: a.platform, account: accountPub(accountOf(req.uid, a.platform)) });
    res.json(accountPub(accountOf(req.uid, a.platform)));
  }));
  app.delete('/api/integrations/:platform', auth, wrap((req, res) => {
    const p = req.params.platform; if (!getAdapter(p)) return bad(res, 'Plataforma desconhecida', 404);
    const cur = accountOf(req.uid, p); if (cur) activity.onUnlinking(req.uid, p, cur.external_id);
    run('DELETE FROM linked_accounts WHERE user_id=? AND platform=?', req.uid, p);
    run('DELETE FROM activities WHERE user_id=? AND platform=?', req.uid, p); run('DELETE FROM game_prefs WHERE user_id=? AND platform=?', req.uid, p);
    if (p === 'steam') { games.onUnlinked(req.uid); achievements.onUnlinked(req.uid); }
    dispatch([req.uid], 'INTEGRATION_UPDATE', { platform: p, account: null });
    res.json({});
  }));
  app.get('/api/activity/feed', auth, wrap((req, res) => { // amigos (e você), o que estão jogando e eventos recentes — tudo filtrado por activity.canSee
    const f = activity.feedFor(req.uid), week = activity.weekFor(req.uid);
    const ids = [...new Set([...f.friends.map(x => x.user_id), ...week.played.map(x => x.user_id), ...[...week.clips, ...week.clip_categories.map(x => x.clip), ...week.clip_recs].flatMap(c => [c.author_id, c.streamer_id]).filter(Boolean)])];
    res.json({ ...f, week, users: ids.map(id => userPub(id)).filter(Boolean) });
  }));
  app.put('/api/activity/games/:platform/:gameId', auth, wrap((req, res) => { // esconder/mostrar um jogo (nunca vira atividade)
    const platform = req.params.platform, gid = clean(req.params.gameId, 40);
    if (platform !== 'pc' && (!getAdapter(platform) || !accountOf(req.uid, platform))) return bad(res, 'Conta não vinculada', 404);
    const hidden = req.body?.hidden ? 1 : 0;
    run('INSERT INTO game_prefs(user_id,platform,game_id,hidden) VALUES(?,?,?,?) ON CONFLICT(user_id,platform,game_id) DO UPDATE SET hidden=excluded.hidden', req.uid, platform, gid, hidden);
    if (hidden) activity.onGameHidden(req.uid, platform, gid);
    res.json({ hidden: !!hidden });
  }));
  app.get('/api/activity/hidden', auth, wrap((req, res) => res.json(all('SELECT gp.platform, gp.game_id, (SELECT a.title FROM activities a WHERE a.user_id=gp.user_id AND a.platform=gp.platform AND a.game_id=gp.game_id ORDER BY a.created_at DESC LIMIT 1) title FROM game_prefs gp WHERE gp.user_id=? AND gp.hidden=1', req.uid))));
  // ícone do jogo (PNG pequeno mandado pelo app desktop): confere que é PNG de verdade, até 32 KB e 128x128; devolve o hash
  // nome e número na Steam do jogo aberto no PC (por executável + título + appid mandados pelo app desktop)
  const localNames = new Map();
  const storeTitle = (t) => String(t || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
  async function resolveLocalGame(title, steam, known) {
    if (known) return { title: known.title, steam: steam || known.steam || null, known: known.key };
    try {
      if (steam) { const it = await discover.storeItems([steam], 7 * 864e5); return { title: storeTitle(it?.[steam]?.title) || title, steam }; }
      const f = await discover.findApp(title);
      if (f) { const k = knownGame({ steam: f.appid }); return { title: k?.title || f.title, steam: f.appid, ...(k ? { known: k.key } : {}) }; }
    } catch { /* loja fora do ar: fica o nome mandado pelo app */ }
    return { title, steam };
  }
  function saveGameIcon(b64) {
    if (typeof b64 !== 'string' || b64.length > 44000) return null;
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 33 || buf.length > 32768 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); if (!w || !h || w > 128 || h > 128) return null;
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    run('INSERT OR IGNORE INTO game_icons(hash,png,created_at,used_at) VALUES(?,?,?,?)', hash, buf, Date.now(), Date.now());
    return hash;
  }
  run('DELETE FROM game_icons WHERE used_at < ?', Date.now() - 90 * 864e5);
  // público mas impossível de adivinhar (hash do conteúdo); servido como imagem pura, sem nada que rode
  app.get('/game-icons/:f', (req, res) => {
    const m = /^([a-f0-9]{64})\.png$/.exec(req.params.f), r = m && get('SELECT png FROM game_icons WHERE hash=?', m[1]);
    if (!r) return res.sendStatus(404);
    res.set({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(Buffer.from(r.png));
  });
  // jogo aberto no PC (app desktop): aparece sempre para amigos e quem divide servidor (a opção de escolher saiu em
  // 24/11/2026). notice_at: a pessoa tinha escolhido algo mais restrito e recebe uma mensagem uma vez (public/activity.js)
  app.get('/api/activity/pc', auth, wrap((req, res) => res.json({ visibility: 'servers', notice_at: getUser(req.uid).pc_notice_at || null })));
  return { accountPub, accountOf, resolveLocalGame, saveGameIcon, localNames };
}
