// Canal de fórum (docs/FORUM.md, etapa 1, escopo menor): um canal type 15 com posts no estilo Reddit.
// Cada post é um canal escondido (type 11, parent_id = o fórum): os comentários são mensagens comuns desse canal (reações,
// anexos, respostas, edição, menções e busca já funcionam). O texto do post fica em forum_posts, junto do título, das
// tags e dos votos (só ▲, como na proposta: num grupo pequeno o ▼ vira briga).
// Os posts não vão no READY: a lista vem por GET /api/forums/:fid/posts, com ordem Em alta / Novos / Top / Atividade.

const TITLE_MAX = 120, BODY_MAX = 8000, TAGS_MAX = 5, FORUM_TAGS_MAX = 20, PAGE = 25;
const TAG_COLORS = ['#5865f2', '#23a55a', '#f0b232', '#da373c', '#eb459e', '#00a8fc', '#9b59b6', '#e67e22'];

export function mountForum(app, d) {
  const { auth, wrap, bad, all, get, run, db, newId, can, P, dispatch, guildMemberIds, userPub, clean, audit, isFileUrl, timedOut, rateOk } = d;

  db.exec(`
CREATE TABLE IF NOT EXISTS forum_posts(
  id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  forum_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', attachments TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, edited_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS forum_posts_forum ON forum_posts(forum_id, pinned DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS forum_votes(post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER, PRIMARY KEY(post_id, user_id));`);
  try { db.exec('ALTER TABLE channels ADD COLUMN forum TEXT'); } catch { /* já existe */ }

  const cfgOf = (f) => { try { return { tags: [], guidelines: '', ...JSON.parse(f?.forum || '{}') }; } catch { return { tags: [], guidelines: '' }; } };
  const isMod = (gid, uid) => can(gid, uid, P.MANAGE_MESSAGES);
  const member = (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  const forumFor = (req, res) => {
    const f = get('SELECT * FROM channels WHERE id=? AND type=15', req.params.fid);
    if (!f || !member(f.guild_id, req.uid)) { bad(res, 'Fórum não encontrado', 404); return null; }
    return f;
  };
  const postFor = (req, res) => {
    const p = get('SELECT * FROM forum_posts WHERE id=?', req.params.pid);
    if (!p || !member(p.guild_id, req.uid)) { bad(res, 'Post não encontrado', 404); return null; }
    return p;
  };
  // comentários e última atividade contados na hora (sem contador para manter em dia quando apagam em massa)
  const STATS = `(SELECT COUNT(*) FROM messages m WHERE m.channel_id=p.id) replies,
    COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id=p.id), p.created_at) last_at`;
  const atts = (list) => (Array.isArray(list) ? list : []).slice(0, 10).filter(a => a && isFileUrl(a.url))
    .map(a => ({ url: a.url, name: clean(a.name, 200), size: +a.size || 0, type: clean(a.type, 100), ...(+a.width > 0 ? { width: +a.width, height: +a.height } : {}) }));
  const cleanTags = (list, cfg, mod) => [...new Set((Array.isArray(list) ? list : []).map(String))]
    .filter(id => cfg.tags.some(t => t.id === id && (!t.modOnly || mod))).slice(0, TAGS_MAX);
  function postObj(p, uid) {
    const a = JSON.parse(p.attachments || '[]');
    return { id: p.id, forum_id: p.forum_id, guild_id: p.guild_id, author: userPub(p.author_id), author_id: p.author_id,
      title: p.title, content: p.content, attachments: a, cover: a.find(x => /^image\//.test(x.type))?.url || null,
      tags: JSON.parse(p.tags || '[]'), created_at: p.created_at, edited_at: p.edited_at || null,
      last_at: p.last_at ?? p.created_at, replies: p.replies ?? 0, score: p.score, pinned: !!p.pinned, locked: !!p.locked,
      ...(uid ? { voted: !!get('SELECT 1 x FROM forum_votes WHERE post_id=? AND user_id=?', p.id, uid) } : {}) };
  }
  const withStats = (id) => get(`SELECT p.*, ${STATS} FROM forum_posts p WHERE p.id=?`, id);
  const broadcast = (type, p) => dispatch(guildMemberIds(p.guild_id), type, postObj(p)); // sem "voted": cada um sabe o próprio voto

  // ---------- lista ----------
  app.get('/api/forums/:fid/posts', auth, wrap((req, res) => {
    const f = forumFor(req, res); if (!f) return;
    const sort = ['hot', 'new', 'top', 'activity'].includes(req.query.sort) ? req.query.sort : 'hot';
    const w = ['p.forum_id=?'], args = [f.id];
    const tag = String(req.query.tag || ''); if (tag) { w.push("p.tags LIKE ? ESCAPE '\\'"); args.push('%"' + tag.replace(/[%_\\"]/g, '') + '"%'); }
    const q = clean(req.query.q, 100).toLowerCase();
    if (q) { w.push("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(p.content) LIKE ? ESCAPE '\\')"); const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%'; args.push(like, like); }
    const range = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 }[req.query.range];
    if (sort === 'top' && range) { w.push('p.created_at>=?'); args.push(Date.now() - range); }
    // Em alta: (votos + comentários/2 + 1) / (horas + 2)^1.5 — post novo com conversa sobe, velho desce devagar
    const now = Date.now();
    const order = { new: 'p.created_at DESC', top: 'p.score DESC, p.created_at DESC', activity: 'last_at DESC',
      hot: `((p.score + replies / 2.0 + 1) / ((((${now} - p.created_at) / 3600000.0) + 2) * sqrt(((${now} - p.created_at) / 3600000.0) + 2))) DESC` }[sort];
    const off = Math.max(0, Math.min(10000, +req.query.offset || 0));
    const rows = all(`SELECT p.*, ${STATS} FROM forum_posts p WHERE ${w.join(' AND ')} ORDER BY p.pinned DESC, ${order} LIMIT ? OFFSET ?`, ...args, PAGE + 1, off);
    const voted = new Set(rows.length ? all(`SELECT post_id FROM forum_votes WHERE user_id=? AND post_id IN (${rows.map(() => '?').join(',')})`, req.uid, ...rows.map(r => r.id)).map(r => r.post_id) : []);
    res.json({ posts: rows.slice(0, PAGE).map(r => ({ ...postObj(r), voted: voted.has(r.id) })), next: rows.length > PAGE ? off + PAGE : null, forum: { id: f.id, ...cfgOf(f) } });
  }));

  // ---------- criar ----------
  app.post('/api/forums/:fid/posts', auth, wrap((req, res) => {
    const f = forumFor(req, res); if (!f) return;
    if (timedOut(f.guild_id, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
    if (!rateOk(req.uid)) return bad(res, 'Você está postando rápido demais', 429);
    const recent = get('SELECT COUNT(*) n FROM forum_posts WHERE author_id=? AND created_at>?', req.uid, Date.now() - 3600e3).n;
    if (recent >= 10 && !isMod(f.guild_id, req.uid)) return bad(res, 'Limite de 10 posts por hora. Tente mais tarde.', 429);
    const cfg = cfgOf(f), title = clean(req.body.title, TITLE_MAX).replace(/\s+/g, ' ').trim();
    const content = String(req.body.content ?? '').slice(0, BODY_MAX).trim(), files = atts(req.body.attachments);
    if (!title) return bad(res, 'Dê um título ao post');
    const tags = cleanTags(req.body.tags, cfg, isMod(f.guild_id, req.uid));
    if (cfg.requireTag && cfg.tags.length && !tags.length) return bad(res, 'Escolha pelo menos uma tag');
    const id = newId(), now = Date.now();
    db.exec('BEGIN');
    try {
      run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)', id, f.guild_id, 11, title, 0, f.id, now);
      run('INSERT INTO forum_posts(id,forum_id,guild_id,author_id,title,content,attachments,tags,created_at,score) VALUES(?,?,?,?,?,?,?,?,?,1)',
        id, f.id, f.guild_id, req.uid, title, content, JSON.stringify(files), JSON.stringify(tags), now);
      run('INSERT INTO forum_votes VALUES(?,?,?)', id, req.uid, now); // quem posta já vota no próprio post (como no Reddit)
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const p = withStats(id);
    broadcast('FORUM_POST_CREATE', p);
    res.json({ ...postObj(p), voted: true });
  }));

  app.get('/api/posts/:pid', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    const f = get('SELECT * FROM channels WHERE id=?', p.forum_id);
    res.json({ ...postObj(withStats(p.id), req.uid), forum: { id: f.id, name: f.name, ...cfgOf(f) } });
  }));

  // editar: título, texto e tags (autor ou moderação); fixar e trancar (moderação)
  app.patch('/api/posts/:pid', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    const mod = isMod(p.guild_id, req.uid), mine = p.author_id === req.uid, b = req.body || {};
    const f = get('SELECT * FROM channels WHERE id=?', p.forum_id), cfg = cfgOf(f);
    if ((b.pinned !== undefined || b.locked !== undefined) && !mod) return bad(res, 'Sem permissão', 403);
    if ((b.title !== undefined || b.content !== undefined || b.tags !== undefined) && !mine && !mod) return bad(res, 'Sem permissão', 403);
    const title = b.title !== undefined ? clean(b.title, TITLE_MAX).replace(/\s+/g, ' ').trim() : p.title;
    if (!title) return bad(res, 'Dê um título ao post');
    const content = b.content !== undefined ? String(b.content).slice(0, BODY_MAX).trim() : p.content;
    const tags = b.tags !== undefined ? JSON.stringify(cleanTags(b.tags, cfg, mod)) : p.tags;
    const edited = b.title !== undefined || b.content !== undefined ? Date.now() : p.edited_at;
    run('UPDATE forum_posts SET title=?,content=?,tags=?,edited_at=?,pinned=?,locked=? WHERE id=?', title, content, tags, edited,
      b.pinned !== undefined ? (b.pinned ? 1 : 0) : p.pinned, b.locked !== undefined ? (b.locked ? 1 : 0) : p.locked, p.id);
    if (title !== p.title) run('UPDATE channels SET name=? WHERE id=?', title, p.id);
    if (b.pinned !== undefined && !!b.pinned !== !!p.pinned) audit(p.guild_id, req.uid, b.pinned ? 'post_pin' : 'post_unpin', p.id, title);
    if (b.locked !== undefined && !!b.locked !== !!p.locked) audit(p.guild_id, req.uid, b.locked ? 'post_lock' : 'post_unlock', p.id, title);
    const np = withStats(p.id);
    broadcast('FORUM_POST_UPDATE', np);
    res.json(postObj(np, req.uid));
  }));

  app.delete('/api/posts/:pid', auth, wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    if (p.author_id !== req.uid && !isMod(p.guild_id, req.uid)) return bad(res, 'Sem permissão', 403);
    run('DELETE FROM channels WHERE id=?', p.id); // leva o post, os votos e os comentários (ON DELETE CASCADE)
    if (p.author_id !== req.uid) audit(p.guild_id, req.uid, 'post_delete', p.author_id, p.title);
    dispatch(guildMemberIds(p.guild_id), 'FORUM_POST_DELETE', { id: p.id, forum_id: p.forum_id, guild_id: p.guild_id });
    res.json({});
  }));

  // ---------- voto (só ▲) ----------
  const vote = (on) => wrap((req, res) => {
    const p = postFor(req, res); if (!p) return;
    const had = !!get('SELECT 1 x FROM forum_votes WHERE post_id=? AND user_id=?', p.id, req.uid);
    if (on !== had) {
      if (on) run('INSERT INTO forum_votes VALUES(?,?,?)', p.id, req.uid, Date.now()); else run('DELETE FROM forum_votes WHERE post_id=? AND user_id=?', p.id, req.uid);
      run('UPDATE forum_posts SET score=(SELECT COUNT(*) FROM forum_votes WHERE post_id=?) WHERE id=?', p.id, p.id);
      const np = withStats(p.id);
      dispatch(guildMemberIds(p.guild_id), 'FORUM_POST_UPDATE', { ...postObj(np), voter: req.uid, vote: on });
    }
    res.json({ score: get('SELECT score FROM forum_posts WHERE id=?', p.id).score, voted: on });
  });
  app.put('/api/posts/:pid/vote', auth, vote(true));
  app.delete('/api/posts/:pid/vote', auth, vote(false));

  // ---------- ajustes do fórum: tags e regras (quem gerencia canais) ----------
  app.patch('/api/forums/:fid', auth, wrap((req, res) => {
    const f = forumFor(req, res); if (!f) return;
    if (!can(f.guild_id, req.uid, P.MANAGE_CHANNELS)) return bad(res, 'Sem permissão', 403);
    const cfg = cfgOf(f), b = req.body || {};
    if (Array.isArray(b.tags)) cfg.tags = b.tags.slice(0, FORUM_TAGS_MAX).map((t, i) => ({
      id: /^[a-z0-9]{1,12}$/.test(t?.id || '') ? t.id : Math.random().toString(36).slice(2, 10),
      name: clean(t?.name, 24) || 'Tag', emoji: clean(t?.emoji, 16), color: /^#[0-9a-f]{6}$/i.test(t?.color || '') ? t.color : TAG_COLORS[i % TAG_COLORS.length], modOnly: !!t?.modOnly,
    })).filter(t => t.name);
    if (b.guidelines !== undefined) cfg.guidelines = String(b.guidelines || '').slice(0, 2000);
    if (b.requireTag !== undefined) cfg.requireTag = !!b.requireTag;
    run('UPDATE channels SET forum=? WHERE id=?', JSON.stringify(cfg), f.id);
    audit(f.guild_id, req.uid, 'channel_update', f.id, f.name);
    dispatch(guildMemberIds(f.guild_id), 'CHANNEL_UPDATE', get('SELECT * FROM channels WHERE id=?', f.id));
    res.json({ id: f.id, ...cfg });
  }));

  return {
    // post trancado: só a moderação comenta
    canReply: (ch, uid) => ch.type !== 11 || !get('SELECT locked FROM forum_posts WHERE id=?', ch.id)?.locked || isMod(ch.guild_id, uid),
    // fórum apagado: os posts vão junto (o parent_id não tem ON DELETE CASCADE)
    dropForum: (fid) => { for (const r of all('SELECT id FROM channels WHERE parent_id=? AND type=11', fid)) run('DELETE FROM channels WHERE id=?', r.id); },
    TAG_COLORS,
  };
}
