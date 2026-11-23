// Entrada do app (index.html): carrega os módulos, liga os módulos de fora (initX com as funções do app), o gancho de
// testes (window.__lc) e a abertura. O app em si está dividido em módulos próprios (gateway.js, nav.js, side.js, chat.js…).
// módulos de fora primeiro, na mesma ordem de antes da divisão: o que cada um faz ao carregar (ouvintes, timers) segue a mesma ordem
import './nativetest.js';
import './mymessages.js';
import './changelog.js';
import './fxui.js';
import './voicefx.js';
import './fxicons.js';
import './gifs.js';
import './mediasafe.js';
import { initKinds } from './chkinds.js';
import './mediafavs.js';
import './importer.js';
import './media.js';
import './steamcard.js';
import { initEvents } from './events.js';
import { initGames } from './games.js';
import './upload.js';
import './backoff.js';
import './util.js';
import './timestamp.js';
import { S, user, guild, channelById, nameOf, applyTheme, savePrefs, alertAllowed } from './state.js';
import './tts.js';
import './voice.js';
import { playSound } from './sounds.js';
import './music.js';
import './soundboard.js';
import './quick.js';
import './chpreview.js';
import { chName } from './chnames.js';
import './reorder.js';
import './livepip.js';
import './zoom.js';
import './freeze.js';
import './awaypause.js'; // GIFs e vídeos sem som param com a janela minimizada ou fora de foco
import './board.js';
import './code.js';
import './clips.js';
import './myclips.js';
import './lite.js';
import './ptt.js';
import { initRemote } from './remote.js';
import './polls.js';
import { initLfg, openLfgCreate } from './lfg.js';
import './gamestabs.js';
import { initIntents, openIntentModal } from './intents.js';
import './callrate.js';
import './vrrfix.js';
import './codecs.js';
import './ux.js';
import { initFiles } from './files.js';
import { initForum } from './forum.js';
import { initClipsGallery } from './clipsgallery.js';
import { initWatch, pendingWatch } from './watch.js';
import { initCallInvite, canCallInvite, sendCallInvite } from './callinvite.js';
import './ui.js';
import './themeeditor.js';
import './themes.js';
import './card.js';
import './mod.js';
import './voicemsg.js';
import './plugins.js';
import { initActivity, refreshFeedView, activityOf, gameTitle } from './activity.js';
import './translate.js';
import { initDiag } from './diag.js';
import { initPwa } from './pwa.js';
import './e2ee.js';
import './rum.js';
import './motion.js';
import { initAppUpdate } from './appupdate.js';
import { voice, pendingInvite, setPendingInvite, $, gwSend, showAuth, logout, connect, onEvent } from './gateway.js';
import { updateTitle } from './unread.js';
import { openSettings, go, ctxSettings } from './nav.js';
import { renderSide } from './side.js';
import { toggleFavPost, favPostChanged, isFav, openFavs, moveFav } from './favs.js';
import { watchFriend, joinVoice, voiceToggle } from './userbar.js';
import { profile, openDM, userMenu } from './usermenu.js';
import { setGalleryChat, renderMain } from './mainview.js';
import { renderMessages, ctxFor } from './chat.js';
import { reactionFace, shareClipModal, attachEl } from './msgcards.js';
import { react, jumpTo } from './msgactions.js';
import { setInboxTab, showInbox } from './inbox.js';
import { renderMembers } from './members.js';
import { renderActiveNow } from './home.js';
import { renderVoiceUI } from './stage.js';
import { watchOnly } from './share.js';
export { voiceDragging } from './side.js';
applyTheme();

// gancho de depuração/testes automatizados
initRemote({ savePrefs, send: gwSend, channelId: () => voice?.channelId || null, voice: () => voice, name: (uid) => nameOf(uid, channelById(voice?.channelId)?.guild_id) || user(uid).display_name, rerender: () => renderVoiceUI() });
initKinds({ go, renderMain: () => renderMain(), profile: (a, uid) => profile(a, uid), mdCtx: (gid) => ctxFor(gid), chName, attachEl: (f) => attachEl(f), jumpTo: (mid) => jumpTo(mid),
  react: (m, e, add) => react(m, e, add), reactionFace: (e) => reactionFace(e), galleryChat: (cid, on) => setGalleryChat(cid, on) });
initForum({ go, isFav: (id) => isFav(id), toggleFavPost: (p) => toggleFavPost(p), favPostChanged: (id, t) => favPostChanged(id, t), renderMain: () => renderMain(), profile: (a, uid) => profile(a, uid), userMenu: (e, uid) => userMenu(e, uid), mdCtx: (gid) => ctxFor(gid), attachEl: (f) => attachEl(f), chName });
// "A fim de jogar": o painel Ativo agora redesenha; o plano B abre o formulário do LFG já preenchido
initIntents({ go, joinVoice, channelById, redraw: () => refreshFeedView(), openLfg: (pre) => { go('@me', 'lfg'); setTimeout(() => openLfgCreate(pre), 50); },
  showPanel: () => { if (S.view.kind !== 'home') go('@me'); setTimeout(() => document.getElementById('home')?.classList.add('an-open'), 50); } });
initLfg({ intent: (pre) => openIntentModal(pre), go, joinVoice, channelById, settings: (k) => openSettings(k, ctxSettings()), profile: (a, uid) => profile(a, uid), inVoice: () => !!voice?.channelId, voiceChannel: () => (voice?.channelId && channelById(voice.channelId)?.type === 2 ? voice.channelId : '') });
initClipsGallery({ go, jumpTo: (mid) => jumpTo(mid), share: (c) => shareClipModal(c) });
initFiles({ go, jumpTo: (mid) => jumpTo(mid) });
initDiag(() => voice); initPwa(); setTimeout(initAppUpdate, 1500); // aviso de versão nova do app desktop (depois da abertura, sem atrasá-la)
// Watch Together (public/watch.js): convidar = convite para a chamada com a atividade 'watch'
initWatch({ send: gwSend, voice: () => voice, channelById, goCall: (ch) => go(ch.guild_id || '@me', ch.id), rerender: () => { if (voice?.active) renderVoiceUI(); },
  inviteCandidates: () => { const ch = voice?.channelId && channelById(voice.channelId); if (!ch?.guild_id) return [];
    const ids = new Set([...[...S.rels.values()].filter(r => r.type === 1).map(r => r.user?.id || r.id), ...(guild(ch.guild_id)?.members?.keys() || [])]);
    const on = (u) => (S.users.get(u)?.status && S.users.get(u).status !== 'offline' ? 0 : 1);
    return [...ids].filter(u => u && canCallInvite(u)).sort((a, b) => on(a) - on(b)); },
  invite: (uid) => sendCallInvite(uid, { activity: 'watch' }),
  streams: () => (voice?.channelId ? [...S.voice.values()].filter(v => v.channel_id === voice.channelId && v.screen && v.user_id !== S.me.id).map(v => v.user_id) : []),
  watchStream: (uid) => { watchOnly(uid); renderVoiceUI(); } });
initCallInvite({ go, joinVoice, voice: () => voice, channelById, guild, activityOf, gameTitle, onWatchInvite: (cid) => pendingWatch(cid), onPending: () => { if (S.view.kind === 'home') { S.redrawHome?.(); refreshFeedView(); } } });
initEvents({ go, joinVoice: (cid) => joinVoice(cid), profile: (a, uid) => profile(a, uid), playSound: (n) => { if (alertAllowed('mention')) playSound(n); } });
initGames({ profile: (a, uid) => profile(a, uid), go, openSettings: (k) => openSettings(k, ctxSettings()), onDeals: () => updateTitle(), playSound: (n) => { if (alertAllowed('mention')) playSound(n); }, openInbox: (tab) => { setInboxTab(tab); showInbox(); } });
initActivity({ openDM, profile: (a, uid) => profile(a, uid), userMenu: (e, uid) => userMenu(e, uid), go, joinVoice, watchFriend, voice: () => voice, openSettings: (k) => openSettings(k, ctxSettings()), renderActiveNow, renderMembers: () => { if ($('#members')) renderMembers(); }, renderSide: () => renderSide() });
// testes: importa um módulo do app pelo mesmo endereço (com a versão dele, server/static.js) que o app usa, para pegar a mesma instância
const modUrl = (f) => document.querySelector(`link[rel="modulepreload"][href^="/${f}?"]`)?.getAttribute('href')
  || ((v) => v && `/${f}?v=${v}`)(document.querySelector('meta[name="lc-lazy"]')?.content.split(' ').find(x => x.startsWith(f + ':'))?.slice(f.length + 1)) || './' + f + new URL(import.meta.url).search;
window.__lc = { S, updateTitle: () => updateTitle(), savePrefs, onEvent: (t, d) => onEvent(t, d), import: (f) => import(modUrl(f)), get voice() { return voice; }, go, joinVoice, openFavs, moveFav, jumpTo, renderMessages, voiceToggle: (k) => voiceToggle(k), openSettings: (k) => openSettings(k, { voice, logout, go, gid: S.view.gid }) };

// =============== Boot ===============
(async function boot() {
  const m = location.pathname.match(/^\/invite\/([\w-]+)/);
  if (m) setPendingInvite(m[1]);
  if (S.token) connect(); else showAuth(pendingInvite ? 'register' : 'login');
})();
