// Navegação entre telas (rotas #/servidor/canal), montagem da casca do app e abertura das Configurações.
import { h } from './util.js';
import { S, user, guild, channelById, loadMembers, dmPeer, toast, confirmBox, menu, closeFloating } from './state.js';
import { hidePreview } from './chpreview.js';
import { updatePip } from './livepip.js';
import { startTimer, navTo } from './ux.js';
import { loadPost } from './forum.js';
import { openClip } from './clipsgallery.js';
import { initPlugins } from './plugins.js';
import { viewTransition } from './motion.js';
import { voice, ready, $, logout } from './gateway.js';
import { renderRail, railSortable } from './rail.js';
import { renderSide } from './side.js';
import { isFav } from './favs.js';
import { renderMain } from './mainview.js';
import { inboxBadge, showInbox } from './inbox.js';
import { clearPending, addFile } from './composer.js';
import { syncWatching, applyCamFlow } from './stage.js';
import { pipCtx } from './share.js';
// telas abertas sob demanda: o código só é baixado na primeira vez que a pessoa abre (a abertura do app fica mais leve)
const lazySettings = () => import('./settings.js');
export const openSettings = (...a) => { lazySettings().then(m => m.openSettings(...a)); };
export const openFullProfile = (...a) => { lazySettings().then(m => m.openFullProfile(...a)); };

// =============== Navegação ===============
export function go(gid, cid) {
  const hash = `#/${gid || '@me'}${cid ? '/' + cid : ''}`;
  if (location.hash === hash) applyRoute(); else location.hash = hash;
}
// nomes de canais mudaram nas configurações: redesenha onde eles aparecem
const chNameKey = () => ['chCaps', 'chDashes', 'chNoEmoji', 'chNamesVoice', 'chNameWords'].map(k => S.prefs[k]).join('|');
let lastChNames = chNameKey();
document.addEventListener('settings-closed', () => { if (!ready || chNameKey() === lastChNames) return; lastChNames = chNameKey(); renderSide(); if (S.view.cid) renderMain(); });
window.addEventListener('hashchange', () => { hidePreview(); if (ready) { S.staggerNext = true; S.inVT = true; viewTransition(() => { applyRoute(); S.inVT = false; }); S.inVT = false; if (voice) updatePip(pipCtx); } }); // troca de tela com as duas versões sobrepostas (motion.js)
let routeBack = '#/@me'; // última tela "de verdade" (o link de clipe abre por cima dela)
// telemetria: nome do tipo de tela (nunca o nome do canal ou da pessoa) e a chave para reconhecer "voltou para a mesma"
const SCREEN = { home: 'Amigos', dm: 'Conversa direta', guild: 'Canal', lfg: 'Jogos', discover: 'Jogos (Descobrir)', radar: 'Jogos (Radar)', files: 'Arquivos', clips: 'Clipes', wishlist: 'Wishlist', events: 'Eventos' };
export function applyRoute(first) {
  const prevCid = S.view?.cid;
  queueMicrotask(applyCamFlow); // saiu da sala (ou voltou): as câmeras pausam/voltam
  const clipId = /^#\/clip\/(\d+)/.exec(location.hash)?.[1];
  if (clipId) { history.replaceState(null, '', routeBack); openClip(clipId); if (!first && S.view.gid) return; }
  routeBack = location.hash || '#/@me';
  let [, gid, cid] = location.hash.match(/^#\/([^/]+)(?:\/(.+))?$/) || [];
  gid ||= '@me';
  if (gid === '@me') {
    S.view = { kind: 'home', gid: '@me', cid: cid && S.dms.has(cid) ? cid : null, tab: S.view.tab || 'online' };
    if (S.view.cid) { S.view.kind = 'dm'; localStorage.setItem('lc_lastdm', S.view.cid); }
    // '#/@me/messages' (links e abas antigas) é a mesma tela dos Amigos: a lista de conversas fica do lado
    if (cid === 'lfg') S.view = { kind: 'lfg', gid: '@me', cid: 'lfg', tab: S.view.tab }; // seção Jogos: Procurar jogadores (não é uma DM)
    if (cid === 'discover') S.view = { kind: 'discover', gid: '@me', cid: 'discover', tab: S.view.tab }; // seção Jogos: Descobrir (notícias, promoções, lançamentos)
    if (cid === 'trophies') S.view = { kind: 'trophies', gid: '@me', cid: 'trophies', tab: S.view.tab }; // seção Jogos: Conquistas (platinas e conquistas)
    if (cid === 'radar') S.view = { kind: 'radar', gid: '@me', cid: 'radar', tab: S.view.tab }; // seção Jogos: Radar (scouting do Clash)
    if (cid === 'lfg' || cid === 'discover' || cid === 'trophies' || cid === 'radar') localStorage.setItem('lc_games', cid);
    { const fm = /^(\d+)\/files$/.exec(cid || ''); if (fm && S.dms.has(fm[1])) S.view = { kind: 'files', gid: '@me', cid: 'files', dm: fm[1], tab: S.view.tab }; } // Arquivos de uma DM
  } else {
    const g = guild(gid);
    if (!g) { location.hash = '#/@me'; return; }
    if (cid === 'files') { S.view = { kind: 'files', gid, cid: 'files' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    if (cid === 'events') { S.view = { kind: 'events', gid, cid: 'events' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    if (cid === 'wishlist') { S.view = { kind: 'wishlist', gid, cid: 'wishlist' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    if (cid === 'clips') { S.view = { kind: 'clips', gid, cid: 'clips' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    const chans = g.channels.filter(c => c.type !== 4);
    const post = cid && S.posts.get(cid)?.guild_id === gid ? S.posts.get(cid) : null;
    if (!post && cid && /^\d{6,24}$/.test(cid) && !chans.some(c => c.id === cid)) { // link de um post ainda não carregado
      S.view = { kind: 'guild', gid, cid, pendingPost: true };
      loadPost(cid).then(c => { if (S.view.cid !== cid) return; if (c?.guild_id === gid) { S.view.pendingPost = false; renderSide(); renderMain(); } else { toast('Post não encontrado', true); go(gid); } });
      syncWatching(null); renderRail(); renderSide(); renderMain(); return;
    }
    let ch = post || chans.find(c => c.id === cid) || chans.find(c => c.id === S.lastChannel[gid]) || chans.find(c => c.type === 0) || chans[0];
    S.view = { kind: 'guild', gid, cid: ch?.id || null };
    if (g.partial) loadMembers(gid).catch(() => { }); // mesmo com a lista de membros fechada (menções, cores dos cargos)
    if (ch) { S.lastChannel[gid] = ch.id; localStorage.setItem('lc_last', JSON.stringify(S.lastChannel)); }
  }
  if (S.favMode && !(S.view.cid && isFav(S.view.cid))) S.favMode = false; // saiu dos favoritos (busca, link, outro canal)
  if (S.favMode) S.prefs.favLast = S.view.cid;
  S.replyTo = null; S.editing = null; clearPending(); closeFloating();
  $('#app').classList.remove('nav-open');
  if (!first) {
    if ((S.view.kind === 'guild' || S.view.kind === 'dm') && S.view.cid && S.view.cid !== prevCid) startTimer('channel_switch', S.view.cid);
    navTo(S.view.kind + ':' + (S.view.cid || S.view.gid || ''), SCREEN[S.view.kind] || S.view.kind);
  }
  syncWatching(null); renderRail(); renderSide(); renderMain();
  if (!S.inVT) for (const sel of ['#msgs', '#stage', '#members', '#side .list']) { const e = $(sel); if (e) { e.classList.remove('sw'); void e.offsetWidth; e.classList.add('sw'); } } // com a transição de tela, ela já anima
}

// =============== Shell ===============
let railEl;
export function buildShell() {
  document.addEventListener('click', (e) => { // link de clipe: abre o clipe no app (não numa janela nova)
    const a = e.target.closest?.('a[href*="/#/clip/"]'); const id = a && /\/#\/clip\/(\d+)/.exec(a.getAttribute('href'))?.[1]; if (!id) return;
    e.preventDefault(); e.stopImmediatePropagation(); openClip(id);
  }, true);
  document.addEventListener('click', (e) => { // confirmar antes de abrir links externos (opcional)
    const a = e.target.closest?.('.msg .body a[href]'); if (!a || !S.prefs.confirmLinks) return;
    e.preventDefault(); confirmBox('Abrir link externo?', a.href, 'Abrir').then(ok => ok && window.open(a.href, '_blank', 'noopener'));
  });
  $('#app').replaceChildren(railEl = h('div#rail'), h('div#side'), h('div#gsearch.hidden', { role: 'search', 'aria-label': 'Buscar em tudo' }), h('div#main'));
  $('#app').addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files') && $('#composer')) { e.preventDefault(); if (!$('#dropzone')) $('#chat').append(h('div#dropzone', 'Solte para anexar')); } });
  $('#app').addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#dropzone')?.remove(); });
  railSortable(railEl);
  initPlugins({ S, go, channelById, guild, user, dmPeer, menu, showInbox: (e) => showInbox(e), inboxBadge: () => inboxBadge() });
  $('#app').addEventListener('drop', (e) => { $('#dropzone')?.remove(); if (e.dataTransfer?.files?.length && $('#composer')) { e.preventDefault(); [...e.dataTransfer.files].forEach(addFile); } });
}
export const ctxSettings = () => ({ voice, logout, go });
