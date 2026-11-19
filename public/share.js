// Transmissão de tela: iniciar, opções avançadas, "Você está ao vivo", atalho, oferta de transmitir o jogo,
// controles do quadro e diagnóstico da captura.
import { h, icon } from './util.js';
import { S, user, channelById, nameOf, dmPeer, toast, modal, menu, desktop, savePrefs, setDevice } from './state.js';
import { CAPTURE_METHODS, captureMode } from './voice.js';
import { popOut } from './livepip.js';
import { clipping, saveClip, clipSecs, lenLabel } from './clips.js';
import { controlling as remoteControlling, pendingFor as remotePending, requestControl, stopControl } from './remote.js';
import { yieldStage } from './watch.js';
import { seg, toggle as uiToggle, qualityPanel, comboLabel, hotkey, NOISE_INFO } from './ui.js';
import { voice } from './gateway.js';
import { openSettings, go, ctxSettings } from './nav.js';
import { srcInfo, voiceAct } from './userbar.js';
import { isLocalMuted, toggleLocalMute } from './usermenu.js';
import { fullscreenStream, pollQstats, renderVoiceUI, clipCtx, clipCaptured, clipFlash, clipMenu } from './stage.js';
// mesmos nomes dos cartões de Configurações (Sem filtro / Leve / Forte / Máxima)
const NOISE_OPTS = () => Object.entries(NOISE_INFO).map(([k, [n, d]]) => [k, `${n} — ${d}`]);
export function noiseMenu(e) {
  const cur = S.prefs.noiseMode;
  menu(e, NOISE_OPTS().map(([k, l]) => ({ label: 'Ruído: ' + l, radio: cur === k, fn: async () => { if ((cur || 'standard') === k) return; S.prefs.noiseMode = k; savePrefs(); await voice.rebuildMic(); toast('Redução de ruído: ' + l); } })));
}
// método de captura (Beta): rótulos curtos no seletor; o nome completo fica na dica
const CAP_SHORT = { auto: 'Auto', wgc: 'WGC', dxgi: 'DXGI', chromium: 'Chromium', classic: 'Clássico' };
const capMethodOpt = (after) => h('div.ss-opt', { title: 'Automático escolhe sozinho; Clássico = a versão anterior' }, h('div.ss-lbl', 'Método de captura', h('small.beta-tag', 'Beta')),
  seg(Object.keys(CAPTURE_METHODS).map(k => [k, CAP_SHORT[k]]), captureMode(S.prefs), (v) => { S.prefs.captureMethod = v; savePrefs(); after(); }));
// swap: "Alterar janela" durante a transmissão: escolhe a nova fonte primeiro; a troca (parar + começar) só acontece no
// clique em Trocar, e quem assiste continua com ela aberta (ver autoClosed)
export async function startShare({ swap = false } = {}) {
  if (voice.screen && !swap) return liveShareModal();
  if (!voice.active) return toast('Entre em uma sala de voz primeiro.', true);
  if (voice.noVideo) return toast('Você não tem permissão de vídeo nesta sala: a transmissão de tela está bloqueada.', true);
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, cursor: true, ...S.prefs.screen };
  let src = null, list = [], tab = 'screen', timer, loaded = false, touched = false;
  // áudio: 'game' = só o programa (o jogo), 'system' = tudo do PC menos a Resenha, 'none'
  let audMode = o.audio === false ? 'none' : (o.audioMode === 'system' ? 'system' : 'game'), appCap = { ok: false };
  // tela inteira (ainda mais com vários monitores) = o som de tudo do PC, como no Discord; "só o jogo" ali só se a pessoa escolher
  // de novo nesta transmissão. Antes a preferência 'game' (salva numa transmissão de janela) pegava o primeiro jogo aberto em
  // QUALQUER monitor e a tela ia só com o som dele — os programas do outro monitor ficavam mudos.
  let audGamePicked = false;
  // tela inteira com o app novo: "Só desta tela" (os programas com janela neste monitor; o outro monitor não vaza), escolha
  // guardada à parte (S.prefs.screen.screenAudio: 'screen' | 'system')
  const scrCap = () => !!(appCap.ok && appCap.screen && desktop?.appAudioScreen);
  let scrMode = S.prefs.screen?.screenAudio === 'system' ? 'system' : 'screen';
  const audEff = () => {
    if (src?.type === 'screen' && audMode !== 'none' && scrCap() && !audGamePicked) return scrMode;
    return audMode === 'game' && src?.type === 'screen' && !audGamePicked ? 'system' : audMode;
  };
  const tabs = h('div.seg'), grid = h('div.sources'), audRow = h('div');
  // de quem é o áudio "só o jogo": a janela escolhida; na tela inteira, o jogo aberto (detectado pelo app)
  const audTarget = () => (src?.type === 'window' ? (src.pid ? src : null) : list.find(s => s.type === 'window' && s.game && s.pid) || null);
  const drawAudio = () => {
    if (!desktop || !appCap.ok) { // navegador / Windows antigo: só o áudio do sistema (como antes)
      return audRow.replaceChildren(h('label.f', 'Áudio', seg({ system: 'Áudio do sistema', none: 'Sem áudio' }, audMode === 'none' ? 'none' : 'system', v => { audMode = v; })));
    }
    const t = audTarget(), opts = {}, isScr = src?.type === 'screen' && scrCap();
    if (isScr) opts.screen = 'Só desta tela';
    if (t && !isScr) opts.game = `Só ${src?.type === 'window' ? 'este programa' : 'o jogo'}: ${t.name.length > 34 ? t.name.slice(0, 33) + '…' : t.name}`;
    opts.system = 'Tudo do PC'; opts.none = 'Sem áudio';
    const mode = audEff() === 'game' && !t ? 'system' : audEff();
    audRow.replaceChildren(h('label.f', 'Áudio', seg(opts, mode, v => {
      if (v === 'screen' || (isScr && v === 'system')) { scrMode = v; audMode = audMode === 'none' ? 'game' : audMode; audGamePicked = false; }
      else { audMode = v; if (v === 'game') audGamePicked = true; }
      drawAudio();
    })));
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
  // duas etapas no mesmo modal: escolher a tela/janela (grade) e depois um card compacto com a fonte, o canal, a qualidade,
  // o áudio e os clipes. Clicar numa fonte já leva à configuração; "Trocar" volta para a grade.
  let step = desktop ? 'pick' : 'cfg', m = null;
  const chName = () => { const ch = channelById(voice.channelId); return ch?.type === 1 ? 'Chamada com ' + user(dmPeer(ch).id).display_name : (ch?.name || 'Sala de voz'); };
  const srcRow = h('div.ss-row.ss-src');
  const drawSrc = () => srcRow.replaceChildren(
    src?.thumbnail ? h('img.ss-thumb', { src: src.thumbnail, alt: '' }) : h('span.ss-ic', src?.appIcon ? h('img', { src: src.appIcon, alt: '' }) : icon('screen', 20)),
    h('span.ss-name', src ? src.name : desktop ? 'Nada escolhido' : 'Você escolhe ao clicar em Transmitir'),
    src?.game && h('span.ss-tag', 'JOGO'),
    desktop && h('button.btn.sm.grey', { type: 'button', onclick: () => go_('pick') }, 'Trocar'));
  const clipRow = h('div.ss-card.ss-clip',
    h('div.ss-clipt', h('b', 'Gravar clipes', clipKeyLabel() && h('kbd.ss-key', { title: 'Atalho para salvar um clipe' }, clipKeyLabel())), h('small', 'Últimos 60 s')),
    uiToggle(S.prefs.clipsOn === true, (v) => { S.prefs.clipsOn = v; savePrefs(); }));
  const capPick = window.lcDesktop?.nativeCapable ? capMethodOpt(() => { }) : null;
  const cfg = h('div.ss-cfg',
    h('div.ss-lbl', 'O que você vai transmitir'), srcRow,
    h('div.ss-lbl', 'Canal da transmissão'), h('div.ss-row', h('span.ss-ic', icon('vol', 20)), h('span.ss-name', chName())),
    h('div.ss-lbl', 'Qualidade da transmissão'), h('div.ss-card', qualityPanel(o, null, { extra: () => [h('div.ss-opt', h('div.ss-lbl', 'Cursor do mouse'), seg([[1, 'Mostrar'], [0, 'Ocultar']], o.cursor === false ? 0 : 1, v => (o.cursor = !!+v))), capPick] })),
    h('div.ss-lbl', 'Áudio'), h('div.ss-aud', audRow),
    h('div.ss-lbl', 'Clipes'), clipRow,
    !desktop && h('div.qinfo', 'A tela é escolhida no navegador ao clicar em Transmitir.'));
  const pick = desktop ? h('div.ss-pick', tabs, grid, h('div.qinfo', 'Jogo em tela cheia aparece em "Janelas", mesmo minimizado.')) : null;
  const go_ = (st) => {
    step = st;
    if (pick) pick.hidden = st !== 'pick';
    cfg.hidden = st !== 'cfg';
    backBtn.hidden = st !== 'cfg' || !desktop; nextBtn.hidden = st !== 'pick'; goBtn.hidden = st !== 'cfg';
    if (st === 'cfg') drawSrc();
    const md = m?.el.querySelector('.modal'); if (md) md.style.width = st === 'pick' ? '780px' : '560px';
  };
  const cancel = () => { clearInterval(timer); m?.close(); };
  const goLive = async () => {
    if (desktop) { if (!src) { toast('Selecione uma tela ou janela', true); go_('pick'); return; } await desktop.selectSource(src.id, src.name); }
    clearInterval(timer);
    const t = audTarget(), mode = audEff() === 'game' && !(appCap.ok && t) ? 'system' : audEff();
    o.audio = mode !== 'none';
    const appAudio = !appCap.ok || mode === 'none' ? null : mode === 'game' ? { mode: 'include', pid: t.pid, name: t.name } : mode === 'screen' ? { mode: 'screen', source: src.id } : { mode: 'exclude' };
    // 'system'/'screen' só porque era uma tela não muda a preferência das transmissões de janela/jogo
    const keep = mode === 'none' || mode === 'screen' || (mode !== audMode && src?.type === 'screen');
    const screenAudio = src?.type === 'screen' && scrCap() && (mode === 'screen' || mode === 'system') ? mode : (S.prefs.screen?.screenAudio || 'screen');
    S.prefs.screen = { res: o.res, fps: o.fps, hint: o.hint, audio: o.audio, audioMode: keep ? (S.prefs.screen?.audioMode || 'game') : mode, screenAudio, cursor: o.cursor !== false, bitrate: o.bitrate || 0 }; savePrefs();
    m?.close();
    voiceAct(async () => { if (voice.screen) await voice.toggleScreen(); await voice.toggleScreen({ ...o, appAudio, srcInfo: srcInfo(src) }); });
  };
  const backBtn = h('button.btn.grey', { type: 'button', onclick: () => go_('pick') }, 'Voltar');
  const nextBtn = h('button.btn', { type: 'button', onclick: () => { if (!src) return toast('Selecione uma tela ou janela', true); go_('cfg'); } }, 'Continuar');
  const goBtn = h('button.btn.green', { type: 'button', onclick: goLive }, icon(swap ? 'refresh' : 'live', 16), swap ? 'Trocar' : 'Transmitir');
  const foot = h('div.ss-foot', h('button.btn.link', { type: 'button', onclick: cancel }, 'Cancelar'), h('span.ss-sp'), backBtn, nextBtn, goBtn);
  const body = h('div.ss', pick, cfg, foot);
  // clicar numa fonte escolhe e já vai para a configuração (como os outros apps de chamada)
  grid.addEventListener('click', (e) => { if (e.target.closest('.source')) setTimeout(() => go_('cfg'), 0); });
  drawAudio();
  if (desktop) {
    drawSources(); refresh().then(() => { if (step === 'pick' && src?.game && !touched) go_('cfg'); });
    timer = setInterval(() => { if (!document.body.contains(body)) return clearInterval(timer); refresh().then(() => { if (step === 'cfg') drawSrc(); }); }, 3000);
    desktop.appAudioCapable?.().then(r => { appCap = r || { ok: false }; drawAudio(); }).catch(() => { });
  }
  m = modal(swap ? 'Alterar janela' : 'Transmitir tela', '', body, [], { width: desktop ? '780px' : '560px' });
  m.el.querySelector('.modal')?.classList.add('ss-modal');
  go_(step);
}

// durante a transmissão: mudar qualidade ao vivo, trocar fonte, parar
export const pipCtx = {
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
export function stopSharing() { if (voice.screen) voice.toggleScreen(); }
// ---------- opções avançadas durante a chamada (seta ao lado dos botões, como no Discord) ----------
// Tudo o que antes exigia sair da sala para as Configurações: qual câmera, qualidade/fonte da transmissão, microfone e saída
// de áudio, e quais transmissões parar de assistir. Cada parte também abre sozinha no clique direito do botão dela.
export async function mediaDevs() { return (await navigator.mediaDevices?.enumerateDevices?.().catch(() => null)) || []; }
const devRadios = (ds, kind, key, after) => [{ deviceId: '', label: 'Padrão do sistema' }, ...ds.filter(d => d.kind === kind && !/^(default|communications)$/.test(d.deviceId))]
  .map((d, i) => ({ label: d.label || `Dispositivo ${i}`, radio: (S.prefs[key] || '') === d.deviceId, fn: () => { if ((S.prefs[key] || '') === d.deviceId) return; setDevice(key, d.deviceId, d.label); after?.(d); } }));
// inverter (espelhar) a imagem da câmera: quem recebe aplica o espelho (VOICE_STATE.mirror), então vale para todos sem
// reprocessar o vídeo; a sua prévia mostra exatamente o que os outros veem
function setCamMirror(on) { S.prefs.camMirror = !!on; savePrefs(); voice?.sendState(); renderVoiceUI(); }
export function camOptItems(ds) {
  const cams = devRadios(ds, 'videoinput', 'videoId', () => voiceAct(async () => { await voice.switchCam(); if (voice.cam) toast('Câmera trocada'); }));
  return [
    { label: voice.cam ? 'Desligar câmera' : 'Ligar câmera', icon: 'video', fn: () => voiceAct(() => voice.toggleCam()) },
    { label: 'Inverter a imagem', hint: 'Espelhada para todos na chamada', checked: !!S.prefs.camMirror, fn: () => setCamMirror(!S.prefs.camMirror) },
    '-', ...(cams.length > 1 ? cams : [{ label: 'Nenhuma câmera encontrada', fn: () => { } }]),
    '-', { label: 'Configurações de vídeo', icon: 'sliders', fn: () => openSettings('voice', ctxSettings()) },
  ];
}
const OPT_RES = [[720, '720p'], [1080, '1080p'], [1440, '1440p'], ['source', 'Original']];
async function setShareQuality(n) {
  await voice.changeScreenQuality(n);
  const o = voice.screenOpts || {}; S.prefs.screen = { ...S.prefs.screen, res: o.res, fps: o.fps }; savePrefs();
}
export function screenOptItems() {
  if (!voice.screen) return [{ label: 'Transmitir tela', icon: 'screen', fn: startShare }];
  const o = voice.screenOpts || {}, fps = [15, 30, 60, ...(S.nativeOk ? [120] : [])];
  return [
    { label: 'Qualidade da transmissão', icon: 'sliders', sub: [
      { label: 'Resolução', sub: OPT_RES.map(([v, l]) => ({ label: l, radio: String(o.res) === String(v), fn: () => voiceAct(() => setShareQuality({ res: v })) })) },
      { label: 'Quadros por segundo', sub: fps.map(v => ({ label: v + ' FPS', radio: +o.fps === v, fn: () => voiceAct(() => setShareQuality({ fps: v })) })) },
      '-', { label: 'Mais ajustes…', hint: 'Taxa de dados, tipo de conteúdo, captura', fn: liveShareModal },
    ] },
    { label: 'Alterar janela', icon: 'refresh', hint: 'Escolher outra tela ou janela', fn: () => startShare({ swap: true }) },
    '-', { label: 'Parar transmissão', icon: 'screenoff', danger: true, fn: stopSharing },
  ];
}
// transmissões abertas agora (as que estou assistindo) nesta sala
function watchedStreams() {
  return [...S.voice.values()].filter(v => v.channel_id === voice.channelId && v.screen && v.user_id !== S.me.id && !voice.closedStreams.has(v.user_id));
}
// "Assistir" (não o olho do multistream): fica só com esta transmissão — fecha as outras que estavam abertas e põe esta em destaque
export function watchOnly(uid) {
  for (const v of watchedStreams()) if (v.user_id !== uid) { voice.closeStream(v.user_id); if (S.focus === 's:' + v.user_id) S.focus = null; }
  voice.openStream(uid); S.focus = 's:' + uid;
  yieldStage(); // Watch Together aberto cobria o palco: vira mini player para a transmissão aparecer
}
function stopWatching(uids) { for (const u of uids) { voice.closeStream(u); if (S.focus === 's:' + u) S.focus = null; } renderVoiceUI(); }
export function watchOptItems() {
  const ws = watchedStreams(), ch = channelById(voice.channelId), nm = (u) => (ch?.type === 1 ? user(u).display_name : nameOf(u, ch?.guild_id));
  if (!ws.length) return [];
  return [{ label: 'Parar de assistir', icon: 'eyeoff', sub: [
    ...ws.map(v => ({ label: nm(v.user_id), fn: () => stopWatching([v.user_id]) })),
    ws.length > 1 && '-', ws.length > 1 && { label: 'Todas as transmissões', danger: true, fn: () => stopWatching(ws.map(v => v.user_id)) },
  ] }];
}
// clique direito num botão da barra abre só a parte dele das opções da chamada
export const ctxOpts = (el, items) => { el.oncontextmenu = async (e) => { e.preventDefault(); menuAbove(el, await items()); }; return el; };
// abre um menu ancorado acima do botão (a barra fica no rodapé do palco)
export function menuAbove(btn, items) {
  const r = btn.getBoundingClientRect();
  menu({ preventDefault() { }, clientX: r.left, clientY: r.top, target: btn, currentTarget: btn }, items);
  const m = [...document.querySelectorAll('.menu[data-depth="0"]:not(.leaving)')].pop();
  m?.classList.add('callopts'); // a barra da chamada fica à vista enquanto o menu está aberto (ux.css)
  if (m) m.style.top = Math.max(8, r.top - m.getBoundingClientRect().height - 8) + 'px';
}
// ---------- "Você está ao vivo" ----------
// Relato do 1º teste: o "Parar transmissão" era difícil de achar (vermelho igual ao "Sair da chamada", ao lado dele, e no
// palco os controles da transmissão somem com o mouse parado). Agora: faixa fixa "AO VIVO" no painel de voz (aparece em
// qualquer tela do app, mesmo fora da sala), com tempo, quem está assistindo e o botão Parar; e no palco o botão vira um
// selo "● AO VIVO 12:34 | Parar transmissão", separado do Sair da chamada. O Sair continua só saindo (encerra junto).
let liveSince = 0, liveTimer = 0;
const liveClock = () => { if (!liveSince) return '0:00'; const s = Math.floor((Date.now() - liveSince) / 1000), p = (n) => String(n).padStart(2, '0'); return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };
export const shareKeyHint = () => (shareKey() ? ` (${comboLabel(shareKey())})` : '');
export function syncLive() {
  if (voice?.screen && !liveSince) liveSince = Date.now();
  if (!voice?.screen) liveSince = 0;
  if (liveSince && !liveTimer) liveTimer = setInterval(() => { if (!voice?.screen) { clearInterval(liveTimer); liveTimer = 0; liveSince = 0; return; } const t = liveClock(); for (const el of document.querySelectorAll('.live-t')) el.textContent = t; }, 1000);
}
export function liveStrip() {
  syncLive();
  const watching = (S.viewers.get(S.me.id) || []).filter(id => id !== S.me.id);
  const names = watching.map(id => nameOf(id, channelById(voice.channelId)?.guild_id)).join(', ');
  return h('div.vp-live', { title: watching.length ? 'Assistindo: ' + names : 'Ninguém assistindo ainda' },
    h('i.live-dot'), h('b', 'AO VIVO'), h('span.live-t', liveClock()),
    h('span.vp-live-w', icon('eye', 14), String(watching.length)),
    h('button.vp-live-stop', { title: 'Parar transmissão' + shareKeyHint() + ' — você continua na chamada', onclick: stopSharing }, icon('screenoff', 14), h('span', 'Parar')));
}
// ---------- atalho da transmissão (padrão Ctrl+Shift+S) ----------
// Liga/desliga a transmissão na hora, sem abrir o seletor: transmite o que está em primeiro plano (a janela atual, jogo em
// janela ou em tela cheia; a área de trabalho na frente = a tela) com as últimas escolhas de qualidade e áudio da pessoa.
// Um aviso rápido (como o do clipe) confirma que ligou/desligou — por cima do jogo quando a Resenha está em segundo plano.
export const shareKey = () => hotkey('keyShare');
let shareBusy = false;
export async function shareHotkey() {
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
// best: as melhores configurações automáticas para jogo (sugestão de jogo): 60 fps, movimento, taxa automática, 1440p se o
// monitor tiver essa altura (senão 1080p) e só o som do jogo. Não mexe nas preferências salvas da pessoa.
const bestGameShare = () => ({ res: Math.round((screen.height || 1080) * (devicePixelRatio || 1)) >= 1440 ? 1440 : 1080, fps: 60, hint: 'motion', bitrate: 0, audio: true, audioMode: 'game', screenAudio: 'screen' });
async function quickShare(src, { best = false } = {}) {
  hideGameOffer();
  if (desktop && !src) { clipFlash(false, 'Transmissão não iniciada', 'Nada para transmitir', 'share'); return; }
  const o = { res: 1080, fps: 30, hint: 'motion', audio: true, cursor: true, ...S.prefs.screen, ...(best ? bestGameShare() : {}) };
  const mode = o.audio === false ? 'none' : o.audioMode === 'system' ? 'system' : 'game';
  o.audio = mode !== 'none';
  let appAudio = null;
  const cap = src && o.audio ? await desktop.appAudioCapable?.().catch(() => null) : null;
  if (cap?.ok) // 'game' = só o programa da frente; na tela inteira, só os programas daquela tela (app novo) ou tudo menos a Resenha
    appAudio = mode === 'game' && src.pid ? { mode: 'include', pid: src.pid, name: src.name }
      : src.type === 'screen' && cap.screen && desktop.appAudioScreen && o.screenAudio !== 'system' ? { mode: 'screen', source: src.id } : { mode: 'exclude' };
  if (src && !(await desktop.selectSource(src.id, src.name).catch(() => false))) { clipFlash(false, 'Transmissão não iniciada', null, 'share'); return; }
  await voiceAct(() => voice.toggleScreen({ ...o, appAudio, srcInfo: srcInfo(src) }));
  if (voice.screen) clipFlash(true, 'Transmitindo', src?.name, 'share');
  else clipFlash(false, 'Transmissão não iniciada', null, 'share');
}
// jogo aberto na chamada e sem transmitir: oferece transmitir o jogo (uma vez por jogo em cada sala)
const offeredGames = new Set();
export function hideGameOffer() { document.getElementById('gameoffer')?.remove(); }
export function offerGameShare(g) {
  if (!g || !voice?.active || voice.screen) return hideGameOffer();
  if (S.prefs.gameShareOffer === false || offeredGames.has(voice.channelId + ':' + g.id)) return;
  offeredGames.add(voice.channelId + ':' + g.id); hideGameOffer();
  const key = comboLabel(shareKey());
  const el = h('div#gameoffer', { role: 'dialog', 'aria-label': 'Transmitir o jogo' },
    g.icon ? h('img.go-ic', { src: String(g.icon).startsWith('data:') ? g.icon : 'data:image/png;base64,' + g.icon, alt: '' }) : h('div.go-ic.ph', icon('gamepad', 22)),
    h('div.go-txt', h('b', `Jogando ${g.title}?`), h('small', 'Transmita o jogo para a sala com a melhor qualidade automática.' + (shareKey() ? ` Atalho: ${key}` : ''))),
    h('div.go-acts',
      h('button.btn.green', { type: 'button', onclick: async () => { const s = await findGameSource(g); s ? quickShare(s, { best: true }) : (hideGameOffer(), startShare()); } }, icon('screen', 16), 'Transmitir'),
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
export function healthPill() {
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
// opções de uma transmissão: as mesmas no botão "Mais opções" e no clique direito no vídeo (antes o clique direito só
// tinha o volume — 47 de 48 vezes o menu foi fechado sem uso no 1º teste: as pessoas procuravam as opções ali)
export function streamItems({ key, uid, mine, scr, inRoom, who }, e) {
  const on = remoteControlling(uid), wait = remotePending(uid), sMuted = voice.streamVolumes[uid] === 0;
  return [
      // opções do participante (como no Discord): parar de assistir, silenciar o som da transmissão ou a voz da pessoa
      !mine && inRoom && { ux: 'pararassistir', icon: 'eyeoff', label: 'Parar de assistir', hint: 'Você continua na chamada', fn: () => { voice.closeStream(uid); if (S.focus === key) S.focus = null; renderVoiceUI(); } },
      !mine && inRoom && { ux: 'mudotransm', icon: sMuted ? 'vol' : 'volmute', label: sMuted ? 'Ativar som da transmissão' : 'Silenciar transmissão', fn: () => { if (sMuted) voice.setStreamVolume(uid, S.prefs.streamVolPrev?.[uid] || 100); else { (S.prefs.streamVolPrev ||= {})[uid] = voice.streamVolumes[uid] ?? 100; voice.setStreamVolume(uid, 0); } savePrefs(); } },
      !mine && inRoom && { ux: 'mudousuario', icon: isLocalMuted(uid) ? 'mic' : 'micoff', label: isLocalMuted(uid) ? `Ativar voz de ${who}` : `Silenciar ${who}`, fn: () => toggleLocalMute(uid) },
      !mine && inRoom && '-',
      mine && { ux: 'previa', icon: S.selfPreview ? 'eyeoff' : 'eye', label: S.selfPreview ? 'Pausar prévia' : 'Ver prévia', fn: () => { S.selfPreview = !S.selfPreview; renderVoiceUI(); } },
      mine && { ux: 'ajustes', icon: 'sliders', label: 'Ajustes', hint: 'Qualidade, áudio e fonte', fn: liveShareModal },
      inRoom && { ux: 'clipes', icon: clipping(key) ? 'clip' : 'clipsparkle', label: clipping(key) ? 'Clipes' : 'Ativar clipes', fn: () => clipMenu(e, key, who) },
      { ux: 'desenhar', icon: S.annot === key ? 'check' : 'edit', label: S.annot === key ? 'Parar de desenhar' : 'Desenhar', hint: 'Todos veem', fn: () => { if (S.annot === key) S.annot = null; else { S.annot = key; S.focus = key; } renderVoiceUI(); } },
      { ux: 'destacar', icon: 'star', label: S.room?.spot === key ? 'Tirar destaque' : 'Destacar para todos', fn: () => voice.send('ROOM_SPOTLIGHT', { key: S.room?.spot === key ? null : key }) },
      !mine && inRoom && { ux: 'controle', icon: 'pointer', label: on ? 'Parar controle' : wait ? 'Cancelar pedido' : 'Pedir controle', hint: !on && !wait ? 'Mouse, teclado ou controle' : null, fn: () => (on || wait ? stopControl() : requestControl(uid)) },
      !mine && { ux: 'qualidade', icon: 'wifi', label: S.qstats === key ? 'Esconder qualidade' : 'Ver qualidade', fn: () => { S.qstats = S.qstats === key ? null : key; renderVoiceUI(); pollQstats(); } },
      { ux: 'flutuante', icon: 'external', label: 'Janela flutuante', hint: 'Por cima de outros apps', fn: () => popOut(scr) },
      { ux: 'telacheia', icon: 'expand', label: 'Tela cheia', hint: 'Ou clique duas vezes', fn: () => fullscreenStream(scr, inRoom ? { key, who } : null) },
  ].filter(Boolean);
}
export function streamControls({ key, uid, mine, scr, inRoom, who }) {
  const stop = (e) => { e.stopPropagation(); voice.closeStream(uid); if (S.focus === key) S.focus = null; renderVoiceUI(); };
  const more = (e) => { e.stopPropagation(); menu(e, streamItems({ key, uid, mine, scr, inRoom, who }, e)); };
  return h('div.sctl', { onclick: (e) => e.stopPropagation() },
    mine ? h('button.sc-main.sc-stop', { title: 'Parar de compartilhar a tela', onclick: (e) => { e.stopPropagation(); stopSharing(); } }, icon('screenoff', 16), h('span', 'Parar transmissão'))
      : h('button.sc-main', { title: 'Fechar esta transmissão (você continua na chamada)', onclick: stop }, icon('x', 16), h('span', 'Parar de assistir')),
    inRoom && clipButton(key, who, 'sc-ic sc-clip'),
    h('button.sc-ic', { title: 'Tela cheia', onclick: (e) => { e.stopPropagation(); fullscreenStream(scr, inRoom ? { key, who } : null); } }, icon('expand', 16)),
    h('button.sc-ic', { title: 'Mais opções', onclick: more }, icon('more', 16)));
}
// controles e nome/resolução da transmissão: só com o mouse em cima e mexendo. Parado 2,5 s, os controles somem (e o cursor
// também). O #stage não é recriado a cada render, então o estado fica nele, e não nos quadros.
let stageIdleT = 0;
addEventListener('mousemove', (e) => {
  const st = e.target.closest?.('#stage'); if (!st) return;
  st.classList.remove('sidle'); clearTimeout(stageIdleT);
  stageIdleT = setTimeout(() => { if (!document.querySelector('.menu')) st.classList.add('sidle'); }, 2500);
}, { passive: true });
// botão de clipe à vista no quadro da transmissão (antes só em Mais opções > Clipes): um clique salva os últimos N segundos
// (como o F8); clique direito abre o menu (duração, cortar, desativar). Clipes desligados: o clique liga.
const clipKeyLabel = () => (hotkey('keyClip') ? comboLabel(hotkey('keyClip')) : '');
export function clipButton(key, who, cls) {
  const secs = clipSecs(), on = clipping(key);
  return h('button.' + cls.split(' ').join('.') + (on ? '' : '.off'), {
    title: on ? `Salvar clipe dos últimos ${lenLabel(secs)}${clipKeyLabel() ? ` (${clipKeyLabel()})` : ''} · clique direito: mais opções` : 'Ativar clipes (grava os últimos segundos em segundo plano)',
    'aria-label': on ? `Salvar clipe dos últimos ${lenLabel(secs)}` : 'Ativar clipes',
    onclick: (e) => {
      e.stopPropagation();
      if (!clipping(key)) { S.prefs.clipsOn = true; savePrefs(); renderVoiceUI(); return toast('Clipes ativados: em alguns segundos já dá para clipar'); }
      saveClip(key, secs, { ...clipCtx(key, who), onCaptured: clipCaptured(secs) });
    },
    oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); clipMenu(e, key, who); },
  }, icon('clip', 16));
}
// ajustes durante a transmissão: só resolução, FPS e taxa de dados, aplicados na hora sem parar nem trocar o que está sendo
// compartilhado (parar fica no botão vermelho "Parar transmissão")
export function liveShareModal() {
  const o = { ...voice.screenOpts };
  const blk = voice.captureBlack ? h('div.qinfo.warn', 'A transmissão está saindo PRETA. Em jogos, use "Janela sem bordas" e transmita a tela inteira.') : null;
  // tela cheia exclusiva confirmada: as saídas possíveis, sem parar nada sozinho (a Resenha não injeta nada no jogo)
  let m = null;
  const fse = voice.fse?.state === 'confirmed' ? h('div.qinfo.warn.fsebox',
    h('b', 'O jogo parece estar em tela cheia exclusiva.'), ' Nesse modo o Windows não entrega a imagem do jogo para captura (o Discord só consegue com um programa injetado no jogo, o que a Resenha não faz por causa dos anti-cheats). Opções:',
    h('ul', h('li', h('b', 'Melhor: '), 'nas opções de vídeo do jogo, troque "Tela cheia" por "Janela sem bordas". A transmissão volta sozinha, sem reiniciar.'),
      h('li', 'Transmitir a tela inteira em vez da janela: funciona em alguns jogos que o Windows ainda compõe (reinicia a transmissão).'),
      h('li', 'Continuar assim: a transmissão segue no ar; quem assiste vê a última imagem até o jogo sair da tela cheia.')),
    h('div.fsebtns', h('button.btn.sm', { onclick: () => { m?.close(); stopSharing(); setTimeout(() => startShare(), 300); } }, 'Escolher outra fonte'), h('button.btn.sm.link', { onclick: () => m?.close() }, 'Continuar assim'))) : null;
  const diag = captureDiag();
  // método de captura (Beta): trocar aqui reinicia só o vídeo da transmissão (1-2 s); voz e sala seguem
  const capSel = window.lcDesktop?.nativeCapable ? capMethodOpt(() => voice.applyCaptureMode()) : null;
  const body = h('div.ss', fse || blk, h('div.ss-lbl', 'Qualidade da transmissão'),
    h('div.ss-card', qualityPanel(o, async (n) => { await voice.changeScreenQuality(n); S.prefs.screen = { ...S.prefs.screen, res: n.res, fps: n.fps, hint: n.hint, bitrate: n.bitrate || 0 }; savePrefs(); }, { live: true, extra: capSel })), diag.el);
  m = modal('Ajustes da transmissão', 'Muda na hora, sem parar a transmissão.', body, [{ label: 'Pronto', cls: 'green' }], { width: '560px' });
  m.el.querySelector('.modal')?.classList.add('ss-modal', 'ss-live');
}
// diagnóstico da captura (M13): método em uso, quadros por método, fps efetivo, motivo de não estar no programa nativo,
// reinícios, o que o controle da transmissão decidiu e o aviso de tela cheia exclusiva. Atualiza a cada 1 s enquanto aberto.
const NATIVE_WHY_TXT = { win10: 'Windows 10 (a captura nativa desenha uma borda amarela)', nohw: 'sem codificador de vídeo na placa', nocap: 'Windows sem a captura necessária', noexe: 'app desktop sem o componente (atualize o app)', web: 'fora do app desktop para Windows', e2ee: 'chamada protegida (só pelo Chromium)', lowfps: 'menos de 60 FPS pedidos (o nativo entra a partir de 60)', nosfu: 'servidor sem SFU', udp: 'portas UDP da transmissão fechadas', fail: 'o programa nativo falhou', forced: 'Chromium forçado nas configurações (Transmissão > Método de captura)', nomf: 'Windows sem os recursos de mídia (edição "N"): veja Configurações > Transmissão > Codecs', other: 'outro motivo' };
// escolha do método (WGC / DXGI / Chromium): pedido, ativo, por quê, FPS capturado e codificado, resolução, erros e o
// histórico de trocas com o motivo de cada uma (eventos "method"/"capnote" do lc-stream, ver native/lc-stream/src/select.rs)
const CAPM = { wgc: 'WGC', dxgi: 'DXGI', chromium: 'Chromium' };
const hhmmss = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour12: false });
function capRows(c, row) {
  if (!c) return [];
  const out = [h('div.cd-sub', 'Método de captura')];
  const applied = c.applied === 'classic' && c.mode !== 'classic' && c.mode !== 'chromium' ? ' — este app ainda não tem a escolha de método: usando o clássico (atualize o app)' : '';
  out.push(row('Pedido nas configurações', (CAPTURE_METHODS[c.mode] || c.mode) + applied));
  out.push(row('Em uso', (CAPM[c.active] || (c.active ? c.active : '—')) + (c.candidate ? ` · testando ${CAPM[c.candidate]} ao lado` : '') + (c.sim ? ' (simulado)' : '')));
  if (c.plan) out.push(row('Por que começou assim', c.plan));
  if (c.openErrors?.length) out.push(row('Não abriu', c.openErrors.map(e => `${CAPM[e.m] || e.m}: ${e.error}`).join(' · ')));
  out.push(row('FPS capturado / codificado', `${c.capFps ?? '—'} / ${c.encFps ?? '—'}` + (c.repeats ? ` · repetições do último quadro: ${c.repeats}` : '')));
  if (c.cpu != null || c.encMs != null) out.push(row('Programa nativo', [c.cpu != null && `CPU ${c.cpu}% de um núcleo`, c.encMs != null && `codificação ${c.encMs} ms`, c.kbps != null && `${c.kbps} kbps`].filter(Boolean).join(' · ')));
  if (c.srcSize || c.outSize) out.push(row('Resolução', `captura ${c.srcSize || '—'} → envio ${c.outSize || '—'}`));
  if (c.black) out.push(row('Imagem', 'PRETA (o seletor testa o outro método antes de trocar)'));
  if (c.errs || c.lastErr) out.push(row('Erros do método', `${c.errs || 0}${c.lastErr ? ' · último: ' + c.lastErr : ''}`));
  if (c.rebuilds) out.push(row('Placa de vídeo perdida', `${c.rebuilds}x (reconstruído sem derrubar a transmissão)`));
  if (c.info?.accessLost) out.push(row('DXGI recriado', `${c.info.accessLost}x (troca de resolução, tela cheia, Ctrl+Alt+Del)`));
  if (c.note) out.push(h('div.qinfo.warn', c.note));
  if (c.active === 'dxgi' && c.overlap) out.push(h('div.qinfo.warn', 'DXGI: janelas por cima desta aparecem na transmissão.'));
  if (c.active === 'dxgi' && S.prefs.screen?.cursor !== false) out.push(h('div.qinfo', 'DXGI: o cursor não aparece.'));
  // para os testes: tudo isto em texto, para colar no chat e comparar entre PCs
  out.push(h('button.btn.sm.grey', { style: { marginTop: '8px' }, onclick: async (e) => { const x = await voice.captureInfo(); const t = JSON.stringify({ quando: new Date().toISOString(), app: navigator.userAgent.match(/Resenha\/[\d.]+|Electron\/[\d.]+/g)?.join(' ') || '', ...x }, null, 1); try { await navigator.clipboard.writeText(t); e.target.textContent = 'Copiado!'; } catch { e.target.textContent = 'Não consegui copiar'; } } }, 'Copiar relatório do teste'));
  if (c.history?.length) {
    out.push(h('div.cd-sub', 'Histórico de trocas e decisões'));
    out.push(h('ol.cd-hist', [...c.history].reverse().map(e => e.kind === 'method'
      ? h('li.m', h('time', hhmmss(e.at)), h('b', `${e.from ? CAPM[e.from] || e.from : 'início'} → ${CAPM[e.m] || e.m}`), e.ms != null ? h('small', ` ${e.ms} ms sem quadro novo${e.testMs ? ` · comparados lado a lado por ${e.testMs} ms` : ''}`) : null, h('span', e.why))
      : h('li', h('time', hhmmss(e.at)), h('span', e.msg)))));
  }
  return out;
}
function captureDiag() {
  const el = h('details.capdiag', h('summary', 'Diagnóstico da captura'), h('div.cd-body', 'medindo…'));
  const fmtN = (n) => n.toLocaleString('pt-BR');
  let t = 0, seen = false;
  const draw = async () => {
    if (el.isConnected) seen = true; else if (seen) return clearInterval(t); // ainda não entrou na janela: espera

    const x = await voice.captureInfo(); const b = el.querySelector('.cd-body'); if (!b) return;
    if (!x) { b.textContent = 'Sem transmissão.'; return; }
    const row = (k, v) => v == null || v === '' ? null : h('div.cd-row', h('span', k), h('b', v));
    const fseTxt = !x.fse ? null : !x.fse.available ? 'sem dados (app desktop antigo)' : x.fse.state === 'confirmed' ? 'confirmada (o Windows indica e a captura falhou)' : x.fse.state === 'suspected' ? 'só o Windows indica; a captura está recebendo imagem (provável falso positivo)' : 'não';
    b.replaceChildren(
      row('Método em uso', x.label),
      row('Pedido', `${x.want.res === 'source' ? 'original' : x.want.res + 'p'} a ${x.want.fps} FPS`),
      row('Capturando', x.captureFps != null ? `${x.captureFps} quadros/s` : '—'),
      row('Enviando', x.sentFps != null ? `${x.sentFps} FPS${x.size ? ' · ' + x.size : ''}` : '—'),
      row('Codificador', x.encoder ? x.encoder + (x.limit && x.limit !== 'none' ? ` (limitado: ${x.limit === 'cpu' ? 'processador' : x.limit === 'bandwidth' ? 'internet' : x.limit})` : '') : null),
      h('div.cd-sub', 'Quadros capturados por método (desde o início)'),
      ...x.frames.map(f => row(f.name, f.secs ? `${fmtN(f.frames)} quadros em ${f.secs} s · média ${Math.round(f.frames / f.secs)}/s${f.sent != null && f.secs ? ` · enviados ${Math.round(f.sent / f.secs)}/s` : ''}` : 'não usado')),
      x.fallback && row('Por que não o nativo', x.fallback.text || NATIVE_WHY_TXT[x.fallback.code] || (x.fallback.code ? NATIVE_WHY_TXT.other : 'não tentado')),
      x.restarts ? row('Reinícios do nativo', `${x.restarts}${x.lastError ? ' · último: ' + x.lastError : ''}`) : null,
      x.gov?.note ? row('Ajuste automático', x.gov.note) : null,
      row('Tela cheia exclusiva', fseTxt),
      ...capRows(x.capture, row));
  };
  draw(); t = setInterval(draw, 1000);
  return { el };
}
