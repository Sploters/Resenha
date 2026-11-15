// Mídia favorita (ideia "Favorite (any) Media", Stoat #1231): qualquer arquivo do chat — imagem, vídeo, áudio ou outro —
// ou imagem de link vai para os favoritos da pessoa, com categorias que ela nomeia (por aba). Mandar de novo usa o mesmo
// arquivo (sem subir outra vez). O arquivo favoritado não é apagado do disco enquanto alguém o tiver nos favoritos, mesmo
// que a mensagem original suma (unlinkIfUnused consulta esta tabela). GIFs continuam em server/gifs.js (aba própria).
export const FAV_KINDS = ['gif', 'image', 'video', 'audio', 'other'];
const MAX_FAVS = 1000, MAX_CATS = 30;

export function kindOf(type, name) {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase();
  if (type === 'image/gif' || ext === 'gif') return 'gif';
  if (/^image\//.test(type) || /^(png|jpe?g|webp|avif|bmp)$/.test(ext)) return 'image';
  if (/^video\//.test(type) || /^(mp4|webm|mov|m4v)$/.test(ext)) return 'video';
  if (/^audio\//.test(type) || /^(mp3|ogg|wav|m4a|opus|flac)$/.test(ext)) return 'audio';
  return 'other';
}

export function mountMediaFavs(app, { auth, wrap, bad, db, all, get, run, clean, isFileUrl, dispatch, unlinkIfUnused }) {
  db.exec(`CREATE TABLE IF NOT EXISTS media_favs(user_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, type TEXT, size INTEGER,
    w INTEGER, h INTEGER, cat TEXT DEFAULT '', created_at INTEGER, PRIMARY KEY(user_id, url));
    CREATE TABLE IF NOT EXISTS media_fav_cats(user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, pos INTEGER DEFAULT 0, PRIMARY KEY(user_id, kind, name));`);
  const okUrl = (u) => isFileUrl(u) || (typeof u === 'string' && u.length <= 700 && /^https:\/\/[^\s"'<>\\]+$/.test(u));
  const state = (uid) => ({
    favs: all('SELECT url, kind, name, type, size, w, h, cat, created_at FROM media_favs WHERE user_id=? ORDER BY created_at DESC', uid),
    cats: all('SELECT kind, name FROM media_fav_cats WHERE user_id=? ORDER BY pos, name', uid),
  });
  const changed = (uid) => dispatch([uid], 'MEDIA_FAVS', state(uid)); // os outros aparelhos da pessoa acompanham

  app.get('/api/media-favs', auth, wrap((req, res) => res.json(state(req.uid))));
  // favoritar (ou mudar de categoria): { url, name, type, size, w, h, cat }
  app.put('/api/media-favs', auth, wrap((req, res) => {
    const b = req.body || {}, url = String(b.url || '');
    if (!okUrl(url)) return bad(res, 'Esse arquivo não pode ser favoritado');
    const ex = get('SELECT * FROM media_favs WHERE user_id=? AND url=?', req.uid, url);
    if (!ex && get('SELECT COUNT(*) n FROM media_favs WHERE user_id=?', req.uid).n >= MAX_FAVS) return bad(res, `Limite de ${MAX_FAVS} mídias favoritas`);
    const name = clean(b.name, 200) || decodeURIComponent(url.split('/').pop() || 'arquivo').slice(0, 200), type = clean(b.type, 100);
    const kind = FAV_KINDS.includes(b.kind) ? b.kind : kindOf(type, name), cat = clean(b.cat ?? ex?.cat ?? '', 40);
    if (cat && !get('SELECT 1 x FROM media_fav_cats WHERE user_id=? AND kind=? AND name=?', req.uid, kind, cat)) return bad(res, 'Categoria não encontrada');
    run(`INSERT INTO media_favs(user_id,url,kind,name,type,size,w,h,cat,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,url) DO UPDATE SET cat=excluded.cat, name=excluded.name`, req.uid, url, kind, name, type, Math.max(0, +b.size || 0), Math.max(0, +b.w || 0) | 0, Math.max(0, +b.h || 0) | 0, cat, ex?.created_at || Date.now());
    changed(req.uid); res.json({ ok: true, kind });
  }));
  app.delete('/api/media-favs', auth, wrap((req, res) => {
    const url = String(req.body?.url || '');
    run('DELETE FROM media_favs WHERE user_id=? AND url=?', req.uid, url);
    if (isFileUrl(url)) unlinkIfUnused(url); // a mensagem original já tinha sumido: o arquivo vai embora junto
    changed(req.uid); res.json({});
  }));
  // categorias: criar { kind, name }, renomear { kind, name, to }, apagar (DELETE; as mídias ficam sem categoria), ordem { kind, order: [nomes] }
  app.post('/api/media-favs/cats', auth, wrap((req, res) => {
    const kind = String(req.body?.kind || ''), name = clean(req.body?.name, 40);
    if (!FAV_KINDS.includes(kind)) return bad(res, 'Aba inválida');
    if (Array.isArray(req.body?.order)) {
      req.body.order.slice(0, MAX_CATS).forEach((n, i) => run('UPDATE media_fav_cats SET pos=? WHERE user_id=? AND kind=? AND name=?', i, req.uid, kind, String(n)));
      changed(req.uid); return res.json({});
    }
    if (!name) return bad(res, 'Dê um nome para a categoria');
    const to = req.body?.to !== undefined ? clean(req.body.to, 40) : null;
    if (to !== null) {
      if (!to) return bad(res, 'Dê um nome para a categoria');
      if (to !== name && get('SELECT 1 x FROM media_fav_cats WHERE user_id=? AND kind=? AND name=?', req.uid, kind, to)) return bad(res, 'Já existe uma categoria com esse nome');
      run('UPDATE media_fav_cats SET name=? WHERE user_id=? AND kind=? AND name=?', to, req.uid, kind, name);
      run('UPDATE media_favs SET cat=? WHERE user_id=? AND kind=? AND cat=?', to, req.uid, kind, name);
    } else {
      if (get('SELECT COUNT(*) n FROM media_fav_cats WHERE user_id=? AND kind=?', req.uid, kind).n >= MAX_CATS) return bad(res, `No máximo ${MAX_CATS} categorias por aba`);
      if (get('SELECT 1 x FROM media_fav_cats WHERE user_id=? AND kind=? AND name=?', req.uid, kind, name)) return bad(res, 'Já existe uma categoria com esse nome');
      run('INSERT INTO media_fav_cats(user_id,kind,name,pos) VALUES(?,?,?,?)', req.uid, kind, name, (get('SELECT MAX(pos) m FROM media_fav_cats WHERE user_id=? AND kind=?', req.uid, kind).m ?? -1) + 1);
    }
    changed(req.uid); res.json({});
  }));
  app.delete('/api/media-favs/cats', auth, wrap((req, res) => {
    const kind = String(req.body?.kind || ''), name = String(req.body?.name || '');
    run('DELETE FROM media_fav_cats WHERE user_id=? AND kind=? AND name=?', req.uid, kind, name);
    run("UPDATE media_favs SET cat='' WHERE user_id=? AND kind=? AND cat=?", req.uid, kind, name);
    changed(req.uid); res.json({});
  }));
}
