// Área principal: escolhe o que desenhar (chat, palco, fórum, galeria, Amigos, Jogos…) e o painel da DM.
import { renderWelcome } from './onboarding.js';
import { renderGallery, renderDoc } from './chkinds.js';
import { renderGuildEvents } from './events.js';
import { renderGuildWishlist } from './games.js';
import { h, icon, avatar, screenSkeleton } from './util.js';
import { S, api, user, channelById, dmPeer, toast, savePrefs, CH, chCan } from './state.js';
import { chName } from './chnames.js';
import { renderLfg } from './lfg.js';
import { playTogetherBtn } from './playtogether.js';
import { renderFiles, releaseFiles } from './files.js';
import { renderForum, paintLocked, forumOfPost } from './forum.js';
import { renderClips, releaseClips } from './clipsgallery.js';
import { profileCard } from './card.js';
import { convoState, safetyModal, unlockModal, setupModal, isVerified, keyChangedSinceVerify } from './e2ee.js';
import { voice, live, whenLive, $, mergeUser, detached } from './gateway.js';
import { go } from './nav.js';
import { chIcon } from './side.js';
import { voiceAct, joinVoice } from './userbar.js';
import { openUserProfile } from './usermenu.js';
import { loadChannel, threadWatch, renderMessages } from './chat.js';
import { notifMenu, showPins } from './inbox.js';
import { composer } from './composer.js';
import { renderMembers, releaseMembers } from './members.js';
import { renderHome } from './home.js';
import { releaseStage, renderVoiceUI } from './stage.js';
let discoverMod = null;
const renderRadar = (main) => { main.replaceChildren(screenSkeleton('Radar')); return import('./radar.js').then(m => { if (S.view.kind === 'radar') m.renderRadar(main); }); }; // aba Radar da seção Jogos (scouting do Clash)
const renderTrophies = (main) => { main.replaceChildren(screenSkeleton('Conquistas')); return import('./achievements.js').then(m => { if (S.view.kind === 'trophies') m.renderTrophies(main); }); }; // aba Conquistas da seção Jogos
const renderDiscover = (main) => { main.replaceChildren(screenSkeleton('Descobrir')); return import('./discover.js').then(m => { discoverMod = m; if (S.view.kind === 'discover') m.renderDiscover(main); }); }; // não sobrescreve se a pessoa já saiu da tela
// Caches que apontam para elementos de uma tela que já saiu (heap de uma sessão real, 2026-11-11): a linha guardada da
// lista de membros segurava o #members antigo — e, por ele, o chat antigo inteiro (~600 elementos, mensagens de voz com
// as barras e os ouvintes) —; o Descobrir segurava a própria tela depois de sair dela. Uma tela de cada vez, mas à toa.
// Heap e timeline de outra sessão real (2026-11-12): também ficavam presas a galeria de clipes (st.root, ~1.000 elementos
// com 30 <video>), os Arquivos (st.root), a tela de Amigos (S.redrawHome) e a de atividade (S.redrawFeed) pelos redesenhos
// guardados, e o palco de chamada antigo pelo ResizeObserver (observedStage, que segurava junto o chat e o compositor).
function releaseOldScreens() {
  releaseMembers();
  discoverMod?.release(); releaseClips(); releaseFiles();
  if (S.redrawHome && !document.getElementById('home')) S.redrawHome = null;
  if (!document.getElementById('actfeed')) { S.redrawFeed = null; clearInterval(S.feedClock); S.feedClock = null; } // o relógio de 30 s do "Ativo agora" segurava o painel até o próximo tique
  releaseStage();
}
// galeria vista como conversa (só nesta abertura): o botão de grade volta
const galleryChat = new Set();
export function setGalleryChat(cid, on) { if (on) galleryChat.add(cid); else galleryChat.delete(cid); renderMain(); }

// =============== Área principal ===============
const callActive = (cid) => voice?.channelId === cid || [...S.voice.values()].some(v => v.channel_id === cid);
export function renderCallBar() { // mostra/oculta o palco de chamada nas DMs
  const ch = channelById(S.view.cid); if (!ch) return;
  if (ch.type === 1 && callActive(ch.id) !== !!$('#stage')) renderMain(); else renderVoiceUI();
}
export const renderHomeIfHome = () => { if (S.view.kind === 'home') renderMain(); };
export let openedPost = null, postTop = null; // post de fórum aberto agora: a primeira vez rola para o topo (o post)
export const freePostTop = () => { postTop = null; };
export function renderMain() {
  const main = $('#main'); if (!main) return;
  const v = S.view;
  setTimeout(releaseOldScreens); // depois de trocar a tela: solta o que guardava a tela anterior
  if (v.kind === 'home') return renderHome(main);
  if (v.kind === 'welcome') return renderWelcome(main, v.gid);
  if (v.kind === 'clips') return renderClips(main, v.gid);
  if (v.kind === 'wishlist') return renderGuildWishlist(main, v.gid);
  if (v.kind === 'events') return renderGuildEvents(main, v.gid);
  if (v.kind === 'files') return renderFiles(main, v.dm ? { dm: v.dm } : { gid: v.gid });
  if (v.kind === 'lfg') return renderLfg(main);
  if (v.kind === 'discover') return renderDiscover(main);
  if (v.kind === 'trophies') return renderTrophies(main);
  if (v.kind === 'radar') return renderRadar(main);
  if (v.pendingPost) return main.replaceChildren(h('div.empty', { style: { margin: 'auto' } }, h('p', 'Abrindo o post…')));
  const ch = channelById(v.cid);
  if (ch?.type === 15) return renderForum(main, ch);
  if (ch?.type === 17) return renderDoc(main, ch); // documento (chkinds.js)
  if (ch?.type === 16 && !galleryChat.has(ch.id)) return renderGallery(main, ch); // galeria em grade; "Conversa" mostra o chat
  if (!ch) return main.replaceChildren(h('div.empty', { style: { margin: 'auto' } }, h('h2', 'Sem canais'), h('p', 'Este servidor ainda não tem canais.')));
  const dm = ch.type === 1, vc = ch.type === 2, post = ch.type === 11, peer = dm && dmPeer(ch);
  const inCall = dm && callActive(ch.id), chatOpen = !vcChatHidden(ch);
  const top = h('div#topbar',
      h('button.ibtn.menu-btn', { 'aria-label': 'Menu', title: 'Menu', onclick: () => $('#app').classList.toggle('nav-open') }, icon('more')),
      dm ? [h('span.hash', '@'), h('span', user(peer.id).display_name), h('div.status.s-' + user(peer.id).status, { style: { position: 'static', borderColor: 'transparent', width: '10px', height: '10px', minWidth: 0, minHeight: 0 } })]
        : post ? [h('button.ibtn.fo-back', { title: 'Voltar ao fórum', 'aria-label': 'Voltar ao fórum', onclick: () => go(ch.guild_id, ch.parent_id) }, icon('arrowr', 20)), h('span.hash', icon('forum', 22)),
          h('button.fo-crumb', { onclick: () => go(ch.guild_id, ch.parent_id) }, forumOfPost(ch) ? chName(forumOfPost(ch)) : 'Fórum'), h('span.fo-crumbsep', '›'), h('span.fo-crumbt', { title: ch.name }, ch.name)]
        : [h('span.hash', chIcon(ch, 24)), h('span', { title: ch.name }, chName(ch)),
          vc && voice.channelId !== ch.id && h('button.btn.green.sm.vc-join-top.hidden', { title: chCan(ch, CH.CONNECT) ? 'Entrar na sala de voz' : 'Você não tem permissão para entrar nesta sala', disabled: !chCan(ch, CH.CONNECT), onclick: () => joinVoice(ch.id) }, icon('voice', 14), 'Entrar'),
          ch.topic && h('span.topic', ch.topic)],
      h('div.spacer'),
      // sala de voz: só o botão que mostra o chat; aberto, ele vira o X no topo do próprio chat
      vc && h('div#vc-layout-slot'),
      vc ? !chatOpen && h('button#vc-chat-btn.ibtn' + (S.unread[ch.id] ? '.unread' : ''), { title: 'Mostrar chat', onclick: () => toggleVcChat(ch) }, icon('dm')) : [
        dm && peer && !user(peer.id).bot && playTogetherBtn(peer), // "Jogar juntos" (playtogether.js)
        dm && h('button#e2-btn.ibtn.e2-off', { title: 'Criptografia de ponta a ponta', 'aria-label': 'Criptografia de ponta a ponta', onclick: () => e2eeClick(ch) }, icon('lock')),
        dm && h('button.ibtn', { title: voice.channelId === ch.id ? 'Desligar' : 'Iniciar chamada de voz', onclick: () => voice.channelId === ch.id ? voice.leave() : joinVoice(ch.id) }, icon(voice.channelId === ch.id ? 'phoneoff' : 'callstart')),
        dm && h('button.ibtn' + (voice.channelId === ch.id && voice.cam ? '.sel' : ''), { title: voice.channelId === ch.id ? (voice.cam ? 'Desligar câmera' : 'Ligar câmera') : 'Iniciar chamada de vídeo', onclick: () => videoCall(ch.id) }, icon('video')),
        ch.type === 16 && h('button.ibtn.grid-btn', { title: 'Ver em grade', 'aria-label': 'Ver em grade', onclick: () => setGalleryChat(ch.id, false) }, icon('grid')),
        h('button.ibtn.notif-btn', { title: 'Notificações', onclick: (e) => notifMenu(e, ch) }, icon('topbell')),
        !post && h('button.ibtn.pins-btn', { title: 'Mensagens fixadas', onclick: showPins }, icon('toppin')),
        // só na conversa direta: no servidor a aba Arquivos fica nos atalhos da lista de canais
        dm && h('button.ibtn.files-btn', { title: 'Mídia, arquivos e links desta conversa', 'aria-label': 'Arquivos', onclick: () => { location.hash = `#/@me/${ch.id}/files`; } }, icon('file')),
        !dm && h('button.ibtn.members-btn' + (S.membersOpen ? '.sel' : ''), { title: 'Lista de membros', onclick: () => { S.membersOpen = !S.membersOpen; renderMain(); } }, icon('users')),
        dm && h('button.ibtn.dmp-btn' + (S.prefs.dmPanel !== false ? '.sel' : ''), { title: S.prefs.dmPanel !== false ? 'Esconder o perfil' : 'Mostrar o perfil', onclick: () => { S.prefs.dmPanel = S.prefs.dmPanel === false; savePrefs(); renderMain(); } }, icon('dmprofile'))]);
  // sala de voz: a barra do topo fica junto com o palco (mesmo fundo) e o chat ocupa a altura toda ao lado, como no Discord
  main.replaceChildren(...[!vc && top,
    h('div#content',
      vc && h('div#vcall', top, h('div#stage')),
      chatOpen && h('div#chat' + (vc ? '.side' : '') + (post ? '.fo-chat' : ''),
        vc && h('div.vchead', h('span.vcico', icon('dm', 20)), h('span.vctitle', { title: ch.name }, chName(ch)), h('button.ibtn', { title: 'Fechar chat', onclick: () => toggleVcChat(ch) }, icon('x'))),
        inCall && h('div#stage.dmstage'), dm && h('div#e2-bar.hidden'), threadWatch(h('div#msgs')), h('div#typing'), composer(ch, dm ? '@' + user(peer.id).display_name : post ? null : (vc ? 'chat de ' : '#') + chName(ch))),
      !dm && !vc && S.membersOpen && h('div#members'),
      dm && S.prefs.dmPanel !== false && h('div#dmpanel'))].filter(Boolean));
  if (dm && S.prefs.dmPanel !== false) renderDmPanel(peer.id);
  if (dm) paintE2ee(ch);
  if (chatOpen) { stickToBottom($('#msgs')); loadChannel(ch.id); }
  if (post) paintLocked();
  if (post && openedPost !== ch.id) {
    openedPost = postTop = ch.id; const box = $('#msgs'), free = () => { postTop = null; };
    for (const ev of ['wheel', 'touchmove', 'pointerdown', 'keydown']) box.addEventListener(ev, free, { once: true, passive: true });
    if (S.loaded.get(ch.id)) renderMessages();
  } else if (!post) openedPost = postTop = null;
  renderMembers(); if (vc || inCall) renderVoiceUI();
}
// ---------- criptografia de ponta a ponta da conversa direta (public/e2ee.js) ----------
// cadeado no topo, faixa acima das mensagens (desbloquear / chave mudou) e o texto do compositor
async function paintE2ee(ch) {
  const st = await convoState(ch); if (S.view.cid !== ch.id) return;
  const btn = $('#e2-btn'), bar = $('#e2-bar'), ta = $('#composer textarea'); if (!btn) return;
  const peer = dmPeer(ch), name = user(peer.id).display_name, changed = st.peer && keyChangedSinceVerify(peer.id, st.peer.kid), ok = st.peer && isVerified(peer.id, st.peer.kid);
  btn.className = 'ibtn e2-' + st.mode + (changed ? ' e2-changed' : ok ? ' e2-ok' : '');
  btn.hidden = st.mode === 'none';
  btn.title = { on: changed ? `A chave de segurança de ${name} mudou — confira o número de segurança` : ok ? 'Protegida de ponta a ponta · verificada' : 'Protegida de ponta a ponta · clique para conferir o número de segurança',
    locked: 'Conversas protegidas trancadas neste aparelho — clique para desbloquear', 'peer-off': `${name} ainda não ativou a criptografia de ponta a ponta: as mensagens vão sem ela`,
    off: 'Sem criptografia de ponta a ponta — clique para ativar' }[st.mode] || '';
  if (ta) ta.placeholder = st.mode === 'on' ? `Mensagem protegida para @${name}` : `Conversar em @${name}`;
  if (!bar) return;
  const show = (...k) => { bar.classList.remove('hidden'); bar.replaceChildren(icon('lock', 16), ...k); };
  if (st.mode === 'locked') show(h('span', st.peer ? 'Esta conversa é protegida. Desbloqueie neste aparelho para ler e enviar mensagens.' : 'Suas mensagens protegidas estão trancadas neste aparelho.'), h('button.btn.sm', { onclick: () => unlockModal() }, 'Desbloquear'));
  else if (changed) show(h('span', `A chave de segurança de ${name} mudou (aparelho novo ou chave trocada). Confira o número de segurança de novo.`), h('button.btn.sm', { onclick: () => safetyModal(ch, () => paintE2ee(ch)) }, 'Conferir'));
  else { bar.classList.add('hidden'); bar.replaceChildren(); }
}
async function e2eeClick(ch) {
  const st = await convoState(ch);
  if (st.mode === 'on') return safetyModal(ch, () => paintE2ee(ch));
  if (st.mode === 'locked') return unlockModal();
  if (st.mode === 'off') return setupModal();
  if (st.mode === 'peer-off') toast(`${user(dmPeer(ch).id).display_name} ainda não ativou a criptografia de ponta a ponta. Quando ativar, as mensagens novas desta conversa passam a ser protegidas sozinhas.`);
}
// desbloqueou/ativou/trocou de chave: recarrega as conversas que tinham mensagens trancadas e atualiza o cadeado
document.addEventListener('e2ee-changed', () => {
  for (const [cid, list] of S.messages) if (list.some(m => typeof m.e2ee === 'string')) { if (S.view.cid === cid) detached.add(cid); else { S.messages.delete(cid); S.loaded.delete(cid); } }
  const ch = S.view.cid && channelById(S.view.cid);
  if (ch?.type === 1) { if (detached.has(ch.id)) renderMain(); else paintE2ee(ch); }
});
// painel à direita da conversa: o cartão de perfil da pessoa (com servidores em comum e ações)
async function renderDmPanel(uid) {
  const box = $('#dmpanel'); if (!box) return;
  // cartão com cantos arredondados; amigos/servidores em comum logo abaixo do nome (abrem o perfil completo na aba certa)
  // e "Ver perfil completo" fixo no rodapé (ligar fica no topo da conversa)
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios} em comum`;
  const draw = (u) => {
    const friends = u.mutual_friends || [], guilds = u.mutual_guilds || [];
    const mutual = (friends.length > 0 || guilds.length > 0) && h('div.dmp-mutual',
      friends.length > 0 && h('button.dmp-mut', { type: 'button', title: 'Ver amigos em comum', onclick: () => openUserProfile(uid, null, 1) },
        h('span.dmp-stack', friends.slice(0, 3).map(f => avatar(f, 18, { status: false }))), plural(friends.length, 'amigo', 'amigos')),
      guilds.length > 0 && h('button.dmp-mut', { type: 'button', title: 'Ver servidores em comum', onclick: () => openUserProfile(uid, null, 2) }, plural(guilds.length, 'servidor', 'servidores')));
    box.replaceChildren(h('div.dmp-wrap',
      h('div.dmp-scroll', h('div.popout.static.dmp-card', profileCard(u, { top: mutual, onImage: () => openUserProfile(uid) }))),
      h('div.dmp-foot', h('button.btn.grey.dmp-full', { type: 'button', onclick: () => openUserProfile(uid) }, 'Ver perfil completo'))));
  };
  // o perfil completo (amigos e servidores em comum, sobre mim) muda a altura do cartão: desenhar o parcial e depois o
  // completo fazia o painel nascer vazio e crescer. Guardado da última vez: entra direto; na 1ª vez espera até 400 ms
  const known = dmFull.get(uid), req = api('GET', `/users/${uid}`).catch(() => null);
  let drawn = known ? JSON.stringify(known) : null;
  if (known) draw(known);
  else {
    // enquanto isso, o esqueleto do cartão (faixa, avatar, nome e linhas) no lugar do painel vazio
    box.replaceChildren(h('div.dmp-wrap', h('div.dmp-scroll', h('div.skeleton.dmp-sk', h('i.dsk-ban'), h('i.dsk-av'), h('i.dsk-name'), h('i.dsk-l'), h('i.dsk-l.s')))));
    const quick = await Promise.race([req, new Promise(r => setTimeout(r, 400))]); if ($('#dmpanel') !== box) return; if (!quick) draw(user(uid)); }
  const full = await req;
  if (!full || $('#dmpanel') !== box) return;
  mergeUser(full); dmFull.set(uid, full);
  const json = JSON.stringify(full); if (json !== drawn) { drawn = json; draw(full); }
}
const dmFull = new Map(); // uid -> perfil completo da última abertura do painel
// vídeo na DM: entra na chamada (se preciso) e liga a câmera
async function videoCall(cid) {
  if (!live) await whenLive(); // tela aberta com a cópia guardada: espera a conexão (public/bootcache.js)
  if (voice.channelId === cid) return voiceAct(() => voice.toggleCam());
  voice.join(cid).then(() => { if (voice.error) { toast(voice.error, true); voice.error = null; return; } if (!voice.cam) voiceAct(() => voice.toggleCam()); });
}
// chat da sala de voz: aberto/fechado fica salvo; ao abrir marca como lido
export const vcChatHidden = (ch) => ch?.type === 2 && S.prefs.vcChat === false;
function toggleVcChat(ch) {
  S.prefs.vcChat = S.prefs.vcChat === false; savePrefs(); renderMain();
}
// imagens/vídeos carregam depois da rolagem: se estava no fim, continua no fim
// (só rolagens da pessoa contam: o scroll anchoring do navegador também dispara 'scroll')
function stickToBottom(box) {
  let userAt = 0;
  box.stick = true;
  for (const ev of ['wheel', 'touchmove', 'keydown', 'pointerdown']) box.addEventListener(ev, () => (userAt = Date.now()), { passive: true });
  box.addEventListener('scroll', () => { if (Date.now() - userAt < 1500) box.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120; });
  const fix = () => { if (box.stick) box.scrollTop = box.scrollHeight; };
  box.addEventListener('load', fix, true); box.addEventListener('loadedmetadata', fix, true);
  // campo de mensagem crescendo (texto em várias linhas), barra de resposta, anexos: a lista encolhe e
  // a última mensagem ficava escondida atrás do campo. Se estava no fim, continua no fim.
  new ResizeObserver(fix).observe(box);
}
