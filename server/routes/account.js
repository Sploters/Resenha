// Conta da própria pessoa: perfil (PATCH /api/me), senha, nome de usuário, configurações sincronizadas e privacidade,
// sessões abertas e exclusão da conta.
// activity chega por getter (d.activity): é criado mais abaixo no index.js, então só é lido na hora da requisição
import crypto from 'node:crypto';
import { hashPw, pwMatches, passwordProblem } from '../accounts.js';
import { cleanPrivacy } from '../privacy.js';
import { uxFirst } from '../ux.js';

export function mountAccount(app, d) {
  const { auth, wrap, bad, clean, all, get, run, dispatch, getUser, userPub, cssColor, isFileUrl, cleanPos, cleanNameStyle, DEFAULT_AVATARS, broadcastPresence, sessions, privacy, userCache, conns, voice, leaveVoice, guildMemberIds, dropViewers, sharedAudience, removeMember } = d;
  app.patch('/api/me', auth, wrap((req, res) => {
    const b = req.body, u = getUser(req.uid);
    const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
    const f = {
      display_name: b.display_name !== undefined ? clean(b.display_name, 32) || u.username : u.display_name,
      bio: b.bio !== undefined ? clean(b.bio, 300) : u.bio,
      avatar: b.avatar !== undefined ? (b.avatar || null) : u.avatar,
      color: b.color !== undefined ? cssColor(b.color) ?? u.color : u.color,
      banner_color: b.banner_color !== undefined ? cssColor(b.banner_color) ?? u.banner_color : u.banner_color,
      custom_status: b.custom_status !== undefined ? clean(b.custom_status, 100) : u.custom_status,
      status: ['online', 'idle', 'dnd', 'invisible'].includes(b.status) ? b.status : u.status,
      pronouns: b.pronouns !== undefined ? clean(b.pronouns, 40) : u.pronouns,
      banner: b.banner !== undefined ? (isFileUrl(b.banner) ? b.banner : null) : u.banner,
      avatar_pos: b.avatar_pos !== undefined ? cleanPos(b.avatar_pos) : u.avatar_pos,
      banner_pos: b.banner_pos !== undefined ? cleanPos(b.banner_pos) : u.banner_pos,
      status_emoji: b.status_emoji !== undefined ? clean(b.status_emoji, 16) : u.status_emoji,
      theme_primary: b.theme_primary !== undefined ? hex(b.theme_primary) : u.theme_primary,
      theme_accent: b.theme_accent !== undefined ? hex(b.theme_accent) : u.theme_accent,
      name_style: b.name_style !== undefined ? JSON.stringify(cleanNameStyle(b.name_style)) : u.name_style,
      // clipe fixado no perfil: só um clipe que a própria pessoa fez (quem vê o cartão precisa ter acesso ao clipe para ele tocar)
      pinned_clip: b.pinned_clip !== undefined ? (b.pinned_clip && get('SELECT 1 x FROM clips WHERE id=? AND author_id=?', String(b.pinned_clip), req.uid) ? String(b.pinned_clip) : null) : u.pinned_clip,
    };
    if (!f.theme_primary || !f.theme_accent) f.theme_primary = f.theme_accent = null; // tema só com as duas cores
    if (f.avatar && !isFileUrl(f.avatar) && !DEFAULT_AVATARS.includes(f.avatar)) f.avatar = u.avatar;
    if (f.avatar !== u.avatar && isFileUrl(f.avatar)) uxFirst(req.uid, 'avatar'); // telemetria: pôs uma foto própria
    run('UPDATE users SET display_name=?,bio=?,avatar=?,color=?,banner_color=?,custom_status=?,status=?,pronouns=?,banner=?,avatar_pos=?,banner_pos=?,status_emoji=?,theme_primary=?,theme_accent=?,name_style=?,pinned_clip=? WHERE id=?',
      f.display_name, f.bio, f.avatar, f.color, f.banner_color, f.custom_status, f.status, f.pronouns, f.banner, f.avatar_pos, f.banner_pos, f.status_emoji, f.theme_primary, f.theme_accent, f.name_style, f.pinned_clip, req.uid);
    broadcastPresence(req.uid);
    if ((f.status === 'invisible') !== (u.status === 'invisible')) d.activity.onInvisible(req.uid, f.status === 'invisible'); // atividade some/volta junto com o status
    res.json(userPub(req.uid));
  }));
  app.post('/api/me/password', auth, wrap((req, res) => {
    const u = getUser(req.uid);
    if (!pwMatches(u, String(req.body.old ?? ''))) return bad(res, 'Senha atual incorreta', 403);
    const pw = String(req.body.new ?? ''), why = passwordProblem(pw, u.username); if (why) return bad(res, why);
    const salt = crypto.randomBytes(16).toString('hex');
    run('UPDATE users SET pass_hash=?,salt=? WHERE id=?', hashPw(pw, salt), salt, req.uid);
    // senha trocada: os outros aparelhos saem (se a senha vazou, quem entrou com ela perde o acesso); este continua
    const ended = sessions.revoke(req.uid, req.tokenHash);
    res.json({ ended });
  }));

  // Conta: nome de usuário, configurações sincronizadas, sessões, exclusão
  const sid = (hash) => hash.slice(0, 12); // a coluna token guarda o hash (o mesmo id curto de antes)
  app.post('/api/me/username', auth, wrap((req, res) => {
    const u = getUser(req.uid), name = clean(req.body.username, 32);
    if (!pwMatches(u, String(req.body.password ?? ''))) return bad(res, 'Senha incorreta', 403);
    if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(name)) return bad(res, 'Nome de usuário inválido (2-32 caracteres: letras, números, _ . -)');
    const other = get('SELECT id FROM users WHERE username=?', name);
    if (other && other.id !== u.id) return bad(res, 'Esse nome de usuário já existe', 409);
    run('UPDATE users SET username=? WHERE id=?', name, u.id);
    broadcastPresence(u.id); res.json(userPub(u.id));
  }));
  app.get('/api/me/settings', auth, wrap((req, res) => {
    const u = getUser(req.uid);
    res.json({ settings: u.settings ? JSON.parse(u.settings) : {}, friend_policy: u.friend_policy || 'all', privacy: privacy.of(req.uid) });
  }));
  app.put('/api/me/settings', auth, wrap((req, res) => {
    // `patch` (+ `removed`): só o que mudou neste aparelho, juntado ao que a conta já tem. Antes cada aparelho mandava as
    // preferências inteiras e o último a enviar desfazia o que o outro tinha acabado de mudar (tema num, ordem das
    // conversas no outro: um dos dois sumia). `settings` (inteiras) continua valendo para app antigo.
    let merged = null;
    const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (isObj(req.body.patch) || Array.isArray(req.body.removed)) {
      const u = getUser(req.uid); let cur = {}; try { cur = JSON.parse(u.settings || '{}') || {}; } catch { }
      for (const [k, v] of Object.entries(isObj(req.body.patch) ? req.body.patch : {})) if (k !== '__proto__') cur[k] = v;
      for (const k of (Array.isArray(req.body.removed) ? req.body.removed : []).slice(0, 500)) if (typeof k === 'string') delete cur[k];
      merged = cur;
    } else if (req.body.settings !== undefined) merged = isObj(req.body.settings) ? req.body.settings : {};
    if (merged) {
      const s = JSON.stringify(merged); if (s.length > 100000) return bad(res, 'Configurações muito grandes');
      run('UPDATE users SET settings=? WHERE id=?', s, req.uid);
      dispatch([req.uid], 'SETTINGS_UPDATE', { settings: merged, tab: req.get('x-lc-tab') || null }); // os outros aparelhos aplicam na hora
    }
    if (['all', 'none'].includes(req.body.friend_policy)) run('UPDATE users SET friend_policy=? WHERE id=?', req.body.friend_policy, req.uid);
    if (req.body.privacy && typeof req.body.privacy === 'object') {
      const before = privacy.of(req.uid), p = cleanPrivacy(req.body.privacy, before);
      run('UPDATE users SET privacy=? WHERE id=?', JSON.stringify(p), req.uid); privacy.set(req.uid, p); userCache.delete(req.uid);
      if (JSON.stringify(before.presence) !== JSON.stringify(p.presence)) { broadcastPresence(req.uid); d.activity.onPresencePrivacy(req.uid); } // quem deixou de poder ver passa a ver offline na hora
      return res.json({ privacy: p, ...(merged ? { settings: merged } : {}) });
    }
    res.json(merged ? { settings: merged } : {});
  }));
  app.get('/api/sessions', auth, wrap((req, res) => {
    res.json(all('SELECT token,created_at,agent,last_seen FROM sessions WHERE user_id=? ORDER BY created_at DESC', req.uid).filter(s => !sessions.expired(s)).map(s => ({ id: sid(s.token), created_at: s.created_at, last_seen: s.last_seen, agent: s.agent || '', current: s.token === req.tokenHash })));
  }));
  app.delete('/api/sessions/:id', auth, wrap((req, res) => {
    const s = all('SELECT token FROM sessions WHERE user_id=?', req.uid).find(x => sid(x.token) === req.params.id);
    if (!s) return bad(res, 'Sessão não encontrada', 404);
    run('DELETE FROM sessions WHERE token=?', s.token);
    for (const ws of conns.get(req.uid) || []) if (ws.tokenHash === s.token) ws.close(4001, 'sessão encerrada');
    res.json({});
  }));
  app.delete('/api/sessions', auth, wrap((req, res) => { // encerra todas as outras
    sessions.revoke(req.uid, req.tokenHash);
    res.json({});
  }));
  // apaga a conta e tudo dela (servidores que é dono, mensagens, conversas, amizades); usada também pelo administrador
  // da instalação (server/admin.js), que não precisa da senha
  function deleteAccount(uid) {
    const u = getUser(uid); if (!u) return false;
    for (const g of all('SELECT id FROM guilds WHERE owner_id=?', u.id)) {
      const ids = guildMemberIds(g.id); run('DELETE FROM guilds WHERE id=?', g.id); dispatch(ids, 'GUILD_DELETE', { id: g.id }); dropViewers(g.id);
    }
    for (const [cid, m] of voice) if (m.has(u.id)) leaveVoice(u.id, cid);
    const audience = sharedAudience(u.id);
    for (const gid of all('SELECT guild_id FROM members WHERE user_id=?', u.id).map(r => r.guild_id)) removeMember(gid, u.id, false);
    run('DELETE FROM messages WHERE author_id=?', u.id);
    for (const dm of all('SELECT channel_id FROM dm_participants WHERE user_id=?', u.id)) run('DELETE FROM channels WHERE id=?', dm.channel_id);
    run('DELETE FROM relationships WHERE user_id=? OR other_id=?', u.id, u.id);
    for (const ws of conns.get(u.id) || []) ws.close(4001, 'conta excluída');
    run('DELETE FROM users WHERE id=?', u.id);
    userCache?.delete?.(u.id);
    dispatch(audience.filter(x => x !== u.id), 'USER_DELETE', { id: u.id });
    return true;
  }
  app.post('/api/me/delete', auth, wrap((req, res) => {
    const u = getUser(req.uid);
    if (!pwMatches(u, String(req.body.password ?? ''))) return bad(res, 'Senha incorreta', 403);
    deleteAccount(u.id);
    res.json({});
  }));
  return { deleteAccount };
}
