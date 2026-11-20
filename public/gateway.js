// Conexão com o servidor (gateway): WebSocket, reconexão, tela de entrar/sair e o tratamento de cada evento (onEvent).
// Guarda o estado da conexão (ws, voice, ready…): só este módulo escreve nele; os outros leem pelo import (valor ao vivo).
import { nativeEnded } from './nativetest.js';
import { setNewsActions, maybeShowNews, markSeen as markNewsSeen } from './changelog.js';
import { onKindsEvent } from './chkinds.js';
import { onMediaFavs } from './mediafavs.js';
import { onEventUpdate, onEventReminder } from './events.js';
import { onGamesUpdate, onGameDeal, onDealsSeen, loadDeals } from './games.js';
import { reconnectDelay } from './backoff.js';
import { h, icon, inviteText } from './util.js';
import { S, api, guild, channelById, member, nameOf, toast, warmEmojis, notify, closeNotifs, quietHere, tabId, notifPolicy, desktop, applyTheme, savePrefs, relite, alertAllowed, prefsDirty, prefsBase, setPrefsBase, mergeRemote, pushPrefsNow, restoreDevicePrefs, resolveDevices, DEVICE_PREF_KEYS } from './state.js';
import { Voice, prewarmVoice } from './voice.js';
import { playSound, presenceSound, resetPresenceSounds } from './sounds.js';
import { initMusic, onState as musicOnState, onRes as musicOnRes, musicState } from './music.js';
import { onIncoming as sbIncoming } from './soundboard.js';
import { paintTyping as previewTyping, previewMessage } from './chpreview.js';
import { initBoard, boardState, onDraw } from './board.js';
import { initCode, codeSet, codeReset } from './code.js';
import { syncThrottle, startUsageWatch, startPressureWatch } from './lite.js';
import { onRemoteEvent } from './remote.js';
import { onLfgEvent, onLfgActivity } from './lfg.js';
import { loadIntents, onIntentEvent } from './intents.js';
import { initCallRating } from './callrate.js';
import { initVrrFix } from './vrrfix.js';
import { reportVideoCaps } from './codecs.js';
import { track, watchClicks, stopTimer, cancelTimer, timing } from './ux.js';
import { onFilesMessage, onFilesClip } from './files.js';
import { onForumEvent, onPostReply } from './forum.js';
import { onClipEvent, onClipStats } from './clipsgallery.js';
import { onWatchEvent } from './watch.js';
import { onCallInvite, onCallInviteUpdate, loadPendingInvites } from './callinvite.js';
import { themeText } from './themes.js';
import { setActivities, onActivityUpdate, onIntegrationUpdate, refreshFeedView, onClipStats as onFeedClipStats } from './activity.js';
import { e2eeLoad, onE2eeKey, decryptDeep, callKey } from './e2ee.js';
import { rumReady } from './rum.js';
import { myDesktopVersion, refreshDesktopVersion, latestDesktop } from './appupdate.js';
import { musicOn } from './botmusic.js';
import { warnOutdated, scanOutdated, outdatedModal } from './appver.js';
import { onUiVersion } from './uiupdate.js';
import { attention, updateTitle, ack } from './unread.js';
import { openSettings, go, applyRoute, buildShell } from './nav.js';
import { renderRail, joinInvite } from './rail.js';
import { GS, renderGS } from './gsearch.js';
import { renderSide, inMessages, movedNotice } from './side.js';
import { newsActions, setCallDropped, checkRejoinOnLoad, joinVoice } from './userbar.js';
import { renderCallBar, renderMain, vcChatHidden } from './mainview.js';
import { catchUp, renderMessages, appendMessage, applyUser, refreshAuthors, msgEl } from './chat.js';
import { onImported, updateClipEmbeds } from './msgcards.js';
import { seenLoss, noticeFriendLosses, refreshInboxRequests } from './inbox.js';
import { ghostFor, renderTyping } from './composer.js';
import { renderMembers } from './members.js';
import { renderActiveNow } from './home.js';
import { voiceUpdate, renderVoiceUI, hasScreenOf } from './stage.js';
import { wsPings, wsPing } from './ping.js';
import { incomingCall, startGameDetect, migrateClipKey, setupDesktop } from './desktopsetup.js';
// tela de entrar: só para quem não está logado
const renderAuth = (...a) => import('./auth.js').then(m => m.renderAuth(...a));
const approveQr = (...a) => import('./auth.js').then(m => m.approveQr(...a));
const qrCodeInUrl = () => { const m = /^\/qr\/([\w-]{20,64})\/?$/.exec(location.pathname); return m ? m[1] : null; };

export let ws, voice, retry = 0, ready = false, pendingInvite = null, offlineSince = 0, restarting = false; // restarting: o servidor avisou que vai reiniciar (atualização)
export const setPendingInvite = (code) => { pendingInvite = code; }; // link /invite/<código> aberto sem estar logado (boot)
export const $ = (s) => document.querySelector(s);
export const gwSend = (t, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t, d }));
// qual servidor esta tela mostra (null: nenhum, ou janela escondida): o servidor só manda a presença dos membros dele
// para quem está olhando (e manda quem está online ao abrir). Reenviado a cada conexão nova (sentView volta a undefined).
let sentView;
export function syncView() {
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

// Redesenhos pedidos por eventos do servidor (alguém mudou de status, entrou na sala…) viram um só por quadro: quando o
// servidor reinicia e todo mundo reconecta, eram centenas de redesenhos da lista lateral e de membros seguidos.
// Fora de eventos (cliques, navegação) o redesenho continua na hora.
let inEvent = false, evQ = null;
const queuedRenders = new Set();
export const deferRender = (fn) => {
  if (!inEvent) return false;
  if (!queuedRenders.has(fn)) { queuedRenders.add(fn); requestAnimationFrame(() => { queuedRenders.delete(fn); fn(); }); }
  return true;
};

// =============== Autenticação ===============
// tela de entrar / criar conta (public/auth.js); o celular que abriu /qr/<código> aprova o login de outro aparelho
const qrCode = qrCodeInUrl();
export function showAuth(mode = 'login') {
  document.getElementById('boot')?.remove(); document.documentElement.classList.remove('boot');
  $('#app').classList.add('hidden');
  const a = $('#auth'); a.classList.remove('hidden');
  renderAuth(a, mode, { invited: !!pendingInvite, qrPending: !!qrCode, onToken: (token) => { S.token = token; localStorage.setItem('lc_token', token); a.classList.add('hidden'); a.replaceChildren(); connect(); } });
}
export function logout() {
  api('POST', '/logout').catch(() => { });
  localStorage.removeItem('lc_token'); S.token = null; voice?.leave(); ws?.close(); location.hash = ''; location.reload();
}

// =============== Gateway ===============
// (tabId, o id desta aba/janela, vem de state.js: vai no gateway e no cabeçalho X-LC-Tab das chamadas à API)
// conexão "travada" (a internet caiu sem o navegador perceber): 2 pings seguidos sem resposta = reconecta (e volta para a sala)
let wsMiss = 0, closeWhy = ''; // por que a última conexão caiu (diagnóstico da captura)
setInterval(async () => {
  if (!ready || ws?.readyState !== 1 || document.hidden && !voice?.active) { wsMiss = 0; return; }
  const cur = ws, ms = await wsPing();
  if (cur !== ws) return;
  if (ms != null) { wsMiss = 0; return; }
  if (++wsMiss < 2) return;
  wsMiss = 0; const onclose = cur.onclose; cur.onclose = cur.onmessage = null; try { cur.close(); } catch { } closeWhy = 'sem resposta a 2 pings seguidos (5 s cada)'; onclose?.();
}, 8000);
export function connect() {
  clearTimeout(connect.t);
  // resume=1: esta página caiu e está voltando com a chamada aberta; o servidor segura a sala até o VOICE_RESUME
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway?token=${S.token}&tab=${tabId}${voice?.channelId ? '&resume=1' : ''}`);
  // numa queda de verdade (pacotes somem sem resposta) a tentativa pode ficar "abrindo" por muito tempo, e a próxima nem
  // começa: sem abrir em 6 s, desiste desta e tenta de novo (onclose)
  const opening = ws; clearTimeout(connect.open); connect.open = setTimeout(() => { if (ws === opening && opening.readyState === 0) { closeWhy ||= 'não abriu em 6 s'; opening.close(); } }, 6000);
  ws.onmessage = (e) => {
    const { t, d } = JSON.parse(e.data), run = () => { inEvent = true; try { onEvent(t, d); } catch (err) { console.error(t, err); } finally { inEvent = false; } };
    // mensagem protegida (public/e2ee.js): abre antes de tratar; os eventos seguintes esperam na fila para não trocar de ordem
    const enc = e.data.includes('"e2ee:1:');
    if (!enc && !evQ) return run();
    const p = (evQ || Promise.resolve()).then(() => enc && decryptDeep(d)).catch(() => { }).then(run);
    evQ = p; p.then(() => { if (evQ === p) evQ = null; });
  };
  ws.onopen = () => {
    clearTimeout(connect.open);
    // telemetria: caiu e voltou (conta a queda e quanto tempo ficou sem conexão, mesmo com a aba escondida)
    if (offlineSince && voice?.screen) voice.capLog?.({ t: 'capnote', msg: `conexão com o servidor caiu por ${((Date.now() - offlineSince) / 1000).toFixed(1)} s${restarting ? ' (servidor reiniciando)' : ''} e voltou; ${closeWhy || 'motivo desconhecido'}` });
    closeWhy = '';
    if (offlineSince) { track('ws_reconnect', restarting ? 'restart' : '', { bg: true }); timing('ws_offline', Date.now() - offlineSince, { bg: true }); offlineSince = 0; }
    restarting = false;
    retry = 0; $('#reconnect')?.remove();
    // versão do app desktop desta conexão: a sala mostra quem está desatualizado e o servidor pode exigir uma mínima
    const sent = myDesktopVersion(); gwSend('CLIENT_INFO', { desktop: sent, kind: devKind() });
    lastActive = null; reportActive(); // conta para os outros aparelhos se este está em uso
    refreshDesktopVersion().then(v => { if (v !== sent) gwSend('CLIENT_INFO', { desktop: v }); });
  };
  ws.onclose = async (e) => {
    if (!S.token) return;
    if (e?.code) closeWhy = `fechada com código ${e.code}${e.reason ? ' (' + e.reason + ')' : ''}`;
    if (e?.code === 1012) restarting = true; // 1012 = o servidor está reiniciando
    if (ready && !offlineSince) offlineSince = Date.now();
    if (ready && !$('#reconnect')) document.body.append(h('div#reconnect', { style: { position: 'fixed', top: 0, left: 0, right: 0, background: '#f0b232', color: '#000', textAlign: 'center', padding: '4px', zIndex: 300, fontWeight: 600 } }, restarting ? 'Servidor atualizando. Volta em alguns segundos…' : 'Conexão perdida. Reconectando…'));
    // com sorteio: num reinício, não voltam todos juntos. Em chamada, no máximo ~2 s entre tentativas (o servidor segura a
    // sala por 20 s, VOICE_GRACE_MS: com 10 s entre tentativas, a rede voltava aos 14 s e a próxima tentativa vinha aos ~25 s, tarde demais)
    clearTimeout(connect.t); connect.t = setTimeout(connect, reconnectDelay(retry++, voice?.channelId ? 2000 : 10000));
    // sessão encerrada (senha trocada, saiu em outro aparelho): volta ao login. Em paralelo e sem esperar: numa queda de
    // rede este pedido pode ficar pendurado por minutos, e antes a reconexão só era agendada depois dele
    api('GET', '/users/0').catch((e) => { if (e.status === 401 && S.token) { clearTimeout(connect.t); clearTimeout(connect.open); $('#reconnect')?.remove(); localStorage.removeItem('lc_token'); S.token = null; showAuth(); } });
  };
}

// a rede voltou (troca de Wi-Fi, cabo, VPN): tenta reconectar na hora, sem esperar a vez da próxima tentativa
addEventListener('online', () => { if (S.token && ws && ws.readyState > 1) { clearTimeout(connect.t); connect(); } });

// lista inteira de um servidor grande chegou: redesenha o que mostra membros (nomes, cores, lista)
document.addEventListener('join-btn-changed', () => { if (channelById(S.view.cid)?.type === 2 || channelById(S.view.cid)?.type === 1) renderMain(); });
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

export function onEvent(t, d) {
  switch (t) {
    case 'SERVER_RESTART': restarting = true; return; // vem logo antes do servidor fechar a conexão
    case 'READY': {
      const wasReady = ready; // conexão nova depois de uma que caiu (não a primeira abertura)
      if (d.now) S.clockOff = d.now - Date.now(); // relógio do servidor - o deste aparelho (cronômetro da chamada vem com a hora do servidor)
      S.me = d.user; S.users.set(d.user.id, d.user); S.ice = d.ice; S.unread = d.unread; S.mentions = {}; S.devices = []; S.desktopMin = d.desktop_min || null;
      onUiVersion(d.ui); // interface nova no servidor desde que esta página abriu? (public/uiupdate.js)
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
      setTimeout(loadDeals, 1500); // promoções da wishlist (selo da caixa de entrada)
      if (!voice) { initBoard((t, d) => voice?.active && voice.send(t, d)); initCode((t, d) => voice?.active && voice.send(t, d)); }
      if (!voice) { voice = new Voice({ send: gwSend, ice: S.ice, myId: S.me.id, prefs: S.prefs, onUpdate: voiceUpdate, serverRoom: () => S.voice.get(S.me.id)?.channel_id || null }); prewarmVoice(S.prefs); }
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
      voice.onRecovered = () => { toast('Voz reconectada'); renderVoiceUI(); };
      voice.onNativeFail = (msg) => toast(msg, true);
      setNewsActions(newsActions);
      voice.isMusicBot = (uid) => S.voice.get(uid)?.bot?.kind === 'music';
      voice.fxLookup = (uid) => S.voice.get(uid)?.channel_id === voice.channelId ? S.voice.get(uid)?.fx : null;
      if (S.nativeOk === undefined) { S.nativeOk = null; voice.nativeCapable().then(r => { S.nativeOk = !!r.ok; S.nativeWhy = r.reason || ''; S.nativeCode = r.code || ''; }); }
      // tela cheia exclusiva confirmada pela captura (voice.watchFse): avisa uma vez por transmissão; não para nada
      voice.onFse = () => { if (!voice.fseToasted) { voice.fseToasted = true; toast('O jogo parece estar em tela cheia exclusiva e a captura não recebe a imagem. Mude para "Janela sem bordas" nas opções de vídeo do jogo. A transmissão continua; veja as opções em Ajustes da transmissão.', true); } renderVoiceUI(); };
      voice.onBlackCapture = (black) => { if (black) toast('Sua transmissão está saindo preta. Se for um jogo, coloque-o em "Janela sem bordas" (tela cheia exclusiva e alguns anti-cheats bloqueiam a captura).', true); renderVoiceUI(); };
      // vigias da transmissão (voice.js watchSource / app desktop appaudio.js): avisos só para quem transmite
      voice.onScreenNote = (n) => { if (n === 'min') toast('Sua janela transmitida foi minimizada: quem assiste vê a imagem parada até você restaurá-la.', true); else if (n === 'closed') toast('A janela que você transmitia foi fechada. Escolha outra fonte na barra da transmissão.', true); renderVoiceUI(); };
      voice.onAppAudioEvent = (ev) => { const n = ev.name || 'O jogo'; toast(ev.t === 'waiting' ? `${n} fechou: o áudio da transmissão volta sozinho quando ele abrir de novo.` : `Áudio de ${n} reconectado na transmissão.`, ev.t === 'waiting'); renderVoiceUI(); };
      voice.ice = S.ice;
      // a conexão caiu e voltou: o servidor já nos tirou da sala, então reentra sem tocar os sons de sair/entrar
      if (ready && voice.channelId) { resetPresenceSounds(); voice.resume(); }
      e2eeLoad(true);
      if (!ready) checkRejoinOnLoad(); // recarregou (ou o app fechou) no meio de uma chamada: oferece voltar
      if (!ready) { buildShell(); warmEmojis(); } ready = true; sentView = undefined; syncView(); // conexão nova: o servidor ainda não sabe o que está na tela
      $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); document.getElementById('boot')?.remove(); document.documentElement.classList.remove('boot'); rumReady(); watchClicks(); reportVideoCaps(track); initCallRating(); initVrrFix();
      applyTheme(); setupDesktop(); startGameDetect(); syncThrottle(voice); startUsageWatch(() => voice); startPressureWatch(() => voice); // pico de consumo e processador no limite (Modo leve)
      loadPendingInvites(); // convites para chamada que chegaram enquanto estava fora (ou antes de recarregar)
      loadIntents(); // "A fim de jogar": minha intenção e os convites que chegaram enquanto estava fora (public/intents.js)
      if (qrCode && !S.qrDone) { S.qrDone = true; approveQr(qrCode, S.me).then(ok => { if (ok) toast('Pronto! O outro aparelho entrou na sua conta.'); }); }
      if (!S.synced) Promise.all([api('GET', '/me/settings'), restoreDevicePrefs()]).then(([r]) => { // sincroniza preferências entre dispositivos
        resolveDevices(); // microfone/fone/câmera salvos: reencontra pelo nome se o id mudou
        S.friendPolicy = r.friend_policy; S.privacy = r.privacy || {};
        // mudança feita aqui que não chegou à conta (o app fechou/atualizou antes de enviar): vale a daqui, e vai para a conta agora
        // migrações (migrateClipKey) antes do envio: senão sai o valor antigo, as outras abas o adotam e ele volta para esta
        // com a versão da conta que este aparelho conhecia (base): junta as duas (o que mudou lá entra, o pendente daqui fica)
        if (prefsBase() && Object.keys(r.settings || {}).length) { mergeRemote(r.settings); S.synced = true; migrateClipKey(); if (prefsDirty()) pushPrefsNow(); applyTheme(); maybeShowNews(); renderSide(); return; }
        if (prefsDirty() && Object.keys(r.settings || {}).length) { S.synced = true; migrateClipKey(); pushPrefsNow(); applyTheme(); maybeShowNews(); renderSide(); return; }
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
      for (const [pid, pc] of S.posts) if (pc.parent_id === d.id) S.posts.delete(pid); // fórum apagado: os posts foram junto
      if (S.view.cid === d.id || channelById(S.view.cid) == null && S.view.gid === d.guild_id) go(d.guild_id); else renderSide();
      break;
    }
    case 'ACTIVITY_UPDATE': onActivityUpdate(d); onLfgActivity(d.user_id); break;
    case 'INTEGRATION_UPDATE': onIntegrationUpdate(d); break;
    case 'GAMES_UPDATE': onGamesUpdate(d); break;
    case 'ACHIEVEMENTS_UPDATE': dispatchEvent(new CustomEvent('rs-achievements', { detail: d })); break; // aba Conquistas e perfil (achievements.js)
    case 'GAME_DEAL': onGameDeal(d); break;
    case 'GAME_DEAL_SEEN': onDealsSeen(); break;
    case 'EVENT_UPDATE': onEventUpdate(d); break;
    case 'EVENT_REMINDER': onEventReminder(d); break;
    case 'DM_CREATE': { S.dms.set(d.id, d); d.recipients.forEach(mergeUser); renderSide(); renderRail(); break; }
    case 'MEMBER_ADD': { const g = guild(d.guild_id); if (g) { g.members.set(d.member.user_id, d.member); mergeUser(d.user); renderMembers(); } break; }
    case 'MEMBER_REMOVE': { const g = guild(d.guild_id); if (g) { g.members.delete(d.user_id); renderMembers(); } break; }
    case 'MEMBER_UPDATE': { const g = guild(d.guild_id); if (g) { g.members.set(d.user_id, { user_id: d.user_id, nickname: d.nickname, roles: d.roles, joined_at: d.joined_at, timeout_until: d.timeout_until, softmute_until: d.softmute_until }); renderMembers(); renderSide(); refreshAuthors(d.user_id); if (d.user_id === S.me.id && S.view.gid === d.guild_id) renderSoftmute(); } break; }
    case 'ROLE_UPDATE': { const g = guild(d.guild_id); if (g) { const i = g.roles.findIndex(r => r.id === d.role.id); if (i >= 0) g.roles[i] = d.role; else g.roles.push(d.role); g.roles.sort((a, b) => b.position - a.position); renderMembers(); } break; }
    case 'CHANNEL_PERMS': { // ajustes de permissão de um canal/categoria (server/chperms.js)
      const g = guild(d.guild_id); if (!g) break;
      (g.channel_perms ||= {})[d.channel_id] = d.overwrites || [];
      const c = g.channels.find(x => x.id === d.channel_id); if (c) c.perm_sync = d.perm_sync;
      renderSide(); const cur = channelById(S.view.cid); if (cur?.guild_id === g.id) renderMain();
      break;
    }
    case 'ROLE_DELETE': { const g = guild(d.guild_id); if (g) { for (const k in g.channel_perms || {}) g.channel_perms[k] = g.channel_perms[k].filter(o => o.target !== d.id); g.roles = g.roles.filter(r => r.id !== d.id); for (const m of g.members.values()) m.roles = m.roles.filter(r => r !== d.id); renderMembers(); } break; }
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
      if (d.user_id === S.me.id && d.channel_id && d.channel_id === voice?.channelId) {
        if (!!d.mod_mute !== !!prevVs?.mod_mute && prevVs?.channel_id === d.channel_id) toast(d.mod_mute ? 'A moderação mutou você nas salas deste servidor' : 'A moderação liberou o seu microfone');
        if (!!d.mod_deaf !== !!prevVs?.mod_deaf && prevVs?.channel_id === d.channel_id) toast(d.mod_deaf ? 'A moderação ensurdeceu você nas salas deste servidor' : 'A moderação liberou o seu áudio');
        if (!!d.no_speak !== !!prevVs?.no_speak && prevVs?.channel_id === d.channel_id) toast(d.no_speak ? 'Você não tem mais permissão para falar nesta sala' : 'Agora você pode falar nesta sala');
        if (!!d.no_video !== !!prevVs?.no_video && prevVs?.channel_id === d.channel_id) toast(d.no_video ? 'Você não tem mais permissão de vídeo nesta sala: câmera e tela foram desligadas' : 'Agora você pode usar câmera e tela nesta sala');
        voice.setModeration(d.mod_mute || d.no_speak, d.mod_deaf);
        voice.setRoomPerms(d.no_speak, d.no_video);
      }
      if (d.bot?.kind === 'music' && !prevVs?.bot) voice?.applyVolume(d.user_id); // áudio do bot chegou antes do estado: aplica o volume da música
      if (S.view.kind === 'home') { setTimeout(renderActiveNow); setTimeout(refreshFeedView); }
      if ((before || null) !== (d.channel_id || null) && $('#members')) renderMembers(); // ícone "em chamada" na lista de membros
      if (d.user_id === S.me.id && d.channel_id !== before) resetPresenceSounds(); // saí ou troquei de sala: sons pendentes da sala antiga não tocam mais
      if (d.user_id === S.me.id && !d.channel_id) musicOnState({ active: false });
      // resposta atrasada à própria saída (a página já entrou de novo na mesma sala): não tira da entrada nova
      const ownEcho = d.user_id === S.me.id && !d.channel_id && !d.reason && !!voice?.ownLeaveEcho?.(d.prev_channel_id);
      if (d.user_id === S.me.id && !d.channel_id && !ownEcho && voice.active && voice.channelId === d.prev_channel_id) { setCallDropped(d.reason === 'drop'); voice.leave(); }
      if (d.user_id !== S.me.id && !d.bot && !prevVs?.bot) { // o bot entrando/saindo não toca o som de pessoa
        const prevState = prevVs, dmCh = S.dms.get(d.channel_id || d.prev_channel_id);
        if (mineCh && d.channel_id === mineCh && before !== mineCh) presenceSound(d.user_id, 'join');
        else if (mineCh && before === mineCh && d.channel_id !== mineCh) presenceSound(d.user_id, 'leave', d.reason === 'reload' ? 30000 : 0); // saiu, caiu ou foi para outra sala ('reload': volta sozinha, a entrada anula o som)
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
    case 'INTENT_INVITE': case 'INTENT_UPDATE': case 'INTENT_RESPONSE': case 'INTENT_FORMED': case 'INTENT_EXPIRED': onIntentEvent(t, d); break;
    case 'ADMIN_DIGEST': { // resumo da semana (só o administrador recebe, server/ux.js)
      toast('Resumo da semana: ' + d.titulo + ' Veja em Configurações → Estatísticas de uso.');
      notify('Resenha: resumo da semana', d.titulo, () => openSettings('uxstats', { voice, logout, go, gid: S.view.gid })); break;
    }
    case 'ADMIN_ALERT': toast('⚠️ ' + d.text, true); notify('Resenha: servidor lento', d.text); break; // só o administrador recebe (server/perf.js)
    case 'LFG_POST': case 'LFG_REQUEST': case 'LFG_ANSWER': case 'LFG_MESSAGE': case 'LFG_JOINED': case 'LFG_LEFT': onLfgEvent(t, d); break;
    case 'CLIP_STATS': onClipStats(d); onFeedClipStats(d); break; // visualizações, curtidas, compartilhamentos e retenção mudaram
    case 'CLIP_CREATE': case 'CLIP_UPDATE': case 'CLIP_DELETE': onClipEvent(t, d); if (t !== 'CLIP_CREATE') { updateClipEmbeds(t, d); onFilesClip(t, d); } break;
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
    case 'WATCH_STATE': case 'WATCH_SYNC': case 'WATCH_MEMBERS': case 'WATCH_END': case 'WATCH_RES': case 'WATCH_ASK': onWatchEvent(t, d); break;
    case 'SOUNDS_UPDATE': { const g = guild(d.guild_id); if (g) { g.sounds = d.sounds; document.dispatchEvent(new Event('sb-changed')); } break; }
    case 'EMOJIS_UPDATE': { const g = guild(d.guild_id); if (g) { g.emojis = d.emojis; renderMessages(true); } break; }
    case 'VOICE_JOINED': voice.onJoined(d); if (!d.sfu) stopTimer('voice_connect', d.channel_id); break;
    case 'VOICE_MODERATED': { // a moderação moveu ou desconectou você (server: PATCH /api/guilds/:id/voice/:uid)
      const by = d.by ? nameOf(d.by, channelById(d.channel_id)?.guild_id) : 'A moderação';
      if (d.action === 'move' && voice?.channelId === d.from) { const to = channelById(d.channel_id); movedNotice(by, to); joinVoice(d.channel_id); }
      else if (d.action === 'disconnect') toast(`${by} desconectou você da chamada`, true);
      break;
    }
    case 'VOICE_DENIED': if (voice.channelId === d.channel_id) { track('voice_fail', /^[a-z_]{1,24}$/.test(d.code || '') ? d.code : 'denied'); cancelTimer('voice_connect'); voice.leave(); if (d.code === 'outdated') outdatedModal(d); else toast(d.reason, true); } break;
    case 'VOICE_PEER_LEFT': voice.onPeerLeft(d); break;
    case 'VOICE_SIGNAL': voice.onSignal(d); break;
    case 'SFU_RES': voice.onSfuRes(d); break;
    case 'SFU_RESET': voice?.onSfuReset(d); renderVoiceUI(); break;
    case 'PONG': wsPings.get(d.n)?.(); break;
    case 'UI_VERSION': onUiVersion(d.v); break; // interface atualizada no servidor sem reiniciar
    case 'VOICE_RESUMED': voice?._resumeWait?.(d); break;
    case 'SFU_NEW_PRODUCER': voice.onSfuProducer(d); break;
    case 'SFU_CODEC_FALLBACK': voice.onCodecFallback(d); break;
    case 'SFU_CONSUMER_CLOSED': voice.onSfuConsumerClosed(d); break;
    case 'SFU_SPEAKING': if (voice.channelId === d.channel_id) voice.onSfuSpeaking(d); break;
    case 'NATIVE_SCREEN_END': nativeEnded(d); voice?.onNativeEnded(d); break;
    case 'NATIVE_SCREEN_LIVE': voice?.onNativeLive(d); break;
    case 'TYPING': {
      let m = S.typing.get(d.channel_id); if (!m) S.typing.set(d.channel_id, m = new Map());
      m.set(d.user_id, Date.now() + 8000); renderTyping(); previewTyping(); setTimeout(() => { renderTyping(); previewTyping(); }, 8100); break;
    }
    case 'MESSAGE_CREATE': onMessage(d); onKindsEvent(t, d); break;
    case 'MEDIA_FAVS': onMediaFavs(d); break;
    case 'CHANNEL_DOC': onKindsEvent(t, d); break;
    case 'MESSAGES_IMPORTED': onImported(d); break;
    case 'FORUM_POST_CREATE': case 'FORUM_POST_UPDATE': case 'FORUM_POST_DELETE': onForumEvent(t, d); break;
    case 'E2EE_KEY': onE2eeKey(d); break;
    case 'READ_STATE': onReadState(d); break; // lido em outro aparelho (ou nesta conta por outra aba)
    case 'SETTINGS_UPDATE': onSettingsSync(d); break;
    case 'DEVICES': S.devices = (d.active || []).filter(x => x.tab !== tabId); break;
    case 'REP_CASE': onRepCase(d); break;
    case 'MESSAGE_UPDATE': {
      const list = S.messages.get(d.channel_id); const i = list?.findIndex(m => m.id === d.id);
      if (i >= 0) { list[i] = d; if (S.view.cid === d.channel_id) { const el = $(`[data-mid="${d.id}"]`); if (el) { const prev = list[i - 1]; el.replaceWith(msgEl(d, prev)); } } }
      onKindsEvent(t, d);
      break;
    }
    case 'MESSAGE_DELETE': {
      onKindsEvent(t, d);
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
export const mergeUser = (u) => { if (!u?.id) return; const old = S.users.get(u.id); S.users.set(u.id, old ? { ...old, ...u, status: old.status, platforms: old.platforms ?? u.platforms } : u); };
export const detached = new Set(); // canais em que estou vendo o início do histórico (sem as mensagens recentes)
export const arriving = new Map(); // canal -> mensagens que chegaram enquanto a lista dele carregava (loadChannel)
function onMessage(m) {
  const list = S.messages.get(m.channel_id), gap = detached.has(m.channel_id);
  if (!list) arriving.get(m.channel_id)?.push(m);
  if (list && !gap && !list.some(x => x.id === m.id)) list.push(m);
  mergeUser(m.author);
  const mine = m.author_id === S.me.id, viewing = S.view.cid === m.channel_id && document.hasFocus() && !vcChatHidden(channelById(m.channel_id));
  const t = S.typing.get(m.channel_id); if (t) { t.delete(m.author_id); renderTyping(); previewTyping(); }
  previewMessage(m); onFilesMessage(m);
  if (S.view.cid === m.channel_id && m.author_id !== S.me.id) $('#vc-chat-btn:not(.sel)')?.classList.add('unread'); // chat da sala fechado
  ghostFor(m);
  if (S.view.cid === m.channel_id && list && !gap) appendMessage(m);
  const dmc = S.dms.get(m.channel_id);
  if (dmc) { dmc.last_message = { id: m.id, author_id: m.author_id, content: (m.content || '').slice(0, 140), created_at: m.created_at, attachment: !!m.attachments?.length }; if (inMessages()) renderSide(); }
  if (m.forum_id) { // comentário num post de fórum: conta no cartão; só avisa se me mencionaram
    onPostReply(m);
    if (mine) return;
    if (S.view.cid === m.channel_id && document.hasFocus()) return ack(m.channel_id);
    if ((m.mentions || []).includes(S.me.id) && !quietHere() && alertAllowed('server')) {
      const pc = channelById(m.channel_id); playSound('mention');
      notify(`${m.author.display_name} (comentário em ${pc?.name || 'um post'})`, S.prefs.notifPreview === false ? 'Nova mensagem' : (m.content || 'Anexo'), () => go(m.guild_id, m.channel_id), m.channel_id);
    }
    return;
  }
  if (mine) return;
  const ch = channelById(m.channel_id), isDM = ch?.type === 1, pol = notifPolicy(ch);
  const text = m.content || '', myRoles = ch?.guild_id ? guild(ch.guild_id)?.members.get(S.me.id)?.roles || [] : [], direct = text.includes(`<@${S.me.id}>`) || myRoles.some(r => text.includes(`<@&${r}>`)); // @cargo seu conta como menção direta
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
      if (!quiet) attention(isDM ? m.author.display_name : `${m.author.display_name} em #${ch?.name}`);
      if (!quiet) notify(isDM ? m.author.display_name : `${m.author.display_name} (#${ch?.name})`, S.prefs.notifPreview === false ? 'Nova mensagem' : (inviteText(themeText(text)) || 'Anexo'), () => go(ch.guild_id || '@me', ch.id), m.channel_id);
    } else if (counts && !isDM && !quiet) playSound('message');
    renderRail(); renderSide(); updateTitle();
  } else ack(m.channel_id);
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
  if (mergeRemote(d.settings)) { prefsChanged(); if (voice) for (const uid of voice.peers.keys()) voice.applyVolume(uid); } // volumes mudados em outro aparelho
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
// página fechando (app fechado, aba fechada, F5): avisa o servidor que é saída de verdade (código 4000) e ele tira da
// sala na hora. Queda de rede não passa por aqui: o servidor segura a sala uns segundos esperando a volta (voice.resume)
addEventListener('pagehide', () => { if (voice?.channelId && ws?.readyState === 1) try { ws.close(4000, 'saindo'); } catch { } });
// ---- reputação: limite de envio aplicado pela comunidade ----
const softmuteUntil = (gid) => { const t = gid && member(gid, S.me.id)?.softmute_until; return t && t > Date.now() ? t : 0; };
export function renderSoftmute() {
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
