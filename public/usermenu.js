// Perfil e menus de usuário: cartão de perfil, perfil completo, abrir/fixar DM, ligar, silenciar e moderação.
import { openMyMessages } from './mymessages.js';
import { fxInfo } from './voicefx.js';
import { userGamesModal } from './games.js';
import { h, icon, avatar, framePos, initials, imgUrl, publicOrigin } from './util.js';
import { S, tryApi, user, botOf, guild, channelById, chVisible, member, can, outranks, PERM, dmPeer, relType, toast, modal, confirmBox, promptBox, menu, popout, lightbox, closeFloating, savePrefs, profileThemeOn } from './state.js';
import { volumeControl } from './quick.js';
import { chName } from './chnames.js';
import { canCallInvite, sendCallInvite } from './callinvite.js';
import { isLightPair, styleName } from './themes.js';
import { profileCard, STATUS_TXT, topGames } from './card.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil, voiceModItems } from './mod.js';
import { roomUserItems } from './voicerooms.js';
import { voice, logout, mergeUser } from './gateway.js';
import { openBot, botMenu } from './botmusic.js';
import { openSettings, openFullProfile, go } from './nav.js';
import { renderRail } from './rail.js';
import { renderSide } from './side.js';
import { joinVoice, voiceToggle } from './userbar.js';
import { renderVoiceUI } from './stage.js';
import { watchOnly } from './share.js';
// =============== Perfil / menus de usuário ===============
let profileSeq = 0; // clicar em A e logo em B: o cartão de A chegando depois não cobre o de B
export async function profile(anchor, uid, gid) {
  if (botOf(uid)) return openBot(anchor, uid);
  // a vitrine "Mais jogados" vem junto com o perfil: chegando depois, empurrava "Servidores em comum" e o botão (layout shift)
  const seq = ++profileSeq, [full] = await Promise.all([tryApi('GET', `/users/${uid}`), topGames(uid)]); if (!full) return;
  if (seq !== profileSeq) { mergeUser(full); return; }
  mergeUser(full);
  const u = full, m = gid && gid !== '@me' ? member(gid, uid) : null, g = m && guild(gid);
  const rt = relType(uid), isMe = uid === S.me.id;
  const roles = g && m ? g.roles.filter(r => m.roles.includes(r.id)) : [];
  const actions = isMe ? h('button.btn.block', { onclick: () => { closeFloating(); openSettings('profile', { voice, logout, go }); } }, 'Editar perfil')
    : h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
      h('button.btn', { style: { flex: 1 }, onclick: () => openDM(uid) }, 'Mensagem'),
      rt === 0 && h('button.btn.grey', { onclick: async () => { await tryApi('POST', '/relationships', { username: u.username }); closeFloating(); toast('Pedido de amizade enviado'); } }, 'Adicionar amigo'),
      rt === 3 && h('button.btn.green', { onclick: async () => { await tryApi('PUT', `/relationships/${uid}`, {}); closeFloating(); } }, 'Aceitar'));
  const extra = [u.mutual_guilds?.length > 0 && !isMe && [h('h4', 'Servidores em comum'), h('p', u.mutual_guilds.map(x => x.name).join(', '))], actions];
  const node = profileCard(u, { nickname: m?.nickname, roles, extra, onImage: () => { closeFloating(); isMe ? openFullProfile() : openUserProfile(uid, gid); } }); // clicar na foto/banner abre o perfil completo (o próprio abre o editor)
  popout(anchor, node, anchor.closest('#members') || anchor.closest('.msg') ? 'left' : 'right');
}
// perfil completo de outra pessoa (clicar na foto/banner do cartão): banner e dados à esquerda, atividade e itens em comum à direita
export async function openUserProfile(uid, gid, tab = 0) { // tab: 0 atividade, 1 amigos em comum, 2 servidores em comum, 3 conquistas
  const seq = ++profileSeq, u = await tryApi('GET', `/users/${uid}`); if (!u) return;
  if (seq !== profileSeq) { mergeUser(u); return; }
  mergeUser(u);
  const m = gid && gid !== '@me' ? member(gid, uid) : null, g = m && guild(gid);
  const roles = g && m ? g.roles.filter(r => m.roles.includes(r.id)) : [];
  const tp = u.theme_primary, ta = u.theme_accent, themed = profileThemeOn(u), color = themed ? tp : u.banner_color || u.color || '#5865f2';
  const rt = relType(uid), notes = (S.prefs.notes ||= {});
  const date = (t) => new Date(+t || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  const sec = (title, ...body) => h('section.upsec', h('h4', title), ...body);
  const bd = h('div.backdrop.upbd', { onmousedown: (e) => { if (e.target === bd) close(); } });
  const onKey = (e) => { if (e.key === 'Escape' && bd.style.display !== 'none') close(); };
  const close = () => { bd.remove(); removeEventListener('keydown', onKey); };
  const banner = h('div.upbanner', { style: { background: color } });
  if (u.banner) banner.append(framePos(h('img', { src: imgUrl(u.banner, 960), alt: '', draggable: false }), u.banner_pos));
  const av = avatar(u, 120, { ring: themed ? 'var(--ring)' : 'var(--bg-float)' });
  if (u.avatar) { av.classList.add('zoomable'); av.title = 'Ver foto de perfil'; av.onclick = () => { bd.style.display = 'none'; lightbox(u.avatar, { onClose: () => { bd.style.display = ''; } }); }; }
  const sent = () => h('button.btn.grey', { disabled: true }, 'Pedido enviado');
  const friendBtn = rt === 1 ? h('button.btn.grey.upico', { title: 'Amigos', onclick: (e) => menu(e, [{ label: 'Remover amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${u.display_name} dos seus amigos?`, 'Remover')) { await tryApi('DELETE', `/relationships/${uid}`); close(); } } }]) }, icon('check', 18))
    : rt === 3 ? h('button.btn.green', { onclick: async () => { await tryApi('PUT', `/relationships/${uid}`, {}); close(); } }, 'Aceitar amizade')
    : rt === 4 ? sent()
    : rt === 0 && h('button.btn.grey', { onclick: async (e) => { const b = e.currentTarget; if (await tryApi('POST', '/relationships', { username: u.username })) { toast('Pedido de amizade enviado'); b.replaceWith(sent()); } } }, 'Adicionar amigo');
  // nota pessoal: fica só neste navegador, junto das preferências
  const note = h('textarea.upnote', { placeholder: 'Clique para adicionar uma nota', maxLength: 256, rows: 1 });
  note.value = notes[uid] || '';
  const grow = () => { note.style.height = '0'; note.style.height = note.scrollHeight + 'px'; };
  note.oninput = grow;
  note.onchange = () => { const v = note.value.trim(); if (v) notes[uid] = v; else delete notes[uid]; savePrefs(); };
  const emoji = u.status_emoji && /^<:/.test(u.status_emoji) ? null : u.status_emoji;
  const left = h('main.upleft',
    h('div.uphead', banner, h('div.upav', av)),
    h('div.upbody',
      h('h2', styleName(h('span', m?.nickname || u.display_name), u.name_style)),
      h('div.un', u.username + (u.pronouns ? ' • ' + u.pronouns : '') + (u.status && u.status !== 'offline' ? ' • ' + STATUS_TXT[u.status] : '')),
      (u.custom_status || emoji) && h('p.cstat', emoji && h('span', emoji + ' '), u.custom_status),
      h('div.upbtns',
        h('button.btn', { onclick: () => { close(); openDM(uid); } }, icon('dm', 16), 'Mensagem'),
        friendBtn,
        h('button.btn.grey.upico', { title: 'Mais', onclick: (e) => userMenu(e, uid, gid) }, icon('more', 18))),
      u.bio && sec('Sobre mim', h('p', { style: { whiteSpace: 'pre-wrap' } }, u.bio)),
      sec('Na Resenha desde', h('p', date(u.created_at))),
      m?.joined_at && sec(`Membro de ${g.name} desde`, h('p', date(m.joined_at))),
      roles.length > 0 && sec('Cargos', h('div.chips', roles.map(r => h('span.chip', h('i.dot', { style: { background: r.color } }), r.name)))),
      sec('Nota (só você vê)', note)));
  // abas: atividade (sala de voz atual) e o que vocês têm em comum
  const vs = S.voice.get(uid), vch = vs && channelById(vs.channel_id), vg = vch && [...S.guilds.values()].find(x => x.channels.some(c => c.id === vch.id));
  const friends = u.mutual_friends || [], guilds = u.mutual_guilds || [];
  const empty = (t) => h('div.upempty', t);
  const row = (img, name, sub, fn) => h('div.uprow' + (fn ? '.click' : ''), { onclick: fn }, img, h('div', h('b', name), sub && h('small', sub)));
  const tabs = [
    ['Atividade', () => vch ? [h('h4', 'Agora'), row(h('div.upgi', icon('voice', 22)), vg ? chName(vch) : 'Chamada', vg ? `Em uma sala de voz em ${vg.name}` : 'Em uma chamada', vg && (() => { close(); go(vg.id, vch.id); }))] : [empty(`${u.display_name} não está fazendo nada no momento.`)]],
    [`${friends.length} ${friends.length === 1 ? 'amigo' : 'amigos'} em comum`, () => friends.length ? friends.map(f => row(avatar(f, 40, { ring: 'var(--bg-float)' }), f.display_name, f.username, () => { close(); openUserProfile(f.id); })) : [empty('Nenhum amigo em comum.')]],
    [`${guilds.length} ${guilds.length === 1 ? 'servidor' : 'servidores'} em comum`, () => guilds.length ? guilds.map(x => row(x.icon ? h('img.upgi', { src: imgUrl(x.icon, 32), alt: '' }) : h('div.upgi', initials(x.name)), x.name, '', () => { close(); go(x.id); })) : [empty('Nenhum servidor em comum.')]],
    // platinas e conquistas (public/achievements.js, carregado só quando a aba abre)
    ['Conquistas', () => { const box = h('div.upach', h('div.ach-loading', 'Carregando conquistas…')); import('./achievements.js').then(mod => box.replaceChildren(mod.achievementsView(uid, { compact: true }))); return [box]; }]];
  const panel = h('div.uppanel'), bar = h('div.uptabs');
  const show = (i) => { [...bar.children].forEach((b, j) => b.classList.toggle('on', i === j)); panel.replaceChildren(...tabs[i][1]()); };
  bar.append(...tabs.map(([t], i) => h('button', { onclick: () => show(i) }, t)));
  const card = h('div.upmodal' + (themed ? '.pcard.themed' + (isLightPair(tp, ta) ? '.tlight' : '.tdark') : ''),
    h('button.upclose', { title: 'Fechar', onclick: close }, icon('x', 16)),
    left, h('div.upright', bar, panel));
  card.style.setProperty('--pc', color);
  if (themed) { card.style.setProperty('--tp', tp); card.style.setProperty('--ta', ta); }
  bd.append(card); (document.getElementById('layer') || document.body).append(bd);
  addEventListener('keydown', onKey);
  show(tab); requestAnimationFrame(grow);
}
// ---------- ações do menu do usuário ----------
export const pinnedDMs = () => (S.prefs.pinnedDMs ||= []);
const isPinnedDM = (uid) => pinnedDMs().includes(uid);
export const dmWith = (uid) => [...S.dms.values()].find(d => dmPeer(d)?.id === uid);
export async function ensureDM(uid) {
  const dm = dmWith(uid) || await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return null;
  S.dms.set(dm.id, dm); return dm;
}
// fixar: a conversa fica no topo das mensagens diretas
export async function togglePinDM(uid) {
  const list = pinnedDMs(), i = list.indexOf(uid);
  if (i >= 0) list.splice(i, 1); else { if (!await ensureDM(uid)) return; list.push(uid); }
  savePrefs(); renderSide(); renderRail(); toast(i >= 0 ? 'Conversa desafixada' : `Conversa com ${user(uid).display_name} fixada no topo`);
}
// ligação: abre a DM e já entra na chamada dela
async function callUser(uid) {
  const dm = await ensureDM(uid); if (!dm) return;
  closeFloating(); go('@me', dm.id); if (voice?.channelId !== dm.id) joinVoice(dm.id);
}
// convite: escolhe um servidor seu e o link vai por mensagem direta
async function sendServerInvite(g, uid) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const dm = await ensureDM(uid); if (!dm) return;
  if (await tryApi('POST', `/channels/${dm.id}/messages`, { content: `${publicOrigin()}/invite/${r.code}` })) toast(`Convite para ${g.name} enviado a ${user(uid).display_name}`);
}
function inviteToServer(uid) {
  const gs = [...S.guilds.values()];
  if (!gs.length) return toast('Você ainda não está em nenhum servidor', true);
  const send = (g) => { dlg.close(); return sendServerInvite(g, uid); };
  const row = (g) => {
    const inside = g.members?.has(uid);
    return h('button.gpick' + (inside ? '.in' : ''), { disabled: inside, title: inside ? 'Já está neste servidor' : `Convidar para ${g.name}`, onclick: () => send(g) },
      g.icon ? h('img', { src: imgUrl(g.icon, 48), alt: '' }) : h('span.gi', initialsOf(g.name)), h('b', g.name), h('small', inside ? 'Já é membro' : 'Convidar'));
  };
  const dlg = modal(`Convidar ${user(uid).display_name}`, 'Escolha o servidor. O convite vai por mensagem direta.', h('div.gplist', gs.map(row)), [{ label: 'Cancelar', cls: 'link' }]);
}
export const initialsOf = (s) => (s || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
// mute: silencia a voz da pessoa só para você (nas chamadas)
export const isLocalMuted = (uid) => !!S.prefs.mutedUsers?.[uid];
// ícone de microfone cortado: cinza se a própria pessoa se silenciou, vermelho se fui eu que a silenciei (mesmo ícone, só muda a cor)
export const muteIco = (v) => { const lm = isLocalMuted(v.user_id), mm = !!v.mod_mute, ns = !!v.no_speak; return (v.mute || lm || mm || ns) && h('span.mico' + (lm || mm || ns ? '.lmute' : ''), { title: mm ? 'Mutado pela moderação' : ns ? 'Sem permissão para falar nesta sala' : lm ? 'Silenciado por você' : null }, icon('micoff', 14)); };
export function toggleLocalMute(uid) {
  const m = (S.prefs.mutedUsers ||= {});
  if (m[uid]) delete m[uid]; else m[uid] = true;
  savePrefs(); voice?.applyVolume(uid); renderVoiceUI();
  toast(m[uid] ? `${user(uid).display_name} silenciado para você` : `${user(uid).display_name} não está mais silenciado`);
}

export async function openDM(uid) {
  const dm = await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return;
  S.dms.set(dm.id, dm); closeFloating(); go('@me', dm.id);
}
// quem está em voz numa sala que dá para entrar (e que não é a minha)
// menus da pessoa durante uma chamada (como no Discord)
function callUserMenu(e, uid, gid) {
  const g = gid && gid !== '@me' ? guild(gid) : null;
  if (uid === S.me.id) {
    const others = g ? g.channels.filter(c => c.type === 2 && c.id !== voice.channelId && chVisible(c)) : [];
    return menu(e, [
      { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
      '-',
      { label: 'Mute', checked: voice.muted, fn: () => voiceToggle('mute') },
      { label: 'Deafen', checked: voice.deafened, fn: () => voiceToggle('deaf') },
      { label: 'Em espera', checked: !!voice.hold, fn: () => voice.setHold(!voice.hold) },
      g && { label: 'Editar perfil do servidor', fn: async () => { const n = await promptBox('Apelido neste servidor', 'Apelido', member(g.id, S.me.id)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${g.id}/members/me`, { nickname: n }); } },
      others.length > 0 && '-',
      others.length > 0 && { label: 'Mover para', sub: others.map(c => ({ label: chName(c), fn: () => joinVoice(c.id) })) },
      S.prefs.devMode && '-', S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
    ]);
  }
  const rt = relType(uid), p = S.prefs, flag = (k) => !!p[k]?.[uid], flip = (k) => { const m = (p[k] ||= {}); if (m[uid]) delete m[uid]; else m[uid] = true; savePrefs(); voice?.applyVolume(uid); renderVoiceUI(); };
  const invites = [...S.guilds.values()].filter(x => !x.members?.has(uid));
  menu(e, [
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Mensagem', fn: async () => { const dm = await ensureDM(uid); if (dm) go('@me', dm.id); } },
    { label: 'Iniciar Ligação', fn: () => callUser(uid) },
    canCallInvite(uid) && { label: 'Convidar para a chamada', fn: () => sendCallInvite(uid) },
    // transmissão desta pessoa na sala em que estou: assistir (em destaque) ou parar de assistir
    ...(S.voice.get(uid)?.screen && S.voice.get(uid).channel_id === voice.channelId ? ['-', voice.closedStreams.has(uid)
      ? { label: 'Assistir à transmissão', icon: 'eye', fn: () => { watchOnly(uid); renderVoiceUI(); } }
      : { label: 'Parar de assistir à transmissão', icon: 'eyeoff', fn: () => { voice.closeStream(uid); if (S.focus === 's:' + uid) S.focus = null; renderVoiceUI(); } }] : []),
    '-',
    voice.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume do usuário') },
    voice.peers.get(uid)?.screenAudioEl && { node: volumeControl(voice, uid, 'screen', 'Áudio da transmissão') },
    '-',
    { label: 'Mute', checked: isLocalMuted(uid), fn: () => toggleLocalMute(uid) },
    { label: 'Silenciar Soundboard', checked: flag('sbMutedUsers'), fn: () => flip('sbMutedUsers') },
    S.voice.get(uid)?.fx && { label: `Ouvir sem efeito de voz (${fxInfo(S.voice.get(uid).fx)?.label || ''})`, checked: flag('noFxUsers'), fn: () => flip('noFxUsers') },
    { label: 'Desativar Vídeo', checked: flag('hiddenVideo'), fn: () => flip('hiddenVideo') },
    { label: 'Convidar para Servidor', sub: invites.length ? invites.map(x => ({ label: x.name, fn: () => sendServerInvite(x, uid) })) : [{ label: 'Já está em todos os seus servidores', fn: () => { } }] },
    rt === 1 ? { label: 'Remover Amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${user(uid).display_name} dos seus amigos?`, 'Remover')) tryApi('DELETE', `/relationships/${uid}`); } }
      : rt === 3 ? { label: 'Aceitar Amizade', fn: () => tryApi('PUT', `/relationships/${uid}`, {}) }
      : rt === 4 ? { label: 'Cancelar Pedido de Amizade', fn: () => tryApi('DELETE', `/relationships/${uid}`) }
      : rt === 0 && { label: 'Adicionar Amizade', fn: () => tryApi('POST', '/relationships', { username: user(uid).username }).then(r => r && toast('Pedido enviado')) },
    rt !== 2 ? { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${uid}`, { type: 2 }) } : { label: 'Desbloquear', fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    ...(roomUserItems(uid).length ? ['-', ...roomUserItems(uid)] : []), // sussurrar, baixar a mão (public/voicerooms.js)
    // moderação continua disponível para quem tem permissão
    ...(voiceModItems(gid, uid).length ? ['-', ...voiceModItems(gid, uid)] : []),
    g && outranks(gid, uid) && (can(gid, PERM.MODERATE) || can(gid, PERM.BAN) || can(gid, PERM.KICK)) && '-',
    g && can(gid, PERM.MODERATE) && outranks(gid, uid) && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && outranks(gid, uid) && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && outranks(gid, uid) && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}
export function userMenu(e, uid, gid) {
  if (botOf(uid)) return botMenu(e, uid);
  if (voice?.channelId) return callUserMenu(e, uid, gid);
  if (uid === S.me.id) return menu(e, [{ label: 'Perfil', fn: () => profile(e.target, uid, gid) }, { label: 'Jogos e wishlist', fn: () => userGamesModal(uid) }, S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) }]);
  const g = gid && gid !== '@me' ? guild(gid) : null, rt = relType(uid), muted = isLocalMuted(uid);
  menu(e, [
    { label: isPinnedDM(uid) ? 'Desafixar' : 'Fixar', fn: () => togglePinDM(uid) },
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Iniciar Ligação', fn: () => callUser(uid) },
    { label: 'Convidar para Servidor', fn: () => inviteToServer(uid) },
    { label: 'Jogos e wishlist', fn: () => userGamesModal(uid) },
    rt === 1 ? { label: 'Remover Amizade', danger: true, fn: async () => { if (await confirmBox('Remover amizade', `Remover ${user(uid).display_name} dos seus amigos?`, 'Remover')) tryApi('DELETE', `/relationships/${uid}`); } }
      : rt === 3 ? { label: 'Aceitar Amizade', fn: () => tryApi('PUT', `/relationships/${uid}`, {}) }
      : rt === 4 ? { label: 'Cancelar Pedido de Amizade', fn: () => tryApi('DELETE', `/relationships/${uid}`) }
      : rt === 0 && { label: 'Adicionar Amizade', fn: () => tryApi('POST', '/relationships', { username: user(uid).username }).then(r => r && toast('Pedido enviado')) },
    rt !== 2 ? { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${uid}`, { type: 2 }) } : { label: 'Desbloquear', fn: () => tryApi('DELETE', `/relationships/${uid}`) },
    { label: muted ? 'Desmutar' : 'Mute', fn: () => toggleLocalMute(uid) },
    dmWith(uid) && { label: 'Apagar minhas mensagens na conversa…', fn: () => openMyMessages({ places: [dmWith(uid).id], title: user(uid).display_name }) },
    voice?.peers.has(uid) && '-',
    voice?.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume do usuário') },
    voice?.peers.get(uid)?.screenAudioEl && { node: volumeControl(voice, uid, 'screen', 'Áudio da transmissão') },
    g && '-',
    ...voiceModItems(gid, uid), voiceModItems(gid, uid).length > 0 && '-',
    g && can(gid, PERM.MANAGE_ROLES) && outranks(gid, uid) && { label: 'Apelido…', fn: async () => { const n = await promptBox('Alterar apelido', 'Apelido', member(gid, uid)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { nickname: n }); } },
    g && can(gid, PERM.MODERATE) && outranks(gid, uid) && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && outranks(gid, uid) && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && outranks(gid, uid) && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    '-', S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}
