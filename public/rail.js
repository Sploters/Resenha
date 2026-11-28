// Trilho de servidores (barra da esquerda): servidores, conversas fixadas, cartão de quem está em call, menu do
// servidor, convidar e criar/entrar em servidor.
import { discordStructureModal } from './discordimport.js';
import { openMyMessages } from './mymessages.js';
import { h, icon, avatar, debounce, imgUrl, publicOrigin } from './util.js';
import { S, api, tryApi, user, member, nameOf, can, canInvite, PERM, dmPeer, toast, modal, confirmBox, promptBox, menu, savePrefs, chVisible } from './state.js';
import { chName } from './chnames.js';
import { sortable, reordering } from './reorder.js';
import { setLfgGuild } from './lfg.js';
import { track, flow } from './ux.js';
import { isRepMod, repModal, auditModal } from './mod.js';
import { voice, $, deferRender, logout } from './gateway.js';
import { ack } from './unread.js';
import { openSettings, go } from './nav.js';
import { toggleGlobalSearch, sideHidden, gFlyHide, gFlyCancel } from './gsearch.js';
import { renderSide } from './side.js';
import { favList, openFavs } from './favs.js';
import { channelModal } from './chmenu.js';
import { profile, pinnedDMs, dmWith, ensureDM, initialsOf, openDM, userMenu } from './usermenu.js';
import { jumpTo } from './msgactions.js';
import { openBoraModal } from './bora.js';
import { notifCard, inboxBadge, showInbox } from './inbox.js';
import { initFolders, folder, inAnyFolder, folderRailItem, moveMenuItems, refreshFolder, closeFolder, canJoin, join } from './gfolders.js';
initFolders({ change: () => { renderRail(); refreshFolder(); }, go: (gid) => { gFlyHide(); S.favMode = false; go(gid); } });
// ---------- trilho de servidores ----------
function guildUnread(g) { return g.channels.some(c => S.unread[c.id]); }
function guildMentions(g) { return g.channels.reduce((n, c) => n + (S.mentions[c.id] || 0), 0); }
export function renderRail() {
  if (deferRender(renderRail)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const rail = $('#rail'); if (!rail) return;
  if (reordering()) return; // arrastando um item: redesenha ao soltar
  document.getElementById('vcard')?.remove();
  const dmMentions = [...S.dms.keys()].reduce((n, id) => n + (S.mentions[id] || 0), 0);
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const wrap = (cls, tip, el, extra, id) => h('div.rail-wrap' + cls, { 'data-tip': tip, 'data-id': id || null }, el, extra);
  const badge = (n) => n > 0 ? h('div.badge', n > 99 ? '99+' : n) : null;
  // um botão só para a tela inicial (Amigos, Jogar e Descobrir em abas no topo, conversas na lista ao lado): a barra
  // fica para os servidores e as conversas fixadas
  // numa conversa (ou nos arquivos dela) o destaque fica só na própria conversa: o botão leva para os Amigos
  const meView = S.view.gid === '@me' && !S.favMode && S.view.kind !== 'dm' && !(S.view.kind === 'files' && S.view.dm);
  rail.replaceChildren(
    wrap('.rail-fly.rail-msgs' + (meView ? '.active' : ''), 'Amigos, conversas e jogos', h('div.rail-item.rail-tool', { onclick: () => openMeSection(), style: { fontSize: '0' } }, icon('dm', 26)), badge(dmMentions + pending)),
    wrap('.rail-fly' + (S.searchOpen ? '.active' : ''), 'Buscar em tudo (Ctrl+Shift+F)', h('div.rail-item.rail-tool', { 'data-fly': 'gs', onclick: () => toggleGlobalSearch(), style: { fontSize: '0' } }, icon('search', 26))),
    // canais favoritos (de qualquer servidor, juntos): aparece quando há pelo menos um
    favList().length > 0 && wrap('.rail-fly' + (S.favMode ? '.active' : '') + (!S.favMode && favList().some(f => S.unread[f.c]) ? '.unread' : ''), 'Canais favoritos',
      h('div.rail-item.rail-tool.fav-btn', { onclick: () => openFavs(), style: { fontSize: '0' } }, icon('star', 24)), badge(favList().reduce((n, f) => n + (S.mentions[f.c] || 0), 0))),
    // conversas fixadas: acesso rápido na barra
    ...pinnedDMs().map(uid => dmWith(uid)).filter(Boolean).map(dm => { const u = user(dmPeer(dm).id);
      return wrap('.raildm' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] && S.view.cid !== dm.id ? '.unread' : ''), u.display_name, h('div.rail-item', { onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, u.id) }, u.avatar ? h('img', { src: imgUrl(u.avatar, 48), alt: '', draggable: 'false' }) : initialsOf(u.display_name)), [h('div.rd-st.status.s-' + (u.status || 'offline')), badge(S.mentions[dm.id] || 0)], u.id); }),
    h('div.sep'),
    ...railGuilds().map(g => {
      if (g.folder) return folderRailItem(g.folder, { wrap, badge, activeGid: S.favMode ? null : S.view.gid });
      const rooms = voiceRooms(g);
      const w = wrap('.railg' + (S.view.gid === g.id && !S.favMode ? '.active' : '') + (guildUnread(g) && S.view.gid !== g.id ? '.unread' : ''), rooms.length ? null : g.name,
        h('div.rail-item', { 'data-fly': 'g', 'data-gid': g.id, onclick: () => { gFlyHide(); S.favMode = false; go(g.id); }, oncontextmenu: (e) => { gFlyCancel(); guildMenu(e, g); } }, g.icon ? h('img', { src: imgUrl(g.icon, 48), alt: '', draggable: 'false' }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)),
        badge(guildMentions(g)) || (rooms.length ? h('div.vbadge', { title: '' }, icon('voice', 12)) : null), g.id);
      if (rooms.length) { w.onmouseenter = () => { if (!sideHidden()) voiceCard(w, g); }; w.onmouseleave = () => document.getElementById('vcard')?.remove(); }
      return w;
    }),
    wrap('', 'Adicionar', h('div.rail-item.add', { onclick: addMenu, style: { fontSize: '0' } }, icon('plus', 24))),
    // caixa de entrada: no pé da barra, logo acima do seu perfil
    wrap('.rail-inbox', 'Caixa de entrada', h('div.rail-item.rail-tool.inbox-btn', { onclick: (e) => showInbox(e), style: { fontSize: '0' } }, icon('inbox', 24), inboxBadge())));
}
// ordem dos servidores na barra: a que você arrastou (fica na conta); servidores novos vão para o fim. Pastas (gfolders.js)
// entram na mesma ordem como 'f:<id>' ({ folder }); servidores dentro de uma pasta não aparecem soltos
function railGuilds() {
  const order = S.prefs.guildOrder || [], at = (id) => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  const tops = (Array.isArray(S.prefs.gfolders) ? S.prefs.gfolders : []).filter(f => !f.parent || !folder(f.parent)).map(f => ({ id: 'f:' + f.id, folder: f }));
  return [...tops, ...[...S.guilds.values()].filter(g => !inAnyFolder(g.id))].map((g, i) => [g, i]).sort((a, b) => (at(a[0].id) - at(b[0].id)) || (a[1] - b[1])).map(x => x[0]);
}
// segurar e arrastar: servidores trocam de lugar entre si, conversas fixadas entre si. Soltar um servidor no meio de outro
// cria uma pasta com os dois; no meio de uma pasta, entra nela
const railKey = (el) => el.dataset.id.startsWith('f:') ? el.dataset.id : 'g:' + el.dataset.id;
export function railSortable(rail) {
  sortable(rail, { items: '.rail-wrap.railg, .rail-wrap.raildm', axis: 'y', group: (el) => el.classList.contains('railg') ? 'g' : 'dm',
    combine: (el, to) => el.classList.contains('railg') && canJoin(railKey(el), railKey(to)),
    onCombine: (el, to) => { closeFolder(); join(railKey(el), railKey(to)); },
    onDrop: (ids, el) => {
      if (el.classList.contains('railg')) { closeFolder(); S.prefs.guildOrder = ids; } else S.prefs.pinnedDMs = ids;
      savePrefs(); renderRail(); if (!el.classList.contains('railg')) renderSide();
    } });
}
export function openMessages() { go('@me'); } // Mensagens e Amigos são uma tela só: amigos no meio, conversas na lista ao lado
export const inGames = () => S.view.gid === '@me' && (S.view.kind === 'lfg' || S.view.kind === 'discover' || S.view.kind === 'trophies' || S.view.kind === 'radar');
// ícone de mensagens da barra: Amigos no meio e as conversas na lista
function openMeSection() { if (S.view.kind === 'dm') track('back_to_friends', 'rail'); S.favMode = false; go('@me'); }
// salas de voz ocupadas de um servidor: [{ ch, users: [voiceState] }]
export const voiceRooms = (g) => g.channels.filter(c => c.type === 2 && chVisible(c)).map(ch => ({ ch, users: [...S.voice.values()].filter(v => v.channel_id === ch.id) })).filter(r => r.users.length);
// cartão ao passar o mouse no servidor: quem está em qual sala
// jogos que a galera do servidor mais joga (como no cartão do servidor no Discord): pedido no máximo a cada 10 min por
// servidor; quando chega, a lista redesenha. Sem jogos com gente suficiente, não aparece nada
const ggCache = new Map();
// onReady: chamado quando a lista chega (quem mostra redesenha); devolve a lista guardada (ou null enquanto carrega)
export function guildGames(g, onReady) {
  let c = ggCache.get(g.id);
  if ((!c || Date.now() - c.at > 10 * 60e3) && !c?.p) {
    const e = { at: c?.at || 0, list: c?.list || null, p: null }; ggCache.set(g.id, c = e);
    e.p = api('GET', `/guilds/${g.id}/games`).then(r => { e.list = r?.games || []; }).catch(() => { }).finally(() => { e.at = Date.now(); e.p = null; if (S.view.gid === g.id && e.list?.length) onReady?.(); });
  }
  return c.list?.length ? c.list : null;
}
function voiceCard(anchor, g) {
  document.getElementById('vcard')?.remove();
  const r = anchor.getBoundingClientRect();
  const card = h('div#vcard', { style: { top: Math.max(8, r.top) + 'px' } }, h('div.vct', g.name),
    voiceRooms(g).map(({ ch, users }) => h('div.vcroom', h('div.vcname', icon('voice', 14), h('span', chName(ch)), callTimer(users)),
      h('div.vcusers', users.map(v => h('span.vcu', { title: nameOf(v.user_id, g.id), oncontextmenu: (e) => userMenu(e, v.user_id, g.id) }, avatar(user(v.user_id), 24, { status: false }), h('span', nameOf(v.user_id, g.id))))))));
  document.body.append(card);
}
// cronômetro da chamada: conta desde que a sala deixou de estar vazia
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
// started_at é a hora do SERVIDOR: com o relógio do PC 20 s adiantado a chamada começava em 0:20. data-srv marca os que
// usam a hora do servidor (o "Tempo na chamada" do painel de voz usa a hora deste aparelho)
const srvNow = () => Date.now() + (S.clockOff || 0);
export const callTimer = (users) => { const t = users.find(v => v.started_at)?.started_at; return t ? h('span.vtimer', { 'data-start': t, 'data-srv': '' }, fmtDur(srvNow() - t)) : null; };
setInterval(() => document.querySelectorAll('.vtimer[data-start]').forEach(e => { e.textContent = fmtDur((e.hasAttribute('data-srv') ? srvNow() : Date.now()) - +e.dataset.start); }), 1000);

// "+" da barra: escolher entre chamar a turma (Bora?) e criar/entrar num servidor
function addMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  menu({ preventDefault() { }, clientX: r.right + 8, clientY: r.top }, [
    S.guilds.size > 0 && { label: 'Bora?', hint: 'Chamar a turma para jogar ou resenhar', icon: 'megaphone', fn: () => openBoraModal(S.view.gid) },
    { label: 'Adicionar um servidor', hint: 'Criar o seu ou entrar com convite', icon: 'plus', fn: addServerModal },
  ]);
}
export function addServerModal() {
  flow('add_server', 'start');
  const name = h('input', { value: `Servidor de ${S.me.display_name}`, maxLength: 100 }), code = h('input', { placeholder: 'https://… ou código do convite' });
  modal('Crie seu servidor', 'Seu servidor é onde você e seus amigos conversam.', h('div',
    h('label.f', 'Nome do servidor', name),
    h('div', { style: { textAlign: 'center', color: 'var(--text-muted)', margin: '8px 0' } }, '— ou entre em um servidor —'),
    h('label.f', 'Link ou código de convite', code)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Entrar com convite', cls: 'grey', fn: async () => { if (!code.value.trim()) { toast('Cole um convite', true); return false; } if (await joinInvite(code.value.trim().split('/').pop()) === false) return false; flow('add_server', 'done'); } }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', '/guilds', { name: name.value }); if (!r) return false; flow('add_server', 'done'); setTimeout(() => go(r.id), 100); } }]);
}
export async function joinInvite(code) {
  try {
    const info = await api('GET', `/invites/${encodeURIComponent(code)}`);
    const r = await api('POST', `/invites/${encodeURIComponent(code)}`);
    toast(`Você entrou em ${info.guild.name}!`); setTimeout(() => go(r.id), 150);
  } catch (e) { toast(e.message, true); return false; }
}

const openRep = (gid) => repModal(gid, (m) => { go(gid, m.channel_id); setTimeout(() => jumpTo(m.id), 600); });
// ---------- amigos neste servidor ----------
const ONLINE_FIRST = { online: 0, idle: 1, dnd: 2 };
export const friendsIn = (g) => [...S.rels.values()].filter(r => r.type === 1 && g.members?.has?.(r.user.id)).map(r => user(r.user.id))
  .sort((a, b) => ((ONLINE_FIRST[a.status] ?? 3) - (ONLINE_FIRST[b.status] ?? 3)) || a.display_name.localeCompare(b.display_name));
// avatares empilhados (até 3) + "Ana, Bia e mais 2"
export const friendNames = (list) => list.length === 1 ? list[0].display_name : list.length === 2 ? `${list[0].display_name} e ${list[1].display_name}` : `${list[0].display_name}, ${list[1].display_name} e mais ${list.length - 2}`;
export const avStack = (list, size = 20) => h('span.avstack', list.slice(0, 3).map(u => avatar(u, size, { status: false })));
export function friendsInServer(g) {
  const list = friendsIn(g), q = h('input.fis-in', { type: 'search', placeholder: 'Buscar amigos', 'aria-label': 'Buscar amigos neste servidor', autocomplete: 'off', spellcheck: 'false' }), box = h('div.fis-list');
  const clr = h('button.fis-clr', { type: 'button', title: 'Limpar', 'aria-label': 'Limpar busca', hidden: true, onclick: () => { q.value = ''; draw(); q.focus(); } }, icon('x', 14));
  const qbox = h('label.fis-q', icon('search', 16), q, clr);
  const draw = () => { const f = q.value.trim().toLowerCase(); const rows = list.filter(u => !f || u.display_name.toLowerCase().includes(f) || u.username?.toLowerCase().includes(f) || (nameOf(u.id, g.id) || '').toLowerCase().includes(f));
    box.replaceChildren(...(rows.length ? rows.map(u => { const nick = nameOf(u.id, g.id), m = member(g.id, u.id);
      return h('div.fis-row', h('div.fis-av', { onclick: (e) => profile(e.currentTarget, u.id, g.id) }, avatar(u, 36)),
        h('div.fis-t', h('b', { onclick: (e) => profile(e.currentTarget, u.id, g.id) }, u.display_name), h('small', [nick !== u.display_name && `aqui: ${nick}`, '@' + u.username, m?.joined_at && 'entrou em ' + new Date(m.joined_at).toLocaleDateString('pt-BR')].filter(Boolean).join(' · '))),
        h('button.ibtn', { title: 'Mandar mensagem', onclick: () => { closeModals(); openDM(u.id); } }, icon('dm', 18)));
    }) : [h('div.dm-empty', list.length ? 'Nenhum amigo com esse nome' : 'Nenhum amigo seu está neste servidor ainda.')])); };
  q.oninput = () => { clr.hidden = !q.value; draw(); }; q.onkeydown = (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); e.preventDefault(); q.value = ''; clr.hidden = true; draw(); } }; draw();
  modal(`Amigos em ${g.name}`, list.length ? `${list.length} ${list.length === 1 ? 'amigo seu está' : 'amigos seus estão'} neste servidor` : '', h('div.fis', list.length > 6 && qbox, box),
    [list.length || !canInvite(g) ? null : { label: 'Convidar amigos', fn: () => inviteModal(g) }, { label: 'Fechar', cls: 'grey' }].filter(Boolean), { width: '460px' });
  setTimeout(() => q.focus());
}
const closeModals = () => document.querySelectorAll('.backdrop:not(.leaving)').forEach(b => b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
// menu do servidor (nome no topo da lista e clique direito no ícone): como no Discord, cada item com ícone à esquerda e os
// grupos separados por linha — convidar e o que é do servidor; o que é só seu; administração (quem pode); sair/excluir
export function guildMenu(e, g, opts = {}) {
  const owner = g.owner_id === S.me.id, fr = friendsIn(g);
  const admin = [
    can(g.id, PERM.MANAGE_GUILD | PERM.MANAGE_ROLES | PERM.ADMIN) && { icon: 'gear', label: 'Configurações do servidor', fn: () => openSettings('server', { gid: g.id, voice, logout, go }) },
    can(g.id, PERM.MANAGE_CHANNELS) && { icon: 'plus', label: 'Criar canal', fn: () => channelModal(g, 0) },
    can(g.id, PERM.MANAGE_CHANNELS) && { icon: 'grid4', label: 'Criar categoria', fn: () => channelModal(g, 4) },
    isRepMod(g.id) && { icon: 'shield', label: 'Reputação (casos da comunidade)', fn: () => openRep(g.id) },
    (can(g.id, PERM.MANAGE_GUILD) || can(g.id, PERM.VIEW_MSGLOG)) && { icon: 'clock', label: 'Registro de auditoria', fn: () => auditModal(g.id) },
    can(g.id, PERM.ADMIN) && { icon: 'upload', label: 'Importar estrutura do Discord', fn: () => discordStructureModal(g) },
  ].filter(Boolean);
  return menu(e, [
    canInvite(g) && { icon: 'invite', brand: true, label: 'Convidar pessoas', fn: () => inviteModal(g) },
    { icon: 'users', label: fr.length ? `Amigos neste servidor (${fr.length})` : 'Amigos neste servidor', hint: fr.length ? friendNames(fr) : 'Nenhum ainda', fn: () => friendsInServer(g) },
    { icon: 'radar', label: 'Procurar jogadores', fn: () => { setLfgGuild(g.id); S.favMode = false; go('@me', 'lfg'); } },
    { icon: 'check', label: 'Marcar tudo como lido', fn: () => g.channels.forEach(c => ack(c.id)) },
    { icon: 'folder', label: 'Mover para pasta', sub: moveMenuItems('g:' + g.id) },
    '-',
    { icon: 'bell', label: 'Notificações', fn: () => notifCard({ currentTarget: $('#side-head') || document.body }, { g }) },
    { icon: 'edit', label: 'Apelido neste servidor', fn: async () => { const n = await promptBox('Apelido neste servidor', 'Apelido', member(g.id, S.me.id)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${g.id}/members/me`, { nickname: n }); } },
    { icon: 'eraser', label: 'Apagar minhas mensagens', fn: () => openMyMessages({ guild_id: g.id, title: g.name }) },
    ...(admin.length ? ['-', ...admin] : []),
    '-',
    owner ? { icon: 'trash', label: 'Excluir servidor', danger: true, fn: async () => { if (await confirmBox(`Excluir ${g.name}`, 'Essa ação é permanente e apaga todas as mensagens.', 'Excluir servidor')) tryApi('DELETE', `/guilds/${g.id}`); } }
      : { icon: 'logout', label: 'Sair do servidor', danger: true, fn: async () => { if (await confirmBox(`Sair de ${g.name}`, 'Você precisará de um novo convite para voltar.', 'Sair do servidor')) tryApi('DELETE', `/guilds/${g.id}/members/me`); } },
    ...(S.prefs.devMode ? ['-', { icon: 'copy', label: 'Copiar ID do servidor', fn: () => navigator.clipboard?.writeText(g.id) }] : []),
  ], { cls: 'gmenu', width: opts.width && Math.max(220, opts.width) });
}
// convidar para o servidor: amigos com botão "Convidar" (vai por DM) e o link para copiar embaixo
export async function inviteModal(g) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const link = `${publicOrigin()}/invite/${r.code}`;
  const land = g.channels.filter(c => c.type === 0).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  const friends = [...S.rels.values()].filter(x => x.type === 1).map(x => S.users.get(x.user.id) || x.user).filter(u => !g.members?.has(u.id))
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  const sent = new Set(), list = h('div.inv-list'), q = h('input', { placeholder: 'Buscar amigos', oninput: debounce(() => draw(), 120) });
  let open = true;
  const sec = h('div.inv-sec', { onclick: () => { open = !open; sec.classList.toggle('closed', !open); list.classList.toggle('hidden', !open); } }, h('span', 'Convidar para o servidor'), icon('chevdown', 18));
  const send = async (u, btn) => {
    btn.disabled = true; btn.textContent = 'Enviando…';
    const dm = await ensureDM(u.id);
    if (dm && await tryApi('POST', `/channels/${dm.id}/messages`, { content: link })) { sent.add(u.id); btn.textContent = 'Enviado'; btn.classList.add('done'); }
    else { btn.disabled = false; btn.textContent = 'Convidar'; }
  };
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    const rows = friends.filter(u => !f || (u.display_name || '').toLowerCase().includes(f) || (u.username || '').toLowerCase().includes(f));
    list.replaceChildren(...(rows.length ? rows.map(u => {
      const btn = h('button.inv-btn' + (sent.has(u.id) ? '.done' : ''), { disabled: sent.has(u.id), onclick: () => send(u, btn) }, sent.has(u.id) ? 'Enviado' : 'Convidar');
      return h('div.inv-row', avatar(u, 32, { status: false }), h('div.inv-who', h('b', u.display_name), h('small', u.username)), btn);
    }) : [h('div.inv-empty', friends.length ? 'Nenhum amigo encontrado.' : 'Todos os seus amigos já estão aqui (ou você ainda não tem amigos).')]));
  };
  const inp = h('input', { value: link, readOnly: true, onfocus: (e) => e.target.select() });
  const copy = h('button.btn', { onclick: () => { inp.select(); (navigator.clipboard?.writeText(link) || Promise.reject()).catch(() => document.execCommand('copy')); copy.textContent = 'Copiado'; copy.classList.add('green'); setTimeout(() => { copy.textContent = 'Copiar'; copy.classList.remove('green'); }, 1500); } }, 'Copiar');
  const dlg = modal(`Convidar amigos para ${g.name}`, null,
    h('div.inv',
      land && h('p.inv-land', 'Os convidados vão cair em ', h('span', icon('hash', 14), chName(land))),
      h('label.inv-search', icon('search', 16), q),
      h('div.inv-scroll', sec, list),
      h('div.inv-foot', h('label', 'Ou envie um link de convite para um amigo'), h('div.inv-copy', inp, copy), h('small', 'Este link de convite não expira.'))), []);
  dlg.el.querySelector('.modal')?.classList.add('invmodal');
  dlg.el.querySelector('.mh')?.append(h('button.inv-x', { title: 'Fechar', onclick: dlg.close }, icon('x', 20)));
  draw(); q.focus();
}
