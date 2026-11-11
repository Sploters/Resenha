// Aba "Arquivos" (estilo Drive) de cada servidor ou DM: tudo o que foi enviado, numa grade por tipo, sem rolar o chat.
// GET /api/media?guild=<id> | channel=<id>   (servidor inteiro, ou um canal / uma DM)
//   &kind=all|image|video|audio|doc|file|link  &author=<id>  &since=<ms>  &until=<ms>  &q=<nome>  &before=<id da mensagem>
// Resposta: { items, next, counts? } — cada anexo (ou link do texto) vira um item; `next` é o id da última mensagem lida
// (a próxima página continua dali). A varredura vai das mais novas para as mais antigas pelo índice (channel_id, id), em
// blocos, e para quando junta uma página: um canal com 100 mil mensagens não é lido inteiro para mostrar 60 arquivos.
// `counts` (só na primeira página, sem filtros de tipo) diz quantos há de cada tipo, para os números das abas.
const EXT = {
  image: /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i,
  video: /\.(mp4|webm|mov|m4v|mkv|avi)$/i,
  audio: /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|weba)$/i,
  doc: /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|epub|tex|json|xml|ya?ml)$/i,
};
const DOC_TYPES = /^(application\/(pdf|msword|vnd\.|rtf|epub|json|xml)|text\/)/;
export function kindOf(a) {
  const t = String(a.type || ''), n = String(a.name || a.url || '').split('?')[0];
  if (a.voice) return 'audio';
  if (t.startsWith('image/') || EXT.image.test(n)) return 'image';
  if (t.startsWith('video/') || EXT.video.test(n)) return 'video';
  if (t.startsWith('audio/') || EXT.audio.test(n)) return 'audio';
  if (DOC_TYPES.test(t) || EXT.doc.test(n)) return 'doc';
  return 'file';
}
export const KINDS = ['image', 'video', 'audio', 'doc', 'file', 'link'];
// links do texto (sem os de arquivos desta instalação, que já entram como anexo, e sem os de convite)
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
export function linksOf(content) {
  const out = [];
  for (let u of String(content || '').match(URL_RE) || []) {
    u = u.replace(/[)\].,!?;:*_~|]+$/, ''); // pontuação do fim da frase / markdown
    if (u.length < 12 || u.length > 2000 || out.includes(u)) continue;
    out.push(u);
  }
  return out.slice(0, 10);
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function mountMedia(app, { auth, wrap, bad, all, get, clean, maxUpload }) {
  // canais que a pessoa pode ver no escopo pedido
  function scopeChannels(uid, q) {
    if (q.guild) {
      const gid = String(q.guild);
      if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid)) return null;
      const chs = all('SELECT id, name FROM channels WHERE guild_id=? AND type IN (0,2)', gid);
      return q.channel ? chs.filter(c => c.id === String(q.channel)) : chs;
    }
    if (q.channel) {
      const c = get('SELECT c.id, c.name FROM channels c JOIN dm_participants p ON p.channel_id=c.id AND p.user_id=? WHERE c.id=?', uid, String(q.channel));
      return c ? [c] : null;
    }
    return null;
  }
  app.get('/api/media', auth, wrap((req, res) => {
    const chs = scopeChannels(req.uid, req.query); if (!chs) return bad(res, 'Conversa não encontrada', 404);
    if (!chs.length) return res.json({ items: [], next: null });
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'all';
    const author = req.query.author ? String(req.query.author) : null;
    const since = +req.query.since || 0, until = +req.query.until || 0;
    const q = clean(req.query.q, 100).toLowerCase();
    const limit = Math.min(Math.max(+req.query.limit || 60, 1), 120);
    let before = req.query.before ? String(req.query.before) : '99999999999999999999';
    const ids = JSON.stringify(chs.map(c => c.id));
    const where = [`m.channel_id IN (SELECT value FROM json_each(?))`, "m.type = 0", "(m.attachments <> '[]' OR m.content LIKE '%http%')"], args = [ids];
    if (author) { where.push('m.author_id = ?'); args.push(author); }
    if (since) { where.push('m.created_at >= ?'); args.push(since); }
    if (until) { where.push('m.created_at <= ?'); args.push(until); }
    if (kind === 'link') where.push("m.content LIKE '%http%'");
    else if (kind !== 'all') where.push("m.attachments <> '[]'");
    if (q && kind !== 'link') { where.push('(lower(m.attachments) LIKE ? OR lower(m.content) LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    const sql = `SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.attachments, m.pinned FROM messages m WHERE ${where.join(' AND ')} AND m.id < ? ORDER BY m.id DESC LIMIT 200`;
    const items = []; let next = null, scanned = 0;
    for (; ;) {
      const rows = all(sql, ...args, before); if (!rows.length) { next = null; break; }
      for (const m of rows) {
        scanned++; before = m.id;
        const base = { message_id: m.id, channel_id: m.channel_id, author_id: m.author_id, created_at: m.created_at, pinned: !!m.pinned };
        if (kind !== 'link') {
          let atts = []; try { atts = JSON.parse(m.attachments || '[]'); } catch { }
          atts.forEach((a, i) => {
            if (!a || a.enc || (!a.url && !a.expired)) return; // protegido de ponta a ponta: o servidor não sabe nome nem tipo
            const k = kindOf(a); if (kind !== 'all' && k !== kind) return;
            if (q && !String(a.name || '').toLowerCase().includes(q)) return;
            items.push({ ...base, i, kind: k, url: a.url || null, name: a.name || 'arquivo', size: +a.size || 0, type: a.type || '', expired: !!a.expired, ...(a.voice ? { voice: true, duration: a.duration || 0 } : {}) });
          });
        }
        if (kind === 'all' || kind === 'link') for (const u of linksOf(m.content)) {
          if (q && !u.toLowerCase().includes(q)) continue;
          items.push({ ...base, kind: 'link', url: u, name: host(u) || u, host: host(u) });
        }
        if (items.length >= limit) { next = m.id; break; }
      }
      if (items.length >= limit || rows.length < 200 || scanned >= 5000) { if (items.length < limit && rows.length === 200) next = before; break; }
    }
    const out = { items, next };
    // números das abas: só na primeira página e sem filtro de tipo/busca (contagem por mensagem, aproximada para links)
    if (!req.query.before && req.query.counts) {
      const cw = [`channel_id IN (SELECT value FROM json_each(?))`, "type = 0"], ca = [ids];
      if (author) { cw.push('author_id = ?'); ca.push(author); }
      if (since) { cw.push('created_at >= ?'); ca.push(since); }
      if (until) { cw.push('created_at <= ?'); ca.push(until); }
      const counts = { image: 0, video: 0, audio: 0, doc: 0, file: 0, link: 0 };
      for (const r of all(`SELECT attachments a, content c FROM messages WHERE ${cw.join(' AND ')} AND (attachments <> '[]' OR content LIKE '%http%') ORDER BY id DESC LIMIT 20000`, ...ca)) {
        if (r.a && r.a !== '[]') { try { for (const a of JSON.parse(r.a)) if (a && !a.enc && (a.url || a.expired)) counts[kindOf(a)]++; } catch { } }
        if (r.c && r.c.includes('http')) counts.link += linksOf(r.c).length;
      }
      out.counts = counts;
    }
    out.max_upload = maxUpload;
    res.json(out);
  }));
}
