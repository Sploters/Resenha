import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { db, all, get, run, newId, UPLOAD_DIR, DATA_DIR, closeDb, dbProblem } from './db.js';
import { startBackups } from './backup.js';
import './parentwatch.js'; // testes: encerra junto com quem abriu (EXIT_WITH_PARENT)
// SFU no processo da voz (server/voz.js, quando o app roda como filho dele) ou neste mesmo processo: server/sfuapi.js
import { startSfu, sfuEnabled, sfuJoin, sfuLeave, sfuModerate, sfuDropVideo, sfuRequest, sfuAttachRtp, sfuLoad, sfuWorkers, sfuEvents, onSfuEvent, sfuLastVoice, sfuSplit, sfuRestore, sfuAdopt, sfuSnapshot } from './sfuapi.js';
import { mountHealth } from './health.js';
import { getAdapter, listAdapters } from './integrations/index.js';
import { createActivityService } from './activity.js';
import { createPrivacy } from './privacy.js';
import { createRemote } from './remote.js';
import { mountStatic } from './static.js';
import { mountSecurity } from './security.js';
import { createThumbs } from './thumbs.js';
import { mountStorage } from './storage.js';
import { mountMyMessages } from './mymessages.js';
import { mountMsgLog } from './msglog.js';
import { mountE2ee, isE2ee } from './e2ee.js';
import { mountUploads } from './uploads.js';
import { mountMedia } from './media.js';
import { createReputation } from './reputation.js';
import { mountDesktopUpdate } from './desktopupdate.js';
import { mountForum } from './forum.js';
import { mountDocChannel } from './docchannel.js';
import { mountMediaFavs } from './mediafavs.js';
import { mountImporter } from './importer.js';
import { mountGifs } from './gifs.js';
import { mountQrLogin } from './qrlogin.js';
import { mountPerf } from './perf.js';
import { mountUx, uxSeen, uxFirst } from './ux.js';
import { mountLfg, GAMES as LFG_GAMES } from './lfg.js';
import { mountRadar } from './radar.js';
import { mountIntents } from './intents.js';
import { mountBora } from './bora.js';
import { createPush } from './push.js';
import { createSocial, mountSocial } from './social.js';
import { createVoiceSessions } from './sessions.js';
import { initSessions } from './accounts.js';
import { mountDiscover } from './discover.js';
import { knownGame, WRAPPER_EXE } from '../public/gamecatalog.js';
import { mountGames } from './games.js';
import { mountAchievements } from './achievements.js';
import { mountEvents } from './events.js';
import { createChPerms, CH } from './chperms.js';
import { createLimits, LIMITS } from './limits.js';
import { createWatch } from './watch.js';
import { searchTracks as musicSearch, musicAvailable, listPlaylist as musicPlaylist } from './music.js';
import { initMusic, handle as musicHandle, onVoiceJoin as musicOnJoin, onVoiceLeave as musicOnLeave, stopAll as musicStopAll } from './music.js';
import { mountAuth } from './routes/auth.js';
import { mountAccount } from './routes/account.js';
import { mountGuilds } from './routes/guilds.js';
import { mountChannels } from './routes/channels.js';
import { mountInvites } from './routes/invites.js';
import { mountEmojis } from './routes/emojis.js';
import { mountMessages, mountMessageActions } from './routes/messages.js';
import { mountPolls } from './routes/polls.js';
import { mountClips } from './routes/clips.js';
import { mountDms } from './routes/dms.js';
import { mountUsers } from './routes/users.js';
import { mountTranslate } from './routes/translate.js';
import { mountUpload, mountFiles } from './routes/files.js';
import { mountNativeScreen } from './routes/nativescreen.js';
import { mountActivity } from './routes/activity.js';
import { mountVoiceSessions } from './routes/sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
// limite por arquivo: 500 MB por padrão (o envio vai em partes retomáveis; vídeo maior é comprimido no aparelho)
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
const OPEN_REGISTRATION = process.env.OPEN_REGISTRATION !== '0';
// avatares padrão (public/avatars): um é sorteado para cada conta nova
const DEFAULT_AVATARS = (() => { try { return fs.readdirSync(path.join(__dirname, '..', 'public', 'avatars')).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(f => '/avatars/' + f); } catch { return []; } })();
// quem usava um avatar padrão que foi removido ganha outro sorteado
if (DEFAULT_AVATARS.length) for (const u of all("SELECT id, avatar FROM users WHERE avatar LIKE '/avatars/%'"))
  if (!DEFAULT_AVATARS.includes(u.avatar)) run('UPDATE users SET avatar=? WHERE id=?', DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)], u.id);

const P = { ADMIN: 1, MANAGE_GUILD: 2, MANAGE_CHANNELS: 4, MANAGE_MESSAGES: 8, KICK: 16, CREATE_INVITE: 32, MANAGE_ROLES: 64, BAN: 128, MODERATE: 256, VOICE_MOD: 512, VIEW_MSGLOG: 1024 };
const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c'];

// ---------- helpers ----------
const conns = new Map(); // userId -> Set<ws>
// sessões (server/accounts.js): token guardado com hash, expiração, encerrar ao trocar a senha
const sessions = initSessions({ db, all, get, run, onRevoke: (uid, match) => { for (const ws of conns.get(uid) || []) if (match(ws.tokenHash)) ws.close(4001, 'sessão encerrada'); } });
// atividades compartilhadas da sala: lousa, editor de código e desenhos sobre as transmissões
const acts = new Map(); // channelId -> { wb: bool, code: {text, lang}|null, boards: { [board]: [{id, uid, color, w, pts}] } }
const actOf = (c) => { let a = acts.get(c); if (!a) acts.set(c, a = { wb: false, code: null, boards: {}, spot: null, spotBy: null }); return a; };
const roomSend = (c, type, d, except) => { for (const [id, st] of voice.get(c) || []) if (id !== except) send(st.ws, type, d); };
const actState = (c) => { const a = actOf(c); return { channel_id: c, wb: a.wb, code: a.code, boards: a.boards, spot: a.spot, spot_by: a.spotBy }; };
const BOARD_OK = (b) => b === 'wb' || /^s:[w-]{1,40}$/.test(b);
const voice = new Map(); // channelId -> Map<userId, {ws, mute, deaf, video, screen}>

const NAME_FONTS = ['default', 'serif', 'mono', 'rounded', 'script', 'display', 'comic', 'type'];
const NAME_EFFECTS = ['solid', 'gradient', 'neon', 'toon', 'pop', 'shimmer', 'rainbow'];
// estilo do nome vindo do cliente: só valores conhecidos e cores hex
const cleanNameStyle = (v) => {
  if (!v || typeof v !== 'object') return null;
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
  const s = { font: NAME_FONTS.includes(v.font) ? v.font : 'default', effect: NAME_EFFECTS.includes(v.effect) ? v.effect : 'solid', c1: hex(v.c1, '#ffffff'), c2: hex(v.c2, hex(v.c1, '#ffffff')) };
  return s.font === 'default' && s.effect === 'solid' && !hex(v.c1) ? null : s;
};
const parseNameStyle = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const cleanPos = (v) => (/^\d{1,3}(\.\d{1,2})?,\d{1,3}(\.\d{1,2})?,[1-3](\.\d{1,2})?$/.test(String(v)) ? String(v) : null);
// só as colunas que o perfil público usa (sem senha, configurações etc.): consultas de muitas pessoas leem menos
const PUB_COLS = 'id,username,display_name,avatar,color,banner_color,banner,avatar_pos,banner_pos,pronouns,status_emoji,theme_primary,theme_accent,name_style,bio,custom_status,created_at,status';
const privacy = createPrivacy({ get, all });
// status de verdade (online/ausente/não perturbe), sem olhar a privacidade
const realStatus = (u) => (conns.has(u.id) || u.username?.startsWith('bot_music_')) ? (u.status === 'invisible' ? 'offline' : u.status) : 'offline';
// status que `viewer` pode ver: quem escolheu esconder dele aparece offline
const statusFor = (viewer, u) => (privacy.presenceVisible(viewer, u.id) ? realStatus(u) : 'offline');
// de onde a pessoa está conectada agora (app desktop, celular, navegador): some junto com o status (offline/invisível/escondido)
const PLATS = ['desktop', 'mobile', 'web'];
const platformsOf = (u) => { if (realStatus(u) === 'offline') return []; const k = new Set([...(conns.get(u.id) || [])].map(w => w.devKind || (w.app ? 'desktop' : 'web'))); return PLATS.filter(p => k.has(p)); };
const platformsFor = (viewer, u) => (statusFor(viewer, u) === 'offline' ? [] : platformsOf(u));
const platKey = new Map(); // uid -> plataformas já avisadas (só avisa de novo quando muda)
const pubUser = (u) => u && ({
  id: u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar, color: u.color,
  banner_color: u.banner_color, banner: u.banner, avatar_pos: u.avatar_pos, banner_pos: u.banner_pos, pronouns: u.pronouns, status_emoji: u.status_emoji, theme_primary: u.theme_primary, theme_accent: u.theme_accent, name_style: parseNameStyle(u.name_style),
  bio: u.bio, custom_status: u.custom_status, created_at: u.created_at,
  // quem esconde a presença aparece offline em tudo que vai para todo mundo (mensagens, perfis…); quem pode ver recebe o
  // status de verdade à parte (READY e USER_UPDATE, por pessoa: ver statusFor)
  status: privacy.restricted(u.id) ? 'offline' : realStatus(u),
  platforms: privacy.restricted(u.id) ? [] : platformsOf(u),
});
const getUser = (id) => get('SELECT * FROM users WHERE id=?', id);
const userPub = (id) => pubUser(getUser(id));

function send(ws, type, d) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: type, d })); }
// ---- cache do que todo mundo pede igual na abertura (READY) ----
// A parte de cada servidor que é igual para todos (canais, cargos, membros, emojis, sons) e o perfil público de cada
// pessoa ficam prontos em texto. Nunca entrega dado velho: qualquer evento que muda o servidor/a pessoa passa pelo
// dispatch e descarta o guardado; por segurança, nada vale mais que 30 s (servidor) / 60 s (pessoa).
// Quem está em cada sala de voz, não lidas, DMs e status (online/ausente) são calculados na hora, a cada abertura.
const GUILD_EVENTS = new Set(['GUILD_CREATE', 'GUILD_UPDATE', 'GUILD_DELETE', 'CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE', 'CHANNELS_ORDER', 'ROLE_UPDATE', 'ROLE_DELETE',
  'MEMBER_ADD', 'MEMBER_REMOVE', 'MEMBER_UPDATE', 'EMOJIS_UPDATE', 'SOUNDS_UPDATE', 'CHANNEL_PERMS']);
const guildCache = new Map(), userCache = new Map();
function invalidateFor(type, d) {
  if (GUILD_EVENTS.has(type)) { const gid = d?.guild_id || (type.startsWith('GUILD_') ? d?.id : null); if (gid) guildCache.delete(gid); else guildCache.clear(); }
  else if (type === 'USER_UPDATE' || type === 'USER_DELETE') userCache.delete(d?.id);
}
function guildCached(gid) {
  let c = guildCache.get(gid);
  if (!c || Date.now() - c.at > 30e3) {
    const g = guildFull(gid, { users: false }); if (!g) return null;
    delete g.voice_states;
    c = { at: Date.now(), obj: g, head: JSON.stringify(g).slice(0, -1) };
    if (g.members.length >= READY_LARGE) { const { members, ...rest } = g; c.headNoMembers = JSON.stringify(rest).slice(0, -1); }
    guildCache.set(gid, c);
  }
  return c;
}
// perfil público em texto com o status de agora (o status muda o tempo todo; o resto quase nunca)
function userJson(u, viewer) {
  let c = userCache.get(u.id);
  if (!c || Date.now() - c.at > 60e3) { const p = pubUser(u); delete p.status; delete p.platforms; c = { at: Date.now(), head: JSON.stringify(p).slice(0, -1) }; userCache.set(u.id, c); }
  return c.head + ',"status":' + JSON.stringify(statusFor(viewer, u)) + ',"platforms":' + JSON.stringify(platformsFor(viewer, u)) + '}';
}
// os guardados vencidos saem de vez (antes ficava um por pessoa/servidor já visto, para sempre, num servidor ligado por meses)
setInterval(() => { const t = Date.now(); for (const [k, c] of guildCache) if (t - c.at > 30e3) guildCache.delete(k); for (const [k, c] of userCache) if (t - c.at > 60e3) userCache.delete(k); }, 5 * 60e3).unref();

// o mesmo evento para muita gente: vira texto (JSON) uma vez só, não uma vez por pessoa (1000 pessoas no servidor = 1000x)
// o texto do canal de documento vai só no GET /doc e no CHANNEL_DOC (não pesa na abertura nem a cada mudança do canal)
const noDoc = (c) => { if (!c || c.doc === undefined) return c; const { doc, ...rest } = c; return rest; };
function dispatch(userIds, type, d) {
  if (type === 'CHANNEL_CREATE' || type === 'CHANNEL_UPDATE') d = noDoc(d);
  invalidateFor(type, d);
  // já em bytes (UTF-8) uma vez só: mandar texto fazia a biblioteca converter de novo para cada pessoa; pequenas não
  // passam pela compressão (fila do zlib) — com 1000 pessoas, ~30 mil envios por segundo (teste de carga, scripts/load)
  let raw = null, opts = null;
  for (const id of new Set(userIds)) for (const ws of conns.get(id) || []) {
    if (ws.readyState !== 1) continue;
    // conexão que não consegue ler (internet ruim, aparelho travado): passou de 8 MB acumulados, fecha; o app reconecta
    // sozinho e recebe tudo atualizado no READY (sem isso a memória do servidor crescia sem limite)
    if (ws.bufferedAmount > 8 << 20) { ws.terminate(); continue; }
    if (!raw) { raw = Buffer.from(JSON.stringify({ t: type, d })); opts = { binary: false, compress: raw.length >= 1024 }; }
    ws.send(raw, opts);
  }
}
const guildMemberIds = (gid) => all('SELECT user_id FROM members WHERE guild_id=?', gid).map(r => r.user_id);
const channelAudience = (ch) => ch.guild_id ? guildMemberIds(ch.guild_id)
  : all('SELECT user_id FROM dm_participants WHERE channel_id=?', ch.id).map(r => r.user_id);

function memberPerms(gid, uid) {
  const g = get('SELECT owner_id FROM guilds WHERE id=?', gid);
  if (!g) return 0;
  if (g.owner_id === uid) return 0xffffff;
  if (!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid)) return 0;
  let p = 0;
  for (const r of all('SELECT r.perms FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.guild_id=? AND mr.user_id=?', gid, uid)) p |= r.perms;
  return (p & P.ADMIN) ? 0xffffff : p;
}
const can = (gid, uid, bit) => (memberPerms(gid, uid) & bit) !== 0;
// hierarquia de cargos: cada um vale o cargo mais alto que tem (posições 1..n, a maior em cima); o dono fica acima de todos.
// Expulsar, banir, castigar, mudar apelido e mexer em cargos só valem para baixo (como no Discord).
const OWNER_RANK = 1e9;
function rankOf(gid, uid) {
  if (get('SELECT owner_id o FROM guilds WHERE id=?', gid)?.o === uid) return OWNER_RANK;
  return get('SELECT MAX(r.position) p FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.guild_id=? AND mr.user_id=?', gid, uid)?.p || 0;
}
const outranks = (gid, actor, target) => actor !== target && rankOf(gid, actor) > rankOf(gid, target);
const ABOVE = 'Essa pessoa tem um cargo igual ou acima do seu';
const ROLE_ABOVE = 'Esse cargo é igual ou acima do seu cargo mais alto';
const tx = (fn) => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
// posições contíguas 1..n mantendo a ordem (cargos antigos nasciam com Date.now() % 100000)
function renumberRoles(gid) {
  const rs = all('SELECT id FROM roles WHERE guild_id=? ORDER BY position ASC, id ASC', gid);
  rs.forEach((r, i) => run('UPDATE roles SET position=? WHERE id=?', i + 1, r.id));
}
if (!get("SELECT 1 x FROM meta WHERE k='roles-position-1'")) tx(() => {
  for (const { guild_id } of all('SELECT DISTINCT guild_id FROM roles')) renumberRoles(guild_id);
  run("INSERT INTO meta VALUES('roles-position-1',?)", String(Date.now()));
});
const chp = createChPerms({ db, all, get, run, memberPerms, P }); // permissões por canal/categoria (server/chperms.js)
// castigo: não fala, não reage, não entra em voz
const timedOut = (gid, uid) => !!gid && (get('SELECT timeout_until t FROM members WHERE guild_id=? AND user_id=?', gid, uid)?.t || 0) > Date.now();
function audit(gid, actor, action, target = null, details = '') {
  run('INSERT INTO audit_log(id,guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)', newId(), gid, actor, action, target, String(details).slice(0, 500), Date.now());
}
// registro de auditoria guardado por 45 dias (como no Discord; AUDIT_DAYS muda): o que passou disso é apagado ao subir e a cada 6 h,
// e a leitura já não mostra o que venceu entre uma limpeza e outra
const AUDIT_DAYS = Math.max(1, +process.env.AUDIT_DAYS || 45), auditSince = () => Date.now() - AUDIT_DAYS * 864e5;
const pruneAudit = () => run('DELETE FROM audit_log WHERE created_at < ?', auditSince());
pruneAudit(); setInterval(pruneAudit, 6 * 3600e3).unref();
const reputation = createReputation({ db, all, get, run, newId, can, P, dispatch, guildMemberIds, memberObj, audit });
// limite de mensagens: rajada de 5, recarrega 1 a cada 0,8 s
const buckets = new Map();
function rateOk(uid) {
  const now = Date.now(), b = buckets.get(uid) || { n: 5, t: now };
  b.n = Math.min(5, b.n + (now - b.t) / 800); b.t = now;
  if (b.n < 1) { buckets.set(uid, b); return false; }
  b.n -= 1; buckets.set(uid, b); return true;
}
setInterval(() => { const old = Date.now() - 60000; for (const [k, b] of buckets) if (b.t < old) buckets.delete(k); }, 60000).unref();

function memberObj(gid, uid) {
  const m = get('SELECT * FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  if (!m) return null;
  return { user_id: uid, nickname: m.nickname, joined_at: m.joined_at, timeout_until: m.timeout_until > Date.now() ? m.timeout_until : null,
    softmute_until: m.softmute_until > Date.now() ? m.softmute_until : null,
    roles: all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid).map(r => r.role_id) };
}
const roomStart = new Map(); // channelId -> quando a sala deixou de estar vazia (cronômetro da chamada)
const VOICE_FX = new Set(['robo', 'grossa', 'esquilo', 'monstro', 'alien', 'radio', 'megafone', 'eco', 'estadio']);
const vsObj = (cid, uid, s) => ({ channel_id: cid, user_id: uid, mute: s.mute, deaf: s.deaf, ...(s.modMute ? { mod_mute: true } : {}), ...(s.modDeaf ? { mod_deaf: true } : {}), ...(s.noSpeak ? { no_speak: true } : {}), ...(s.noVideo ? { no_video: true } : {}), ...(s.hold ? { hold: true } : {}), ...(s.mirror ? { mirror: true } : {}), video: s.video, screen: s.screen, screen_note: s.screenNote || null, ...(s.screen && s.screenTitle ? { screen_title: s.screenTitle } : {}), watching: !!s.watching, ...(s.wt ? { wt: true } : {}), fx: s.fx || null, app: s.ws?.app || null, started_at: roomStart.get(cid), ...(s.bot ? { bot: s.bot } : {}) });
// versão do app desktop: quem está na call vê quem está desatualizado; abaixo da mínima não entra na call
// (mínima: DESKTOP_MIN_VERSION ou o arquivo <dados>/desktop-min-version.txt; sem nada, não há mínima)
const VER_RE = /^\d+\.\d+\.\d+$/;
const olderVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
function desktopMin() {
  let v = process.env.DESKTOP_MIN_VERSION || '';
  if (!v) try { v = fs.readFileSync(path.join(DATA_DIR, 'desktop-min-version.txt'), 'utf8'); } catch { }
  v = String(v).trim().replace(/^v/i, ''); return VER_RE.test(v) ? v : null;
}
function voiceStatesFor(gid) {
  const out = [];
  for (const [cid, m] of voice) {
    const ch = get('SELECT guild_id FROM channels WHERE id=?', cid);
    if (ch && ch.guild_id === gid) for (const [uid, s] of m) out.push(vsObj(cid, uid, s));
  }
  return out;
}
// servidor completo (abertura e GUILD_CREATE): membros, cargos e pessoas em 3 consultas no total, não 3 por membro.
// users: false = sem a lista de pessoas (o READY manda cada pessoa uma vez só, mesmo que esteja em vários servidores).
function guildFull(gid, { users = true } = {}) {
  const g = get('SELECT * FROM guilds WHERE id=?', gid);
  if (!g) return null;
  const rolesOf = new Map();
  for (const r of all('SELECT user_id, role_id FROM member_roles WHERE guild_id=?', gid)) { let l = rolesOf.get(r.user_id); if (!l) rolesOf.set(r.user_id, l = []); l.push(r.role_id); }
  const now = Date.now();
  const members = all('SELECT user_id, nickname, joined_at, timeout_until, softmute_until FROM members WHERE guild_id=?', gid).map(m => ({ user_id: m.user_id, nickname: m.nickname, joined_at: m.joined_at,
    timeout_until: m.timeout_until > now ? m.timeout_until : null, softmute_until: m.softmute_until > now ? m.softmute_until : null, roles: rolesOf.get(m.user_id) || [] }));
  return { ...g,
    roles: all('SELECT * FROM roles WHERE guild_id=? ORDER BY position DESC', gid),
    channels: all('SELECT * FROM channels WHERE guild_id=? AND type<>11 ORDER BY position, created_at', gid).map(noDoc), // posts de fórum (11) vêm sob demanda
    members,
    emojis: all('SELECT id,name,url FROM emojis WHERE guild_id=?', gid),
    sounds: all('SELECT id,name,emoji,url,volume FROM sounds WHERE guild_id=? ORDER BY created_at', gid),
    channel_perms: chp.guildOverwrites(gid),
    users: users ? all('SELECT u.* FROM users u JOIN members m ON m.user_id=u.id WHERE m.guild_id=?', gid).map(pubUser) : [],
    voice_states: voiceStatesFor(gid) };
}

let eventsSvc = null; // server/events.js (montado mais abaixo)
function messageObj(m) {
  const rx = {};
  for (const r of all('SELECT emoji,user_id FROM reactions WHERE message_id=?', m.id)) (rx[r.emoji] ||= []).push(r.user_id);
  const reply = m.reply_to ? get('SELECT id,content,author_id FROM messages WHERE id=?', m.reply_to) : null;
  return { id: m.id, channel_id: m.channel_id, author_id: m.author_id, author: userPub(m.author_id),
    content: m.content, type: m.type || 0, created_at: m.created_at, edited_at: m.edited_at, pinned: !!m.pinned,
    ...(m.spoiler_by ? { spoiler: true, spoiler_by_mod: m.spoiler_by !== m.author_id } : {}),
    ...(m.fwd ? { forwarded: JSON.parse(m.fwd) } : {}),
    ...(m.imp ? { imported: { ...JSON.parse(m.imp), batch: m.imp_batch } } : {}), // importada do Discord (server/importer.js)
    attachments: JSON.parse(m.attachments || '[]'),
    reply: reply ? { id: reply.id, content: isE2ee(reply.content) ? reply.content : (reply.content || '').slice(0, 120), author: userPub(reply.author_id) } : (m.reply_to ? { id: m.reply_to, deleted: true } : null),
    reactions: Object.entries(rx).map(([emoji, users]) => ({ emoji, users })),
    ...((m.content || '').startsWith('📊') ? { poll: pollObj(get('SELECT * FROM polls WHERE message_id=?', m.id)) } : {}),
    ...((m.content || '').startsWith('📅') && eventsSvc ? eventsSvc.ofMessage(m.id) : {}), // anúncio de evento (server/events.js)
    ...(m.attachments && m.attachments.includes('video/') ? clipOfMessage(m.id) : {}) };
}
// mensagem de clipe: o chat mostra um cartão leve (miniatura + título) em vez do player; o vídeo fica na galeria
function clipOfMessage(mid) {
  const c = get('SELECT id, title, secs, url, has_audio, streamer_id FROM clips WHERE message_id=?', mid);
  return c ? { clip: { id: c.id, title: c.title, secs: c.secs, url: c.url, has_audio: !!c.has_audio, streamer_id: c.streamer_id } } : {};
}
// enquete: opções com quem votou em cada uma; encerrada pelo autor/moderador ou pelo prazo
function pollObj(p) {
  if (!p) return undefined;
  const votes = all('SELECT user_id, option_id FROM poll_votes WHERE poll_id=? ORDER BY voted_at', p.id);
  const opts = JSON.parse(p.options).map(o => ({ ...o, voters: votes.filter(v => v.option_id === o.id).map(v => v.user_id) }));
  return { id: p.id, question: p.question, multi: !!p.multi, ends_at: p.ends_at, author_id: p.author_id,
    closed: !!p.closed_at || (p.ends_at && p.ends_at <= Date.now()), closed_at: p.closed_at || (p.ends_at && p.ends_at <= Date.now() ? p.ends_at : null),
    voters: new Set(votes.map(v => v.user_id)).size, options: opts };
}
function canAccessChannel(uid, ch) {
  if (!ch) return false;
  if (ch.guild_id) return !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, uid);
  return !!get('SELECT 1 x FROM dm_participants WHERE channel_id=? AND user_id=?', ch.id, uid);
}
// last_message: prévia e ordem da lista de Mensagens (só o começo do texto)
const lastDmMsg = (cid) => { const m = get('SELECT id, author_id, substr(content,1,140) content, created_at, attachments FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT 1', cid); return m ? { id: m.id, author_id: m.author_id, content: m.content || '', created_at: m.created_at, attachment: m.attachments && m.attachments !== '[]' } : null; };
const dmChannelObj = (ch) => ({ ...ch, recipients: all('SELECT user_id FROM dm_participants WHERE channel_id=?', ch.id).map(r => userPub(r.user_id)), last_message: lastDmMsg(ch.id) });
const relObj = (uid) => all('SELECT * FROM relationships WHERE user_id=?', uid).map(r => ({ user: userPub(r.other_id), type: r.type, since: r.since || null }));

function sharedAudience(uid) {
  const ids = new Set([uid]);
  for (const r of all('SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.guild_id=m2.guild_id WHERE m1.user_id=?', uid)) ids.add(r.user_id);
  for (const r of all('SELECT other_id FROM relationships WHERE user_id=?', uid)) ids.add(r.other_id);
  for (const r of all('SELECT p2.user_id FROM dm_participants p1 JOIN dm_participants p2 ON p1.channel_id=p2.channel_id WHERE p1.user_id=?', uid)) ids.add(r.user_id);
  return [...ids];
}
// ---- presença (entrou/saiu/trocou de aparelho) só para quem vai mostrar ----
// Antes cada entrada/saída mandava o perfil inteiro para todos os membros de todos os servidores da pessoa. Agora o app
// avisa qual servidor está olhando (VIEW; nenhum com a janela escondida) e o aviso, pequeno (PRESENCE), vai para: a
// própria pessoa, amigos, conversas diretas e quem está olhando um servidor dela. Ao abrir um servidor, o app recebe
// quem está online nele (PRESENCE_SYNC). Conexão que nunca mandou VIEW (app antigo aberto durante uma atualização)
// continua recebendo tudo como antes (USER_UPDATE).
const viewers = new Map(); // guildId -> Set<ws>
function setView(ws, gid) {
  if (ws.view !== undefined && ws.view !== null) { const v = viewers.get(ws.view); v?.delete(ws); if (v && !v.size) viewers.delete(ws.view); }
  ws.view = gid;
  if (gid) (viewers.get(gid) || viewers.set(gid, new Set()).get(gid)).add(ws);
}
const dropViewers = (gid) => { for (const ws of [...(viewers.get(gid) || [])]) setView(ws, null); }; // servidor apagado
function presenceSync(ws, gid) {
  const rows = all('SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=?', gid), out = [];
  for (const u of rows) { const st = statusFor(ws.uid, u); if (st !== 'offline') out.push([u.id, st, platformsFor(ws.uid, u)]); }
  send(ws, 'PRESENCE_SYNC', { guild_id: gid, online: out });
}
function sendRaw(list, type, d) { // como o dispatch, mas para conexões escolhidas
  let raw = null;
  for (const ws of list) { if (ws.readyState !== 1) continue; if (ws.bufferedAmount > 8 << 20) { ws.terminate(); continue; } raw ||= Buffer.from(JSON.stringify({ t: type, d })); ws.send(raw, { binary: false, compress: false }); }
}
function broadcastStatus(uid) {
  const t0 = performance.now(), u = getUser(uid); if (!u) return;
  if (conns.has(uid)) platKey.set(uid, platformsOf(u).join()); else platKey.delete(uid);
  const direct = new Set([uid]);
  for (const r of all('SELECT other_id FROM relationships WHERE user_id=?', uid)) direct.add(r.other_id);
  for (const r of all('SELECT p2.user_id FROM dm_participants p1 JOIN dm_participants p2 ON p1.channel_id=p2.channel_id WHERE p1.user_id=?', uid)) direct.add(r.user_id);
  const gids = all('SELECT guild_id FROM members WHERE user_id=?', uid).map(r => r.guild_id);
  const targets = new Set(), legacy = new Set();
  for (const id of direct) for (const ws of conns.get(id) || []) (ws.view === undefined ? legacy : targets).add(ws);
  for (const gid of gids) for (const ws of viewers.get(gid) || []) targets.add(ws);
  if (legacyConns.size) { // app antigo: todos os membros dos servidores dela, como antes
    const members = new Set(gids.length ? all(`SELECT DISTINCT user_id FROM members WHERE guild_id IN (${gids.map(() => '?').join(',')})`, ...gids).map(r => r.user_id) : []);
    for (const ws of legacyConns) if (members.has(ws.uid)) legacy.add(ws);
  }
  const by = (ws) => privacy.restricted(uid) && !privacy.presenceVisible(ws.uid, uid);
  const real = { id: uid, status: realStatus(u), platforms: platformsOf(u) }, hidden = { id: uid, status: 'offline', platforms: [] };
  const tv = [...targets], lv = [...legacy];
  sendRaw(tv.filter(w => !by(w)), 'PRESENCE', real); sendRaw(tv.filter(by), 'PRESENCE', hidden);
  if (lv.length) { const pu = pubUser(u); invalidateFor('USER_UPDATE', pu); sendRaw(lv.filter(w => !by(w)), 'USER_UPDATE', { ...pu, ...real }); sendRaw(lv.filter(by), 'USER_UPDATE', { ...pu, ...hidden }); }
  mountPerf.time?.(`WS aviso de presença (${tv.length + lv.length > 500 ? '500+' : tv.length + lv.length > 100 ? '100+' : '<100'} conexões)`, performance.now() - t0);
}
const legacyConns = new Set(); // conexões que ainda não mandaram VIEW
const broadcastPresence = (uid) => { const t0 = performance.now(), to = sharedAudience(uid), u = getUser(uid), pu = pubUser(u); if (!u) return;
  if (conns.has(uid)) platKey.set(uid, platformsOf(u).join()); else platKey.delete(uid);
  if (!privacy.restricted(uid)) dispatch(to, 'USER_UPDATE', pu);
  else { // quem pode ver recebe o status de verdade; os outros, offline
    const see = to.filter(v => privacy.presenceVisible(v, uid)), hide = to.filter(v => !privacy.presenceVisible(v, uid));
    if (see.length) dispatch(see, 'USER_UPDATE', { ...pu, status: realStatus(u), platforms: platformsOf(u) });
    if (hide.length) dispatch(hide, 'USER_UPDATE', pu);
  } mountPerf.time?.(`WS aviso de presença (${to.length > 500 ? '500+' : to.length > 100 ? '100+' : '<100'} pessoas)`, performance.now() - t0); };


// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
mountSecurity(app, { publicDir: path.join(__dirname, '..', 'public') }); // CSP da página e cabeçalhos de segurança (server/security.js)
app.use(express.json({ limit: '1mb' }));

const auth = (req, res, next) => {
  const s = sessions.lookup((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!s) return res.status(401).json({ error: 'Não autenticado' });
  req.uid = s.user_id; req.tokenHash = s.hash; next();
};
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); } };
const wrapA = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const lim = createLimits({ get }); // limites de conta e de servidor (server/limits.js)
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
// compressão da API, tempo de cada rota (lentas em <dados>/slow.log) e velocidade real de quem usa (server/perf.js)
mountPerf(app, { auth, wrap, bad, dataDir: DATA_DIR, isAdmin: (uid) => reportAdmin()?.id === uid, notifyAdmin: (text) => { const a = reportAdmin(); if (a) dispatch([a.id], 'ADMIN_ALERT', { text }); } });
// métricas sociais (server/social.js): encontros, retornos e convites; mesma regra de privacidade da telemetria
const social = createSocial({ db, all, get, run, optedOut: (uid) => { try { return JSON.parse(getUser(uid)?.settings || '{}')?.uxStats === false; } catch { return false; } }, isOnline: (uid) => conns.has(uid) });
mountSocial(app, { auth, wrap, bad, isAdmin: (uid) => reportAdmin()?.id === uid, social });
mountUx(app, { auth, wrap, bad, isAdmin: (uid) => reportAdmin()?.id === uid, prefsOf: (uid) => { const s = getUser(uid)?.settings; return s ? JSON.parse(s) : {}; },
  sendDigest: (d) => { // resumo da semana: no app do administrador e, com webhook, no celular (ntfy ou canal do Discord)
    const a = reportAdmin(); if (a) dispatch([a.id], 'ADMIN_DIGEST', { titulo: d.titulo, texto: d.texto });
    const hook = process.env.UX_DIGEST_WEBHOOK || process.env.ALERT_WEBHOOK; if (!hook) return;
    const discord = /discord(app)?\.com\/api\/webhooks\//.test(hook);
    fetch(hook, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': discord ? 'application/json' : 'text/plain; charset=utf-8', ...(discord ? {} : { Title: 'Resenha: resumo da semana', Tags: 'bar_chart' }) },
      body: discord ? JSON.stringify({ content: '📊 ' + d.texto.slice(0, 1900) }) : d.texto }).catch(() => { });
  } }); // telemetria de UX: só contagens, sem quem fez
// endereço de arquivo enviado (/files/..., sem aspas, barras invertidas nem espaços: esses valores
// vão parar em url("...") no CSS e em atributos; com aspas dava para fechar o url() e injetar CSS)
const isFileUrl = (v) => typeof v === 'string' && /^\/files\/[^\s"\\<>]{1,700}$/.test(v);
const cssColor = (v) => { const x = clean(v, 9); return !x || /^#[0-9a-f]{3,8}$/i.test(x) ? x : null; }; // só #rgb/#rrggbb(aa)

// ---- ajudantes usados por mais de um módulo de rotas (server/routes/*) ----
// sai do servidor (ou é expulso/banido): sai da voz de lá, avisa os membros e para de receber a presença dele
function removeMember(gid, uid, kicked) {
  for (const [cid, m] of voice) if (m.has(uid) && get('SELECT 1 x FROM channels WHERE id=? AND guild_id=?', cid, gid)) leaveVoice(uid, cid);
  const ids = guildMemberIds(gid);
  run('DELETE FROM member_roles WHERE guild_id=? AND user_id=?', gid, uid);
  run('DELETE FROM members WHERE guild_id=? AND user_id=?', gid, uid);
  dispatch(ids, 'MEMBER_REMOVE', { guild_id: gid, user_id: uid });
  dispatch([uid], 'GUILD_DELETE', { id: gid, kicked });
  for (const ws of conns.get(uid) || []) if (ws.view === gid) setView(ws, null); // fora do servidor: para de receber a presença dele
}
// entra no servidor: membro novo, avisa os membros, manda o servidor para quem entrou e a mensagem de boas-vindas
function joinGuild(gid, uid) {
  run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', gid, uid, Date.now());
  dispatch(guildMemberIds(gid).filter(x => x !== uid), 'MEMBER_ADD', { guild_id: gid, member: memberObj(gid, uid), user: userPub(uid) });
  dispatch([uid], 'GUILD_CREATE', guildFull(gid));
  const gen = get("SELECT id FROM channels WHERE guild_id=? AND type=0 ORDER BY position LIMIT 1", gid);
  if (gen) { // mensagem de sistema de boas-vindas
    const mid = newId();
    run("INSERT INTO messages(id,channel_id,author_id,content,created_at,type) VALUES(?,?,?,?,?,1)", mid, gen.id, uid, 'entrou no servidor.', Date.now());
    const ch = get('SELECT * FROM channels WHERE id=?', gen.id);
    dispatch(channelAudience(ch), 'MESSAGE_CREATE', { ...messageObj(get('SELECT * FROM messages WHERE id=?', mid)), guild_id: ch.guild_id, mentions: [] });
  }
}
const channelFor = (req, res) => {
  const ch = get('SELECT * FROM channels WHERE id=?', req.params.id);
  if (!canAccessChannel(req.uid, ch)) { bad(res, 'Canal não encontrado', 404); return null; }
  return ch;
};
// apaga o arquivo do disco se nada mais usa (mensagens, perfis, emojis, sons, servidores, clipes)
function unlinkIfUnused(url) {
  const fname = path.basename(String(url).split('/')[2] || '');
  const like = '%' + fname.replace(/[%_\\]/g, '\\$&') + '%', used = (sql) => get(sql + " LIKE ? ESCAPE '\\'", like);
  const usedOpt = (sql) => { try { return used(sql); } catch { return true; } }; // tabela de um módulo que pode não existir ainda: na dúvida, não apaga
  if (fname && !used('SELECT 1 x FROM messages WHERE attachments') && !used('SELECT 1 x FROM users WHERE avatar') && !used('SELECT 1 x FROM users WHERE banner') && !used('SELECT 1 x FROM users WHERE settings')
    && !used('SELECT 1 x FROM emojis WHERE url') && !used('SELECT 1 x FROM sounds WHERE url') && !used('SELECT 1 x FROM guilds WHERE icon') && !used('SELECT 1 x FROM guilds WHERE banner') && !used('SELECT 1 x FROM clips WHERE url') && !usedOpt('SELECT 1 x FROM events WHERE banner') && !usedOpt('SELECT 1 x FROM media_favs WHERE url')) { fs.unlink(path.join(UPLOAD_DIR, fname), () => { }); thumbs.remove(fname); }
}
// administrador da instalação (LC_ADMIN = nome de usuário; sem isso, a conta mais antiga): recebe os relatórios de problema
const reportAdmin = () => (process.env.LC_ADMIN && get('SELECT id FROM users WHERE username=?', process.env.LC_ADMIN)) || get('SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1');
// Falar/Vídeo por canal valem ao vivo: mudou ajuste de canal, cargo ou cargos de alguém → recalcula quem está nas salas
// do servidor. Sem Falar: o SFU pausa o microfone (como o mute da moderação). Sem Vídeo: fecha câmera e tela.
function voicePermsOf(ch, uid) { return ch?.guild_id ? { noSpeak: !chp.chCan(ch, uid, CH.SPEAK), noVideo: !chp.chCan(ch, uid, CH.VIDEO) } : { noSpeak: false, noVideo: false }; }
function refreshVoicePerms(gid) {
  for (const [cid, room] of voice) {
    const ch = get('SELECT * FROM channels WHERE id=? AND guild_id=?', cid, gid); if (!ch) continue;
    for (const [uid, st] of room) {
      if (st.bot) continue;
      const { noSpeak, noVideo } = voicePermsOf(ch, uid);
      if (noSpeak === !!st.noSpeak && noVideo === !!st.noVideo) continue;
      st.noSpeak = noSpeak; st.noVideo = noVideo;
      sfuModerate(cid, uid, { mute: !!st.modMute || noSpeak });
      if (noVideo) { sfuDropVideo(cid, uid); if (natives.has(uid)) endNative(uid, 'no_video'); st.video = false; st.screen = false; }
      dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(cid, uid, st), guild_id: gid });
    }
  }
}
// o que as rotas de server/routes/* recebem (cada módulo pega só o que usa). Serviços criados mais abaixo (activity, forum,
// intents, clips, thumbs) vão à parte, por getter, para serem lidos só na hora da requisição.
// registro de mensagens editadas/excluídas nos servidores (server/msglog.js); vai às rotas em core.msglog
const msglog = mountMsgLog(app, { auth, wrap, bad, db, all, get, run, newId, can, P, userPub, audit });
const core = {
  msglog,
  auth, wrap, wrapA, bad, clean, lim, db, all, get, run, newId, tx, P, CH, chp, can, memberPerms, rankOf, outranks, ABOVE, ROLE_ABOVE,
  dispatch, send, guildMemberIds, channelAudience, canAccessChannel, channelFor, getUser, userPub, pubUser, messageObj, audit, timedOut, rateOk,
  conns, voice, leaveVoice, currentVoice, isFileUrl, cssColor, privacy, statusFor, platformsFor, social, sessions, reputation,
  removeMember, joinGuild, unlinkIfUnused, reportAdmin, refreshVoicePerms, UPLOAD_DIR, DATA_DIR,
};
const { ipLimited } = mountAuth(app, { ...core, OPEN_REGISTRATION, COLORS, DEFAULT_AVATARS }); // registro, login e logout (server/routes/auth.js)
mountQrLogin(app, { auth, wrap, bad, run, userPub, ipLimited, clean, createSession: sessions.create }); // entrar lendo um QR Code com o celular já logado (server/qrlogin.js)

mountAccount(app, { ...core, cleanPos, cleanNameStyle, DEFAULT_AVATARS, broadcastPresence, userCache, dropViewers, sharedAudience, get activity() { return activity; } }); // a própria conta (server/routes/account.js)
mountGuilds(app, { ...core, renumberRoles, guildFull, memberObj, vsObj, auditSince, AUDIT_DAYS, dropViewers, get activity() { return activity; } }); // servidores, membros e cargos (server/routes/guilds.js)
mountChannels(app, { ...core, get forum() { return forum; }, get intents() { return intents; } }); // canais e permissões (server/routes/channels.js)
// aviso no celular (ntfy) para quem configurou: "Bora?" e convite direto para a chamada (server/push.js)
const prefsOfUser = (uid) => { try { return JSON.parse(getUser(uid)?.settings || '{}') || {}; } catch { return {}; } };
const push = createPush({ prefsOf: prefsOfUser, isOnline: (uid) => conns.has(uid), statusOf: (uid) => getUser(uid)?.status || 'online' });
app.post('/api/me/push-test', auth, wrap((req, res) => { push.test(req.uid, String(req.body?.topic || '')).then(() => res.json({ ok: true, server: push.server() }), (e) => { if (!res.headersSent) res.status(400).json({ error: e.message }); }); }));
const { callInv } = mountInvites(app, { ...core, postDm: (a, b, c) => postDm(a, b, c), get activity() { return activity; }, push }); // convites do servidor e da chamada (server/routes/invites.js)
mountEmojis(app, core); // emojis e soundboard (server/routes/emojis.js)
mountMessages(app, { ...core, get forum() { return forum; }, get clips() { return clips; } }); // mensagens, busca e caixa de entrada (server/routes/messages.js)
// ---------- Procurar jogadores (server/lfg.js) ----------
// quem vê os anúncios de alguém: quem divide algum servidor com a pessoa ou é amigo dela, menos bloqueios (nos dois sentidos)
function lfgAudience(uid) {
  const ids = new Set([uid]);
  for (const r of all('SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.guild_id=m2.guild_id WHERE m1.user_id=?', uid)) ids.add(r.user_id);
  for (const r of all('SELECT other_id FROM relationships WHERE user_id=? AND type=1', uid)) ids.add(r.other_id);
  for (const r of all('SELECT other_id id FROM relationships WHERE user_id=? AND type=2 UNION SELECT user_id id FROM relationships WHERE other_id=? AND type=2', uid, uid)) ids.delete(r.id);
  return [...ids];
}
mountGifs(app, { auth, wrap, bad, all, run, get, canSeeChannel: canAccessChannel, dataDir: DATA_DIR, clean });
mountLfg(app, {
  auth, wrap, bad, get, all, run, newId, dispatch, userPub, clean,
  audienceOf: lfgAudience, canSeeChannel: canAccessChannel,
  voiceCount: (cid) => voice.get(cid)?.size || 0, voiceChannelOf: (uid) => currentVoice(uid),
  callInvite: (from, to, opts) => callInv.create(from, to, opts), postDm: (a, b, c) => postDm(a, b, c),
  isMember: (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid),
  isBanned: (gid, uid) => !!get('SELECT 1 x FROM bans WHERE guild_id=? AND user_id=?', gid, uid),
  joinGuild: (gid, uid) => joinGuild(gid, uid), guildFull: (uid, other) => other ? lim.guildJoinOther(uid) : lim.guildJoin(uid),
});
mountRadar(app, { auth, wrap, wrapA, bad, get, all, run, newId, userPub, clean, audienceOf: lfgAudience, postDm: (a, b, c) => postDm(a, b, c) }); // Radar: scouting do Clash (server/radar.js)
const discover = mountDiscover(app, { auth, dataDir: DATA_DIR }); // aba Descobrir: notícias, promoções e lançamentos (server/discover.js)
mountPolls(app, { ...core, pollObj }); // enquetes (server/routes/polls.js)
const clips = mountClips(app, { ...core, get activity() { return activity; } }); // galeria de clipes (server/routes/clips.js)
const { dropClipsOfMessage, clipKeys, migrateOldClips, clipsWeekFor } = clips;
mountMessageActions(app, core); // fixar, spoiler, reações e lido (server/routes/messages.js)
const { postDm } = mountDms(app, { ...core, dmChannelObj }); // conversas diretas e relatório de problema (server/routes/dms.js)
const { friendLossesFor } = mountUsers(app, { ...core, guildCached, userJson, PUB_COLS, get activity() { return activity; } }); // amizades, bloqueios e perfis (server/routes/users.js)
mountTranslate(app, core); // tradução (server/routes/translate.js)
const { finalizeUpload } = mountUpload(app, { ...core, MAX_UPLOAD, get thumbs() { return thumbs; } }); // envio de arquivo inteiro (server/routes/files.js)
const thumbs = createThumbs(UPLOAD_DIR);
migrateOldClips();
// envio retomável em pedaços (server/uploads.js): arquivo grande que continua de onde parou se a conexão cair
mountUploads(app, { auth, wrap, bad, clean, uploadDir: UPLOAD_DIR, maxUpload: MAX_UPLOAD, finalize: finalizeUpload });
// gerenciador de armazenamento (server/storage.js): uso por pessoa/servidor/instalação, apagar mídias antigas e expiração
// aba Arquivos (server/media.js): mídias, documentos e links de um servidor ou DM numa grade, com filtros
mountMedia(app, { auth, wrap, bad, all, get, clean, maxUpload: MAX_UPLOAD });
// reputação (server/reputation.js): marcações de spam/ofensa de várias pessoas viram um soft-mute até a moderação analisar
reputation.mount(app, { auth, wrap, bad, channelFor });
// apagar as próprias mensagens em massa, com prévia e cópia antes (server/mymessages.js)
mountE2ee(app, { auth, wrap, bad, all, get, run, db, dispatch }); // chaves da criptografia de ponta a ponta das DMs
eventsSvc = mountEvents(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, guildMemberIds, can, P, userPub, clean, messageObj, timedOut, uploadDir: UPLOAD_DIR, artPrivate: process.env.EVENT_ART_PRIVATE === '1' }); // eventos do servidor com Vou/Talvez/Não vou e lembretes
const forum = mountForum(app, { auth, wrap, bad, all, get, run, db, newId, can, P, dispatch, guildMemberIds, userPub, clean, audit, isFileUrl, timedOut, rateOk, canSend: (ch, uid) => chp.chCan(ch, uid, CH.SEND) });
mountDocChannel(app, { auth, wrap, bad, db, get, run, dispatch, guildMemberIds, canAccessChannel, chCan: chp.chCan, CH, userPub, audit }); // canal de documento
mountMediaFavs(app, { auth, wrap, bad, db, all, get, run, clean, isFileUrl, dispatch, unlinkIfUnused }); // mídia favorita com categorias
mountImporter(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, channelAudience, canAccessChannel, can, P, userPub, clean, audit }); // histórico do Discord
mountMyMessages(app, { auth, wrap, bad, all, get, run, db, dispatch, channelAudience, unlinkIfUnused, dropClipsOfMessage, clean });
mountStorage(app, { auth, wrap, bad, all, get, run, can, P, dispatch, channelAudience, messageObj, unlinkIfUnused, db, uploadDir: UPLOAD_DIR,
  isAdmin: (uid) => reportAdmin()?.id === uid, removeDerived: (f) => thumbs.remove(f) });

mountFiles(app, { ...core, thumbs, clipKeys }); // /files e miniaturas de vídeo (server/routes/files.js)

const { natives, endNative, startNative, nativeOut, adoptNative } = mountNativeScreen(app, core); // transmissão nativa (server/routes/nativescreen.js)

// saúde do servidor (server/health.js): CPU, memória, disco, rede, workers do SFU, pessoas e chamadas, erros e alertas
mountHealth(app, { auth, wrap: wrapA, bad, isAdmin: (uid) => reportAdmin()?.id === uid, dataDir: DATA_DIR, uiVersion: () => ui?.version,
  sfu: { workers: sfuWorkers, load: sfuLoad, events: sfuEvents, onEvent: onSfuEvent },
  appStats: () => {
    let connections = 0, calls = 0, inCalls = 0, screens = 0, cams = 0;
    for (const set of conns.values()) connections += set.size;
    for (const room of voice.values()) { let n = 0; for (const st of room.values()) { if (st.bot) continue; n++; if (st.screen) screens++; if (st.video) cams++; } if (n) { calls++; inCalls += n; } }
    return { online: conns.size, connections, calls, inCalls, screens, cams };
  } });
// Chamada "ativa" = conversa acontecendo: 2 ou mais pessoas E (alguém falou nos últimos CALL_ACTIVE_MS, alguém entrou
// há menos que isso, ou alguém está transmitindo a tela). Pessoa sozinha, ou gente dormindo em silêncio na call, não conta:
// para ela uma queda de segundos com volta automática não faz diferença. Usado pelo deploy (só troca o servidor sem
// chamadas ativas) e pela página (só recarrega sozinha para a versão nova numa chamada parada; public/uiupdate.js).
// Sem SFU (voz P2P) o servidor não ouve ninguém: 2 ou mais pessoas contam como ativa, como antes.
const CALL_ACTIVE_MS = +process.env.CALL_ACTIVE_MS || 15 * 60e3;
function callActive(cid) {
  const room = voice.get(cid); if (!room) return false;
  let n = 0, screen = false, joined = 0;
  for (const st of room.values()) { if (st.bot) continue; n++; if (st.screen) screen = true; joined = Math.max(joined, st.at || 0); }
  if (n < 2) return false;
  if (screen || !sfuEnabled()) return true;
  return Date.now() - Math.max(sfuLastVoice(cid), joined, roomStart.get(cid) || 0) < CALL_ACTIVE_MS;
}
// quem está em chamada agora, num arquivo da pasta de dados: o deploy (deploy/umbrel.sh e deploy/trocar.sh) lê antes de
// trocar o container e espera as chamadas ATIVAS acabarem (reiniciar derruba todo mundo por ~6 s). Só contagens, sem
// nomes; atualizado a cada 10 s.
{
  const file = path.join(DATA_DIR, 'em-chamada.json');
  // Sem ninguém em chamada, só grava quando a contagem muda (antes: 8.640 gravações por dia no disco, à toa). Com gente
  // em chamada continua a cada 10 s: o deploy só confia num arquivo de menos de 60 s para esperar; com zero, segue.
  let last = '';
  const write = () => {
    // sessoes: salas com bot de música ou "assistir junto" — vivem no app, então reiniciar o app (mesmo com a voz num
    // processo próprio) as encerra; o deploy espera por elas também (deploy/servidor.sh)
    const watchOn = (cid) => { try { return watch._sessions.has(cid); } catch { return false; } }; // watch é criado mais abaixo
    let calls = 0, inCalls = 0, screens = 0, ativas = 0, emAtivas = 0, sessoes = 0;
    for (const [cid, room] of voice) {
      let n = 0, bot = false; for (const st of room.values()) { if (st.bot) { bot = true; continue; } n++; if (st.screen) screens++; }
      if (n) { calls++; inCalls += n; } if (n && callActive(cid)) { ativas++; emAtivas += n; }
      if (n && (bot || watchOn(cid))) sessoes++;
    }
    const counts = `${calls},${inCalls},${screens},${ativas},${emAtivas},${sessoes}`;
    if (!inCalls && counts === last) return;
    try { fs.writeFileSync(file + '.tmp', JSON.stringify({ t: Date.now(), calls, inCalls, screens, ativas, emAtivas, sessoes, vozSeparada: sfuSplit })); fs.renameSync(file + '.tmp', file); last = counts; } catch { }
  };
  write(); setInterval(write, 10e3).unref();
}
// a chamada de quem pergunta está parada? (public/uiupdate.js: recarregar sozinho para a versão nova sem atrapalhar)
app.get('/api/voice/quiet', auth, (req, res) => {
  const c = currentVoice(req.uid);
  res.set('Cache-Control', 'no-store').json({ in_call: !!c, quiet: !c || !callActive(c) });
});
app.get('/api/sfu/load', auth, (req, res) => { // só donos de servidor: carga do worker do mediasoup
  if (!get('SELECT 1 AS x FROM guilds WHERE owner_id=?', req.uid)) return bad(res, 'Sem permissão', 403);
  sfuLoad().then(d => res.json(d), e => bad(res, e.message, 500));
});
// ---- integrações com plataformas de jogos (Fase 1): vincular/desvincular/privacidade. A API da plataforma fica isolada em server/integrations/* ----
const activity = createActivityService({ all, get, run, newId, dispatch, presenceOk: (viewer, owner) => privacy.presenceVisible(viewer, owner), isInvisible: (u) => getUser(u)?.status === 'invisible', inVoice: (u) => !!currentVoice(u), isOnline: (u) => conns.has(u), getAdapter, listAdapters, notifyAccount: (u, p) => dispatch([u], 'INTEGRATION_UPDATE', { platform: p, account: accountPub(accountOf(u, p)) }), clipsWeek: (v, o) => clipsWeekFor(v, o), log: console.log });
const games = mountGames(app, { auth, wrap, bad, db, all, get, run, newId, getAdapter, dispatch, userPub, store: discover, roomOf: (cid) => voice.has(cid) ? [...voice.get(cid)].filter(([, st]) => !st.bot).map(([id]) => id) : null }); // biblioteca e wishlist: quem tem e quem quer cada jogo (server/games.js)
const achievements = mountAchievements(app, { auth, wrap, bad, db, all, get, run, newId, getAdapter, dispatch, clean, canSee: (v, o) => games.canSee(v, o), ensureLibrary: (uid) => games.syncSteam(uid), findSteamApp: (t) => discover.findApp(t) }); // conquistas e platinas (server/achievements.js)
// ---------- A fim de jogar (server/intents.js): intenção de jogar, convites direcionados e grupo formado sozinho ----------
// "Bora?": chamar a turma do servidor (server/bora.js)
mountBora(app, { auth, wrap, bad, db, all, get, run, newId, dispatch, guildMemberIds, userPub, clean, can, P, prefsOf: prefsOfUser, push,
  voiceChannelOf: (uid) => currentVoice(uid), canConnect: (uid, cid) => { const ch = get('SELECT * FROM channels WHERE id=?', cid); return !!ch && !timedOut(ch.guild_id, uid) && chp.chCan(ch, uid, CH.CONNECT); } });
const intents = mountIntents(app, {
  auth, wrap, bad, db, get, all, run, newId, dispatch, userPub, clean, log: console.log,
  audienceOf: lfgAudience, isFriend: (a, b) => !!get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=1', a, b),
  presenceVisible: (viewer, owner) => privacy.presenceVisible(viewer, owner), realStatus: (uid) => { const u = getUser(uid); return u ? realStatus(u) : 'offline'; },
  prefsOf: (uid) => { try { return JSON.parse(getUser(uid)?.settings || '{}') || {}; } catch { return {}; } },
  activity, games, lfgGames: LFG_GAMES, isOnline: (uid) => conns.has(uid), social,
  guildsOf: (uid) => all('SELECT g.id, g.name FROM guilds g JOIN members m ON m.guild_id=g.id WHERE m.user_id=?', uid),
  isMember: (gid, uid) => !!get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid), joinGuild: (gid, uid) => joinGuild(gid, uid),
  guildFull: (uid) => lim.guildJoin(uid),
  canConnect: (ch, uid) => !timedOut(ch.guild_id, uid) && chp.chCan(ch, uid, CH.CONNECT),
  voiceChannelOf: (uid) => currentVoice(uid), roomPeople: (cid) => voice.has(cid) ? [...voice.get(cid)].filter(([, st]) => !st.bot).map(([id]) => id) : [],
  // sala temporária do grupo: criada pelo Resenha (registro de auditoria em nome de quem chamou) e apagada quando esvazia
  createVoiceChannel: (gid, name, by) => {
    const id = newId(), pos = (get('SELECT MAX(position) m FROM channels WHERE guild_id=?', gid).m ?? 0) + 1;
    run('INSERT INTO channels(id,guild_id,type,name,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?)', id, gid, 2, name, pos, null, Date.now());
    const ch = get('SELECT * FROM channels WHERE id=?', id);
    dispatch(guildMemberIds(gid), 'CHANNEL_CREATE', ch); audit(gid, by, 'intent_room', id, name);
    return ch;
  },
  deleteChannel: (ch) => {
    if (voice.has(ch.id)) for (const u of [...voice.get(ch.id).keys()]) leaveVoice(u, ch.id);
    run('DELETE FROM channels WHERE id=?', ch.id);
    dispatch(guildMemberIds(ch.guild_id), 'CHANNEL_DELETE', { id: ch.id, guild_id: ch.guild_id });
  },
  callInvite: (from, to, opts) => { const r = callInv.create(from, to, opts); if (r.invite && !r.repeated && !conns.has(to)) social.pull(to, 'call_invite'); return r; },
});
// memória do grupo (server/sessions.js): sessões de voz de servidor guardadas com quem esteve e o que rolou
const voiceSessions = createVoiceSessions({ db, all, get, run, newId, log: console.log,
  roomOf: (cid) => [...(voice.get(cid) || [])].map(([id, st]) => ({ id, bot: !!st.bot, at: st.at })),
  channelOf: (cid) => get('SELECT guild_id, name FROM channels WHERE id=?', cid),
  remembers: (uid) => privacy.memorySessions(uid),
  // jogos da sessão sem nomes; quem escondeu a presença de alguém fica de fora (o resumo vai para o servidor todo)
  gamesDuring: (uids, from, to) => activity.gamesDuring(uids.filter(u => !privacy.restricted(u)), from, to) });
// sessões de voz com 2+ pessoas (métricas e memória): chamado depois de cada entrada/saída
const voicePeople = (cid) => (voice.has(cid) ? [...voice.get(cid).values()].filter(st => !st.bot).length : 0);
function socialVoice(cid, joined = null) {
  const isIntent = intents.isIntentRoom(cid);
  const friendThere = joined && voice.has(cid) && [...voice.get(cid).keys()].some(u => u !== joined && get('SELECT 1 x FROM relationships WHERE user_id=? AND other_id=? AND type=1', joined, u));
  social.onVoice(cid, voicePeople(cid), { intent: isIntent, joined, friendThere });
  voiceSessions.onVoice(cid);
}
mountVoiceSessions(app, { ...core, voiceSessions, activity, discover }); // "Desde a última vez" e apagar sessões (server/routes/sessions.js)
const { accountPub, accountOf, resolveLocalGame, saveGameIcon, localNames } = mountActivity(app, { ...core, activity, games, achievements, discover }); // integrações, Ativo agora e jogo no PC (server/routes/activity.js)
app.get('/api/server-info', (req, res) => res.json({ name: 'Resenha', registration: OPEN_REGISTRATION, default_avatars: DEFAULT_AVATARS, max_upload: MAX_UPLOAD, limits: LIMITS }));
mountDesktopUpdate(app, DATA_DIR); // atualizações do app desktop pelo servidor (repositório pode ser privado)
// política de privacidade e de segurança desta instalação (o dono pode editar os arquivos na raiz do projeto)
for (const [route, file] of [['/privacidade', 'PRIVACIDADE.md'], ['/seguranca', 'SECURITY.md']])
  app.get(route, (req, res) => res.type('text/plain; charset=utf-8').sendFile(path.join(__dirname, '..', file), (e) => e && !res.headersSent && res.status(404).end()));
const ui = process.env.STATIC_OFF !== '1' ? mountStatic(app, process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public')) : null; // PUBLIC_DIR: só testes (scripts/uiupdate-test.mjs) // comprimido, versionado e com modulepreload (server/static.js)
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api|files|gateway).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------- Gateway (WebSocket) ----------
const server = http.createServer(app);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
// mensagens do WebSocket comprimidas a partir de 1 KB (a abertura, READY, tinha ~600 KB sem compressão num servidor com
// 250 pessoas); janela menor para gastar pouca memória por conexão
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20,
  perMessageDeflate: process.env.WS_DEFLATE === '0' ? false : { threshold: 1024, concurrencyLimit: 4, serverMaxWindowBits: 13, zlibDeflateOptions: { level: 4, memLevel: 7 } } });
const onUpgrade = (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/gateway') return socket.destroy();
  const s = sessions.lookup(url.searchParams.get('token') || '');
  if (!s) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => { ws.uid = s.user_id; ws.tokenHash = s.hash; ws.tab = String(url.searchParams.get('tab') || '').slice(0, 40) || null; ws.resume = url.searchParams.get('resume') === '1'; wss.emit('connection', ws); });
};
server.on('upgrade', onUpgrade);

const iceServers = () => {
  const s = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) s.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  return s;
};
// READY já em texto: as partes guardadas (servidores e perfis) entram prontas; o resto é calculado agora
// Servidor grande (a partir de READY_LARGE membros, padrão 1.000): o READY leva só quem está online, a própria pessoa e o
// dono; o app pede a lista inteira ao abrir o servidor (GET /api/guilds/:id/members). Com 5.000 membros o READY tinha
// 3,5 MB de texto (5.000 perfis + 5.000 membros) para cada pessoa que abria o app, olhando ou não aquele servidor.
const READY_LARGE = +(process.env.READY_LARGE || 1000);
function partialMembers(c, uid) {
  const g = c.obj, keep = (m) => m.user_id === uid || m.user_id === g.owner_id || conns.has(m.user_id);
  return g.members.filter(keep);
}
function buildReadyRaw(uid, extra) {
  const gcs = all('SELECT guild_id FROM members WHERE user_id=?', uid).map(r => guildCached(r.guild_id)).filter(Boolean), guilds = gcs.map(c => c.obj);
  const big = new Map(gcs.filter(c => c.obj.members.length >= READY_LARGE).map(c => [c.obj.id, partialMembers(c, uid)]));
  // cada pessoa uma vez só (antes ia repetida em cada servidor em comum: 250 pessoas em 5 servidores = 1.250 perfis)
  const small = gcs.filter(c => !big.has(c.obj.id)).map(c => c.obj.id), bigIds = [...new Set([...big.values()].flatMap(ms => ms.map(m => m.user_id)))];
  const users = all(`SELECT ${PUB_COLS} FROM users WHERE id IN (SELECT m.user_id FROM members m WHERE m.guild_id IN (SELECT value FROM json_each(?))) OR id IN (SELECT value FROM json_each(?))`, JSON.stringify(small), JSON.stringify(bigIds));
  const dms = all('SELECT c.* FROM channels c JOIN dm_participants p ON p.channel_id=c.id WHERE p.user_id=? AND c.type=1', uid).map(dmChannelObj);
  const chIds = [...guilds.flatMap(g => g.channels.filter(c => [0, 2, 5, 16].includes(c.type)).map(c => c.id)), ...dms.map(d => d.id)];
  const dmVoice = [];
  for (const d of dms) for (const [uid, s] of voice.get(d.id) || []) dmVoice.push(vsObj(d.id, uid, s));
  // não lidas de todos os canais numa consulta só (antes: 2 consultas por canal)
  const unread = {};
  // canal por canal pelo índice (channel_id, id), contando no máximo até 100 (o app mostra "99+"). A versão anterior,
  // um JOIN com json_each, fazia o SQLite varrer as mensagens de TODOS os canais: 48 ms por abertura num servidor com
  // 20 mil mensagens; com 1000 pessoas abrindo o app juntas, 48 s de fila (achado no teste de carga, scripts/load).
  for (const r of all(`SELECT j.value c,
      (SELECT COUNT(*) FROM (SELECT 1 FROM messages m WHERE m.channel_id=j.value AND m.id > COALESCE(rs.last_id, '0') AND m.author_id<>? LIMIT 100)) n,
      (SELECT MAX(id) FROM messages WHERE channel_id=j.value) l
      FROM json_each(?) j LEFT JOIN read_states rs ON rs.user_id=? AND rs.channel_id=j.value`, uid, JSON.stringify(chIds), uid)) if (r.n) unread[r.c] = { count: r.n, last_id: r.l };
  const rels = relObj(uid), me = getUser(uid);
  for (const x of [...dms.flatMap(d => d.recipients), ...rels.map(r => r.user)]) if (x) { const xu = { id: x.id, username: x.username, status: getUser(x.id)?.status }; x.status = statusFor(uid, xu); x.platforms = platformsFor(uid, xu); }
  const rest = JSON.stringify({ user: { ...pubUser(me), status: realStatus(me), platforms: platformsOf(me) }, dms, relationships: rels, friend_losses: friendLossesFor(uid), activities: activity.readyFor(uid), unread, dm_voice: dmVoice, ice: iceServers(), ...extra });
  return '{"t":"READY","d":{"users":[' + users.map(u => userJson(u, uid)).join(',') + '],"guilds":[' + gcs.map(c => (big.has(c.obj.id) ? c.headNoMembers + ',"members":' + JSON.stringify(big.get(c.obj.id)) + ',"partial":true,"member_count":' + c.obj.members.length : c.head) + ',"voice_states":' + JSON.stringify(voiceStatesFor(c.obj.id)) + '}').join(',') + '],' + rest.slice(1) + '}';
}

// espectadores de transmissões: "canal:transmissor" -> Set de quem está assistindo
const watchers = new Map();
function pushViewers(cid, streamer) {
  const set = watchers.get(cid + ':' + streamer), m = voice.get(cid); if (!m) return;
  const d = { channel_id: cid, streamer_id: streamer, viewers: set ? [...set] : [] };
  for (const [, s] of m) send(s.ws, 'STREAM_VIEWERS', d);
  syncWatchFlags(cid);
}
// "assistindo" no estado de voz (olho ao lado do nome na lista da sala, para o servidor todo): só quem mudou é reenviado
function syncWatchFlags(cid) {
  const m = voice.get(cid); if (!m) return;
  const on = new Set();
  for (const [k, set] of watchers) if (k.startsWith(cid + ':')) for (const id of set) on.add(id);
  let ch = null;
  for (const [id, st] of m) {
    if (!!st.watching === on.has(id)) continue;
    st.watching = on.has(id);
    ch = ch || get('SELECT * FROM channels WHERE id=?', cid); if (!ch) return;
    dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(cid, id, st), guild_id: ch.guild_id });
  }
}
// Watch Together: quem está assistindo na sala (ícone de TV ao lado do nome na lista da sala, para o servidor todo)
function syncWtFlags(cid) {
  const m = voice.get(cid); if (!m) return;
  const on = new Set(watch.summary(cid)?.members || []);
  let ch = null;
  for (const [id, st] of m) {
    if (st.bot || !!st.wt === on.has(id)) continue;
    st.wt = on.has(id);
    ch = ch || get('SELECT * FROM channels WHERE id=?', cid); if (!ch) return;
    dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(cid, id, st), guild_id: ch.guild_id });
  }
}
function dropWatching(uid, cid) { // tira uid das transmissões que assistia e encerra a dele
  for (const [k, set] of [...watchers]) {
    if (!k.startsWith(cid + ':')) continue;
    const streamer = k.slice(cid.length + 1);
    if (streamer === uid) { watchers.delete(k); pushViewers(cid, streamer); }
    else if (set.delete(uid)) { if (!set.size) watchers.delete(k); pushViewers(cid, streamer); }
  }
}
// reason 'drop': a conexão caiu/fechou (F5, internet, app fechado) — o app oferece "Reconectar" quando a pessoa volta
function leaveVoice(uid, cid, reason) {
  const m = voice.get(cid); if (!m || !m.has(uid)) return;
  clearTimeout(m.get(uid).dropT);
  remote.onLeave(uid); // controle remoto acaba antes de qualquer outra coisa
  m.delete(uid); dropWatching(uid, cid); if (!m.size) { voice.delete(cid); roomStart.delete(cid); acts.delete(cid); }
  else { const a = acts.get(cid); if (a?.spot && (a.spot.slice(2) === uid)) { a.spot = a.spotBy = null; roomSend(cid, 'ROOM_STATE', actState(cid)); } } // quem estava em destaque saiu
  sfuLeave(cid, uid);
  const ch = get('SELECT * FROM channels WHERE id=?', cid);
  if (ch) dispatch(channelAudience(ch), 'VOICE_STATE', { channel_id: null, prev_channel_id: cid, user_id: uid, guild_id: ch.guild_id, ...(reason ? { reason } : {}) });
  for (const [, s] of m) send(s.ws, 'VOICE_PEER_LEFT', { channel_id: cid, user_id: uid });
  musicOnLeave(cid);
  watch.onVoiceLeave(uid, cid, reason);
  activity.onVoice(uid); // horas de jogo só contam em call
  socialVoice(cid);
}
// Bot de música: participante sem conexão WebSocket (ws "morto" faz send() ser ignorado)
// bot: { kind: 'music', n, name } — vai no estado de voz para o app desenhá-lo como bot (não é um membro do servidor)
// onReset: o worker do mediasoup da sala morreu (SFU_RESET); o bot precisa entrar de novo no SFU e refazer o envio
async function joinBot(cid, botId, bot, onReset) {
  if (!voice.has(cid)) { voice.set(cid, new Map()); roomStart.set(cid, Date.now()); }
  const st = { ws: { readyState: 0 }, mute: false, deaf: false, video: false, screen: false, bot: bot || { kind: 'music', n: 1, name: 'Música' } };
  voice.get(cid).set(botId, st);
  const ch = get('SELECT * FROM channels WHERE id=?', cid);
  dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(cid, botId, st), guild_id: ch.guild_id });
  await sfuJoin(cid, botId, (t) => { if (t === 'SFU_RESET') onReset?.(); });
}
initMusic({ db, all, get, run, newId, canManage: (gid, uid) => can(gid, uid, P.MANAGE_CHANNELS) || can(gid, uid, P.MANAGE_GUILD), voice, send, dispatch, guildMemberIds, memberObj, userPub, joinBot, rejoinBotSfu: (cid, botId, onReset) => sfuJoin(cid, botId, (t) => { if (t === 'SFU_RESET') onReset?.(); }), leaveBot: (cid, botId) => leaveVoice(botId, cid), attachRtp: sfuAttachRtp, sfuEnabled });
// Watch Together (server/watch.js): sessão por sala de voz; eventos só para quem está na sala
const watchDb = () => db.exec(`CREATE TABLE IF NOT EXISTS watch_history(guild_id TEXT NOT NULL, service TEXT NOT NULL, ref TEXT NOT NULL, url TEXT, title TEXT, channel TEXT, thumb TEXT, duration INTEGER, by_id TEXT, at INTEGER, PRIMARY KEY(guild_id, service, ref));
  CREATE INDEX IF NOT EXISTS idx_watch_hist ON watch_history(guild_id, at);`);
watchDb();
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const OEMBED = process.env.WATCH_OEMBED_URL || 'https://www.youtube.com/oembed';
const YT_API = process.env.WATCH_YT_API || 'https://www.googleapis.com/youtube/v3'; // WATCH_YT_API/WATCH_OEMBED_URL: só para os testes (scripts/watch-test.mjs)
const isoDur = (d) => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ''); return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0; };
const fetchJson = async (url, ms = 8000) => { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Mozilla/5.0 Resenha' } }); return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null }; };
// título/canal/miniatura pelo oEmbed oficial do YouTube (sem chave). 401/403 = incorporação desativada; 404/400 = não existe ou privado
async function watchMeta(it) {
  if (process.env.WATCH_OEMBED === '0') return {};
  const out = {};
  if (YT_KEY) {
    try { const r = await fetchJson(`${YT_API}/videos?part=snippet,contentDetails,status&id=${it.ref}&key=${YT_KEY}`);
      const v = r.json?.items?.[0]; if (r.status === 200 && !v) return { notFound: true };
      if (v) return { title: v.snippet.title, channel: v.snippet.channelTitle, thumb: v.snippet.thumbnails?.high?.url, duration: isoDur(v.contentDetails.duration), embeddable: v.status.embeddable !== false };
    } catch { }
  }
  try {
    const r = await fetchJson(`${OEMBED}?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + it.ref)}`);
    if (r.status === 401 || r.status === 403) return { embeddable: false };
    if (r.status === 404 || r.status === 400) return { notFound: true };
    if (r.json) Object.assign(out, { title: String(r.json.title || ''), channel: String(r.json.author_name || ''), thumb: r.json.thumbnail_url });
  } catch { } // sem internet/oEmbed fora do ar: entra com o título provisório e o player confirma
  return out;
}
// busca: YouTube Data API v3 (oficial) se houver YOUTUBE_API_KEY; senão o mesmo yt-dlp do bot de música
async function watchSearch(q) {
  if (YT_KEY) {
    const r = await fetchJson(`${YT_API}/search?part=snippet&type=video&videoEmbeddable=true&maxResults=12&q=${encodeURIComponent(q)}&key=${YT_KEY}`);
    if (!r.json) throw new Error('A busca do YouTube não respondeu (verifique a YOUTUBE_API_KEY)');
    return r.json.items.map(x => ({ service: 'youtube', ref: x.id.videoId, url: 'https://www.youtube.com/watch?v=' + x.id.videoId, title: x.snippet.title, channel: x.snippet.channelTitle, thumb: x.snippet.thumbnails?.high?.url || x.snippet.thumbnails?.default?.url, duration: 0 }));
  }
  if (!(await musicAvailable())) throw new Error('A busca precisa do yt-dlp no servidor (ou de uma YOUTUBE_API_KEY). Cole um link do YouTube.');
  const list = await musicSearch(q, 10);
  return list.map(t => { const m = /[?&]v=([\w-]{11})/.exec(t.url || ''); return m && { service: 'youtube', ref: m[1], url: 'https://www.youtube.com/watch?v=' + m[1], title: t.title, channel: t.artist, thumb: t.thumb || `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, duration: t.duration }; }).filter(Boolean);
}
// playlist do YouTube: YouTube Data API v3 se houver YOUTUBE_API_KEY (mixes automáticos "RD…" ela não lista); senão yt-dlp
async function watchPlaylist(pl, n = 100) {
  const ytItem = (id, x = {}) => ({ service: 'youtube', ref: id, url: 'https://www.youtube.com/watch?v=' + id, title: x.title || '', channel: x.channel || '', thumb: x.thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: x.duration || 0, embeddable: x.embeddable });
  if (YT_KEY && !/^RD/.test(pl.list)) {
    const items = []; let page = '', title = '';
    for (let i = 0; i < 4 && items.length < n; i++) {
      const r = await fetchJson(`${YT_API}/playlistItems?part=snippet,status&maxResults=50&playlistId=${encodeURIComponent(pl.list)}${page ? '&pageToken=' + page : ''}&key=${YT_KEY}`);
      if (r.status === 404) throw new Error('Playlist não encontrada (ela é privada ou foi apagada?)');
      if (!r.json) throw new Error('O YouTube não respondeu (verifique a YOUTUBE_API_KEY)');
      for (const x of r.json.items || []) {
        const id = x.snippet?.resourceId?.videoId; if (!/^[\w-]{11}$/.test(id || '') || x.status?.privacyStatus === 'private' || /^(private|deleted) video$/i.test(x.snippet?.title || '')) continue;
        items.push(ytItem(id, { title: x.snippet.title, channel: x.snippet.videoOwnerChannelTitle || '', thumb: x.snippet.thumbnails?.high?.url }));
      }
      page = r.json.nextPageToken; if (!page) break;
    }
    const list = items.slice(0, n);
    for (let i = 0; i < list.length; i += 50) { // duração e "pode incorporar" (a playlist não traz)
      const r = await fetchJson(`${YT_API}/videos?part=contentDetails,status&id=${list.slice(i, i + 50).map(x => x.ref).join(',')}&key=${YT_KEY}`).catch(() => null);
      const by = new Map((r?.json?.items || []).map(v => [v.id, v]));
      for (const it of list.slice(i, i + 50)) { const v = by.get(it.ref); if (v) { it.duration = isoDur(v.contentDetails?.duration); it.embeddable = v.status?.embeddable !== false; } }
    }
    try { const r = await fetchJson(`${YT_API}/playlists?part=snippet&id=${encodeURIComponent(pl.list)}&key=${YT_KEY}`); title = r.json?.items?.[0]?.snippet?.title || ''; } catch { }
    return { title, items: list };
  }
  if (!(await musicAvailable())) throw new Error('Adicionar playlists precisa do yt-dlp no servidor (ou de uma YOUTUBE_API_KEY)');
  const r = await musicPlaylist(pl.url, n);
  return { title: r.title, items: r.entries.map(t => { const m = /[?&]v=([\w-]{11})/.exec(t.url || ''); return m && ytItem(m[1], { title: t.title, channel: t.artist, thumb: t.thumb, duration: t.duration }); }).filter(Boolean) };
}
const voiceWs = (uid) => { const c = currentVoice(uid), st = c && voice.get(c)?.get(uid); return st?.ws; };
const watch = createWatch({
  inRoom: (uid, cid) => !!voice.get(cid)?.get(uid) && !voice.get(cid).get(uid).bot,
  roomMembers: (cid) => [...(voice.get(cid) || [])].filter(([, st]) => !st.bot).map(([id]) => id),
  sendTo: (uid, t, d) => { const ws = voiceWs(uid); if (ws) send(ws, t, d); },
  userPub, guildOf: (cid) => get('SELECT guild_id FROM channels WHERE id=?', cid)?.guild_id || null,
  search: watchSearch, meta: watchMeta, playlist: watchPlaylist,
  remember: (gid, it, cid) => { if (cid) voiceSessions.onWatch(cid); if (gid) run('INSERT OR REPLACE INTO watch_history(guild_id,service,ref,url,title,channel,thumb,duration,by_id,at) VALUES(?,?,?,?,?,?,?,?,?,?)', gid, it.service, it.ref, it.url, it.title, it.channel || '', it.thumb || null, it.duration || 0, it.by, Date.now()); },
  recent: (gid) => gid ? all('SELECT service, ref, url, title, channel, thumb, duration FROM watch_history WHERE guild_id=? ORDER BY at DESC LIMIT 30', gid) : [],
  log: (...a) => console.log(...a),
  onChange: (cid) => syncWtFlags(cid),
});
// Controle remoto (server/remote.js). Pedido, resposta e comandos só valem da conexão que está na chamada.
const remote = createRemote({
  newId,
  voiceOf: (uid) => { const c = currentVoice(uid); return c ? { cid: c, screen: !!voice.get(c).get(uid).screen } : null; },
  sendUser: (uid, type, d) => { const c = currentVoice(uid), st = c && voice.get(c).get(uid); if (st?.ws?.readyState === 1) send(st.ws, type, d); else dispatch([uid], type, d); },
});
function currentVoice(uid) { for (const [cid, m] of voice) if (m.has(uid)) return cid; return null; }
// A conexão em tempo real de quem está na sala caiu. A voz e a transmissão NÃO passam por ela (vão direto ao SFU, por
// UDP) e seguem funcionando: a pessoa fica na sala por VOICE_GRACE_MS esperando a conexão nova pedir VOICE_RESUME. Antes
// saía na hora: para os outros ela sumia e voltava (voz cortada, transmissão encerrada), mesmo que a queda durasse 1 s.
// Não voltou a tempo (fechou o app, internet caiu de vez): sai como antes, com o motivo 'drop'.
// 20 s: uma queda de até 15 s (troca de Wi-Fi, VPN reconectando) mais os ~3 s que o app leva para reconectar quando a rede
// volta (public/gateway.js). Com 15 s, uma queda de 15 s sempre tirava da sala.
const VOICE_GRACE_MS = +process.env.VOICE_GRACE_MS || 20000;
function holdVoice(uid, c, st, ms = VOICE_GRACE_MS) {
  if (st.dropT) return;
  st.dropT = setTimeout(() => { st.dropT = null; if (voice.get(c)?.get(uid) === st && st.ws.readyState !== 1) leaveVoice(uid, c, 'drop'); }, ms);
}
// eventos do SFU para quem está na sala: vão para a conexão ATUAL da pessoa (depois de um VOICE_RESUME ela é outra; antes
// iam para a da entrada, já morta, e quem retomava a sessão deixava de saber de câmeras e transmissões novas)
const sfuNotify = (cid, uid) => (t, x) => { const st = voice.get(cid)?.get(uid); if (st) send(st.ws, t, { ...x, channel_id: cid }); };
// a pessoa abriu uma conexão nova e o servidor ainda a tem numa sala por uma conexão antiga (caiu a internet sem aviso,
// F5 atrás de proxy, app reiniciado): a mesma aba/janela (tab) sai da sala na hora; outra conexão da mesma conta pode ser
// outro aparelho de verdade, então a antiga só sai se não responder a um ping em 5 s
function dropStaleVoice(uid, ws) {
  const c = currentVoice(uid), st = c && voice.get(c).get(uid), old = st?.ws;
  if (!old || old === ws) return;
  // mesma aba/janela (ou a antiga já caiu). Reconexão da MESMA página ainda na chamada (resume=1): segura a sala para o
  // VOICE_RESUME. Página nova (F5, app reaberto: ela não está mais na chamada): sai na hora, como sempre
  if (old.readyState !== 1 || (ws.tab && old.tab === ws.tab)) {
    old.lcWhy ||= 'substituída pela conexão nova da mesma janela';
    if (ws.resume) holdVoice(uid, c, st); else leaveVoice(uid, c, 'drop');
    try { old.terminate(); } catch { } return;
  }
  if (old.probing) return;
  old.probing = true; old.alive = false; try { old.ping(); } catch { }
  setTimeout(() => { old.probing = false; if (!old.alive) old.terminate(); }, 5000); // terminate -> 'close' -> sai da sala
}

// aparelhos da conta em uso agora: cada conexão sabe se OUTRA está ativa (e de que tipo) — quem está no PC lendo não
// recebe a notificação no celular; quando o PC sai do foco, o celular volta a avisar na hora
// mudou o conjunto de plataformas (abriu o celular com o PC ligado, fechou o navegador…): avisa quem vê a presença
function pushPlatforms(uid) { const u = getUser(uid); if (u && conns.has(uid) && platKey.get(uid) !== platformsOf(u).join()) broadcastStatus(uid); }
function pushDevices(uid) {
  const list = [...(conns.get(uid) || [])].filter(w => w.active).map(w => ({ tab: w.tab, kind: w.devKind || 'web', at: w.activeAt }));
  dispatch([uid], 'DEVICES', { active: list });
}
// ---- limite por conexão (app modificado ou em laço por bug) ----
// Cada mensagem do app custa ao servidor; algumas viram um envio para o servidor inteiro (VOICE_STATE) ou uma consulta
// grande (VIEW manda quem está online). Balde de fichas por tipo e um geral: [fichas por segundo, acumulado máximo].
// O app normal fica bem abaixo (VOICE_STATE: cliques seguidos já se juntam no app; TYPING: 1 a cada 3 s).
const WS_RATE = {
  VIEW: [3, 10], VOICE_STATE: [5, 15], CLIENT_INFO: [1, 5], ACTIVE: [2, 10], ACTIVITY_LOCAL: [1, 5], ROOM_CODE: [10, 30],
  TYPING: [1, 4], VOICE_JOIN: [1, 5], STREAM_WATCH: [6, 30], ROOM_ACT: [2, 10], ROOM_SPOTLIGHT: [2, 10], MUSIC: [3, 10],
  REMOTE_REQUEST: [1, 5], REMOTE_INVITE: [1, 5], REMOTE_PERMS: [5, 20], REMOTE_PING: [8, 16], REMOTE_PONG: [8, 16], PING: [5, 10], WATCH: [12, 40],
};
const WS_ALL = [300, 600];
// tipos em que só importa o último valor: passando do limite, o último pedido é guardado e aplicado depois (o estado
// não fica errado); os outros, passando do limite, são ignorados. VOICE_JOIN também: ignorado, o app ficava
// "conectando" para sempre sem resposta nenhuma (sair e entrar rápido, rejoin() da recuperação); guardado, entra
// quando sobrar ficha (o limite continua o mesmo) e um VOICE_LEAVE depois dele o cancela.
const WS_KEEP = new Set(['VIEW', 'VOICE_STATE', 'CLIENT_INFO', 'ACTIVE', 'ACTIVITY_LOCAL', 'ROOM_CODE', 'VOICE_JOIN']);
const WS_FLOOD = 3000; // ignoradas em 10 s: fecha a conexão (o app reconecta sozinho)
function wsGate(ws, t) {
  const now = performance.now(), b = (ws.buckets ||= {});
  const fill = (k, [rate, max]) => { const x = b[k] || (b[k] = { n: max, at: now }); x.n = Math.min(max, x.n + (now - x.at) / 1000 * rate); x.at = now; return x; };
  const tot = fill('_', WS_ALL), one = WS_RATE[t] ? fill(t, WS_RATE[t]) : null;
  if (tot.n >= 1 && (!one || one.n >= 1)) { tot.n--; if (one) one.n--; return 'ok'; }
  if (WS_KEEP.has(t)) return 'later';
  if (now - (ws.dropAt || 0) > 10000) { ws.dropAt = now; ws.drops = 0; }
  if (++ws.drops > WS_FLOOD) { console.warn(`  gateway: conexão de ${ws.uid} fechada por excesso de mensagens (${t})`); ws.close(4008, 'Mensagens demais'); }
  return 'drop';
}
wss.on('connection', (ws) => {
  const uid = ws.uid;
  const first = !conns.has(uid);
  if (first) conns.set(uid, new Set());
  conns.get(uid).add(ws); legacyConns.add(ws);
  ws.alive = true; ws.t0 = Date.now(); ws.on('pong', () => (ws.alive = true));
  dropStaleVoice(uid, ws); // antes do READY: quem caiu e voltou (ou deu F5) não aparece mais na sala como "fantasma"
  uxSeen(uid); // telemetria: usou o app hoje (uma vez por dia, sem guardar quem)
  if (first) social.onConnect(uid); // métricas: voltou por causa de um convite/atividade?
  { const t0 = performance.now(); if (ws.readyState === 1) ws.send(buildReadyRaw(uid, { desktop_min: desktopMin(), now: Date.now(), ui: ui?.version || null })); mountPerf.time?.('WS READY (montar + enviar)', performance.now() - t0); }
  if (first) { broadcastStatus(uid); activity.poke(); }
  if (!first) send(ws, 'DEVICES', { active: [...conns.get(uid)].filter(w => w.active).map(w => ({ tab: w.tab, kind: w.devKind || 'web', at: w.activeAt })) });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const v = wsGate(ws, msg.t);
    if (v === 'drop') return;
    if (msg.t === 'VOICE_LEAVE') ws.later?.delete('VOICE_JOIN'); // saiu antes de a entrada guardada valer: não entra mais
    // estado da voz (mudo, ensurdecido…) mandado depois de uma entrada que ficou guardada: espera a entrada, senão chegaria
    // antes dela, não acharia a sala e se perderia (os outros veriam a pessoa desmutada)
    const afterJoin = msg.t === 'VOICE_STATE' && ws.later?.has('VOICE_JOIN');
    if (v === 'later' || afterJoin) { // estado (VIEW, VOICE_STATE…): não pode se perder; vale o último pedido, aplicado quando sobrar ficha
      (ws.later ||= new Map()).set(msg.t, msg);
      if (!ws.laterT) ws.laterT = setTimeout(function again() {
        ws.laterT = null; if (ws.readyState !== 1) return;
        const order = [...ws.later.keys()].sort((a, b) => (b === 'VOICE_JOIN') - (a === 'VOICE_JOIN')); // a entrada primeiro
        for (const t of order) {
          if (t === 'VOICE_STATE' && ws.later.has('VOICE_JOIN')) continue;
          if (wsGate(ws, t, true) !== 'ok') continue;
          const m = ws.later.get(t); ws.later.delete(t); handle(m);
        }
        if (ws.later.size) ws.laterT = setTimeout(again, 250);
      }, 250);
      return;
    }
    ws.later?.delete(msg.t); // chegou um mais novo e foi aplicado: o guardado ficou velho
    handle(msg);
  });
  const handle = (msg) => {
    const d = msg.d && typeof msg.d === 'object' ? msg.d : {};
    try {
      switch (msg.t) {
        case 'PING': send(ws, 'PONG', { n: d.n }); break; // medida de latência do cliente
        case 'VIEW': { // servidor que o app está mostrando (null: nenhum / janela escondida) — ver broadcastStatus
          const gid = d.guild_id ? String(d.guild_id) : null;
          const ok = gid && get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', gid, uid) ? gid : null;
          legacyConns.delete(ws);
          if (ws.view === ok) break;
          setView(ws, ok); if (ok) presenceSync(ws, ok);
          break;
        }
        case 'ACTIVE': { // este aparelho está em uso (janela em foco e mexendo) ou não: os outros seguram as notificações
          const on = !!d.active, kind = ['desktop', 'mobile', 'web'].includes(d.kind) ? d.kind : 'web';
          if (ws.active === on && ws.devKind === kind) break;
          const kindChanged = ws.devKind !== kind;
          ws.active = on; ws.devKind = kind; ws.activeAt = Date.now(); pushDevices(uid);
          if (kindChanged) pushPlatforms(uid);
          break;
        }
        case 'CLIENT_INFO': { // versão do app desktop desta conexão (null = navegador)
          ws.app = typeof d.desktop === 'string' && VER_RE.test(d.desktop) ? d.desktop : null;
          if (!ws.devKind && ['desktop', 'mobile', 'web'].includes(d.kind)) ws.devKind = d.kind;
          pushPlatforms(uid);
          const c = currentVoice(uid), st = c && voice.get(c).get(uid);
          if (st?.ws === ws) { const ch = get('SELECT * FROM channels WHERE id=?', c); dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(c, uid, st), guild_id: ch.guild_id }); }
          break;
        }
        case 'TYPING': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (!canAccessChannel(uid, ch)) break;
          if (!ch.guild_id) { dispatch(channelAudience(ch).filter(x => x !== uid), 'TYPING', { channel_id: ch.id, user_id: uid }); break; }
          // canal de servidor: "digitando…" só aparece no chat e na prévia dos canais desse servidor, então vai só para
          // quem está olhando o servidor (VIEW) e para app antigo; antes ia para todos os membros (500 pessoas = 500 envios)
          const to = [];
          for (const w of viewers.get(ch.guild_id) || []) if (w.uid !== uid) to.push(w);
          if (legacyConns.size) { const mem = new Set(guildMemberIds(ch.guild_id)); for (const w of legacyConns) if (w.uid !== uid && mem.has(w.uid)) to.push(w); }
          sendRaw(to, 'TYPING', { channel_id: ch.id, user_id: uid });
          break;
        }
        case 'VOICE_JOIN': {
          const ch = get('SELECT * FROM channels WHERE id=?', String(d.channel_id));
          if (!ch || (ch.type !== 2 && ch.type !== 1) || !canAccessChannel(uid, ch)) return;
          if (timedOut(ch.guild_id, uid)) return send(ws, 'VOICE_DENIED', { channel_id: ch.id, reason: 'Você está de castigo neste servidor' });
          if (!chp.chCan(ch, uid, CH.CONNECT) && currentVoice(uid) !== ch.id) return send(ws, 'VOICE_DENIED', { channel_id: ch.id, code: 'no_connect', reason: 'Você não tem permissão para entrar nesta sala de voz' });
          { const min = desktopMin(); if (min && ws.app && olderVer(ws.app, min)) return send(ws, 'VOICE_DENIED', { channel_id: ch.id, code: 'outdated', min, reason: `Seu app está na versão ${ws.app}. Para entrar nas calls, atualize para a ${min} ou mais nova.` }); }
          // ligação numa DM: começar a chamada (sala vazia) toca para a outra pessoa — só se ela aceita ligações de quem liga
          if (ch.type === 1 && !(voice.get(ch.id)?.size)) {
            const other = get('SELECT user_id FROM dm_participants WHERE channel_id=? AND user_id<>?', ch.id, uid)?.user_id;
            if (other && !privacy.canCall(uid, other)) return send(ws, 'VOICE_DENIED', { channel_id: ch.id, code: 'calls_off', reason: `${userPub(other)?.display_name || 'Essa pessoa'} não está aceitando ligações. Mande uma mensagem.` });
          }
          const prev = currentVoice(uid); if (prev) leaveVoice(uid, prev);
          if (!voice.has(ch.id)) { voice.set(ch.id, new Map()); roomStart.set(ch.id, Date.now()); }
          const room = voice.get(ch.id);
          const peers = [...room.keys()];
          const st = { ws, mute: false, deaf: false, video: false, screen: false, at: Date.now() };
          if (ch.guild_id) { const vm = get('SELECT voice_mute m, voice_deaf d FROM members WHERE guild_id=? AND user_id=?', ch.guild_id, uid); st.modMute = !!vm?.m; st.modDeaf = !!vm?.d; } // vale em todas as salas do servidor
          Object.assign(st, voicePermsOf(ch, uid));
          room.set(uid, st);
          if (!sfuEnabled()) send(ws, 'VOICE_JOINED', { channel_id: ch.id, peers });
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(ch.id, uid, st), guild_id: ch.guild_id });
          uxFirst(uid, 'voice');
          intents.onVoiceJoin(uid, ch.id); socialVoice(ch.id, uid);
          activity.onVoice(uid); // horas de jogo só contam em call
          musicOnJoin(ch.id, ws);
          watch.onVoiceJoin(uid, ch.id);
          if (acts.has(ch.id)) send(ws, 'ROOM_STATE', actState(ch.id));
          for (const k of watchers.keys()) if (k.startsWith(ch.id + ':')) pushViewers(ch.id, k.slice(ch.id.length + 1));
          if (!sfuEnabled()) break;
          sfuJoin(ch.id, uid, sfuNotify(ch.id, uid)).then(sfu => {
            if (voice.get(ch.id)?.get(uid) !== st) return sfuLeave(ch.id, uid); // saiu enquanto entrava
            if (st.modMute || st.modDeaf || st.noSpeak) sfuModerate(ch.id, uid, { mute: st.modMute || st.noSpeak, deaf: st.modDeaf });
            send(ws, 'VOICE_JOINED', { channel_id: ch.id, peers, sfu });
          }).catch(e => { console.error('sfu join', e.message); if (voice.get(ch.id)?.get(uid) === st) send(ws, 'SFU_RESET', { channel_id: ch.id, reason: 'join' }); }); // o app tenta de novo (ex.: worker sendo recriado)
          break;
        }
        case 'SFU_REJOIN': { // a conexão de mídia caiu e não voltou (ou o worker morreu): refaz só o SFU, sem sair da sala
          const c = currentVoice(uid), st = c && voice.get(c).get(uid);
          if (!st || st.ws !== ws || String(d.channel_id) !== c) return send(ws, 'SFU_RESET', { channel_id: String(d.channel_id || ''), reason: 'not_in_room', gone: true });
          if (natives.has(uid)) endNative(uid, 'replaced'); // o app recomeça a transmissão nativa sozinho no sfuStart
          sfuLeave(c, uid);
          sfuJoin(c, uid, sfuNotify(c, uid)).then(sfu => {
            if (voice.get(c)?.get(uid) !== st) return sfuLeave(c, uid);
            // o par do SFU é novo: o mudo/surdo da moderação (e a falta de "Falar") vale de novo. Sem isto, refazer a mídia
            // devolvia a voz a quem foi mutado
            if (st.modMute || st.modDeaf || st.noSpeak) sfuModerate(c, uid, { mute: st.modMute || st.noSpeak, deaf: st.modDeaf });
            send(ws, 'VOICE_JOINED', { channel_id: c, peers: [...voice.get(c).keys()].filter(x => x !== uid), sfu, rejoin: true });
          }).catch(e => { console.error('sfu rejoin', e.message); if (voice.get(c)?.get(uid) === st) send(ws, 'SFU_RESET', { channel_id: c, reason: 'rejoin_failed' }); });
          break;
        }
        case 'SFU': { // sinalização do SFU: requisição/resposta
          const c = currentVoice(uid), rid = d.rid;
          if (!c || voice.get(c).get(uid).ws !== ws) return send(ws, 'SFU_RES', { rid, error: 'fora da sala' });
          { const me = voice.get(c).get(uid); // sem a permissão Vídeo da sala: nada de câmera nem tela
            if (me.noVideo && (d.op === 'native_start' || (d.op === 'produce' && String(d.source) !== 'mic'))) { send(ws, 'SFU_RES', { rid, error: 'Você não tem permissão de vídeo nesta sala (câmera e transmissão de tela)' }); break; } }
          if (d.op === 'native_start') { // transmissão a 120 fps pelo programa nativo do app desktop (só o vídeo; áudio segue pelo WebRTC)
            startNative(uid, c, true, Math.max(1, Math.min(3, d.layers | 0 || 1))).then(n => send(ws, 'SFU_RES', { rid, data: nativeOut(n, null) }), e => send(ws, 'SFU_RES', { rid, error: e.message }));
            break;
          }
          if (d.op === 'native_stop') { if (!d.producer_id || natives.get(uid)?.producer.id === String(d.producer_id)) endNative(uid, 'stopped'); send(ws, 'SFU_RES', { rid, data: {} }); break; }
          sfuRequest(c, uid, String(d.op), d).then(data => send(ws, 'SFU_RES', { rid, data }), e => send(ws, 'SFU_RES', { rid, error: e.message }));
          break;
        }
        case 'MUSIC': { // bot de música: tocar, pular, pausar, remover da fila, tirar da chamada
          const c = currentVoice(uid); if (!c) return;
          musicHandle(uid, c, d).then(data => send(ws, 'MUSIC_RES', { rid: d.rid, data }), e => send(ws, 'MUSIC_RES', { rid: d.rid, error: e.message }));
          break;
        }
        case 'WATCH': { // Watch Together: comandos, relatórios do player e relógio comum (server/watch.js)
          const c = currentVoice(uid);
          if (d.op === 'clock') { send(ws, 'WATCH_RES', { rid: d.rid, data: { t: Date.now(), t0: d.t0 } }); break; }
          if (!c || voice.get(c).get(uid).ws !== ws) { if (d.rid) send(ws, 'WATCH_RES', { rid: d.rid, error: 'Entre na chamada para usar o Watch Together', code: 'not_in_room' }); break; }
          watch.handle(uid, c, d).then(data => { if (d.rid) send(ws, 'WATCH_RES', { rid: d.rid, data }); }, e => { if (d.rid) send(ws, 'WATCH_RES', { rid: d.rid, error: e.message, code: e.code }); });
          break;
        }
        case 'SOUNDBOARD': { // toca um som para todos na sala de voz
          const c = currentVoice(uid); if (!c) return;
          const url = String(d.url || ''); if (!url.startsWith('/files/')) return;
          if (Date.now() - (ws.lastSb || 0) < 1200) return; ws.lastSb = Date.now();
          const msg = { user_id: uid, channel_id: c, url, volume: Math.max(1, Math.min(200, +d.volume || 100)), name: clean(d.name, 32), emoji: clean(d.emoji, 16) };
          for (const [, st] of voice.get(c)) send(st.ws, 'SOUNDBOARD', msg);
          break;
        }
        case 'STREAM_WATCH': { // quem assiste à transmissão de quem
          const c = currentVoice(uid); if (!c) return;
          const target = String(d.target || ''), room = voice.get(c);
          if (target === uid || !room.get(target)?.screen) return;
          const k = c + ':' + target, set = watchers.get(k) || new Set();
          if (d.watching) set.add(uid); else set.delete(uid);
          if (set.size) watchers.set(k, set); else watchers.delete(k);
          pushViewers(c, target);
          break;
        }
        case 'ROOM_ACT': { // abre/fecha a lousa ou o editor de código para a sala toda
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c), on = !!d.on;
          if (d.act === 'wb') { a.wb = on; if (!on) delete a.boards.wb; }
          else if (d.act === 'code') a.code = on ? (a.code || { text: '', lang: 'javascript' }) : null;
          else return;
          roomSend(c, 'ROOM_STATE', actState(c));
          break;
        }
        case 'ROOM_SPOTLIGHT': { // destaca uma transmissão/câmera para a sala toda (quem quiser acompanha); d.key = 's:<uid>' | 'c:<uid>' | null
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c), key = d.key == null ? null : String(d.key);
          if (key !== null) { const m = /^([sc]):(.+)$/.exec(key), st = m && voice.get(c).get(m[2]); if (!st || (m[1] === 's' ? !st.screen : !st.video)) return; }
          if (ws.lastSpot && Date.now() - ws.lastSpot < 500) return; ws.lastSpot = Date.now();
          a.spot = key; a.spotBy = key ? uid : null;
          roomSend(c, 'ROOM_STATE', actState(c));
          break;
        }
        case 'ROOM_DRAW': { // traços da lousa / anotações sobre uma transmissão
          const c = currentVoice(uid); if (!c) return;
          const board = String(d.board || ''); if (!BOARD_OK(board)) return;
          const a = actOf(c); if (board === 'wb' && !a.wb) return;
          const list = a.boards[board] || (a.boards[board] = []); let out = null, ids;
          if (d.op === 'clear') { a.boards[board] = []; }
          else if (d.op === 'erase' && Array.isArray(d.ids)) { const gone = new Set(d.ids.slice(0, 200).map(x => String(x).slice(0, 40))); ids = [...gone]; a.boards[board] = list.filter(s => !gone.has(s.id)); }
          else if (d.op === 'undo') { const i = list.findLastIndex(s => s.uid === uid); if (i >= 0) list.splice(i, 1); }
          else if (d.op === 'stroke' && d.stroke && Array.isArray(d.stroke.pts)) {
            const id = String(d.stroke.id || '').slice(0, 40), pts = d.stroke.pts.slice(0, 200).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
            let s = list.find(x => x.id === id && x.uid === uid);
            if (!s) { s = { id, uid, color: /^#[0-9a-f]{6}$/i.test(d.stroke.color) ? d.stroke.color : '#ffffff', w: Math.max(1, Math.min(40, +d.stroke.w || 4)), pts: [] }; list.push(s); if (list.length > 400) list.shift(); }
            if (s.pts.length < 4000) s.pts.push(...pts);
            out = { id, color: s.color, w: s.w, pts };
          } else return;
          roomSend(c, 'ROOM_DRAW', { channel_id: c, board, op: d.op, stroke: out, ids, user_id: uid }, uid);
          break;
        }
        case 'ROOM_CODE': {
          const c = currentVoice(uid); if (!c) return;
          const a = actOf(c); if (!a.code) return;
          a.code = { text: String(d.text ?? '').slice(0, 200000), lang: String(d.lang || 'javascript').slice(0, 20) };
          roomSend(c, 'ROOM_CODE', { channel_id: c, ...a.code, user_id: uid }, uid);
          break;
        }
        case 'ACTIVITY_LOCAL': { // jogo aberto no PC, detectado pelo app desktop: { game: { id, title, icon?: PNG base64, steam?: appid } | null }
          if (Date.now() - (ws.lastAct || 0) < 3000) return; ws.lastAct = Date.now();
          const gid = String(d.game?.id || '').toLowerCase().replace(/[^a-z0-9._ -]/g, '').trim().slice(0, 60), title = clean(d.game?.title, 80);
          if (!gid || !title) { ws.localGame = null; ws.localIcon = null; activity.reportLocal(uid, null); break; }
          // o ícone vem só na primeira vez (por conexão e jogo); depois vale o que já foi mandado
          const steam = /^\d{1,10}$/.test(String(d.game.steam || '')) ? String(d.game.steam) : null;
          // anticheat (Easy Anti-Cheat, BattlEye) ou Java abrindo o jogo: o ícone do executável é o deles, não o do jogo
          const wrapper = WRAPPER_EXE.test(gid), known = knownGame({ id: gid, title, steam });
          let icon = d.game.icon ? saveGameIcon(d.game.icon) : (ws.localGame === gid ? ws.localIcon : null);
          if (wrapper) icon = null;
          ws.localGame = gid; ws.localIcon = icon;
          if (icon) run('UPDATE game_icons SET used_at=? WHERE hash=?', Date.now(), icon);
          // o nome certo e a arte: catálogo (Valorant, LoL, Minecraft…), o nome da loja da Steam pelo número do jogo, ou
          // o jogo procurado pelo nome na Steam (EA app, Battle.net, Epic: The Sims 4). O título da janela pode ser um
          // aviso ("GPU drivers are out of date") ou o nome interno do motor ("Pagoda").
          const report = (r) => { if (ws.localGame !== gid) return; const k = r.known || known?.key; activity.reportLocal(uid, { id: wrapper ? (k || (r.steam ? 'steam-' + r.steam : gid)) : gid, title: r.title, icon, steam: r.steam || null, ...(k ? { known: k } : {}) }); };
          const key = gid + '|' + title + '|' + (steam || ''), done = localNames.get(key);
          if (done) { report(done); break; }
          // espera até 5 s pela loja; se demorar, publica o que tem e corrige sozinho quando a resposta chegar
          let sent = false;
          const timer = setTimeout(() => { sent = true; report({ title: known?.title || title, steam: steam || known?.steam || null }); }, 5000);
          resolveLocalGame(title, steam, known).then(r => { localNames.set(key, r); if (localNames.size > 2000) localNames.delete(localNames.keys().next().value); clearTimeout(timer); if (!sent || r.title !== title || r.steam !== steam) report(r); });
          break;
        }
        // conexão nova depois de uma queda: continua a mesma sessão de voz (ver holdVoice), sem sair nem entrar para ninguém
        case 'VOICE_RESUME': {
          const c = currentVoice(uid), st = c && voice.get(c).get(uid), want = String(d?.channel_id || '');
          // outra conexão viva (outro aparelho) está com a sala: não toma o lugar dela
          if (!st || c !== want || (st.ws !== ws && st.ws.readyState === 1)) { send(ws, 'VOICE_RESUMED', { channel_id: want, ok: false }); break; }
          clearTimeout(st.dropT); st.dropT = null; st.ws = ws;
          send(ws, 'VOICE_RESUMED', { channel_id: c, ok: true });
          remote.resync(uid); // jogar junto / controle: o app perdeu o estado das sessões na queda
          break;
        }
        case 'VOICE_LEAVE': { const c = currentVoice(uid); if (c) leaveVoice(uid, c); break; }
        case 'VOICE_STATE': {
          const c = currentVoice(uid); if (!c) return;
          const st = voice.get(c).get(uid), before = JSON.stringify(vsObj(c, uid, st));
          for (const k of ['mute', 'deaf', 'video', 'screen', 'hold', 'mirror']) if (typeof d[k] === 'boolean') st[k] = d[k]; if (st.noVideo) st.video = st.screen = false;
          if (d.screenTitle !== undefined) st.screenTitle = st.screen && typeof d.screenTitle === 'string' ? clean(d.screenTitle, 80) || null : null; // nome do jogo transmitido
          if (!st.screen) st.screenTitle = null;
          st.screenNote = st.screen && ['min', 'closed', 'away'].includes(d.screenNote) ? d.screenNote : null; // janela transmitida minimizada/fechada/jogo fora da tela (aviso para quem assiste)
          // efeito de voz: só nomes conhecidos e no máximo 1 troca a cada 0,5 s (quem ouve aplica; ver public/voicefx.js)
          if (d.fx !== undefined && Date.now() - (st.fxAt || 0) > 500) { const fx = VOICE_FX.has(d.fx) ? d.fx : null; if (fx !== (st.fx || null)) { st.fx = fx; st.fxAt = Date.now(); } }
          if (!st.screen && acts.get(c)?.boards['s:' + uid]) { delete acts.get(c).boards['s:' + uid]; roomSend(c, 'ROOM_DRAW', { channel_id: c, board: 's:' + uid, op: 'clear', user_id: uid }); }
          { const a = acts.get(c); if (a?.spot && (!st.screen && a.spot === 's:' + uid || !st.video && a.spot === 'c:' + uid)) { a.spot = a.spotBy = null; roomSend(c, 'ROOM_STATE', actState(c)); } }
          if (!st.screen && watchers.has(c + ':' + uid)) { watchers.delete(c + ':' + uid); pushViewers(c, uid); }
          if (!st.screen) remote.onScreenOff(uid); // parou de transmitir: controle remoto acaba
          if (JSON.stringify(vsObj(c, uid, st)) === before) break; // nada mudou: não manda para o servidor inteiro
          const ch = get('SELECT * FROM channels WHERE id=?', c);
          dispatch(channelAudience(ch), 'VOICE_STATE', { ...vsObj(c, uid, st), guild_id: ch.guild_id });
          break;
        }
        case 'REMOTE_REQUEST': case 'REMOTE_ANSWER': case 'REMOTE_INPUT': case 'REMOTE_STOP': case 'REMOTE_PERMS': case 'REMOTE_INVITE': case 'REMOTE_JOIN': case 'REMOTE_PING': case 'REMOTE_PONG': {
          const c = currentVoice(uid);
          if (msg.t !== 'REMOTE_STOP' && (!c || voice.get(c).get(uid).ws !== ws)) { if (!['REMOTE_INPUT', 'REMOTE_PING', 'REMOTE_PONG'].includes(msg.t)) send(ws, 'REMOTE_ERROR', { error: 'Entre na sala de voz neste aparelho' }); break; }
          const perms = { mouse: d.mouse === true, keyboard: d.keyboard === true, gamepad: d.gamepad === true };
          const r = msg.t === 'REMOTE_REQUEST' ? remote.request(uid, String(d.to || ''), d.kind === 'pad' || d.kind === 'play' ? d.kind : 'control')
            : msg.t === 'REMOTE_ANSWER' ? remote.answer(uid, d.id, { accept: d.accept === true, ...perms, capable: d.capable !== false, rel: d.rel === true })
            : msg.t === 'REMOTE_INPUT' ? remote.input(uid, d.id, d.ev)
            : msg.t === 'REMOTE_PERMS' ? remote.setPerms(uid, d.id, perms)
            : msg.t === 'REMOTE_INVITE' ? remote.invite(uid, String(d.to || ''), { ...perms, rel: d.rel === true })
            : msg.t === 'REMOTE_JOIN' ? remote.joinInvite(uid, d.id, d.accept === true)
            : msg.t === 'REMOTE_PING' || msg.t === 'REMOTE_PONG' ? remote.echo(uid, d.id, msg.t === 'REMOTE_PONG' ? 'pong' : 'ping', d)
            : remote.stop(uid, d.id, d.reason === 'panic' ? 'panic' : 'stopped');
          if (r.error) send(ws, 'REMOTE_ERROR', { error: r.error });
          break;
        }
        case 'VOICE_SIGNAL': { // retransmite SDP/ICE apenas entre membros da mesma sala
          const c = currentVoice(uid); if (!c) return;
          const target = voice.get(c).get(String(d.to));
          if (target) send(target.ws, 'VOICE_SIGNAL', { from: uid, data: d.data });
          break;
        }
      }
    } catch (e) { console.error('ws', e); }
  };
  ws.on('close', (code, reason) => {
    clearTimeout(ws.laterT);
    const set = conns.get(uid); set?.delete(ws); legacyConns.delete(ws); if (ws.view) setView(ws, null);
    const c = currentVoice(uid);
    const vst = c && voice.get(c).get(uid);
    if (vst && vst.ws === ws && code === 4000) leaveVoice(uid, c, 'drop'); // a página fechou (app fechado, aba fechada, F5): sai na hora
    else if (vst && vst.ws === ws && code === 4002) leaveVoice(uid, c, 'reload'); // recarregando para a versão nova: volta sozinha em segundos (os outros não ouvem sair/entrar)
    else if (vst && vst.ws === ws) {
      holdVoice(uid, c, vst);
      // por que caiu (para achar quedas que se repetem): código do fechamento, quem fechou e há quanto tempo estava aberta
      console.log(`[voz] conexão de quem está em chamada caiu: código ${code}${ws.lcWhy ? ', ' + ws.lcWhy : ''}${reason?.length ? ', motivo ' + String(reason).slice(0, 80) : ''}; aberta havia ${Math.round((Date.now() - ws.t0) / 1000)} s; aguardando ${VOICE_GRACE_MS / 1000} s pela volta`);
    }
    if (set && !set.size) { conns.delete(uid); broadcastStatus(uid); social.onDisconnect(uid); }
    else { if (ws.active) pushDevices(uid); pushPlatforms(uid); }
    if (ws.localGame && ![...(set || [])].some(o => o.localGame)) activity.clearLocal(uid); // o app desktop que informava o jogo fechou
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.lcWhy ||= 'o aparelho não respondeu ao ping do servidor em 30 s'; ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 30000);

// HTTPS com certificado autoassinado (necessário para microfone/câmera/tela fora de localhost)
function loadTls() {
  const keyP = process.env.TLS_KEY || path.join(DATA_DIR, 'key.pem'), certP = process.env.TLS_CERT || path.join(DATA_DIR, 'cert.pem');
  if (!fs.existsSync(keyP) || !fs.existsSync(certP)) {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => `IP:${i.address}`);
    const san = ['DNS:localhost', `DNS:${os.hostname()}`, ...ips, ...(process.env.TLS_SAN ? process.env.TLS_SAN.split(',') : [])].join(',');
    // No Windows o openssl costuma não estar no PATH; tenta também o que acompanha o Git
    const gitDirs = ['C:\\Program Files\\Git', 'C:\\Program Files (x86)\\Git'];
    const bins = ['openssl', ...(process.platform === 'win32' ? gitDirs.flatMap(d => [`${d}\\usr\\bin\\openssl.exe`, `${d}\\mingw64\\bin\\openssl.exe`]) : [])];
    let done = false;
    for (const bin of bins) {
      if (bin !== 'openssl' && !fs.existsSync(bin)) continue;
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyP, '-out', certP, '-days', '3650', '-subj', '/CN=Resenha', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
        console.log('  Certificado HTTPS autoassinado gerado em', DATA_DIR);
        done = true; break;
      } catch { /* tenta o próximo */ }
    }
    if (!done) { console.log('  (openssl não encontrado: HTTPS desativado. Instale openssl ou forneça TLS_KEY/TLS_CERT)'); return null; }
  }
  return { key: fs.readFileSync(keyP), cert: fs.readFileSync(certP) };
}

// ---- app reiniciado com a voz num processo próprio (server/voz.js): as chamadas continuaram lá ----
// Retrato do estado de cada pessoa nas salas (mudo, tela, cargos, desde quando…), mandado ao processo da voz a cada 3 s
// quando muda e no encerramento. Quando o app volta, refaz as salas com ele; cada pessoa fica "segurando o lugar" até o
// app dela retomar a sessão (VOICE_RESUME) ou VOICE_RESTORE_GRACE_MS passar (aí sai, como uma queda).
const DEAD_WS = { readyState: 3, send() { }, close() { }, terminate() { } };
const RESTORE_GRACE_MS = +process.env.VOICE_RESTORE_GRACE_MS || 60000;
function voiceSnapshot() {
  const rooms = {};
  for (const [cid, room] of voice) {
    const peers = {};
    for (const [uid, st] of room) {
      const o = {};
      for (const [k, v] of Object.entries(st)) { if (k === 'ws' || k === 'dropT' || typeof v === 'function') continue; try { JSON.stringify(v); o[k] = v; } catch { } }
      peers[uid] = o;
    }
    rooms[cid] = { start: roomStart.get(cid) || 0, peers };
  }
  return { rooms };
}
if (sfuSplit) {
  let lastSnap = '';
  // mesmo sem mudança, um retrato a cada 20 s: o processo de voz só limpa quem sobrou na sala com um retrato recente (< 30 s),
  // e numa chamada parada o retrato envelhecia e a limpeza nunca rodava
  let snapAt = 0;
  setInterval(() => { const s = voiceSnapshot(), k = JSON.stringify(s); if (k === lastSnap && Date.now() - snapAt < 20e3) return; lastSnap = k; snapAt = Date.now(); sfuSnapshot(s).catch(() => { lastSnap = ''; }); }, 3000).unref();
}
async function restoreVoice() {
  if (!sfuSplit) return;
  const s = await sfuRestore().catch((e) => { console.log('  Voz: não consegui pegar o estado das salas:', e.message); return null; });
  if (!s) return;
  let n = 0;
  for (const { cid, peers } of s.rooms || []) {
    const ch = get('SELECT * FROM channels WHERE id=?', cid), saved = s.snap?.rooms?.[cid];
    for (const uid of peers) {
      const meta = saved?.peers?.[uid];
      // bot de música (para junto com o app), sala apagada ou conta que não existe: sai da sala lá também
      if (!ch || meta?.bot || String(uid).startsWith('bot_') || !get('SELECT id FROM users WHERE id=?', uid)) { sfuLeave(cid, uid); continue; }
      if (!voice.has(cid)) { voice.set(cid, new Map()); roomStart.set(cid, saved?.start || Date.now()); }
      const st = { mute: false, deaf: false, video: false, screen: false, ...meta, ...voicePermsOf(ch, uid), ws: DEAD_WS, at: meta?.at || Date.now() };
      voice.get(cid).set(uid, st);
      sfuAdopt(cid, uid, sfuNotify(cid, uid));
      holdVoice(uid, cid, st, RESTORE_GRACE_MS); n++;
    }
  }
  for (const nh of s.natives || []) { if (voice.get(nh.cid)?.has(nh.uid)) adoptNative(nh.uid, nh); else nh.close(); }
  if (n) console.log(`  Voz: ${n} pessoa(s) continuam nas chamadas depois do reinício do app; cada app retoma a própria sessão`);
}

await startSfu();
await restoreVoice();
activity.start();
server.listen(PORT, HOST, () => {
  console.log(`\n  Resenha rodando`);
  const tls = process.env.HTTPS === '0' ? null : loadTls();
  const addrs = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l || []).filter(i => i.family === 'IPv4' && !i.internal).map(i => [n, i.address]));
  for (const [n, a] of addrs) console.log(`   http://${a}:${PORT}   (${n})`);
  if (tls) {
    const hs = https.createServer(tls, app);
    hs.on('upgrade', onUpgrade);
    hs.listen(HTTPS_PORT, HOST, () => {
      console.log('   --- HTTPS (use este para voz/vídeo/tela; aceite o aviso do certificado) ---');
      for (const [n, a] of addrs) console.log(`   https://${a}:${HTTPS_PORT}   (${n})`);
      console.log('');
    });
    hs.on('error', (e) => console.error('HTTPS erro:', e.message));
  }
});

// Encerramento: o mediasoup registra os próprios ouvintes de SIGTERM/SIGINT (só fecha o worker), o que desliga
// a saída padrão do Node; sem isto o processo continuaria de pé e o `docker stop` esperaria 10 s até matar à força.
let stopping = false;
function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`  ${sig} recebido: encerrando`);
  setTimeout(() => process.exit(0), 3000).unref(); // não espera conexões presas
  try { musicStopAll(); } catch { }
  try { watch.stopAll(); } catch { }
  try { activity.stop(); } catch { }
  try { voiceSessions.stop(); } catch { } // o tempo de quem está em chamada fica gravado (a sessão continua no app novo)
  // avisa antes de fechar: o app mostra "Servidor atualizando, volta em segundos" em vez de "Conexão perdida"
  // (código 1012 = reinício do serviço; o aviso vai junto para clientes que não leem o código)
  for (const c of wss.clients) try { c.send(JSON.stringify({ t: 'SERVER_RESTART', d: {} })); c.close(1012, 'Servidor reiniciando'); } catch { }
  try { fs.rmSync(path.join(DATA_DIR, 'em-chamada.json'), { force: true }); } catch { }
  // voz num processo próprio: o retrato final das salas vai para lá (o app novo continua de onde este parou)
  const snapP = sfuSplit ? Promise.race([sfuSnapshot(voiceSnapshot()).catch(() => { }), new Promise(r => setTimeout(r, 800))]) : null;
  server.close();
  // espera os avisos saírem (até 0,5 s; antes o processo saía na hora e os apps só viam a conexão cair)
  const t0 = Date.now(), end = async () => { await snapP; closeDb(); process.exit(0); };
  const tick = () => ([...wss.clients].every(c => c.readyState === 3) || Date.now() - t0 > 500 ? end() : setTimeout(tick, 25));
  tick();
}
// Atualização só da interface (public/), sem reiniciar e sem derrubar ninguém: deploy/umbrel.sh troca a pasta e manda
// SIGHUP. A versão nova vai para todas as páginas abertas (UI_VERSION); cada uma recarrega quando não atrapalha
// (public/uiupdate.js). Sem esta linha, SIGHUP encerraria o processo.
process.on('SIGHUP', () => {
  if (!ui) return;
  try {
    if (!ui.reload()) return console.log('  SIGHUP: interface sem mudança');
    console.log(`  Interface atualizada sem reiniciar: versão ${ui.version}`);
    for (const c of wss.clients) send(c, 'UI_VERSION', { v: ui.version });
  } catch (e) { console.log('  SIGHUP: falha ao recarregar a interface', e.message); }
});
// cópias automáticas do banco e checkpoint do WAL (server/backup.js)
startBackups(db, DATA_DIR, { dbProblem });
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));