// Importar a ESTRUTURA de um servidor do Discord (categorias, canais, cargos e permissões) a partir de um link de modelo
// de servidor (discord.new/CODIGO ou discord.com/template/CODIGO). O modelo é público na API do Discord e não precisa de
// bot nem de login: no Discord, Configurações do servidor → Modelo de servidor → Gerar modelo, e cola o link aqui.
// As mensagens continuam pelo importador de histórico (server/importer.js).
//
// O que entra (acrescentado ao servidor; nada do que já existe é apagado nem mudado):
// - cargos, na mesma ordem (abaixo dos que já existem), com cor e as permissões que têm equivalente aqui;
// - categorias e canais de texto, voz (palco vira voz), anúncios, fórum e mídia (galeria), na mesma ordem, com tópico e
//   limite de pessoas das salas;
// - permissões por canal/categoria (cargos e @everyone) nas que têm equivalente; canal que segue a categoria continua
//   sincronizado.
// Fica de fora (avisado no resumo): emojis (o modelo não traz), membros e mensagens, "ver canal" (aqui não há canal oculto:
// negar "ver" vira negar escrever/entrar), as permissões do @everyone do Discord e tipos de canal sem equivalente.
//
// Rotas (só quem é administrador do servidor ou o dono):
//   POST /api/guilds/:id/discord-structure/preview { template } -> { name, counts, warnings }
//   POST /api/guilds/:id/discord-structure         { template, roles?: bool, channels?: bool } -> { created: {...}, warnings }
import { LIMITS } from './limits.js';
const API = () => (process.env.DISCORD_API || 'https://discord.com/api/v10').replace(/\/$/, '');

// permissões do Discord (bits) -> as do Resenha
const DP = (n) => 1n << BigInt(n);
const GUILD_MAP = [
  [DP(3), 1],                              // ADMINISTRATOR -> ADMIN
  [DP(5), 2],                              // MANAGE_GUILD
  [DP(4), 4],                              // MANAGE_CHANNELS
  [DP(13), 8],                             // MANAGE_MESSAGES
  [DP(1), 16],                             // KICK_MEMBERS
  [DP(0), 32],                             // CREATE_INSTANT_INVITE
  [DP(28), 64],                            // MANAGE_ROLES
  [DP(2), 128],                            // BAN_MEMBERS
  [DP(40), 256],                           // MODERATE_MEMBERS (castigo)
  [DP(22) | DP(23) | DP(24), 512],         // MUTE/DEAFEN/MOVE_MEMBERS -> Moderar voz
  [DP(7), 1024],                           // VIEW_AUDIT_LOG -> ver o registro
  [DP(8), 2048],                           // PRIORITY_SPEAKER -> Orador prioritário
];
const VIEW = DP(10);
const CH_MAP = [ // CH: SEND 1, ATTACH 2, REACT 4, CONNECT 8, SPEAK 16, VIDEO 32
  [DP(11), 1], [DP(15), 2], [DP(6), 4], [DP(20), 8], [DP(21), 16], [DP(9), 32],
];
const big = (v) => { try { return BigInt(String(v ?? '0')); } catch { return 0n; } };
export function guildPerms(v) { const b = big(v); let p = 0; for (const [d, r] of GUILD_MAP) if (b & d) p |= r; return p; }
// ajuste de canal do Discord -> { allow, deny } daqui. Negar "ver" fecha escrever (texto) ou entrar (voz)
export function chOverwrite(allow, deny, voice) {
  const a = big(allow), d = big(deny); let A = 0, D = 0;
  for (const [x, r] of CH_MAP) { if (a & x) A |= r; if (d & x) D |= r; }
  if (d & VIEW) D |= voice ? 8 : 1;
  D &= ~A;
  return { allow: A, deny: D };
}
// tipos do Discord -> daqui: 0 texto, 2 voz, 4 categoria, 5 anúncios, 13 palco (vira voz), 15 fórum, 16 mídia (galeria)
const TYPE = { 0: 0, 2: 2, 4: 4, 5: 5, 13: 2, 15: 15, 16: 16 };

export function templateCode(s) {
  const t = String(s || '').trim();
  const m = t.match(/(?:discord\.new\/|discord(?:app)?\.com\/template\/)([A-Za-z0-9-]{2,64})/i) || t.match(/^([A-Za-z0-9-]{2,64})$/);
  return m ? m[1] : null;
}
async function fetchTemplate(code) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10e3);
  try {
    const r = await fetch(`${API()}/guilds/templates/${encodeURIComponent(code)}`, { signal: ctl.signal, headers: { 'user-agent': 'Resenha (importar estrutura)' } });
    if (r.status === 404) throw new Error('Modelo não encontrado: confira o link (ele some se o dono apagar o modelo)');
    if (!r.ok) throw new Error(`O Discord respondeu ${r.status}. Tente de novo em alguns minutos`);
    const txt = await r.text(); if (txt.length > 2e6) throw new Error('Modelo grande demais');
    const j = JSON.parse(txt); if (!j?.serialized_source_guild) throw new Error('Resposta inesperada do Discord');
    return j;
  } catch (e) { throw e.name === 'AbortError' ? new Error('O Discord não respondeu a tempo') : e; } finally { clearTimeout(timer); }
}

// modelo -> plano (o que será criado) e avisos
export function planOf(tpl, { clean }) {
  const src = tpl.serialized_source_guild || {}, warnings = [];
  const roles = (src.roles || []).filter(r => String(r.id) !== '0' && !r.managed).map(r => ({
    key: String(r.id), name: clean(r.name, 50) || 'cargo', color: Number.isFinite(+r.color) && +r.color ? '#' + (+r.color).toString(16).padStart(6, '0') : '#99aab5',
    perms: guildPerms(r.permissions), position: +r.position || 0 })).sort((a, b) => b.position - a.position); // de cima para baixo
  const everyone = (src.roles || []).find(r => String(r.id) === '0');
  if (everyone && guildPerms(everyone.permissions) & ~32) warnings.push('As permissões do @everyone do Discord não foram copiadas (aqui todo mundo começa com o básico).');
  let skipped = 0, viewDeny = false;
  const chans = [];
  for (const c of src.channels || []) {
    const type = TYPE[c.type]; if (type === undefined) { skipped++; continue; }
    const voice = type === 2;
    const ows = (c.permission_overwrites || []).filter(o => +o.type === 0 || o.type === 'role').map(o => {
      if (big(o.deny) & VIEW) viewDeny = true;
      return { key: String(o.id), ...chOverwrite(o.allow, o.deny, voice) };
    }).filter(o => o.allow || o.deny);
    chans.push({ key: String(c.id), type, name: (clean(c.name, 100) || 'canal'), topic: clean(c.topic || '', 1024), parent: c.parent_id != null ? String(c.parent_id) : null,
      position: +c.position || 0, limit: voice ? Math.max(0, Math.min(99, +c.user_limit || 0)) : 0, ows, stage: c.type === 13 });
  }
  // ordem como no Discord: categorias pela posição; dentro de cada uma, texto antes de voz e depois a posição
  const cats = chans.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
  const order = (list) => list.sort((a, b) => ((a.type === 2) - (b.type === 2)) || a.position - b.position);
  const ordered = [...order(chans.filter(c => c.type !== 4 && !cats.some(k => k.key === c.parent)))];
  for (const k of cats) ordered.push(k, ...order(chans.filter(c => c.type !== 4 && c.parent === k.key)));
  if (skipped) warnings.push(`${skipped} canal(is) de um tipo que o Resenha não tem ficaram de fora.`);
  if (chans.some(c => c.stage)) warnings.push('Canais de palco viraram salas de voz.');
  if (viewDeny) warnings.push('Canais escondidos no Discord ("ver canal" negado) aqui ficam visíveis, mas sem poder escrever ou entrar.');
  warnings.push('Emojis, membros e mensagens não vêm no modelo. As mensagens entram pelo "Importar histórico do Discord" de cada canal.');
  const counts = { roles: roles.length, categories: cats.length, text: ordered.filter(c => [0, 5, 15, 16].includes(c.type)).length, voice: ordered.filter(c => c.type === 2).length };
  return { name: clean(src.name || tpl.name, 100), roles, channels: ordered, counts, warnings };
}

export function mountDiscordImport(app, d) {
  const { auth, bad, db, all, get, run, newId, can, P, clean, dispatch, guildMemberIds, audit, chp, refreshVoicePerms } = d;
  const busy = new Set();
  const gate = (req, res) => {
    const g = get('SELECT * FROM guilds WHERE id=?', req.params.id);
    if (!g || !can(g.id, req.uid, P.ADMIN)) { bad(res, 'Só o dono e os administradores importam a estrutura do servidor', 403); return null; }
    const code = templateCode(req.body?.template); if (!code) { bad(res, 'Cole o link do modelo do Discord (discord.new/…)'); return null; }
    return { g, code };
  };
  app.post('/api/guilds/:id/discord-structure/preview', auth, async (req, res) => {
    try {
      const x = gate(req, res); if (!x) return;
      const plan = planOf(await fetchTemplate(x.code), { clean });
      res.json({ name: plan.name, counts: plan.counts, warnings: plan.warnings, roles: plan.roles.map(r => ({ name: r.name, color: r.color })), channels: plan.channels.map(c => ({ name: c.name, type: c.type, parent: !!c.parent })) });
    } catch (e) { if (!res.headersSent) bad(res, e.message || 'Não deu para ler o modelo', 422); }
  });
  app.post('/api/guilds/:id/discord-structure', auth, async (req, res) => {
    const x = gate(req, res); if (!x) return;
    const gid = x.g.id;
    if (busy.has(gid)) return bad(res, 'Já tem uma importação em andamento neste servidor', 409);
    busy.add(gid);
    try {
      const plan = planOf(await fetchTemplate(x.code), { clean });
      const wantRoles = req.body?.roles !== false, wantChannels = req.body?.channels !== false;
      // limites do servidor antes de começar (não entra pela metade)
      const nRoles = get('SELECT COUNT(*) n FROM roles WHERE guild_id=?', gid).n, nCh = get('SELECT COUNT(*) n FROM channels WHERE guild_id=? AND type<>11', gid).n;
      const nCat = get('SELECT COUNT(*) n FROM channels WHERE guild_id=? AND type=4', gid).n;
      const L = LIMITS;
      if (wantRoles && nRoles + plan.roles.length > L.roles) return bad(res, `Passaria do limite de ${L.roles} cargos por servidor`, 409);
      if (wantChannels && nCh + plan.channels.length > L.channels) return bad(res, `Passaria do limite de ${L.channels} canais por servidor`, 409);
      if (wantChannels && nCat + plan.counts.categories > L.categories) return bad(res, `Passaria do limite de ${L.categories} categorias por servidor`, 409);
      const roleId = new Map(), chId = new Map(), now = Date.now(), made = { roles: 0, categories: 0, channels: 0, overwrites: 0 };
      db.exec('BEGIN');
      try {
        if (wantRoles && plan.roles.length) {
          // entram abaixo dos que já existem, na ordem do Discord (o de cima com a maior posição entre os novos)
          const n = plan.roles.length;
          run('UPDATE roles SET position=position+? WHERE guild_id=?', n, gid);
          plan.roles.forEach((r, i) => { const id = newId(); roleId.set(r.key, id); run('INSERT INTO roles(id,guild_id,name,color,perms,position) VALUES(?,?,?,?,?,?)', id, gid, r.name, r.color, r.perms, n - i); made.roles++; });
        }
        if (wantChannels) {
          let pos = (get('SELECT MAX(position) m FROM channels WHERE guild_id=?', gid).m ?? 0) + 1;
          const target = (k) => (k === '0' ? 'everyone' : roleId.get(k));
          const owsOf = (c) => c.ows.map(o => ({ target: target(o.key), allow: o.allow, deny: o.deny })).filter(o => o.target);
          const sameOws = (a, b) => JSON.stringify([...a].sort((x, y) => x.target.localeCompare(y.target))) === JSON.stringify([...b].sort((x, y) => x.target.localeCompare(y.target)));
          for (const c of plan.channels) {
            const id = newId(), parent = c.type === 4 ? null : (c.parent && chId.get(c.parent)) || null;
            chId.set(c.key, id);
            run('INSERT INTO channels(id,guild_id,type,name,topic,position,parent_id,created_at) VALUES(?,?,?,?,?,?,?,?)', id, gid, c.type, c.name, c.topic, pos++, parent, now);
            if (c.type === 2 && c.limit) run('UPDATE channels SET user_limit=? WHERE id=?', c.limit, id);
            if (c.type === 15) run('UPDATE channels SET forum=? WHERE id=?', JSON.stringify({ tags: [], guidelines: c.topic || '' }), id);
            c.type === 4 ? made.categories++ : made.channels++;
            const mine = owsOf(c), pc = parent && plan.channels.find(k => k.key === c.parent);
            // canal com os mesmos ajustes da categoria: continua sincronizado (segue a categoria)
            if (parent && pc && sameOws(mine, owsOf(pc))) continue;
            if (mine.length) { chp.setOverwritesNoTx(id, gid, mine); made.overwrites += mine.length; }
            if (c.type !== 4 && parent) run('UPDATE channels SET perm_sync=0 WHERE id=?', id);
          }
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      // avisa os apps: cargos (todos, por causa das posições), canais e permissões
      const ids = guildMemberIds(gid);
      if (made.roles) for (const r of all('SELECT * FROM roles WHERE guild_id=?', gid)) dispatch(ids, 'ROLE_UPDATE', { guild_id: gid, role: r });
      for (const id of chId.values()) {
        const ch = get('SELECT * FROM channels WHERE id=?', id);
        dispatch(ids, 'CHANNEL_CREATE', ch);
        const ows = chp.overwrites(id); if (ows.length || ch.perm_sync === 0) dispatch(ids, 'CHANNEL_PERMS', { guild_id: gid, channel_id: id, overwrites: ows, perm_sync: ch.perm_sync ?? 1 });
      }
      if (made.channels || made.categories) refreshVoicePerms(gid);
      audit(gid, req.uid, 'guild_import', null, `estrutura do Discord (${plan.name || x.code}): ${made.roles} cargos, ${made.categories} categorias, ${made.channels} canais`);
      res.json({ created: made, warnings: plan.warnings });
    } catch (e) { if (!res.headersSent) bad(res, e.message || 'Não deu para importar', 422); } finally { busy.delete(gid); }
  });
}
