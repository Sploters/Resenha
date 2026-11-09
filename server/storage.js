// Gerenciador de armazenamento: quanto espaço os anexos ocupam e como liberar, sem precisar mexer no disco à mão.
// - Cada pessoa: os próprios envios (por servidor/DM e por tipo, maiores arquivos) e apagar em massa
//   ("mídias com mais de 30 dias", "só vídeos"…). GET/POST /api/storage/me
// - Quem gerencia um servidor: espaço por canal e por membro, apagar mídias antigas do servidor e expiração automática
//   (mídias com mais de N dias somem sozinhas; fixadas e clipes da galeria ficam). GET/PUT/POST /api/guilds/:id/storage
// - Administrador da instalação: disco livre, total por servidor/DMs e arquivos órfãos (no disco, sem nada usando).
//   GET/POST /api/storage/instance
// Anexo apagado vira um "arquivo expirado" na mensagem ({ expired, name, size, type }, sem url): a conversa continua
// fazendo sentido e o arquivo sai do disco (se nada mais usa — unlinkIfUnused).
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400e3;
export const kindOf = (a) => {
  const t = String(a.type || ''), ext = (String(a.name || '').split('.').pop() || '').toLowerCase();
  if (a.voice || t.startsWith('audio/') || /^(mp3|ogg|wav|m4a|opus)$/.test(ext)) return 'audio';
  if (t.startsWith('video/') || /^(mp4|webm|mov|m4v|mkv)$/.test(ext)) return 'video';
  if (t.startsWith('image/') || /^(png|jpe?g|gif|webp|avif|bmp)$/.test(ext)) return 'image';
  return 'other';
};
const KINDS = ['image', 'video', 'audio', 'other'];
const emptyKinds = () => Object.fromEntries(KINDS.map(k => [k, 0]));

export function mountStorage(app, d) {
  const { auth, wrap, bad, all, get, run, can, P, dispatch, channelAudience, messageObj, unlinkIfUnused, isAdmin, uploadDir, db } = d;
  try { db.exec('ALTER TABLE guilds ADD COLUMN media_days INTEGER DEFAULT 0'); } catch { /* já existe */ }

  const fileOf = (url) => path.basename(String(url || '').split('/')[2] || '');
  // nome do lugar: "Servidor › #canal" ou "DM com Fulano" (do ponto de vista de uid)
  const placeName = (ch, uid) => {
    if (ch.guild_id) { const g = get('SELECT name FROM guilds WHERE id=?', ch.guild_id); return { guild: g?.name || 'Servidor', channel: '#' + (ch.name || 'canal') }; }
    const others = all('SELECT COALESCE(u.display_name, u.username) n FROM dm_participants p JOIN users u ON u.id = p.user_id WHERE p.channel_id=? AND p.user_id<>?', ch.id, uid).map(r => r.n);
    return { guild: null, channel: ch.name || (others.length ? others.join(', ') : 'Conversa') };
  };
  // anexos vivos (não expirados) das mensagens que casam com `where`
  const scan = (where, ...p) => {
    const out = [];
    for (const m of all(`SELECT m.id, m.channel_id, m.author_id, m.created_at, m.pinned, m.attachments FROM messages m WHERE m.attachments IS NOT NULL AND m.attachments <> '[]' AND ${where}`, ...p)) {
      let atts; try { atts = JSON.parse(m.attachments); } catch { continue; }
      atts.forEach((a, i) => { if (a && a.url && !a.expired) out.push({ mid: m.id, channel_id: m.channel_id, author_id: m.author_id, created_at: m.created_at, pinned: !!m.pinned, i, url: a.url, name: a.name, size: +a.size || 0, type: a.type || '', kind: kindOf(a) }); });
    }
    return out;
  };
  const isClip = (mid, url) => !!get('SELECT 1 x FROM clips WHERE message_id=? AND url=?', mid, url);

  // marca como expirados os anexos `items` ({ mid, url }); devolve { count, bytes }
  function expire(items) {
    const byMsg = new Map(); for (const it of items) { if (!byMsg.has(it.mid)) byMsg.set(it.mid, new Set()); byMsg.get(it.mid).add(it.url); }
    let count = 0, bytes = 0; const urls = [];
    for (const [mid, set] of byMsg) {
      const m = get('SELECT * FROM messages WHERE id=?', mid); if (!m) continue;
      let atts; try { atts = JSON.parse(m.attachments || '[]'); } catch { continue; }
      let changed = false;
      atts = atts.map(a => {
        if (!a || a.expired || !set.has(a.url)) return a;
        changed = true; count++; bytes += +a.size || 0; urls.push(a.url);
        return { name: a.name, size: +a.size || 0, type: a.type || '', expired: Date.now() };
      });
      if (!changed) continue;
      run('UPDATE messages SET attachments=? WHERE id=?', JSON.stringify(atts), m.id);
      const ch = get('SELECT * FROM channels WHERE id=?', m.channel_id);
      if (ch) dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    }
    for (const u of urls) unlinkIfUnused(u);
    return { count, bytes };
  }
  // filtro comum: olderThanDays (0 = qualquer idade), kinds (lista), sem fixadas e sem clipes da galeria
  const pick = (list, body) => {
    const days = Math.max(0, Math.min(3650, +body.olderThanDays || 0)), cut = days ? Date.now() - days * DAY : Infinity;
    const kinds = Array.isArray(body.kinds) && body.kinds.length ? new Set(body.kinds.filter(k => KINDS.includes(k))) : null;
    const places = Array.isArray(body.places) && body.places.length ? new Set(body.places.map(String)) : null;
    const only = Array.isArray(body.items) && body.items.length ? new Set(body.items.slice(0, 2000).map(x => `${x.mid}|${x.url}`)) : null;
    return list.filter(a => (only ? only.has(`${a.mid}|${a.url}`) : (a.created_at < cut && (!kinds || kinds.has(a.kind)) && (!places || places.has(a.channel_id)) && !a.pinned)) && !isClip(a.mid, a.url));
  };
  const summary = (list, uid, top = 30) => {
    const kinds = emptyKinds(), places = new Map(); let total = 0;
    const chCache = new Map(), chOf = (id) => { if (!chCache.has(id)) chCache.set(id, get('SELECT * FROM channels WHERE id=?', id)); return chCache.get(id); };
    for (const a of list) {
      total += a.size; kinds[a.kind] += a.size;
      let p = places.get(a.channel_id);
      if (!p) { const ch = chOf(a.channel_id); if (!ch) continue; p = { channel_id: ch.id, guild_id: ch.guild_id, ...placeName(ch, uid), bytes: 0, files: 0 }; places.set(ch.id, p); }
      p.bytes += a.size; p.files++;
    }
    const files = [...list].sort((a, b) => b.size - a.size).slice(0, top).map(a => ({ ...a, place: places.get(a.channel_id) ? `${places.get(a.channel_id).guild ? places.get(a.channel_id).guild + ' › ' : ''}${places.get(a.channel_id).channel}` : '' }));
    const oldest = list.reduce((m, a) => Math.min(m, a.created_at || Infinity), Infinity);
    return { total, count: list.length, kinds, places: [...places.values()].sort((a, b) => b.bytes - a.bytes), files, oldest: isFinite(oldest) ? oldest : null };
  };

  // ---- este aparelho: apaga o cache HTTP do navegador para este site (imagens, vídeos, miniaturas guardadas) sem tocar
  // no login nem nas configurações (que ficam no localStorage). Chrome/Edge/Firefox; o Safari ignora. ----
  app.post('/api/storage/clear-site-cache', (req, res) => { res.set('Clear-Site-Data', '"cache"'); res.json({}); });

  // ---- cada pessoa: os próprios envios ----
  app.get('/api/storage/me', auth, wrap((req, res) => { res.json(summary(scan('m.author_id=?', req.uid), req.uid, 40)); }));
  app.post('/api/storage/me/delete', auth, wrap((req, res) => {
    const list = pick(scan('m.author_id=?', req.uid), req.body || {});
    res.json(expire(list));
  }));

  // ---- servidor ----
  const guildFor = (req, res) => {
    const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
    if (!g || !can(g.id, req.uid, P.MANAGE_GUILD)) { bad(res, 'Sem permissão', 403); return null; }
    return g;
  };
  const guildScan = (gid) => scan('m.channel_id IN (SELECT id FROM channels WHERE guild_id=?)', gid);
  app.get('/api/guilds/:id/storage', auth, wrap((req, res) => {
    const g = guildFor(req, res); if (!g) return;
    const list = guildScan(g.id), s = summary(list, req.uid, 25), members = new Map();
    for (const a of list) members.set(a.author_id, (members.get(a.author_id) || 0) + a.size);
    s.members = [...members].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, bytes]) => ({ id, bytes, name: get('SELECT COALESCE(display_name, username) n FROM users WHERE id=?', id)?.n || '?' }));
    s.mediaDays = +g.media_days || 0;
    res.json(s);
  }));
  app.put('/api/guilds/:id/storage', auth, wrap((req, res) => {
    const g = guildFor(req, res); if (!g) return;
    const days = Math.max(0, Math.min(3650, Math.round(+req.body?.mediaDays || 0)));
    if (days && days < 7) return bad(res, 'O mínimo é 7 dias');
    run('UPDATE guilds SET media_days=? WHERE id=?', days, g.id);
    res.json({ mediaDays: days, ...(days ? expire(pick(guildScan(g.id), { olderThanDays: days })) : { count: 0, bytes: 0 }) });
  }));
  app.post('/api/guilds/:id/storage/purge', auth, wrap((req, res) => {
    const g = guildFor(req, res); if (!g) return;
    res.json(expire(pick(guildScan(g.id), req.body || {})));
  }));

  // ---- instalação inteira (administrador) ----
  const dirStats = () => {
    let files = 0, bytes = 0, derived = 0; const names = [];
    for (const f of fs.readdirSync(uploadDir)) {
      let st; try { st = fs.statSync(path.join(uploadDir, f)); } catch { continue; } if (!st.isFile()) continue;
      if (/^[a-f0-9]{24}(\.[a-z0-9]{1,10})?$/i.test(f)) { files++; bytes += st.size; names.push([f, st.size, st.mtimeMs]); } else derived += st.size; // miniaturas, faixas, versões WebP
    }
    return { files, bytes, derived, names };
  };
  const referenced = () => { // todos os nomes de arquivo citados no banco
    const set = new Set(), add = (s) => { for (const m of String(s || '').matchAll(/[a-f0-9]{24}(?:\.[a-z0-9]{1,10})?/gi)) set.add(m[0]); };
    for (const [t, c] of [['messages', 'attachments'], ['users', 'avatar'], ['users', 'banner'], ['users', 'settings'], ['emojis', 'url'], ['sounds', 'url'], ['guilds', 'icon'], ['guilds', 'banner'], ['clips', 'url']]) {
      try { for (const r of all(`SELECT ${c} v FROM ${t} WHERE ${c} IS NOT NULL`)) add(r.v); } catch { }
    }
    return set;
  };
  const orphans = (names) => { const ref = referenced(), hour = Date.now() - 3600e3; return names.filter(([f, , mt]) => !ref.has(f) && mt < hour); }; // 1 h de folga: envio ainda sem mensagem
  app.get('/api/storage/instance', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const ds = dirStats(), orf = orphans(ds.names);
    let disk = null; try { const s = fs.statfsSync(uploadDir); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { }
    const guilds = new Map(); let dms = 0;
    for (const r of all(`SELECT c.guild_id, m.attachments FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.attachments IS NOT NULL AND m.attachments <> '[]'`)) {
      let atts; try { atts = JSON.parse(r.attachments); } catch { continue; }
      const b = atts.reduce((s, a) => s + (a && a.url && !a.expired ? +a.size || 0 : 0), 0);
      if (r.guild_id) guilds.set(r.guild_id, (guilds.get(r.guild_id) || 0) + b); else dms += b;
    }
    res.json({ disk, uploads: { files: ds.files, bytes: ds.bytes }, derived: ds.derived, orphans: { files: orf.length, bytes: orf.reduce((s, x) => s + x[1], 0) }, dms,
      guilds: [...guilds].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, bytes]) => { const g = get('SELECT name, media_days FROM guilds WHERE id=?', id); return { id, name: g?.name || '?', mediaDays: +g?.media_days || 0, bytes }; }) });
  }));
  app.post('/api/storage/instance/orphans', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const orf = orphans(dirStats().names); let bytes = 0;
    for (const [f, sz] of orf) { try { fs.unlinkSync(path.join(uploadDir, f)); bytes += sz; d.removeDerived?.(f); } catch { } }
    res.json({ count: orf.length, bytes });
  }));

  // ---- expiração automática: de hora em hora (e 1 min depois de ligar) ----
  const sweep = () => {
    try {
      for (const g of all('SELECT id, media_days FROM guilds WHERE media_days > 0')) {
        const r = expire(pick(guildScan(g.id), { olderThanDays: g.media_days }));
        if (r.count) console.log(`  Armazenamento: ${r.count} mídia(s) expirada(s) no servidor ${g.id} (${(r.bytes / 1048576).toFixed(1)} MB)`);
      }
    } catch (e) { console.error('storage sweep', e); }
  };
  setTimeout(sweep, 60e3).unref?.(); setInterval(sweep, 3600e3).unref?.();
  return { expire, sweep, kindOf };
}
