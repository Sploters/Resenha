import { nativeEnded } from './nativetest.js';
import { openMyMessages } from './mymessages.js';
import { setNewsActions, maybeShowNews, markSeen as markNewsSeen } from './changelog.js';
import { openFxPicker, fxBadge } from './fxui.js';
import { fxInfo } from './voicefx.js';
import { fxIcon } from './fxicons.js';
import { gifPicker, gifEl, isGifMessage, toggleFav as toggleGifFav, isFav as isGifFav } from './gifs.js';
import { socialCard, prepVideo } from './media.js';
import { uploadFile, compressVideo, maxUpload, isVideo } from './upload.js';
import { reconnectDelay } from './backoff.js';
import { h, morph, place, icon, avatar, fsVideo, whenGone, thumbUrl, md, esc, stamp, clock, dayLabel, sameDay, bytes, onlyEmoji, isImageUrl, SHORT, inviteCodes, callCodes, stripInvites, clipLinkIds, stripClipLinks, clipLink, inviteText, parsePos, framePos, initials, busy, skeleton, screenSkeleton, debounce, imgUrl, cleanLinks, plainTs, platformIcons } from './util.js';
import { timestampModal } from './timestamp.js';
import { S, api, tryApi, user, botOf, guild, channelById, member, loadMembers, nameOf, roleColor, can, perms, PERM, dmPeer, relType, toast, modal, confirmBox, promptBox, menu, popout, emojiPicker, warmEmojis, lightbox, closeFloating, beep, notify, closeNotifs, quietHere, tabId, notifPolicy, channelMuted, channelUnmuted, serverMuted, setChannelUnmuted, desktop, applyTheme, emojiUrl, allEmojis, savePrefs, relite, alertAllowed, focusOn, prefsDirty, prefsBase, setPrefsBase, mergeRemote, pushPrefsNow, restoreDevicePrefs, resolveDevices, DEVICE_PREF_KEYS, setDevice } from './state.js';
import { Voice, SCREEN_PRESETS, VOICE_BITRATES } from './voice.js';
import { playSound, presenceSound, resetPresenceSounds } from './sounds.js';
import { initMusic, onState as musicOnState, onRes as musicOnRes, openMusic, musicState, musicCmd } from './music.js';
const musicOn = () => !!(musicState()?.active && musicState()?.current && !musicState()?.paused); // bot tocando nesta sala: botão aceso
import { openSoundboard, onIncoming as sbIncoming, handleKey as sbKey } from './soundboard.js';
import { openAudioPanel, openStatusPanel, openMicPanel, volumeControl } from './quick.js';
import { previewHooks, hidePreview, paintTyping as previewTyping, previewMessage } from './chpreview.js';
import { chName } from './chnames.js';
import { streamHover, updatePip, popOut } from './livepip.js';
import { zoomControls, pruneZoom } from './zoom.js';
import { refreshFreeze } from './freeze.js';
import { initBoard, boardState, onDraw, boardCanvas, boardTools, clearBoard, pruneBoardCanvases } from './board.js';
import { initCode, codeSet, codeReset, codeTile, keepEditorFocus } from './code.js';
import { startBuffer, stopAllBuffers, pruneBuffers, clipping, saveClip, saveClipTrim, clipLengths, clipKeys } from './clips.js';
import { syncThrottle, gameChanged, liteAutoOn, startUsageWatch, startPressureWatch } from './lite.js';
import { initRemote, onRemoteEvent, controlling as remoteControlling, pendingFor as remotePending, requestControl, stopControl } from './remote.js';
import { pollModal, pollCard } from './polls.js';
import { initLfg, renderLfg, onLfgEvent } from './lfg.js';
let discoverMod = null;
const renderDiscover = (main) => { main.replaceChildren(screenSkeleton('Descobrir')); return import('./discover.js').then(m => { discoverMod = m; if (S.view.kind === 'discover') m.renderDiscover(main); }); }; // não sobrescreve se a pessoa já saiu da tela
// Caches que apontam para elementos de uma tela que já saiu (heap de uma sessão real, 2026-11-11): a linha guardada da
// lista de membros segurava o #members antigo — e, por ele, o chat antigo inteiro (~600 elementos, mensagens de voz com
// as barras e os ouvintes) —; o Descobrir segurava a própria tela depois de sair dela. Uma tela de cada vez, mas à toa.
// Heap e timeline de outra sessão real (2026-11-12): também ficavam presas a galeria de clipes (st.root, ~1.000 elementos
// com 30 <video>), os Arquivos (st.root), a tela de Amigos (S.redrawHome) e a de atividade (S.redrawFeed) pelos redesenhos
// guardados, e o palco de chamada antigo pelo ResizeObserver (observedStage, que segurava junto o chat e o compositor).
function releaseOldScreens() {
  if (memRows.box && !memRows.box.isConnected) { memRows.clear(); memRows.box = null; memRows.gid = null; }
  discoverMod?.release(); releaseClips(); releaseFiles();
  if (S.redrawHome && !document.getElementById('home')) S.redrawHome = null;
  if (!document.getElementById('actfeed')) { S.redrawFeed = null; clearInterval(S.feedClock); S.feedClock = null; } // o relógio de 30 s do "Ativo agora" segurava o painel até o próximo tique
  if (observedStage && !observedStage.isConnected) { stageObs.unobserve(observedStage); observedStage = null; }
}
import { initFiles, renderFiles, filesPreset, onFilesMessage, releaseFiles } from './files.js';
import { initClipsGallery, renderClips, onClipEvent, galleryFocus, openClip, releaseClips } from './clipsgallery.js';
import { initCallInvite, callCard, onCallInvite, onCallInviteUpdate, canCallInvite, sendCallInvite, inviteFrom, loadPendingInvites, acceptInvite, declineInvite } from './callinvite.js';
import { seg, toggle as uiToggle, qualityPanel, qualityLabel, comboFromEvent, comboToAccel, comboLabel } from './ui.js';
// telas abertas sob demanda: o código só é baixado na primeira vez que a pessoa abre (a abertura do app fica mais leve)
const lazySettings = () => import('./settings.js');
const openSettings = (...a) => { lazySettings().then(m => m.openSettings(...a)); };
const openFullProfile = (...a) => { lazySettings().then(m => m.openFullProfile(...a)); };
import { saveCustomTheme } from './themeeditor.js';
import { isLightPair, THEME_CODE_RE, decodeTheme, gradientCss, styleName, stripThemeCodes, themeText, encodeTheme, GRADIENT_THEMES, themeDef } from './themes.js';
import { profileCard, STATUS_TXT } from './card.js';
import { timeoutDialog, removeTimeout, banDialog, timedOutUntil, isRepMod, repModal, flaggedMap, flagMessage, unflagMessage } from './mod.js';
import { recordVoiceMessage, voiceEl } from './voicemsg.js';
import { initPlugins, mentionUser, addMention, resolveMentions } from './plugins.js';
import { initActivity, setActivities, onActivityUpdate, onIntegrationUpdate, activityPanel, activityOf, playingLine, refreshFeedView, gameIcon, voiceGameIcon } from './activity.js';
import { toggleTranslation, isTranslated, translationBlock, translateOutgoing } from './translate.js';
import { initDiag, openReport } from './diag.js';
import { initPwa } from './pwa.js';
import { e2eeLoad, onE2eeKey, decryptDeep, convoState, safetyModal, unlockModal, setupModal, isVerified, keyChangedSinceVerify, callKey, protectFiles, encryptFile, openFile, openedFileUrl } from './e2ee.js';
import { rumReady } from './rum.js';
import { viewTransition, stagger, swapIcon } from './motion.js';
// tela de entrar: só para quem não está logado
const renderAuth = (...a) => import('./auth.js').then(m => m.renderAuth(...a));
const approveQr = (...a) => import('./auth.js').then(m => m.approveQr(...a));
const qrCodeInUrl = () => { const m = /^\/qr\/([\w-]{20,64})\/?$/.exec(location.pathname); return m ? m[1] : null; };
import { initAppUpdate, installAppUpdate, myDesktopVersion, refreshDesktopVersion, latestDesktop, isOlder } from './appupdate.js';
applyTheme();

let ws, voice, retry = 0, ready = false, pendingInvite = null;
const $ = (s) => document.querySelector(s);
const gwSend = (t, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t, d }));
// qual servidor esta tela mostra (null: nenhum, ou janela escondida): o servidor só manda a presença dos membros dele
// para quem está olhando (e manda quem está online ao abrir). Reenviado a cada conexão nova (sentView volta a undefined).
let sentView;
function syncView() {
  if (!ready || ws?.readyState !== 1) return;
  const want = document.hidden ? null : (S.view.gid && S.view.gid !== '@me' && S.guilds.has(S.view.gid) ? S.view.gid : null);
  if (want !== sentView) { sentView = want; gwSend('VIEW', { guild_id: want }); }
}
document.addEventListener('visibilitychange', () => syncView());
initMusic(gwSend);
let musicLit = false; // acende o botão de música quando o bot começa/para de tocar (só redesenha se mudou)
let musicTrack = ''; // faixa atual: o cartão do bot na sala e na lista de canais mostra o que está tocando
document.addEventListener('music-changed', () => {
  const m = musicState(), key = m?.active ? `${m.current?.id || ''}|${m.paused ? 1 : 0}` : '';
  if (musicOn() === musicLit && key === musicTrack) return;
  musicLit = musicOn(); musicTrack = key; if (voice?.active) { renderSide(); renderVoiceUI(); }
});
// ---------- bot de música (não é uma pessoa: sem perfil, amizade, cargos, banir...) ----------
const botPlaying = (uid) => { const m = musicState(); return m?.active && m.bot_id === uid && m.current ? m : null; };
function openBot(anchor, uid) {
  const v = S.voice.get(uid);
  if (!v) return;
  if (voice?.channelId !== v.channel_id) return toast('Entre na sala de voz para controlar a música');
  openMusic(anchor, voice);
}
function botMenu(e, uid) {
  const v = S.voice.get(uid), here = v && voice?.channelId === v.channel_id;
  menu(e, [
    { label: 'Abrir o painel de música', fn: () => openBot(e.target, uid) },
    here && voice.peers.has(uid) && { node: volumeControl(voice, uid, 'mic', 'Volume da música (só para você)') },
    here && '-',
    here && { label: 'Tirar o bot da sala', danger: true, fn: () => musicCmd('disconnect').catch(err => toast(err.message, true)) },
  ]);
}
const eqBars = (on) => h('span.boteq' + (on ? '.on' : ''), { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
function botRow(v) {
  const m = botPlaying(v.user_id), b = v.bot || {};
  return h('div.vuser.vbot', { 'data-uid': v.user_id, title: m ? `${m.current.title}${m.current.artist ? ' — ' + m.current.artist : ''}` : 'Bot de música', onclick: (e) => openBot(e.currentTarget, v.user_id), oncontextmenu: (e) => botMenu(e, v.user_id) },
    avatar(user(v.user_id), 24),
    h('span.nm', h('span.botnm', b.name || 'Música'), h('span.bottag', 'BOT'), m && h('small.botnow', m.current.title)),
    eqBars(m && !m.paused));
}
function botTile(v, gid) {
  const uid = v.user_id, m = botPlaying(uid), c = m?.current, b = v.bot || {};
  return h('div.tile.bottile' + (m && !m.paused ? '.playing' : ''), { 'data-uid': uid, 'data-key': 'c:' + uid, onclick: (e) => openBot(e.currentTarget.querySelector('.botcard') || e.currentTarget, uid), oncontextmenu: (e) => botMenu(e, uid) },
    c?.thumb && h('div.botbg', { style: { backgroundImage: `url("${String(c.thumb).replace(/["\\\n]/g, encodeURIComponent)}")` } }),
    h('div.botcard',
      c?.thumb ? h('img.botart', { src: c.thumb, alt: '', referrerPolicy: 'no-referrer' }) : h('div.botart.ph', icon('musicbot', 40)),
      h('div.botinfo', h('b', c ? c.title : 'Nada tocando'), h('small', c ? (m.paused ? 'Pausado' : c.artist || 'Tocando agora') : 'Clique para escolher uma música'))),
    h('div.label', eqBars(m && !m.paused), h('span', b.name || 'Música'), h('span.bottag', 'BOT')));
}

// Redesenhos pedidos por eventos do servidor (alguém mudou de status, entrou na sala…) viram um só por quadro: quando o
// servidor reinicia e todo mundo reconecta, eram centenas de redesenhos da lista lateral e de membros seguidos.
// Fora de eventos (cliques, navegação) o redesenho continua na hora.
let inEvent = false, evQ = null;
const queuedRenders = new Set();
const deferRender = (fn) => {
  if (!inEvent) return false;
  if (!queuedRenders.has(fn)) { queuedRenders.add(fn); requestAnimationFrame(() => { queuedRenders.delete(fn); fn(); }); }
  return true;
};

// =============== Autenticação ===============
// tela de entrar / criar conta (public/auth.js); o celular que abriu /qr/<código> aprova o login de outro aparelho
const qrCode = qrCodeInUrl();
function showAuth(mode = 'login') {
  document.getElementById('boot')?.remove(); document.documentElement.classList.remove('boot');
  $('#app').classList.add('hidden');
  const a = $('#auth'); a.classList.remove('hidden');
  renderAuth(a, mode, { invited: !!pendingInvite, qrPending: !!qrCode, onToken: (token) => { S.token = token; localStorage.setItem('lc_token', token); a.classList.add('hidden'); a.replaceChildren(); connect(); } });
}
function logout() {
  api('POST', '/logout').catch(() => { });
  localStorage.removeItem('lc_token'); S.token = null; voice?.leave(); ws?.close(); location.hash = ''; location.reload();
}

// =============== Versões do app desktop na call ===============
// referência: a versão mais nova publicada (ou a minha, se for mais nova que a que o servidor conhece)
const refVersion = () => { const mine = myDesktopVersion(), l = S.desktopLatest; return isOlder(l, mine) ? mine : l || mine; };
const appOutdated = (v) => !!v?.app && isOlder(v.app, refVersion());
// selinho ao lado do nome de quem está com o app desatualizado (na lista da sala e no quadro da call)
const appBadge = (v) => appOutdated(v) ? h('span.appold', { title: `App desktop ${v.app} — desatualizado (a mais nova é ${refVersion()}). Se a tela ou a voz dessa pessoa não aparecer para você, peça para atualizar.` }, icon('dl', 12), v.app) : null;
const warnedApp = new Set();
function warnOutdated(v) {
  if (v.user_id === S.me?.id || !appOutdated(v) || warnedApp.has(v.user_id + v.app)) return;
  warnedApp.add(v.user_id + v.app);
  toast(`${nameOf(v.user_id, S.view.gid) || 'Alguém'} está com o app numa versão antiga (${v.app}). Se a tela dele não aparecer, peça para atualizar.`);
}
// avisa de todos na minha sala (a versão mais nova pode chegar depois de as pessoas entrarem)
const scanOutdated = () => { if (voice?.channelId) for (const v of S.voice.values()) if (v.channel_id === voice.channelId) warnOutdated(v); };
function outdatedModal(d) {
  modal('Atualize o app para entrar na call', d.reason, h('div'), [
    { label: 'Agora não', cls: 'link' },
    { label: 'Atualizar agora', cls: 'green', fn: () => { toast('Baixando a atualização…'); installAppUpdate(); } }]);
}

// =============== Gateway ===============
// (tabId, o id desta aba/janela, vem de state.js: vai no gateway e no cabeçalho X-LC-Tab das chamadas à API)
// conexão "travada" (a internet caiu sem o navegador perceber): 2 pings seguidos sem resposta = reconecta (e volta para a sala)
let wsMiss = 0;
setInterval(async () => {
  if (!ready || ws?.readyState !== 1 || document.hidden && !voice?.active) { wsMiss = 0; return; }
  const cur = ws, ms = await wsPing();
  if (cur !== ws) return;
  if (ms != null) { wsMiss = 0; return; }
  if (++wsMiss < 2) return;
  wsMiss = 0; const onclose = cur.onclose; cur.onclose = cur.onmessage = null; try { cur.close(); } catch { } onclose?.();
}, 8000);
function connect() {
  clearTimeout(connect.t);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway?token=${S.token}&tab=${tabId}`);
  ws.onmessage = (e) => {
    const { t, d } = JSON.parse(e.data), run = () => { inEvent = true; try { onEvent(t, d); } catch (err) { console.error(t, err); } finally { inEvent = false; } };
    // mensagem protegida (public/e2ee.js): abre antes de tratar; os eventos seguintes esperam na fila para não trocar de ordem
    const enc = e.data.includes('"e2ee:1:');
    if (!enc && !evQ) return run();
    const p = (evQ || Promise.resolve()).then(() => enc && decryptDeep(d)).catch(() => { }).then(run);
    evQ = p; p.then(() => { if (evQ === p) evQ = null; });
  };
  ws.onopen = () => {
    retry = 0; $('#reconnect')?.remove();
    // versão do app desktop desta conexão: a sala mostra quem está desatualizado e o servidor pode exigir uma mínima
    const sent = myDesktopVersion(); gwSend('CLIENT_INFO', { desktop: sent, kind: devKind() });
    lastActive = null; reportActive(); // conta para os outros aparelhos se este está em uso
    refreshDesktopVersion().then(v => { if (v !== sent) gwSend('CLIENT_INFO', { desktop: v }); });
  };
  ws.onclose = async () => {
    if (!S.token) return;
    try { await api('GET', '/users/0'); } catch (e) { if (e.status === 401) { localStorage.removeItem('lc_token'); S.token = null; return showAuth(); } }
    if (ready && !$('#reconnect')) document.body.append(h('div#reconnect', { style: { position: 'fixed', top: 0, left: 0, right: 0, background: '#f0b232', color: '#000', textAlign: 'center', padding: '4px', zIndex: 300, fontWeight: 600 } }, 'Conexão perdida. Reconectando…'));
    connect.t = setTimeout(connect, reconnectDelay(retry++)); // com sorteio: num reinício, não voltam todos juntos
  };
}

// lista inteira de um servidor grande chegou: redesenha o que mostra membros (nomes, cores, lista)
document.addEventListener('members-loaded', (e) => { if (S.view.gid !== e.detail) return; renderMembers(); renderSide(); if (S.view.cid) renderMessages(true); });
function ingestGuild(g) {
  const old = S.guilds.get(g.id);
  g.members = new Map(g.members.map(m => [m.user_id, m]));
  g.channels.sort((a, b) => a.position - b.position);
  for (const u of g.users || []) mergeUser(u);
  // limpa estados de voz antigos desta guilda
  for (const [uid, v] of S.voice) if (old?.channels.some(c => c.id === v.channel_id)) S.voice.delete(uid);
  for (const v of g.voice_states || []) S.voice.set(v.user_id, v);
  delete g.users; delete g.voice_states;
  S.guilds.set(g.id, g);
}

function onEvent(t, d) {
  switch (t) {
    case 'READY': {
      const wasReady = ready; // conexão nova depois de uma que caiu (não a primeira abertura)
      S.me = d.user; S.users.set(d.user.id, d.user); S.ice = d.ice; S.unread = d.unread; S.mentions = {}; S.devices = []; S.desktopMin = d.desktop_min || null;
      latestDesktop().then(v => { if (v && v !== S.desktopLatest) { S.desktopLatest = v; renderSide(); if (voice?.active) renderVoiceUI(); scanOutdated(); } });
      S.guilds.clear(); S.dms.clear(); S.rels.clear(); S.voice.clear();
      if (S.remote) onRemoteEvent('REMOTE_STATE', { ...S.remote, state: 'ended', reason: 'left' }); // reconectou: o servidor já encerrou a sessão
      for (const u of d.users || []) S.users.set(u.id, u); // pessoas dos servidores, cada uma uma vez
      d.guilds.forEach(ingestGuild);
      for (const v of d.dm_voice || []) S.voice.set(v.user_id, v);
      for (const dm of d.dms) { S.dms.set(dm.id, dm); dm.recipients.forEach(u => S.users.set(u.id, u)); }
      for (const r of d.relationships) { S.rels.set(r.user.id, r); S.users.set(r.user.id, r.user); }
      S.friendLosses = d.friend_losses || []; S.friendLosses.forEach(x => mergeUser(x.user)); noticeFriendLosses(S.friendLosses.filter(x => x.at > seenLoss()));
      setActivities(d.activities); // o servidor já filtrou pela privacidade (mesma regra dos eventos)
      if (!voice) { initBoard((t, d) => voice?.active && voice.send(t, d)); initCode((t, d) => voice?.active && voice.send(t, d)); }
      if (!voice) voice = new Voice({ send: gwSend, ice: S.ice, myId: S.me.id, prefs: S.prefs, onUpdate: voiceUpdate });
      if (!voice.resolveDevices) { voice.resolveDevices = resolveDevices; navigator.mediaDevices?.addEventListener?.('devicechange', () => resolveDevices()); } // aparelho religado/com id novo: volta o escolhido
      // chamada numa conversa direta protegida: cifrada de ponta a ponta (cada quadro, public/e2ee-worker.js)
      voice.beforeJoin = async (cid) => {
        const ch = channelById(cid); if (ch?.type !== 1) return null;
        const r = await callKey(ch);
        if (r.mode === 'locked' && r.peer) return { error: 'Esta conversa é protegida: desbloqueie a criptografia neste aparelho (Configurações → Privacidade e segurança) para ligar.' };
        if (r.key) toast('Chamada protegida de ponta a ponta');
        return r.key ? { key: r.key } : null;
      };
      voice.onAutoAdjust = (msg) => toast(msg);
      voice.onNativeFail = (msg) => toast(msg, true);
      setNewsActions(newsActions);
      voice.fxLookup = (uid) => S.voice.get(uid)?.channel_id === voice.channelId ? S.voice.get(uid)?.fx : null;
      if (S.nativeOk === undefined) { S.nativeOk = null; voice.nativeCapable().then(r => { S.nativeOk = !!r.ok; S.nativeWhy = r.reason || ''; }); }
      voice.onBlackCapture = (black) => { if (black) toast('Sua transmissão está saindo preta. Se for um jogo, coloque-o em "Janela sem bordas" (tela cheia exclusiva e alguns anti-cheats bloqueiam a captura).', true); renderVoiceUI(); };
      // vigias da transmissão (voice.js watchSource / app desktop appaudio.js): avisos só para quem transmite
      voice.onScreenNote = (n) => { if (n === 'min') toast('Sua janela transmitida foi minimizada: quem assiste vê a imagem parada até você restaurá-la.', true); else if (n === 'closed') toast('A janela que você transmitia foi fechada. Escolha outra fonte na barra da transmissão.', true); renderVoiceUI(); };
      voice.onAppAudioEvent = (ev) => { const n = ev.name || 'O jogo'; toast(ev.t === 'waiting' ? `${n} fechou: o áudio da transmissão volta sozinho quando ele abrir de novo.` : `Áudio de ${n} reconectado na transmissão.`, ev.t === 'waiting'); renderVoiceUI(); };
      voice.ice = S.ice;
      // a conexão caiu e voltou: o servidor já nos tirou da sala, então reentra sem tocar os sons de sair/entrar
      if (ready && voice.channelId) { resetPresenceSounds(); voice.rejoin(); }
      e2eeLoad(true);
      if (!ready) { buildShell(); warmEmojis(); } ready = true; sentView = undefined; syncView(); // conexão nova: o servidor ainda não sabe o que está na tela
      $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); document.getElementById('boot')?.remove(); document.documentElement.classList.remove('boot'); rumReady();
      applyTheme(); setupDesktop(); startGameDetect(); syncThrottle(voice); startUsageWatch(() => voice); startPressureWatch(() => voice); // pico de consumo e processador no limite (Modo leve)
      loadPendingInvites(); // convites para chamada que chegaram enquanto estava fora (ou antes de recarregar)
      if (qrCode && !S.qrDone) { S.qrDone = true; approveQr(qrCode, S.me).then(ok => { if (ok) toast('Pronto! O outro aparelho entrou na sua conta.'); }); }
      if (!S.synced) Promise.all([api('GET', '/me/settings'), restoreDevicePrefs()]).then(([r]) => { // sincroniza preferências entre dispositivos
        resolveDevices(); // microfone/fone/câmera salvos: reencontra pelo nome se o id mudou
        S.friendPolicy = r.friend_policy; S.privacy = r.privacy || {};
        // mudança feita aqui que não chegou à conta (o app fechou/atualizou antes de enviar): vale a daqui, e vai para a conta agora
        // com a versão da conta que este aparelho conhecia (base): junta as duas (o que mudou lá entra, o pendente daqui fica)
        if (prefsBase() && Object.keys(r.settings || {}).length) { mergeRemote(r.settings); S.synced = true; if (prefsDirty()) pushPrefsNow(); applyTheme(); migrateClipKey(); maybeShowNews(); renderSide(); return; }
        if (prefsDirty() && Object.keys(r.settings || {}).length) { S.synced = true; pushPrefsNow(); applyTheme(); migrateClipKey(); maybeShowNews(); renderSide(); return; }
        setPrefsBase(r.settings || {});
        const keep = Object.fromEntries(DEVICE_PREF_KEYS.map(k => [k, S.prefs[k]]));
        const local = { ...S.prefs }; Object.assign(S.prefs, r.settings || {}, keep); for (const k in keep) if (keep[k] === undefined) delete S.prefs[k]; relite(r.settings || {}, local); S.synced = true;
        localStorage.setItem('lc_prefs', JSON.stringify(S.prefs)); applyTheme();
        migrateClipKey();
        if (!Object.keys(r.settings || {}).length) { markNewsSeen(); savePrefs(); } else maybeShowNews(); // conta nova não precisa da lista do que mudou
        renderSide();
      }).catch(() => { S.synced = true; });
      if (pendingInvite) { const c = pendingInvite; pendingInvite = null; history.replaceState({}, '', '/'); joinInvite(c); }
      // reconectou: o que chegou com a conexão caída não veio por evento. Os canais guardados (fora o aberto) são
      // esquecidos e carregam de novo ao abrir; o aberto busca o que falta (scripts/tab-lifecycle-test.mjs)
      if (wasReady) for (const cid of [...S.messages.keys()]) if (cid !== S.view.cid) { S.messages.delete(cid); S.loaded.delete(cid); }
      applyRoute(true);
      if (wasReady && S.view.cid && S.messages.has(S.view.cid)) catchUp(S.view.cid);
      if (S.prefs.desktopNotif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      break;
    }
    case 'USER_DELETE': { S.rels.delete(d.id); renderMembers(); renderSide(); if (S.view.kind === 'home') renderMain(); break; }
    case 'USER_UPDATE': applyUser(d); break;
    // presença pequena (servidor novo): só status e aparelhos; ver broadcastStatus no servidor
    case 'PRESENCE': { const old = S.users.get(d.id); if (old && (old.status !== d.status || String(old.platforms || '') !== String(d.platforms || ''))) applyUser({ ...old, status: d.status, platforms: d.platforms || [] }); break; }
    case 'PRESENCE_SYNC': { // abriu um servidor: quem está online nele agora (o resto, offline)
      const g = S.guilds.get(d.guild_id); if (!g) break;
      const on = new Map((d.online || []).map(([id, st, pl]) => [id, { st, pl: pl || [] }])); let n = 0;
      for (const id of g.members.keys()) {
        const u = S.users.get(id), w = on.get(id) || { st: 'offline', pl: [] }; if (!u || (u.status === w.st && String(u.platforms || '') === String(w.pl))) continue;
        applyUser({ ...u, status: w.st, platforms: w.pl }, true); n++;
      }
      if (n) { renderSide(); renderMembers(); }
      break;
    }

    case 'GUILD_CREATE': ingestGuild(d); renderRail(); if (!S.view.gid || S.view.gid === 'new') go(d.id); else { renderSide(); } break;
    case 'GUILD_UPDATE': Object.assign(S.guilds.get(d.id) || {}, d); renderRail(); renderSide(); break;
    case 'GUILD_DELETE': {
      const g = S.guilds.get(d.id);
      if (g) for (const [uid, v] of S.voice) if (g.channels.some(c => c.id === v.channel_id)) { S.voice.delete(uid); if (uid === S.me.id) voice.leave(); }
      S.guilds.delete(d.id); renderRail();
      if (d.kicked) toast(g ? `Você foi removido do servidor ${g.name}.` : 'Você foi removido do servidor.', true); // avisa mesmo olhando outro lugar
      if (S.view.gid === d.id) go('@me');
      break;
    }
    case 'CHANNEL_CREATE': { const g = guild(d.guild_id); if (g) { g.channels.push(d); g.channels.sort((a, b) => a.position - b.position); renderSide(); } break; }
    case 'CHANNEL_UPDATE': { const g = guild(d.guild_id); if (g) { const i = g.channels.findIndex(c => c.id === d.id); if (i >= 0) g.channels[i] = d; renderSide(); if (S.view.cid === d.id) renderMain(); } break; }
    case 'CHANNEL_DELETE': {
      const g = guild(d.guild_id); if (!g) break;
      g.channels = g.channels.filter(c => c.id !== d.id); S.messages.delete(d.id);
      if (S.view.cid === d.id) go(d.guild_id); else renderSide();
      break;
    }
    case 'ACTIVITY_UPDATE': onActivityUpdate(d); break;
    case 'INTEGRATION_UPDATE': onIntegrationUpdate(d); break;
    case 'DM_CREATE': { S.dms.set(d.id, d); d.recipients.forEach(mergeUser); renderSide(); renderRail(); break; }
    case 'MEMBER_ADD': { const g = guild(d.guild_id); if (g) { g.members.set(d.member.user_id, d.member); mergeUser(d.user); renderMembers(); } break; }
    case 'MEMBER_REMOVE': { const g = guild(d.guild_id); if (g) { g.members.delete(d.user_id); renderMembers(); } break; }
    case 'MEMBER_UPDATE': { const g = guild(d.guild_id); if (g) { g.members.set(d.user_id, { user_id: d.user_id, nickname: d.nickname, roles: d.roles, joined_at: d.joined_at, timeout_until: d.timeout_until, softmute_until: d.softmute_until }); renderMembers(); renderSide(); refreshAuthors(d.user_id); if (d.user_id === S.me.id && S.view.gid === d.guild_id) renderSoftmute(); } break; }
    case 'ROLE_UPDATE': { const g = guild(d.guild_id); if (g) { const i = g.roles.findIndex(r => r.id === d.role.id); if (i >= 0) g.roles[i] = d.role; else g.roles.push(d.role); g.roles.sort((a, b) => b.position - a.position); renderMembers(); } break; }
    case 'ROLE_DELETE': { const g = guild(d.guild_id); if (g) { g.roles = g.roles.filter(r => r.id !== d.id); for (const m of g.members.values()) m.roles = m.roles.filter(r => r !== d.id); renderMembers(); } break; }
    case 'FRIEND_LOST': {
      mergeUser(d.user);
      S.friendLosses = [d, ...(S.friendLosses || []).filter(x => x.user.id !== d.user.id)];
      noticeFriendLosses([d]); refreshInboxRequests();
      break;
    }
    case 'FRIEND_LOSSES': { S.friendLosses = d.list || []; S.friendLosses.forEach(x => mergeUser(x.user)); refreshInboxRequests(); break; }
    case 'RELATIONSHIP': {
      mergeUser(d.user);
      if (!d.type) S.rels.delete(d.user.id); else S.rels.set(d.user.id, d);
      if (d.type === 3) { toast(`${d.user.display_name} enviou um pedido de amizade`); if (alertAllowed('dm')) playSound('friend'); }
      renderRail(); updateTitle(); if (S.view.kind === 'home') { renderMain(); renderSide(); }
      if (d.type === 1 && S.friendLosses?.some(x => x.user.id === d.user.id)) S.friendLosses = S.friendLosses.filter(x => x.user.id !== d.user.id); // voltaram a ser amigos
      refreshInboxRequests(); // caixa de entrada aberta em Pedidos: atualiza
      break;
    }
    case 'VOICE_STATE': {
      const prevVs = S.voice.get(d.user_id), before = prevVs?.channel_id, mineCh = voice.channelId;
      if (d.channel_id) S.voice.set(d.user_id, d); else S.voice.delete(d.user_id);
      if (d.channel_id && d.channel_id === voice.channelId) { if (d.user_id === S.me.id && before !== d.channel_id) scanOutdated(); else warnOutdated(d); }
      if (d.user_id !== S.me.id && (prevVs?.fx || null) !== (d.fx || null)) voice?.setPeerFx(d.user_id);
      if (S.view.kind === 'home') { setTimeout(renderActiveNow); setTimeout(refreshFeedView); }
      if ((before || null) !== (d.channel_id || null) && $('#members')) renderMembers(); // ícone "em chamada" na lista de membros
      if (d.user_id === S.me.id && d.channel_id !== before) resetPresenceSounds(); // saí ou troquei de sala: sons pendentes da sala antiga não tocam mais
      if (d.user_id === S.me.id && !d.channel_id) musicOnState({ active: false });
      if (d.user_id === S.me.id && !d.channel_id && voice.active && voice.channelId === d.prev_channel_id) voice.leave();
      if (d.user_id !== S.me.id && !d.bot && !prevVs?.bot) { // o bot entrando/saindo não toca o som de pessoa
        const prevState = prevVs, dmCh = S.dms.get(d.channel_id || d.prev_channel_id);
        if (mineCh && d.channel_id === mineCh && before !== mineCh) presenceSound(d.user_id, 'join');
        else if (mineCh && before === mineCh && d.channel_id !== mineCh) presenceSound(d.user_id, 'leave'); // saiu, caiu ou foi para outra sala
        else if (mineCh && d.channel_id === mineCh && before === mineCh) { // mudou algo dentro da minha sala
          if (d.screen && !prevState?.screen) playSound('streamStart');
          else if (!d.screen && prevState?.screen) playSound('streamStop');
          if (d.video && !prevState?.video) playSound('camOn');
          else if (!d.video && prevState?.video) playSound('camOff');
        } else if (dmCh && d.channel_id && !before && !mineCh) incomingCall(dmCh, d.user_id);
      }
      if (!d.channel_id && S.dms.has(d.prev_channel_id)) document.getElementById('call-banner')?.remove();
      renderSide(); renderRail(); renderVoiceUI(); if (S.view.cid && [1, 2].includes(channelById(S.view.cid)?.type)) renderCallBar();
      break;
    }
    case 'STREAM_VIEWERS': if (d.viewers.length) S.viewers.set(d.streamer_id, d.viewers); else S.viewers.delete(d.streamer_id); renderVoiceUI(); break;
    case 'SOUNDBOARD': sbIncoming(d, voice); break;
    case 'CALL_INVITE': onCallInvite(d); break;
    case 'ADMIN_ALERT': toast('⚠️ ' + d.text, true); notify('Resenha: servidor lento', d.text); break; // só o administrador recebe (server/perf.js)
    case 'LFG_POST': case 'LFG_REQUEST': case 'LFG_ANSWER': onLfgEvent(t, d); break;
    case 'CLIP_CREATE': case 'CLIP_UPDATE': case 'CLIP_DELETE': onClipEvent(t, d); if (t !== 'CLIP_CREATE') updateClipEmbeds(t, d); break;
    case 'REMOTE_REQUEST': case 'REMOTE_STATE': case 'REMOTE_INPUT': case 'REMOTE_ERROR': onRemoteEvent(t, d); break;
    case 'CALL_INVITE_UPDATE': onCallInviteUpdate(d); break;
    case 'ROOM_STATE': if (d.channel_id === voice?.channelId) { if (d.code && !(S.room?.cid === d.channel_id && S.room.code)) codeSet(d.code); if (!d.code) codeReset(); const prevSpot = S.room?.cid === d.channel_id ? S.room.spot : null; S.room = { cid: d.channel_id, wb: d.wb, code: !!d.code, spot: d.spot || null, spotBy: d.spot_by || null }; boardState(d.boards);
      if ((d.spot || null) !== prevSpot && S.prefs.followSpot !== false) { // destaque para todos: acompanha, a não ser que tenha desligado
        if (d.spot) { S.focus = d.spot; if (d.spot_by && d.spot_by !== S.me.id) toast(`${nameOf(d.spot_by, channelById(d.channel_id)?.guild_id)} destacou uma transmissão para a sala`); } else if (S.focus === prevSpot) S.focus = null;
      } if (S.annot && !hasScreenOf(S.annot)) S.annot = null; renderVoiceUI(); } break;
    case 'ROOM_DRAW': if (d.channel_id === voice?.channelId) onDraw(d); break;
    case 'ROOM_CODE': if (d.channel_id === voice?.channelId) codeSet(d); break;
    case 'MUSIC_STATE': if (d.channel_id === voice.channelId) musicOnState(d); break;
    case 'MUSIC_RES': musicOnRes(d); break;
    case 'SOUNDS_UPDATE': { const g = guild(d.guild_id); if (g) { g.sounds = d.sounds; document.dispatchEvent(new Event('sb-changed')); } break; }
    case 'EMOJIS_UPDATE': { const g = guild(d.guild_id); if (g) { g.emojis = d.emojis; renderMessages(true); } break; }
    case 'VOICE_JOINED': voice.onJoined(d); break;
    case 'VOICE_DENIED': if (voice.channelId === d.channel_id) { voice.leave(); if (d.code === 'outdated') outdatedModal(d); else toast(d.reason, true); } break;
    case 'VOICE_PEER_LEFT': voice.onPeerLeft(d); break;
    case 'VOICE_SIGNAL': voice.onSignal(d); break;
    case 'SFU_RES': voice.onSfuRes(d); break;
    case 'PONG': wsPings.get(d.n)?.(); break;
    case 'SFU_NEW_PRODUCER': voice.onSfuProducer(d); break;
    case 'SFU_CODEC_FALLBACK': voice.onCodecFallback(d); break;
    case 'SFU_CONSUMER_CLOSED': voice.onSfuConsumerClosed(d); break;
    case 'SFU_SPEAKING': if (voice.channelId === d.channel_id) voice.onSfuSpeaking(d); break;
    case 'NATIVE_SCREEN_END': nativeEnded(d); voice?.onNativeEnded(d); break;
    case 'TYPING': {
      let m = S.typing.get(d.channel_id); if (!m) S.typing.set(d.channel_id, m = new Map());
      m.set(d.user_id, Date.now() + 8000); renderTyping(); previewTyping(); setTimeout(() => { renderTyping(); previewTyping(); }, 8100); break;
    }
    case 'MESSAGE_CREATE': onMessage(d); break;
    case 'E2EE_KEY': onE2eeKey(d); break;
    case 'READ_STATE': onReadState(d); break; // lido em outro aparelho (ou nesta conta por outra aba)
    case 'SETTINGS_UPDATE': onSettingsSync(d); break;
    case 'DEVICES': S.devices = (d.active || []).filter(x => x.tab !== tabId); break;
    case 'REP_CASE': onRepCase(d); break;
    case 'MESSAGE_UPDATE': {
      const list = S.messages.get(d.channel_id); const i = list?.findIndex(m => m.id === d.id);
      if (i >= 0) { list[i] = d; if (S.view.cid === d.channel_id) { const el = $(`[data-mid="${d.id}"]`); if (el) { const prev = list[i - 1]; el.replaceWith(msgEl(d, prev)); } } }
      break;
    }
    case 'MESSAGE_DELETE': {
      const list = S.messages.get(d.channel_id); if (!list) break;
      const i = list.findIndex(m => m.id === d.id); if (i >= 0) list.splice(i, 1);
      if (S.view.cid === d.channel_id) renderMessages(true);
      break;
    }
    case 'MESSAGE_DELETE_BULK': { // alguém apagou as próprias mensagens em massa (Privacidade → Apagar minhas mensagens)
      const list = S.messages.get(d.channel_id); if (!list) break;
      const gone = new Set(d.ids || []), n = list.length;
      for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
      if (list.length !== n && S.view.cid === d.channel_id) renderMessages(true);
      break;
    }
  }
}

// perfil vindo de mensagens, cartões e listas: o status de verdade só chega por presença (READY e USER_UPDATE). Quem escolheu
// esconder a presença vai como offline nesses dados genéricos; quem pode ver não perde o status certo que já tem.
const mergeUser = (u) => { if (!u?.id) return; const old = S.users.get(u.id); S.users.set(u.id, old ? { ...old, ...u, status: old.status, platforms: old.platforms ?? u.platforms } : u); };
const detached = new Set(); // canais em que estou vendo o início do histórico (sem as mensagens recentes)
function onMessage(m) {
  const list = S.messages.get(m.channel_id), gap = detached.has(m.channel_id);
  if (list && !gap && !list.some(x => x.id === m.id)) list.push(m);
  mergeUser(m.author);
  const mine = m.author_id === S.me.id, viewing = S.view.cid === m.channel_id && document.hasFocus() && !vcChatHidden(channelById(m.channel_id));
  const t = S.typing.get(m.channel_id); if (t) { t.delete(m.author_id); renderTyping(); previewTyping(); }
  previewMessage(m); onFilesMessage(m);
  if (S.view.cid === m.channel_id && m.author_id !== S.me.id) $('#vc-chat-btn:not(.sel)')?.classList.add('unread'); // chat da sala fechado
  ghostFor(m);
  if (S.view.cid === m.channel_id && list && !gap) appendMessage(m);
  const dmc = S.dms.get(m.channel_id);
  if (dmc) { dmc.last_message = { id: m.id, author_id: m.author_id, content: (m.content || '').slice(0, 140), created_at: m.created_at, attachment: !!m.attachments?.length }; if (inMessages()) renderSide(); if (S.view.kind === 'messages') renderMain(); }
  if (mine) return;
  const ch = channelById(m.channel_id), isDM = ch?.type === 1, pol = notifPolicy(ch);
  const text = m.content || '', direct = text.includes(`<@${S.me.id}>`);
  const isMention = isDM ? !pol.muted && pol.level !== 'none' : ((m.mentions || []).includes(S.me.id) && (direct || !pol.noEveryone)); // DM silenciada ainda conta como não lida, mas sem som nem aviso
  const counts = isDM || (isMention && pol.level !== 'none') || (!pol.muted && pol.level === 'all');
  if (!viewing) {
    if (counts) { const u = S.unread[m.channel_id] ||= { count: 0 }; u.count++; u.last_id = m.id; }
    // outro aparelho da conta em uso e este parado: conta como não lida, mas sem som nem aviso aqui (state.js quietHere)
    // modo foco: só mensagens diretas avisam; não perturbe: nada avisa (as não lidas continuam contando)
    const quiet = quietHere() || !alertAllowed(isDM ? 'dm' : 'server');
    if (isMention && pol.level !== 'none') {
      S.mentions[m.channel_id] = (S.mentions[m.channel_id] || 0) + 1;
      if (!quiet) playSound('mention');
      if (!quiet) notify(isDM ? m.author.display_name : `${m.author.display_name} (#${ch?.name})`, S.prefs.notifPreview === false ? 'Nova mensagem' : (inviteText(themeText(text)) || 'Anexo'), () => go(ch.guild_id || '@me', ch.id), m.channel_id);
    } else if (counts && !isDM && !quiet) playSound('message');
    renderRail(); renderSide(); updateTitle();
  } else ack(m.channel_id);
}
function updateTitle() {
  const n = Object.values(S.mentions).reduce((a, b) => a + b, 0);
  document.title = (n ? `(${n}) ` : '') + 'Resenha';
  desktop?.setBadge?.(n);
  for (const btn of document.querySelectorAll('.inbox-btn')) { btn.querySelector('.ibadge')?.remove(); const b = inboxBadge(); if (b) btn.append(b); }
}
function ack(cid) {
  closeNotifs(cid);
  if (!S.unread[cid] && !S.mentions[cid]) return;
  delete S.unread[cid]; delete S.mentions[cid]; api('POST', `/channels/${cid}/ack`).catch(() => { });
  renderRail(); renderSide(); updateTitle();
}
// ---- sincronização entre aparelhos ----
// lido em outro aparelho: tira a não lida e a menção, fecha a notificação daquela conversa e atualiza o número do ícone
// na hora (antes o celular só sabia no próximo READY, e as notificações do que já foi lido no PC continuavam lá)
function onReadState(d) {
  if (d.tab && d.tab === tabId) return; // eco do meu próprio "lido"
  closeNotifs(d.channel_id);
  const u = S.unread[d.channel_id];
  if (!u && !S.mentions[d.channel_id]) return;
  if (!d.latest && u?.last_id && u.last_id > d.last_id) return; // chegou mensagem nova depois do ponto lido lá
  delete S.unread[d.channel_id]; delete S.mentions[d.channel_id];
  renderRail(); renderSide(); updateTitle();
}
// configurações mudadas em outro aparelho: aplica aqui sem recarregar (menos as que são só desta máquina)
// outro aparelho/aba mudou ajustes: junta com os daqui (mergeRemote), sem perder o que ainda não foi enviado daqui
function onSettingsSync(d) {
  if (!d.settings || (d.tab && d.tab === tabId)) return;
  if (!S.synced) return; // ainda carregando: o GET /me/settings do início já traz a versão mais nova
  if (mergeRemote(d.settings)) prefsChanged();
}
function prefsChanged() {
  applyTheme(); renderRail(); renderSide(); renderMembers();
  if (S.searchOpen && !GS.q) renderGS();
}
S.onPrefsMerged = prefsChanged; // a resposta do envio trouxe mudanças de outro aparelho
// modo foco ligado/desligado (e o fim do horário escolhido): atualiza o selo na barra do perfil
document.addEventListener('focus-mode', () => { if (ready) renderSide(); });
setInterval(() => { const f = S.prefs.focusUntil; if (typeof f === 'number' && f <= Date.now()) { delete S.prefs.focusUntil; savePrefs(); if (ready) { renderSide(); toast('Modo foco terminou: os servidores voltaram a avisar'); } } }, 30000);
// outra aba do app neste navegador mudou as preferências (state.js): aplica aqui também
document.addEventListener('prefs-changed-elsewhere', () => { if (!ready) return; applyTheme(); syncThrottle(voice); renderRail(); renderSide(); renderMembers(); });
// este aparelho está em uso? (janela em foco, visível e com mexida nos últimos 2 min) — o servidor repassa aos outros
let lastActive = null, lastInput = Date.now();
const devKind = () => (desktop ? 'desktop' : matchMedia('(pointer: coarse)').matches ? 'mobile' : 'web');
function reportActive() {
  const on = document.hasFocus() && !document.hidden && Date.now() - lastInput < 120e3;
  if (on === lastActive || ws?.readyState !== 1) return;
  lastActive = on; gwSend('ACTIVE', { active: on, kind: devKind() });
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { lastInput = Date.now(); if (!lastActive) reportActive(); }, { passive: true, capture: true });
window.addEventListener('focus', reportActive); window.addEventListener('blur', () => setTimeout(reportActive, 50));
document.addEventListener('visibilitychange', reportActive);
setInterval(reportActive, 15e3);
// ---- reputação: limite de envio aplicado pela comunidade ----
const softmuteUntil = (gid) => { const t = gid && member(gid, S.me.id)?.softmute_until; return t && t > Date.now() ? t : 0; };
function renderSoftmute() {
  const bar = $('#softmute-bar'); if (!bar) return;
  const ch = channelById(S.view.cid), on = !!softmuteUntil(ch?.guild_id);
  bar.classList.toggle('hidden', !on); if (!on) return bar.replaceChildren();
  const wait = S.slowUntil?.[ch.guild_id] > Date.now() ? Math.ceil((S.slowUntil[ch.guild_id] - Date.now()) / 1000) : 0;
  bar.replaceChildren(icon('shield', 16), h('span', h('b', 'Envio limitado pela comunidade. '),
    'Várias pessoas marcaram suas mensagens recentes; até a moderação analisar, você envia 1 mensagem a cada pouco tempo.',
    wait ? h('b.sm-wait', ` Próxima em ${wait >= 60 ? Math.floor(wait / 60) + ':' + String(wait % 60).padStart(2, '0') : wait + ' s'}.`) : null));
  clearTimeout(renderSoftmute.t); if (wait) renderSoftmute.t = setTimeout(renderSoftmute, 1000);
}
function onRepCase(d) {
  if (d.resolved) return;
  const g = guild(d.guild_id); if (!g) return;
  toast(`${nameOf(d.user_id, d.guild_id)} foi limitado(a) em ${g.name}: ${d.flaggers} pessoas marcaram as mensagens. Menu do servidor → Reputação para analisar.`);
}
window.addEventListener('focus', () => S.view.cid && !vcChatHidden(channelById(S.view.cid)) && ack(S.view.cid));

// =============== Navegação ===============
function go(gid, cid) {
  const hash = `#/${gid || '@me'}${cid ? '/' + cid : ''}`;
  if (location.hash === hash) applyRoute(); else location.hash = hash;
}
// nomes de canais mudaram nas configurações: redesenha onde eles aparecem
const chNameKey = () => ['chCaps', 'chDashes', 'chNoEmoji', 'chNamesVoice', 'chNameWords'].map(k => S.prefs[k]).join('|');
let lastChNames = chNameKey();
document.addEventListener('settings-closed', () => { if (!ready || chNameKey() === lastChNames) return; lastChNames = chNameKey(); renderSide(); if (S.view.cid) renderMain(); });
window.addEventListener('hashchange', () => { hidePreview(); if (ready) { S.staggerNext = true; S.inVT = true; viewTransition(() => { applyRoute(); S.inVT = false; }); S.inVT = false; if (voice) updatePip(pipCtx); } }); // troca de tela com as duas versões sobrepostas (motion.js)
let routeBack = '#/@me'; // última tela "de verdade" (o link de clipe abre por cima dela)
function applyRoute(first) {
  queueMicrotask(applyCamFlow); // saiu da sala (ou voltou): as câmeras pausam/voltam
  const clipId = /^#\/clip\/(\d+)/.exec(location.hash)?.[1];
  if (clipId) { history.replaceState(null, '', routeBack); openClip(clipId); if (!first && S.view.gid) return; }
  routeBack = location.hash || '#/@me';
  let [, gid, cid] = location.hash.match(/^#\/([^/]+)(?:\/(.+))?$/) || [];
  gid ||= '@me';
  if (gid === '@me') {
    S.view = { kind: 'home', gid: '@me', cid: cid && S.dms.has(cid) ? cid : null, tab: S.view.tab || 'online' };
    if (S.view.cid) { S.view.kind = 'dm'; localStorage.setItem('lc_lastdm', S.view.cid); }
    localStorage.setItem('lc_metab', cid && (S.dms.has(cid) || cid === 'messages') ? 'messages' : 'friends');
    if (cid === 'messages') S.view = { kind: 'messages', gid: '@me', cid: 'messages', tab: S.view.tab }; // seção Mensagens sem conversa aberta
    if (cid === 'lfg') S.view = { kind: 'lfg', gid: '@me', cid: 'lfg', tab: S.view.tab }; // aba Procurar jogadores (não é uma DM)
    if (cid === 'discover') S.view = { kind: 'discover', gid: '@me', cid: 'discover', tab: S.view.tab }; // aba Descobrir: notícias, promoções, lançamentos
    { const fm = /^(\d+)\/files$/.exec(cid || ''); if (fm && S.dms.has(fm[1])) S.view = { kind: 'files', gid: '@me', cid: 'files', dm: fm[1], tab: S.view.tab }; } // Arquivos de uma DM
  } else {
    const g = guild(gid);
    if (!g) { location.hash = '#/@me'; return; }
    if (cid === 'files') { S.view = { kind: 'files', gid, cid: 'files' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    if (cid === 'clips') { S.view = { kind: 'clips', gid, cid: 'clips' }; S.replyTo = null; S.editing = null; clearPending(); closeFloating(); $('#app').classList.remove('nav-open'); syncWatching(null); renderRail(); renderSide(); renderMain(); return; }
    const chans = g.channels.filter(c => c.type !== 4);
    let ch = chans.find(c => c.id === cid) || chans.find(c => c.id === S.lastChannel[gid]) || chans.find(c => c.type === 0) || chans[0];
    S.view = { kind: 'guild', gid, cid: ch?.id || null };
    if (g.partial) loadMembers(gid).catch(() => { }); // mesmo com a lista de membros fechada (menções, cores dos cargos)
    if (ch) { S.lastChannel[gid] = ch.id; localStorage.setItem('lc_last', JSON.stringify(S.lastChannel)); }
  }
  if (S.favMode && !(S.view.cid && isFav(S.view.cid))) S.favMode = false; // saiu dos favoritos (busca, link, outro canal)
  if (S.favMode) S.prefs.favLast = S.view.cid;
  S.replyTo = null; S.editing = null; clearPending(); closeFloating();
  $('#app').classList.remove('nav-open');
  syncWatching(null); renderRail(); renderSide(); renderMain();
  if (!S.inVT) for (const sel of ['#msgs', '#stage', '#members', '#side .list']) { const e = $(sel); if (e) { e.classList.remove('sw'); void e.offsetWidth; e.classList.add('sw'); } } // com a transição de tela, ela já anima
}

// =============== Shell ===============
function buildShell() {
  document.addEventListener('click', (e) => { // link de clipe: abre o clipe no app (não numa janela nova)
    const a = e.target.closest?.('a[href*="/#/clip/"]'); const id = a && /\/#\/clip\/(\d+)/.exec(a.getAttribute('href'))?.[1]; if (!id) return;
    e.preventDefault(); e.stopImmediatePropagation(); openClip(id);
  }, true);
  document.addEventListener('click', (e) => { // confirmar antes de abrir links externos (opcional)
    const a = e.target.closest?.('.msg .body a[href]'); if (!a || !S.prefs.confirmLinks) return;
    e.preventDefault(); confirmBox('Abrir link externo?', a.href, 'Abrir').then(ok => ok && window.open(a.href, '_blank', 'noopener'));
  });
  $('#app').replaceChildren(h('div#rail'), h('div#side'), h('div#gsearch.hidden', { role: 'search', 'aria-label': 'Buscar em tudo' }), h('div#main'));
  $('#app').addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files') && $('#composer')) { e.preventDefault(); if (!$('#dropzone')) $('#chat').append(h('div#dropzone', 'Solte para anexar')); } });
  $('#app').addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#dropzone')?.remove(); });
  initPlugins({ S, go, channelById, guild, user, dmPeer, menu, showInbox: (e) => showInbox(e), inboxBadge: () => inboxBadge() });
  $('#app').addEventListener('drop', (e) => { $('#dropzone')?.remove(); if (e.dataTransfer?.files?.length && $('#composer')) { e.preventDefault(); [...e.dataTransfer.files].forEach(addFile); } });
}

// ---------- trilho de servidores ----------
function guildUnread(g) { return g.channels.some(c => S.unread[c.id]); }
function guildMentions(g) { return g.channels.reduce((n, c) => n + (S.mentions[c.id] || 0), 0); }
function renderRail() {
  if (deferRender(renderRail)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const rail = $('#rail'); if (!rail) return;
  document.getElementById('vcard')?.remove();
  const dmMentions = [...S.dms.keys()].reduce((n, id) => n + (S.mentions[id] || 0), 0);
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const wrap = (cls, tip, el, extra) => h('div.rail-wrap' + cls, { 'data-tip': tip }, el, extra);
  const badge = (n) => n > 0 ? h('div.badge', n > 99 ? '99+' : n) : null;
  const meView = S.view.gid === '@me';
  rail.replaceChildren(
    wrap('.rail-fly' + (meView ? '.active' : ''), 'Mensagens e amigos', h('div.rail-item.rail-tool', { 'data-fly': 'me', onclick: () => openMeSection(), oncontextmenu: (e) => { e.preventDefault(); clearTimeout(RF.meWait); RF.meWait = 0; meFlyShow(e.currentTarget); }, style: { fontSize: '0' } }, icon('dm', 26)), badge(dmMentions + pending)),
    wrap('.rail-fly' + (S.searchOpen ? '.active' : ''), 'Buscar em tudo (Ctrl+Shift+F)', h('div.rail-item.rail-tool', { 'data-fly': 'gs', onclick: () => toggleGlobalSearch(), style: { fontSize: '0' } }, icon('search', 26))),
    // canais favoritos (de qualquer servidor, juntos): aparece quando há pelo menos um
    favList().length > 0 && wrap('.rail-fly' + (S.favMode ? '.active' : '') + (!S.favMode && favList().some(f => S.unread[f.c]) ? '.unread' : ''), 'Canais favoritos',
      h('div.rail-item.rail-tool.fav-btn', { onclick: () => openFavs(), style: { fontSize: '0' } }, icon('star', 24)), badge(favList().reduce((n, f) => n + (S.mentions[f.c] || 0), 0))),
    // conversas fixadas: acesso rápido na barra
    ...pinnedDMs().map(uid => dmWith(uid)).filter(Boolean).map(dm => { const u = user(dmPeer(dm).id);
      return wrap('.raildm' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] && S.view.cid !== dm.id ? '.unread' : ''), u.display_name,
        h('div.rail-item', { onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, u.id) }, u.avatar ? h('img', { src: imgUrl(u.avatar, 48), alt: '' }) : initialsOf(u.display_name)), [h('div.rd-st.status.s-' + (u.status || 'offline')), badge(S.mentions[dm.id] || 0)]); }),
    h('div.sep'),
    ...[...S.guilds.values()].map(g => {
      const rooms = voiceRooms(g);
      const w = wrap((S.view.gid === g.id && !S.favMode ? '.active' : '') + (guildUnread(g) && S.view.gid !== g.id ? '.unread' : ''), rooms.length ? null : g.name,
        h('div.rail-item', { 'data-fly': 'g', 'data-gid': g.id, onclick: () => { gFlyHide(); S.favMode = false; go(g.id); }, oncontextmenu: (e) => { gFlyCancel(); guildMenu(e, g); } }, g.icon ? h('img', { src: imgUrl(g.icon, 48), alt: '' }) : g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)),
        badge(guildMentions(g)) || (rooms.length ? h('div.vbadge', { title: '' }, icon('voice', 12)) : null));
      if (rooms.length) { w.onmouseenter = () => { if (!sideHidden()) voiceCard(w, g); }; w.onmouseleave = () => document.getElementById('vcard')?.remove(); }
      return w;
    }),
    wrap('', 'Adicionar um servidor', h('div.rail-item.add', { onclick: addServerModal, style: { fontSize: '0' } }, icon('plus', 24))),
    // caixa de entrada: no pé da barra, logo acima do seu perfil
    wrap('.rail-inbox', 'Caixa de entrada', h('div.rail-item.rail-tool.inbox-btn', { onclick: (e) => showInbox(e), style: { fontSize: '0' } }, icon('inbox', 24), inboxBadge())));
}
function openMessages() { go('@me', 'messages'); } // sempre a tela inicial de Mensagens (conversas recentes); a conversa se escolhe nela ou na lista
// ---------- busca em tudo (lupa no topo da barra) ----------
// a lista da esquerda vira o painel de busca: onde procurar, ordem (novas/antigas/relevantes) e resultados agrupados por
// servidor e por conversa; abrir um grupo mostra as mensagens ali mesmo
const GS = { q: '', scope: 'all', sort: 'new', groups: null, loading: false, open: null, msgs: {}, seq: 0 };
// Buscar em tudo é um painel próprio, ao lado da lista de canais (antes tomava o lugar dela): continua aberto enquanto
// você troca de servidor e de canal, para comparar o resultado da busca com o que está nos canais. A largura é ajustável
// arrastando a borda (fica na conta). No celular abre por cima e fecha ao escolher um resultado.
const gsNarrow = () => matchMedia('(max-width: 640px)').matches;
const gsNarrowClose = () => { if (gsNarrow()) closeGlobalSearch(); };
function renderGS() {
  const box = $('#gsearch'); if (!box) return;
  box.classList.toggle('hidden', !S.searchOpen);
  if (!S.searchOpen) return box.replaceChildren();
  const old = $('#gs-q'), focused = old && document.activeElement === old, val = old?.value, a = old?.selectionStart, b = old?.selectionEnd;
  const keep = box.querySelector('.gs-list')?.scrollTop || 0;
  const { head, list } = globalSearchPanel();
  const grip = h('div.gs-grip', { title: 'Arraste para mudar a largura', onpointerdown: (e) => {
    e.preventDefault(); const x0 = e.clientX, w0 = box.offsetWidth; grip.setPointerCapture(e.pointerId);
    const mv = (ev) => { box.style.width = Math.max(260, Math.min(720, w0 + ev.clientX - x0)) + 'px'; $('#app').style.setProperty('--gs-w', box.offsetWidth + 'px'); };
    const up = () => { grip.removeEventListener('pointermove', mv); S.prefs.gsWidth = box.offsetWidth; savePrefs(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up, { once: true });
  } });
  if (S.prefs.gsWidth && !gsNarrow()) box.style.width = S.prefs.gsWidth + 'px';
  box.replaceChildren(head, list, grip);
  $('#app').style.setProperty('--gs-w', box.offsetWidth + 'px'); // as abas de canais passam por cima do painel também
  list.scrollTop = keep;
  const inp = $('#gs-q');
  if (old && inp) { inp.value = val; if (focused) { inp.focus(); try { inp.setSelectionRange(a, b); } catch { } } }
}
function toggleGlobalSearch(focus = true) { S.searchOpen = !S.searchOpen; $('#app')?.classList.toggle('gs-open', S.searchOpen); renderRail(); renderGS(); if (S.searchOpen && focus) setTimeout(() => $('#gs-q')?.focus()); }
function closeGlobalSearch() { if (!S.searchOpen) return; S.searchOpen = false; $('#app')?.classList.remove('gs-open'); renderRail(); renderGS(); }
// ---------- Mensagens/Amigos e Buscar em tudo com a lista de canais oculta ----------
// Mensagens e amigos: clique direito (sempre) ou o mouse parado em cima por 1,2 s (lista oculta) abre uma fileira com as
// duas abas; fecha 0,5 s depois que o mouse sai. Buscar em tudo: só abre com clique (passar o mouse não faz nada); com a lista
// oculta, o painel de busca aparece flutuando por cima da conversa e fecha ao clicar fora ou no ícone de novo
const sideHidden = () => !!$('#app.hide-side') && matchMedia('(min-width: 641px)').matches;
const RF = { me: null, meT: 0, meAt: 0, meWait: 0 };
const meFlyOpen = () => !!RF.me && RF.me.isConnected && !RF.me.classList.contains('leaving');
function meFlyHide() { clearTimeout(RF.meT); if (meFlyOpen()) RF.me.remove(); RF.me = null; }
function meFlyShow(anchor) {
  clearTimeout(RF.meT); if (meFlyOpen()) return;
  const tab = S.view.gid !== '@me' ? null : S.view.kind === 'home' ? 'friends' : S.view.kind === 'messages' || S.view.kind === 'dm' ? 'messages' : null;
  const opt = (k, ic, label, fn) => h('button.rf-opt' + (tab === k ? '.on' : ''), { type: 'button', role: 'menuitem', 'aria-current': tab === k ? 'page' : null, onclick: () => { meFlyHide(); fn(); } }, icon(ic, 20), h('span', label));
  const el = RF.me = popout(anchor, h('div.rf-pop', { role: 'menu' }, opt('messages', 'dm', 'Mensagens', openMessages), opt('friends', 'users', 'Amigos', () => go('@me'))));
  el.classList.add('rf-popout'); RF.meAt = Date.now();
  el.addEventListener('mouseenter', () => clearTimeout(RF.meT)); el.addEventListener('mouseleave', meFlyLater);
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, Math.min(r.top + r.height / 2 - b.height / 2, innerHeight - b.height - 8)) + 'px';
}
function meFlyLater() { clearTimeout(RF.meT); RF.meT = setTimeout(meFlyHide, 500); }
// Servidores com a lista de canais oculta: o mouse parado 0,45 s em cima do servidor abre um atalho com Clipes, Arquivos,
// o canal de texto principal e a sala de voz principal (o primeiro de cada tipo, na ordem da lista). Clicar na sala já
// entra nela. Fecha 0,4 s depois que o mouse sai; passar para outro servidor com o atalho aberto troca na hora
const RG = { el: null, gid: null, t: 0, wait: 0 };
const gFlyOpen = () => !!RG.el && RG.el.isConnected && !RG.el.classList.contains('leaving');
function gFlyHide() { clearTimeout(RG.t); gFlyCancel(); if (gFlyOpen()) RG.el.remove(); RG.el = null; RG.gid = null; }
function gFlyCancel() { clearTimeout(RG.wait); RG.wait = 0; }
function gFlyLater() { clearTimeout(RG.t); RG.t = setTimeout(gFlyHide, 400); }
// canais na ordem em que aparecem na lista: os sem categoria primeiro, depois categoria por categoria
const guildChOrder = (g) => { const kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid); return [...kids(null), ...g.channels.filter(c => c.type === 4).flatMap(c => kids(c.id))]; };
function gFlyShow(anchor, g) {
  clearTimeout(RG.t); gFlyCancel(); if (gFlyOpen() && RG.gid === g.id) return;
  const chans = guildChOrder(g), text = chans.find(c => c.type === 0), room = chans.find(c => c.type === 2);
  const here = S.view.gid === g.id && !S.favMode, inRoom = room && voice?.channelId === room.id;
  const people = room ? [...S.voice.values()].filter(v => v.channel_id === room.id) : [];
  const opt = (on, ic, label, fn, extra, tip) => h('button.rf-opt' + (on ? '.on' : ''), { type: 'button', role: 'menuitem', title: tip || null, 'aria-current': on ? 'page' : null, onclick: () => { gFlyHide(); S.favMode = false; fn(); } }, icon(ic, 20), h('span.gf-l', label), extra);
  const el = RG.el = popout(anchor, h('div.rf-pop.gf-pop', { role: 'menu', 'aria-label': g.name },
    h('div.gf-head', g.name),
    opt(here && S.view.kind === 'clips', 'clip', 'Clipes', () => go(g.id, 'clips')),
    opt(here && S.view.kind === 'files', 'file', 'Arquivos', () => go(g.id, 'files')),
    (text || room) && h('div.gf-sep'),
    text && opt(here && S.view.cid === text.id, 'hash', chName(text), () => go(g.id, text.id),
      S.mentions[text.id] > 0 ? h('span.pill', S.mentions[text.id]) : S.unread[text.id] ? h('i.gf-dot') : null),
    room && opt(inRoom, 'voice', chName(room), () => { go(g.id, room.id); joinVoice(room.id); },
      people.length > 0 && h('span.gf-av', people.slice(0, 3).map(v => avatar(user(v.user_id), 20, { status: false })), people.length > 3 && h('small', '+' + (people.length - 3))),
      inRoom ? 'Você está nesta sala' : 'Entrar na sala de voz')));
  el.classList.add('rf-popout', 'gf-popout'); RG.gid = g.id;
  el.addEventListener('mouseenter', () => clearTimeout(RG.t)); el.addEventListener('mouseleave', gFlyLater);
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, Math.min(r.top + r.height / 2 - 24, innerHeight - b.height - 8)) + 'px'; // o nome do servidor na altura do ícone
}
{
  const flyOf = (e) => sideHidden() && e.target.closest?.('#rail [data-fly]')?.dataset.fly;
  document.addEventListener('mouseover', (e) => {
    const k = flyOf(e);
    if (k === 'me') {
      clearTimeout(RF.meT); // voltou para o ícone antes de a fileira fechar
      if (meFlyOpen() || RF.meWait) return; // o mouse andando por dentro do ícone não reinicia a espera
      const anchor = e.target.closest('[data-fly]');
      RF.meWait = setTimeout(() => { RF.meWait = 0; if (anchor.isConnected && anchor.matches(':hover') && !document.querySelector('#layer :is(.popout, .menu, .emoji-picker):not(.leaving):not(.rf-popout)')) meFlyShow(anchor); }, 1200);
    }
    if (k === 'g') {
      const anchor = e.target.closest('[data-fly]'), g = guild(anchor.dataset.gid); if (!g) return;
      clearTimeout(RG.t);
      if (gFlyOpen()) { if (RG.gid !== g.id) gFlyShow(anchor, g); return; } // já aberto: troca de servidor na hora
      if (RG.wait) return;
      RG.wait = setTimeout(() => { RG.wait = 0; if (anchor.isConnected && anchor.matches(':hover') && !document.querySelector('#layer :is(.popout, .menu, .emoji-picker):not(.leaving):not(.rf-popout)')) gFlyShow(anchor, g); }, 450);
    }
  });
  document.addEventListener('mouseout', (e) => {
    const k = flyOf(e), to = e.relatedTarget;
    if (k === 'me' && !to?.closest?.('[data-fly="me"]')) { clearTimeout(RF.meWait); RF.meWait = 0; if (meFlyOpen()) meFlyLater(); }
    if (k === 'g' && to?.closest?.('[data-fly]') !== e.target.closest('[data-fly]')) { gFlyCancel(); if (gFlyOpen() && !to?.closest?.('.gf-popout')) gFlyLater(); }
  });
  // busca flutuando: clicar fora fecha; abrir um resultado também (para ver a mensagem que estava embaixo do painel)
}
const gsKey = (g) => g.guild_id ? 'g:' + g.guild_id : 'd:' + g.channel_id;
async function runGlobalSearch() {
  const q = GS.q.trim(), seq = ++GS.seq; GS.open = null; GS.msgs = {};
  if (!q) { GS.groups = null; GS.loading = false; return renderGS(); }
  GS.loading = true; renderGS();
  const r = await api('GET', `/search/groups?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(GS.scope)}&sort=${GS.sort}`).catch(() => []);
  if (seq !== GS.seq) return; // chegou uma busca mais nova
  GS.groups = (r || []).filter(g => g.guild_id ? guild(g.guild_id) : S.dms.has(g.channel_id)); GS.loading = false; renderGS();
}
// buscas recentes: ficam na conta (S.prefs, sincroniza com os outros aparelhos na hora) — a busca feita no PC aparece no celular
function rememberSearch(q) {
  q = String(q || '').trim(); if (q.length < 2) return;
  const list = (S.prefs.recentSearches || []).filter(x => x.toLowerCase() !== q.toLowerCase());
  S.prefs.recentSearches = [q, ...list].slice(0, 8); savePrefs();
}
async function openGsGroup(g) {
  rememberSearch(GS.q);
  const k = gsKey(g); if (GS.open === k) { GS.open = null; return renderGS(); }
  GS.open = k; renderGS();
  if (GS.msgs[k]) return;
  const seq = GS.seq, list = await api('GET', `/search?q=${encodeURIComponent(GS.q.trim())}&${g.guild_id ? 'guild=' + g.guild_id : 'channel=' + g.channel_id}&sort=${GS.sort}`).catch(() => []);
  if (seq !== GS.seq) return; // a busca mudou no meio: o resultado é da antiga
  GS.msgs[k] = list || []; renderGS();
}
// termos digitados (sem os filtros de:, tem:, em:) para destacar nos resultados
const gsTerms = () => GS.q.split(/\s+/).filter(t => t && !/^(de|tem|em|from|has|in):/i.test(t)).map(t => t.toLowerCase());
function gsMark(text) {
  const terms = gsTerms(); if (!terms.length) return [text];
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return String(text).split(re).map((p, i) => (i % 2 ? h('mark.gs-hl', p) : p));
}
function globalSearchPanel() {
  const input = h('input#gs-q', { type: 'search', placeholder: 'Buscar em tudo', value: GS.q, 'aria-label': 'Buscar em todas as conversas e servidores',
    oninput: debounce((e) => { GS.q = e.target.value; runGlobalSearch(); }, 300), onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); } else if (e.key === 'Enter') rememberSearch(e.target.value); } });
  const head = h('div.gs-head', icon('search', 22), input, h('button.sh-btn', { type: 'button', title: 'Fechar a busca', 'aria-label': 'Fechar a busca', onclick: () => closeGlobalSearch() }, icon('x', 18)));
  const scopeLabel = GS.scope === 'all' ? 'DMs e servidores' : GS.scope === 'dms' ? 'Mensagens diretas' : (guild(GS.scope)?.name || 'Servidor');
  const scopeMenu = (e) => { const it = (k, l) => ({ label: (GS.scope === k ? '✓ ' : '') + l, fn: () => { GS.scope = k; runGlobalSearch(); } });
    const r = e.currentTarget.getBoundingClientRect(); menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [it('all', 'DMs e servidores'), it('dms', 'Só mensagens diretas'), '-', ...[...S.guilds.values()].map(g => it(g.id, g.name))]); };
  const chip = (k, l) => h('button.gs-chip' + (GS.sort === k ? '.on' : ''), { type: 'button', 'aria-pressed': String(GS.sort === k), onclick: () => { GS.sort = k; runGlobalSearch(); } }, l);
  const filters = h('div.gs-filters', h('button.gs-scope', { type: 'button', onclick: scopeMenu }, h('span', scopeLabel), icon('chevdown', 16)), chip('new', 'Novas'), chip('old', 'Antigas'), chip('relevant', 'Relevantes'));
  // servidores e pessoas cujo nome bate com a busca: atalho direto
  const t = GS.q.trim().toLowerCase(), plain = t && !/[:]/.test(t);
  const gHits = plain ? [...S.guilds.values()].filter(g => g.name.toLowerCase().includes(t)).slice(0, 4) : [];
  const pHits = plain ? [...S.dms.values()].map(d => user(dmPeer(d)?.id)).filter(u => u && (u.display_name + ' ' + u.username).toLowerCase().includes(t)).slice(0, 4) : [];
  const fmtN = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : String(n));
  const groupRow = (g) => {
    const gg = g.guild_id && guild(g.guild_id), dm = !gg && S.dms.get(g.channel_id), u = dm && user(dmPeer(dm).id), k = gsKey(g), open = GS.open === k;
    const ic = gg ? h('div.gs-ic', gg.icon ? h('img', { src: imgUrl(gg.icon, 48), alt: '' }) : initialsOf(gg.name)) : avatar(u, 40, { status: false });
    const sub = `${fmtN(g.count)} ${g.count === 1 ? 'mensagem' : 'mensagens'}` + (gg ? ` em ${g.channels} ${g.channels === 1 ? 'canal' : 'canais'}` : '');
    const msgs = open && (GS.msgs[k] ? h('div.gs-msgs', GS.msgs[k].length ? GS.msgs[k].map(m => gsMsg(m, !!gg)) : h('div.dm-empty', 'Nada encontrado')) : h('div.gs-msgs', skeleton('rows', 3)));
    return [h('button.gs-group' + (open ? '.open' : ''), { type: 'button', 'aria-expanded': String(open), onclick: () => openGsGroup(g) }, ic, h('span.gs-t', h('b', gg ? gsMark(gg.name) : gsMark(u.display_name)), h('small', sub)), icon('chevdown', 16)), msgs];
  };
  const hits = (gHits.length + pHits.length > 0) && [h('div.cat', { style: { cursor: 'default' } }, 'Ir para'),
    ...gHits.map(g => h('button.gs-group', { type: 'button', onclick: () => { gsNarrowClose(); go(g.id); } }, h('div.gs-ic', g.icon ? h('img', { src: imgUrl(g.icon, 48), alt: '' }) : initialsOf(g.name)), h('span.gs-t', h('b', gsMark(g.name)), h('small', 'Servidor')))),
    ...pHits.map(u => h('button.gs-group', { type: 'button', onclick: () => { gsNarrowClose(); openDM(u.id); } }, avatar(u, 40), h('span.gs-t', h('b', gsMark(u.display_name)), h('small', 'Mensagem direta'))))];
  const recent = S.prefs.recentSearches || [];
  const recentBox = recent.length > 0 && h('div.gs-recent', h('div.cat', { style: { cursor: 'default' } }, h('span', 'Buscas recentes'),
    h('button.gs-clear', { type: 'button', title: 'Limpar as buscas recentes (em todos os aparelhos)', onclick: () => { S.prefs.recentSearches = []; savePrefs(); renderGS(); } }, 'Limpar')),
    recent.map(q => h('button.gs-rq', { type: 'button', onclick: () => { GS.q = q; const i = $('#gs-q'); if (i) i.value = q; runGlobalSearch(); } }, icon('clock', 16), h('span', q))));
  const body = !t ? [recentBox, h('div.dm-empty', h('p', 'Procure mensagens em todas as suas conversas e servidores.'), h('small', 'Filtros: de:nome · tem:imagem, arquivo, link ou video · em:canal'))]
    : GS.loading && !GS.groups ? skeleton('rows', 4)
    : [hits, GS.groups?.length ? [h('div.cat', { style: { cursor: 'default' } }, 'Mensagens'), ...GS.groups.flatMap(groupRow)] : !GS.loading && h('div.dm-empty', 'Nenhuma mensagem encontrada')];
  return { head, list: h('div.gs-list', filters, body) };
}
function gsMsg(m, inGuild) {
  const ch = channelById(m.channel_id), txt = stripInvites(m.content || '').replace(/<@!?(\d+)>/g, (x, id) => '@' + (S.users.get(id)?.display_name || 'alguém')).replace(/[*_~`>|]/g, '') || (m.attachments?.length ? 'Anexo' : '');
  return h('button.gs-msg', { type: 'button', onclick: () => { rememberSearch(GS.q); gsNarrowClose(); go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } },
    avatar(user(m.author_id), 24, { status: false }),
    h('span.gs-mt', h('span.gs-mh', h('b', nameOf(m.author_id, ch?.guild_id)), inGuild && ch && h('small', '#' + chName(ch)), h('small', shortWhen(m.created_at))), h('span.gs-mb', gsMark(txt.slice(0, 220)))));
}
// ícone de mensagens da barra: volta para a aba usada por último (Mensagens ou Amigos)
function openMeSection() { meFlyHide(); S.favMode = false; if (localStorage.getItem('lc_metab') === 'friends') go('@me'); else openMessages(); }
// salas de voz ocupadas de um servidor: [{ ch, users: [voiceState] }]
const voiceRooms = (g) => g.channels.filter(c => c.type === 2).map(ch => ({ ch, users: [...S.voice.values()].filter(v => v.channel_id === ch.id) })).filter(r => r.users.length);
// cartão ao passar o mouse no servidor: quem está em qual sala
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
const callTimer = (users) => { const t = users.find(v => v.started_at)?.started_at; return t ? h('span.vtimer', { 'data-start': t }, fmtDur(Date.now() - t)) : null; };
setInterval(() => document.querySelectorAll('.vtimer[data-start]').forEach(e => { e.textContent = fmtDur(Date.now() - +e.dataset.start); }), 1000);

function addServerModal() {
  const name = h('input', { value: `Servidor de ${S.me.display_name}`, maxLength: 100 }), code = h('input', { placeholder: 'https://… ou código do convite' });
  const m = modal('Crie seu servidor', 'Seu servidor é onde você e seus amigos conversam.', h('div',
    h('label.f', 'Nome do servidor', name),
    h('div', { style: { textAlign: 'center', color: 'var(--text-muted)', margin: '8px 0' } }, '— ou entre em um servidor —'),
    h('label.f', 'Link ou código de convite', code)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Entrar com convite', cls: 'grey', fn: async () => { if (!code.value.trim()) { toast('Cole um convite', true); return false; } await joinInvite(code.value.trim().split('/').pop()); } }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', '/guilds', { name: name.value }); if (!r) return false; setTimeout(() => go(r.id), 100); } }]);
}
async function joinInvite(code) {
  try {
    const info = await api('GET', `/invites/${encodeURIComponent(code)}`);
    const r = await api('POST', `/invites/${encodeURIComponent(code)}`);
    toast(`Você entrou em ${info.guild.name}!`); setTimeout(() => go(r.id), 150);
  } catch (e) { toast(e.message, true); return false; }
}

const openRep = (gid) => repModal(gid, (m) => { go(gid, m.channel_id); setTimeout(() => jumpTo(m.id), 600); });
// ---------- amigos neste servidor ----------
const ONLINE_FIRST = { online: 0, idle: 1, dnd: 2 };
const friendsIn = (g) => [...S.rels.values()].filter(r => r.type === 1 && g.members?.has?.(r.user.id)).map(r => user(r.user.id))
  .sort((a, b) => ((ONLINE_FIRST[a.status] ?? 3) - (ONLINE_FIRST[b.status] ?? 3)) || a.display_name.localeCompare(b.display_name));
// avatares empilhados (até 3) + "Ana, Bia e mais 2"
const friendNames = (list) => list.length === 1 ? list[0].display_name : list.length === 2 ? `${list[0].display_name} e ${list[1].display_name}` : `${list[0].display_name}, ${list[1].display_name} e mais ${list.length - 2}`;
const avStack = (list, size = 20) => h('span.avstack', list.slice(0, 3).map(u => avatar(u, size, { status: false })));
function friendsInServer(g) {
  const list = friendsIn(g), q = h('input', { type: 'search', placeholder: 'Buscar amigos' }), box = h('div.fis-list');
  const draw = () => { const f = q.value.trim().toLowerCase(); const rows = list.filter(u => !f || u.display_name.toLowerCase().includes(f) || u.username?.toLowerCase().includes(f) || (nameOf(u.id, g.id) || '').toLowerCase().includes(f));
    box.replaceChildren(...(rows.length ? rows.map(u => { const nick = nameOf(u.id, g.id), m = member(g.id, u.id);
      return h('div.fis-row', h('div.fis-av', { onclick: (e) => profile(e.currentTarget, u.id, g.id) }, avatar(u, 36)),
        h('div.fis-t', h('b', { onclick: (e) => profile(e.currentTarget, u.id, g.id) }, u.display_name), h('small', [nick !== u.display_name && `aqui: ${nick}`, '@' + u.username, m?.joined_at && 'entrou em ' + new Date(m.joined_at).toLocaleDateString('pt-BR')].filter(Boolean).join(' · '))),
        h('button.ibtn', { title: 'Mandar mensagem', onclick: () => { closeModals(); openDM(u.id); } }, icon('dm', 18)));
    }) : [h('div.dm-empty', list.length ? 'Nenhum amigo com esse nome' : 'Nenhum amigo seu está neste servidor ainda.')])); };
  q.oninput = draw; draw();
  modal(`Amigos em ${g.name}`, list.length ? `${list.length} ${list.length === 1 ? 'amigo seu está' : 'amigos seus estão'} neste servidor` : '', h('div.fis', list.length > 6 && q, box),
    [list.length ? null : { label: 'Convidar amigos', fn: () => inviteModal(g) }, { label: 'Fechar', cls: 'grey' }].filter(Boolean), { width: '460px' });
  setTimeout(() => q.focus());
}
const closeModals = () => document.querySelectorAll('.backdrop:not(.leaving)').forEach(b => b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
function guildMenu(e, g) {
  const owner = g.owner_id === S.me.id, fr = friendsIn(g);
  menu(e, [
    { label: 'Convidar pessoas', fn: () => inviteModal(g) },
    { label: fr.length ? `Amigos neste servidor (${fr.length})` : 'Amigos neste servidor', hint: fr.length ? friendNames(fr) : 'Nenhum ainda', fn: () => friendsInServer(g) },
    { label: 'Marcar tudo como lido', fn: () => g.channels.forEach(c => ack(c.id)) },
    { label: 'Configurações de notificação…', fn: () => notifCard({ currentTarget: $('#side-head') || document.body }, { g }) },
    { label: 'Apagar minhas mensagens neste servidor…', fn: () => openMyMessages({ guild_id: g.id, title: g.name }) },
    { label: 'Alterar apelido neste servidor', fn: async () => { const n = await promptBox('Apelido neste servidor', 'Apelido', member(g.id, S.me.id)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${g.id}/members/me`, { nickname: n }); } },
    '-',
    can(g.id, PERM.MANAGE_GUILD | PERM.MANAGE_ROLES | PERM.ADMIN) && { label: 'Configurações do servidor', fn: () => openSettings('server', { gid: g.id, voice, logout, go }) },
    isRepMod(g.id) && { label: 'Reputação (casos da comunidade)', fn: () => openRep(g.id) },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Criar canal', fn: () => channelModal(g, 0) },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Criar categoria', fn: () => channelModal(g, 4) },
    '-',
    S.prefs.devMode && { label: 'Copiar ID do servidor', fn: () => navigator.clipboard?.writeText(g.id) },
    owner ? { label: 'Excluir servidor', danger: true, fn: async () => { if (await confirmBox(`Excluir ${g.name}`, 'Essa ação é permanente e apaga todas as mensagens.', 'Excluir servidor')) tryApi('DELETE', `/guilds/${g.id}`); } }
      : { label: 'Sair do servidor', danger: true, fn: async () => { if (await confirmBox(`Sair de ${g.name}`, 'Você precisará de um novo convite para voltar.', 'Sair do servidor')) tryApi('DELETE', `/guilds/${g.id}/members/me`); } },
  ]);
}
// convidar para o servidor: amigos com botão "Convidar" (vai por DM) e o link para copiar embaixo
async function inviteModal(g) {
  const r = await tryApi('POST', `/guilds/${g.id}/invites`); if (!r) return;
  const link = `${location.origin}/invite/${r.code}`;
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
function channelModal(g, type, parent) {
  const name = h('input', { placeholder: type === 2 ? 'Sala de voz' : type === 4 ? 'Nova categoria' : 'novo-canal', maxLength: 100 });
  let t = type;
  const typeSel = type === 4 ? null : h('select', { onchange: (e) => (t = +e.target.value) }, h('option', { value: 0 }, 'Texto'), h('option', { value: 2, selected: type === 2 }, 'Voz'));
  modal(type === 4 ? 'Criar categoria' : 'Criar canal', '', h('div', typeSel && h('label.f', 'Tipo de canal', typeSel), h('label.f', 'Nome', name)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Criar', fn: async () => { const r = await tryApi('POST', `/guilds/${g.id}/channels`, { name: name.value, type: t, parent_id: parent }); if (!r) return false; if (t !== 4) setTimeout(() => go(g.id, r.id), 100); } }]);
}

// ---------- barra lateral ----------
const chIcon = (c) => icon(c.type === 2 ? 'voice' : 'hash', 20);
function renderSide() {
  if (deferRender(renderSide)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const side = $('#side'); if (!side) return;
  let head, list;
  if (S.favMode && favList().length) ({ head, list } = favSide());
  else if ((S.view.gid === '@me' || !guild(S.view.gid)) && inMessages()) {
    // seção Mensagens: lista simples com buscar, nova mensagem e ordenar; fixadas no topo
    const btn = (ic, title, fn, on) => h('button.sh-btn' + (on ? '.on' : ''), { type: 'button', title, 'aria-label': title, onclick: fn }, icon(ic, 20));
    head = meTabs();
    const SORT_L = { recent: 'Mais recentes', unread: 'Não lidas', name: 'Nome (A–Z)' };
    const tools = h('div.dm-tools', h('button.dm-sort', { type: 'button', title: 'Ordenar conversas', onclick: (e) => dmSortMenu(e) }, icon('sort', 18), h('span', SORT_L[S.prefs.dmSort || 'recent'])),
      btn('search', 'Buscar conversa', () => { dmFind.open = !dmFind.open; if (!dmFind.open) dmFind.q = ''; renderSide(); if (dmFind.open) setTimeout(() => $('#dm-q')?.focus()); }, dmFind.open),
      btn('plus', 'Nova mensagem', () => newMessageModal()));
    const q = dmFind.q.trim().toLowerCase();
    const all = sortedDMs().filter(d => !q || (user(dmPeer(d).id).display_name + ' ' + user(dmPeer(d).id).username).toLowerCase().includes(q));
    const pins = pinnedDMs(), pinned = pins.map(id => all.find(d => dmPeer(d)?.id === id)).filter(Boolean), rest = all.filter(d => !pinned.includes(d));
    list = h('div#side-list.dmlist', tools,
      dmFind.open && h('label.dm-q', icon('search', 14), h('input#dm-q', { type: 'search', placeholder: 'Buscar por nome', value: dmFind.q, oninput: debounce((e) => { dmFind.q = e.target.value; renderSide(); setTimeout(() => { const i = $('#dm-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 120), onkeydown: (e) => { if (e.key === 'Escape') { dmFind.open = false; dmFind.q = ''; renderSide(); } } })),
      pinned.length > 0 && h('div.cat', { style: { cursor: 'default' } }, 'Fixadas'), ...pinned.map(d => dmRow(d, true)),
      rest.length > 0 && pinned.length > 0 && h('div.cat', { style: { cursor: 'default' } }, 'Conversas'), ...dmRest(rest),
      !all.length && h('div.dm-empty', q ? 'Nenhuma conversa com esse nome' : [h('p', 'Nenhuma conversa ainda'), h('button.btn', { onclick: () => newMessageModal() }, 'Nova mensagem')]));
  } else if (S.view.gid === '@me' || !guild(S.view.gid)) {
    // seção Amigos: lista de amigos, procurar jogadores e descobrir (quem está online fica na página e no "Ativo agora")
    head = meTabs();
    const pending = [...S.rels.values()].filter(r => r.type === 3).length;
    list = h('div#side-list',
      h('div.ch' + (S.view.kind === 'home' ? '.active' : ''), { onclick: () => go('@me') }, icon('users'), h('span.name', 'Todos os amigos'), pending > 0 && h('span.pill', pending)),
      h('div.ch.lfgrow-side' + (S.view.kind === 'lfg' ? '.active' : ''), { onclick: () => go('@me', 'lfg'), title: 'Anúncios para fechar o squad' }, icon('gamepad'), h('span.name', 'Procurar jogadores')),
      h('div.ch.lfgrow-side' + (S.view.kind === 'discover' ? '.active' : ''), { onclick: () => go('@me', 'discover'), title: 'Notícias, promoções, lançamentos e torneios de jogos' }, icon('compass'), h('span.name', 'Descobrir')));
  } else {
    const g = guild(S.view.gid);
    const menuAt = (el) => { const r = el.getBoundingClientRect(); guildMenu({ preventDefault() { }, clientX: r.left + 8, clientY: r.bottom + 4 }, g); };
    head = h('div#side-head.srv-head' + (g.banner ? '.has-banner' : ''), { style: !g.banner && g.accent ? { borderTop: `3px solid ${g.accent}` } : null },
      g.banner && h('div.srv-banner', { style: { backgroundImage: `url("${String(imgUrl(g.banner, 480)).replace(/["\\\n]/g, encodeURIComponent)}")` } }),
      h('div.srv-name', h('div.gd', { title: 'Ações do servidor', onclick: (e) => menuAt(e.currentTarget) }, h('span', g.name), icon('chevdown', 16)),
        h('button.sh-btn', { type: 'button', title: 'Convidar pessoas', 'aria-label': 'Convidar pessoas para o servidor', onclick: () => inviteModal(g) }, icon('invite', 20))),
      (() => { const fr = friendsIn(g); return fr.length > 0 && h('button.srv-friends', { type: 'button', title: 'Ver os amigos neste servidor', onclick: () => friendsInServer(g) }, avStack(fr, 18), h('span', fr.length === 1 ? `${fr[0].display_name} está aqui` : `${fr.length} amigos aqui`)); })());
    const cats = g.channels.filter(c => c.type === 4), byParent = new Map();
    for (const c of g.channels) if (c.type !== 4) { const k = c.parent_id || null; (byParent.get(k) || byParent.set(k, []).get(k)).push(c); }
    const kids = (pid) => byParent.get(pid) || [];
    if (sideCats.gid !== g.id) { sideCats.gid = g.id; sideCats.open.clear(); }
    const chRow = (c) => {
      const vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
      const pol = c.type === 0 ? notifPolicy(c) : null, live = pol && serverMuted(g.id) && !pol.muted; // reativado num servidor silenciado
      return h('div', h('div.ch' + (S.view.cid === c.id ? '.active' : '') + (S.unread[c.id] && c.type === 0 ? '.unread' : '') + (pol?.muted ? '.muted' : ''),
        { onclick: () => { go(g.id, c.id); }, ondblclick: c.type === 2 ? () => { hidePreview(); joinVoice(c.id); } : null, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c) },
        chIcon(c), h('span.name', chName(c)), isFav(c.id) && h('span.favmark', { title: 'Nos seus favoritos' }, icon('star', 12)), live && h('span.unmutemark', { title: 'Reativado: avisa mesmo com o servidor silenciado' }, icon('bell', 12)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]),
        can(g.id, PERM.MANAGE_CHANNELS) && h('span.actions', { onclick: (e) => { e.stopPropagation(); channelSettings(g, c); } }, icon('gear', 16))),
        vs.length > 0 && h('div.vusers', vs.map(v => vuserRow(g, v))));
    };
    const catRow = (c) => h('div.catblk', h('div.cat' + (S.collapsed.has(c.id) ? '.collapsed' : ''), { onclick: () => { S.collapsed.has(c.id) ? S.collapsed.delete(c.id) : S.collapsed.add(c.id); localStorage.setItem('lc_collapsed', JSON.stringify([...S.collapsed])); renderSide(); }, oncontextmenu: (e) => channelMenu(e, g, c) },
      h('span', { style: { display: 'flex', alignItems: 'center' } }, icon('caret', 12), chName(c)),
      can(g.id, PERM.MANAGE_CHANNELS) && h('span.add', { title: 'Criar canal', onclick: (e) => { e.stopPropagation(); channelModal(g, 0, c.id); } }, icon('plus', 16))),
      !S.collapsed.has(c.id) && (catReady(c, kids(c.id)) ? kids(c.id).map(chRow) : h('div.cat-lazy', { 'data-cat': c.id, style: { height: kids(c.id).length * 36 + 'px' } })),
      S.collapsed.has(c.id) && kids(c.id).filter(k => k.id === S.view.cid || S.unread[k.id]).map(chRow));
    // galeria de clipes do servidor: primeira linha da lista
    const clipsRow = h('div.ch.clipsrow' + (S.view.kind === 'clips' ? '.active' : ''), { onclick: () => go(g.id, 'clips'), title: 'Todos os clipes salvos neste servidor' }, icon('clip', 20), h('span.name', 'Clipes'));
    const filesRow = h('div.ch.clipsrow.filesrow' + (S.view.kind === 'files' ? '.active' : ''), { onclick: () => go(g.id, 'files'), title: 'Fotos, vídeos, áudios, documentos e links enviados neste servidor' }, icon('file', 20), h('span.name', 'Arquivos'));
    list = h('div#side-list', clipsRow, filesRow, kids(null).map(chRow), cats.map((c, i) => (sideCats.i = i, catRow(c))));
  }
  // painel do usuário: aberto (nome, status, microfone, fone, engrenagem) ou recolhido na barra dos servidores
  const pinned = uaPinned();
  const area = h('div#user-area' + (pinned ? '' : '.ua-col'), voice?.active && h('div.ua-vp', voicePanel()), userbar());
  const oldHead = side.querySelector(':scope > #side-head'), oldList = side.querySelector(':scope > #side-list'), oldArea = side.querySelector(':scope > #user-area');
  if (oldHead && oldList && oldArea && head.id === 'side-head' && side.children.length === 3) {
    // mesma tela: atualiza só o que mudou (a área do usuário guarda referências a elementos e é recriada)
    morph(oldHead, head); list = morph(oldList, list); oldArea.replaceWith(area);
    if (sideScroll.last !== sideKey()) list.scrollTop = sideScroll.get(sideKey()) || 0; // outra lista (servidor ↔ conversas)
  } else {
    side.replaceChildren(head, list, area);
    // rolagem guardada pelo evento de scroll (ler scrollTop aqui forçava layout), uma por lista: antes a rolagem da lista
    // de canais de um servidor era aplicada à lista de conversas (e ao fim dela, montando as 500 de uma vez)
    const keep = sideScroll.get(sideKey()); if (keep) list.scrollTop = keep;
  }
  catObs.disconnect(); list.querySelectorAll('.cat-lazy').forEach(el => catObs.observe(el));
  dmObs.disconnect(); const dmPad = list.querySelector('.dm-lazy'); if (dmPad) dmObs.observe(dmPad);
  sideScroll.last = sideKey();
  if (!list._scrollWatch) { list._scrollWatch = true; list.addEventListener('scroll', () => { sideScroll.set(sideKey(), list.scrollTop); }, { passive: true }); }
  // altura do painel do usuário medida pelo ResizeObserver (depois do layout que o navegador já ia fazer). Antes o
  // offsetHeight logo depois de recriar a lista forçava o layout da página inteira na hora (até ~400 ms na abertura)
  uaObs.disconnect(); uaObs.observe(area);
  syncView();
}
const sideScroll = new Map(), sideKey = () => (S.favMode ? 'fav' : guild(S.view.gid) ? S.view.gid : inMessages() ? '@msgs' : '@me');
// servidor com muitas categorias (1.000 canais): só as primeiras, a do canal aberto e as com gente em sala saem montadas; as
// outras viram um espaço do mesmo tamanho e são montadas quando chegam perto da tela (e ficam montadas). Antes cada
// renderSide montava as 1.000 linhas (~45 ms; scripts/perf-big.mjs)
const sideCats = { gid: null, open: new Set(), i: 0 };
const catReady = (c, list) => sideCats.open.has(c.id) || sideCats.i < 6 || list.length <= 3 || list.some(k => k.id === S.view.cid || (k.type === 2 && [...S.voice.values()].some(v => v.channel_id === k.id))) ? (sideCats.open.add(c.id), true) : false;
const catObs = new IntersectionObserver((es) => { let n = 0; for (const en of es) if (en.isIntersecting) { sideCats.open.add(en.target.dataset.cat); n++; } if (n) renderSide(); }, { rootMargin: '600px 0px' });
const uaObs = new ResizeObserver(() => {
  const area = document.getElementById('user-area'); if (!area) return;
  uaObs.unobserve(area); // uma medida por desenho, como antes (abrir ao passar o mouse não mexe nas margens)
  const hgt = area.offsetHeight, open = !area.classList.contains('ua-col') || !!area.querySelector('.ua-vp');
  $('#app').style.setProperty('--ua-h', hgt + 'px'); // a barra dos servidores reserva espaço pro seu perfil
  $('#app').style.setProperty('--ua-side-h', (open ? hgt : 0) + 'px'); // barra solta: a lista ganha a altura toda
});
const lastActivity = (dm) => { const l = S.messages.get(dm.id), a = l?.length ? l[l.length - 1].id : null, b = dm.last_message?.id || null; return a && b ? (a > b ? a : b) : a || b || dm.id; };
const lastTime = (dm) => { const l = S.messages.get(dm.id); return Math.max(+(l?.length ? l[l.length - 1].created_at : 0) || 0, +(dm.last_message?.created_at || 0) || 0); };
// abas Mensagens | Amigos no topo da lista
function meTabs() {
  const msgs = inMessages(), n = [...S.dms.keys()].reduce((t, id) => t + (S.mentions[id] || 0), 0), pend = [...S.rels.values()].filter(r => r.type === 3).length;
  const tab = (on, label, cnt, fn) => h('button.metab' + (on ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(on), onclick: fn }, label, cnt > 0 && h('span.metab-n', cnt > 99 ? '99+' : cnt));
  return h('div#side-head.sh-tabs', { role: 'tablist' }, tab(msgs, 'Mensagens', n, () => openMessages()), tab(!msgs, 'Amigos', pend, () => go('@me')));
}
const inMessages = () => S.view.kind === 'dm' || S.view.kind === 'messages';
const dmFind = { open: false, q: '' };
function sortedDMs() {
  const all = [...S.dms.values()].filter(d => dmPeer(d));
  const by = S.prefs.dmSort || 'recent', recent = (a, b) => (lastTime(b) - lastTime(a)) || (lastActivity(b) > lastActivity(a) ? 1 : -1);
  if (by === 'name') return all.sort((a, b) => user(dmPeer(a).id).display_name.localeCompare(user(dmPeer(b).id).display_name));
  if (by === 'unread') return all.sort((a, b) => (!!S.unread[b.id] - !!S.unread[a.id]) || recent(a, b));
  return all.sort(recent);
}
function dmSortMenu(e) {
  const set = (k) => { S.prefs.dmSort = k; savePrefs(); renderSide(); };
  const cur = S.prefs.dmSort || 'recent', it = (k, l) => ({ label: (cur === k ? '✓ ' : '') + l, fn: () => set(k) });
  menu(e, [it('recent', 'Mais recentes'), it('unread', 'Não lidas primeiro'), it('name', 'Nome (A–Z)')]);
}
// hora curta da última mensagem: "14:05" hoje, "ontem", "12/03"
const shortWhen = (t) => { if (!t) return ''; const d = new Date(+t), now = new Date(); if (sameDay(t, now)) return clock(t); const y = new Date(now); y.setDate(y.getDate() - 1); if (sameDay(t, y)) return 'ontem'; return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
// muitas conversas (500): as primeiras DM_PAGE saem montadas e o resto vira um espaço do mesmo tamanho; chegando perto
// do fim montam mais DM_STEP. Antes abrir Mensagens montava as 500 linhas (com foto, nome e ícones) numa tarefa de ~100 ms
// (scripts/perf-big.mjs). A conversa aberta sempre aparece, mesmo lá embaixo.
const DM_PAGE = 60, DM_STEP = 200, DM_ROW_H = 50;
const dmLim = { n: DM_PAGE, q: '' };
function dmRest(rest) {
  if (dmLim.q !== dmFind.q) { dmLim.q = dmFind.q; dmLim.n = DM_PAGE; }
  if (rest.length <= dmLim.n) return rest.map(d => dmRow(d, false));
  const shown = rest.slice(0, dmLim.n), open = rest.slice(dmLim.n).find(d => d.id === S.view.cid);
  const pad = h('div.dm-lazy', { 'data-key': 'dm-lazy', style: { height: (rest.length - shown.length - (open ? 1 : 0)) * DM_ROW_H + 'px' } });
  return [...shown.map(d => dmRow(d, false)), pad, open && dmRow(open, false)];
}
const dmObs = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { dmLim.n += DM_STEP; renderSide(); } }, { rootMargin: '600px 0px' });
function dmRow(dm, pin) {
  const p = dmPeer(dm), u = user(p.id), un = S.mentions[dm.id];
  return h('div.ch.dmrow' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] ? '.unread' : ''), { onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, p.id), ...previewHooks(dm) },
    avatar(u, 36, { ring: 'var(--bg-sec)' }), styleName(h('span.name', u.display_name), u.name_style), platformIcons(u, 13), un > 0 && h('span.pill', un),
    pin && h('button.dmpin', { type: 'button', title: 'Desafixar', 'aria-label': 'Desafixar conversa', onclick: (e) => { e.stopPropagation(); togglePinDM(p.id); } }, icon('pin', 22)));
}
// tela inicial de Mensagens (botão de Mensagens na barra): em vez de pular para uma conversa, mostra as recentes em
// cartões (foto, nome, prévia da última mensagem, hora e não lidas) para escolher com um clique
function messagesHome() {
  const dms = [...S.dms.values()].filter(d => dmPeer(d)).sort((a, b) => (lastTime(b) - lastTime(a)) || (lastActivity(b) > lastActivity(a) ? 1 : -1));
  const newBtn = h('button.btn', { type: 'button', onclick: () => newMessageModal() }, icon('plus', 16), 'Nova mensagem');
  if (!dms.length) return h('div.empty.msgs-empty', { style: { margin: 'auto' } }, icon('dm', 56), h('h2', 'Suas mensagens'), h('p', 'Converse em particular com seus amigos.'), newBtn);
  const preview = (dm) => {
    const lm = dm.last_message; if (!lm) return 'Nenhuma mensagem ainda';
    const who = lm.author_id === S.me.id ? 'Você: ' : '', txt = plainTs(lm.content || '').replace(/\s+/g, ' ').trim();
    return who + (txt || (lm.attachment ? 'Anexo' : '…'));
  };
  const card = (dm) => {
    const u = user(dmPeer(dm).id), un = S.mentions[dm.id], unread = !!S.unread[dm.id];
    return h('button.mh-card' + (unread ? '.unread' : ''), { type: 'button', onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, u.id), title: `Abrir conversa com ${u.display_name}` },
      avatar(u, 44, { ring: 'var(--bg-float)' }),
      h('span.mh-txt', h('span.mh-top', styleName(h('b', u.display_name), u.name_style), h('small', shortWhen(lastTime(dm)))), h('span.mh-prev', preview(dm))),
      un > 0 && h('span.pill', un));
  };
  return h('div.msgs-home',
    h('div.mh-head', h('div', h('h2', 'Suas mensagens'), h('p', 'Escolha uma conversa para continuar ou comece uma nova.')), newBtn),
    h('h4.mh-sec', 'Conversas recentes'),
    h('div.mh-grid', dms.slice(0, 12).map(card)),
    dms.length > 12 && h('p.mh-more', `Mais ${dms.length - 12} ${dms.length - 12 === 1 ? 'conversa' : 'conversas'} na lista ao lado.`));
}
// nova mensagem: escolher um amigo (ou qualquer pessoa dos seus servidores)
function newMessageModal() {
  const q = h('input', { type: 'search', placeholder: 'Digite o nome de um amigo' }), box = h('div.nm-list');
  const friends = new Set([...S.rels.values()].filter(r => r.type === 1).map(r => r.user?.id || r.id));
  const people = [...new Set([...friends, ...[...S.guilds.values()].flatMap(g => [...g.members.keys()])])].filter(id => id !== S.me.id && S.users.has(id));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const l = people.filter(id => !t || (user(id).display_name + ' ' + user(id).username).toLowerCase().includes(t)).sort((a, b) => (friends.has(b) - friends.has(a)) || user(a).display_name.localeCompare(user(b).display_name)).slice(0, 40);
    box.replaceChildren(...l.map(id => h('button.nm-row', { type: 'button', onclick: () => { m.close(); openDM(id); } }, avatar(user(id), 32), h('span', h('b', user(id).display_name), h('small', '@' + user(id).username)), friends.has(id) && h('small.nm-f', 'Amigo'))),
      !l.length && h('div.dm-empty', 'Ninguém encontrado'));
  };
  q.oninput = draw; q.onkeydown = (e) => { if (e.key === 'Enter') box.querySelector('.nm-row')?.click(); };
  const m = modal('Nova mensagem', 'Escolha com quem conversar.', h('div', h('label.f', q), box), [{ label: 'Cancelar', cls: 'link' }]);
  draw(); setTimeout(() => q.focus());
}
function watchFromList(v) {
  const ch = channelById(v.channel_id); if (!ch) return;
  go(ch.guild_id || '@me', ch.id);
  if (voice.channelId !== ch.id) joinVoice(ch.id);
  if (v.user_id !== S.me.id) { voice.openStream(v.user_id); S.focus = 's:' + v.user_id; }
  renderVoiceUI();
}
function vuserRow(g, v) {
  if (v.bot) return botRow(v);
  const u = user(v.user_id);
  const row = h('div.vuser', { 'data-uid': v.user_id, oncontextmenu: (e) => userMenu(e, v.user_id, g.id), onclick: (e) => profile(e.currentTarget, v.user_id, g.id) },
    (() => { const a = avatar(u, 24, { status: false }); if (voice?.speaking.has(v.user_id)) a.classList.add('speaking'); if (voice?.sbActive.has(v.user_id)) a.classList.add('sbplay'); a.dataset.uid = v.user_id; return a; })(),
    h('span.nm', nameOf(v.user_id, g.id), fxBadge(v.fx)), voiceGameIcon(v.user_id), appBadge(v), v.screen && h('span.live', 'Ao vivo'),
    h('span.ico', v.video && icon('video', 14), muteIco(v), v.deaf && icon('headoff', 14)));
  if (v.screen) { const mine = v.user_id === S.me.id; streamHover(row, { uid: v.user_id, mine, getStream: () => (mine ? voice.screen : voice.peers.get(v.user_id)?.streams.screen), onWatch: () => watchFromList(v) }); }
  return row;
}
// ---------- canais favoritos ----------
// Canais de qualquer servidor reunidos num lugar só (estrela na barra dos servidores), na ordem que você quiser e em
// grupos seus (ex.: "Campanha" com canais de servidores diferentes). Arrastar reordena e muda de grupo. Fica na conta
// (S.prefs.favs: [{ c: id do canal, g: grupo }], S.prefs.favGroups: ordem dos grupos) e sincroniza com os outros aparelhos.
const favList = () => (S.prefs.favs || []).filter(f => { const c = channelById(f.c); return c && c.guild_id && guild(c.guild_id); });
const isFav = (cid) => (S.prefs.favs || []).some(f => f.c === cid);
function toggleFav(c) {
  const list = S.prefs.favs ||= [];
  if (isFav(c.id)) { S.prefs.favs = list.filter(f => f.c !== c.id); if (S.favMode && !favList().length) S.favMode = false; }
  else { list.push({ c: c.id, g: '' }); toast(`#${chName(c)} está nos favoritos (estrela na barra dos servidores)`); }
  savePrefs(); renderRail(); renderSide();
}
function openFavs() {
  const fl = favList(); if (!fl.length) return;
  const f = fl.find(x => x.c === S.prefs.favLast) || fl[0], c = channelById(f.c);
  S.favMode = true; go(c.guild_id, c.id); renderRail(); renderSide();
}
const favGroups = () => { const used = new Set(favList().map(f => f.g).filter(Boolean)); return [...new Set([...(S.prefs.favGroups || []).filter(g => used.has(g)), ...used])]; };
function moveFav(cid, group, beforeCid) {
  const list = (S.prefs.favs || []).filter(f => f.c !== cid), item = { c: cid, g: group || '' };
  const i = beforeCid ? list.findIndex(f => f.c === beforeCid) : -1;
  if (i >= 0) list.splice(i, 0, item); else { let j = -1; list.forEach((f, k) => { if ((f.g || '') === item.g) j = k; }); list.splice(j >= 0 ? j + 1 : list.length, 0, item); }
  S.prefs.favs = list; if (group && !(S.prefs.favGroups || []).includes(group)) (S.prefs.favGroups ||= []).push(group);
  savePrefs(); renderSide();
}
async function newFavGroup(cid) {
  const name = (await promptBox('Novo grupo de favoritos', 'Nome do grupo', '', 'Criar'))?.slice(0, 40); if (!name) return;
  moveFav(cid, name);
}
function favGroupMenuItem(cid) {
  const cur = (S.prefs.favs || []).find(f => f.c === cid)?.g || '';
  return { label: 'Mover para o grupo', sub: [
    { label: 'Sem grupo', radio: cur === '', fn: () => moveFav(cid, '') },
    ...favGroups().map(g => ({ label: g, radio: cur === g, fn: () => moveFav(cid, g) })),
    '-', { label: 'Novo grupo…', fn: () => newFavGroup(cid) }] };
}
function favGroupMenu(e, g) {
  menu(e, [
    { label: 'Renomear grupo', fn: async () => { const n = (await promptBox('Renomear grupo', 'Nome do grupo', g))?.slice(0, 40); if (!n || n === g) return; for (const f of S.prefs.favs || []) if (f.g === g) f.g = n; S.prefs.favGroups = (S.prefs.favGroups || []).map(x => (x === g ? n : x)); savePrefs(); renderSide(); } },
    { label: 'Subir grupo', fn: () => { const gs = favGroups(), i = gs.indexOf(g); if (i > 0) { [gs[i - 1], gs[i]] = [gs[i], gs[i - 1]]; S.prefs.favGroups = gs; savePrefs(); renderSide(); } } },
    { label: 'Descer grupo', fn: () => { const gs = favGroups(), i = gs.indexOf(g); if (i >= 0 && i < gs.length - 1) { [gs[i + 1], gs[i]] = [gs[i], gs[i + 1]]; S.prefs.favGroups = gs; savePrefs(); renderSide(); } } },
    '-', { label: 'Desfazer grupo (os canais continuam nos favoritos)', fn: () => { for (const f of S.prefs.favs || []) if (f.g === g) f.g = ''; S.prefs.favGroups = (S.prefs.favGroups || []).filter(x => x !== g); savePrefs(); renderSide(); } },
  ]);
}
function favSide() {
  const head = h('div#side-head.fav-head', icon('star', 20), h('span', 'Favoritos'),
    h('button.sh-btn', { type: 'button', title: 'Como organizar', 'aria-label': 'Como organizar os favoritos', onclick: () => toast('Arraste para mudar a ordem ou o grupo. Clique direito num canal: grupos e remover. Para adicionar: clique direito num canal de qualquer servidor → Adicionar aos favoritos.') }, icon('info', 18)));
  let dragId = null;
  const drop = (el, group, before) => {
    el.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); el.classList.add('fav-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('fav-over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('fav-over'); if (dragId && dragId !== before) moveFav(dragId, group, before); dragId = null; });
    return el;
  };
  const row = (f) => {
    const c = channelById(f.c), g = guild(c.guild_id), vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
    const el = h('div.ch.favrow' + (S.view.cid === c.id ? '.active' : '') + (S.unread[c.id] && c.type === 0 ? '.unread' : ''), {
      draggable: true, title: `#${chName(c)} — ${g.name}`,
      onclick: () => { S.favMode = true; go(g.id, c.id); }, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c),
      ondragstart: (e) => { dragId = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); el.classList.add('dragging'); },
      ondragend: () => { dragId = null; el.classList.remove('dragging'); } },
      h('span.fav-g', g.icon ? h('img', { src: imgUrl(g.icon, 32), alt: '' }) : initialsOf(g.name)), chIcon(c),
      h('span.name', h('span.fn', chName(c)), h('small', g.name)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]));
    return h('div', drop(el, f.g || '', c.id), vs.length > 0 && h('div.vusers', vs.map(v => vuserRow(g, v))));
  };
  const fl = favList(), loose = fl.filter(f => !f.g);
  const list = h('div#side-list.favlist',
    drop(h('div.fav-drop', loose.length ? null : 'Solte aqui para tirar do grupo'), '', null), loose.map(row),
    favGroups().map(gn => [drop(h('div.cat.fav-cat', { oncontextmenu: (e) => favGroupMenu(e, gn), title: 'Clique direito: renomear, mudar a ordem ou desfazer' }, h('span', gn)), gn, null), fl.filter(f => f.g === gn).map(row)]));
  return { head, list };
}
function channelMenu(e, g, c) {
  menu(e, [
    c.type === 2 && { label: 'Entrar no canal de voz', fn: () => { go(g.id, c.id); joinVoice(c.id); } },
    c.type !== 4 && { label: isFav(c.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos', fn: () => toggleFav(c) },
    c.type !== 4 && isFav(c.id) && favGroupMenuItem(c.id),
    S.unread[c.id] && { label: 'Marcar como lido', fn: () => ack(c.id) },
    // servidor silenciado: o canal (ou a categoria inteira) pode voltar a avisar sem tirar o silêncio do resto
    serverMuted(g.id) && !channelMuted(c.id) ? (S.prefs.notifyCfg?.chUnmute?.[c.id]
      ? { label: c.type === 4 ? 'Silenciar a categoria de novo' : 'Silenciar de novo (seguir o servidor)', fn: () => { setChannelUnmuted(c.id, false); renderSide(); toast(c.type === 4 ? 'A categoria voltou a seguir o servidor silenciado' : `#${chName(c)} voltou a seguir o servidor silenciado`); } }
      : { label: c.type === 4 ? 'Reativar esta categoria' : 'Reativar este canal', hint: 'O servidor continua silenciado', fn: () => { setChannelUnmuted(c.id, true); renderSide(); toast(c.type === 4 ? 'Categoria reativada: o resto do servidor continua silenciado' : `#${chName(c)} reativado: o resto do servidor continua silenciado`); } })
      : c.type !== 4 && { label: channelMuted(c.id) ? 'Reativar canal' : 'Silenciar canal', fn: () => { const n = (S.prefs.notifyCfg ||= {}); const ch = (n.channels ||= {}); channelMuted(c.id) ? delete ch[c.id] : (ch[c.id] = true); savePrefs(); renderSide(); } },
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Editar canal', fn: () => channelSettings(g, c) },
    can(g.id, PERM.CREATE_INVITE) || true ? { label: 'Convidar pessoas', fn: () => inviteModal(g) } : null,
    c.type === 0 && { label: 'Apagar minhas mensagens aqui…', fn: () => openMyMessages({ places: [c.id], title: '#' + chName(c) }) },
    S.prefs.devMode && { label: 'Copiar ID do canal', fn: () => navigator.clipboard?.writeText(c.id) },
    can(g.id, PERM.MANAGE_CHANNELS) && '-',
    can(g.id, PERM.MANAGE_CHANNELS) && { label: 'Excluir canal', danger: true, fn: async () => { if (await confirmBox(`Excluir ${c.name}`, 'Isto não pode ser desfeito.', 'Excluir')) tryApi('DELETE', `/channels/${c.id}`); } },
  ]);
}
function channelSettings(g, c) {
  const name = h('input', { value: c.name, maxLength: 100 }), topic = h('input', { value: c.topic || '', maxLength: 1024 });
  modal('Configurações do canal', c.name, h('div', h('label.f', 'Nome do canal', name), c.type === 0 && h('label.f', 'Tópico', topic)),
    [{ label: 'Excluir', cls: 'red', fn: async () => { if (await confirmBox('Excluir canal', `Excluir ${c.name}?`, 'Excluir')) await tryApi('DELETE', `/channels/${c.id}`); } }, { label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: () => tryApi('PATCH', `/channels/${c.id}`, { name: name.value, topic: topic.value }) }]);
}

function voicePanel() {
  if (!voice?.active) return h('div.hidden');
  const ch = channelById(voice.channelId), g = guild(ch?.guild_id);
  return h('div#voice-panel',
    h('div.t', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, pingEl(), 'Voz conectada', voice.joinedAt && h('span.vtimer.vp-time', { 'data-start': voice.joinedAt, title: 'Tempo na chamada' }, fmtDur(Date.now() - voice.joinedAt)), abrEl()),
      h('span.vp-btns', h('button.ibtn', { title: 'Testar microfone, ruído e eco', onclick: (e) => openMicPanel(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('waves', 20)),
        h('button.ibtn', { title: 'Sair da chamada', onclick: () => voice.leave() }, icon('phoneoff', 20)))),
    h('div.sub', { title: 'Ir para a sala', onclick: () => ch && (ch.type === 1 ? go('@me', ch.id) : go(ch.guild_id, ch.id)) }, `${ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || '')}${g ? ' / ' + g.name : ''}`),
    h('div.row',
      h('button' + (voice.cam ? '.on' : ''), { title: 'Câmera', onclick: () => voiceAct(() => voice.toggleCam()) }, icon('video', 20)),
      voice.screen ? h('button.stopshare', { title: 'Parar transmissão', onclick: stopSharing }, icon('screenoff', 20)) : h('button', { title: 'Transmitir tela', onclick: startShare }, icon('screen', 20)),
      fxButton(20, false),
      h('button', { title: voice.deafened ? 'Soundboard indisponível (ensurdecido)' : 'Soundboard', disabled: voice.deafened, style: voice.deafened ? { opacity: .4, cursor: 'not-allowed' } : null, onclick: (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('soundboard', 20)),
      ch?.guild_id && h('button' + (musicOn() ? '.on' : ''), { title: 'Música: tocar no canal de voz', 'data-keepfloat': '', 'data-music-btn': '', onclick: (e) => openMusic(e.currentTarget, voice) }, icon('musicbot', 20))));
}
const voiceAct = (fn) => Promise.resolve().then(fn).catch(e => toast(e.message, true));
// botões "Experimentar" da janela de Novidades (public/changelog.js)
const newsActions = {
  fx: () => { const b = [...document.querySelectorAll('#voice-panel .row button')].find(x => /Efeito/.test(x.title)); if (voice?.active && b) b.click(); else toast('Entre numa sala de voz e clique no botão de máscara do painel de voz (ou Ctrl+Shift+E).'); },
  gifs: () => { const b = $('#composer .gifbtn'); if (b) b.click(); else toast('Abra um chat e clique em GIF, ao lado do emoji.'); },
  clips: () => { const gid = S.view.gid && S.view.gid !== '@me' ? S.view.gid : [...S.guilds.keys()][0]; if (gid) go(gid, 'clips'); else toast('Entre num servidor para ver a galeria de clipes.'); },
  lfg: () => go('@me', 'lfg'),
  messages: () => openMessages(),
  notifications: () => openSettings('notifications', ctxSettings()),
  requests: () => { inboxTab = 'requests'; showInbox(); },
  servers: () => { const g = [...S.guilds.values()][0]; if (g) friendsInServer(g); else toast('Entre num servidor para ver quais amigos estão nele.'); },
  privacy: () => openSettings('privacy', ctxSettings()),
  mymessages: () => openMyMessages(),
  sounds: () => openSettings('sounds', ctxSettings()),
  appearance: () => openSettings('appearance', ctxSettings()),
  storage: () => openSettings('storage', ctxSettings()),
  lite: () => openSettings('lite', ctxSettings()),
  extras: () => openSettings('extras', ctxSettings()),
  stream: () => openSettings('stream', ctxSettings()),
  poll: () => { const ch = channelById(S.view.cid); if (ch && $('#composer')) pollModal(ch); else toast('Abra um chat e use o + do campo de mensagem → "Criar enquete".'); },
  settings: () => openSettings('news', ctxSettings()),
  ping: () => { const b = $('#vp-ping'); if (b) b.click(); else toast('Entre numa sala de voz e clique no ícone de sinal do painel de voz.'); },
};
// botão de efeitos de voz (painel de voz e controles da sala): com efeito ligado mostra o ícone dele
function fxButton(size, round, cls = '') {
  const f = fxInfo(voice?.fx);
  return h('button' + (round ? '.roundbtn' : '') + (f ? '.fxon' : '') + cls, { title: f ? `Efeito de voz: ${f.label} (clique para trocar)` : 'Efeitos de voz', onclick: (e) => openFxPicker(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) },
    f ? fxIcon(f.id, size) : icon('mask', size));
}
function fxHotkey() {
  if (!voice?.active) return toast('Entre numa sala de voz para usar efeitos.', true);
  const next = voice.fx ? null : (S.prefs.lastFx || 'robo'); voice.setFx(next); savePrefs();
  toast(next ? `Efeito de voz: ${fxInfo(next).label}` : 'Efeito de voz desligado');
}
// botão "Assistir" do feed: entra na sala (se preciso) e abre a transmissão da pessoa em destaque
function watchFriend(uid, ch) {
  const g = ch.type === 1 ? null : guild(ch.guild_id);
  go(g ? g.id : '@me', ch.id);
  if (voice.channelId === ch.id) { voice.openStream(uid); S.focus = 's:' + uid; renderVoiceUI(); return; }
  S.autoWatch = { uid, exp: Date.now() + 20000 };
  joinVoice(ch.id);
}
function joinVoice(cid) {
  if (voice.channelId === cid) return;
  voice.join(cid).then(() => { if (voice.error) { toast(voice.error, true); voice.error = null; } else setTimeout(() => gameTick?.(), 1500); }); // jogo já aberto: oferece transmitir logo
}
// barra de perfil: o avatar fica na barra dos servidores (bolinha de status embaixo, vermelha em cima se o microfone ou o
// som estiver desligado) e a barra com nome, microfone, fone, configurações e alfinete sai dele. Alfinete azul: sempre
// aberta; solto: abre ao passar o mouse ou clicar no avatar
const uaPinned = () => S.prefs.uaPinned ?? !S.prefs.uaCollapsed;
function setUaPinned(v) { S.prefs.uaPinned = v; delete S.prefs.uaCollapsed; savePrefs(); renderSide(); }
let pbHoldUntil = 0, pbHoldT = 0;
function userbar() {
  const me = S.me, ctx = () => ({ voice, logout, go }), pinned = uaPinned();
  const status = () => openStatusPanel((!$('#app.hide-side') && $('#userbar .me')) || $('.pb-av'), { openSettings: (k) => openSettings(k, ctx()), openFullProfile, logout });
  const off = voice?.muted || voice?.deafened;
  const av = h('button.pb-av', { type: 'button', 'aria-label': pinned ? 'Status e perfil' : 'Abrir a barra do perfil', title: `${me.display_name} — ${me.custom_status || STATUS_TXT[me.status]}`,
    onclick: () => { if (pinned || bar.classList.contains('open')) return status(); bar.classList.add('open'); setTimeout(() => document.addEventListener('pointerdown', function out(e) { if (!bar.contains(e.target)) { bar.classList.remove('open'); document.removeEventListener('pointerdown', out, true); } }, true)); },
    oncontextmenu: (e) => statusMenu(e) },
    avatar(me, 40, { status: false }), h('i.pb-st.status.s-' + (me.status || 'online')), focusOn() && h('span.pb-fbadge', { title: 'Modo foco: só mensagens diretas avisam' }, icon('dm', 10)), // microfone/som desligado: o próprio ícone riscado no canto do avatar (antes uma bolinha vermelha), à vista mesmo com a
    // lista oculta; clicar nele religa sem abrir a barra
    off && h('span.pb-off', { role: 'button', tabIndex: 0, title: voice?.deafened ? 'Som desligado — clique para ativar' : 'Microfone desligado — clique para ativar', 'aria-label': voice?.deafened ? 'Som desligado: ativar' : 'Microfone desligado: ativar',
      onclick: (e) => { e.stopPropagation(); voiceToggle(voice?.deafened ? 'deaf' : 'mute'); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); voiceToggle(voice?.deafened ? 'deaf' : 'mute'); } } },
      icon(voice?.deafened ? 'headoff' : 'micoff', 13)));
  const body = h('div#userbar.pb-body',
    h('div.me', { onclick: status, oncontextmenu: (e) => statusMenu(e), title: 'Status e perfil' },
      h('div.names', styleName(h('div.dn', me.display_name), me.name_style), h('div.un', focusOn() ? h('span.pb-focus', icon('dm', 12), 'Modo foco') : me.custom_status || STATUS_TXT[me.status]))),
    swapIcon(h('button.ibtn.pb-mic' + (voice?.muted ? '.on' : ''), { title: (voice?.muted ? 'Ativar microfone' : 'Silenciar') + ' (clique direito: microfone, ruído e eco)', onclick: () => voiceToggle('mute'), oncontextmenu: (e) => { e.preventDefault(); openAudioPanel(e.currentTarget, voice, 'in', { openSettings: (k) => openSettings(k, ctx()) }); } }, icon(voice?.muted ? 'micoff' : 'mic')), 'ua-mic', !!voice?.muted),
    swapIcon(h('button.ibtn.pb-deaf' + (voice?.deafened ? '.on' : ''), { title: (voice?.deafened ? 'Ativar áudio' : 'Ensurdecer') + ' (clique direito: saída e volumes)', onclick: () => voiceToggle('deaf'), oncontextmenu: (e) => { e.preventDefault(); openAudioPanel(e.currentTarget, voice, 'out', { openSettings: (k) => openSettings(k, ctx()) }); } }, icon(voice?.deafened ? 'headoff' : 'headset')), 'ua-deaf', !!voice?.deafened),
    h('button.ibtn.pb-gear', { title: 'Configurações do usuário', onclick: () => openSettings('account', ctx()) }, icon('gear')),
    h('button.ibtn.pb-pin' + (pinned ? '.on' : ''), { title: pinned ? 'Soltar a barra (abre só ao passar o mouse)' : 'Fixar a barra aberta', 'aria-pressed': String(pinned), onclick: () => setUaPinned(!pinned) }, icon('pin', 20)));
  const bar = h('div.pbar' + (pinned ? '.pinned' : '') + (Date.now() < pbHoldUntil ? '.hov' : ''), av, body);
  // a barra solta continua aberta 0,5 s depois que o mouse sai (dá para voltar sem ela sumir); sobrevive a redesenhos
  bar.addEventListener('mouseenter', () => { clearTimeout(pbHoldT); pbHoldUntil = Infinity; bar.classList.add('hov'); });
  bar.addEventListener('mouseleave', () => { clearTimeout(pbHoldT); pbHoldUntil = Date.now() + 500; pbHoldT = setTimeout(() => { pbHoldUntil = 0; document.querySelectorAll('.pbar.hov').forEach(b => b.classList.remove('hov')); }, 500); });
  return bar;
}
function voiceToggle(k) { k === 'mute' ? voice.toggleMute() : voice.toggleDeaf(); }
function statusMenu(e) {
  const set = (status) => tryApi('PATCH', '/me', { status });
  menu(e, ['online', 'idle', 'dnd', 'invisible'].map(s => ({ label: STATUS_TXT[s], fn: () => set(s) })));
}

// ---------- quick switcher ----------
function quickSwitch() {
  const inp = h('input', { placeholder: 'Para onde você quer ir?', style: { width: '100%' } }), res = h('div');
  const items = [...[...S.dms.values()].map(d => ({ label: '@' + user(dmPeer(d).id).display_name, fn: () => go('@me', d.id) })),
    ...[...S.guilds.values()].flatMap(g => g.channels.filter(c => c.type !== 4).map(c => ({ label: chName(c), ic: c.type === 2 ? 'voice' : 'hash', alt: c.name, hint: g.name, fn: () => go(g.id, c.id) }))),
    ...[...S.guilds.values()].map(g => ({ label: g.name, hint: 'servidor', fn: () => go(g.id) }))];
  const m = modal('Busca rápida', '', h('div', h('label.f', inp), res), [], {});
  const draw = () => { res.replaceChildren(...items.filter(i => (i.label + ' ' + (i.alt || '')).toLowerCase().includes(inp.value.toLowerCase())).slice(0, 10).map(i => h('div.role-row', { onclick: () => { m.close(); i.fn(); } }, i.ic && icon(i.ic, 18), i.label, h('small', { style: { marginLeft: 'auto', color: 'var(--text-muted)' } }, i.hint || '')))); };
  inp.oninput = draw; draw();
  inp.onkeydown = (e) => { if (e.key === 'Enter') res.firstChild?.click(); };
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && ready) { e.preventDefault(); quickSwitch(); } });
// Ctrl+Shift+F: busca em tudo (DMs e servidores)
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && ready) { e.preventDefault(); if (!S.searchOpen) toggleGlobalSearch(); else $('#gs-q')?.focus(); } });

// =============== Perfil / menus de usuário ===============
let profileSeq = 0; // clicar em A e logo em B: o cartão de A chegando depois não cobre o de B
async function profile(anchor, uid, gid) {
  if (botOf(uid)) return openBot(anchor, uid);
  const seq = ++profileSeq, full = await tryApi('GET', `/users/${uid}`); if (!full) return;
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
async function openUserProfile(uid, gid, tab = 0) { // tab: 0 atividade, 1 amigos em comum, 2 servidores em comum
  const seq = ++profileSeq, u = await tryApi('GET', `/users/${uid}`); if (!u) return;
  if (seq !== profileSeq) { mergeUser(u); return; }
  mergeUser(u);
  const m = gid && gid !== '@me' ? member(gid, uid) : null, g = m && guild(gid);
  const roles = g && m ? g.roles.filter(r => m.roles.includes(r.id)) : [];
  const tp = u.theme_primary, ta = u.theme_accent, themed = !!(tp && ta), color = themed ? tp : u.banner_color || u.color || '#5865f2';
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
    [`${guilds.length} ${guilds.length === 1 ? 'servidor' : 'servidores'} em comum`, () => guilds.length ? guilds.map(x => row(x.icon ? h('img.upgi', { src: imgUrl(x.icon, 32), alt: '' }) : h('div.upgi', initials(x.name)), x.name, '', () => { close(); go(x.id); })) : [empty('Nenhum servidor em comum.')]]];
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
const pinnedDMs = () => (S.prefs.pinnedDMs ||= []);
const isPinnedDM = (uid) => pinnedDMs().includes(uid);
const dmWith = (uid) => [...S.dms.values()].find(d => dmPeer(d)?.id === uid);
async function ensureDM(uid) {
  const dm = dmWith(uid) || await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return null;
  S.dms.set(dm.id, dm); return dm;
}
// fixar: a conversa fica no topo das mensagens diretas
async function togglePinDM(uid) {
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
  if (await tryApi('POST', `/channels/${dm.id}/messages`, { content: `${location.origin}/invite/${r.code}` })) toast(`Convite para ${g.name} enviado a ${user(uid).display_name}`);
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
const initialsOf = (s) => (s || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
// mute: silencia a voz da pessoa só para você (nas chamadas)
const isLocalMuted = (uid) => !!S.prefs.mutedUsers?.[uid];
// ícone de microfone cortado: cinza se a própria pessoa se silenciou, vermelho se fui eu que a silenciei (mesmo ícone, só muda a cor)
const muteIco = (v) => { const lm = isLocalMuted(v.user_id); return (v.mute || lm) && h('span.mico' + (lm ? '.lmute' : ''), { title: lm ? 'Silenciado por você' : null }, icon('micoff', 14)); };
function toggleLocalMute(uid) {
  const m = (S.prefs.mutedUsers ||= {});
  if (m[uid]) delete m[uid]; else m[uid] = true;
  savePrefs(); voice?.applyVolume(uid); renderVoiceUI();
  toast(m[uid] ? `${user(uid).display_name} silenciado para você` : `${user(uid).display_name} não está mais silenciado`);
}

async function openDM(uid) {
  const dm = await tryApi('POST', '/dms', { user_id: uid }); if (!dm) return;
  S.dms.set(dm.id, dm); closeFloating(); go('@me', dm.id);
}
// quem está em voz numa sala que dá para entrar (e que não é a minha)
// menus da pessoa durante uma chamada (como no Discord)
function callUserMenu(e, uid, gid) {
  const g = gid && gid !== '@me' ? guild(gid) : null;
  if (uid === S.me.id) {
    const others = g ? g.channels.filter(c => c.type === 2 && c.id !== voice.channelId) : [];
    return menu(e, [
      { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
      '-',
      { label: 'Mute', checked: voice.muted, fn: () => voiceToggle('mute') },
      { label: 'Deafen', checked: voice.deafened, fn: () => voiceToggle('deaf') },
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
    // moderação continua disponível para quem tem permissão
    g && g.owner_id !== uid && (can(gid, PERM.MODERATE) || can(gid, PERM.BAN) || can(gid, PERM.KICK)) && '-',
    g && can(gid, PERM.MODERATE) && g.owner_id !== uid && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && g.owner_id !== uid && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && g.owner_id !== uid && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}
function userMenu(e, uid, gid) {
  if (botOf(uid)) return botMenu(e, uid);
  if (voice?.channelId) return callUserMenu(e, uid, gid);
  if (uid === S.me.id) return menu(e, [{ label: 'Perfil', fn: () => profile(e.target, uid, gid) }, S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) }]);
  const g = gid && gid !== '@me' ? guild(gid) : null, rt = relType(uid), muted = isLocalMuted(uid);
  menu(e, [
    { label: isPinnedDM(uid) ? 'Desafixar' : 'Fixar', fn: () => togglePinDM(uid) },
    { label: 'Perfil', fn: () => profile(e.target, uid, gid) },
    { label: 'Iniciar Ligação', fn: () => callUser(uid) },
    { label: 'Convidar para Servidor', fn: () => inviteToServer(uid) },
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
    g && can(gid, PERM.MANAGE_ROLES) && { label: 'Apelido…', fn: async () => { const n = await promptBox('Alterar apelido', 'Apelido', member(gid, uid)?.nickname || ''); if (n != null) tryApi('PATCH', `/guilds/${gid}/members/${uid}`, { nickname: n }); } },
    g && can(gid, PERM.MODERATE) && g.owner_id !== uid && (timedOutUntil(gid, uid) ? { label: 'Remover castigo', fn: () => removeTimeout(gid, uid) } : { label: 'Castigo…', danger: true, fn: () => timeoutDialog(gid, uid) }),
    g && can(gid, PERM.BAN) && g.owner_id !== uid && { label: 'Banir…', danger: true, fn: () => banDialog(gid, uid) },
    g && can(gid, PERM.KICK) && g.owner_id !== uid && { label: 'Expulsar', danger: true, fn: async () => { if (await confirmBox('Expulsar membro', `Expulsar ${user(uid).display_name}?`, 'Expulsar')) tryApi('DELETE', `/guilds/${gid}/members/${uid}`); } },
    '-', S.prefs.devMode && { label: 'Copiar ID do usuário', fn: () => navigator.clipboard?.writeText(uid) },
  ]);
}

// =============== Área principal ===============
const callActive = (cid) => voice?.channelId === cid || [...S.voice.values()].some(v => v.channel_id === cid);
function renderCallBar() { // mostra/oculta o palco de chamada nas DMs
  const ch = channelById(S.view.cid); if (!ch) return;
  if (ch.type === 1 && callActive(ch.id) !== !!$('#stage')) renderMain(); else renderVoiceUI();
}
const renderHomeIfHome = () => { if (S.view.kind === 'home') renderMain(); };
function renderMain() {
  const main = $('#main'); if (!main) return;
  const v = S.view;
  setTimeout(releaseOldScreens); // depois de trocar a tela: solta o que guardava a tela anterior
  if (v.kind === 'home') return renderHome(main);
  if (v.kind === 'clips') return renderClips(main, v.gid);
  if (v.kind === 'files') return renderFiles(main, v.dm ? { dm: v.dm } : { gid: v.gid });
  if (v.kind === 'lfg') return renderLfg(main);
  if (v.kind === 'discover') return renderDiscover(main);
  if (v.kind === 'messages') return main.replaceChildren(h('div#topbar.msgs-top', h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open') }, icon('more')), h('span.hash', icon('dm', 24)), h('span', 'Mensagens')), messagesHome());
  const ch = channelById(v.cid);
  if (!ch) return main.replaceChildren(h('div.empty', { style: { margin: 'auto' } }, h('h2', 'Sem canais'), h('p', 'Este servidor ainda não tem canais.')));
  const dm = ch.type === 1, vc = ch.type === 2, peer = dm && dmPeer(ch);
  const inCall = dm && callActive(ch.id), chatOpen = !vcChatHidden(ch);
  const top = h('div#topbar',
      h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open') }, icon('more')),
      dm ? [h('span.hash', '@'), h('span', user(peer.id).display_name), h('div.status.s-' + user(peer.id).status, { style: { position: 'static', borderColor: 'transparent', width: '10px', height: '10px', minWidth: 0, minHeight: 0 } })]
        : [h('span.hash', icon(vc ? 'voice' : 'hash', 24)), h('span', { title: ch.name }, chName(ch)), ch.topic && h('span.topic', ch.topic)],
      h('div.spacer'),
      // sala de voz: só o botão que mostra o chat; aberto, ele vira o X no topo do próprio chat
      vc && h('div#vc-layout-slot'),
      vc ? !chatOpen && h('button#vc-chat-btn.ibtn' + (S.unread[ch.id] ? '.unread' : ''), { title: 'Mostrar chat', onclick: () => toggleVcChat(ch) }, icon('dm')) : [
        dm && h('button#e2-btn.ibtn.e2-off', { title: 'Criptografia de ponta a ponta', 'aria-label': 'Criptografia de ponta a ponta', onclick: () => e2eeClick(ch) }, icon('lock')),
        dm && h('button.ibtn', { title: voice.channelId === ch.id ? 'Desligar' : 'Iniciar chamada de voz', onclick: () => voice.channelId === ch.id ? voice.leave() : joinVoice(ch.id) }, icon(voice.channelId === ch.id ? 'phoneoff' : 'callstart')),
        dm && h('button.ibtn' + (voice.channelId === ch.id && voice.cam ? '.sel' : ''), { title: voice.channelId === ch.id ? (voice.cam ? 'Desligar câmera' : 'Ligar câmera') : 'Iniciar chamada de vídeo', onclick: () => videoCall(ch.id) }, icon('video')),
        h('button.ibtn.notif-btn', { title: 'Notificações', onclick: (e) => notifMenu(e, ch) }, icon('topbell')),
        h('button.ibtn.pins-btn', { title: 'Mensagens fixadas', onclick: showPins }, icon('toppin')),
        h('button.ibtn.files-btn', { title: dm ? 'Mídia, arquivos e links desta conversa' : 'Mídia, arquivos e links deste canal', 'aria-label': 'Arquivos', onclick: () => { if (dm) location.hash = `#/@me/${ch.id}/files`; else { filesPreset({ channel: ch.id }); go(ch.guild_id, 'files'); } } }, icon('file')),
        !dm && h('button.ibtn' + (S.membersOpen ? '.sel' : ''), { title: 'Lista de membros', onclick: () => { S.membersOpen = !S.membersOpen; renderMain(); } }, icon('users')),
        dm && h('button.ibtn.dmp-btn' + (S.prefs.dmPanel !== false ? '.sel' : ''), { title: S.prefs.dmPanel !== false ? 'Esconder o perfil' : 'Mostrar o perfil', onclick: () => { S.prefs.dmPanel = S.prefs.dmPanel === false; savePrefs(); renderMain(); } }, icon('dmprofile'))]);
  // sala de voz: a barra do topo fica junto com o palco (mesmo fundo) e o chat ocupa a altura toda ao lado, como no Discord
  main.replaceChildren(...[!vc && top,
    h('div#content',
      vc && h('div#vcall', top, h('div#stage')),
      chatOpen && h('div#chat' + (vc ? '.side' : ''),
        vc && h('div.vchead', h('span.vcico', icon('dm', 20)), h('span.vctitle', { title: ch.name }, chName(ch)), h('button.ibtn', { title: 'Fechar chat', onclick: () => toggleVcChat(ch) }, icon('x'))),
        inCall && h('div#stage.dmstage'), dm && h('div#e2-bar.hidden'), h('div#msgs'), h('div#typing'), composer(ch, dm ? '@' + user(peer.id).display_name : (vc ? 'chat de ' : '#') + chName(ch))),
      !dm && !vc && S.membersOpen && h('div#members'),
      dm && S.prefs.dmPanel !== false && h('div#dmpanel'))].filter(Boolean));
  if (dm && S.prefs.dmPanel !== false) renderDmPanel(peer.id);
  if (dm) paintE2ee(ch);
  if (chatOpen) { stickToBottom($('#msgs')); loadChannel(ch.id); }
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
  draw(user(uid));
  const full = await api('GET', `/users/${uid}`).catch(() => null);
  if (full && $('#dmpanel') === box) { mergeUser(full); draw(full); }
}
// vídeo na DM: entra na chamada (se preciso) e liga a câmera
async function videoCall(cid) {
  if (voice.channelId === cid) return voiceAct(() => voice.toggleCam());
  voice.join(cid).then(() => { if (voice.error) { toast(voice.error, true); voice.error = null; return; } if (!voice.cam) voiceAct(() => voice.toggleCam()); });
}
// chat da sala de voz: aberto/fechado fica salvo; ao abrir marca como lido
const vcChatHidden = (ch) => ch?.type === 2 && S.prefs.vcChat === false;
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

// ---------- mensagens ----------
// Canal aberto depois de reconectar: pede as mais novas. Se o que estava na tela já era o fim do canal, a lista nova
// substitui (pega também edições e apagadas do meio-tempo); se a pessoa estava lendo mais acima, entram só as novas.
async function catchUp(cid) {
  const cur = S.messages.get(cid); if (!cur || detached.has(cid)) return; // lendo mensagens antigas: as novas vêm ao rolar até o fim
  const after = (a, b) => a.length !== b.length ? a.length > b.length : a > b; // ids são números grandes em texto
  const last = cur.at(-1)?.id;
  const fresh = await tryApi('GET', `/channels/${cid}/messages?limit=50`); if (!fresh || S.messages.get(cid) !== cur) return;
  fresh.forEach(m => mergeUser(m.author));
  const box = $('#msgs'), atEnd = !box || box.stick !== false, overlap = !last || fresh.some(m => m.id === last) || fresh.length < 50;
  if (!overlap) { S.messages.delete(cid); S.loaded.delete(cid); if (S.view.cid === cid) loadChannel(cid); return; } // mais de 50 novas: recomeça do fim
  if (atEnd || !fresh.length) cur.splice(0, cur.length, ...cur.filter(m => fresh.length && after(fresh[0].id, m.id)), ...fresh);
  else for (const m of fresh) if (after(m.id, last)) cur.push(m);
  if (S.view.cid === cid) renderMessages(true);
}
async function loadChannel(cid) {
  const box = $('#msgs');
  if (detached.delete(cid)) { S.messages.delete(cid); S.loaded.delete(cid); }
  if (!S.messages.has(cid)) {
    box.replaceChildren(skeleton('msgs', 9));
    const list = await tryApi('GET', `/channels/${cid}/messages?limit=50`); if (!list) return;
    list.forEach(m => mergeUser(m.author));
    S.messages.set(cid, list); S.loaded.set(cid, list.length < 50);
  }
  if (S.view.cid !== cid) return;
  renderMessages(false); ack(cid); renderTyping();
  const msgs = $('#msgs');
  msgs.onscroll = async () => {
    if (detached.has(cid) && !msgs.dataset.loading && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80) {
      msgs.dataset.loading = 1; const cur = S.messages.get(cid), newer = await tryApi('GET', `/channels/${cid}/messages?limit=50&after=${cur[cur.length - 1]?.id}`); delete msgs.dataset.loading;
      if (S.messages.get(cid) !== cur || S.view.cid !== cid || !msgs.isConnected) return; // trocou de canal ou a lista foi refeita no meio
      if (newer?.length) { newer.forEach(x => mergeUser(x.author)); cur.push(...newer); keepAnchor(msgs, () => { if (cur.length > HIST_MAX) { cur.splice(0, cur.length - HIST_KEEP); S.loaded.set(cid, false); } renderMessages(true); }); }
      if (newer && newer.length < 50) { detached.delete(cid); $('#detached-bar')?.remove(); }
      return;
    }
    if (msgs.scrollTop > 40 || S.loaded.get(cid) || msgs.dataset.loading) return;
    msgs.dataset.loading = 1;
    const list = S.messages.get(cid), older = await tryApi('GET', `/channels/${cid}/messages?limit=50&before=${list[0]?.id}`);
    delete msgs.dataset.loading; if (!older) return;
    if (S.messages.get(cid) !== list) return; // a lista foi refeita no meio (pulo para uma mensagem, início do canal)
    if (S.view.cid !== cid || !msgs.isConnected) { if (older.length < 50) S.loaded.set(cid, true); list.unshift(...older); return; } // guarda; desenha quando voltar
    if (older.length < 50) S.loaded.set(cid, true);
    list.unshift(...older); const prevH = msgs.scrollHeight;
    if (!prependMessages(cid, older)) renderMessages(false);
    msgs.scrollTop = msgs.scrollHeight - prevH;
    if (list.length > HIST_MAX) dropNewest(cid);
  };
}
function welcomeBlock(ch) {
  if (ch.type === 1) { const p = user(dmPeer(ch).id); return h('div.welcome', avatar(p, 80, { status: false }), h('h1', p.display_name), h('p', `Este é o início do seu histórico de mensagens diretas com ${p.display_name}.`)); }
  return h('div.welcome', h('div.big', icon('hash', 40)), h('h1', `Bem-vindo(a) a #${chName(ch)}!`), h('p', 'Este é o começo do canal.'));
}
function renderMessages(keepPos) {
  const box = $('#msgs'); if (!box) return;
  const ch = channelById(S.view.cid), list = S.messages.get(ch.id) || [];
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120, old = box.scrollTop;
  box.replaceChildren(...[h('div.grow'), S.loaded.get(ch.id) && welcomeBlock(ch)].filter(Boolean));
  let prev = null;
  for (const m of list) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) box.append(h('div.daysep', h('span', dayLabel(m.created_at))));
    box.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null)); prev = m;
  }
  if (S.pending.length) renderPending();
  box.stick = !(keepPos && !near);
  box.scrollTop = box.stick ? box.scrollHeight : old;
}
// Histórico mais antigo chegou (rolou até o topo): põe só as mensagens novas no começo. Antes o chat inteiro era montado de
// novo a cada página (50, 100, 150… mensagens), travando a rolagem num PC fraco (quadro de ~650 ms com 350 mensagens).
function prependMessages(cid, older) {
  const box = $('#msgs'), list = S.messages.get(cid); if (!box || S.view.cid !== cid || !older.length || !list) return false;
  const first = list[older.length], firstEl = first && box.querySelector(`:scope > [data-mid="${first.id}"]`); // a que estava no topo
  const grow = box.querySelector(':scope > .grow'); if (!firstEl || !grow) return false;
  const ch = channelById(cid), frag = document.createDocumentFragment(); let prev = null;
  if (S.loaded.get(cid) && !box.querySelector(':scope > .welcome')) frag.append(welcomeBlock(ch));
  for (const m of older) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) frag.append(h('div.daysep', h('span', dayLabel(m.created_at))));
    frag.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null)); prev = m;
  }
  // fronteira: a antiga primeira mensagem pode agrupar com a anterior, e o separador de dia dela pode sobrar
  const sep = firstEl.previousElementSibling?.classList.contains('daysep') ? firstEl.previousElementSibling : null;
  const same = sameDay(prev.created_at, first.created_at);
  if (sep && same) sep.remove();
  firstEl.replaceWith(msgEl(first, same ? prev : null));
  grow.after(frag);
  return true;
}
function appendMessage(m) {
  const box = $('#msgs'), list = S.messages.get(m.channel_id); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160 || m.author_id === S.me.id;
  const prev = list[list.length - 2];
  if (!prev || !sameDay(prev.created_at, m.created_at)) box.append(h('div.daysep', h('span', dayLabel(m.created_at))));
  const mel = msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null); mel.classList.add('fresh'); setTimeout(() => mel.classList.remove('fresh'), 700);
  box.append(mel);
  if (near) { box.stick = true; trimChat(m.channel_id); box.scrollTop = box.scrollHeight; }
}
// Canal aberto por horas: as mensagens que chegam iam se acumulando no chat e na memória para sempre (~900 por hora num
// canal movimentado). Com a pessoa no fim da conversa, passando de CHAT_MAX ficam as CHAT_KEEP mais novas; rolar até o topo
// busca as antigas de novo no servidor (o mesmo caminho do histórico).
const CHAT_MAX = 250, CHAT_KEEP = 150;
// Lendo o histórico para cima: o chat guarda no máximo HIST_MAX mensagens. Passando disso, as mais novas saem de baixo e o
// chat fica "vendo mensagens antigas" (rolar até o fim busca de novo; o botão volta ao presente). Descendo de volta, saem as
// de cima. Antes cada página de 50 se somava para sempre: lendo 2.000 mensagens para trás eram 2.000 no chat e cada
// redesenho passava por todas (scripts/history-window-test.mjs).
const HIST_MAX = 300, HIST_KEEP = 200;
function dropNewest(cid) {
  const list = S.messages.get(cid), box = $('#msgs'); if (!list || !box || list.length <= HIST_MAX) return;
  const cut = list.splice(HIST_KEEP);
  for (const m of cut) box.querySelector(`:scope > [data-mid="${m.id}"]`)?.remove();
  while (box.lastElementChild?.classList.contains('daysep')) box.lastElementChild.remove(); // separador de dia que ficou sem mensagem
  box.stick = false; detached.add(cid); detachedBar(cid, 'Você está vendo mensagens antigas');
}
// redesenho que tira coisas de cima: a mensagem que estava no topo da tela continua no mesmo lugar
function keepAnchor(box, fn) {
  const top = box.getBoundingClientRect().top, el = [...box.querySelectorAll(':scope > [data-mid]')].find(e => e.getBoundingClientRect().bottom > top);
  const id = el?.dataset.mid, off = el ? el.getBoundingClientRect().top - top : 0;
  fn();
  const again = id && box.querySelector(`:scope > [data-mid="${id}"]`); if (again) box.scrollTop += again.getBoundingClientRect().top - top - off;
}
function trimChat(cid) {
  const list = S.messages.get(cid), box = $('#msgs'); if (!list || list.length <= CHAT_MAX || !box || S.view.cid !== cid || detached.has(cid)) return;
  const cut = list.length - CHAT_KEEP, first = list[cut], firstEl = box.querySelector(`:scope > [data-mid="${first.id}"]`); if (!firstEl) return;
  list.splice(0, cut); S.loaded.set(cid, false);
  const grow = box.querySelector(':scope > .grow');
  while (grow && grow.nextSibling && grow.nextSibling !== firstEl) grow.nextSibling.remove(); // mensagens, separadores e o "começo do canal"
  grow.after(h('div.daysep', h('span', dayLabel(first.created_at)))); firstEl.replaceWith(msgEl(first, null)); // a nova primeira não agrupa com quem saiu
}
function applyUser(d, quiet) { // quiet: muitos de uma vez (PRESENCE_SYNC), quem chamou redesenha
  const old = S.users.get(d.id), presence = !!old && presenceOnly(old, d);
  S.users.set(d.id, d); if (d.id === S.me.id) S.me = d;
  for (const dm of S.dms.values()) dm.recipients = dm.recipients.map(r => r.id === d.id ? d : r);
  for (const r of S.rels.values()) if (r.user.id === d.id) r.user = d;
  // só status/aparelho mudou (o caso comum: alguém entrou ou saiu): as mensagens não mostram status, e a lista de canais
  // de um servidor só mostra quem está em sala. Antes cada entrada/saída redesenhava o chat e a lista lateral inteiros.
  if (quiet) return;
  const g = guild(S.view.gid);
  if (!presence || d.id === S.me.id || !g || S.voice.has(d.id)) renderSide();
  if (!g || g.members.has(d.id)) renderMembers();
  if (!presence) refreshAuthors(d.id);
  if (S.view.kind === 'home' && !deferRender(renderHomeIfHome)) renderMain();
}
const PRESENCE_KEYS = new Set(['status', 'platforms']);
function presenceOnly(a, b) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!PRESENCE_KEYS.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false; return true; }
function refreshAuthors(uid) { if ($('#msgs') && S.view.cid && S.messages.get(S.view.cid)?.some(m => m.author_id === uid)) renderMessages(true); }

const ctxFor = (gid) => ({ userName: (id) => (S.users.has(id) ? nameOf(id, gid) : null), emojiUrl });
function msgEl(m, prev) {
  const ch = channelById(m.channel_id), gid = ch?.guild_id, mine = m.author_id === S.me.id;
  const grouped = prev && prev.author_id === m.author_id && m.created_at - prev.created_at < 600000 && !m.reply && !S.prefs.compact && prev.type !== 1;
  const a = user(m.author_id), col = roleColor(gid, m.author_id);
  const mentioned = m.mentions?.includes(S.me.id) || (m.content || '').includes(`<@${S.me.id}>`);
  if (m.type === 1) return h('div.msg.system', { 'data-mid': m.id }, h('span.arrow', icon('arrowr', 18)), h('span', h('b', { style: { color: col || 'var(--header)' } }, nameOf(m.author_id, gid)), ' ' + m.content), h('span.ts', stamp(m.created_at)),
    h('button.btn.grey.wave', { onclick: () => tryApi('POST', `/channels/${m.channel_id}/messages`, { content: `👋 Bem-vindo(a), <@${m.author_id}>!` }) }, icon('smile', 18), 'Dar boas-vindas'));
  if (flaggedMap.has(m.id) && !m._show) return h('div.msg.flagged', { 'data-mid': m.id, oncontextmenu: (e) => msgMenu(e, m) }, icon('shield', 16),
    h('span', `Você marcou esta mensagem de ${nameOf(m.author_id, gid)} como ${flaggedMap.get(m.id) === 'spam' ? 'spam' : 'ofensiva'}. `),
    h('button.btn.link.sm', { onclick: () => { m._show = true; refreshMsg(m); } }, 'Mostrar'));
  const el = h('div.msg' + (grouped ? '.cont' : '.first') + (mentioned ? '.mentioned' : '') + (S.editing === m.id ? '.editing' : '') + (S.replyTo?.id === m.id ? '.qr-target' : ''), { 'data-mid': m.id, oncontextmenu: (e) => msgMenu(e, m), ondblclick: (e) => msgDblClick(e, m) });
  if (!grouped) el.append(h('div.av', { onclick: (e) => profile(e.currentTarget, m.author_id, gid) }, avatar(a, 40, { status: false })));
  else el.append(h('div.time-s', clock(m.created_at)));
  if (m.reply) el.append(h('div.reply-ref', { onclick: () => jumpTo(m.reply.id) },
    m.reply.deleted ? h('i', 'A mensagem original foi excluída') : [avatar(user(m.reply.author.id), 16, { status: false }), h('span.rn', '@' + nameOf(m.reply.author.id, gid)), h('span.rt', plainTs(inviteText(themeText(m.reply.content))) || 'Clique para ver o anexo')]));
  if (!grouped) el.append(h('div.head', styleName(h('span.author', { style: col ? { color: col } : null, onclick: (e) => profile(e.currentTarget, m.author_id, gid), oncontextmenu: (e) => { e.stopPropagation(); userMenu(e, m.author_id, gid); } }, nameOf(m.author_id, gid)), a.name_style), h('span.ts', stamp(m.created_at)), m.pinned && h('span.pin', icon('pin', 12)), m.e2ee === true && h('span.e2-ic', { title: 'Protegida de ponta a ponta' }, icon('lock', 12))));
  const spoilFrom = el.childNodes.length; // daqui para baixo (texto, cartões, anexos) é o que o spoiler cobre
  if (S.editing === m.id) {
    const ta = h('textarea', { value: m.content, rows: 1, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m, ta.value); } if (e.key === 'Escape') { S.editing = null; renderMessages(true); } } });
    el.append(h('div.edit-box', ta, h('div.edit-hint', 'esc para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.editing = null; renderMessages(true); } }, 'cancelar'), ' • enter para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); saveEdit(m, ta.value); } }, 'salvar'))));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  } else if (typeof m.e2ee === 'string') { // protegida e não abriu aqui (trancada neste aparelho, chave apagada ou adulterada)
    el.append(h('div.body.e2-locked', h('span', m.content), m.e2ee === 'locked' && h('button.btn.link.sm', { onclick: () => unlockModal() }, 'Desbloquear')));
  } else if (m.content) {
    const body = h('div.body'), shared = THEME_CODE_RE.test(m.content) && decodeTheme(m.content), invites = inviteCodes(m.content), calls = callCodes(m.content);
    let shown = shared ? stripThemeCodes(m.content) : m.content; // o código do tema não aparece, só o bloco
    if (invites.length || calls.length) shown = stripInvites(shown); // o link do convite também vira só o cartão
    const clipIds = m.clip ? [] : clipLinkIds(shown); if (clipIds.length) shown = stripClipLinks(shown); // link de clipe: só o cartão
    if (m.poll) shown = ''; // enquete: o cartão mostra a pergunta
    if (m.clip) shown = ''; // clipe: o cartão mostra o título
    const gifOnly = !m.poll && !shared && isGifMessage(shown); if (gifOnly) shown = ''; // só um GIF: mostra a imagem, sem o link
    if (shown) body.innerHTML = md(shown, ctxFor(gid));
    if (shown && onlyEmoji(shown.replace(/<:\w+:\d+>/g, '😀'))) body.classList.add('emoji-big');
    if (m.edited_at) body.append(h('span.edited', '(editado)'));
    if (shared) body.append(themeCard(shared));
    for (const code of invites) body.append(inviteCard(code));
    for (const id of calls) body.append(callCard(id));
    for (const id of clipIds) body.append(clipEmbed(id));
    if (m.poll) body.append(pollCard(m));
    if (gifOnly && S.prefs.embedLinks !== false) body.append(gifEl(m.content.trim(), (u) => lightbox(u))); else if (gifOnly) body.append(h('a', { href: m.content.trim(), target: '_blank', rel: 'noopener' }, m.content.trim()));
    if (S.prefs.embedLinks !== false) for (const url of (shown.match(/https?:\/\/\S+/g) || []).filter(isImageUrl).slice(0, 3)) body.append(h('div.attach', h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', onclick: () => lightbox(url) })));
    if (S.prefs.embedLinks !== false) for (const card of [...new Set((shown.match(/https?:\/\/[^\s<>)]+/g) || []))].slice(0, 6).map(socialCard).filter(Boolean).slice(0, 3)) body.append(card); // YouTube/Shorts/TikTok/Reels (media.js)
    body.querySelectorAll('.spoiler').forEach(s => (s.onclick = () => s.classList.add('shown')));
    body.querySelectorAll('.mention[data-uid]').forEach(s => { s.onclick = () => profile(s, s.dataset.uid, gid); const u = S.users.get(s.dataset.uid); if (u) s.prepend(mentionAvatar(u)); });
    el.append(body);
    const tr = translationBlock(m, (t) => { const d = h('div.body'); d.innerHTML = md(t, ctxFor(gid)); return d; });
    if (tr) el.append(tr);
  }
  appendAttachments(el, m, mine || (gid && can(gid, PERM.MANAGE_MESSAGES)));
  if (S.editing !== m.id && spoiled(m) && !spoilShown.has(m.id)) coverSpoiler(el, spoilFrom, m);
  if (m.reactions?.length) el.append(h('div.reactions', m.reactions.map(r => h('div.react' + (r.users.includes(S.me.id) ? '.me' : ''), { title: r.users.map(u => nameOf(u, gid)).join(', '), onclick: () => react(m, r.emoji, !r.users.includes(S.me.id)) }, reactionFace(r.emoji), h('span', r.users.length)))));
  el.append(h('div.toolbar',
    h('button', { title: 'Reagir', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em, true)) }, icon('smile', 18)),
    h('button', { title: 'Responder', onclick: () => setReply(m) }, icon('reply', 18)),
    mine && !m.poll && typeof m.e2ee !== 'string' && h('button', { title: 'Editar', onclick: () => { S.editing = m.id; renderMessages(true); } }, icon('edit', 18)),
    (mine || (gid && can(gid, PERM.MANAGE_MESSAGES))) && h('button.tdel', { title: 'Excluir (Shift: sem confirmar)', onclick: (e) => deleteMenu(e, m) }, icon('trash', 18)),
    h('button', { title: 'Mais', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); msgMenu({ preventDefault() { }, clientX: r.left, clientY: r.bottom }, m); } }, icon('more', 18))));
  return el;
}
// lixeira da barra da mensagem: apaga a mensagem; com áudio/arquivo junto de outro conteúdo, pergunta o que remover
const removeAtt = (m, i) => tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
const deleteMsg = async (m, quick) => { if (quick || await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); };
function deleteMenu(e, m) {
  const files = (m.attachments || []).map((f, i) => ({ f, i })).filter(a => !isImg(a.f));
  const alone = !m.content && (m.attachments || []).length <= 1; // só um áudio/arquivo: apagar a mensagem é o mesmo que remover o anexo
  if (!files.length || alone) return deleteMsg(m, e.shiftKey);
  const r = e.currentTarget.getBoundingClientRect(), what = (f) => (f.voice ? 'a mensagem de voz' : `"${f.name}"`);
  menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [
    ...files.map(({ f, i }) => ({ label: 'Remover ' + what(f), danger: true, fn: async () => { if (e.shiftKey || await confirmBox('Remover anexo', `Remover ${what(f)} desta mensagem?`, 'Remover')) removeAtt(m, i); } })),
    '-', { label: 'Apagar mensagem inteira', danger: true, fn: () => deleteMsg(m, e.shiftKey) },
  ]);
}

// cartão de convite de servidor no chat (no lugar do link)
const inviteInfo = new Map();
const fetchInvite = (code) => { if (!inviteInfo.has(code)) inviteInfo.set(code, api('GET', `/invites/${encodeURIComponent(code)}?peek=1`).then(r => (r?.gone ? null : r)).catch(() => null)); return inviteInfo.get(code); };
function inviteCard(code) {
  const card = h('div.invcard.loading', h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon'), h('div.ivinfo', h('b', 'Carregando…'))));
  fetchInvite(code).then(info => {
    if (!info) {
      card.className = 'invcard bad';
      return card.replaceChildren(h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon', icon('x', 28)), h('div.ivinfo', h('b', 'Convite inválido'), h('small', 'Pode ter expirado ou sido apagado.'))));
    }
    const g = info.guild, inside = () => S.guilds.has(g.id);
    const btn = h('button.btn');
    const paint = () => { btn.textContent = inside() ? 'Ir para o servidor' : 'Entrar'; btn.className = 'btn ' + (inside() ? 'grey' : 'green'); };
    btn.onclick = async () => {
      if (inside()) return go(g.id);
      btn.disabled = true; btn.textContent = 'Entrando…';
      if (await joinInvite(code) === false) { btn.disabled = false; paint(); return; }
      inviteInfo.delete(code); document.querySelectorAll(`.invcard[data-code="${code}"]`).forEach(c => c.replaceWith(inviteCard(code)));
    };
    paint();
    const top = h('div.ivbanner'), ic = g.icon ? h('img.ivicon', { src: imgUrl(g.icon, 80), alt: '' }) : h('div.ivicon', initialsOf(g.name));
    if (g.banner) top.style.backgroundImage = `url("${imgUrl(g.banner, 480).replace(/"/g, '%22')}")`;
    else top.style.background = `linear-gradient(120deg, ${g.accent || '#5865f2'}, color-mix(in srgb, ${g.accent || '#5865f2'} 40%, #000))`;
    card.className = 'invcard'; card.dataset.code = code;
    card.replaceChildren(top, h('div.ivh', inside() ? 'Você já está neste servidor' : 'Você foi convidado para entrar em um servidor'),
      h('div.ivbody', ic, h('div.ivinfo', h('b', { title: g.name }, g.name),
        h('div.ivstats', h('span', h('i.on'), `${info.online} online`), h('span', h('i'), `${info.members} ${info.members === 1 ? 'membro' : 'membros'}`)),
        info.friends?.length > 0 && h('div.ivfriends', { title: info.friends.map(u => u.display_name).join(', ') }, avStack(info.friends, 18), h('span', `${friendNames(info.friends)} ${info.friends.length === 1 ? 'está' : 'estão'} aqui`))), btn));
  });
  return card;
}

// bloco de tema compartilhado no chat
function themeCard(t) {
  const inUse = () => { const cur = themeDef(S.prefs.theme, S.prefs.customThemes || []); return !!cur && cur.base === t.base && cur.colors.join() === t.colors.join() && (cur.angle ?? 180) === t.angle; };
  const btn = h('button.btn', { onclick: () => { saveCustomTheme(t); toast(`Tema "${t.name}" aplicado e salvo em Aparência`); document.querySelectorAll('.themeshare').forEach(c => c.dispatchEvent(new Event('repaint'))); } });
  const paint = () => { const on = inUse(); btn.textContent = on ? 'Em uso' : 'Usar tema'; btn.disabled = on; btn.classList.toggle('grey', on); };
  const card = h('div.themeshare', { onrepaint: paint }, h('i.sw', { style: { background: gradientCss(t) } }),
    h('div', h('b', t.name), h('small', `Tema ${t.base === 'light' ? 'claro' : 'escuro'} em gradiente`), h('div.tsdots', t.colors.map(c => h('i', { style: { background: c } })))), btn);
  paint(); return card;
}
// "+" do campo de mensagem: enviar arquivo ou compartilhar um tema (vai só o bloco do tema)
function shareThemePicker(ch) {
  const mine = S.prefs.customThemes || [], presets = Object.values(GRADIENT_THEMES);
  const cur = themeDef(S.prefs.theme, mine);
  const send = (t) => {
    dlg.close();
    tryApi('POST', `/channels/${ch.id}/messages`, { content: encodeTheme({ ...t, angle: t.angle ?? 180, intensity: t.intensity ?? 50 }), reply_to: S.replyTo?.id });
    S.replyTo = null; renderReplyBar();
  };
  const tile = (t) => h('button.tpick' + (t === cur ? '.cur' : ''), { title: `Enviar "${t.name}"`, onclick: () => send(t) }, h('i', { style: { background: gradientCss(t) } }), h('span', t.name), t === cur && h('small', 'em uso'));
  const body = h('div.tpicker',
    h('h5', 'Seus temas'), mine.length ? h('div.tpgrid', mine.map(tile)) : h('p.tpempty', 'Você ainda não criou temas. Crie em Configurações → Aparência → Criar tema.'),
    h('h5', 'Temas prontos'), h('div.tpgrid', presets.filter(t => !t.group).map(tile)),
    h('h5', 'Agentes do Valorant'), h('div.tpgrid', presets.filter(t => t.group === 'valorant').map(tile)));
  const dlg = modal('Compartilhar tema', 'Quem receber vê o bloco do tema e pode usá-lo com um clique.', body, [{ label: 'Cancelar', cls: 'link' }], { width: '540px' });
}
function plusMenu(e, ch, fileIn) {
  const r = e.currentTarget.getBoundingClientRect();
  menu({ preventDefault() { }, clientX: r.left, clientY: r.top - 157 }, [
    { label: 'Enviar arquivo', fn: () => fileIn.click() },
    { label: 'Criar enquete', fn: () => pollModal(ch) },
    { label: 'Inserir horário', fn: () => { const ta = $('#composer textarea'); if (ta) timestampModal(ta); } },
    { label: 'Compartilhar tema', fn: () => shareThemePicker(ch) },
  ]);
}

function reactionFace(e) {
  const m = e.match(/^<:(\w+):(\d+)>$/);
  if (m) { const u = emojiUrl(m[2]); return u ? h('img.cemoji', { src: u, alt: ':' + m[1] + ':', style: { height: '16px' } }) : h('span', ':' + m[1] + ':'); }
  return h('span', e);
}
const isImg = (f) => /^(png|jpe?g|gif|webp|avif|bmp)$/.test((f.name.split('.').pop() || '').toLowerCase());
// imagens da mesma mensagem viram uma grade; cada anexo tem uma lixeira ao passar o mouse
function appendAttachments(el, m, canDel) {
  // anexos protegidos de ponta a ponta: baixa e abre no aparelho quando a mensagem aparece (imagens, áudio, voz e vídeos
  // até 50 MB); os maiores e os outros arquivos abrem no clique. Sem a chave (trancado neste aparelho) só o aviso.
  if (m.attachments?.some(f => f.enc || f.e2ee)) {
    const auto = (f) => f.e2ee && !f.expired && f.size <= 50 * 1048576 && (f.voice || /^(image|audio|video)\//.test(f.type));
    const waiting = m.attachments.filter(f => auto(f) && !openedFileUrl(f));
    if (waiting.length) {
      const ph = h('div.e2-files', icon('lock', 16), h('span', 'Abrindo arquivo protegido…')); el.append(ph);
      const io = new IntersectionObserver((es) => { if (!es.some(e => e.isIntersecting)) return; io.disconnect();
        Promise.all(waiting.map(openFile)).then(() => { const tmp = h('div'); appendAttachments(tmp, m, canDel); ph.replaceWith(...tmp.childNodes); },
          () => ph.replaceChildren(icon('lock', 16), h('span', 'Não foi possível abrir o arquivo protegido'))); }, { rootMargin: '400px' });
      io.observe(ph); return;
    }
    m = { ...m, attachments: m.attachments.map(f => (f.e2ee && openedFileUrl(f) ? { ...f, url: openedFileUrl(f) } : f)) };
  }
  const atts = (m.attachments || []).map((f, i) => ({ f, i }));
  const del = (f, i) => canDel && h('button.adel', { title: 'Remover anexo (Shift: sem confirmar)', onclick: async (e) => {
    e.stopPropagation();
    if (e.shiftKey || await confirmBox('Remover anexo', `Remover "${f.name}" desta mensagem?`, 'Remover')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
  } }, icon('trash', 16));
  const imgs = atts.filter(a => isImg(a.f) && !a.f.expired);
  if (imgs.length) el.append(h('div.mgrid.n' + Math.min(imgs.length, 5), imgs.map(({ f, i }) =>
    h('div.mtile', h('img', { src: imgUrl(f.url, imgs.length === 1 ? 960 : 480), alt: f.name, title: f.size ? `${f.name} • ${bytes(f.size)}` : f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(f.url) }), del(f, i)))));
  if (m.clip) el.append(clipMsgCard(m)); // clipe: cartão leve no lugar do player (o vídeo fica na galeria)
  for (const { f } of atts.filter(a => (!isImg(a.f) || a.f.expired) && !(m.clip && a.f.url === m.clip.url))) { const a = attachEl(f); a.classList.add('mtile'); el.append(a); } // áudio/arquivo: excluir fica na barra da mensagem
}
// cartão do clipe no chat: miniatura pequena + título; o vídeo só carrega ao clicar em assistir
function clipMsgCard(m, full) {
  const c = m.clip, ch = channelById(m.channel_id), gid = full ? (full.guild_id && S.guilds.has(full.guild_id) ? full.guild_id : null) : ch?.guild_id;
  const who = c.streamer_id ? nameOf(c.streamer_id, gid) || user(c.streamer_id).display_name : null;
  const thumb = h('div.cmthumb', { title: 'Assistir aqui', onclick: () => { thumb.replaceWith(fsVideo({ src: c.url, autoplay: true, preload: 'auto', poster: thumbUrl(c.url) || undefined }, '.cmvideo')); } },
    thumbUrl(c.url) && h('img', { src: thumbUrl(c.url), loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }), h('span.cmplay', icon('play', 22)), c.secs ? h('span.cmdur', c.secs + 's') : null);
  return h('div.clipmsg', thumb, h('div.cminfo', h('b', c.title), h('small', [who && `transmissão de ${who}`, !c.has_audio && 'sem áudio'].filter(Boolean).join(' · ') || 'clipe'),
    gid && h('button.btn.link.sm', { onclick: () => { galleryFocus(c.id); go(gid, 'clips'); } }, icon('clip', 14), 'Ver na galeria')));
}
// cartão de um clipe compartilhado por link: busca o clipe pelo id (nome e vídeo sempre atuais, mesmo depois de renomear)
const clipCache = new Map(); // id -> Promise<clipe | null>
const fetchClip = (id) => { if (!clipCache.has(id)) clipCache.set(id, api('GET', `/clips/${encodeURIComponent(id)}`).catch(() => null)); return clipCache.get(id); };
function clipEmbed(id) {
  const box = h('div.clipmsg.clipembed.loading', { 'data-clip': id }, h('div.cmthumb'), h('div.cminfo', h('b', 'Carregando clipe…')));
  fetchClip(id).then(c => paintClipEmbed(box, c));
  return box;
}
function paintClipEmbed(box, c) {
  box.classList.remove('loading');
  if (!c) return box.replaceChildren(h('div.cmthumb.cmgone', icon('clip', 22)), h('div.cminfo', h('b', 'Clipe indisponível'), h('small', 'Foi apagado ou você não tem acesso.')));
  const fake = { clip: { id: c.id, title: c.title, secs: c.secs, url: c.url, has_audio: c.has_audio, streamer_id: c.streamer?.id || null }, channel_id: c.channel_id };
  const card = clipMsgCard(fake, c);
  box.replaceChildren(...card.childNodes);
}
function updateClipEmbeds(t, d) {
  const id = String(d.id); clipCache.set(id, Promise.resolve(t === 'CLIP_DELETE' ? null : d));
  document.querySelectorAll(`.clipembed[data-clip="${CSS.escape(id)}"]`).forEach(b => paintClipEmbed(b, t === 'CLIP_DELETE' ? null : d));
}
// compartilhar um clipe: manda o link numa conversa ou canal (com um comentário opcional); quem recebe vê o cartão e assiste,
// mesmo sem estar no servidor do clipe
function shareClipModal(c) {
  const q = h('input', { type: 'search', placeholder: 'Buscar conversa ou canal', 'aria-label': 'Buscar conversa ou canal' });
  const note = h('input', { placeholder: 'Comentário (opcional)', maxLength: 300, 'aria-label': 'Comentário' });
  const list = h('div.share-list');
  const dms = [...S.dms.values()].filter(d => dmPeer(d)).sort((a, b) => lastTime(b) - lastTime(a)).map(d => ({ id: d.id, label: user(dmPeer(d).id).display_name, sub: 'Mensagem direta', av: avatar(user(dmPeer(d).id), 32) }));
  const chans = [...S.guilds.values()].flatMap(g => g.channels.filter(ch => ch.type === 0).map(ch => ({ id: ch.id, label: '#' + chName(ch), sub: g.name, av: h('span.share-ic', icon('hash', 18)) })));
  const sent = new Set();
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const rows = [...dms, ...chans].filter(r => !t || (r.label + ' ' + r.sub).toLowerCase().includes(t)).slice(0, 50);
    list.replaceChildren(...rows.map(r => h('div.share-row', r.av, h('div.share-txt', h('b', r.label), h('small', r.sub)),
      h('button.btn' + (sent.has(r.id) ? '.grey' : ''), { type: 'button', disabled: sent.has(r.id), onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        const content = (note.value.trim() ? note.value.trim() + '\n' : '') + clipLink(c.id);
        const ok = await tryApi('POST', `/channels/${r.id}/messages`, { content });
        if (ok) { sent.add(r.id); btn.replaceChildren(icon('clipcheck', 14), 'Enviado'); btn.classList.add('grey', 'sent'); } else btn.disabled = false;
      } }, ...(sent.has(r.id) ? [icon('clipcheck', 14), 'Enviado'] : ['Enviar'])))), !rows.length && h('div.dm-empty', 'Nada encontrado'));
  };
  q.oninput = draw;
  const copy = h('button.btn.grey', { type: 'button', onclick: () => { navigator.clipboard?.writeText(clipLink(c.id)); toast('Link do clipe copiado'); } }, icon('link', 16), 'Copiar link');
  modal('Compartilhar clipe', `"${c.title}" — quem receber pode assistir pelo link.`, h('div.share-box', h('div.share-top', h('label.f', q), copy), list, h('label.f', note)), [{ label: 'Concluir', cls: 'green' }], { width: '480px' });
  draw(); setTimeout(() => q.focus());
}
function attachEl(f) {
  if (f.enc && !f.e2ee && !f.expired) return h('div.file.e2-file', icon('lock', 32), h('div', h('div.fn', 'Arquivo protegido'), h('div.fs', 'Desbloqueie a criptografia neste aparelho para abrir'))); // trancado aqui
  if (f.e2ee && !f.expired && !f.url.startsWith('blob:')) { // protegido, grande ou não é mídia: abre no clique
    const go = async (b, play) => { b.disabled = true; try { const u = await openFile(f); if (play) box.replaceWith(attachEl({ ...f, url: u })); else { const a = h('a', { href: u, download: f.name }); a.click(); } } catch (e) { toast(e.message, true); } b.disabled = false; };
    const isMedia = /^(video|audio)\//.test(f.type);
    const box = h('div.file.e2-file', icon('lock', 32), h('div', h('div.fn', f.name), h('div.fs', bytes(f.size) + ' · protegido')),
      isMedia && h('button.btn.sm', { style: { marginLeft: 'auto' }, onclick: (e) => go(e.currentTarget, true) }, 'Abrir'),
      h('button.ibtn', { title: 'Baixar', style: { marginLeft: isMedia ? '4px' : 'auto' }, onclick: (e) => go(e.currentTarget, false) }, icon('dl')));
    return box;
  }
  const ext = (f.name.split('.').pop() || '').toLowerCase(), url = f.url, dl = url.startsWith('blob:') ? url : url + '?download=1';
  // apagado para liberar espaço (Configurações → Armazenamento / expiração do servidor): a conversa continua fazendo sentido
  if (f.expired) return h('div.file.expired', { title: 'Apagado em ' + new Date(f.expired).toLocaleDateString('pt-BR') }, icon('file', 32), h('div', h('div.fn', f.name), h('div.fs', 'Arquivo expirado' + (f.size ? ' • ' + bytes(f.size) : ''))));
  if (f.voice) return voiceEl(f);
  if (isImg(f)) return h('div.attach', h('img', { src: url, alt: f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(url) }));
  // o vídeo só baixa no play (antes cada vídeo do chat começava a baixar ao abrir o canal); a miniatura vem do servidor
  if (/^(mp4|webm|mov|m4v)$/.test(ext)) { const poster = thumbUrl(url), box = fsVideo({ src: url, preload: 'none', ...(poster ? { poster } : {}) }); prepVideo(box, poster); return h('div.attach', box); }
  if (/^(mp3|ogg|wav|m4a)$/.test(ext)) return h('div.attach', h('audio', { src: url, controls: true, preload: 'none' }));
  return h('div.file', icon('file', 32), h('div', h('a.fn', { href: dl, download: f.name }, f.name), h('div.fs', bytes(f.size))), h('a.ibtn', { href: dl, download: f.name, style: { marginLeft: 'auto' } }, icon('dl')));
}
function msgMenu(e, m) {
  const ch = channelById(m.channel_id), gid = ch.guild_id, mine = m.author_id === S.me.id, mod = gid && can(gid, PERM.MANAGE_MESSAGES) || (!gid && false);
  menu(e, [
    { label: 'Adicionar reação', fn: () => emojiPicker(document.querySelector(`[data-mid="${m.id}"]`) || document.body, (em) => react(m, em, true)) },
    { label: 'Responder', fn: () => setReply(m) },
    !mine && { label: 'Mencionar', fn: () => mentionUser(m.author_id) },
    m.content && { label: 'Copiar texto', fn: () => navigator.clipboard?.writeText(m.content) },
    isGifMessage(m.content) && { label: isGifFav(m.content.trim()) ? 'Tirar GIF dos favoritos' : 'Favoritar GIF', fn: () => toggleGifFav({ url: m.content.trim(), preview: m.content.trim() }).then(() => renderMessages(true)) },
    m.content && !m.e2ee && { label: isTranslated(m) ? 'Mostrar original' : 'Traduzir', fn: () => toggleTranslation(m, refreshMsg) }, // protegida: traduzir mandaria o texto para fora
    mine && !m.poll && { label: 'Editar mensagem', fn: () => { S.editing = m.id; renderMessages(true); } },
    (mod || !gid) && { label: m.pinned ? 'Desafixar mensagem' : 'Fixar mensagem', fn: () => tryApi(m.pinned ? 'DELETE' : 'PUT', `/channels/${m.channel_id}/pins/${m.id}`) },
    ...(m.type === 1 ? [] : spoilerItems(m, mine, mod)),
    S.prefs.devMode && { label: 'Copiar ID da mensagem', fn: () => navigator.clipboard?.writeText(m.id) },
    // reputação: sinal da comunidade (esconde para mim; várias pessoas em pouco tempo limitam o envio do autor)
    gid && !mine && m.type !== 1 && '-',
    ...(!gid || mine || m.type === 1 ? [] : flaggedMap.has(m.id) ? [{ label: 'Desfazer marcação', fn: () => unflagMessage(m, () => { delete m._show; refreshMsg(m); }) }]
      : [{ label: 'Marcar como spam', fn: () => flagMessage(m, 'spam', () => refreshMsg(m)) }, { label: 'Denunciar como ofensiva', danger: true, fn: () => flagMessage(m, 'toxic', () => refreshMsg(m)) }]),
    (mine || mod) && '-',
    (mine || mod) && { label: 'Apagar mensagem', danger: true, fn: async () => { if (await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); } },
  ]);
}
// ---------- spoiler em mensagens (inclusive de outras pessoas) ----------
// para todos: o autor ou um moderador marca (servidor guarda; m.spoiler). Só para mim: fica nas preferências da conta
// (vale em todos os aparelhos), útil numa conversa direta ou quando não sou moderador.
const mySpoilers = () => (S.prefs.mySpoilers ||= {});
const spoiled = (m) => !!(m.spoiler || mySpoilers()[m.id]);
const spoilShown = new Set(); // revelados nesta sessão (clicou para ver)
function setMySpoiler(m, on) {
  const all = mySpoilers();
  if (on) { all[m.id] = Date.now(); const ks = Object.keys(all); if (ks.length > 500) ks.sort((a, b) => all[a] - all[b]).slice(0, ks.length - 500).forEach(k => delete all[k]); } // guarda as 500 mais recentes
  else delete all[m.id];
  spoilShown.delete(m.id); savePrefs(); refreshMsg(m);
}
function coverSpoiler(el, from, m) {
  const parts = [...el.childNodes].slice(from); if (!parts.length) return;
  const who = m.spoiler ? (m.spoiler_by_mod ? 'Marcado como spoiler por um moderador' : 'Spoiler') : 'Você marcou como spoiler';
  const box = h('div.mspoil', { role: 'button', tabIndex: 0, title: 'Clique para ver', onclick: () => { spoilShown.add(m.id); refreshMsg(m); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
    h('div.mspoil-in', { 'aria-hidden': 'true', inert: '' }, ...parts), h('span.mspoil-tag', icon('eye', 16), h('b', 'SPOILER'), h('small', who)));
  el.append(box);
}
function spoilerItems(m, mine, mod) {
  const forAll = mine || mod, ours = !!mySpoilers()[m.id];
  return [
    forAll && (m.spoiler ? { label: 'Tirar spoiler para todos', fn: () => tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/spoiler`) }
      : { label: 'Marcar como spoiler para todos', hint: mine ? 'Esconde o texto e os anexos até clicarem' : 'Como moderador: esconde para todo o servidor, sem apagar', fn: () => tryApi('PUT', `/channels/${m.channel_id}/messages/${m.id}/spoiler`) }),
    !m.spoiler && !mine && (ours ? { label: 'Tirar spoiler (só para mim)', fn: () => setMySpoiler(m, false) }
      : { label: 'Marcar como spoiler só para mim', hint: 'Ninguém mais vê a diferença', fn: () => setMySpoiler(m, true) }),
    spoiled(m) && spoilShown.has(m.id) && { label: 'Esconder de novo', fn: () => { spoilShown.delete(m.id); refreshMsg(m); } },
  ];
}
// redesenha uma única mensagem (por ex. depois de traduzir)
function refreshMsg(m) {
  const list = S.messages.get(m.channel_id), i = list?.findIndex(x => x.id === m.id), el = document.querySelector(`[data-mid="${m.id}"]`);
  if (i >= 0 && el) el.replaceWith(msgEl(m, list[i - 1] && sameDay(list[i - 1].created_at, m.created_at) ? list[i - 1] : null));
}
const react = (m, emoji, add) => tryApi(add ? 'PUT' : 'DELETE', `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
async function saveEdit(m, text) {
  if (!text.trim()) return;
  if (S.prefs.cleanLinks !== false) text = cleanLinks(text);
  S.editing = null; if (text !== m.content) await tryApi('PATCH', `/channels/${m.channel_id}/messages/${m.id}`, { content: text });
  renderMessages(true);
}
function setReply(m) { S.replyTo = m; renderReplyBar(); $('#composer textarea')?.focus(); }
// Ctrl+↑ / Ctrl+↓ no campo: escolhe a mensagem a responder sem tirar a mão do teclado (passar da última cancela)
function quickReply(ch, dir) {
  const list = (S.messages.get(ch.id) || []).filter(m => m.type !== 1 && !String(m.id).startsWith('tmp-') && m.channel_id === ch.id);
  if (!list.length) return;
  const cur = S.replyTo ? list.findIndex(x => x.id === S.replyTo.id) : -1;
  const n = (cur < 0 ? list.length : cur) + dir;
  document.querySelectorAll('#msgs .msg.qr-target').forEach(x => x.classList.remove('qr-target'));
  if (n >= list.length) { S.replyTo = null; renderReplyBar(); return; }
  const m = list[Math.max(0, n)]; setReply(m);
  const el = document.querySelector(`#msgs [data-mid="${m.id}"]`);
  if (el) { el.classList.add('qr-target'); el.scrollIntoView({ block: 'nearest' }); }
}
// duplo clique numa mensagem: a sua abre a edição, a dos outros vira resposta (links, mídia, botões e reações ficam de fora)
function msgDblClick(e, m) {
  if (S.prefs.dblClickMsg === false || String(m.id).startsWith('tmp-') || typeof m.e2ee === 'string') return;
  if (e.target.closest('a, button, img, video, audio, canvas, textarea, input, select, .reactions, .react, .spoiler, .fsvid, .mention, .author, .av, .reply-ref, .md-pre, .md-code, .edit-box, [contenteditable]')) return;
  if (S.editing === m.id) return;
  getSelection()?.removeAllRanges(); // o duplo clique selecionava uma palavra
  if (m.author_id === S.me.id && m.content) { S.editing = m.id; renderMessages(true); }
  else if ($('#composer textarea')) setReply(m);
}
async function jumpTo(mid) {
  let el = document.querySelector(`[data-mid="${mid}"]`);
  if (!el) {
    const cid = S.view.cid; // a resposta pode chegar depois de trocar de canal: não guarda as mensagens no canal errado
    const list = await tryApi('GET', `/channels/${cid}/messages?around=${mid}`); if (!list || S.view.cid !== cid) return;
    list.forEach(m => mergeUser(m.author));
    S.messages.set(cid, list); S.loaded.set(cid, false); renderMessages(false); el = document.querySelector(`[data-mid="${mid}"]`);
  }
  if (el) { $('#msgs').stick = false; el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2000); }
}
async function jumpToTop() {
  const cid = S.view.cid; if (!cid) return;
  const list = await tryApi('GET', `/channels/${cid}/messages?oldest=1&limit=50`); if (!list || S.view.cid !== cid) return;
  list.forEach(m => mergeUser(m.author));
  S.messages.set(cid, list); S.loaded.set(cid, true); $('#detached-bar')?.remove();
  renderMessages(false); const box = $('#msgs'); box.stick = false; box.scrollTop = 0;
  if (list.length >= 50) {
    detached.add(cid); detachedBar(cid, 'Você está vendo o início do canal');
  }
}
function detachedBar(cid, text) {
  if ($('#detached-bar')) return;
  $('#chat')?.append(h('div#detached-bar', h('span', text), h('button.btn', { onclick: () => { $('#detached-bar')?.remove(); loadChannel(cid); } }, 'Ir para o presente')));
}
function mentionAvatar(u) {
  return u.avatar ? h('img.mav', { src: imgUrl(u.avatar, 20), alt: '', loading: 'lazy' }) : h('span.mav.mini', { style: { background: u.color || '#5865f2' } }, (u.display_name || u.username || '?')[0].toUpperCase());
}
// o mesmo botão abre e fecha o painel da direita (fixadas / caixa de entrada)
const resultsOpen = (kind) => $('#results')?.dataset.kind === kind;
function markResultBtns() { const k = $('#results')?.dataset.kind; $('.pins-btn')?.classList.toggle('sel', k === 'pins'); $('.inbox-btn')?.classList.toggle('sel', k === 'inbox'); }
// prende o popup pela borda direita do botão, logo abaixo dele (medir a largura falha durante a animação de entrada, que encolhe o popup)
const anchorRight = (pop, btn, gap) => { const r = btn.getBoundingClientRect(); pop.style.left = 'auto'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px'; pop.style.top = (r.bottom + gap) + 'px'; };
// popups dos botões do topo (fixadas, notificações): clicar de novo no mesmo botão fecha
let topWasOpen = false;
window.addEventListener('mousedown', (e) => { topWasOpen = (!!$('.pinspop') && !!e.target.closest?.('.pins-btn')) || (!!$('.notifmenu') && !!e.target.closest?.('.notif-btn')) || (!!$('.inboxpop') && !!e.target.closest?.('.inbox-btn')); }, true);
// menu de notificações do canal: silenciar por um tempo e nível de aviso (padrão do servidor, tudo, só @menções, nada)
function notifMenu(e, ch) { notifCard(e, { ch }); }
// cartão de notificações: nível (todas / só @menções / nada), blocos para @everyone/@here, silenciar e avisos na área
// de trabalho, e o atalho para todas as configurações. Serve para um canal, uma DM ou o servidor inteiro ({ g })
function notifCard(e, { ch, g: srv }) {
  const btn = e.currentTarget;
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const cfg = (S.prefs.notifyCfg ||= {}), lv = (cfg.chLevel ||= {}), mutes = (cfg.channels ||= {});
  const gid = srv ? srv.id : ch?.guild_id, gc = gid ? (cfg[gid] ||= { level: 'all', muted: false, noEveryone: false }) : null;
  const done = () => { savePrefs(); renderSide(); renderRail(); draw(); };
  const box = h('div.ncard');
  const LV = [['all', 'Todas as mensagens'], ['mentions', h('span', 'Só ', h('b', '@menções'))], ['none', 'Nada']];
  const draw = () => {
    const cur = srv ? gc.level || 'all' : lv[ch.id] || gc?.level || 'all', inherited = !srv && !lv[ch.id] && !!gid;
    const viaSrv = !srv && gid && gc?.muted && !channelMuted(ch.id), exc = viaSrv && !!cfg.chUnmute?.[ch.id]; // servidor silenciado: este canal segue ou é exceção
    const muted = srv ? !!gc.muted : channelMuted(ch.id) || (viaSrv && !channelUnmuted(ch)), until = srv ? null : mutes[ch.id];
    const setLv = (k) => { if (srv) gc.level = k; else lv[ch.id] = k; done(); };
    const tile = (on, cls, ic, label, sub, fn, title) => h('button.ntile' + cls + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), title, onclick: fn }, ic, h('span.nt-l', label), sub && h('small', sub));
    const muteTile = viaSrv && !mutes[ch.id]
      ? tile(muted, '.nt-mute', icon(muted ? 'volmute' : 'bell', 22), muted ? 'Silenciado pelo servidor' : 'Reativado', muted ? 'clique para reativar só este canal' : 'o servidor segue silenciado', () => { setChannelUnmuted(ch.id, !exc); done(); },
        muted ? 'O servidor está silenciado. Reative só este canal (o resto continua quieto).' : 'Voltar a seguir o servidor silenciado')
      : tile(muted, '.nt-mute', icon(muted ? 'volmute' : 'bell', 22), muted ? 'Silenciado' : 'Silenciar', muted && until && until !== true ? 'até ' + clock(until) : null, (ev) => {
      if (muted) { if (srv) gc.muted = false; else delete mutes[ch.id]; return done(); }
      if (srv) { gc.muted = true; return done(); }
      const r = ev.currentTarget.getBoundingClientRect();
      menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [[15, 'Por 15 minutos'], [60, 'Por 1 hora'], [180, 'Por 3 horas'], [480, 'Por 8 horas'], [1440, 'Por 24 horas'], [0, 'Até eu reativar']].map(([m, l]) => ({ label: l, fn: () => { mutes[ch.id] = m ? Date.now() + m * 60e3 : true; done(); } })));
    }, srv ? 'Silenciar o servidor inteiro' : 'Silenciar este canal por um tempo');
    box.replaceChildren(
      h('div.nc-title', srv ? 'Notificações de ' + srv.name : ch.type === 1 ? 'Notificações desta conversa' : 'Notificações de #' + chName(ch)),
      h('div.nc-radios', { role: 'radiogroup' }, LV.map(([k, l]) => h('button.nc-radio' + (cur === k ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(cur === k), onclick: () => setLv(k) }, h('span.nc-rl', l), h('i.nc-dot')))),
      !srv && gid && (inherited ? h('div.nc-note', 'Seguindo o padrão do servidor') : h('button.nc-note.link', { type: 'button', onclick: () => { delete lv[ch.id]; done(); } }, 'Voltar ao padrão do servidor')),
      h('div.nc-tiles',
        gc && tile(!gc.noEveryone, '.nt-every', h('span.nt-chips', h('i', '@everyone'), h('i', '@here')), null, null, () => { gc.noEveryone = !gc.noEveryone; done(); }, gc.noEveryone ? 'Avisos de @everyone e @here desligados neste servidor' : 'Receber avisos de @everyone e @here'),
        muteTile,
        tile(!!S.prefs.desktopNotif, '.nt-desk', icon('screen', 22), 'Área de trabalho', null, async () => {
          if (!S.prefs.desktopNotif && 'Notification' in window && Notification.permission !== 'granted') { if (await Notification.requestPermission() !== 'granted') return toast('O navegador bloqueou as notificações', true); }
          S.prefs.desktopNotif = !S.prefs.desktopNotif; done();
        }, 'Avisos do sistema para mensagens e menções (vale para tudo)')),
      h('div.nc-sep'),
      h('button.nc-all', { type: 'button', onclick: () => { closeFloating(); openSettings('notifications', ctxSettings()); } }, h('span', 'Todas as configurações de notificação'), icon('external', 20)));
  };
  draw();
  const pop = popout(btn, box); pop.classList.add('notifmenu', 'ncardpop');
  const r = btn.getBoundingClientRect(), w = pop.getBoundingClientRect().width;
  if (btn.closest('#topbar')) { pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px'; pop.style.top = (r.bottom + 8) + 'px'; }
  else { pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; pop.style.top = (r.bottom + 8) + 'px'; }
}
// popup "Mensagens fixadas" abaixo do botão
async function showPins(e) {
  const btn = e.currentTarget;
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const cid = S.view.cid, list = await tryApi('GET', `/channels/${cid}/pins`); if (!list || S.view.cid !== cid || !btn.isConnected) return; // trocou de canal no meio
  const jump = (m) => { const ch = channelById(m.channel_id); closeFloating(); if (S.view.cid !== m.channel_id) { go(ch.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); };
  const body = list.length ? h('div.pp-list', list.map(m => { const el = msgEl(m, null); el.querySelector('.toolbar')?.remove(); el.onclick = () => jump(m); return el; }))
    : h('div.pp-empty', h('div.pp-art', icon('pin', 40)), h('p', 'Este canal ainda não tem nenhuma mensagem fixada... por enquanto.'));
  const pop = popout(btn, h('div.pp', h('div.pp-head', icon('pin', 22), h('b', 'Mensagens fixadas')), body,
    h('div.pp-foot', h('b', 'Dica:'), h('span', S.view.kind === 'guild' ? 'Quem tem a permissão "Gerenciar mensagens" pode fixar uma mensagem pelo menu de contexto dela.' : 'Clique com o botão direito numa mensagem e escolha "Fixar mensagem".'))));
  pop.classList.add('pinspop'); anchorRight(pop, btn, 8);
}
let searchSeq = 0;
async function doSearch(q) {
  const seq = ++searchSeq;
  if (!q.trim()) return closeResults();
  const gid = S.view.kind === 'guild' ? S.view.gid : '';
  const list = await tryApi('GET', `/search?q=${encodeURIComponent(q)}${gid ? '&guild=' + gid : ''}`); if (!list || seq !== searchSeq) return; // chegou uma busca mais nova
  showResults(`${list.length} resultado(s)`, list);
  if (!list.length) $('#results')?.append(h('div.hintline', { style: { padding: '8px' } }, 'Dica: use de:nome, tem:imagem, tem:arquivo, tem:link ou em:canal para filtrar.'));
}
// ---------- caixa de entrada: menções, respostas e @everyone ----------
const inboxCount = () => Object.values(S.mentions).reduce((n, v) => n + (v || 0), 0) + [...S.rels.values()].filter(r => r.type === 3).length; // menções + pedidos de amizade esperando resposta
const inboxBadge = () => { const n = inboxCount(); return n ? h('span.ibadge', n > 99 ? '99+' : n) : null; };
const KIND_TXT = { mention: 'mencionou você', reply: 'respondeu você', everyone: 'mencionou @everyone' };
// popup "Caixa de entrada" no canto superior direito: não lidas por canal e menções/respostas
let inboxTab = 'unread';
const unreadCh = () => Object.entries(S.unread).map(([cid, u]) => ({ ch: channelById(cid), u })).filter(x => x.ch).sort((a, b) => (b.u.last_id > a.u.last_id ? 1 : -1));
const jumpMsg = (m) => { const ch = channelById(m.channel_id); closeFloating(); if (S.view.cid !== m.channel_id) { go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); };
// mensagens com separador de dia e o botão "Ir" ao passar o mouse
const ibMsgs = (list, head) => { let prev = null; return list.flatMap(m => { const out = []; if (!prev || !sameDay(prev.created_at, m.created_at)) out.push(h('div.ib-day', h('span', dayLabel(m.created_at)))); prev = m; const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); out.push(h('div.ib-msg', head?.(m), e, h('button.ib-jump', { onclick: (ev) => { ev.stopPropagation(); jumpMsg(m); } }, 'Ir'))); return out; }); };
async function showInbox(e) {
  const btn = e?.currentTarget || $('.inbox-btn');
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const body = h('div.ib-body'), tabs = h('div.ib-tabs');
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const reqCount = () => [...S.rels.values()].filter(r => r.type === 3).length;
  const drawTabs = () => tabs.replaceChildren(...[['unread', 'Não lidas'], ['mentions', 'Menções'], ['requests', 'Pedidos']].map(([k, l]) => h('button' + (inboxTab === k ? '.on' : ''), { onclick: () => { inboxTab = k; drawTabs(); draw(); } }, l, k === 'requests' && reqCount() > 0 && h('span.ib-tabn', reqCount()))));
  const empty = (t, p) => h('div.ib-empty', h('div.ib-art', icon('inbox', 36)), h('b', t), h('p', p));
  const chBox = ({ ch, u }) => {
    const g = ch.guild_id ? guild(ch.guild_id) : null, dm = ch.type === 1, peer = dm && dmPeer(ch), cat = ch.parent_id && channelById(ch.parent_id);
    const list = h('div.ib-list', skeleton('rows', 4));
    const box = h('div.ib-box');
    const open = () => { closeFloating(); go(g ? g.id : '@me', ch.id); };
    box.append(h('div.ib-head',
      g ? (g.icon ? h('img.ib-gi', { src: imgUrl(g.icon, 32), alt: '' }) : h('span.ib-gi', initialsOf(g.name))) : avatar(user(peer.id), 32, { status: false }),
      h('div.ib-name', { onclick: open }, h('b', !dm && icon('hash', 14), dm ? user(peer.id).display_name : chName(ch)), h('small', g ? g.name + (cat ? ' › ' + cat.name : '') : 'Mensagem direta')),
      h('button.ib-btn', { title: 'Marcar como lido', onclick: () => { ack(ch.id); box.remove(); if (!body.querySelector('.ib-box')) draw(); } }, icon('check', 16)),
      h('button.ib-btn.ib-fold', { title: 'Recolher', onclick: () => box.classList.toggle('folded') }, icon('caret', 16))), list);
    tryApi('GET', `/channels/${ch.id}/messages?limit=${Math.min(Math.max(u.count || 1, 1), 10)}`).then(msgs => {
      if (!msgs) return list.replaceChildren();
      list.replaceChildren(...ibMsgs(msgs), h('button.ib-all', { onclick: open }, 'Ver todas as não lidas ›'));
    });
    return box;
  };
  const draw = () => {
    if (inboxTab === 'requests') { body.replaceChildren(...friendRequests(() => { drawTabs(); draw(); }, empty)); return; }
    if (inboxTab === 'unread') {
      const chs = unreadCh().slice(0, 20);
      body.replaceChildren(...(chs.length ? chs.map(chBox) : [empty('Tudo em dia!', 'Você não tem mensagens não lidas.')]));
      return;
    }
    body.replaceChildren(skeleton('msgs', 4));
    const more = h('button.ib-all', 'Carregar mais'), wrap = h('div.ib-list');
    const load = async (before) => {
      const list = await tryApi('GET', '/inbox' + (before ? '?before=' + before : '')); if (!list) return;
      if (!before) body.replaceChildren(wrap);
      more.remove();
      wrap.append(...ibMsgs(list, (m) => { const g = guild(m.guild_id); return h('div.ib-why' + (m.unread ? '.new' : ''), h('b', nameOf(m.author_id, m.guild_id)), ' ' + (KIND_TXT[m.kind] || ''), h('span', g ? ` • #${m.channel_name} • ${g.name}` : ' • Mensagem direta')); }));
      if (!before) stagger(wrap, 30, 8); // 1ª página em cascata
      if (!wrap.children.length) body.replaceChildren(empty('Nada por aqui', 'Menções e respostas a você aparecem nesta aba.'));
      else if (list.length === 30) { more.onclick = () => busy(more, load(list.at(-1).id)); wrap.append(more); }
    };
    load();
  };
  const pop = popout(btn, h('div.ib',
    h('div.ib-top', icon('inbox', 22), h('b', 'Caixa de entrada'),
      h('button.ib-btn', { title: 'Marcar tudo como lido', onclick: () => { [...Object.keys(S.unread), ...Object.keys(S.mentions)].forEach(ack); draw(); } }, icon('check', 16)),
      h('button.ib-btn', { title: `Pedidos de amizade (${pending})`, onclick: () => { inboxTab = 'requests'; drawTabs(); draw(); } }, icon('users', 16), pending > 0 && h('span.ibadge', pending))),
    tabs, body));
  pop.classList.add('inboxpop'); if (btn.closest('#rail')) { const r = btn.getBoundingClientRect(); pop.style.left = (r.right + 10) + 'px'; pop.style.top = 'auto'; pop.style.bottom = Math.max(8, innerHeight - r.bottom) + 'px'; } else anchorRight(pop, btn, 6);
  drawTabs(); draw();
}
// caixa de entrada → Pedidos: pedidos de amizade recebidos, do mais novo ao mais antigo, com a data de cada um
// (e os enviados que ainda esperam resposta, no fim)
const reqWhen = (t) => { if (!t) return 'data desconhecida'; const d = new Date(t), min = (Date.now() - t) / 60000;
  const rel = min < 1 ? 'agora' : min < 60 ? `há ${Math.floor(min)} min` : min < 1440 ? `há ${Math.floor(min / 60)} h` : min < 2880 ? 'ontem' : `há ${Math.floor(min / 1440)} dias`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${rel}`; };
// amizade desfeita pelo outro lado: aviso na hora (ou na próxima abertura, se aconteceu com o app fechado) e lista em Pedidos
const LOSS_SEEN = 'lc_fl_seen';
const seenLoss = () => { try { return +localStorage.getItem(LOSS_SEEN + ':' + S.me.id) || 0; } catch { return 0; } };
function noticeFriendLosses(list) {
  if (!list.length) return;
  try { localStorage.setItem(LOSS_SEEN + ':' + S.me.id, String(Math.max(seenLoss(), ...list.map(x => x.at)))); } catch { }
  if (S.prefs.friendLossNotice === false) return;
  const names = list.map(x => user(x.user.id).display_name);
  toast(names.length === 1 ? `${names[0]} desfez a amizade com você` : `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` e mais ${names.length - 2}` : ''} desfizeram a amizade com você`);
}
function refreshInboxRequests() { if ($('.inboxpop') && inboxTab === 'requests') $('.inboxpop .ib-tabs button.on')?.click(); }
function friendLossRows(redraw) {
  const list = S.prefs.friendLossNotice === false ? [] : (S.friendLosses || []);
  if (!list.length) return [];
  const row = (x) => {
    const u = user(x.user.id), rt = S.rels.get(u.id)?.type;
    return h('div.ib-req.ib-lost', { 'data-uid': u.id },
      h('div.ib-req-av', { onclick: (e) => profile(e.currentTarget, u.id) }, avatar(u, 40, { status: false })),
      h('div.ib-req-t', h('b', { onclick: (e) => profile(e.currentTarget, u.id) }, u.display_name), h('small', '@' + u.username),
        h('small.ib-req-d', icon('clock', 12), 'Desfez a amizade ' + reqWhen(x.at).replace(/^(\d)/, 'em $1'))),
      h('div.ib-req-b',
        !rt && h('button.btn.grey.sm', { title: 'Mandar pedido de amizade de novo', onclick: (e) => busy(e.currentTarget, tryApi('POST', '/relationships', { username: u.username }).then(() => toast('Pedido enviado'))) }, 'Mandar pedido'),
        rt === 4 && h('small.mut', 'Pedido enviado'),
        h('button.ib-btn', { title: 'Dispensar', 'aria-label': 'Dispensar aviso', onclick: (e) => busy(e.currentTarget, tryApi('DELETE', `/friend-losses/${u.id}`).then(() => setTimeout(redraw, 150))) }, icon('x', 16))));
  };
  return [h('div.ib-req-h.ib-lost-h', h('span', `Desfizeram a amizade — ${list.length}`), h('button.btn.link.sm', { onclick: () => tryApi('DELETE', '/friend-losses').then(() => setTimeout(redraw, 150)) }, 'Dispensar todos')), ...list.map(row)];
}
function friendRequests(redraw, empty) {
  const byNew = (a, b) => (b.since || 0) - (a.since || 0);
  const inc = [...S.rels.values()].filter(r => r.type === 3).sort(byNew), out = [...S.rels.values()].filter(r => r.type === 4).sort(byNew);
  const shared = (uid) => [...S.guilds.values()].filter(g => g.members?.has?.(uid)).map(g => g.name);
  const act = (b, p) => busy(b, p.then(() => setTimeout(redraw, 150)));
  const row = (r, incoming) => {
    const u = user(r.user.id), gs = shared(u.id);
    return h('div.ib-req', { 'data-uid': u.id },
      h('div.ib-req-av', { onclick: (e) => profile(e.currentTarget, u.id) }, avatar(u, 40)),
      h('div.ib-req-t', h('b', { onclick: (e) => profile(e.currentTarget, u.id) }, u.display_name), h('small', '@' + u.username + (gs.length ? ` · em comum: ${gs.slice(0, 2).join(', ')}${gs.length > 2 ? ` e mais ${gs.length - 2}` : ''}` : '')),
        h('small.ib-req-d', icon('clock', 12), (incoming ? 'Recebido em ' : 'Enviado em ') + reqWhen(r.since))),
      incoming ? h('div.ib-req-b',
        h('button.btn.green.sm', { title: 'Aceitar', onclick: (e) => act(e.currentTarget, tryApi('PUT', `/relationships/${u.id}`, {})) }, icon('check', 14), 'Aceitar'),
        h('button.btn.grey.sm', { title: 'Ignorar', onclick: (e) => act(e.currentTarget, tryApi('DELETE', `/relationships/${u.id}`)) }, 'Ignorar'),
        h('button.ib-btn', { title: 'Mais', onclick: (e) => menu(e, [{ label: 'Mandar mensagem', fn: () => { closeFloating(); openDM(u.id); } }, { label: 'Bloquear', danger: true, fn: () => tryApi('PUT', `/relationships/${u.id}`, { type: 2 }).then(redraw) }]) }, icon('more', 16)))
        : h('div.ib-req-b', h('button.btn.grey.sm', { onclick: (e) => act(e.currentTarget, tryApi('DELETE', `/relationships/${u.id}`)) }, 'Cancelar')));
  };
  const lost = friendLossRows(redraw);
  if (!inc.length && !out.length) return lost.length ? lost : [empty('Nenhum pedido', 'Os pedidos de amizade que você receber aparecem aqui, com a data de cada um.')];
  return [
    h('div.ib-req-h', `Recebidos — ${inc.length}`), ...(inc.length ? inc.map(r => row(r, true)) : [h('div.ib-req-none', 'Nenhum pedido recebido esperando resposta.')]),
    out.length > 0 && h('div.ib-req-h', `Enviados — ${out.length}`), ...out.map(r => row(r, false)),
    ...lost,
  ].filter(Boolean);
}
function closeResults() { $('#results')?.remove(); markResultBtns(); }
function showResults(title, list, kind = 'search') {
  closeResults();
  const panel = h('div#results', { 'data-kind': kind }, h('div.rh', title, h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: closeResults }, icon('x', 14))),
    list.length ? list.map(m => { const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); e.onclick = () => { const ch = channelById(m.channel_id); closeResults(); if (S.view.cid !== m.channel_id) { go(ch.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); }; return e; }) : h('div.empty', { style: { marginTop: '20px' } }, 'Nada encontrado.'));
  $('#content')?.append(panel); markResultBtns();
}

// ---------- compositor ----------
// Rascunho por canal, guardado neste aparelho (lc_drafts): trocar de canal, recarregar ou o navegador descartar a aba
// (no celular é comum) não apaga o que estava sendo escrito. Até 50 canais; o mais antigo sai.
const DRAFTS = 'lc_drafts';
const readDrafts = () => { try { return JSON.parse(localStorage.getItem(DRAFTS) || '{}'); } catch { return {}; } };
function saveDraft(cid, text) {
  const d = readDrafts(); if ((d[cid]?.t || '') === (text || '')) return;
  if (text) d[cid] = { t: text.slice(0, 4000), at: Date.now() }; else delete d[cid];
  const ks = Object.keys(d); if (ks.length > 50) ks.sort((a, b) => d[a].at - d[b].at).slice(0, ks.length - 50).forEach(k => delete d[k]);
  try { localStorage.setItem(DRAFTS, JSON.stringify(d)); } catch { }
}
// o campo na tela agora: a aba pode ser congelada ou fechada a qualquer momento (pagehide/freeze), então grava já
const flushDraft = () => { const ta = $('#composer textarea'); if (ta?.dataset.cid) { clearTimeout(ta._dt); saveDraft(ta.dataset.cid, ta.value); } };
for (const ev of ['pagehide', 'freeze']) addEventListener(ev, flushDraft, { capture: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
function composer(ch, label) {
  const ta = h('textarea', { placeholder: `Conversar em ${label}`, rows: 1, maxLength: 4000, value: readDrafts()[ch.id]?.t || '' });
  ta.dataset.cid = ch.id; ta.addEventListener('blur', flushDraft);
  const grow = () => { ta.style.height = '0'; ta.style.height = Math.min(ta.scrollHeight, 400) + 'px'; };
  let lastTyping = 0;
  const fileIn = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => { [...fileIn.files].forEach(addFile); fileIn.value = ''; } });
  ta.addEventListener('input', () => { grow(); clearTimeout(ta._dt); ta._dt = setTimeout(() => saveDraft(ch.id, ta.value), 400); if (Date.now() - lastTyping > 3000 && ta.value) { lastTyping = Date.now(); gwSend('TYPING', { channel_id: ch.id }); } autocomplete(ta); });
  ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.forEach(addFile); } });
  ta.addEventListener('keydown', (e) => {
    const ac = $('.ac');
    if (ac && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
      e.preventDefault(); const items = [...ac.querySelectorAll('.it')], i = items.findIndex(x => x.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { items[i]?.classList.remove('sel'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('sel'); }
      else items[i]?.dispatchEvent(new MouseEvent('mousedown'));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(ta, ch); setTimeout(grow); }
    else if (e.key === 'Escape') { if (ac) ac.remove(); else if (S.replyTo) { S.replyTo = null; renderReplyBar(); } }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && S.prefs.quickReply !== false) { e.preventDefault(); quickReply(ch, e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'ArrowUp' && !ta.value) { const mine = [...(S.messages.get(ch.id) || [])].reverse().find(m => m.author_id === S.me.id); if (mine) { S.editing = mine.id; renderMessages(true); } }
  });
  // GIF, emoji e gravar voz num botão só: abre uma fileira com os três ícones (o nome aparece ao passar o mouse)
  const extrasBtn = h('button.ibtn.extras-btn', { type: 'button', 'data-keepfloat': '', title: 'GIF, emoji e mensagem de voz', 'aria-label': 'GIF, emoji e mensagem de voz', 'aria-haspopup': 'true' }, icon('extras', 26));
  const insertEmoji = (em) => { ta.setRangeText(em, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); };
  // abre ao passar o mouse (ou clicar) e fecha 0,5 s depois que o mouse sai do botão e do painel
  let cxEl = null, cxTimer = 0, cxAt = 0;
  const cxOpen = () => !!cxEl && cxEl.isConnected;
  const cxHide = () => { clearTimeout(cxTimer); if (cxOpen()) cxEl.remove(); cxEl = null; };
  const cxLater = () => { clearTimeout(cxTimer); cxTimer = setTimeout(cxHide, 500); };
  const cxShow = () => {
    clearTimeout(cxTimer); if (cxOpen()) return;
    const opt = (ic, label, fn) => h('button.cx-opt', { type: 'button', title: label, 'aria-label': label, onclick: () => { cxHide(); closeFloating(); fn(); } }, icon(ic, 24));
    const body = h('div.cx-pop', { role: 'menu' },
      opt('cxgif', 'GIF', () => gifPicker(extrasBtn, (url) => sendGif(ch, url))),
      opt('cxemoji', 'Emoji', () => emojiPicker(extrasBtn, insertEmoji)),
      opt('cxmic', 'Gravar mensagem de voz', () => recordVoiceMessage(ch, extrasBtn.closest('#composer'), { onSent: () => { S.replyTo = null; renderReplyBar(); } })));
    const el = cxEl = popout(extrasBtn, body, 'up'); el.classList.add('cx-popout'); cxAt = Date.now();
    el.addEventListener('mouseenter', () => clearTimeout(cxTimer)); el.addEventListener('mouseleave', cxLater);
    const r = extrasBtn.getBoundingClientRect(), b = el.getBoundingClientRect();
    el.style.top = Math.max(8, r.top - b.height - 8) + 'px'; el.style.left = Math.max(8, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 8)) + 'px';
  };
  // passar o mouse não fecha um seletor de GIF/emoji que já está aberto (só o clique troca)
  extrasBtn.addEventListener('mouseenter', () => { if (cxOpen() || !document.querySelector('#layer :is(.popout, .emoji-picker, .menu):not(.leaving)')) cxShow(); });
  extrasBtn.addEventListener('mouseleave', () => { if (cxOpen()) cxLater(); });
  extrasBtn.onclick = () => (!cxOpen() ? cxShow() : Date.now() - cxAt > 700 && cxHide()); // clique logo depois de abrir pelo mouse (ou toque) mantém aberto
  const wrap = h('div#composer-wrap', h('div#softmute-bar.hidden', { role: 'status' }), h('div#reply-bar.hidden'), h('div#attach-prev.hidden'),
    h('div#composer', h('button.ibtn', { title: 'Enviar arquivo ou compartilhar tema', onclick: (e) => plusMenu(e, ch, fileIn) }, icon('plus', 24)), fileIn, ta,
      extrasBtn));
  // ir para a primeira mensagem: canto de baixo, logo acima do campo; só aparece depois de rolar para cima
  const topBtn = h('button#totop-btn.hidden', { type: 'button', title: 'Ir para a primeira mensagem', 'aria-label': 'Ir para a primeira mensagem', onclick: jumpToTop }, icon('totop', 20));
  wrap.append(topBtn);
  setTimeout(() => {
    renderReplyBar(); renderPendingPrev(); renderSoftmute(); if (ta.value) { grow(); ta.setSelectionRange(ta.value.length, ta.value.length); } ta.focus();
    const box = $('#msgs'); if (!box) return;
    const upd = () => topBtn.classList.toggle('hidden', box.scrollHeight - box.clientHeight < 200 || box.scrollTop < 120 || !!$('#detached-bar'));
    box.addEventListener('scroll', upd, { passive: true }); upd();
  }, 0);
  return wrap;
}
function renderReplyBar() {
  const bar = $('#reply-bar'); if (!bar) return;
  document.querySelectorAll('#msgs .msg.qr-target').forEach(x => { if (x.dataset.mid !== S.replyTo?.id) x.classList.remove('qr-target'); });
  if (!S.replyTo) return bar.classList.add('hidden');
  bar.classList.remove('hidden'); bar.replaceChildren(h('span', 'Respondendo a ', h('b', nameOf(S.replyTo.author_id, channelById(S.replyTo.channel_id)?.guild_id))), h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: () => { S.replyTo = null; renderReplyBar(); } }, icon('x', 14)));
}
// prévia das imagens anexadas é um blob: URL; precisa ser liberada quando o anexo sai da lista (senão o arquivo fica na memória)
const freePending = (list) => { for (const p of list) if (p.preview) { URL.revokeObjectURL(p.preview); p.preview = null; } };
function clearPending() { freePending(S.pending); S.pending = []; }
// fotos ficam bem mais leves antes de enviar: WebP de boa qualidade com no máximo 2560 px no lado maior (o chat e o
// visualizador nunca mostram mais que isso). GIF (animação), SVG e arquivos já pequenos ficam como estão; se a versão
// comprimida não ficar menor, vai o original. Configurações → Aparência → "Enviar imagens no tamanho original" desliga.
const IMG_MAX = 2560, IMG_Q = .86, IMG_SKIP_BYTES = 200 * 1024;
async function compressImage(file) {
  if (S.prefs.imgOriginal || !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < IMG_SKIP_BYTES) { bmp.close?.(); return file; }
    const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, hh); bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', IMG_Q));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified });
  } catch { return file; }
}
async function addFile(file) {
  const item = { name: file.name, size: file.size, file, state: 'up', ctrl: new AbortController() }, cid = S.view.cid; S.pending.push(item); renderPendingPrev();
  const pct = (stage) => (f) => { const p = Math.floor(f * 100); if (p !== item.pct || item.stage !== stage) { item.pct = p; item.stage = stage; renderPendingPrev(); } };
  try {
    file = await compressImage(file); Object.assign(item, { name: file.name, size: file.size, file });
    // vídeo acima do limite do servidor: comprime aqui antes (upload.js), em vez do "arquivo muito grande"
    const max = await maxUpload();
    if (file.size > max) {
      if (!isVideo(file)) throw new Error(`arquivo muito grande (limite de ${Math.round(max / 1048576)} MB)`);
      const before = file.size;
      try { file = await compressVideo(file, max, pct('compress')); } catch (e) { throw new Error(`vídeo maior que o limite de ${Math.round(max / 1048576)} MB e não deu para comprimir: ${e.message}`); }
      if (item.ctrl.signal.aborted) return;
      Object.assign(item, { name: file.name, size: file.size, file });
      toast(`Vídeo comprimido: ${bytes(before)} → ${bytes(file.size)}`);
    }
    let up = file;
    if (await protectFiles(cid)) { const x = await encryptFile(file); up = x.file; item.e2ee = x.meta; } // conversa protegida: sobe cifrado (public/e2ee.js)
    if (item.ctrl.signal.aborted) return;
    const r = await uploadFile(up, { onProgress: pct('up'), signal: item.ctrl.signal, onWait: (w) => { if (item.wait !== w) { item.wait = w; renderPendingPrev(); } } });
    Object.assign(item, r, item.e2ee ? { name: file.name, size: file.size } : {}, { state: 'ok', preview: S.pending.includes(item) && file.type.startsWith('image/') ? URL.createObjectURL(file) : null }); // removido (ou trocou de canal) durante o envio: sem prévia
  } catch (e) { if (!item.ctrl.signal.aborted) toast(`Falha ao enviar ${file.name}: ${e.message}`, true); S.pending = S.pending.filter(p => p !== item); }
  renderPendingPrev();
}
const upLabel = (p) => p.wait ? 'Sem conexão — continua quando voltar' : p.stage === 'compress' ? `Comprimindo… ${p.pct || 0}%` : p.stage === 'up' && p.pct < 100 && p.size > 8388608 ? `Enviando… ${p.pct || 0}%` : 'Enviando…';
function renderPendingPrev() {
  const box = $('#attach-prev'); if (!box) return;
  box.classList.toggle('hidden', !S.pending.length);
  box.replaceChildren(...S.pending.map(p => h('div.prev-item', p.preview ? h('img', { src: p.preview }) : icon('file', 40), h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name), p.state === 'up' && h('div.up-st' + (p.wait ? '.wait' : ''), upLabel(p), p.stage && h('i.up-bar', { style: { width: (p.pct || 0) + '%' } })),
    h('button.x', { onclick: () => { p.ctrl?.abort(); freePending([p]); S.pending = S.pending.filter(x => x !== p); renderPendingPrev(); } }, icon('x', 14)))));
}
const renderPending = () => { };
// GIF escolhido no seletor: vai como o próprio link (respeita a resposta em andamento)
async function sendGif(ch, url) {
  const body = { content: url, reply_to: S.replyTo?.id };
  S.replyTo = null; renderReplyBar();
  try { await api('POST', `/channels/${ch.id}/messages`, body); } catch (e) { toast(e.message, true); }
}
// mensagem otimista: mostrada antes da resposta do servidor (no celular/VPN a ida e volta leva 150-300 ms). Fica só na
// tela (não entra em S.messages); sai quando a MESSAGE_CREATE minha com o mesmo texto chega, quando o envio responde
// ou quando falha. Comandos (/…) ficam de fora: o servidor pode transformar o texto.
const ghosts = []; // { cid, content, el }
function optimistic(cid, body) {
  const box = $('#msgs'), list = S.messages.get(cid);
  if (!box || S.view.cid !== cid || !list || /^\//.test(body.content || '')) return null;
  const prev = list[list.length - 1], m = { id: 'tmp-' + Date.now(), channel_id: cid, author_id: S.me.id, author: S.me, content: body.content, created_at: Date.now(),
    attachments: body.attachments || [], reactions: [], reply_to: body.reply_to || null };
  const el = msgEl(m, prev && prev.author_id === S.me.id && sameDay(prev.created_at, m.created_at) ? prev : null);
  el.classList.add('sending'); el.removeAttribute('data-mid'); el.querySelector('.toolbar')?.remove();
  box.append(el); box.stick = true; box.scrollTop = box.scrollHeight;
  const g = { cid, content: body.content, el }; ghosts.push(g); return g;
}
function dropGhost(g) { if (!g) return; g.el.remove(); const i = ghosts.indexOf(g); if (i >= 0) ghosts.splice(i, 1); }
// a minha mensagem chegou pelo servidor: tira a "enviando" correspondente antes de mostrar a definitiva
function ghostFor(m) { if (m.author_id !== S.me.id) return; const g = ghosts.find(x => x.cid === m.channel_id && x.content === m.content); if (g) dropGhost(g); }
async function sendMsg(ta, ch) {
  let content = ta.value; const atts = S.pending.filter(p => p.state === 'ok');
  if (S.pending.some(p => p.state === 'up')) return toast('Aguarde o envio dos anexos…');
  if (!content.trim() && !atts.length) return;
  const typed = content; content = resolveMentions(ta, content);
  if (S.prefs.cleanLinks !== false) content = cleanLinks(content); // tira utm_*, fbclid, si=… dos links
  if (/^\$[a-z]{2,3}(-[A-Z]{2})?\s/.test(content)) {
    try { const t = await translateOutgoing(content); if (t) content = t; } catch (e) { return toast('Não foi possível traduzir: ' + e.message, true); }
  }
  ta.value = ''; clearTimeout(ta._dt); saveDraft(ch.id, ''); $('.ac')?.remove();
  const body = { content, reply_to: S.replyTo?.id, attachments: atts.map(({ url, name, size, type, e2ee }) => ({ url, name, size, type, ...(e2ee ? { _e2ee: e2ee } : {}) })) };
  const sent = S.pending; S.replyTo = null; S.pending = []; renderReplyBar(); renderPendingPrev();
  const ghost = optimistic(ch.id, body); // aparece na hora, "enviando"; a definitiva entra quando o servidor confirma
  try {
    const r = await api('POST', `/channels/${ch.id}/messages`, body); freePending(sent); dropGhost(ghost);
    if (r?.slow_wait && ch.guild_id) { (S.slowUntil ||= {})[ch.guild_id] = Date.now() + r.slow_wait * 1000; renderSoftmute(); } // limitado: mostra quando pode mandar a próxima
  }
  catch (e) { // falhou: devolve o texto e os anexos (antes os anexos sumiam)
    dropGhost(ghost); toast(e.message, true); ta.value = typed; saveDraft(ch.id, typed);
    if (e.data?.softmute && ch.guild_id) { (S.slowUntil ||= {})[ch.guild_id] = Date.now() + e.data.retry_after * 1000; renderSoftmute(); }
    if (S.view.cid === ch.id) { S.pending = [...sent, ...S.pending]; renderPendingPrev(); } else freePending(sent);
  }
}
function autocomplete(ta) {
  $('.ac')?.remove();
  const before = ta.value.slice(0, ta.selectionStart), m = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  const em = before.match(/(?:^|\s):([a-z0-9_]{2,})$/i);
  if (em) {
    const q = em[1].toLowerCase();
    const list = [...allEmojis().filter(e => e.name.toLowerCase().includes(q)).map(e => ({ label: e.name, node: h('img', { src: e.url, style: { width: '24px', height: '24px', objectFit: 'contain' } }), ins: `<:${e.name}:${e.id}> ` })),
      ...Object.entries(SHORT).filter(([k]) => k.startsWith(q)).map(([k, v]) => ({ label: k, node: h('span', { style: { fontSize: '22px' } }, v), ins: v + ' ' }))].slice(0, 10);
    if (!list.length) return;
    const box = h('div.ac', list.map((x, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => { e.preventDefault?.(); ta.setRangeText(x.ins, ta.selectionStart - em[1].length - 1, ta.selectionStart, 'end'); box.remove(); ta.focus(); } }, x.node, h('b', ':' + x.label + ':'))));
    return $('#chat').append(box);
  }
  if (!m) return;
  const ch = channelById(S.view.cid), q = m[1].toLowerCase();
  const pool = ch.guild_id ? [...guild(ch.guild_id).members.keys()] : ch.recipients.map(r => r.id);
  const found = pool.map(id => user(id)).filter(u => u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q)).slice(0, 8);
  const extra = 'everyone'.startsWith(q) && ch.guild_id ? [{ id: 'everyone', display_name: '@everyone', username: 'Notifica todos' }] : [];
  const all = [...extra, ...found]; if (!all.length) return;
  const box = h('div.ac', all.map((u, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => {
    e.preventDefault?.(); const start = ta.selectionStart - m[1].length - 1, ins = u.id === 'everyone' ? '@everyone ' : `@${u.display_name} `; if (u.id !== 'everyone') addMention(ta, u.display_name, u.id);
    ta.setRangeText(ins, start, ta.selectionStart, 'end'); box.remove(); ta.focus();
  } }, u.id !== 'everyone' && avatar(u, 24, { status: false }), h('b', u.display_name), h('small', u.username))));
  $('#chat').append(box);
}
function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const m = S.typing.get(S.view.cid), now = Date.now();
  const names = m ? [...m].filter(([, t]) => t > now).map(([u]) => nameOf(u, S.view.gid)) : [];
  el.replaceChildren(...(names.length ? [h('span.dots', h('i'), h('i'), h('i')), h('span', names.length > 3 ? 'Várias pessoas estão digitando…' : names.join(', ') + (names.length > 1 ? ' estão digitando…' : ' está digitando…'))] : []));
}

// ---------- lista de membros ----------
// lista de membros: seu cartão fixo no topo (cargo + posição na hierarquia), busca, grupos recolhíveis (salvos por servidor)
const memCol = JSON.parse(localStorage.getItem('lc_memcol') || '{}'); // { gid: { grupo: true (recolhido) | false (aberto) } }
const memQ = { gid: null, q: '' };
function renderMembers() {
  if (deferRender(renderMembers)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const box = $('#members'); if (!box || S.view.kind !== 'guild') return;
  const g = guild(S.view.gid); if (!g) return;
  if (g.partial) loadMembers(g.id).catch(() => { }); // servidor grande: a lista inteira chega agora (members-loaded redesenha)
  if (memQ.gid !== g.id) { memQ.gid = g.id; memQ.q = ''; memLimit.clear(); }
  const ms = [...g.members.values()].map(m => ({ m, u: user(m.user_id) }));
  // cargo mais alto de cada um calculado uma vez (antes: a cada comparação da ordenação, com 300 pessoas ~2.500 vezes)
  const tops = new Map(), topRole = (m) => { let r = tops.get(m); if (r === undefined) { r = null; for (const x of g.roles) if (m.roles.includes(x.id) && (!r || x.position > r.position)) r = x; tops.set(m, r); } return r || undefined; };
  const nm = (x) => (x.nk ??= x.m.nickname || x.u.display_name);
  const by = (a, b) => collator.compare(nm(a), nm(b));
  // hierarquia: dono primeiro, depois pelo cargo mais alto, depois por nome
  const rank = (x) => (g.owner_id === x.u.id ? 1e9 : (topRole(x.m)?.position ?? -1));
  const hier = [...ms].sort((a, b) => rank(b) - rank(a) || by(a, b));
  const meX = ms.find(x => x.u.id === S.me.id), myPos = hier.findIndex(x => x.u.id === S.me.id) + 1;
  const q = memQ.q.trim().toLowerCase();
  const shown = q ? ms.filter(x => (nm(x) + ' ' + x.u.username + ' ' + (x.u.display_name || '')).toLowerCase().includes(q)) : ms;
  const off = shown.filter(x => x.u.status === 'offline'), on = shown.filter(x => x.u.status !== 'offline');
  const groups = new Map();
  for (const x of on) { const r = topRole(x.m); const k = r ? r.id : 'online'; (groups.get(k) || groups.set(k, []).get(k)).push(x); }
  if (off.length) groups.set('offline', off);
  const order = [...g.roles.filter(r => groups.has(r.id)).map(r => [r.id, r.name, r.color]), ['online', 'Online'], ['offline', 'Offline']].filter(([k]) => groups.has(k));
  const col = (memCol[g.id] ||= {});
  const isCol = (k) => !q && (col[k] ?? (k === 'offline' && ms.length > 30)); // buscando: tudo aberto; offline começa recolhido em servidor grande
  const toggle = (k) => { col[k] = !isCol(k); localStorage.setItem('lc_memcol', JSON.stringify(memCol)); renderMembers(); };
  const inVoice = (uid) => { const v = S.voice.get(uid); return v && channelById(v.channel_id)?.guild_id === g.id ? channelById(v.channel_id) : null; };
  // linha guardada enquanto o que ela mostra não muda (o USER_UPDATE troca o objeto da pessoa; membro, cor, sala e jogo
  // idem): com gente entrando e saindo, só a linha de quem mudou é montada de novo
  // só vale dentro do MESMO painel: cada linha guarda o clique, que segura a renderização em que nasceu (e por ela o painel
  // e a tela antigos, com o chat inteiro). Painel novo (trocou de tela) = cache novo — antes isso vazava ~600 MB/hora.
  if (memRows.gid !== g.id || memRows.box !== box) { memRows.clear(); memRows.gid = g.id; memRows.box = box; }
  const usedRows = new Set();
  const row = (x, offline) => {
    const { m, u } = x, vc = !offline && inVoice(u.id), act = offline ? null : activityOf(u.id), col = roleColor(g.id, u.id), name = nm(x), own = g.owner_id;
    usedRows.add(u.id);
    const c = memRows.get(u.id);
    if (c && c.u === u && c.m === m && c.off === offline && c.vc === vc && c.act === act && c.col === col && c.name === name && c.own === own) return c.el;
    const el = buildRow(x, offline, vc);
    memRows.set(u.id, { u, m, off: offline, vc, act, col, name, own, el });
    return el;
  };
  const buildRow = ({ m, u }, offline, vc) => {
    return h('div.mem' + (offline ? '.off' : '') + (u.id === S.me.id ? '.me' : ''), { 'data-uid': u.id, onclick: (e) => profile(e.currentTarget, u.id, g.id), oncontextmenu: (e) => userMenu(e, u.id, g.id) },
      avatar(u, 32, { ring: 'var(--bg-sec)' }),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('div.mn', { style: { color: roleColor(g.id, u.id) || (offline ? '' : 'var(--header)') } }, styleName(h('span.mnn', nm({ m, u })), u.name_style), g.owner_id === u.id && h('span.crown', { title: 'Dono do servidor', style: { marginLeft: '4px' } }, icon('crown', 12)), !offline && platformIcons(u, 13)), activityOf(u.id) && !offline ? h('div.cs.playing', { title: playingLine(activityOf(u.id)) }, gameIcon(activityOf(u.id), 14), 'Jogando ', h('b', activityOf(u.id).game.title)) : u.custom_status && h('div.cs', u.custom_status)),
      vc && h('span.mem-vc', { title: 'Em chamada: ' + chName(vc) }, icon('voice', 14)));
  };
  const head = (k, name, color, list) => {
    const c = isCol(k);
    return h('button.mgroup' + (c ? '.col' : ''), { type: 'button', 'aria-expanded': String(!c), title: c ? 'Mostrar' : 'Recolher', onclick: () => toggle(k) },
      icon('caret', 12), color ? h('i.mg-dot', { style: { background: color } }) : null, h('span.mg-name', name), h('span.mg-n', list.length),
      c && h('span.mg-faces', list.slice(0, 4).map(x => avatar(x.u, 18, { ring: 'var(--bg-sec)' }))));
  };
  // seu cartão: sempre visível, independentemente do cargo; clicar leva você até a sua linha na lista
  const r = meX && topRole(meX.m);
  const jumpMe = () => {
    const k = meX.u.status === 'offline' ? 'offline' : (r ? r.id : 'online');
    if (memQ.q) { memQ.q = ''; if (box._q) box._q.value = ''; }
    { const i = (groups.get(k) || []).sort(by).findIndex(x => x.u.id === S.me.id); if (i >= (memLimit.get(k) || MEM_PAGE)) { memLimit.set(k, i + 50); if (!isCol(k)) renderMembers(); } } // além do pedaço montado
    if (isCol(k)) { col[k] = false; localStorage.setItem('lc_memcol', JSON.stringify(memCol)); renderMembers(); }
    requestAnimationFrame(() => { const el = box.querySelector('.mem.me'); if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  };
  const meCard = meX && h('div.mem-mecard', { title: 'Mostrar você na lista', onclick: jumpMe },
    avatar(meX.u, 36, { ring: 'var(--bg-tert, var(--bg-sec))' }),
    h('div.mm-txt', h('div.mm-name', { style: { color: roleColor(g.id, S.me.id) || '' } }, nm(meX)),
      h('div.mm-role', g.owner_id === S.me.id ? [icon('crown', 12), 'Dono'] : r ? [h('i.mg-dot', { style: { background: r.color || 'var(--text-muted)' } }), r.name] : 'Sem cargo')),
    h('div.mm-pos', { title: `Você é o ${myPos}º de ${ms.length} na hierarquia do servidor` }, h('b', myPos + 'º'), h('small', 'de ' + ms.length)));
  if (!box._q) {
    box._q = h('input.mem-q', { type: 'search', placeholder: 'Buscar membros', 'aria-label': 'Buscar membros', oninput: debounce(() => { memQ.q = box._q.value; renderMembers(); }, 100), onkeydown: (e) => { if (e.key === 'Escape' && box._q.value) { e.stopPropagation(); box._q.value = ''; memQ.q = ''; renderMembers(); } } });
  }
  if (box._q.value !== memQ.q) box._q.value = memQ.q;
  // grupo grande aparece aos pedaços (200 linhas, +300 ao rolar até o fim): abrir os 5.000 offline de um servidor grande
  // montava 5.000 linhas numa tarefa de ~300 ms (scripts/perf-big.mjs)
  const more = (k, l) => { const lim = memLimit.get(k) || MEM_PAGE; if (l.length <= lim) return []; const b = h('button.mem-more', { type: 'button', 'data-k': k, onclick: () => { memLimit.set(k, lim + MEM_STEP); renderMembers(); } }, `Mostrar mais ${Math.min(MEM_STEP, l.length - lim)} de ${l.length - lim}`); memMoreObs.observe(b); return [b]; };
  memMoreObs.disconnect();
  const kids = [...order.flatMap(([k, name, color]) => { const l = groups.get(k).sort(by); return [head(k, name, color, l), ...(isCol(k) ? [] : [...l.slice(0, memLimit.get(k) || MEM_PAGE).map(x => row(x, k === 'offline')), ...more(k, l)])]; }),
    q && !shown.length && h('div.mem-none', 'Ninguém com esse nome')].filter(Boolean);
  for (const id of memRows.keys()) if (!usedRows.has(id)) memRows.delete(id); // saiu do servidor / recolhido: não fica preso
  const top = box.querySelector('.mem-top') || h('div.mem-top');
  if (top.firstChild?.lastChild !== box._q) top.replaceChildren(h('label.mem-search', icon('search', 14), box._q));
  // a lista já está na página: atualiza só o que mudou (a rolagem fica onde estava e as fotos não recarregam)
  const oldList = box.querySelector(':scope > .mem-list'), foot = meCard && h('div.mem-foot', meCard), oldFoot = box.querySelector(':scope > .mem-foot');
  if (oldList && box.firstChild === top) {
    place(oldList, kids);
    if (foot && oldFoot) morph(oldFoot, foot); else if (foot) box.append(foot); else oldFoot?.remove();
  } else box.replaceChildren(top, h('div.mem-list', kids), foot || ''); // seu cartão fica fixo embaixo, como no design
}
const memRows = new Map();
const MEM_PAGE = 200, MEM_STEP = 300, memLimit = new Map(); // quantas linhas de cada grupo da lista de membros estão montadas
const memMoreObs = new IntersectionObserver((es) => { for (const en of es) if (en.isIntersecting) { en.target.click(); break; } }, { rootMargin: '400px 0px' });
const collator = new Intl.Collator('pt-BR');

// =============== Início / amigos ===============
// painel "Ativo agora": amigos online, com servidor e sala de voz quando estão numa chamada
// painel "Ativo agora" (à direita dos Amigos): o que os amigos fazem agora + destaques da semana (public/activity.js)
function renderActiveNow() {
  const box = document.getElementById('active-now'); if (!box) return;
  if (box.querySelector('#actfeed')) return refreshFeedView(); // já montado: só redesenha (presença/voz mudaram)
  activityPanel(box);
}
function renderHome(main) {
  if (S.view.tab === 'blocked' || S.view.tab === 'pending' || S.view.tab === 'activity') S.view.tab = 'online'; // bloqueados: Privacidade e segurança; pendentes: "Todos"; a atividade virou o painel "Ativo agora"
  const tab = S.view.tab, rels = [...S.rels.values()], reqs = rels.filter(r => r.type === 3).length;
  const tabs = [['online', 'Online'], ['all', 'Todos']];
  const q = h('input.fsearch', { placeholder: 'Buscar', oninput: debounce(() => draw(), 120) });
  const ORD = { online: 0, idle: 1, dnd: 2, invisible: 3, offline: 4 };
  const pane = h('div.pane');
  const draw = () => {
    pane.replaceChildren();
    if (tab === 'add') {
      const inp = h('input', { placeholder: 'Digite o nome de usuário exato', onkeydown: (e) => e.key === 'Enter' && send() }), msg = h('div', { style: { marginTop: '8px', fontSize: '14px' } });
      const send = async () => { try { await api('POST', '/relationships', { username: inp.value }); msg.style.color = 'var(--green)'; msg.textContent = `Pedido de amizade enviado para ${inp.value}.`; inp.value = ''; } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = e.message; } };
      return pane.append(h('h2', { style: { margin: '0 0 4px', color: 'var(--header)', fontSize: '16px' } }, 'Adicionar amigo'), h('p', { style: { color: 'var(--text-muted)', margin: '0 0 16px' } }, 'Você pode adicionar amigos pelo nome de usuário.'), h('div.addf', inp, h('button.btn', { onclick: send }, 'Enviar pedido')), msg);
    }
    let list = rels.filter(r => tab === 'online' ? (r.type === 1 && (S.users.get(r.user.id).status !== 'offline' || inviteFrom(r.user.id))) || r.type === 3 : tab === 'all' ? r.type === 1 || r.type === 3 || r.type === 4 : tab === 'pending' ? r.type === 3 || r.type === 4 : r.type === 2);
    list = list.filter(r => r.user.username.toLowerCase().includes(q.value.toLowerCase()) || r.user.display_name.toLowerCase().includes(q.value.toLowerCase()));
    const nm = (r) => (r.user.display_name || r.user.username).toLowerCase();
    const PEND = (r) => r.type === 3 ? 0 : r.type === 4 ? 1 : 2; // pedidos recebidos/enviados no topo de "Todos"
    list.sort((a, b) => (PEND(a) - PEND(b)) || (ORD[S.users.get(a.user.id)?.status || 'offline'] - ORD[S.users.get(b.user.id)?.status || 'offline']) || nm(a).localeCompare(nm(b)));
    pane.append(h('div.fctl', q), h('div.fh', `${{ online: 'Online', all: 'Todos os amigos', pending: 'Pendentes', blocked: 'Bloqueados' }[tab]} — ${list.length}`));
    if (!list.length) return pane.append(h('div.empty', { style: { marginTop: '60px' } }, h('div.empty-ic', icon('moon', 48)), h('p', tab === 'pending' ? 'Nenhum pedido pendente.' : tab === 'blocked' ? 'Você não bloqueou ninguém.' : 'Ninguém por aqui ainda. Que tal adicionar um amigo?')));
    for (const r of list) {
      const u = S.users.get(r.user.id) || r.user;
      const btn = (ic, title, fn, cls = '') => h('button.circle' + cls, { title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 20));
      const inv = r.type === 1 && inviteFrom(u.id); // chamou você para a sala dele (convite ainda valendo)
      pane.append(h('div.frow' + (r.type === 3 ? '.req' : inv ? '.inv' : ''), { onclick: () => openDM(u.id), oncontextmenu: (e) => userMenu(e, u.id) }, avatar(u, 36, { ring: 'var(--bg-pri)' }),
        h('div.fn', h('div.fn-top', styleName(h('b', u.display_name), u.name_style), r.type === 3 && h('span.ftag.req', icon('users', 12), 'Pedido de amizade'),
          inv && h('span.ftag.inv', { title: `${inv.channel.name} · ${inv.guild.name}` }, icon('voice', 12), 'Chamou você')),
          h('small', inv ? `Chamou você para ${inv.channel.name} · ${inv.guild.name}` : r.type === 3 ? 'Quer ser seu amigo' : r.type === 4 ? 'Pedido de amizade enviado' : r.type === 2 ? 'Bloqueado' : (u.custom_status || STATUS_TXT[u.status]))),
        inv && h('button.btn.green.sm.f-join', { title: 'Entrar na chamada', onclick: (e) => { e.stopPropagation(); return acceptInvite(inv.id); } }, icon('voice', 14), 'Entrar'),
        inv && btn('x', 'Recusar convite', () => declineInvite(inv.id), '.no'),
        r.type === 1 && btn('dm', 'Mensagem', () => openDM(u.id)),
        r.type === 3 && btn('check', 'Aceitar', () => tryApi('PUT', `/relationships/${u.id}`, {}), '.ok'),
        (r.type === 3 || r.type === 4 || r.type === 2 || (r.type === 1 && !inv)) && btn('x', r.type === 1 ? 'Remover' : r.type === 2 ? 'Desbloquear' : 'Ignorar', () => tryApi('DELETE', `/relationships/${u.id}`), '.no')));
    }
  };
  main.replaceChildren(h('div#home',
    h('div#topbar', h('button.ibtn.menu-btn', { onclick: () => $('#app').classList.toggle('nav-open') }, icon('more')), icon('users', 24), h('span', 'Amigos'), h('div', { style: { width: '1px', height: '24px', background: 'var(--divider)', margin: '0 8px' } }),
      h('div.tabs', tabs.map(([k, l]) => h('div.tab' + (tab === k ? '.active' : ''), { onclick: () => { if (S.view.tab === k) return; S.view.tab = k; S.staggerNext = true; viewTransition(() => renderHome(main)); } }, l)),
        h('div.tab.green' + (tab === 'add' ? '.active' : ''), { onclick: () => { if (S.view.tab === 'add') return; S.view.tab = 'add'; viewTransition(() => renderHome(main)); } }, icon('plus', 18), 'Adicionar amigo',
          reqs > 0 && h('span.tab-badge', { title: `${reqs} pedido${reqs > 1 ? 's' : ''} de amizade` }, reqs > 99 ? '99+' : reqs))),
      // janela estreita: o painel "Ativo agora" não cabe ao lado e abre como gaveta por este botão
      h('button.ibtn.an-toggle', { title: 'Ativo agora', onclick: () => $('#home').classList.toggle('an-open') }, icon('gamepad', 22))),
    h('div#homebody', pane, h('aside#active-now'), h('div.an-scrim', { onclick: () => $('#home').classList.remove('an-open') }))));
  S.redrawHome = draw; draw(); renderActiveNow();
  if (S.staggerNext) { S.staggerNext = false; stagger(pane); } // só ao chegar na tela/trocar de aba (não nos redesenhos por eventos)
}

// =============== Voz: palco ===============
// tela cheia num <video> próprio fora da árvore que se redesenha: o nativo mostrava pause/minutagem e piscava preto quando a sala era redesenhada
function fullscreenStream(stream) {
  const v = h('video', { autoplay: true, playsInline: true, muted: true, disablePictureInPicture: true });
  v.muted = true; v.srcObject = stream;
  const box = h('div.fsbox', { onclick: () => exit(), title: 'Clique para sair (Esc)' }, v);
  const exit = () => { if (document.fullscreenElement === box) document.exitFullscreen?.().catch(() => { }); else box.remove(); };
  const gone = () => { stream.removeEventListener('inactive', exit); box.remove(); v.srcObject = null; };
  box.addEventListener('fullscreenchange', () => { if (document.fullscreenElement !== box) gone(); });
  stream.addEventListener('inactive', exit);
  document.body.append(box); v.play?.().catch(() => { });
  box.requestFullscreen?.().catch(() => gone());
}
const vidCache = new Map(); // reaproveita <video> para não piscar a cada atualização
function videoFor(key, stream, muted = true) {
  let v = vidCache.get(key);
  if (!v || v.srcObject !== stream) { if (v) v.srcObject = null; v = h('video', { autoplay: true, playsInline: true, muted }); v.srcObject = stream; vidCache.set(key, v); v.play?.().catch(() => { }); }
  else if (v.paused) v.play?.().catch(() => { }); // o navegador pausa <video> removido da tela; ao voltar à sala ele ficava congelado
  return v;
}
// avisa o servidor de quais transmissões estou assistindo (tela visível agora)
function syncWatching(want) {
  const cur = S.watching, next = new Set(want || []);
  for (const id of next) if (!cur.has(id)) gwSend('STREAM_WATCH', { target: id, watching: true });
  for (const id of cur) if (!next.has(id)) gwSend('STREAM_WATCH', { target: id, watching: false });
  S.watching = next;
}
// ---------- quadros da chamada ----------
// fundo com as cores do perfil: tema (degradê) > banner > cor do banner > cor predominante do avatar
const avTint = new Map();
function avatarTint(u) {
  if (!u.avatar) return null;
  if (avTint.has(u.avatar)) return avTint.get(u.avatar);
  avTint.set(u.avatar, null);
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) { // pesa as cores vivas: média de cinza não diz nada
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), k = (d[i + 3] / 255) * (0.15 + (mx - mn) / 255);
        r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k;
      }
      if (!w) return;
      const hex = '#' + [r, g, b].map(v => Math.round(v / w).toString(16).padStart(2, '0')).join('');
      avTint.set(u.avatar, hex);
      document.querySelectorAll(`.utile[data-uid="${u.id}"]`).forEach(t => paintTile(t, u));
    } catch { /* imagem de outro domínio sem CORS: fica o fundo padrão */ }
  };
  img.src = imgUrl(u.avatar, 32); // só a cor média: a versão pequena basta
  return null;
}
function paintTile(t, u) {
  const tp = u.theme_primary, ta = u.theme_accent;
  let bg = null, kind = '';
  if (tp && ta) { bg = `linear-gradient(160deg, ${tp}, ${ta})`; kind = 'theme'; t.style.setProperty('--ring', ta); }
  else if (u.banner) { { const bp = parsePos(u.banner_pos); bg = `${bp.x}% ${bp.y}% / cover url("${imgUrl(u.banner, 600 * Math.min(3, bp.z || 1)).replace(/"/g, '%22')}")`; } kind = 'banner'; }
  else { const c = u.banner_color || avatarTint(u); if (c) { bg = `linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 45%, #000))`; kind = 'color'; } }
  t.dataset.bg = kind;
  if (bg) t.style.setProperty('--tbg', bg); else t.style.removeProperty('--tbg');
  return t;
}
// grade que cabe no palco: testa de 1 a n colunas e fica com o maior quadro 16:9 que cabe sem rolar
function fitStage() {
  const grid = document.querySelector('#stage .grid.fit'); if (!grid) return;
  const n = grid.querySelectorAll(':scope > .tile').length; if (!n) return;
  const gap = 12, W = grid.clientWidth - 32, H = grid.clientHeight - 32;
  if (W <= 0 || H <= 0) return;
  let best = 0;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), w = Math.min((W - gap * (c - 1)) / c, ((H - gap * (r - 1)) / r) * 16 / 9);
    if (w > best) best = w;
  }
  lastTw = Math.max(120, Math.floor(Math.min(best, 1280))) + 'px';
  grid.style.setProperty('--tw', lastTw);
}
// painel de qualidade por transmissão: o que está CHEGANDO (resolução, fps, bitrate, perda), áudio e escolha da camada
function qstatsPanel(uid) {
  const body = h('div.qs-body', 'medindo…'), pref = voice.layerPref?.[uid] ?? 'auto';
  const lb = (v, label) => h('button.qs-layer' + (pref === v ? '.on' : ''), { onclick: (e) => { e.stopPropagation(); voice.setLayerPref(uid, v); } }, label);
  return h('div.qstats', { 'data-uid': uid, onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() }, body,
    h('div.qs-layers', lb('auto', 'Auto'), lb(0, 'Baixa'), lb(1, 'Média'), lb(2, 'Alta')));
}
let qsTimer = null;
function pollQstats() {
  if (qsTimer) return;
  qsTimer = setInterval(async () => {
    const el = S.qstats && document.querySelector('.qstats[data-uid]');
    if (!el) { clearInterval(qsTimer); qsTimer = null; return; }
    const uid = el.dataset.uid, s = await voice.streamStats(uid), body = el.querySelector('.qs-body');
    if (!body) return;
    if (!s) { body.textContent = 'Sem dados de recepção.'; return; }
    const L = ['Baixa', 'Média', 'Alta'];
    body.replaceChildren(
      h('div', h('b', s.w ? `${s.w}×${s.h}` : '—'), ` · ${s.fps ?? '—'} FPS recebidos`),
      h('div', `${s.kbps != null ? (s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1) + ' Mbps' : s.kbps + ' kbps') : '—'} · perda ${s.loss ?? '—'}%${s.jitter != null ? ' · jitter ' + s.jitter + ' ms' : ''}`),
      h('div', icon('wifi', 12), ` Conexão ${s.quality}`, s.freezes ? ` · ${s.freezes} travadas` : ''),
      h('div', `Áudio da transmissão: ${s.audio ? 'ligado' : 'sem áudio'} · Camada: ${s.layerPref === 'auto' ? 'auto (' + (L[s.layer] || '—') + ')' : L[s.layerPref]}`));
  }, 1000);
}
const STAGE_LAYOUTS = [
  { id: 'auto', label: 'Automático', hint: 'Grade; clique numa transmissão para destacá-la' },
  { id: 'grid', label: 'Grade', hint: 'Todos do mesmo tamanho' },
  { id: 'spot', label: 'Destaque + faixa', hint: 'Um grande, os outros embaixo' },
  { id: 'sidebar', label: 'Principal + miniaturas', hint: 'Um grande, os outros na lateral' },
  { id: 'side', label: 'Lado a lado', hint: 'Duas colunas iguais' },
  { id: 'cinema', label: 'Cinema', hint: 'Só a transmissão em destaque' },
];
// miniatura de cada layout (caixas desenhadas com CSS grid; a primeira caixa é a "principal")
const LAYOUT_MINI = { auto: 4, grid: 4, spot: 4, sidebar: 4, side: 2, cinema: 1 };
const layoutMini = (id) => h('div.lmini.lm-' + id, Array.from({ length: LAYOUT_MINI[id] }, (_, i) => h('i' + (i === 0 ? '.main' : ''))), id === 'auto' && h('b.lmauto', 'A'));
// painel de layout do palco: miniaturas clicáveis + opções
function layoutMenu(e) {
  const btn = e.currentTarget;
  if (document.querySelector('.layoutpop')) return closeFloating();
  const cur = () => (STAGE_LAYOUTS.some(l => l.id === S.prefs.stageLayout) ? S.prefs.stageLayout : 'auto');
  const grid = h('div.lgrid');
  const draw = () => grid.replaceChildren(...STAGE_LAYOUTS.map(l => h('button.lopt' + (cur() === l.id ? '.on' : ''), { title: l.hint, onclick: () => { S.prefs.stageLayout = l.id; savePrefs(); renderVoiceUI(); draw(); } },
    layoutMini(l.id), h('span.lname', l.label), h('small', l.hint))));
  const opt = (k, label, hint) => h('div.lrow', h('div', h('b', label), h('small', hint)), uiToggle(S.prefs[k] !== false, (v) => { S.prefs[k] = v; savePrefs(); renderVoiceUI(); applyVisibility(); }));
  draw();
  const pop = popout(btn, h('div.lpanel', h('div.lhead', icon('layout', 18), h('b', 'Layout do palco')), grid,
    h('div.lsep'),
    opt('followSpot', 'Acompanhar destaques da sala', 'Quando alguém destaca uma transmissão, ela abre grande para você'),
    opt('autoPause', 'Pausar vídeo fora da tela', 'Economiza banda: quadros escondidos pausam o vídeo (o áudio continua)')));
  pop.classList.add('layoutpop'); anchorRight(pop, btn, 8);
}
// pausa automática: o vídeo de uma transmissão que não está à vista (quadro oculto, rolado para fora, janela minimizada) pausa no servidor após 4 s
const tileVis = new Map(), pauseTimers = new Map();
const visObs = new IntersectionObserver((es) => { for (const en of es) tileVis.set(en.target.dataset.sid, en.isIntersecting); applyVisibility(); }, { threshold: 0.05 });
// câmeras: o tamanho do quadro (ResizeObserver, sem forçar layout) escolhe a camada do simulcast; fora de vista, pausa
const camVis = new Map(), camW = new Map(), camTimers = new Map();
const camObs = new IntersectionObserver((es) => { for (const en of es) camVis.set(en.target.dataset.uid, en.isIntersecting); applyCamFlow(); }, { threshold: 0.05 });
const camSize = new ResizeObserver((es) => { for (const en of es) camW.set(en.target.dataset.uid, en.contentRect.width); applyCamFlow(); });
const camLayerFor = (w) => { const px = w * Math.min(2, window.devicePixelRatio || 1); return px <= 400 ? 0 : px <= 800 ? 1 : 2; }; // camadas: 1/4, 1/2 e cheia de ~1280
function applyCamFlow() {
  if (!voice?.active || !voice.sfu?.ready) return;
  const inStage = S.view.cid === voice.channelId, keep = S.prefs.autoPause === false || !!document.pictureInPictureElement;
  for (const [uid, p] of voice.peers) {
    if (![...p.consumers.values()].includes('cam')) continue;
    const show = !S.prefs.hiddenVideo?.[uid] && (keep || (inStage && !document.hidden && camVis.get(uid) === true));
    if (camW.has(uid)) voice.camFlow(uid, { layer: camLayerFor(camW.get(uid)) });
    if (show) { clearTimeout(camTimers.get(uid)); camTimers.delete(uid); voice.camFlow(uid, { paused: false }); }
    else if (!camTimers.has(uid) && !p.camPaused) camTimers.set(uid, setTimeout(() => { camTimers.delete(uid); voice.camFlow(uid, { paused: true }); }, 4000));
  }
}
function observeTiles() {
  visObs.disconnect(); tileVis.clear(); camObs.disconnect(); camSize.disconnect(); camVis.clear();
  document.querySelectorAll('#stage .tile.screen[data-sid]').forEach(t => visObs.observe(t));
  document.querySelectorAll('#stage .tile.utile[data-uid]').forEach(t => { if (t.dataset.uid !== S.me.id && t.querySelector('video')) { camObs.observe(t); camSize.observe(t); } });
  applyVisibility(); applyCamFlow();
}
function applyVisibility() {
  if (!voice?.active) return;
  const inStage = S.view.cid === voice.channelId, keep = !inStage || S.prefs.autoPause === false || document.pictureInPictureElement || document.fullscreenElement; // janela flutuante/PiP/tela cheia continuam exibindo
  for (const uid of S.watching) {
    if (voice.closedStreams.has(uid)) continue;
    const show = keep || (!document.hidden && tileVis.get(uid) === true);
    if (show) { clearTimeout(pauseTimers.get(uid)); pauseTimers.delete(uid); if (voice.autoPaused?.has(uid)) voice.flowVideo(uid, false); }
    else if (!pauseTimers.has(uid) && !voice.autoPaused?.has(uid)) pauseTimers.set(uid, setTimeout(() => { pauseTimers.delete(uid); voice.flowVideo(uid, true); }, 4000));
  }
  for (const uid of [...(voice.autoPaused || [])]) if (!S.watching.has(uid)) voice.autoPaused.delete(uid); // parou de assistir: nada a retomar
}
document.addEventListener('visibilitychange', () => { applyVisibility(); applyCamFlow(); });
document.addEventListener('fullscreenchange', applyVisibility);
let lastTw = null; // tamanho calculado na última vez: a grade redesenhada já nasce com ele (sem piscar)
// palco estreito (painel de chat aberto, janela pequena): os botões da transmissão sobem para uma linha própria acima da barra, sem sobrepor os botões da chamada
function markNarrow() { const st = document.getElementById('stage'); if (st) st.classList.toggle('narrow', st.clientWidth < 1000); }
const stageObs = new ResizeObserver(() => { markNarrow(); fitStage(); });
let observedStage = null;
function watchStage() {
  const st = document.getElementById('stage');
  if (st !== observedStage) { if (observedStage) stageObs.unobserve(observedStage); if (st) stageObs.observe(st); observedStage = st; }
  fitStage();
}

const seenLive = new Set(); // transmissões já vistas nesta sala: só as novas começam fechadas
function autoClosed() {
  const now = new Set();
  if (voice.active) for (const v of S.voice.values()) {
    if (v.channel_id !== voice.channelId || !v.screen || v.user_id === S.me.id) continue;
    const k = voice.channelId + ':' + v.user_id; now.add(k);
    if (!seenLive.has(k)) {
      seenLive.add(k);
      if (S.autoWatch?.uid === v.user_id && S.autoWatch.exp > Date.now()) { S.focus = 's:' + v.user_id; S.autoWatch = null; } // veio do botão "Assistir" do feed: abre direto
      else voice.closeStream(v.user_id);
    }
  }
  for (const k of [...seenLive]) if (!now.has(k)) seenLive.delete(k);
}
// pedidos seguidos na mesma rodada (mutar 10x pelo atalho, entrar + câmera + estado) viram UM redesenho, com o estado final.
// Antes cada um redesenhava a lista lateral e o palco inteiros na hora (~400 elementos por vez).
let vuiQ = 0; // 1 = só as falas, 2 = completo
function voiceUpdate(speakOnly) {
  const want = speakOnly ? 1 : 2; if (vuiQ >= want) return;
  const first = !vuiQ; vuiQ = want;
  if (first) queueMicrotask(() => { const k = vuiQ; vuiQ = 0; renderVoiceUI(k === 1); if (k !== 1) applyCamFlow(); }); // câmera nova com a sala fora da tela também pausa
}
// aba/janela escondida: quem está falando não é desenhado (ninguém vê); ao voltar, um redesenho põe em dia
let speakStale = false;
document.addEventListener('visibilitychange', () => { if (!document.hidden && speakStale && voice) { speakStale = false; renderVoiceUI(true); } });
function renderVoiceUI(speakOnly) {
  if (!voice?.active || voice.screen) hideGameOffer();
  if (speakOnly) {
    if (document.hidden) { speakStale = true; return; }
    // só as classes de "falando"; o ping já é medido 1x por segundo (antes cada fala disparava uma medição extra)
    document.querySelectorAll('.tile[data-uid],.avatar[data-uid]').forEach(e => { const u = e.dataset.uid; e.classList.toggle('speaking', voice.speaking.has(u)); e.classList.toggle('sbplay', voice.sbActive.has(u)); });
    return;
  }
  renderSide(); refreshFeedView();
  autoClosed(); // transmissão nova de outra pessoa começa fechada
  updatePip(pipCtx);
  if (!voice.active) { stopAllBuffers(); for (const v of vidCache.values()) v.srcObject = null; vidCache.clear(); pruneBoardCanvases(new Set()); } // saiu da sala: nada do palco fica preso
  syncThrottle(voice);
  const stage = $('#stage'); if (!stage) return syncWatching(null);
  const ch = channelById(S.view.cid); if (!ch || ![1, 2].includes(ch.type)) return syncWatching(null);
  const dm = ch.type === 1, gid = ch.guild_id;
  const members = [...S.voice.values()].filter(v => v.channel_id === ch.id);
  const inRoom = voice.channelId === ch.id;
  const tiles = [], live = new Set();
  const nm = (uid) => dm ? user(uid).display_name : nameOf(uid, gid);
  for (const v of members) {
    if (v.bot) { tiles.push(botTile(v, gid)); continue; }
    const uid = v.user_id, mine = uid === S.me.id, p = voice.peers.get(uid);
    const cam = mine ? voice.cam : (S.prefs.hiddenVideo?.[uid] ? null : p?.streams.cam), scr = mine ? voice.screen : p?.streams.screen;
    if (!v.screen) voice.closedStreams.delete(uid);
    if (scr && v.screen && !mine && voice.closedStreams.has(uid)) {
      tiles.push(h('div.tile.cstream', { 'data-key': 's:' + uid }, h('div.cs', icon('screen', 36), h('b', `${nm(uid)} está transmitindo`), h('button.btn.green', { onclick: (e) => { e.stopPropagation(); voice.openStream(uid); renderVoiceUI(); } }, 'Assistir'))));
    } else if (scr && v.screen) {
      const key = 's:' + uid; live.add(key);
      const vid = mine && !S.selfPreview ? h('div.selfpause', h('span.live.sp-live', 'Ao vivo'), h('b', 'Sua transmissão continua ativa!'), h('span', 'Pausamos esta prévia para economizar recursos.')) : videoFor(key, scr), info = h('span.sinfo');
      // clipe = vídeo + áudio da transmissão + tudo da Resenha: voz de quem transmite e de todos na sala (com os efeitos de voz),
      // bot de música e soundboard. Na transmissão ao vivo nada disso vai (lá a voz segue separada, como voz da call)
      if (clipsAuto(mine) && inRoom) startBuffer(key, scr, [mine ? scr : p?.screenAudioEl?.raw, ...voice.clipAudio()], voice.getCtx());
      const upd = () => (info.textContent = vid.videoWidth ? `${vid.videoWidth}×${vid.videoHeight}` : '');
      if (vid.tagName === 'VIDEO') { vid.onresize = vid.onloadedmetadata = upd; upd(); }
            const sctl = streamControls({ key, uid, mine, scr, inRoom, who: nm(uid) });
            tiles.push(h('div.tile.screen' + (S.focus === key ? '.focus' : '') + (remoteControlling(uid) ? '.controlling' : '') + (S.room?.cid === voice.channelId && S.room.spot === key ? '.spotlit' : ''), { 'data-key': key, 'data-sid': uid, 'data-uid': uid, onclick: () => { S.focus = S.focus === key ? null : key; renderVoiceUI(); }, oncontextmenu: (e) => !mine && menu(e, [{ node: volumeControl(voice, uid, 'screen', 'Volume da transmissão de ' + nm(uid)) }]) }, vid, !mine && v.screen_note && h('div.snote', icon('screen', 22), h('b', v.screen_note === 'closed' ? 'A janela transmitida foi fechada' : 'Janela minimizada'), h('span', v.screen_note === 'closed' ? `${nm(uid)} precisa escolher outra fonte.` : `A imagem volta quando ${nm(uid)} restaurar a janela.`)), mine && healthPill(), mine && voice.captureBlack && h('button.blackwarn', { title: 'Como corrigir', onclick: (e) => { e.stopPropagation(); liveShareModal(); } }, icon('screen', 18), h('span', 'Transmissão preta — jogos em tela cheia exclusiva/anti-cheat bloqueiam a captura. Use "Janela sem bordas".')), sctl, vid.tagName === 'VIDEO' && boardCanvas('s:' + uid, { interactive: S.annot === key, video: vid }), S.annot === key && vid.tagName === 'VIDEO' && h('div.annot-bar', boardTools('s:' + uid, h('button.ibtn', { title: 'Terminar', onclick: () => { S.annot = null; renderVoiceUI(); } }, icon('check', 16)))), vid.tagName === 'VIDEO' && zoomControls(key, vid, scr), S.qstats === key && !mine && qstatsPanel(uid),
        h('div.label', icon('screen', 14), `${nm(uid)} — tela`, info)));
    }
    const ckey = 'c:' + uid;
    if (cam && v.video) live.add(ckey);
    const t = h('div.tile.utile' + (voice.speaking.has(uid) ? '.speaking' : '') + (voice.sbActive.has(uid) ? '.sbplay' : ''), { 'data-uid': uid, 'data-key': ckey, oncontextmenu: (e) => userMenu(e, uid, gid), onclick: () => { S.focus = S.focus === ckey ? null : ckey; renderVoiceUI(); } },
      cam && v.video ? videoFor(ckey, cam) : avatar(user(uid), 96, { status: false }),
      h('div.label', muteIco(v), v.deaf && icon('headoff', 14), styleName(h('span', nm(uid)), user(uid).name_style), fxBadge(v.fx), appBadge(v)));
    tiles.push(paintTile(t, user(uid)));
  }
  const room = S.room?.cid === voice.channelId ? S.room : null;
  if (inRoom && room?.wb) tiles.push(h('div.tile.wbtile', { 'data-key': 'wb' }, boardCanvas('wb', { interactive: true }), h('div.wbbar', boardTools('wb', [h('button.ibtn', { title: 'Destacar / voltar à grade', onclick: () => { S.focus = S.focus === 'wb' ? null : 'wb'; renderVoiceUI(); } }, icon('expand', 16)), h('button.ibtn', { title: 'Fechar a lousa para todos', onclick: () => { clearBoard('wb'); voice.send('ROOM_ACT', { act: 'wb', on: false }); } }, icon('x', 16))]))));
  if (inRoom && room?.code) tiles.push(codeTile({ onFocus: () => { S.focus = S.focus === 'code' ? null : 'code'; renderVoiceUI(); }, onClose: () => voice.send('ROOM_ACT', { act: 'code', on: false }) }));
  const hasScreen = tiles.some(t => t.classList.contains('screen') || t.classList.contains('cstream'));
  if (S.hideMembers && hasScreen) tiles.splice(0, tiles.length, ...tiles.filter(t => !t.classList.contains('utile'))); // oculta os participantes: só as transmissões
  for (const [k, v] of [...vidCache]) if (!live.has(k)) { v.srcObject = null; vidCache.delete(k); } // solta o fluxo na hora (sem esperar o GC)
  pruneZoom(live); pruneBoardCanvases(new Set([...live, ...(inRoom && room?.wb ? ['wb'] : [])]));
  if (inRoom) pruneBuffers(live);
  syncWatching(inRoom ? members.filter(v => v.screen && v.user_id !== S.me.id && !voice.closedStreams.has(v.user_id) && voice.peers.get(v.user_id)?.streams.screen).map(v => v.user_id) : null);
  const hasFocus = tiles.some(t => t.dataset.key === S.focus);
  const screens = tiles.filter(t => t.classList.contains('screen')); // várias transmissões e nenhuma em destaque: grade com todas, do mesmo tamanho
  // layouts nomeados (preferência sincronizada): auto = comportamento clássico (grade, ou destaque ao clicar)
  const layout = STAGE_LAYOUTS.some(l => l.id === S.prefs.stageLayout) ? S.prefs.stageLayout : 'auto';
  let focusTile = hasFocus && tiles.length > 1 ? tiles.find(t => t.dataset.key === S.focus) : null; // sozinho no palco não há o que minimizar: fica a grade normal
  if (layout === 'grid' || layout === 'side') focusTile = null;
  else if (['spot', 'sidebar', 'cinema'].includes(layout) && tiles.length > 1 && !focusTile) focusTile = screens[0] || tiles[0]; // sem destaque escolhido: a primeira transmissão
  const abtn = (ic, title, on, fn) => h('button.roundbtn' + (on ? '.active' : ''), { title, onclick: fn }, icon(ic, 24));
  const btn = (ic, title, on, fn, cls = '') => swapIcon(h('button.roundbtn' + (on ? '.off' : '') + cls, { title, onclick: fn, oncontextmenu: cls.startsWith('.mic') ? noiseMenu : null }, icon(ic, 24)), 'bar-' + ic.replace(/(off|set)$/, ''), !!on); // ícone novo entra com fade + desfoque
  const bar = h('div.bar', inRoom ? [
    // centro = sala e transmissão; microfone, fone, câmera, efeitos, soundboard e música ficam no painel da esquerda
    // (em tela estreita o painel some: aí eles voltam a aparecer aqui, .solo-narrow)
    btn(voice.muted ? 'micoff' : 'mic', voice.muted ? 'Ativar microfone (clique direito: redução de ruído)' : 'Silenciar (clique direito: redução de ruído)', voice.muted, () => voiceToggle('mute'), '.mic.solo-narrow'),
    btn(voice.deafened ? 'headoff' : 'headset', 'Ensurdecer', voice.deafened, () => voiceToggle('deaf'), '.solo-narrow'),
    btn('video', 'Câmera', !!voice.cam, () => voiceAct(() => voice.toggleCam()), '.solo-narrow'),
    voice.screen ? h('button.roundbtn.stopshare', { title: 'Parar de compartilhar a tela', onclick: () => stopSharing() }, icon('screenoff', 22), h('span', 'Parar transmissão')) : btn('screen', 'Transmitir tela', false, startShare),
    fxButton(24, true, '.solo-narrow'),
    abtn('edit', room?.wb ? 'Fechar a lousa' : 'Lousa compartilhada', !!room?.wb, () => voice.send('ROOM_ACT', { act: 'wb', on: !room?.wb })),
    abtn('code', room?.code ? 'Fechar o editor de código' : 'Editor de código compartilhado', !!room?.code, () => voice.send('ROOM_ACT', { act: 'code', on: !room?.code })),
    h('button.roundbtn.solo-narrow', { title: voice.deafened ? 'Soundboard indisponível (ensurdecido)' : 'Soundboard', disabled: voice.deafened, style: voice.deafened ? { opacity: .4, cursor: 'not-allowed' } : null, onclick: (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('soundboard', 24)),
    !dm && h('button.roundbtn.solo-narrow' + (musicOn() ? '.on' : ''), { title: 'Música: tocar no canal de voz', 'data-keepfloat': '', 'data-music-btn': '', onclick: (e) => openMusic(e.currentTarget, voice) }, icon('musicbot', 24)),
    btn('phoneoff', 'Sair da chamada', false, () => voice.leave(), '.red'),
  ] : h('button.btn.green', { style: { minWidth: '220px', minHeight: '46px', fontSize: '16px' }, onclick: () => joinVoice(ch.id) }, dm ? 'Atender / entrar na chamada' : 'Entrar na sala de voz'));
  // botão de layout no topo do palco (à direita): mostra o layout atual e abre o painel com as miniaturas
  const slot = document.getElementById('vc-layout-slot');
  if (slot) slot.replaceChildren(...(inRoom && tiles.length > 1 ? [h('button#vc-layout' + (document.querySelector('.layoutpop') ? '.open' : ''), { title: 'Mudar o layout do palco', onclick: layoutMenu }, icon('layout', 18), h('span', STAGE_LAYOUTS.find(l => l.id === layout).label), icon('chevdown', 14))] : []));
  if (hasScreen) bar.append(h('button.partbtn' + (S.hideMembers ? '.membershid' : ''), { title: S.hideMembers ? 'Mostrar participantes' : 'Ocultar participantes', onclick: () => { S.hideMembers = !S.hideMembers; renderVoiceUI(); } }, icon('caret', 16), icon('users', 18)));
  for (const t of screens) { const sid = t.dataset.sid; if (sid && sid !== S.me.id) voice.setStreamLayer(sid, focusTile && t !== focusTile ? 0 : screens.length > 2 && !focusTile ? 1 : 2); } // miniaturas e grades cheias pedem a camada menor
  const rest = focusTile ? tiles.filter(t => t !== focusTile) : tiles;
  const empty = !tiles.length; // sala vazia: o botão de entrar fica junto do texto, no meio (como no Discord)
  keepEditorFocus(() => stage.replaceChildren(...[
    !empty ? (focusTile ? (layout === 'cinema' ? [h('div.spot', focusTile)] : layout === 'sidebar' ? [h('div.splitwrap', h('div.spot', focusTile), h('div.strip', rest))] : [h('div.spot', focusTile), h('div.strip', rest)]) : layout === 'side' && tiles.length > 1 ? h('div.grid.sidebyside', tiles) : (() => { const gr = h('div.grid.fit', tiles); if (lastTw) gr.style.setProperty('--tw', lastTw); return gr; })()) : h('div.grid', h('div.empty', { style: { color: '#fff' } }, h('h2', dm ? 'Chamada' : chName(ch)), h('p', dm ? 'Ninguém está na chamada.' : 'Ninguém está nesta sala de voz ainda.'), !inRoom && bar)),
    voice.error && inRoom && h('div.verr', voice.error),
    !(empty && !inRoom) && bar].flat().filter(Boolean)));
  watchStage(); observeTiles(); markNarrow();
}
// atalho de clipe: salva os últimos segundos da transmissão em destaque (ou da primeira que está sendo gravada)
const hasScreenOf = (key) => !!S.voice.get(key.slice(2))?.screen;
function clipHotkey() {
  if (!voice?.active) return clipFlash(false, 'Nenhuma transmissão');
  const keys = clipKeys(), key = [S.focus, S.ctlKey].find(k => k && keys.includes(k)) || keys[0];
  if (!key) {
    const why = S.prefs.clipsOn === false ? 'Os clipes estão desativados (botão de clipe na transmissão).'
      : voice.screen && keys.length === 0 ? 'Ative os clipes na sua transmissão (botão de clipe no quadro dela).' : 'Nenhuma transmissão sendo gravada ainda.';
    clipFlash(false, 'Clipe não salvo');
    return toast(why, true);
  }
  const uid = key.slice(2), ch = channelById(voice.channelId), secs = S.prefs.clipSecs || 30, who = ch?.type === 1 ? user(uid).display_name : nameOf(uid, ch?.guild_id);
  saveClip(key, secs, { channelId: voice.channelId, who,
    onCaptured: (ok, why) => (ok ? clipFlash(true, 'Clipe salvo', `${secs}s`) : clipFlash(false, 'Clipe não salvo')) });
}
// aviso de clipe capturado, só para quem apertou: com o app em segundo plano (jogando), o app desktop mostra por cima do
// jogo (fora da captura, não aparece na transmissão); com o app à vista, a animação é dentro da própria página
function clipFlash(ok, title, sub, kind) { // kind 'share': ícone de tela (atalho da transmissão)
  if (desktop?.clipFlash && !document.hasFocus()) return desktop.clipFlash({ ok, title, sub, kind });
  document.querySelector('.clipflash')?.remove();
  const el = h('div.clipflash' + (ok ? '' : '.bad'), { role: 'status', 'aria-live': 'polite' }, h('div.cf-ic', icon(ok ? (kind === 'share' ? 'screen' : 'clip') : 'x', 14)), h('b', title), sub && h('small', sub));
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}
// clipes: ligados por padrão para as transmissões dos outros; na sua própria só se você ativar (codificar o próprio jogo duas vezes pesa)
const clipsAuto = (mine) => (mine ? S.prefs.clipsOn === true : S.prefs.clipsOn !== false);
function clipMenu(e, key, who) {
  if (!clipping(key)) return menu(e, [{ label: 'Ativar clipes', icon: 'clipsparkle', hint: 'Grava os últimos 60s das transmissões em segundo plano', fn: () => { S.prefs.clipsOn = true; savePrefs(); renderVoiceUI(); toast('Clipes ativados: em alguns segundos já dá para salvar'); } }]);
  menu(e, [...clipLengths.map(n => ({ label: `Salvar os últimos ${n}s`, icon: 'clip', hint: 'Posta no chat da sala', fn: () => saveClip(key, n, { channelId: voice.channelId, who }) })),
    { label: 'Salvar e cortar…', icon: 'cliptrim', hint: 'Escolhe o trecho dos últimos 60s antes de postar', fn: () => saveClipTrim(key, { channelId: voice.channelId, who }) }, '-',
    { label: 'Desativar clipes', icon: 'x', danger: true, fn: () => { S.prefs.clipsOn = false; savePrefs(); stopAllBuffers(); renderVoiceUI(); } }]);
}
const ctxSettings = () => ({ voice, logout, go });
function noiseMenu(e) {
  const cur = S.prefs.noiseMode;
  menu(e, [['off', 'Nenhuma'], ['standard', 'Padrão (navegador)'], ['rnnoise', 'Alta — RNNoise (IA)'], ['gtcrn', 'Máxima — GTCRN (IA)']].map(([k, l]) => ({ label: 'Ruído: ' + l, radio: cur === k, fn: async () => { if ((cur || 'standard') === k) return; S.prefs.noiseMode = k; savePrefs(); await voice.rebuildMic(); toast('Redução de ruído: ' + l); } })));
}
async function startShare() {
  if (voice.screen) return liveShareModal();
  if (!voice.active) return toast('Entre em uma sala de voz primeiro.', true);
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, cursor: true, ...S.prefs.screen };
  let src = null, list = [], tab = 'screen', timer, loaded = false, touched = false;
  // áudio: 'game' = só o programa (o jogo), 'system' = tudo do PC menos a Resenha, 'none'
  let audMode = o.audio === false ? 'none' : (o.audioMode === 'system' ? 'system' : 'game'), appCap = { ok: false };
  const tabs = h('div.seg'), grid = h('div.sources'), audRow = h('div');
  // de quem é o áudio "só o jogo": a janela escolhida; na tela inteira, o jogo aberto (detectado pelo app)
  const audTarget = () => (src?.type === 'window' ? (src.pid ? src : null) : list.find(s => s.type === 'window' && s.game && s.pid) || null);
  const drawAudio = () => {
    if (!desktop || !appCap.ok) { // navegador / Windows antigo: só o áudio do sistema (como antes)
      return audRow.replaceChildren(h('label.f', 'Áudio', seg({ system: 'Áudio do sistema', none: 'Sem áudio' }, audMode === 'none' ? 'none' : 'system', v => { audMode = v; })),
        desktop && appCap.reason && h('div.qinfo', 'Áudio só do jogo indisponível: ' + appCap.reason));
    }
    const t = audTarget(), opts = {};
    if (t) opts.game = `Só ${src?.type === 'window' ? 'este programa' : 'o jogo'}: ${t.name.length > 34 ? t.name.slice(0, 33) + '…' : t.name}`;
    opts.system = 'Tudo do PC'; opts.none = 'Sem áudio';
    const mode = audMode === 'game' && !t ? 'system' : audMode;
    audRow.replaceChildren(h('label.f', 'Áudio', seg(opts, mode, v => { audMode = v; drawAudio(); })),
      h('div.qinfo', mode === 'game' ? 'Como no Discord: vai só o som do jogo. Música, navegador e a voz da call não entram na transmissão.'
        : mode === 'system' ? 'Vai o som de todos os programas abertos (música, navegador...), menos o da Resenha.' : 'A transmissão vai sem som.'));
  };
  const drawSources = () => {
    tabs.replaceChildren(...[['screen', 'Telas'], ['window', 'Janelas / aplicativos']].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; drawSources(); } }, l)));
    const items = list.filter(s => s.type === tab).sort((a, b) => (b.game ? 1 : 0) - (a.game ? 1 : 0)); // jogos primeiro
    drawAudio();
    if (!loaded) return grid.replaceChildren(h('div.empty', { style: { gridColumn: '1/-1', margin: '28px' } }, 'Carregando telas e janelas…'));
    grid.replaceChildren(...(items.length ? items.map(s => {
      const mini = s.minimized || s.gone;
      return h('div.source' + (src?.id === s.id ? '.sel' : '') + (mini && !s.thumbnail ? '.minimized' : ''), { onclick: () => { src = s; touched = true; drawSources(); } },
        s.thumbnail ? h('img', { src: s.thumbnail }) : h('div.src-ph', s.appIcon ? h('img.src-icon', { src: s.appIcon }) : icon('screen', 40), h('small', 'Minimizado — volte para ele depois de clicar em Transmitir')),
        s.game && h('span.src-game', 'JOGO'),
        h('div.sn', s.appIcon ? h('img.si', { src: s.appIcon }) : null, h('span', s.name + (mini && s.thumbnail ? ' (minimizado)' : ''))));
    }) : [h('div.empty', { style: { gridColumn: '1/-1', margin: '24px' } }, 'Nada encontrado.')]));
  };
  const refresh = async () => {
    try {
      const fresh = await desktop.getSources(); const first = !loaded; loaded = true;
      const ids = new Set(fresh.map(s => s.id));
      list = [...fresh, ...list.filter(s => !ids.has(s.id) && s.type === 'window').map(s => ({ ...s, gone: true }))]; // jogo em tela cheia some da lista ao dar alt+tab: mantém o que já foi visto
      if (src) src = list.find(s => s.id === src.id) || src;
      // como o Discord: se tem um jogo aberto, ele já vem escolhido (mesmo minimizado depois do alt+tab)
      const game = list.find(s => s.type === 'window' && s.game);
      if (first && !touched && game) { tab = 'window'; src = game; }
      if (!src) src = list.find(s => s.type === tab) || list[0] || null;
      drawSources();
    } catch (e) { loaded = true; drawSources(); toast('Não consegui listar as telas: ' + e.message, true); }
  };
  const body = h('div', desktop && [h('label.f', 'O que compartilhar'), tabs, grid, h('div.qinfo', 'Jogo em tela cheia? Ele aparece em "Janelas" mesmo minimizado depois do alt+tab: selecione, clique em Transmitir e volte para o jogo — a imagem aparece quando ele volta para a tela.')], qualityPanel(o),
    h('label.f', 'Cursor do mouse', seg({ 1: 'Mostrar o cursor', 0: 'Ocultar o cursor' }, o.cursor === false ? 0 : 1, v => (o.cursor = !!+v))),
    audRow,
    !desktop && h('div.qinfo', 'Ao clicar em Transmitir, o navegador abrirá o seletor de tela/janela/aba. Para escolher dentro do app, use o aplicativo desktop.'));
  drawAudio();
  if (desktop) {
    drawSources(); refresh(); timer = setInterval(() => { if (!document.body.contains(body)) return clearInterval(timer); refresh(); }, 3000);
    desktop.appAudioCapable?.().then(r => { appCap = r || { ok: false }; drawAudio(); }).catch(() => { });
  }
  modal('Transmitir tela', 'Escolha o que mostrar, a resolução e os quadros por segundo.', body, [{ label: 'Cancelar', cls: 'link', fn: () => clearInterval(timer) }, { label: 'Transmitir', cls: 'green', fn: async () => {
    if (desktop) { if (!src) { toast('Selecione uma tela ou janela', true); return false; } await desktop.selectSource(src.id, src.name); }
    clearInterval(timer);
    const t = audTarget(), mode = audMode === 'game' && !(appCap.ok && t) ? 'system' : audMode;
    o.audio = mode !== 'none';
    const appAudio = !appCap.ok || mode === 'none' ? null : mode === 'game' ? { mode: 'include', pid: t.pid, name: t.name } : { mode: 'exclude' };
    S.prefs.screen = { res: o.res, fps: o.fps, hint: o.hint, audio: o.audio, audioMode: mode === 'none' ? (S.prefs.screen?.audioMode || 'game') : mode, cursor: o.cursor !== false, bitrate: o.bitrate || 0 }; savePrefs();
    voiceAct(() => voice.toggleScreen({ ...o, appAudio }));
  } }], { width: desktop ? '780px' : '560px' });
}

// durante a transmissão: mudar qualidade ao vivo, trocar fonte, parar
const pipCtx = {
  get voice() { return voice; },
  roomName: () => { const ch = channelById(voice.channelId); return ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || 'Sala'); },
  openRoom: () => { const ch = channelById(voice.channelId); if (ch) go(ch.type === 1 ? '@me' : ch.guild_id, ch.id); },
  settings: () => liveShareModal(),
  stop: () => voice.toggleScreen(),
  streamOf: (uid) => voice.peers.get(uid)?.streams.screen,
  fullscreen: (uid) => { const s = uid ? voice.peers.get(uid)?.streams.screen : voice.screen; if (s) fullscreenStream(s); },
  nameOf: (uid) => { const ch = channelById(voice.channelId); return ch?.type === 1 ? user(uid).display_name : nameOf(uid, ch?.guild_id); },
};
// parar de compartilhar a tela (sem sair da chamada)
function stopSharing() { if (voice.screen) voice.toggleScreen(); }
// ---------- atalho da transmissão (padrão Ctrl+Shift+S) ----------
// Liga/desliga a transmissão na hora, sem abrir o seletor: transmite o que está em primeiro plano (a janela atual, jogo em
// janela ou em tela cheia; a área de trabalho na frente = a tela) com as últimas escolhas de qualidade e áudio da pessoa.
// Um aviso rápido (como o do clipe) confirma que ligou/desligou — por cima do jogo quando a Resenha está em segundo plano.
const shareKey = () => S.prefs.keyShare || 'Ctrl+Shift+KeyS';
let shareBusy = false;
async function shareHotkey() {
  if (!voice?.active) return clipFlash(false, 'Entre numa sala de voz', null, 'share');
  if (voice.screen) { stopSharing(); hideGameOffer(); return clipFlash(true, 'Transmissão encerrada', null, 'share'); }
  if (shareBusy) return; // apertou de novo enquanto ainda liga
  shareBusy = true;
  try { await quickShare(desktop ? await frontSource() : null); } finally { shareBusy = false; }
}
// o que está na frente agora; app desktop antigo (sem a função): o jogo aberto, senão a primeira tela
async function frontSource() {
  if (desktop.foregroundSource) return desktop.foregroundSource().catch(() => null);
  return (await findGameSource()) || (await desktop.getSources?.().catch(() => []))?.find(s => s.type === 'screen') || null;
}
async function findGameSource(g) {
  if (!desktop?.getSources) return null;
  const list = (await desktop.getSources().catch(() => [])).filter(s => s.type === 'window' && s.game);
  return (g && list.find(s => s.name === g.title)) || list[0] || null;
}
// transmite src (app desktop) com as últimas configurações; no navegador (src null) o próprio navegador pede a tela
async function quickShare(src) {
  hideGameOffer();
  if (desktop && !src) { clipFlash(false, 'Transmissão não iniciada', 'Nada para transmitir', 'share'); return; }
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, cursor: true, ...S.prefs.screen };
  const mode = o.audio === false ? 'none' : o.audioMode === 'system' ? 'system' : 'game';
  o.audio = mode !== 'none';
  let appAudio = null;
  if (src && o.audio && (await desktop.appAudioCapable?.().catch(() => null))?.ok) // 'game' = só o programa da frente; na tela inteira, tudo menos a Resenha
    appAudio = mode === 'game' && src.pid ? { mode: 'include', pid: src.pid, name: src.name } : { mode: 'exclude' };
  if (src && !(await desktop.selectSource(src.id, src.name).catch(() => false))) { clipFlash(false, 'Transmissão não iniciada', null, 'share'); return; }
  await voiceAct(() => voice.toggleScreen({ ...o, appAudio }));
  if (voice.screen) clipFlash(true, 'Transmitindo', src?.name, 'share');
  else clipFlash(false, 'Transmissão não iniciada', null, 'share');
}
// jogo aberto na chamada e sem transmitir: oferece transmitir o jogo (uma vez por jogo em cada sala)
const offeredGames = new Set();
function hideGameOffer() { document.getElementById('gameoffer')?.remove(); }
function offerGameShare(g) {
  if (!g || !voice?.active || voice.screen) return hideGameOffer();
  if (S.prefs.gameShareOffer === false || offeredGames.has(voice.channelId + ':' + g.id)) return;
  offeredGames.add(voice.channelId + ':' + g.id); hideGameOffer();
  const key = comboLabel(shareKey());
  const el = h('div#gameoffer', { role: 'dialog', 'aria-label': 'Transmitir o jogo' },
    g.icon ? h('img.go-ic', { src: String(g.icon).startsWith('data:') ? g.icon : 'data:image/png;base64,' + g.icon, alt: '' }) : h('div.go-ic.ph', icon('gamepad', 22)),
    h('div.go-txt', h('b', `Jogando ${g.title}?`), h('small', `Transmita o jogo para a sala. Atalho: ${key}`)),
    h('div.go-acts',
      h('button.btn.green', { type: 'button', onclick: async () => { const s = await findGameSource(g); s ? quickShare(s) : (hideGameOffer(), startShare()); } }, icon('screen', 16), 'Transmitir'),
      h('button.btn.link', { type: 'button', onclick: hideGameOffer }, 'Agora não'),
      h('button.go-x', { type: 'button', title: 'Não perguntar mais (dá para religar em Configurações → Atalhos)', 'aria-label': 'Não perguntar mais', onclick: () => { S.prefs.gameShareOffer = false; savePrefs(); hideGameOffer(); toast('Não vou mais perguntar. Para religar: Configurações → Atalhos.'); } }, icon('x', 14))));
  document.body.append(el);
  setTimeout(() => el.isConnected && el.remove(), 45000);
  // jogando com a Resenha em segundo plano: o aviso aparece por cima do jogo
  if (!document.hasFocus()) clipFlash(true, `Transmitir ${g.title}?`, `Aperte ${key}`, 'share');
}
// botões de cada transmissão, no canto do próprio quadro: a ação principal com texto (parar de assistir / parar transmissão),
// tela cheia e o resto num menu "⋯" para não poluir
// selo de saúde da sua transmissão (voice.screenHealth): fps real, de onde vem o áudio e o que está atrapalhando. Um elemento
// só, reaproveitado entre as renderizações da sala, que se atualiza sozinho a cada 2 s enquanto você transmite.
let hpEl = null, hpT = 0;
function healthPill() {
  if (!hpEl) {
    hpEl = h('button.hpill', { type: 'button', onclick: (e) => { e.stopPropagation(); hpEl.classList.toggle('open'); } });
    const draw = async () => {
      if (!voice?.screen) { clearInterval(hpT); hpT = 0; hpEl = null; return; }
      const x = await voice.screenHealth(); if (!x || !hpEl) return;
      const head = h('span.hp-head', h('i.hp-dot'), x.level === 'ok' ? 'Transmissão OK' : x.level === 'warn' ? 'Transmissão limitada' : 'Problema na transmissão', h('small', [x.fps != null ? `${x.fps} fps` : null, x.audio].filter(Boolean).join(' • ')));
      hpEl.className = 'hpill ' + x.level + (hpEl.classList.contains('open') ? ' open' : '');
      hpEl.title = x.items.length ? x.items.map(i => i[1]).join('\n') : 'Tudo certo: imagem e áudio chegando normalmente';
      hpEl.replaceChildren(head, x.items.length ? h('span.hp-items', x.items.map(([lv, t]) => h('span.hp-i.' + lv, t))) : null);
    };
    draw(); hpT = setInterval(draw, 2000);
  }
  return hpEl;
}
function streamControls({ key, uid, mine, scr, inRoom, who }) {
  const stop = (e) => { e.stopPropagation(); voice.closeStream(uid); if (S.focus === key) S.focus = null; renderVoiceUI(); };
  const more = (e) => {
    e.stopPropagation();
    const on = remoteControlling(uid), wait = remotePending(uid);
    menu(e, [
      mine && { label: S.selfPreview ? 'Pausar a prévia' : 'Ver a prévia da minha transmissão', fn: () => { S.selfPreview = !S.selfPreview; renderVoiceUI(); } },
      mine && { label: 'Ajustes da transmissão', hint: 'Qualidade, áudio e trocar o que compartilho', fn: liveShareModal },
      inRoom && { label: clipping(key) ? 'Clipes' : 'Ativar clipes', fn: () => clipMenu(e, key, who) },
      { label: S.annot === key ? 'Parar de desenhar' : 'Desenhar sobre a transmissão', hint: 'Todos na sala veem', fn: () => { S.annot = S.annot === key ? null : key; renderVoiceUI(); } },
      { label: S.room?.spot === key ? 'Parar de destacar para todos' : 'Destacar para todos', fn: () => voice.send('ROOM_SPOTLIGHT', { key: S.room?.spot === key ? null : key }) },
      !mine && inRoom && { label: on ? 'Parar de controlar' : wait ? 'Aguardando a resposta…' : 'Pedir controle (mouse e teclado)', fn: () => (on ? stopControl() : !wait && requestControl(uid)) },
      !mine && { label: S.qstats === key ? 'Esconder a qualidade' : 'Qualidade desta transmissão', fn: () => { S.qstats = S.qstats === key ? null : key; renderVoiceUI(); pollQstats(); } },
      { label: 'Janela flutuante sobre outros apps', fn: () => popOut(scr) },
    ]);
  };
  return h('div.sctl', { onclick: (e) => e.stopPropagation() },
    mine ? h('button.sc-main.sc-stop', { title: 'Parar de compartilhar a tela', onclick: (e) => { e.stopPropagation(); stopSharing(); } }, icon('screenoff', 16), h('span', 'Parar transmissão'))
      : h('button.sc-main', { title: 'Fechar esta transmissão (você continua na chamada)', onclick: stop }, icon('x', 16), h('span', 'Parar de assistir')),
    h('button.sc-ic', { title: 'Tela cheia', onclick: (e) => { e.stopPropagation(); fullscreenStream(scr); } }, icon('expand', 16)),
    h('button.sc-ic', { title: 'Mais opções', onclick: more }, icon('more', 16)));
}
// ajustes durante a transmissão: só resolução, FPS e taxa de dados, aplicados na hora sem parar nem trocar o que está sendo
// compartilhado (parar fica no botão vermelho "Parar transmissão")
function liveShareModal() {
  const o = { ...voice.screenOpts };
  const blk = voice.captureBlack ? h('div.qinfo.warn', 'A transmissão está saindo PRETA. Se for um jogo (ex.: Valorant), coloque-o em "Janela sem bordas" nas opções de vídeo do jogo e transmita a tela inteira. Tela cheia exclusiva e alguns anti-cheats bloqueiam a captura, e a Resenha não contorna isso.') : null;
  const body = h('div', blk, qualityPanel(o, async (n) => { await voice.changeScreenQuality(n); S.prefs.screen = { ...S.prefs.screen, res: n.res, fps: n.fps, bitrate: n.bitrate || 0 }; savePrefs(); }, { live: true }));
  modal('Ajustes da transmissão', 'Mudam na hora, sem interromper o que você está transmitindo.', body, [{ label: 'Pronto', cls: 'green' }], { width: '560px' });
}

// latência até o servidor (SFU) ou pior par (malha): Wi-Fi colorido; passar o mouse = ms; clicar = gráfico do último minuto
const pingHist = []; // [{ t, ms }] dos últimos 60 s
const lastPing = () => pingHist.at(-1)?.ms ?? null;
const pingLevel = (p) => (p == null ? '' : p < 80 ? 'good' : p < 200 ? 'mid' : 'bad');
const pingEl = () => { const el = h('button#vp-ping.ping', { onclick: (e) => openPingChart(e.currentTarget) }, icon('wifi', 16)); paintPing(el); return el; };
// só mexe no que mudou: trocar className/title à toa faz o navegador recalcular o estilo da página
const setIf = (el, k, v) => { if (el[k] !== v) el[k] = v; };
function paintPing(el) {
  const p = lastPing();
  setIf(el, 'className', 'ping ' + pingLevel(p));
  setIf(el, 'title', p == null ? 'Medindo a conexão…' : `Ping: ${p} ms (clique para ver o gráfico)`);
}
// ida e volta pelo gateway: funciona mesmo sem transporte de mídia conectado (sem microfone, sozinho ouvindo)
const wsPings = new Map(); let wsPingN = 0;
function wsPing() {
  return new Promise((resolve) => {
    const n = ++wsPingN, t0 = performance.now();
    const done = (v) => { wsPings.delete(n); resolve(v); };
    wsPings.set(n, () => done(Math.round(performance.now() - t0)));
    if (ws?.readyState !== 1) return done(null);
    gwSend('PING', { n });
    setTimeout(() => wsPings.has(n) && done(null), 5000);
  });
}
function updatePing() {
  if (!voice.active) { pingHist.length = 0; return; }
  const cid = voice.channelId;
  Promise.resolve().then(() => voice.ping()).catch(() => null).then(p => p ?? wsPing()).then(p => {
    if (voice.channelId !== cid) return;
    const now = Date.now();
    if (p != null) pingHist.push({ t: now, ms: p });
    while (pingHist.length && now - pingHist[0].t > 60000) pingHist.shift();
    const el = document.getElementById('vp-ping'); if (el) paintPing(el);
    document.dispatchEvent(new Event('ping-sample'));
  });
}
// janela escondida/minimizada: mede a cada 5 s em vez de 1 s (ninguém está olhando o selo; o gráfico só fica mais espaçado)
let pingTick = 0;
setInterval(() => (voice?.active ? (!document.hidden || ++pingTick % 5 === 0) && updatePing() : (pingHist.length = 0)), 1000);
// qualidade da voz: selo no painel (nível atual) e ajuste automático a cada 3 s
const isAutoAbr = () => S.prefs.voiceBitrate === 'auto' || S.prefs.voiceBitrate == null;
const abrEl = () => { const el = h('button#vp-abr.abr', { onclick: (e) => openAbrPicker(e.currentTarget) }); paintAbr(el); return el; };
function paintAbr(el) {
  const k = voice.micKbps(), auto = isAutoAbr();
  setIf(el, 'textContent', (auto ? 'Auto · ' : '') + k + 'k');
  setIf(el, 'title', `Qualidade da voz: ${k} kbps${auto ? ' (automático)' : ''}${voice.sentKbps != null ? ` — enviando ~${voice.sentKbps} kbps agora` : ''}. Clique para mudar.`);
}
function openAbrPicker(anchor) {
  const body = h('div.qpop', h('h4', 'Qualidade da voz'), seg(VOICE_BITRATES, isAutoAbr() ? 'auto' : S.prefs.voiceBitrate, (v) => { S.prefs.voiceBitrate = v; savePrefs(); voice.retuneAudio(); paintAbr(anchor); }),
    h('div.hintline', 'Automático: voz mono a 64 kbps (já soa perfeita), descendo para 48 ou 32 se a sua conexão piorar. 128 kbps ou mais só vale para música, e pesa para todos: o servidor repassa a sua voz para cada pessoa da sala.'));
  const el = popout(anchor, body, 'up'); el.classList.add('quick', 'abrpop');
}
setInterval(() => {
  if (!voice?.active) return;
  voice.adaptAudio().catch(() => { }).then(() => { const el = document.getElementById('vp-abr'); if (el) paintAbr(el); });
}, 3000);
function openPingChart(anchor) {
  const W = 300, H = 120, L = 34, R = 8, T = 10, B = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pchart'); svg.setAttribute('role', 'img');
  const avgEl = h('b'), lastEl = h('b'), rangeEl = h('b'), tip = h('div.ptip.hidden'), connBox = h('div.pconn');
  const body = h('div.qpop.pingpop', h('h4', 'Ping até o servidor — último minuto'), h('div.pwrap', svg, tip),
    h('div.pstats', h('div', h('small', 'Último'), lastEl), h('div', h('small', 'Média'), avgEl), h('div', h('small', 'Mín – máx'), rangeEl)), connBox);
  const ns = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let pts = [];
  const draw = () => {
    const now = Date.now(), data = pingHist.filter(s => now - s.t <= 60000);
    const vals = data.map(s => s.ms), max = Math.max(50, ...vals), top = Math.ceil(max * 1.2 / 20) * 20;
    const x = (t) => L + (W - L - R) * (1 - (now - t) / 60000), y = (ms) => T + (H - T - B) * (1 - ms / top);
    svg.replaceChildren();
    for (const v of [0, top / 2, top]) { // grade discreta + rótulos
      svg.append(ns('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pgrid' }));
      const tx = ns('text', { x: L - 6, y: y(v) + 4, class: 'paxis', 'text-anchor': 'end' }); tx.textContent = Math.round(v); svg.append(tx);
    }
    for (const [t, lbl] of [[now - 60000, '-60s'], [now - 30000, '-30s'], [now, 'agora']]) { const tx = ns('text', { x: x(t), y: H - 4, class: 'paxis', 'text-anchor': t === now ? 'end' : t === now - 60000 ? 'start' : 'middle' }); tx.textContent = lbl; svg.append(tx); }
    pts = data.map(s => ({ ...s, x: x(s.t), y: y(s.ms) }));
    if (pts.length > 1) svg.append(ns('polyline', { points: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), class: 'pline' }));
    if (pts.length) { const p = pts.at(-1); svg.append(ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot' })); }
    if (!pts.length) { const tx = ns('text', { x: (L + W - R) / 2, y: H / 2, class: 'paxis', 'text-anchor': 'middle' }); tx.textContent = 'Medindo…'; svg.append(tx); }
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    lastEl.textContent = vals.length ? `${vals.at(-1)} ms` : '—'; avgEl.textContent = avg != null ? `${avg} ms` : '—';
    rangeEl.textContent = vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)} ms` : '—';
    svg.setAttribute('aria-label', `Ping no último minuto: média ${avg ?? '—'} ms, último ${vals.at(-1) ?? '—'} ms`);
    paintConn(vals);
  };
  // diagnóstico: protocolo, perda, oscilação e o que fazer
  let ci = null; const readConn = () => voice?.connInfo?.().then(x => { ci = x; paintConn(pingHist.filter(s => Date.now() - s.t <= 60000).map(s => s.ms)); }).catch(() => { });
  const paintConn = (vals) => {
    if (!ci) return connBox.replaceChildren(h('small', 'Analisando a conexão…'));
    const loss = Math.max(ci.sendLoss ?? 0, ci.recvLoss ?? 0), spread = vals.length > 5 ? Math.max(...vals) - Math.min(...vals) : 0, avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const tips = [];
    if (ci.proto === 'tcp') tips.push(['bad', 'A conexão de voz está indo por TCP: o UDP parece bloqueado na sua rede (ou na VPN). TCP atrasa a voz quando há qualquer perda. Peça para liberar a porta 40000/UDP do servidor.']);
    if (loss > .02) tips.push(['bad', `Perda de pacotes de ${(loss * 100).toFixed(1)}%: a voz pode picotar. Wi-Fi fraco ou rede congestionada são as causas mais comuns; cabo de rede ajuda muito.`]);
    if (spread > 80 || (ci.jitterMs ?? 0) > 30) tips.push(['mid', 'Ping instável (variando muito): costuma ser Wi-Fi, download pesado na mesma rede ou a VPN passando por um relay em vez de ligar direto.']);
    if (avg > 120) tips.push(['mid', `Ping alto (${Math.round(avg)} ms). Se a VPN (Tailscale) estiver usando um relay, uma conexão direta reduz bastante: no seu computador, rode tailscale ping ${location.hostname} — se aparecer "via DERP", a ligação não está direta.`]);
    connBox.replaceChildren(
      h('div.pcrow', h('span', 'Conexão'), h('b', ci.proto ? [ci.proto.toUpperCase(), ci.proto === 'udp' && icon('check', 14)] : '—'), h('span', 'Perda'), h('b', `${(loss * 100).toFixed(1)}%`), h('span', 'Oscilação'), h('b', ci.jitterMs != null ? `${ci.jitterMs} ms` : '—')),
      ...(tips.length ? tips.map(([k, t]) => h('div.ptipline.' + k, t)) : [h('div.ptipline.good', 'Conexão boa e estável.')]));
  };
  readConn();
  document.addEventListener('ping-sample', readConn); queueMicrotask(() => whenGone(body, () => document.removeEventListener('ping-sample', readConn)));
  // dica ao passar o mouse: amostra mais próxima
  svg.addEventListener('mousemove', (e) => {
    if (!pts.length) return;
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width);
    const p = pts.reduce((a, b) => (Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a));
    svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove();
    svg.append(ns('line', { x1: p.x, x2: p.x, y1: T, y2: H - B, class: 'pcross' }), ns('circle', { cx: p.x, cy: p.y, r: 4, class: 'pdot phov' }));
    tip.textContent = `${p.ms} ms · há ${Math.round((Date.now() - p.t) / 1000)} s`; tip.classList.remove('hidden');
    tip.style.left = Math.min(r.width - 110, Math.max(0, p.x * r.width / W - 50)) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); svg.querySelector('.pcross')?.remove(); svg.querySelector('.phov')?.remove(); });
  draw();
  const onSample = () => { if (tip.classList.contains('hidden')) draw(); };
  document.addEventListener('ping-sample', onSample); queueMicrotask(() => whenGone(body, () => document.removeEventListener('ping-sample', onSample)));
  const el = popout(anchor, body, 'up'); el.classList.add('quick');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - b.height - 10) + 'px'; el.style.left = Math.max(8, r.left) + 'px';
}

function incomingCall(dm, uid) {
  if (!alertAllowed('dm')) return; // não perturbe: sem toque (o cartão da chamada continua na conversa)
  const u = user(uid); document.getElementById('call-banner')?.remove();
  let n = 0; const t = setInterval(() => { if (!document.getElementById('call-banner') || ++n > 6) return clearInterval(t); playSound('ring'); }, 2600);
  const el = h('div#call-banner', avatar(u, 48, { status: false }), h('div', { style: { flex: 1 } }, h('b', u.display_name), h('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'está te ligando…')),
    h('button.btn.green', { onclick: () => { el.remove(); go('@me', dm.id); joinVoice(dm.id); } }, 'Atender'), h('button.btn.red', { onclick: () => el.remove() }, 'Recusar'));
  document.body.append(el); playSound('ring');
  notify(`${u.display_name} está te ligando`, 'Chamada de voz', () => { go('@me', dm.id); });
  setTimeout(() => el.remove(), 30000);
}

// ---------- jogo aberto no PC -> atividade "Jogando X" (app desktop) ----------
// usa a mesma detecção da transmissão (pasta de loja/jogos, executável conhecido, janela em tela cheia). Repete a cada 20 s
// enquanto há jogo (o servidor esquece em 90 s sem notícia: app fechado/travado não deixa "Jogando" preso).
let gameTimer = null, sentGame, gameTick = null; // undefined = nada enviado nesta conexão
function startGameDetect() {
  sentGame = undefined; // (re)conectou: manda o estado de novo
  if (!desktop?.detectGame || gameTimer) return;
  api('GET', '/activity/pc').then(r => { S.pcActivity = r.visibility; }).catch(() => { });
  const tick = gameTick = async () => {
    const share = S.pcActivity !== 'off' && ws?.readyState === 1;
    if (!share && !liteAutoOn() && !voice?.active) return;
    const g = await desktop.detectGame().catch(() => null), id = g?.id || null;
    gameChanged(g, voice); // modo leve automático enquanto o jogo está aberto (lite.js)
    offerGameShare(g); // na chamada e sem transmitir: "Jogando X? Transmitir" 
    if (!share) return;
    // o ícone (PNG ~10 KB) só vai quando o jogo muda ou a conexão é nova; nas outras vezes o servidor usa o que já tem
    if (g || sentGame !== null) gwSend('ACTIVITY_LOCAL', { game: g ? { id: g.id, title: g.title, steam: g.steam || null, ...(id !== sentGame && g.icon ? { icon: g.icon } : {}) } : null });
    sentGame = id;
  };
  setTimeout(tick, 3000); gameTimer = setInterval(tick, 20000);
}

// ---------- atalhos / desktop ----------
// clipe: o atalho padrão passou de Ctrl+Alt+C para F8 (tecla única, dá para apertar no meio do jogo). Quem estava no
// padrão antigo muda junto; quem escolheu outro atalho fica com o seu.
function migrateClipKey() {
  if (S.prefs.keyClipV === 2) return;
  if (!S.prefs.keyClip || S.prefs.keyClip === 'Ctrl+Alt+KeyC') S.prefs.keyClip = 'F8';
  S.prefs.keyClipV = 2; savePrefs();
  desktop?.setSettings?.({ hotkeyClip: comboToAccel(S.prefs.keyClip) });
}
function setupDesktop() {
  if (setupDesktop.done) return; setupDesktop.done = true;
  const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
  addEventListener('keydown', (e) => {
    if (S.prefs.inputMode === 'ptt' && e.code === S.prefs.pttKey && !e.repeat && (!typing(e.target) || !/^(Key|Digit|Space|Numpad)/.test(e.code))) voice?.setPtt(true);
    if (!(typing(e.target) && !e.ctrlKey && !e.altKey) && sbKey(e, voice)) return;
    const c = comboFromEvent(e);
    if (c && c === (S.prefs.keyMute || 'Ctrl+Shift+KeyM')) { e.preventDefault(); voiceToggle('mute'); }
    if (c && c === (S.prefs.keyDeafen || 'Ctrl+Shift+KeyD')) { e.preventDefault(); voiceToggle('deaf'); }
    if (c && c === (S.prefs.keyClip || 'F8')) { e.preventDefault(); clipHotkey(); }
    if (c && c === (S.prefs.keyFx || 'Ctrl+Shift+KeyE')) { e.preventDefault(); fxHotkey(); }
    if (c && c === shareKey() && !e.repeat) { e.preventDefault(); shareHotkey(); }
  });
  addEventListener('keyup', (e) => { if (e.code === S.prefs.pttKey) voice?.setPtt(false); });
  addEventListener('blur', () => voice?.setPtt(false));
  desktop?.setSettings?.({ hotkeyMute: comboToAccel(S.prefs.keyMute || 'Ctrl+Shift+KeyM'), hotkeyDeafen: comboToAccel(S.prefs.keyDeafen || 'Ctrl+Shift+KeyD'), hotkeyClip: comboToAccel(S.prefs.keyClip || 'F8'), hotkeyShare: comboToAccel(shareKey()) });
  desktop?.onHotkey?.((k) => { if (k === 'mute') voiceToggle('mute'); if (k === 'deafen') voiceToggle('deaf'); if (k === 'clip') clipHotkey(); if (k === 'share') shareHotkey(); });
}

// gancho de depuração/testes automatizados
initRemote({ savePrefs, send: gwSend, name: (uid) => nameOf(uid, channelById(voice?.channelId)?.guild_id) || user(uid).display_name, rerender: () => renderVoiceUI() });
initLfg({ go, profile: (a, uid) => profile(a, uid), inVoice: () => !!voice?.channelId, voiceChannel: () => (voice?.channelId && channelById(voice.channelId)?.type === 2 ? voice.channelId : '') });
initClipsGallery({ go, jumpTo: (mid) => jumpTo(mid), share: (c) => shareClipModal(c) });
initFiles({ go, jumpTo: (mid) => jumpTo(mid) });
initDiag(() => voice); initPwa(); setTimeout(initAppUpdate, 1500); // aviso de versão nova do app desktop (depois da abertura, sem atrasá-la)
initCallInvite({ go, joinVoice, voice: () => voice, channelById, guild, onPending: () => { if (S.view.kind === 'home') { S.redrawHome?.(); refreshFeedView(); } } });
initActivity({ openDM, profile: (a, uid) => profile(a, uid), userMenu: (e, uid) => userMenu(e, uid), go, joinVoice, watchFriend, voice: () => voice, openSettings: (k) => openSettings(k, ctxSettings()), renderActiveNow, renderMembers: () => { if ($('#members')) renderMembers(); }, renderSide: () => renderSide() });
// testes: importa um módulo do app pelo mesmo endereço (com a versão) que o app usa, para pegar a mesma instância
const VQ = new URL(import.meta.url).search;
window.__lc = { S, savePrefs, import: (f) => import('./' + f + VQ), get voice() { return voice; }, go, joinVoice, openFavs, moveFav, jumpTo, renderMessages, voiceToggle: (k) => voiceToggle(k), openSettings: (k) => openSettings(k, { voice, logout, go, gid: S.view.gid }) };

// =============== Boot ===============
(async function boot() {
  const m = location.pathname.match(/^\/invite\/([\w-]+)/);
  if (m) pendingInvite = m[1];
  if (S.token) connect(); else showAuth(pendingInvite ? 'register' : 'login');
})();
