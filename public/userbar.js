// Barra do usuário e painel de voz: botões da chamada, voltar para a chamada, entrar na sala, troca rápida (Ctrl+K)
// e atalhos de teclado gerais.
import { openMyMessages } from './mymessages.js';
import { openFxPicker } from './fxui.js';
import { fxInfo } from './voicefx.js';
import { fxIcon } from './fxicons.js';
import { h, icon, avatar } from './util.js';
import { S, tryApi, user, guild, channelById, dmPeer, toast, modal, menu, savePrefs, focusOn, CH, chCan, CH_KINDS } from './state.js';
import { openMusic } from './music.js';
import { openSoundboard, quickSoundsHover } from './soundboard.js';
import { openAudioPanel, openStatusPanel, openMicPanel } from './quick.js';
import { chName } from './chnames.js';
import { pollModal } from './polls.js';
import { openIntentModal } from './intents.js';
import { track, startTimer, cancelTimer } from './ux.js';
import { NOISE_INFO } from './ui.js';
import { styleName } from './themes.js';
import { STATUS_TXT } from './card.js';
import { swapIcon } from './motion.js';
import { voice, ready, $, logout } from './gateway.js';
import { musicOn } from './botmusic.js';
import { openSettings, openFullProfile, go, ctxSettings } from './nav.js';
import { openMessages, friendsInServer } from './rail.js';
import { toggleGlobalSearch } from './gsearch.js';
import { renderSide } from './side.js';
import { setInboxTab, showInbox } from './inbox.js';
import { flushDraft } from './composer.js';
import { renderVoiceUI } from './stage.js';
import { startShare, stopSharing, mediaDevs, camOptItems, watchOnly, menuAbove, shareKeyHint, liveStrip } from './share.js';
import { pingEl } from './ping.js';
import { gameTick } from './desktopsetup.js';
let panelFor = 0;
export function voicePanel() {
  if (!voice?.active) return h('div.hidden');
  const ch = channelById(voice.channelId), g = guild(ch?.guild_id);
  const fresh = panelFor !== voice.joinedAt; panelFor = voice.joinedAt; // acabou de entrar: o painel sobe (.vp-in), nas outras vezes já está lá
  return h('div#voice-panel' + (fresh ? '.vp-in' : ''),
    h('div.t' + (voice.recovering ? '.recovering' : voice.hold ? '.onhold' : ''), h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, voice.recovering ? [h('span.vp-spin', { 'aria-hidden': 'true' }), 'Reconectando a voz…'] : voice.hold ? [icon('pause', 14), 'Em espera'] : [pingEl(), 'Voz conectada']),
      h('span.vp-btns', voiceBtn(),
        h('button.ibtn.vp-hold' + (voice.hold ? '.on' : ''), { title: voice.hold ? 'Voltar da espera (microfone e áudio voltam como estavam)' : 'Ficar em espera: desliga microfone e áudio sem sair da sala; os outros veem "Em espera"', 'aria-pressed': String(!!voice.hold), onclick: () => voice.setHold(!voice.hold) }, icon(voice.hold ? 'play' : 'pause', 20)),
        h('button.ibtn', { title: 'Sair da chamada', onclick: () => voice.leave() }, icon('phoneoff', 20)))),
    voice.screen && liveStrip(),
    h('div.sub', { title: 'Ir para a sala', onclick: () => ch && (ch.type === 1 ? go('@me', ch.id) : go(ch.guild_id, ch.id)) }, `${ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || '')}${g ? ' / ' + g.name : ''}`,
      fxInfo(voice.fx) && h('span.vp-fx', { title: 'Efeito de voz ligado' }, '·', fxIcon(voice.fx, 12), fxInfo(voice.fx).label)),
    h('div.row',
      h('button' + (voice.cam ? '.on' : ''), { title: 'Câmera (clique direito: escolher a câmera)', onclick: () => voiceAct(() => voice.toggleCam()), oncontextmenu: async (e) => { e.preventDefault(); const t = e.currentTarget; menuAbove(t, camOptItems(await mediaDevs())); } }, icon('video', 20)),
      voice.screen ? h('button.stopshare', { title: 'Parar transmissão' + shareKeyHint(), onclick: stopSharing }, icon('screenoff', 20)) : h('button', { title: 'Transmitir tela', onclick: startShare }, icon('screen', 20)),
      ch?.guild_id && h('button' + (musicOn() ? '.on' : ''), { title: 'Música: tocar no canal de voz', 'data-keepfloat': '', 'data-music-btn': '', onclick: (e) => openMusic(e.currentTarget, voice) }, icon('musicbot', 20)),
      sbButton()));
}
// Soundboard: último botão do painel; passar o mouse mostra os 6 sons mais usados, clicar abre a soundboard completa
function sbButton() {
  const full = (a) => openSoundboard(a, voice, { openSettings: (k) => openSettings(k, ctxSettings()) });
  const b = h('button.vp-sb', { title: voice.deafened ? 'Soundboard indisponível (ensurdecido)' : 'Soundboard', 'aria-label': 'Soundboard', disabled: voice.deafened, style: voice.deafened ? { opacity: .4, cursor: 'not-allowed' } : null, onclick: (e) => full(e.currentTarget) }, icon('soundboard', 20));
  quickSoundsHover(b, voice, full);
  return b;
}
// o que a transmissão precisa saber da fonte escolhida (jogo em tela cheia no Windows 10 vai pelo nativo: voice.js wantNative)
export const srcInfo = (src) => (src ? { id: src.id, name: src.name, type: src.type, game: !!src.game, fullscreen: !!src.fullscreen, minimized: !!src.minimized, screenId: src.screenId || null } : null);
export const voiceAct = (fn) => Promise.resolve().then(fn).catch(e => toast(e.message, true));
// botões "Experimentar" da janela de Novidades (public/changelog.js)
export const newsActions = {
  fx: () => { const b = document.querySelector('#voice-panel .vp-voice'); if (voice?.active && b) openVoiceFx(b); else toast('Entre numa sala de voz e clique no botão "Sua voz" do painel de voz (ou Ctrl+Shift+E).'); },
  gifs: () => { const b = $('#composer .gifbtn'); if (b) b.click(); else toast('Abra um chat e clique em GIF, ao lado do emoji.'); },
  clips: () => { const gid = S.view.gid && S.view.gid !== '@me' ? S.view.gid : [...S.guilds.keys()][0]; if (gid) go(gid, 'clips'); else toast('Entre num servidor para ver a galeria de clipes.'); },
  lfg: () => go('@me', 'lfg'),
  intent: () => openIntentModal(),
  clipsettings: () => openSettings('clips', ctxSettings()),
  messages: () => openMessages(),
  notifications: () => openSettings('notifications', ctxSettings()),
  accessibility: () => openSettings('accessibility', ctxSettings()),
  requests: () => { setInboxTab('requests'); showInbox(); },
  servers: () => { const g = [...S.guilds.values()][0]; if (g) friendsInServer(g); else toast('Entre num servidor para ver quais amigos estão nele.'); },
  privacy: () => openSettings('privacy', ctxSettings()),
  mymessages: () => openMyMessages(),
  sounds: () => openSettings('sounds', ctxSettings()),
  appearance: () => openSettings('appearance', ctxSettings()),
  storage: () => openSettings('storage', ctxSettings()),
  lite: () => openSettings('lite', ctxSettings()),
  extras: () => openSettings('extras', ctxSettings()),
  stream: () => openSettings('stream', ctxSettings()),
  voice: () => openSettings('voice', ctxSettings()),
  keys: () => openSettings('keys', ctxSettings()),
  poll: () => { const ch = channelById(S.view.cid); if (ch && $('#composer')) pollModal(ch); else toast('Abra um chat e use o + do campo de mensagem → "Criar enquete".'); },
  settings: () => openSettings('news', ctxSettings()),
  ping: () => { const b = $('#vp-ping'); if (b) b.click(); else toast('Entre numa sala de voz e clique no ícone de sinal do painel de voz.'); },
};
// botão de efeitos de voz (painel de voz e controles da sala): com efeito ligado mostra o ícone dele
// "Sua voz" (painel de voz): teste do microfone, ruído, eco e efeitos de voz num lugar só; colorido com efeito ligado
const openVoiceFx = (anchor) => openFxPicker(anchor, voice, { openSettings: (k) => openSettings(k, ctxSettings()) });
function voiceBtn() {
  const f = fxInfo(voice?.fx);
  return h('button.ibtn.vp-voice' + (f ? '.fxon' : ''), { title: (f ? `Sua voz — efeito: ${f.label}` : 'Sua voz: microfone, ruído, eco e efeitos') + ` · Redução de ruído: ${NOISE_INFO[S.prefs.noiseMode || 'standard']?.[0] || ''}`, 'aria-label': 'Sua voz',
    onclick: (e) => { const a = e.currentTarget; openMicPanel(a, voice, { openSettings: (k) => openSettings(k, ctxSettings()), fx: { info: fxInfo(voice?.fx), icon: (id, n) => fxIcon(id, n), open: () => openVoiceFx(a) } }); } },
    f ? fxIcon(f.id, 20) : icon('waves', 20));
}
export function fxButton(size, round, cls = '') {
  const f = fxInfo(voice?.fx);
  return h('button' + (round ? '.roundbtn' : '') + (f ? '.fxon' : '') + cls, { title: f ? `Efeito de voz: ${f.label} (clique para trocar)` : 'Efeitos de voz', onclick: (e) => openFxPicker(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) },
    f ? fxIcon(f.id, size) : icon('mask', size));
}
export function fxHotkey() {
  if (!voice?.active) return toast('Entre numa sala de voz para usar efeitos.', true);
  const next = voice.fx ? null : (S.prefs.lastFx || 'robo'); voice.setFx(next); savePrefs();
  toast(next ? `Efeito de voz: ${fxInfo(next).label}` : 'Efeito de voz desligado');
}
// botão "Assistir" do feed: entra na sala (se preciso) e abre a transmissão da pessoa em destaque
export function watchFriend(uid, ch) {
  const g = ch.type === 1 ? null : guild(ch.guild_id);
  go(g ? g.id : '@me', ch.id);
  if (voice.channelId === ch.id) { watchOnly(uid); renderVoiceUI(); return; }
  S.autoWatch = { uid, exp: Date.now() + 20000 };
  joinVoice(ch.id);
}
// ---------- voltar para a chamada ----------
// A sala da chamada atual fica guardada (lc_lastcall, com mudo/ensurdecido). Ao recarregar a página, fechar o app ou cair
// a conexão (o servidor avisa reason 'drop'), o painel de voz vira "Você saiu da chamada · Reconectar" por 5 minutos.
// Sair pelo botão, trocar de sala ou entrar por outro aparelho apaga a lembrança: aí não há o que oferecer.
const LASTCALL = 'lc_lastcall', REJOIN_MS = 5 * 60 * 1000;
let lastCallCid = null, callDropped = false, lastCallBeat = 0, rejoinT = 0;
export const setCallDropped = (on) => { callDropped = on; }; // a chamada caiu (o servidor avisa no VOICE_STATE): oferece voltar
const saveLastCall = () => { if (!voice?.channelId) return; try { localStorage.setItem(LASTCALL, JSON.stringify({ cid: voice.channelId, at: Date.now(), muted: !!voice.muted, deaf: !!voice.deafened })); } catch { } };
const forgetLastCall = () => { try { localStorage.removeItem(LASTCALL); } catch { } };
export function trackLastCall() {
  const cid = voice?.channelId;
  if (cid) {
    if (cid !== lastCallCid) { lastCallCid = cid; callDropped = false; if (S.rejoin) { S.rejoin = null; clearTimeout(rejoinT); } }
    saveLastCall();
    if (!lastCallBeat) lastCallBeat = setInterval(saveLastCall, 20000); // app morto sem pagehide (travou, fechado pelo sistema)
    return;
  }
  if (voice?._joinTo || !lastCallCid) return; // entrando de novo (rejoin) ou nunca esteve numa chamada
  clearInterval(lastCallBeat); lastCallBeat = 0;
  const was = lastCallCid; lastCallCid = null;
  if (callDropped) { callDropped = false; offerRejoin(was); } else forgetLastCall();
}
addEventListener('pagehide', saveLastCall, { capture: true }); // F5 / fechar: o "agora" da saída
function readLastCall() { try { return JSON.parse(localStorage.getItem(LASTCALL) || 'null'); } catch { return null; } }
export function checkRejoinOnLoad() {
  // recarregou sozinha para a versão nova da interface no meio desta chamada (public/uiupdate.js): volta direto
  let auto = null; try { auto = JSON.parse(localStorage.getItem('lc_uireload') || 'null'); localStorage.removeItem('lc_uireload'); } catch { }
  const r = readLastCall(); if (!r?.cid) return;
  if (Date.now() - r.at > REJOIN_MS || !channelById(r.cid)) return forgetLastCall();
  if (S.voice.get(S.me.id)?.channel_id) return; // já está numa chamada por outra aba ou aparelho
  offerRejoin(r.cid, r, true);
  if (auto?.cid === r.cid && Date.now() - auto.at < 2 * 60e3) rejoinNow();
}
function offerRejoin(cid, r = readLastCall(), quiet) {
  if (!channelById(cid)) return;
  S.rejoin = { cid, muted: r?.cid === cid && !!r.muted, deaf: r?.cid === cid && !!r.deaf };
  clearTimeout(rejoinT); rejoinT = setTimeout(dismissRejoin, Math.max(5000, REJOIN_MS - (Date.now() - (r?.cid === cid ? r.at : Date.now()))));
  if (!quiet) { renderSide(); toast('Você caiu da chamada. Clique em Reconectar para voltar.'); }
}
function dismissRejoin() { clearTimeout(rejoinT); if (!S.rejoin) return; S.rejoin = null; forgetLastCall(); renderSide(); }
function rejoinNow() {
  const r = S.rejoin; if (!r) return;
  S.rejoin = null; clearTimeout(rejoinT);
  if (!voice.active) { voice.muted = r.muted; voice.deafened = r.deaf; } // volta como estava (mudo/ensurdecido)
  joinVoice(r.cid); renderSide();
}
export function rejoinPanel() {
  const ch = channelById(S.rejoin.cid), g = guild(ch?.guild_id);
  const name = ch?.type === 1 ? 'Chamada com ' + (user(dmPeer(ch)?.id)?.display_name || '') : (ch?.name || 'Sala');
  return h('div#voice-panel.rejoin',
    h('div.t', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon('phoneoff', 16), 'Você saiu da chamada'),
      h('span.vp-btns', h('button.ibtn', { title: 'Dispensar', 'aria-label': 'Dispensar', onclick: dismissRejoin }, icon('x', 18)))),
    h('div.sub', `${name}${g ? ' / ' + g.name : ''}`),
    h('button.btn.green.rj-go', { onclick: rejoinNow }, icon('phone', 16), 'Reconectar'));
}
export function joinVoice(cid) {
  if (voice.channelId === cid) return;
  { const c = channelById(cid); if (c?.guild_id && !chCan(c, CH.CONNECT)) return toast('Você não tem permissão para entrar nesta sala de voz', true); }
  // o "Entrar" do topo some já no clique (antes ficava ~100 ms a mais, até a sala responder, e piscava). Se a entrada
  // falhar, o palco redesenhado (stage.js) mostra de novo
  document.querySelector('.vc-join-top')?.classList.add('hidden');
  startTimer('voice_connect', cid); // telemetria: para quando o áudio conecta (voice.js) ou quando a sala aceita sem servidor de mídia
  voice.join(cid).then(() => { if (voice.error) { track('voice_fail', 'join_error'); cancelTimer('voice_connect'); toast(voice.error, true); voice.error = null; } else setTimeout(() => gameTick?.(), 1500); }); // jogo já aberto: oferece transmitir logo
}
// barra de perfil: o avatar fica na barra dos servidores (bolinha de status embaixo, vermelha em cima se o microfone ou o
// som estiver desligado) e a barra com nome, microfone, fone e configurações sai dele. Com a lista de canais visível a
// barra fica sempre aberta; com a lista oculta, abre ao passar o mouse no avatar
let pbHoldUntil = 0, pbHoldT = 0;
export function userbar() {
  const me = S.me, ctx = () => ({ voice, logout, go });
  const status = () => openStatusPanel((!$('#app.hide-side') && $('#userbar .me')) || $('.pb-av'), { openSettings: (k) => openSettings(k, ctx()), openFullProfile, logout });
  const off = voice?.muted || voice?.deafened;
  const av = h('button.pb-av', { type: 'button', 'aria-label': 'Status e perfil', title: `${me.display_name} — ${me.custom_status || STATUS_TXT[me.status]}`,
    onclick: () => status(),
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
    h('button.ibtn.pb-gear', { title: 'Configurações do usuário', onclick: () => openSettings('account', ctx()) }, icon('gear')));
  const bar = h('div.pbar.pinned' + (Date.now() < pbHoldUntil ? '.hov' : ''), av, body);
  // a barra solta continua aberta 0,5 s depois que o mouse sai (dá para voltar sem ela sumir); sobrevive a redesenhos
  bar.addEventListener('mouseenter', () => { clearTimeout(pbHoldT); pbHoldUntil = Infinity; bar.classList.add('hov'); });
  bar.addEventListener('mouseleave', () => { clearTimeout(pbHoldT); pbHoldUntil = Date.now() + 500; pbHoldT = setTimeout(() => { pbHoldUntil = 0; document.querySelectorAll('.pbar.hov').forEach(b => b.classList.remove('hov')); }, 500); });
  return bar;
}
export function voiceToggle(k) { k === 'mute' ? voice.toggleMute() : voice.toggleDeaf(); }
function statusMenu(e) {
  const set = (status) => status !== S.me?.status && tryApi('PATCH', '/me', { status }); // o atual: nada
  menu(e, ['online', 'idle', 'dnd', 'invisible'].map(s => ({ label: STATUS_TXT[s], fn: () => set(s) })));
}

// ---------- quick switcher ----------
function quickSwitch() {
  const inp = h('input', { placeholder: 'Para onde você quer ir?', style: { width: '100%' } }), res = h('div');
  const items = [...[...S.dms.values()].map(d => ({ label: '@' + user(dmPeer(d).id).display_name, fn: () => go('@me', d.id) })),
    ...[...S.guilds.values()].flatMap(g => g.channels.filter(c => c.type !== 4).map(c => ({ label: chName(c), ic: CH_KINDS[c.type]?.[0] || 'hash', alt: c.name, hint: g.name, fn: () => go(g.id, c.id) }))),
    ...[...S.guilds.values()].map(g => ({ label: g.name, hint: 'servidor', fn: () => go(g.id) }))];
  const m = modal('Busca rápida', '', h('div', h('label.f', inp), res), [], {});
  const draw = () => { res.replaceChildren(...items.filter(i => (i.label + ' ' + (i.alt || '')).toLowerCase().includes(inp.value.toLowerCase())).slice(0, 10).map(i => h('div.role-row', { onclick: () => { m.close(); i.fn(); } }, i.ic && icon(i.ic, 18), i.label, h('small', { style: { marginLeft: 'auto', color: 'var(--text-muted)' } }, i.hint || '')))); };
  inp.oninput = draw; draw();
  inp.onkeydown = (e) => { if (e.key === 'Enter') res.firstChild?.click(); };
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && ready) { e.preventDefault(); quickSwitch(); } });
// Esc numa conversa direta volta para Amigos (como no WhatsApp Web). Só quando o Esc não tem outra coisa para fazer:
// a situação é lida ANTES dos outros ouvintes (captura na window), senão o Esc que fecha um menu ou cancela a resposta
// também sairia da conversa
let escBusy = false;
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = e.target, typingElsewhere = (/^(INPUT|SELECT)$/.test(t?.tagName) || (t?.tagName === 'TEXTAREA' && !t.closest('#composer')) || t?.isContentEditable);
  escBusy = !!(typingElsewhere || S.replyTo || S.editing || S.searchOpen || document.fullscreenElement
    || document.querySelector('.backdrop:not(.leaving), #lightbox, #settings, #tedit, .ac, .capturing, .menu:not(.leaving), .popout:not(.static):not(.leaving), .emoji-picker:not(.leaving)'));
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || escBusy || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (!ready || S.view.kind !== 'dm') return;
  flushDraft(); track('back_to_friends', 'esc'); go('@me'); // o rascunho fica guardado para a volta
});
// Ctrl+Shift+F: busca em tudo (DMs e servidores)
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && ready) { e.preventDefault(); if (!S.searchOpen) toggleGlobalSearch(); else $('#gs-q')?.focus(); } });
