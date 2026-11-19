// Galeria de clipes: salvar, cortar, listar, curtir, favoritar, apagar e as métricas (server/clipstats.js); também a
// migração dos clipes antigos do chat e os clipes da semana do painel "Ativo agora".
// activity chega por getter (d.activity): é criado mais abaixo no index.js, então só é lido na hora da requisição
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClipStats } from '../clipstats.js';
import { trimWebm, keyframeTimes } from '../../public/webm.js';

export function mountClips(app, d) {
  const { auth, wrap, wrapA, bad, clean, db, all, get, run, newId, P, can, dispatch, channelAudience, channelFor, canAccessChannel, messageObj, getUser, userPub, audit, unlinkIfUnused, UPLOAD_DIR } = d;
  // ---------- Galeria de clipes ----------
  const CLIP_URL = /^\/files\/[a-f0-9]{24}\.(webm|mp4)\/[^/]{1,300}$/; // devolvido pelo /api/upload
  // engajamento (visualizações qualificadas, curtidas, compartilhamentos, retenção), ranking semanal e recomendações: server/clipstats.js
  const clipStats = createClipStats({ db, all, get, run, newId, canSeeClip: (u, c) => clipAccess(u, c),
    friendsOf: (uid) => all(`SELECT r1.other_id id FROM relationships r1 JOIN relationships r2 ON r2.user_id=r1.other_id AND r2.other_id=r1.user_id WHERE r1.user_id=? AND r1.type=1 AND r2.type=1`, uid).map(r => r.id),
    clipGame: (c, v) => d.activity.clipGame(c, v), gameKeys: (g) => d.activity.gameKeys(g) });
  // métricas em tempo real: quem pode ver o clipe recebe CLIP_STATS { id, guild_id, stats } quando muda uma visualização
  // qualificada, a retenção, uma curtida ou um compartilhamento. Agrupado por clipe (no máximo 1 aviso por CLIP_STATS_MS):
  // 10 pessoas assistindo ao mesmo tempo não viram 10 avisos por batida.
  const CLIP_STATS_MS = +process.env.CLIP_STATS_MS || 1000, statsSoon = new Map();
  function pushClipStats(id) {
    if (statsSoon.has(id)) return;
    const tm = setTimeout(() => {
      statsSoon.delete(id);
      const c = get('SELECT * FROM clips WHERE id=?', id); if (!c) return;
      dispatch(clipShareAudience(c), 'CLIP_STATS', { id: c.id, guild_id: c.guild_id, stats: clipStats.pubStats(clipStats.metrics([c.id]).get(c.id)) });
    }, CLIP_STATS_MS);
    tm.unref?.(); statsSoon.set(id, tm);
  }
  // stats: passe o resultado de clipStats.statsFor quando montar vários de uma vez (a galeria); sozinho, calcula o do clipe
  const clipObj = (c, uid, st = clipStats.statsFor([c.id], uid).get(c.id)) => ({ id: c.id, guild_id: c.guild_id, channel_id: c.channel_id, message_id: c.message_id, title: c.title, url: c.url, size: c.size, secs: c.secs, has_audio: !!c.has_audio, created_at: c.created_at,
    author: userPub(c.author_id), streamer: c.streamer_id ? userPub(c.streamer_id) : null, fav: !!get('SELECT 1 x FROM clip_favs WHERE user_id=? AND clip_id=?', uid, c.id),
    stats: st?.stats || null, liked: !!st?.liked });
  const canEditClip = (c, uid) => c.author_id === uid || (c.guild_id && can(c.guild_id, uid, P.MANAGE_MESSAGES));
  const clipAudience = (c) => { const ch = get('SELECT * FROM channels WHERE id=?', c.channel_id); return ch ? channelAudience(ch) : []; };
  const clipShareAudience = (c) => [...new Set([...clipAudience(c), ...all('SELECT DISTINCT channel_id FROM clip_shares WHERE clip_id=?', c.id).flatMap(r => { const ch = get('SELECT * FROM channels WHERE id=?', r.channel_id); return ch ? channelAudience(ch) : []; })])];
  // links de clipe numa mensagem (…/#/clip/ID): se o autor pode ver o clipe, quem vê a mensagem também passa a poder
  const CLIP_LINK_G = /\/#\/clip\/(\d{1,24})\b/g;
  function recordClipShares(row, uid) {
    const ids = [...new Set([...String(row.content || '').matchAll(CLIP_LINK_G)].map(m => m[1]))].slice(0, 3);
    for (const id of ids) { const c = get('SELECT * FROM clips WHERE id=?', id); if (c && clipAccess(uid, c)) { run('INSERT OR IGNORE INTO clip_shares(message_id,clip_id,channel_id) VALUES(?,?,?)', row.id, c.id, row.channel_id); if (uid !== c.author_id) pushClipStats(c.id); } }
  }
  // a mensagem do clipe sumiu (apagada no chat, ou o vídeo foi removido dela): o clipe sai da galeria
  function dropClipsOfMessage(mid) {
    for (const c of all('SELECT * FROM clips WHERE message_id=?', mid)) { const to = clipAudience(c); run('DELETE FROM clips WHERE id=?', c.id); dispatch(to, 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id }); }
  }
  // registra um clipe: posta a mensagem com o vídeo no chat da sala e coloca na galeria (avisa todo mundo na hora)
  function createClip(uid, ch, { url, name, size, secs, streamer, title, audio }) {
    const who = streamer ? (ch.guild_id ? (get('SELECT nickname FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, streamer)?.nickname || getUser(streamer).display_name) : getUser(streamer).display_name) : 'alguém';
    title = title || `Clipe de ${who}`;
    const mid = newId(), now = Date.now();
    run('INSERT INTO messages(id,channel_id,author_id,content,created_at,attachments) VALUES(?,?,?,?,?,?)', mid, ch.id, uid, `🎬 Clipe de ${secs}s da transmissão de ${who}`, now, JSON.stringify([{ url, name, size, type: url.endsWith('.mp4') ? 'video/mp4' : 'video/webm' }]));
    run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', uid, ch.id, mid);
    const cid = newId();
    run('INSERT INTO clips(id,guild_id,channel_id,message_id,author_id,streamer_id,title,url,size,secs,has_audio,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', cid, ch.guild_id, ch.id, mid, uid, streamer, title, url, size, secs, audio ? 1 : 0, now);
    const to = channelAudience(ch), msg = { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] };
    dispatch(to, 'MESSAGE_CREATE', msg);
    const c = get('SELECT * FROM clips WHERE id=?', cid);
    for (const u of to) dispatch([u], 'CLIP_CREATE', clipObj(c, u));
    return { clip: clipObj(c, uid), message: msg };
  }
  // salvar um clipe: posta a mensagem com o vídeo no chat da sala e registra na galeria
  app.post('/api/channels/:id/clips', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const url = String(req.body.url || ''), secs = Math.max(1, Math.min(600, Math.round(+req.body.secs || 0)));
    if (!CLIP_URL.test(url) || !fs.existsSync(path.join(UPLOAD_DIR, url.split('/')[2]))) return bad(res, 'Vídeo do clipe inválido');
    const streamer = req.body.streamer_id && getUser(String(req.body.streamer_id)) ? String(req.body.streamer_id) : null;
    res.json(createClip(req.uid, ch, { url, name: clean(req.body.name, 200) || 'clipe.webm', size: Math.max(0, +req.body.size || 0), secs, streamer, title: clean(req.body.title, 100), audio: req.body.has_audio !== false }));
  }));
  // quadros-chave de um clipe (onde um corte pode começar), calculados uma vez por arquivo
  const keyCache = new Map(); // arquivo -> [ms]
  async function clipKeys(fname) {
    if (keyCache.has(fname)) return keyCache.get(fname);
    const keys = keyframeTimes(new Uint8Array(await fs.promises.readFile(path.join(UPLOAD_DIR, fname))));
    keyCache.set(fname, keys); if (keyCache.size > 200) keyCache.delete(keyCache.keys().next().value);
    return keys;
  }
  const clipFile = (c) => { const f = path.basename(String(c.url).split('/')[2] || ''); return /^[a-f0-9]{24}\.webm$/.test(f) && fs.existsSync(path.join(UPLOAD_DIR, f)) ? f : null; };
  app.get('/api/clips/:id/keyframes', auth, wrapA(async (req, res) => {
    const c = clipFor(req, res); if (!c) return;
    const f = clipFile(c); if (!f) return bad(res, 'Este clipe não pode ser cortado', 400);
    res.json({ keys: await clipKeys(f) });
  }));
  // cortar no servidor: o arquivo já está aqui, então não precisa baixar nem reenviar nada. A cópia vira um clipe novo.
  app.post('/api/clips/:id/trim', auth, wrapA(async (req, res) => {
    const c = clipFor(req, res); if (!c) return;
    const ch = get('SELECT * FROM channels WHERE id=?', c.channel_id);
    const f = clipFile(c); if (!f) return bad(res, 'Este clipe não pode ser cortado', 400);
    const a = Math.max(0, Math.round(+req.body.start_ms || 0)), b = Math.round(+req.body.end_ms || 0);
    if (!(b - a >= 500)) return bad(res, 'Trecho curto demais');
    const r = trimWebm(new Uint8Array(await fs.promises.readFile(path.join(UPLOAD_DIR, f))), a, b);
    if (!r) return bad(res, 'Não consegui cortar este vídeo', 422);
    const fname = crypto.randomBytes(12).toString('hex') + '.webm', secs = Math.max(1, Math.round((r.endMs - r.startMs) / 1000));
    await fs.promises.writeFile(path.join(UPLOAD_DIR, fname), r.bytes);
    const name = `clipe-${secs}s-cortado.webm`, streamer = c.streamer_id && getUser(c.streamer_id) ? c.streamer_id : null;
    res.json({ ...createClip(req.uid, ch, { url: `/files/${fname}/${name}`, name, size: r.bytes.length, secs, streamer, title: clean(req.body.title, 100) || (c.title + ' (cortado)').slice(0, 100), audio: !!c.has_audio }), start_ms: r.startMs, end_ms: r.endMs });
  }));
  // lista da galeria do servidor: todos | meus | favoritos, busca no título/nome, mais novos primeiro, 30 por página
  app.get('/api/guilds/:id/clips', auth, wrap((req, res) => {
    const gid = req.params.id;
    if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, req.uid)) return bad(res, 'Sem permissão', 403);
    const where = ['c.guild_id=?'], args = [gid];
    if (req.query.filter === 'mine') { where.push('(c.author_id=? OR c.streamer_id=?)'); args.push(req.uid, req.uid); }
    if (req.query.filter === 'fav') { where.push('EXISTS(SELECT 1 FROM clip_favs f WHERE f.clip_id=c.id AND f.user_id=?)'); args.push(req.uid); }
    const q = clean(req.query.q, 60);
    if (q) { const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%'; where.push("(c.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM users u WHERE u.id IN (c.author_id, c.streamer_id) AND (u.display_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')))"); args.push(like, like, like); }
    if (req.query.before) { where.push('c.id < ?'); args.push(String(req.query.before)); }
    const list = all(`SELECT c.* FROM clips c WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 30`, ...args);
    const sts = clipStats.statsFor(list.map(c => c.id), req.uid);
    res.json({ clips: list.map(c => clipObj(c, req.uid, sts.get(c.id))), total: get('SELECT COUNT(*) n FROM clips WHERE guild_id=?', gid).n });
  }));
  // pode ver o clipe quem vê o canal de origem ou alguma mensagem onde ele foi compartilhado por link
  const clipAccess = (uid, c) => canAccessChannel(uid, get('SELECT * FROM channels WHERE id=?', c.channel_id))
    || all('SELECT DISTINCT channel_id FROM clip_shares WHERE clip_id=?', c.id).some(r => canAccessChannel(uid, get('SELECT * FROM channels WHERE id=?', r.channel_id)));
  const clipFor = (req, res) => { const c = get('SELECT * FROM clips WHERE id=?', req.params.id); if (!c || !clipAccess(req.uid, c)) { bad(res, 'Clipe não encontrado', 404); return null; } return c; };
  app.get('/api/clips/:id', auth, wrap((req, res) => { const c = clipFor(req, res); if (c) res.json(clipObj(c, req.uid)); })); // um clipe (popup do "Ativo agora")
  app.patch('/api/clips/:id', auth, wrap((req, res) => {
    const c = clipFor(req, res); if (!c) return;
    if (!canEditClip(c, req.uid)) return bad(res, 'Sem permissão', 403);
    const title = clean(req.body.title, 100); if (!title) return bad(res, 'Dê um nome ao clipe');
    run('UPDATE clips SET title=? WHERE id=?', title, c.id);
    const n = get('SELECT * FROM clips WHERE id=?', c.id);
    for (const u of clipShareAudience(n)) dispatch([u], 'CLIP_UPDATE', clipObj(n, u));
    const om = n.message_id && get('SELECT * FROM messages WHERE id=?', n.message_id), och = om && get('SELECT * FROM channels WHERE id=?', om.channel_id);
    if (om && och) dispatch(channelAudience(och), 'MESSAGE_UPDATE', { ...messageObj(om), guild_id: och.guild_id }); // cartão do clipe no chat com o nome novo, sem recarregar
    res.json(clipObj(n, req.uid));
  }));
  // assistiu (o player abriu o clipe): visualização única por pessoa, conta para os Clipes da semana
  // abriu o player: marca como visto e abre uma sessão de exibição. Só vira visualização (qualificada) quando o player
  // manda batidas mostrando que a pessoa assistiu de verdade (POST /watch). Sem sessão (limite atingido) o vídeo toca e não conta.
  app.post('/api/clips/:id/view', auth, wrap((req, res) => { const c = clipFor(req, res); if (!c) return; res.json({ session: clipStats.startWatch(req.uid, c) }); }));
  app.post('/api/clips/:id/watch', auth, wrap((req, res) => {
    const c = clipFor(req, res); if (!c) return;
    const r = clipStats.beat(req.uid, c, req.body?.session, { watched_ms: req.body?.watched_ms, covered_ms: req.body?.covered_ms });
    if (r.changed) pushClipStats(c.id);
    res.json(r);
  }));
  // curtir: uma por pessoa; o autor não curte o próprio clipe
  const likeRoute = (on) => wrap((req, res) => {
    const c = clipFor(req, res); if (!c) return;
    const was = !!get('SELECT 1 x FROM clip_likes WHERE user_id=? AND clip_id=?', req.uid, c.id);
    const err = clipStats.setLike(req.uid, c, on); if (err) return bad(res, err, err.startsWith('Calma') ? 429 : 400);
    if (was !== on) pushClipStats(c.id);
    res.json(clipObj(c, req.uid));
  });
  app.put('/api/clips/:id/like', auth, likeRoute(true));
  app.delete('/api/clips/:id/like', auth, likeRoute(false));
  app.put('/api/clips/:id/fav', auth, wrap((req, res) => { const c = clipFor(req, res); if (!c) return; run('INSERT OR IGNORE INTO clip_favs VALUES(?,?)', req.uid, c.id); res.json(clipObj(c, req.uid)); }));
  app.delete('/api/clips/:id/fav', auth, wrap((req, res) => { const c = clipFor(req, res); if (!c) return; run('DELETE FROM clip_favs WHERE user_id=? AND clip_id=?', req.uid, c.id); res.json(clipObj(c, req.uid)); }));
  // apagar o clipe: some da galeria, a mensagem sai do chat e o arquivo é removido se nada mais usa
  app.delete('/api/clips/:id', auth, wrap((req, res) => {
    const c = clipFor(req, res); if (!c) return;
    if (!canEditClip(c, req.uid)) return bad(res, 'Sem permissão', 403);
    const ch = get('SELECT * FROM channels WHERE id=?', c.channel_id), to = channelAudience(ch), shareTo = clipShareAudience(c);
    run('DELETE FROM clips WHERE id=?', c.id);
    if (c.message_id && get('SELECT 1 x FROM messages WHERE id=?', c.message_id)) { run('DELETE FROM messages WHERE id=?', c.message_id); dispatch(to, 'MESSAGE_DELETE', { id: c.message_id, channel_id: ch.id, guild_id: ch.guild_id }); }
    if (c.author_id !== req.uid) audit(c.guild_id, req.uid, 'message_delete', c.author_id, `clipe "${c.title}"`);
    dispatch(shareTo, 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id });
    unlinkIfUnused(c.url);
    res.json({});
  }));
  // Clipes antigos (de antes da galeria) que só existiam como mensagem no chat da sala: entram na galeria do servidor.
  // Roda ao iniciar; idempotente (pula mensagem que já tem clipe). O chat passa a mostrar o cartão leve deles.
  function migrateOldClips() {
    const rows = all(`SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id IS NOT NULL
    AND m.content LIKE '🎬 Clipe de %' AND m.attachments LIKE '%video/%' AND NOT EXISTS (SELECT 1 FROM clips k WHERE k.message_id = m.id)`);
    let n = 0;
    for (const m of rows) {
      const ch = get('SELECT * FROM channels WHERE id=?', m.channel_id); if (!ch) continue;
      const att = JSON.parse(m.attachments || '[]').find(a => CLIP_URL.test(String(a.url || ''))); if (!att) continue;
      const mm = String(m.content).match(/^🎬 Clipe de (\d+)s da transmissão de (.+)$/), who = mm?.[2]?.trim() || '';
      // de quem era a transmissão: membro do servidor com esse nome (apelido, nome de exibição ou usuário), se for único
      const cands = who ? all(`SELECT u.id FROM members mb JOIN users u ON u.id = mb.user_id WHERE mb.guild_id=? AND (mb.nickname=? OR u.display_name=? OR u.username=?)`, ch.guild_id, who, who, who) : [];
      run('INSERT INTO clips(id,guild_id,channel_id,message_id,author_id,streamer_id,title,url,size,secs,has_audio,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        newId(), ch.guild_id, ch.id, m.id, m.author_id, cands.length === 1 ? cands[0].id : null, (who ? `Clipe de ${who}` : 'Clipe').slice(0, 100), att.url, +att.size || 0, +(mm?.[1] || 0), 1, m.created_at);
      n++;
    }
    if (n) console.log(`  Clipes: ${n} clipe(s) antigo(s) do chat entraram na galeria`);
    return n;
  }
  // clipes da semana no painel "Ativo agora": Top 5 (o app mostra 3 e expande), categorias especiais e recomendados
  function clipsWeekFor(viewer, { played }) {
    const w = clipStats.week(viewer), seen = new Set(all('SELECT clip_id FROM clip_views WHERE user_id=?', viewer).map(r => r.clip_id));
    const liked = new Set(all('SELECT clip_id FROM clip_likes WHERE user_id=?', viewer).map(r => r.clip_id));
    const catOf = new Map(w.categories.map(x => [x.id, x.kind]));
    const out = (c, m, extra) => { const g = d.activity.clipGame(c, viewer);
      return { id: c.id, title: c.title, url: c.url, secs: c.secs, guild_id: c.guild_id, channel_id: c.channel_id, at: c.created_at, author_id: c.author_id, streamer_id: c.streamer_id,
        ...(g ? { platform: g.platform, game: g.game } : {}), metrics: { ...clipStats.pubStats(m), reacts: m.reacts, replies: m.replies }, seen: seen.has(c.id), liked: liked.has(c.id), you: c.streamer_id === viewer, ...extra }; };
    const clips = w.top.map(t => out(w.rows.get(t.id), w.metrics.get(t.id), { score: t.score, parts: t.parts, tag: catOf.get(t.id) || null }));
    const categories = w.categories.map(x => ({ kind: x.kind, why: x.why, clip: out(w.rows.get(x.id), w.metrics.get(x.id), {}) }));
    // recomendados: de fora do ranking e das categorias (o painel não repete clipe); a qualidade da semana entra como sinal
    const shown = new Set([...w.top.map(t => t.id), ...w.categories.map(x => x.id)]);
    const recs = clipStats.recsFor(viewer, { exclude: shown, played, quality: new Map(w.top.map(t => [t.id, t.score / 100])) });
    const recRows = recs.length ? all('SELECT * FROM clips WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(recs.map(r => r.id))) : [], rm = clipStats.metrics(recs.map(r => r.id));
    const byId = new Map(recRows.map(c => [c.id, c]));
    return { clips, categories, quiet: w.quiet, recs: recs.filter(r => byId.has(r.id)).map(r => out(byId.get(r.id), rm.get(r.id), { reason: r.reason })) };
  }
  return { clipStats, pushClipStats, recordClipShares, dropClipsOfMessage, clipKeys, migrateOldClips, clipsWeekFor };
}
