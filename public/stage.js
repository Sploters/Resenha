// Palco da chamada: quadros (câmera, tela, avatar), layouts, visibilidade e qualidade dos vídeos, e clipes.
import { fxBadge } from './fxui.js';
import { h, icon, avatar, parsePos, imgUrl } from './util.js';
import { S, user, channelById, nameOf, toast, menu, popout, closeFloating, desktop, savePrefs, CH, chCan, can, PERM } from './state.js';
import { playSound } from './sounds.js';
import { openSoundboard } from './soundboard.js';
import { volumeControl } from './quick.js';
import { chName } from './chnames.js';
import { updatePip } from './livepip.js';
import { zoomControls, pruneZoom } from './zoom.js';
import { boardCanvas, boardTools, annotTools, clearBoard, pruneBoardCanvases } from './board.js';
import { codeTile, keepEditorFocus } from './code.js';
import { syncAutoClip, stopAutoClip, autoClipsOn } from './autoclip.js';
import { startBuffer, stopBuffer, stopAllBuffers, pruneBuffers, clipping, saveClip, saveClipTrim, clipLengths, clipKeys, clipSecs, lenLabel, clipDest } from './clips.js';
import { openShareClip } from './myclips.js';
import { syncThrottle } from './lite.js';
import { syncGlobalPtt } from './ptt.js';
import { controlling as remoteControlling } from './remote.js';
import { watchTile, watchVoiceChanged } from './watch.js';
import { toggle as uiToggle } from './ui.js';
import { styleName } from './themes.js';
import { activityOf, refreshFeedView, gameTitle } from './activity.js';
import { swapIcon, animOn } from './motion.js';
import { voice, $, gwSend, roomVoice } from './gateway.js';
import { botTile } from './botmusic.js';
import { handBadge, handsOf, toggleHand, whisperPicker, stopWhisper, togglePriority, canPriority, lowerHand } from './voicerooms.js';
import { appBadge } from './appver.js';
import { openSettings, ctxSettings } from './nav.js';
import { renderSide } from './side.js';
import { voiceAct, fxButton, trackLastCall, joinVoice, voiceToggle, activityButton } from './userbar.js';
import { muteIco, userMenu } from './usermenu.js';
import { anchorRight } from './inbox.js';
import { noiseMenu, startShare, pipCtx, stopSharing, mediaDevs, camOptItems, screenOptItems, watchOnly, watchOptItems, ctxOpts, shareKeyHint, syncLive, hideGameOffer, healthPill, streamItems, streamControls, clipButton, liveShareModal } from './share.js';
// =============== Voz: palco ===============
// tela cheia num <video> próprio fora da árvore que se redesenha: o nativo mostrava pause/minutagem e piscava preto quando a sala era redesenhada
export function fullscreenStream(stream, clip) { // clip { key, who }: botão de clipe na tela cheia
  const v = h('video', { autoplay: true, playsInline: true, muted: true, disablePictureInPicture: true });
  v.muted = true; v.srcObject = stream;
  // controles só com o mouse mexendo: parado por 2,5 s (ou fora da tela), somem junto com o cursor
  const bar = h('div.fs-ctl', { onclick: (e) => e.stopPropagation() }, clip && clipButton(clip.key, clip.who, 'fs-btn'),
    h('button.fs-btn', { title: 'Sair da tela cheia (Esc)', onclick: (e) => { e.stopPropagation(); exit(); } }, icon('shrink', 18)));
  const box = h('div.fsbox.idle', { onclick: () => exit(), title: 'Clique para sair (Esc)' }, v, bar);
  let idleT = 0;
  const wake = () => { box.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => box.classList.add('idle'), 2500); };
  box.addEventListener('mousemove', wake); box.addEventListener('mouseleave', () => { clearTimeout(idleT); box.classList.add('idle'); });
  const exit = () => { if (document.fullscreenElement === box) document.exitFullscreen?.().catch(() => { }); else box.remove(); };
  const gone = () => { clearTimeout(idleT); stream.removeEventListener('inactive', exit); box.remove(); v.srcObject = null; };
  box.addEventListener('fullscreenchange', () => { if (document.fullscreenElement !== box) gone(); });
  stream.addEventListener('inactive', exit);
  document.body.append(box); v.play?.().catch(() => { });
  box.requestFullscreen?.().catch(() => gone());
}
const waitAvatar = (u) => { const a = avatar(u, 96, { status: false }); a.classList.add('vwait-av'); return a; }; // câmera ligando: o avatar até o 1º quadro
const vidCache = new Map(); // reaproveita <video> para não piscar a cada atualização
function videoFor(key, stream, muted = true) {
  let v = vidCache.get(key);
  if (!v || v.srcObject !== stream) {
    // fluxo trocado no mesmo quadro (câmera renegociada): já tinha imagem, não volta ao avatar
    const had = v && !v.classList.contains('nofr');
    if (v) v.srcObject = null; v = h('video' + (had ? '' : '.nofr'), { autoplay: true, playsInline: true, muted }); v.srcObject = stream; vidCache.set(key, v); v.play?.().catch(() => { });
    // até o 1º quadro o vídeo fica transparente e o quadro mostra o avatar (câmera) ou "conectando" (transmissão), não preto
    const shown = v, ready = () => { if (had) return; shown.classList.remove('nofr'); const t = shown.closest('.tile'); if (t) { t.classList.remove('waitvid'); t.querySelectorAll(':scope > .vwait, :scope > .vwait-av').forEach(e => e.remove()); } }; // aviso e vídeo trocam no mesmo quadro (com fade, ficavam sobrepostos ou com um vazio no meio)
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(ready); else v.addEventListener('loadeddata', ready, { once: true });
  }
  else if (v.paused) v.play?.().catch(() => { }); // o navegador pausa <video> removido da tela; ao voltar à sala ele ficava congelado
  return v;
}
// avisa o servidor de quais transmissões estou assistindo (tela visível agora)
export function syncWatching(want) {
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
export function pollQstats() {
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
    opt('showNoVideo', 'Mostrar participantes sem vídeo', 'Desligado: só câmeras e transmissões no palco (a voz de todos continua)'),
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
export function applyCamFlow() {
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
export function releaseStage() { if (observedStage && !observedStage.isConnected) { stageObs.unobserve(observedStage); observedStage = null; } } // palco antigo (ver releaseOldScreens)
function watchStage() {
  const st = document.getElementById('stage');
  if (st !== observedStage) { if (observedStage) stageObs.unobserve(observedStage); if (st) stageObs.observe(st); observedStage = st; }
  fitStage();
}

// nome do jogo de uma transmissão: a janela de jogo escolhida (mandada por quem transmite) ou o "Jogando X" da pessoa
export function streamGameName(uid, v = S.voice.get(uid)) {
  if (!v?.screen) return null;
  const mine = uid === S.me?.id, t = mine ? voice?.streamTitle?.() : v.screen_title;
  if (t) return t;
  const a = activityOf(uid); return a ? gameTitle(a) : null;
}
const screenLabel = (who, uid, v, info) => { const g = streamGameName(uid, v); return h('div.label', icon('screen', 14), h('span.sl-who', who), g ? h('span.sl-game', { title: g }, g) : h('span.sl-game.sl-plain', 'tela'), info); };
const seenLive = new Set(); // transmissões já vistas nesta sala: só as novas começam fechadas
// transmissão que acabou de parar: se a mesma pessoa volta a transmitir logo (trocou de janela em "Alterar janela", ou a
// captura reiniciou), quem estava assistindo continua assistindo, em vez de ter que clicar em Assistir de novo
const recentLive = new Map(), RELIVE_MS = 20e3; // chave -> { t, open }
function autoClosed() {
  const now = new Set();
  if (voice.active) for (const v of S.voice.values()) {
    if (v.channel_id !== voice.channelId || !v.screen || v.user_id === S.me.id) continue;
    const k = voice.channelId + ':' + v.user_id; now.add(k);
    if (!seenLive.has(k)) {
      seenLive.add(k);
      const prev = recentLive.get(k); recentLive.delete(k);
      if (S.autoWatch?.uid === v.user_id && S.autoWatch.exp > Date.now()) { S.focus = 's:' + v.user_id; S.autoWatch = null; } // veio do botão "Assistir" do feed: abre direto
      else if (!(prev?.open && Date.now() - prev.t < RELIVE_MS)) voice.closeStream(v.user_id);
    }
  }
  for (const k of [...seenLive]) if (!now.has(k)) { seenLive.delete(k); recentLive.set(k, { t: Date.now(), open: !voice.closedStreams.has(k.slice(k.indexOf(':') + 1)) }); }
  for (const [k, r] of recentLive) if (Date.now() - r.t > RELIVE_MS) recentLive.delete(k);
}
// pedidos seguidos na mesma rodada (mutar 10x pelo atalho, entrar + câmera + estado) viram UM redesenho, com o estado final.
// Antes cada um redesenhava a lista lateral e o palco inteiros na hora (~400 elementos por vez).
let vuiQ = 0; // 1 = só as falas, 2 = completo
export function voiceUpdate(speakOnly) {
  if (!speakOnly) { syncGlobalPtt(voice); trackLastCall(); } // entrou/saiu da chamada: liga/desliga o push-to-talk global (só avisa o app se mudou)
  const want = speakOnly ? 1 : 2; if (vuiQ >= want) return;
  const first = !vuiQ; vuiQ = want;
  if (first) queueMicrotask(() => { const k = vuiQ; vuiQ = 0; renderVoiceUI(k === 1); if (k !== 1) { applyCamFlow(); watchVoiceChanged(); } }); // câmera nova com a sala fora da tela também pausa
}
// aba/janela escondida: quem está falando não é desenhado (ninguém vê); ao voltar, um redesenho põe em dia
let speakStale = false;
document.addEventListener('visibilitychange', () => { if (!document.hidden && speakStale && voice) { speakStale = false; renderVoiceUI(true); } });
// Configurações → Clipes mudou algo que exige recomeçar a gravação (duração, placa de vídeo, ligar/desligar)
document.addEventListener('voice-rerender', () => { if (voice?.active) renderVoiceUI(); });
export function renderVoiceUI(speakOnly) {
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
  if (!voice.active) { stopAllBuffers(); stopAutoClip(); for (const v of vidCache.values()) v.srcObject = null; vidCache.clear(); pruneBoardCanvases(new Set()); } // saiu da sala: nada do palco fica preso
  syncThrottle(voice);
  // alguém da sala mudou "Permitir que minha voz entre em clipes": a mistura de áudio dos clipes é montada no começo da
  // gravação, então recomeça sem (ou com) a voz da pessoa
  if (voice.active) { const nc = [...S.voice.values()].filter(v => v.channel_id === voice.channelId && v.noclip).map(v => v.user_id).sort().join() + '|' + !!S.prefs.clipVoiceOff; if (lastNoClip !== null && nc !== lastNoClip) stopAllBuffers(); lastNoClip = nc; } else lastNoClip = null;
  const stage = $('#stage'); if (!stage) return syncWatching(null);
  const ch = channelById(S.view.cid); if (!ch || ![1, 2].includes(ch.type)) return syncWatching(null);
  const dm = ch.type === 1, gid = ch.guild_id;
  const members = roomVoice(ch.id);
  const inRoom = voice.channelId === ch.id;
  const tiles = [], live = new Set();
  const nm = (uid) => dm ? user(uid).display_name : nameOf(uid, gid);
  for (const v of members) {
    if (v.bot) { tiles.push(botTile(v, gid)); continue; }
    const uid = v.user_id, mine = uid === S.me.id, p = voice.peers.get(uid);
    const cam = mine ? voice.cam : (S.prefs.hiddenVideo?.[uid] ? null : p?.streams.cam), scr = mine ? voice.screen : p?.streams.screen;
    if (!v.screen) voice.closedStreams.delete(uid);
    if (scr && v.screen && !mine && voice.closedStreams.has(uid)) {
      // multistream (como no Discord): "Assistir" fecha as outras e fica só com esta; o olho junta ao palco, mantendo as que
      // você já está assistindo (e o destaque)
      tiles.push(h('div.tile.cstream', { 'data-key': 's:' + uid }, h('div.cs', icon('screen', 36), h('b', `${nm(uid)} está transmitindo`), streamGameName(uid, v) && h('span.cs-game', streamGameName(uid, v)),
        h('div.cs-acts',
          h('button.btn.green', { title: 'Assistir só esta (fecha as outras transmissões abertas)', onclick: (e) => { e.stopPropagation(); watchOnly(uid); renderVoiceUI(); } }, 'Assistir'),
          h('button.cs-multi', { title: 'Assistir junto com as outras (multistream): entra no palco sem mudar o destaque', 'aria-label': 'Assistir junto com as outras transmissões', onclick: (e) => { e.stopPropagation(); voice.openStream(uid); renderVoiceUI(); } }, icon('eye', 18))))));
    } else if (scr && v.screen) {
      const key = 's:' + uid; live.add(key);
      const vid = mine && !S.selfPreview && S.annot !== key ? h('div.selfpause', h('span.live.sp-live', 'Ao vivo'), h('b', 'Sua transmissão continua ativa!'), h('span', 'Pausamos esta prévia para economizar recursos.')) : videoFor(key, scr), info = h('span.sinfo');
      // clipe = vídeo + áudio da transmissão + tudo da Resenha: voz de quem transmite e de todos na sala (com os efeitos de voz),
      // bot de música e soundboard. Na transmissão ao vivo nada disso vai (lá a voz segue separada, como voz da call)
      if (mine) voice.syncPreview(); // transmissão nativa: prévia leve, ou 30 fps se ela também alimenta o clipe próprio
      if (!clipsAuto(mine) && clipping(key)) stopBuffer(key); // desligou (clipes ou clipes automáticos): para de gravar
      if (clipsAuto(mine) && inRoom) startBuffer(key, scr, [mine ? scr : p?.screenAudioEl?.raw, ...voice.clipAudio()], voice.getCtx(), { native: mine && voice.nativeClips(), tap: mine ? voice.ownTap() : voice.screenTap(uid) });
      const upd = () => (info.textContent = vid.videoWidth ? `${vid.videoWidth}×${vid.videoHeight}` : '');
      if (vid.tagName === 'VIDEO') { vid.onresize = vid.onloadedmetadata = upd; upd(); }
            const sctl = streamControls({ key, uid, mine, scr, inRoom, who: nm(uid) });
            tiles.push(h('div.tile.screen' + (vid.classList.contains('nofr') ? '.waitvid' : '') + (S.focus === key ? '.focus' : '') + (S.annot === key ? '.annotating' : '') + (remoteControlling(uid) ? '.controlling' : '') + (S.room?.cid === voice.channelId && S.room.spot === key ? '.spotlit' : ''), { 'data-key': key, 'data-sid': uid, 'data-uid': uid, onclick: () => { S.focus = S.focus === key ? null : key; renderVoiceUI(); },
              // duplo clique: tela cheia (no 1º teste, cliques repetidos no vídeo procuravam isso)
              ondblclick: (e) => { if (S.annot === key || e.target.closest('button, input, .sctl, .annot-bar, .snote')) return; fullscreenStream(scr, inRoom ? { key, who: nm(uid) } : null); },
              oncontextmenu: (e) => menu(e, [!mine && { node: volumeControl(voice, uid, 'screen', 'Volume da transmissão de ' + nm(uid)) }, !mine && '-', ...streamItems({ key, uid, mine, scr, inRoom, who: nm(uid) }, e)]) }, vid, vid.classList.contains('nofr') && h('div.vwait', icon('screen', 28), h('span', mine ? 'Iniciando a prévia…' : `Conectando à transmissão de ${nm(uid)}…`)), !mine && v.screen_note && h('div.snote', icon('screen', 22), h('b', v.screen_note === 'closed' ? 'A janela transmitida foi fechada' : v.screen_note === 'away' ? 'O jogo não está na tela' : 'Janela minimizada'), h('span', v.screen_note === 'closed' ? `${nm(uid)} precisa escolher outra fonte.` : v.screen_note === 'away' ? `A imagem volta quando ${nm(uid)} voltar para o jogo.` : `A imagem volta quando ${nm(uid)} restaurar a janela.`)), mine && healthPill(), mine && (voice.fse?.state === 'confirmed' || voice.captureBlack) && h('button.blackwarn', { title: 'Como corrigir', onclick: (e) => { e.stopPropagation(); liveShareModal(); } }, icon('screen', 18), h('span', voice.fse?.state === 'confirmed' ? 'Tela cheia exclusiva: use "Janela sem bordas" no jogo. Clique para ver as opções.' : 'Transmissão preta — jogos em tela cheia exclusiva/anti-cheat bloqueiam a captura. Use "Janela sem bordas".')), sctl, vid.tagName === 'VIDEO' && boardCanvas('s:' + uid, { interactive: S.annot === key, video: vid }), S.annot === key && vid.tagName === 'VIDEO' && h('div.annot-bar', annotTools('s:' + uid, () => { S.annot = null; renderVoiceUI(); })), vid.tagName === 'VIDEO' && zoomControls(key, vid, scr), S.qstats === key && !mine && qstatsPanel(uid),
        screenLabel(nm(uid), uid, v, info)));
    } else if (v.screen && !mine && (!inRoom || !voice.closedStreams.has(uid))) {
      // transmitindo, mas o vídeo ainda não chegou (fora da sala ou entrando agora): o quadro já entra no lugar dele, para a
      // grade montar uma vez só (antes ela pulava de 2+2+1 para 2×3 quando o vídeo chegava)
      tiles.push(h('div.tile.screen.waitvid', { 'data-key': 's:' + uid, 'data-uid': uid }, h('div.vwait', icon('screen', 28), h('span', inRoom ? `Conectando à transmissão de ${nm(uid)}…` : `${nm(uid)} está transmitindo`)),
        screenLabel(nm(uid), uid, v, null)));
    }
    const ckey = 'c:' + uid;
    if (cam && v.video) live.add(ckey);
    const mirrored = cam && v.video && (mine ? !!S.prefs.camMirror : !!v.mirror); // "Inverter a imagem" de quem liga a câmera vale para todos
    const camVid = cam && v.video ? videoFor(ckey, cam) : null;
    const t = h('div.tile.utile' + (v.hold ? '.onhold' : '') + (cam && v.video ? '.hasvid' : '') + (camVid?.classList.contains('nofr') ? '.waitvid' : '') + (mirrored ? '.mirrored' : '') + (voice.speaking.has(uid) ? '.speaking' : '') + (voice.sbActive.has(uid) ? '.sbplay' : ''), { 'data-uid': uid, 'data-key': ckey, oncontextmenu: (e) => userMenu(e, uid, gid), onclick: () => { S.focus = S.focus === ckey ? null : ckey; renderVoiceUI(); } },
      ...(cam && v.video ? [camVid, camVid.classList.contains('nofr') && waitAvatar(user(uid))] : [avatar(user(uid), 96, { status: false })]),
      h('div.label', muteIco(v), v.deaf && icon('headoff', 14), styleName(h('span', nm(uid)), user(uid).name_style), fxBadge(v.fx), handBadge(v), v.prio && h('span.vr-prio', { title: 'Falando com prioridade' }, icon('megaphone', 13)), appBadge(v), v.hold && h('span.vu-hold', 'Em espera')),
      // opções do participante à vista (antes só no clique direito): volume, silenciar, desativar vídeo, parar de assistir
      inRoom && h('button.tmore', { title: 'Opções de ' + nm(uid), 'aria-label': 'Opções de ' + nm(uid), onclick: (e) => { e.stopPropagation(); userMenu(e, uid, gid); } }, icon('more', 16)));
    tiles.push(paintTile(t, user(uid)));
  }
  const room = S.room?.cid === voice.channelId ? S.room : null;
  if (inRoom && room?.wb) tiles.push(h('div.tile.wbtile', { 'data-key': 'wb' }, boardCanvas('wb', { interactive: true }), h('div.wbbar', boardTools('wb', [h('button.ibtn', { title: 'Destacar / voltar à grade', onclick: () => { S.focus = S.focus === 'wb' ? null : 'wb'; renderVoiceUI(); } }, icon('expand', 16)), h('button.ibtn', { title: 'Fechar a lousa para todos', onclick: () => { clearBoard('wb'); voice.send('ROOM_ACT', { act: 'wb', on: false }); } }, icon('x', 16))]))));
  { const wt = inRoom && watchTile(); if (wt) tiles.push(wt); }
  if (inRoom && room?.code) tiles.push(codeTile({ onFocus: () => { S.focus = S.focus === 'code' ? null : 'code'; renderVoiceUI(); }, onClose: () => voice.send('ROOM_ACT', { act: 'code', on: false }) }));
  const hasScreen = tiles.some(t => t.classList.contains('screen') || t.classList.contains('cstream'));
  const allTiles = tiles.length; // antes dos filtros: o botão de layout (onde se religa o filtro) não pode sumir por causa dele
  if (S.hideMembers && hasScreen) tiles.splice(0, tiles.length, ...tiles.filter(t => !t.classList.contains('utile'))); // oculta os participantes: só as transmissões
  // "Mostrar participantes sem vídeo" desligado (painel de layout): só quem tem câmera, transmissões, lousa e código ficam no
  // palco; a voz de todo mundo continua. Se não sobrar nada com vídeo, mostra todos (palco vazio confundiria)
  if (S.prefs.showNoVideo === false) { const vis = tiles.filter(t => !t.classList.contains('utile') || t.classList.contains('hasvid')); if (vis.length) tiles.splice(0, tiles.length, ...vis); }
  for (const [k, v] of [...vidCache]) if (!live.has(k)) { v.srcObject = null; vidCache.delete(k); } // solta o fluxo na hora (sem esperar o GC)
  pruneZoom(live); pruneBoardCanvases(new Set([...live, ...(inRoom && room?.wb ? ['wb'] : [])]));
  if (inRoom) pruneBuffers(live);
  syncAutoClip({ voice, clipCtx, clipFlash }); // clipes automáticos da sua transmissão (autoclip.js)
  { const rec = clipKeys().length > 0; if (voice.clipRec !== rec) { voice.clipRec = rec; voice.sendState(); } } // indicador "gravando clipes" para a sala
  syncWatching(inRoom ? members.filter(v => v.screen && v.user_id !== S.me.id && !voice.closedStreams.has(v.user_id) && voice.peers.get(v.user_id)?.streams.screen).map(v => v.user_id) : null);
  const hasFocus = tiles.some(t => t.dataset.key === S.focus);
  const screens = tiles.filter(t => t.classList.contains('screen')); // várias transmissões e nenhuma em destaque: grade com todas, do mesmo tamanho
  // layouts nomeados (preferência sincronizada): auto = comportamento clássico (grade, ou destaque ao clicar)
  const layout = STAGE_LAYOUTS.some(l => l.id === S.prefs.stageLayout) ? S.prefs.stageLayout : 'auto';
  let focusTile = hasFocus && tiles.length > 1 ? tiles.find(t => t.dataset.key === S.focus) : null; // sozinho no palco não há o que minimizar: fica a grade normal
  if (layout === 'grid' || layout === 'side') focusTile = null;
  else if (['spot', 'sidebar', 'cinema'].includes(layout) && tiles.length > 1 && !focusTile) focusTile = screens[0] || tiles[0]; // sem destaque escolhido: a primeira transmissão
  const btn = (ic, title, on, fn, cls = '') => swapIcon(h('button.roundbtn' + (on ? '.off' : '') + cls, { title, onclick: fn, oncontextmenu: cls.startsWith('.mic') ? noiseMenu : null }, icon(ic, 24)), 'bar-' + ic.replace(/(off|set)$/, ''), !!on); // ícone novo entra com fade + desfoque
  syncLive();
  // fora da sala o botão Entrar não some com o mouse fora do palco (.joinbar, features.css): era o único jeito de entrar
  const bar = h('div.bar' + (inRoom ? '' : '.joinbar'), inRoom ? [
    // centro = sala e transmissão; microfone, fone, câmera, efeitos, soundboard e música ficam no painel da esquerda
    // (em tela estreita o painel some: aí eles voltam a aparecer aqui, .solo-narrow)
    btn(voice.muted ? 'micoff' : 'mic', voice.muted ? 'Ativar microfone (clique direito: redução de ruído)' : 'Silenciar (clique direito: redução de ruído)', voice.muted, () => voiceToggle('mute'), '.mic.solo-narrow'),
    btn(voice.deafened ? 'headoff' : 'headset', 'Ensurdecer', voice.deafened, () => voiceToggle('deaf'), '.solo-narrow'),
    ctxOpts(btn('video', 'Câmera (clique direito: escolher a câmera)', !!voice.cam, () => voiceAct(() => voice.toggleCam()), '.solo-narrow'), async () => camOptItems(await mediaDevs())),
    ctxOpts(btn('screen', voice.screen ? 'Configurar a transmissão (qualidade, fonte, áudio) · clique direito: opções rápidas' : 'Transmitir tela', false, startShare, voice.screen ? '.sharing' : ''), async () => [...screenOptItems(), ...(watchOptItems().length ? ['-', ...watchOptItems()] : [])]),
    fxButton(24, true, '.solo-narrow'),
    activityButton(24), // Atividades: Watch Together, música, chamar pra jogar, lousa, código (userbar.js)
    handButton(ch), // pedir a vez; clique direito: sussurrar e falar com prioridade (public/voicerooms.js)
    h('button.roundbtn.solo-narrow', { title: voice.deafened ? 'Soundboard indisponível (ensurdecido)' : 'Soundboard', disabled: voice.deafened, style: voice.deafened ? { opacity: .4, cursor: 'not-allowed' } : null, onclick: (e) => openSoundboard(e.currentTarget, voice, { openSettings: (k) => openSettings(k, ctxSettings()) }) }, icon('soundboard', 24)),
    // transmitindo: a bola vermelha da ponta vira "Parar transmissão" (mesmo tamanho das outras) no lugar do "Sair da chamada";
    // para sair da chamada continua o botão do painel de voz (ou parar a transmissão e o Sair volta aqui)
    voice.screen ? btn('screenoff', 'Parar transmissão' + shareKeyHint() + ' — você continua na chamada', false, () => stopSharing(), '.red.stopshare')
      : btn('phoneoff', 'Sair da chamada', false, () => voice.leave(), '.red'),
  ] : !dm && !chCan(ch, CH.CONNECT) ? h('div.vc-noconnect', icon('lock', 16), 'Você não tem permissão para entrar nesta sala')
    : S.prefs.joinBtn === 'compact' ? h('button.btn.green.sm.join-compact', { onclick: () => joinVoice(ch.id) }, icon(dm ? 'callstart' : 'voice', 16), dm ? 'Atender' : 'Entrar')
    : h('button.btn.green', { style: { minWidth: '220px', minHeight: '46px', fontSize: '16px' }, onclick: () => joinVoice(ch.id) }, dm ? 'Atender / entrar na chamada' : 'Entrar na sala de voz'));
  // "Entrar" do topo só quando o palco não mostra o dele (Watch Together cobrindo a barra); dentro da sala, nunca. Os dois
  // juntos eram a mesma ação repetida
  document.querySelector('.vc-join-top')?.classList.toggle('hidden', !!inRoom || !stage.classList.contains('wt-cover'));
  // botão de layout no topo do palco (à direita): mostra o layout atual e abre o painel com as miniaturas
  const slot = document.getElementById('vc-layout-slot');
  if (slot) slot.replaceChildren(...(inRoom && allTiles > 1 ? [h('button#vc-layout' + (document.querySelector('.layoutpop') ? '.open' : ''), { title: 'Mudar o layout do palco', onclick: layoutMenu }, icon('layout', 18), h('span', STAGE_LAYOUTS.find(l => l.id === layout).label), icon('chevdown', 14))] : []));
  if (hasScreen) bar.append(h('button.partbtn' + (S.hideMembers ? '.membershid' : ''), { title: S.hideMembers ? 'Mostrar participantes' : 'Ocultar participantes', onclick: () => { S.hideMembers = !S.hideMembers; renderVoiceUI(); } }, icon('caret', 16), icon('users', 18)));
  for (const t of screens) { const sid = t.dataset.sid; if (sid && sid !== S.me.id) voice.setStreamLayer(sid, focusTile && t !== focusTile ? 0 : screens.length > 2 && !focusTile ? 1 : 2); } // miniaturas e grades cheias pedem a camada menor
  const rest = focusTile ? tiles.filter(t => t !== focusTile) : tiles;
  const empty = !tiles.length; // sala vazia: o botão de entrar fica junto do texto, no meio (como no Discord)
  // quadros que entram ou saem (alguém entrou, transmissão começou): cada quadro desliza do lugar antigo para o novo e o
  // novo surge, em vez de a grade inteira saltar (FLIP, só transform/opacity). Só quando o número de quadros muda
  const wasJoin = !!stage.querySelector('.bar.joinbar'); // fora da sala (o Entrar, no pé do palco ou no meio da sala vazia)
  const flipFrom = animOn() && stage.isConnected ? new Map([...stage.querySelectorAll('.tile[data-key]')].map(t => [t.dataset.key, t.getBoundingClientRect()])) : null;
  keepEditorFocus(() => stage.replaceChildren(...[
    !empty ? (focusTile ? (layout === 'cinema' ? [h('div.spot', focusTile)] : layout === 'sidebar' ? [h('div.splitwrap', h('div.spot', focusTile), h('div.strip', rest))] : [h('div.spot', focusTile), h('div.strip', rest)]) : layout === 'side' && tiles.length > 1 ? h('div.grid.sidebyside', tiles) : (() => { const gr = h('div.grid.fit', tiles); if (lastTw) gr.style.setProperty('--tw', lastTw); return gr; })()) : h('div.grid', h('div.empty', { style: { color: '#fff' } }, h('h2', dm ? 'Chamada' : chName(ch)), h('p', dm ? 'Ninguém está na chamada.' : 'Ninguém está nesta sala de voz ainda.'), !inRoom && bar)),
    voice.error && inRoom && h('div.verr', voice.error),
    !(empty && !inRoom) && bar].flat().filter(Boolean)));
  watchStage(); observeTiles(); markNarrow();
  if (flipFrom?.size) flipTiles(stage, flipFrom);
  if (inRoom && wasJoin && animOn()) stage.querySelector(':scope > .bar')?.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' }); // acabou de entrar: os controles sobem no lugar do Entrar
  watchVoiceChanged();
}
function flipTiles(stage, from) {
  const now = [...stage.querySelectorAll('.tile[data-key]')];
  if (now.length === from.size && now.every(t => from.has(t.dataset.key))) return; // mesmos quadros: nada mudou de lugar
  const ease = 'cubic-bezier(.2, .8, .2, 1)';
  for (const t of now) {
    const a = from.get(t.dataset.key), b = t.getBoundingClientRect(); if (!b.width) continue;
    if (!a) { t.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: ease }); continue; }
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
    t.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 260, easing: ease });
  }
}
// atalho de clipe: salva os últimos segundos da transmissão em destaque (ou da primeira que está sendo gravada)
export const hasScreenOf = (key) => !!S.voice.get(key.slice(2))?.screen;
export function clipHotkey() {
  if (!voice?.active) return clipFlash(false, 'Nenhuma transmissão');
  const keys = clipKeys(), key = [S.focus, S.ctlKey].find(k => k && keys.includes(k)) || keys[0];
  if (!key) {
    // clipes desligados (à mão ou pelo modo leve) e a pessoa apertou o atalho de propósito: liga na hora, como o botão de
    // clipe da transmissão já faz (share.js). Antes só avisava "desativados" (o erro mais visto da telemetria de clipes)
    if (S.prefs.clipsOn === false) {
      if (S.prefs.lightPrev?.applied?.clipsOn === false) delete S.prefs.lightPrev.applied.clipsOn; // desligar o modo leve não desfaz
      delete S.prefs.clipsOn; savePrefs(); renderVoiceUI();
      clipFlash(true, 'Clipes ligados', 'já dá para clipar em alguns segundos'); // por cima do jogo, no app desktop
      return toast('Os clipes estavam desligados: liguei agora. Em alguns segundos já dá para clipar.');
    }
    const why = voice.screen && keys.length === 0 ? 'Ative os clipes na sua transmissão (botão de clipe no quadro dela).' : 'Nenhuma transmissão sendo gravada ainda.';
    clipFlash(false, 'Clipe não salvo');
    return toast(why, true);
  }
  const secs = clipSecs();
  saveClip(key, secs, { ...clipCtx(key), onCaptured: clipCaptured(secs) });
}
// quem transmite, o jogo (para agrupar em "Meus clipes", como no Discord) e onde a sala fica
export function clipCtx(key, who) {
  const uid = key.slice(2), ch = channelById(voice.channelId);
  return { channelId: voice.channelId, guildId: ch?.guild_id || null, who: who || (ch?.type === 1 ? user(uid).display_name : nameOf(uid, ch?.guild_id)), game: activityOf(uid)?.game?.title || '' };
}
// clipe capturado: aviso (por cima do jogo, no app desktop) e o som de confirmação
export const clipCaptured = (secs) => (ok) => { if (ok) { playSound('clip'); clipFlash(true, clipDest() === 'local' ? 'Clipe salvo' : 'Clipe postado', lenLabel(secs)); } else clipFlash(false, 'Clipe não salvo'); };
// aviso de clipe capturado, só para quem apertou: com o app em segundo plano (jogando), o app desktop mostra por cima do
// jogo (fora da captura, não aparece na transmissão); com o app à vista, a animação é dentro da própria página
export function clipFlash(ok, title, sub, kind) { // kind 'share': ícone de tela (atalho da transmissão)
  if (desktop?.clipFlash && !document.hasFocus()) return desktop.clipFlash({ ok, title, sub, kind });
  document.querySelector('.clipflash')?.remove();
  const el = h('div.clipflash' + (ok ? '' : '.bad'), { role: 'status', 'aria-live': 'polite' }, h('div.cf-ic', icon(ok ? (kind === 'share' ? 'screen' : 'clip') : 'x', 14)), h('b', title), sub && h('small', sub));
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}
// clipes: ligados por padrão para as transmissões dos outros; na sua própria só se você ativar (codificar o próprio jogo duas vezes pesa)
// Com os clipes automáticos ligados (padrão), a sua também grava ao transmitir: é dela que sai o clipe automático.
let lastNoClip = null; // quem da sala não quer a voz em clipes (muda → a gravação recomeça)
const clipsAuto = (mine) => (mine ? S.prefs.clipsOn === true || autoClipsOn() : S.prefs.clipsOn !== false);
export function clipMenu(e, key, who) {
  if (!clipping(key)) return menu(e, [{ label: 'Ativar clipes', icon: 'clipsparkle', hint: `Grava os últimos ${lenLabel(Math.max(60, clipSecs()))} das transmissões em segundo plano`, fn: () => { S.prefs.clipsOn = true; savePrefs(); renderVoiceUI(); toast('Clipes ativados: em alguns segundos já dá para salvar'); } }]);
  const where = clipDest() === 'local' ? 'Guarda neste aparelho' : 'Posta no chat da sala', max = Math.max(60, clipSecs());
  menu(e, [...clipLengths.filter(n => n <= max).map(n => ({ label: `Salvar os últimos ${lenLabel(n)}`, icon: 'clip', hint: where, fn: () => saveClip(key, n, { ...clipCtx(key, who), onCaptured: clipCaptured(n) }) })),
    { label: 'Salvar e cortar…', icon: 'cliptrim', hint: `Escolhe o trecho dos últimos ${lenLabel(max)}`, fn: () => saveClipTrim(key, clipCtx(key, who)) },
    { label: 'Meus clipes…', icon: 'clip', hint: 'Os clipes guardados neste aparelho', fn: () => openShareClip(null) }, '-',
    { label: 'Configurações dos clipes', icon: 'gear', fn: () => openSettings('clips', ctxSettings()) },
    { label: 'Desativar clipes', icon: 'x', danger: true, fn: () => { S.prefs.clipsOn = false; savePrefs(); stopAllBuffers(); renderVoiceUI(); } }]);
}

// pedir a vez: mão levantada (o número é a fila da sala). Clique direito (ou o ⋯ do menu): sussurrar, falar com
// prioridade e, para quem modera voz, baixar as mãos da fila
function handButton(ch) {
  const hands = handsOf(ch.id), others = hands.filter(v => v.user_id !== S.me.id).length;
  const extra = (e) => { e.preventDefault(); menu(e, [
    { label: voice.hand ? 'Baixar a mão' : 'Pedir a vez', fn: toggleHand },
    ch.guild_id && { label: voice.whisperTo ? 'Trocar quem ouve o sussurro…' : 'Sussurrar…', fn: () => whisperPicker() },
    voice.whisperTo && { label: 'Parar de sussurrar', fn: stopWhisper },
    canPriority() && { label: 'Falar com prioridade', checked: !!voice.prio, fn: togglePriority },
    hands.length > 0 && '-',
    ...hands.map((v, i) => ({ label: `${i + 1}º ${nameOf(v.user_id, ch.guild_id)}${v.user_id === S.me.id ? ' (você)' : ''}`, ...(v.user_id === S.me.id || (ch.guild_id && can(ch.guild_id, PERM.VOICE_MOD)) ? { sub: [{ label: 'Baixar a mão', fn: () => lowerHand(v.user_id) }] } : { fn: () => { } }) })),
  ].filter(Boolean)); };
  return h('button.roundbtn.vr-handbtn' + (voice.hand ? '.active' : ''), { title: (voice.hand ? 'Baixar a mão' : 'Pedir a vez') + ' · clique direito: sussurrar' + (canPriority() ? ', falar com prioridade' : ''), 'aria-label': voice.hand ? 'Baixar a mão' : 'Pedir a vez', onclick: toggleHand, oncontextmenu: extra },
    icon('hand', 22), others > 0 && h('span.vr-handn', String(others)));
}
