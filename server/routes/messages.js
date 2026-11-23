// Mensagens: histórico, fixadas, busca, caixa de entrada, enviar/editar/apagar (com menções e @everyone limitados) e,
// em mountMessageActions, fixar, spoiler, reações e marcar como lido. São duas funções porque, no index.js, enquetes e
// clipes são registrados entre as duas partes (a ordem das rotas no express fica a mesma de antes).
// forum e clips chegam por getter (d.forum, d.clips): são criados mais abaixo no index.js, então só são lidos na hora da requisição
import path from 'node:path';
import { imageSize } from '../imgsize.js';
import { VIDEO_KINDS } from '../thumbs.js';
import { messageContent, isE2ee } from '../e2ee.js';
import { uxFirst } from '../ux.js';

export function mountMessages(app, d) {
  const { auth, wrap, bad, clean, db, all, get, run, newId, P, CH, chp, can, timedOut, rateOk, reputation, dispatch, channelAudience, channelFor, canAccessChannel, messageObj, audit, isFileUrl, unlinkIfUnused, UPLOAD_DIR, msglog } = d;
  // Messages
  app.get('/api/channels/:id/messages', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const limit = Math.min(+req.query.limit || 50, 100);
    let rows;
    if (req.query.around) {
      const a = all('SELECT * FROM messages WHERE channel_id=? AND id<=? ORDER BY id DESC LIMIT 25', ch.id, String(req.query.around));
      const b = all('SELECT * FROM messages WHERE channel_id=? AND id>? ORDER BY id ASC LIMIT 25', ch.id, String(req.query.around));
      rows = [...a, ...b].sort((x, y) => (x.id < y.id ? 1 : -1));
    } else if (req.query.oldest) rows = all('SELECT * FROM messages WHERE channel_id=? ORDER BY id ASC LIMIT ?', ch.id, limit).reverse();
    else if (req.query.after) rows = all('SELECT * FROM messages WHERE channel_id=? AND id>? ORDER BY id ASC LIMIT ?', ch.id, String(req.query.after), limit).reverse();
    else if (req.query.before) rows = all('SELECT * FROM messages WHERE channel_id=? AND id<? ORDER BY id DESC LIMIT ?', ch.id, String(req.query.before), limit);
    else rows = all('SELECT * FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?', ch.id, limit);
    res.json(rows.reverse().map(messageObj));
  }));
  app.get('/api/channels/:id/pins', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    res.json(all('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY id DESC', ch.id).map(messageObj));
  }));
  // Busca: texto livre no índice FTS (sem acento, por prefixo) + filtros de:nome tem:imagem|arquivo|link|video em:canal
  const HAS = {
    imagem: "m.attachments GLOB '*.[pP][nN][gG]\"*' OR m.attachments GLOB '*.[jJ][pP]*' OR m.attachments GLOB '*.[gG][iI][fF]\"*' OR m.attachments GLOB '*.[wW][eE][bB][pP]\"*'",
    video: "m.attachments GLOB '*.[mM][pP]4\"*' OR m.attachments GLOB '*.[wW][eE][bB][mM]\"*'",
    arquivo: "m.attachments <> '[]'", link: "m.content LIKE '%http%'",
  };
  HAS.image = HAS.imagem; HAS.file = HAS.arquivo; HAS.anexo = HAS.arquivo;
  function parseSearch(q) {
    const out = { terms: [], from: [], has: [], in: [] };
    for (const t of q.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
      const m = t.match(/^(de|from|tem|has|em|in):(.+)$/i), v = m?.[2].replace(/^[@#"]+|"$/g, '');
      if (m && v) out[{ de: 'from', from: 'from', tem: 'has', has: 'has', em: 'in', in: 'in' }[m[1].toLowerCase()]].push(v.toLowerCase());
      else out.terms.push(t.replace(/"/g, ''));
    }
    return out;
  }
  // filtros da busca (texto, de:, tem:, em:) num conjunto de canais; null = nada a procurar
  // scope: { guild } (um servidor), { channel } (uma DM sua), { all: true } (suas DMs + todos os seus servidores) ou {} (suas DMs)
  function searchWhere(uid, q, scope) {
    const p = parseSearch(q), where = ['m.type = 0'], args = [];
    const gid = scope.guild || null;
    if (gid) {
      if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid)) return null;
      where.push('c.guild_id = ?'); args.push(gid);
    } else if (scope.channel) {
      if (!get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', scope.channel, uid)) return null;
      where.push('m.channel_id = ?'); args.push(scope.channel);
    } else if (scope.all) {
      where.push('(m.channel_id IN (SELECT channel_id FROM dm_participants WHERE user_id=?) OR c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?))'); args.push(uid, uid);
    } else { where.push('m.channel_id IN (SELECT channel_id FROM dm_participants WHERE user_id=?)'); args.push(uid); }
    const fts = p.terms.map(t => t.replace(/[^\p{L}\p{N}_.-]+/gu, ' ').trim()).filter(Boolean).flatMap(t => t.split(/\s+/)).map(t => `"${t}"*`).join(' ');
    if (fts) { where.push('m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)'); args.push(fts); }
    else if (p.terms.length) return null; // só pontuação
    for (const name of p.from) {
      where.push('m.author_id IN (SELECT id FROM users WHERE lower(username)=? OR lower(display_name)=?' + (gid ? ' UNION SELECT user_id FROM members WHERE guild_id=? AND lower(nickname)=?' : '') + ')');
      args.push(name, name); if (gid) args.push(gid, name);
    }
    for (const k of p.has) { if (!HAS[k]) return null; where.push('(' + HAS[k] + ')'); }
    for (const name of p.in) { where.push('lower(c.name) = ?'); args.push(name); }
    if (!fts && !p.from.length && !p.has.length && !p.in.length) return null;
    return { where: where.join(' AND '), args, fts };
  }
  const searchScope = (req) => (req.query.guild ? { guild: String(req.query.guild) } : req.query.channel ? { channel: String(req.query.channel) } : req.query.all ? { all: true } : {});
  // ordem: new (mais novas), old (mais antigas) ou relevant (melhor pontuação do índice de busca)
  app.get('/api/search', auth, wrap((req, res) => {
    const q = clean(req.query.q, 200); if (!q) return res.json([]);
    const w = searchWhere(req.uid, q, searchScope(req)); if (!w) return res.json([]);
    const sort = String(req.query.sort || 'new');
    const rows = sort === 'relevant' && w.fts
      ? all(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id JOIN messages_fts f ON f.rowid=m.rowid WHERE ${w.where} AND messages_fts MATCH ? ORDER BY bm25(messages_fts), m.id DESC LIMIT 50`, ...w.args, w.fts)
      : all(`SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE ${w.where} ORDER BY m.id ${sort === 'old' ? 'ASC' : 'DESC'} LIMIT 50`, ...w.args);
    res.json(rows.map(messageObj));
  }));
  // busca em tudo, agrupada: um item por servidor (quantas mensagens, em quantos canais) e um por conversa
  app.get('/api/search/groups', auth, wrap((req, res) => {
    const q = clean(req.query.q, 200); if (!q) return res.json([]);
    const scope = String(req.query.scope || 'all');
    const w = searchWhere(req.uid, q, scope === 'dms' ? {} : scope === 'all' ? { all: true } : { guild: scope }); if (!w) return res.json([]);
    const sort = String(req.query.sort || 'new');
    const rows = all(`SELECT c.guild_id g, CASE WHEN c.guild_id IS NULL THEN m.channel_id END dm, COUNT(*) n, COUNT(DISTINCT m.channel_id) chs, MAX(m.created_at) last, MIN(m.created_at) first
    FROM messages m JOIN channels c ON c.id=m.channel_id WHERE ${w.where} GROUP BY COALESCE(c.guild_id, m.channel_id)
    ORDER BY ${sort === 'old' ? 'first ASC' : sort === 'relevant' ? 'n DESC, last DESC' : 'last DESC'} LIMIT 50`, ...w.args);
    res.json(rows.map(r => ({ guild_id: r.g || null, channel_id: r.dm || null, count: r.n, channels: r.chs, last: r.last, first: r.first })));
  }));
  // Caixa de entrada: menções, respostas e @everyone dirigidos a mim, de todos os servidores e DMs
  app.get('/api/inbox', auth, wrap((req, res) => {
    const before = req.query.before ? String(req.query.before) : '99999999999999999999';
    const rows = all(`SELECT m.*, mm.kind, c.guild_id, c.name channel_name FROM mentions mm JOIN messages m ON m.id=mm.message_id JOIN channels c ON c.id=m.channel_id
    WHERE mm.user_id=? AND m.id<? AND (c.guild_id IN (SELECT guild_id FROM members WHERE user_id=?) OR c.id IN (SELECT channel_id FROM dm_participants WHERE user_id=?))
    ORDER BY m.id DESC LIMIT 30`, req.uid, before, req.uid, req.uid);
    res.json(rows.map(r => {
      const rs = get('SELECT last_id FROM read_states WHERE user_id=? AND channel_id=?', req.uid, r.channel_id);
      return { ...messageObj(r), guild_id: r.guild_id, channel_name: r.channel_name, kind: r.kind, unread: !rs || rs.last_id < r.id };
    }));
  }));
  // Quem a mensagem marca: só contas que estão no canal (no máximo 50 por mensagem). @everyone/@here de quem não modera
  // notifica no máximo 1 vez a cada 5 min por servidor: sem isso, 5 mensagens por segundo com @everyone num servidor de
  // 5.000 pessoas gravavam 25 mil linhas na caixa de entrada por segundo (a mensagem continua indo; só não notifica).
  const everyoneAt = new Map(); // `${gid}:${uid}` -> última @everyone que notificou
  setInterval(() => { const old = Date.now() - 300e3; for (const [k, t] of everyoneAt) if (t < old) everyoneAt.delete(k); }, 60e3).unref();
  function resolveMentions(content, ch, authorId, fresh = true) {
    if (ch.guild_id && /@everyone|@here/.test(content)) {
      const k = ch.guild_id + ':' + authorId, mod = can(ch.guild_id, authorId, P.MANAGE_MESSAGES) || can(ch.guild_id, authorId, P.MODERATE);
      if (mod || !fresh || Date.now() - (everyoneAt.get(k) || 0) > 300e3) { if (fresh && !mod) everyoneAt.set(k, Date.now()); return { everyone: true, ids: channelAudience(ch) }; }
    }
    const want = [...new Set([...content.matchAll(/<@(\d{1,24})>/g)].map(x => x[1]))].slice(0, 50);
    const isIn = ch.guild_id ? (id) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, id)
      : (id) => !!get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', ch.id, id);
    const ids = new Set(want.filter(isIn));
    // @cargo (<@&id>): marca quem tem o cargo neste servidor. Quem não modera notifica cada cargo no máximo 1 vez a cada 5 min
    // (mesma conta do @everyone: um cargo pode ter o servidor inteiro)
    if (ch.guild_id) {
      const mod = can(ch.guild_id, authorId, P.MANAGE_MESSAGES) || can(ch.guild_id, authorId, P.MODERATE);
      for (const rid of [...new Set([...content.matchAll(/<@&(\d{1,24})>/g)].map(x => x[1]))].slice(0, 5)) {
        if (!get('SELECT 1 x FROM roles WHERE id=? AND guild_id=?', rid, ch.guild_id)) continue;
        const k = ch.guild_id + ':' + authorId + ':' + rid;
        if (!mod && fresh && Date.now() - (everyoneAt.get(k) || 0) <= 300e3) continue;
        if (fresh && !mod) everyoneAt.set(k, Date.now());
        for (const r of all('SELECT user_id FROM member_roles WHERE guild_id=? AND role_id=?', ch.guild_id, rid)) ids.add(r.user_id);
      }
    }
    return { everyone: false, ids: [...ids] };
  }
  function saveMentions(m, ch, mn) { // grava quem deve ver esta mensagem na caixa de entrada (uma transação: 5.000 linhas levam ms, não segundos)
    db.exec('BEGIN');
    try {
      run("DELETE FROM mentions WHERE message_id=? AND kind<>'reply'", m.id);
      for (const id of mn.ids) if (id !== m.author_id) run('INSERT OR IGNORE INTO mentions VALUES(?,?,?)', m.id, id, mn.everyone ? 'everyone' : 'mention');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  app.post('/api/channels/:id/messages', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    if (ch.type === 4 || ch.type === 15 || ch.type === 17) return bad(res, 'Canal não aceita mensagens');
    if (!d.forum.canReply(ch, req.uid)) return bad(res, 'Este post está trancado: só a moderação comenta', 403);
    if (timedOut(ch.guild_id, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
    if (!chp.chCan(ch, req.uid, CH.SEND)) return bad(res, 'Você não tem permissão para enviar mensagens neste canal', 403);
    if (!rateOk(req.uid)) return bad(res, 'Você está enviando mensagens rápido demais', 429);
    { const wait = reputation.slowWait(ch.guild_id, req.uid); // soft-mute da reputação: 1 mensagem a cada N segundos
      if (wait) return res.status(429).json({ error: `Envio limitado pela comunidade: espere ${wait >= 60 ? Math.ceil(wait / 60) + ' min' : wait + ' s'} para a próxima mensagem`, retry_after: wait, softmute: true }); }
    const mc = messageContent(req.body.content, ch); if (mc.error) return bad(res, mc.error);
    const content = mc.content; // protegida (e2ee:…): o servidor guarda e repassa sem conseguir ler (server/e2ee.js)
    const atts = (Array.isArray(req.body.attachments) ? req.body.attachments : []).slice(0, 10)
      .filter(a => a && isFileUrl(a.url))
      .map(a => {
        const o = { url: a.url, name: clean(a.name, 200), size: +a.size || 0, type: clean(a.type, 100) };
        if (VIDEO_KINDS.includes(a.vc)) o.vc = a.vc; // codec da imagem do vídeo (finalizeUpload), para medir quem não consegue assistir
        if (a.spoiler === true) o.spoiler = true; // anexo marcado como spoiler no envio: fica borrado para todos até clicar
        if (typeof a.alt === 'string' && a.alt.trim() && a.enc !== true) o.alt = clean(a.alt, 1000); // texto alternativo (descrição para leitor de tela)
        if (a.enc === true) o.enc = true; // arquivo cifrado no aparelho (conversa protegida): nome e tipo de verdade vão dentro da mensagem cifrada
        if (a.voice === true) { // mensagem de voz: forma de onda (base64, até 256 barras) e duração
          o.voice = true; o.duration = Math.max(0, Math.min(3600, +a.duration || 0));
          o.waveform = /^[A-Za-z0-9+/=]{0,400}$/.test(a.waveform || '') ? a.waveform : '';
        }
        // foto: largura e altura lidas do arquivo (o chat reserva o espaço antes dela carregar; server/imgsize.js)
        if (!o.enc && /^image\//.test(o.type)) { const sz = imageSize(path.join(UPLOAD_DIR, path.basename(a.url.split('/')[2] || ''))); if (sz) Object.assign(o, sz); }
        return o;
      });
    if (!content.trim() && !atts.length) return bad(res, 'Mensagem vazia');
    // galeria: post novo precisa de foto ou vídeo; comentário (resposta a um post) pode ser só texto
    if (ch.type === 16 && !req.body.reply_to && !atts.some(a => /^(image|video)\//.test(a.type) || /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)$/i.test(a.name || a.url))) return bad(res, 'Na galeria, cada post precisa de uma foto ou vídeo (para comentar, responda a um post)');
    if (atts.length && !chp.chCan(ch, req.uid, CH.ATTACH)) return bad(res, 'Você não tem permissão para enviar arquivos neste canal', 403);
    if (ch.type === 1) {
      const other = all('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, req.uid)[0];
      if (other && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=2', other.user_id, req.uid)) return bad(res, 'Você não pode enviar mensagens para este usuário', 403);
    }
    // encaminhada: a original tem de existir num canal que a pessoa vê, não ser protegida nem enquete/evento, e o texto
    // tem de ser o mesmo (numa conversa protegida o servidor não lê: confia no app). Guarda só de onde veio, não o autor.
    let fwd = null;
    if (req.body.forward && typeof req.body.forward === 'object') {
      const sc = get('SELECT * FROM channels WHERE id=?', String(req.body.forward.channel_id || ''));
      const om = sc && canAccessChannel(req.uid, sc) && get('SELECT * FROM messages WHERE id=? AND channel_id=?', String(req.body.forward.message_id || ''), sc.id);
      if (!om || (om.type || 0) !== 0 || isE2ee(om.content) || /^(📊|📅)/u.test(om.content || '')) return bad(res, 'Esta mensagem não pode ser encaminhada');
      if (!mc.e2ee && content !== (om.content || '')) return bad(res, 'O texto encaminhado não confere com o original');
      const sg = sc.guild_id && get('SELECT name FROM guilds WHERE id=?', sc.guild_id);
      fwd = JSON.stringify({ channel_id: sc.id, guild_id: sc.guild_id || null, message_id: om.id, created_at: om.created_at,
        from: sc.guild_id ? `#${sc.name}${sg ? ' · ' + sg.name : ''}` : sc.type === 1 ? 'Mensagem direta' : 'Grupo' });
    }
    // resposta: só a uma mensagem que existe neste canal (antes qualquer texto era guardado, até 1 MB)
    const replyTo = req.body.reply_to && /^\d{1,24}$/.test(String(req.body.reply_to)) && get('SELECT 1 x FROM messages WHERE id=? AND channel_id=?', String(req.body.reply_to), ch.id) ? String(req.body.reply_to) : null;
    const id = newId();
    run('INSERT INTO messages(id,channel_id,author_id,content,created_at,reply_to,attachments,fwd) VALUES(?,?,?,?,?,?,?,?)',
      id, ch.id, req.uid, content, Date.now(), fwd ? null : replyTo, JSON.stringify(atts), fwd);
    run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', req.uid, ch.id, id);
    const row = get('SELECT * FROM messages WHERE id=?', id);
    const mn = fwd ? { everyone: false, ids: [] } : resolveMentions(content, ch, req.uid); // encaminhada não marca ninguém de novo
    saveMentions(row, ch, mn);
    d.clips.recordClipShares(row, req.uid);
    const rep = row.reply_to && get('SELECT author_id FROM messages WHERE id=? AND channel_id=?', row.reply_to, ch.id);
    if (rep && rep.author_id !== req.uid) run('INSERT OR REPLACE INTO mentions VALUES(?,?,?)', id, rep.author_id, 'reply');
    const msg = { ...messageObj(row), guild_id: ch.guild_id, mentions: mn.ids, ...(ch.type === 11 ? { forum_id: ch.parent_id } : {}) }; // comentário de post: o app conta sem tratar como canal
    dispatch(channelAudience(ch), 'MESSAGE_CREATE', msg);
    uxFirst(req.uid, 'message');
    dispatch([req.uid], 'READ_STATE', { channel_id: ch.id, last_id: id, latest: true, tab: req.get('x-lc-tab') || null }); // respondeu num aparelho: lido em todos
    res.json(ch.guild_id && reputation.slowWait(ch.guild_id, req.uid) ? { ...msg, slow_wait: reputation.slowWait(ch.guild_id, req.uid) } : msg);
  }));
  app.patch('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m || m.author_id !== req.uid) return bad(res, 'Sem permissão', 403);
    const mc = messageContent(req.body.content, ch); if (mc.error) return bad(res, mc.error);
    const content = mc.content;
    if (!content.trim()) return bad(res, 'Mensagem vazia');
    if (get('SELECT 1 x FROM polls WHERE message_id=?', m.id)) return bad(res, 'Enquetes não podem ser editadas');
    if (get('SELECT 1 x FROM events WHERE message_id=?', m.id)) return bad(res, 'Anúncios de evento não podem ser editados (edite o evento)');
    run('UPDATE messages SET content=?,edited_at=? WHERE id=?', content, Date.now(), m.id);
    msglog.record('edit', ch, m, req.uid, content); // registro de mensagens (só servidores; server/msglog.js)
    // editar para pôr @everyone conta como uma nova @everyone; editar uma que já notificava mantém
    saveMentions(m, ch, resolveMentions(content, ch, req.uid, !/@everyone|@here/.test(m.content || '')));
    dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    res.json({});
  }));
  app.delete('/api/channels/:id/messages/:mid', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m || (m.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)))) return bad(res, 'Sem permissão', 403);
    const sharedIds = all('SELECT clip_id FROM clip_shares WHERE message_id=?', m.id).map(r => r.clip_id); // a mensagem levava o link: o compartilhamento sai
    run('DELETE FROM messages WHERE id=?', m.id);
    msglog.record('delete', ch, m, req.uid);
    d.clips.dropClipsOfMessage(m.id);
    for (const cid of sharedIds) d.clips.pushClipStats(cid);
    if (m.author_id !== req.uid) audit(ch.guild_id, req.uid, 'message_delete', m.author_id, `#${ch.name}: ${(m.content || '').slice(0, 200)}`);
    dispatch(channelAudience(ch), 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, guild_id: ch.guild_id });
    res.json({});
  }));
  // remove um anexo da mensagem (a mensagem some se ficar sem texto e sem anexos)
  app.delete('/api/channels/:id/messages/:mid/attachments/:idx', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m || (m.author_id !== req.uid && !(ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)))) return bad(res, 'Sem permissão', 403);
    const atts = JSON.parse(m.attachments || '[]'), i = +req.params.idx;
    if (!Number.isInteger(i) || !atts[i]) return bad(res, 'Anexo não encontrado', 404);
    const [gone] = atts.splice(i, 1);
    for (const c of all('SELECT * FROM clips WHERE message_id=? AND url=?', m.id, String(gone.url))) { run('DELETE FROM clips WHERE id=?', c.id); dispatch(channelAudience(ch), 'CLIP_DELETE', { id: c.id, guild_id: c.guild_id }); }
    if (m.author_id !== req.uid) audit(ch.guild_id, req.uid, 'message_delete', m.author_id, `#${ch.name}: anexo ${gone.name}`);
    if (!atts.length && !(m.content || '').trim()) {
      run('DELETE FROM messages WHERE id=?', m.id);
      dispatch(channelAudience(ch), 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, guild_id: ch.guild_id });
    } else {
      run('UPDATE messages SET attachments=? WHERE id=?', JSON.stringify(atts), m.id);
      dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    }
    unlinkIfUnused(gone.url);
    res.json({});
  }));
}

export function mountMessageActions(app, d) {
  const { auth, wrap, bad, clean, get, run, P, CH, chp, can, timedOut, dispatch, channelAudience, channelFor, messageObj, audit } = d;
  function setPin(req, res, v) {
    const ch = channelFor(req, res); if (!ch) return;
    if (ch.guild_id && !can(ch.guild_id, req.uid, P.MANAGE_MESSAGES)) return bad(res, 'Sem permissão', 403);
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m) return bad(res, 'Mensagem não encontrada', 404);
    run('UPDATE messages SET pinned=? WHERE id=?', v, m.id);
    dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    res.json({});
  }
  // spoiler na mensagem de outra pessoa: o autor ou um moderador (gerenciar mensagens) esconde conteúdo e anexos para todos,
  // sem precisar apagar e pedir para postar de novo. Numa conversa direta só o autor; os outros usam o "só para mim" do app.
  function setSpoiler(req, res, v) {
    const ch = channelFor(req, res); if (!ch) return;
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m) return bad(res, 'Mensagem não encontrada', 404);
    const mod = ch.guild_id && can(ch.guild_id, req.uid, P.MANAGE_MESSAGES);
    if (m.author_id !== req.uid && !mod) return bad(res, 'Só quem enviou ou um moderador pode marcar como spoiler para todos', 403);
    // o autor não desfaz o spoiler que um moderador pôs
    if (!v && m.spoiler_by && m.spoiler_by !== req.uid && m.spoiler_by !== m.author_id && !mod) return bad(res, 'Um moderador marcou esta mensagem como spoiler', 403);
    run('UPDATE messages SET spoiler_by=? WHERE id=?', v ? req.uid : null, m.id);
    if (m.author_id !== req.uid) audit(ch.guild_id, req.uid, v ? 'message_spoiler' : 'message_unspoiler', m.author_id, `#${ch.name}: ${(m.content || '').slice(0, 200) || 'anexo'}`);
    dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    res.json({});
  }
  app.put('/api/channels/:id/messages/:mid/spoiler', auth, wrap((req, res) => setSpoiler(req, res, 1)));
  app.delete('/api/channels/:id/messages/:mid/spoiler', auth, wrap((req, res) => setSpoiler(req, res, 0)));
  app.put('/api/channels/:id/pins/:mid', auth, wrap((req, res) => setPin(req, res, 1)));
  app.delete('/api/channels/:id/pins/:mid', auth, wrap((req, res) => setPin(req, res, 0)));
  function reaction(req, res, add) {
    const ch = channelFor(req, res); if (!ch) return;
    const m = get('SELECT * FROM messages WHERE id=? AND channel_id=?', req.params.mid, ch.id);
    if (!m) return bad(res, 'Mensagem não encontrada', 404);
    const emoji = clean(req.params.emoji, 64);
    if (add && timedOut(ch.guild_id, req.uid)) return bad(res, 'Você está de castigo neste servidor', 403);
    // sem permissão de reagir: ainda pode somar a uma reação que já existe (como no Discord), não criar uma nova
    if (add && !chp.chCan(ch, req.uid, CH.REACT) && !get('SELECT 1 x FROM reactions WHERE message_id=? AND emoji=?', m.id, emoji)) return bad(res, 'Você não tem permissão para reagir neste canal', 403);
    if (add) run('INSERT OR IGNORE INTO reactions VALUES(?,?,?)', m.id, req.uid, emoji);
    else run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.uid, emoji);
    dispatch(channelAudience(ch), 'MESSAGE_UPDATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', m.id)), guild_id: ch.guild_id });
    res.json({});
  }
  app.put('/api/channels/:id/messages/:mid/reactions/:emoji', auth, wrap((req, res) => reaction(req, res, true)));
  app.delete('/api/channels/:id/messages/:mid/reactions/:emoji', auth, wrap((req, res) => reaction(req, res, false)));
  // lido: grava e avisa NA HORA os outros aparelhos da mesma conta (READ_STATE): o celular tira a não lida, apaga o
  // número do ícone e fecha a notificação daquela conversa — sem "notificação fantasma" do que já foi lido no PC.
  // message_id (opcional): lido até ali (nunca volta para trás); sem ele, até a última mensagem do canal.
  function markRead(uid, ch, upTo, tab) {
    const last = get('SELECT MAX(id) m FROM messages WHERE channel_id=?', ch.id).m; if (!last) return null;
    let id = upTo && upTo < last ? upTo : last;
    const cur = get('SELECT last_id l FROM read_states WHERE user_id=? AND channel_id=?', uid, ch.id)?.l;
    if (cur && cur >= id) id = cur;
    else run('INSERT INTO read_states VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_id=excluded.last_id', uid, ch.id, id);
    dispatch([uid], 'READ_STATE', { channel_id: ch.id, last_id: id, latest: id === last, tab: tab || null });
    return id;
  }
  app.post('/api/channels/:id/ack', auth, wrap((req, res) => {
    const ch = channelFor(req, res); if (!ch) return;
    const id = markRead(req.uid, ch, req.body?.message_id ? String(req.body.message_id) : null, req.get('x-lc-tab'));
    res.json({ last_id: id });
  }));
}
