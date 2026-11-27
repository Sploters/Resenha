// Controle remoto (mouse, teclado e controle de videogame). Dois papéis:
//  - quem ASSISTE pede o controle no quadro da transmissão e, aceito, controla clicando e digitando dentro dele;
//  - quem TRANSMITE recebe o pedido, escolhe o que libera (mouse, teclado, controle) e vê um aviso permanente enquanto durar.
// Transmitindo uma janela (não a tela inteira), os comandos só valem dentro dela: o programa nativo descarta o clique onde
// outra janela a cobre e a tecla quando ela não está em foco. O controle de videogame aparece no PC do dono como um
// controle de Xbox 360 (precisa do driver gratuito ViGEmBus instalado lá).
// A injeção acontece só no app desktop do dono (programa nativo); o navegador comum só pode controlar, nunca ser controlado.
import { h, icon, whenGone } from './util.js';
import { S, toast, modal, desktop } from './state.js';
import { playSound } from './sounds.js';
import { cleanEvent } from './remoteclean.js';

let ctx = {}; // injetado por app.js: send(t, d), name(uid), rerender()
export const initRemote = (c) => { ctx = c; };
const REASON = { declined: 'recusou o pedido de controle', unsupported: 'não pode ser controlado (só pelo app para Windows)', stream_ended: 'parou de transmitir', left: 'saiu da sala', expired: 'não respondeu ao pedido de controle', panic: 'parou o controle remoto', stopped: 'encerrou o controle remoto' };
export const session = () => S.remote || null;
// sessão em que EU controlo com mouse/teclado: a antiga (S.remote, "Pedir controle") ou a de jogador ('play')
export const ctlSess = () => { const s = S.remote; if (s?.state === 'active' && s.controller === S.me.id) return s; const p = myPlay(); return p?.state === 'active' && p.kind === 'play' ? p : null; };
// o quadro da transmissão de uid captura mouse/teclado (borda e cursor de controle)?
export const controlling = (uid) => { const s = ctlSess(); return !!s && s.owner === uid && (s.kind !== 'play' || s.perms.mouse || s.perms.keyboard); };
// "mouse e teclado", "mouse, teclado e controle", "controle"…
export const permsText = (p) => { const l = [p.mouse && 'mouse', p.keyboard && 'teclado', p.gamepad && 'controle'].filter(Boolean); return l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l.at(-1) : l[0] || 'nada'; };
export const pendingFor = (uid) => { const s = S.remote; return !!s && s.state === 'pending' && s.controller === S.me.id && s.owner === uid; };
// ---------- jogar junto ("Pedir para jogar", kind 'play'; o antigo 'pad' ainda chega de páginas velhas) ----------
// Player 2, 3 ou 4 na transmissão de alguém (o dono é o Player 1). Permissões independentes (controle, teclado, mouse),
// escolhidas e alteráveis pelo dono na janela Jogadores (public/players.js). S.pads: id -> sessão (pedido, convite ou ativa).
const pads = () => (S.pads ||= new Map());
export const myPlay = (uid) => [...pads().values()].find(s => s.controller === S.me.id && (!uid || s.owner === uid)) || null;
export const playersOf = (uid) => [...pads().values()].filter(s => s.owner === uid && s.state === 'active').sort((a, b) => a.slot - b.slot);
export const playRequests = () => [...pads().values()].filter(s => s.owner === S.me.id && s.state === 'pending' && !s.invite);
export const sentInvites = () => [...pads().values()].filter(s => s.owner === S.me.id && s.state === 'pending' && s.invite);
let playersHook = null; export const onPlayersChange = (f) => { playersHook = f; };
const playersChanged = () => { try { playersHook?.(); } catch { } };
export function requestPlay(uid) {
  const cur = myPlay();
  if (cur) return cur.owner === uid ? (cur.state === 'active' ? leavePlay(uid) : ctx.send('REMOTE_STOP', { id: cur.id })) : toast(`Você já está jogando na transmissão de ${ctx.name(cur.owner)}. Saia de lá antes.`, true);
  if (S.remote) return toast('Pare o controle remoto antes de pedir para jogar.', true);
  const who = ctx.name(uid), go = () => ctx.send('REMOTE_REQUEST', { to: uid, kind: 'play' });
  if (S.prefs.remoteIntroSeen) return go();
  modal('Pedir para jogar', null, h('div.rmask',
    h('p', `Você vai pedir para jogar na transmissão de ${who}. ${who} escolhe o que você pode usar (controle, teclado ou mouse) e pode mudar ou tirar a qualquer momento.`),
    antiCheatWarning([]), limitations()),
    [{ label: 'Cancelar', cls: 'grey' }, { label: 'Pedir para jogar', fn: () => { S.prefs.remoteIntroSeen = true; ctx.savePrefs?.(); go(); } }]);
}
// ---------- quem transmite: ações da janela Jogadores ----------
export const acceptPlay = (id, perms) => ctx.send('REMOTE_ANSWER', { id, accept: true, capable: true, mouse: !!perms.mouse, keyboard: !!perms.keyboard, gamepad: !!perms.gamepad, rel: !!capCache?.v?.rel });
export const declinePlay = (id) => ctx.send('REMOTE_ANSWER', { id, accept: false, capable: true });
export const setPlayPerms = (id, perms) => ctx.send('REMOTE_PERMS', { id, mouse: !!perms.mouse, keyboard: !!perms.keyboard, gamepad: !!perms.gamepad });
export const invitePlayer = (uid, perms = { gamepad: true }) => ctx.send('REMOTE_INVITE', { to: uid, ...perms, rel: !!capCache?.v?.rel });
export const revokeAll = () => { for (const p of playersOf(S.me.id)) if (p.kind === 'play' && (p.perms.mouse || p.perms.keyboard || p.perms.gamepad)) setPlayPerms(p.id, {}); };
export const autoAccept = { get on() { return !!autoPlay && autoPlay === ctx.channelId?.(); }, set on(v) { autoPlay = v ? ctx.channelId?.() || null : null; playersChanged(); } };
let capCache = null;
export async function ownerCap(fresh) {
  if (!fresh && capCache && Date.now() - capCache.t < 15000) return capCache.v;
  // app antigo pode responder null/undefined: virava "Cannot read properties of null" na janela Jogadores (players.js)
  const v = (desktop?.remoteCapable ? await desktop.remoteCapable().catch(() => null) : { ok: false, reason: 'Jogar junto só funciona com quem transmite pelo app Resenha para Windows.' }) || { ok: false, reason: 'O app não respondeu.' };
  capCache = { t: Date.now(), v }; return v;
}
export async function installPadDriver() {
  const r = await desktop?.padDriverInstall?.().catch(err => ({ ok: false, reason: err.message })) || { ok: false, reason: 'Atualize o app Resenha.' };
  if (r.ok) { capCache = null; for (const p of playersOf(S.me.id)) if (p.kind === 'play') syncBridge(p); }
  return r;
}
export const openPlayers = (o) => import('./players.js').then(m => m.openPlayers(o));
// pedido do tipo antigo ('control' ou 'pad'), como uma página aberta antes da atualização (scripts/remote-test.mjs)
export const requestKind = (uid, kind) => ctx.send('REMOTE_REQUEST', { to: uid, kind });
export const stopPlay = (uid) => { const s = myPlay(uid); if (s) ctx.send('REMOTE_STOP', { id: s.id }); };

// ---------- quem assiste ----------
export function requestControl(uid) {
  const cur = S.remote;
  if (cur) {
    if (cur.state === 'pending' && cur.controller === S.me.id) return toast(`Você já pediu o controle para ${ctx.name(cur.owner)}. Espere a resposta ou cancele o pedido no quadro da transmissão.`);
    return toast(cur.owner === S.me.id ? 'Seu PC já está sendo controlado. Pare essa sessão antes de pedir outra.' : `Você já está controlando o PC de ${ctx.name(cur.owner)}. Pare antes de pedir outro.`, true);
  }
  // primeira vez: explica o que é, os riscos com anti-cheat e as limitações antes de pedir
  if (S.prefs.remoteIntroSeen) return ctx.send('REMOTE_REQUEST', { to: uid });
  modal('Pedir controle remoto', null, h('div.rmask',
    h('p', `Você vai pedir para controlar o mouse, o teclado e/ou o controle de videogame de ${ctx.name(uid)} pela transmissão. A pessoa escolhe o que liberar e pode parar quando quiser.`),
    antiCheatWarning([]), limitations()),
    [{ label: 'Cancelar', cls: 'grey' }, { label: 'Pedir controle', fn: () => { S.prefs.remoteIntroSeen = true; ctx.savePrefs?.(); ctx.send('REMOTE_REQUEST', { to: uid }); } }]);
}
export function stopControl() { if (S.remote) ctx.send('REMOTE_STOP', { id: S.remote.id }); }

// botão nos controles do quadro da transmissão
export function tileButton(uid) {
  const on = controlling(uid), wait = pendingFor(uid);
  return h('button.ibtn' + (on ? '.rec' : ''), { title: on ? 'Parar de controlar' : wait ? 'Aguardando a resposta… (clique para cancelar o pedido)' : 'Pedir controle (mouse, teclado ou controle de videogame)',
    onclick: (e) => { e.stopPropagation(); on || wait ? stopControl() : requestControl(uid); } }, icon('pointer', 18));
}

// eventos capturados no quadro -> servidor. Clique, tecla, rolagem e controle saem NA HORA (antes todos esperavam uma
// fila de 16 ms: ~19 ms dos ~21 ms da ida na LAN, scripts/remote-latency.mjs). Só o movimento é agrupado: no máximo um
// a cada MOVE_MS (o último ponto vale; o pointermove do Chromium já vem ~1 por quadro), e sai junto antes de um clique
let queue = [], lastMove = null, flushTimer = 0, kbOn = false, lastSent = 0;
const MOVE_MS = 8;
const keysDown = new Set(), btnsDown = new Set();
const push = (e) => {
  if (e.k === 'm' || e.k === 'r') {
    // relativo: soma os deslocamentos até sair (o último absoluto vale; um relativo nunca se perde)
    lastMove = e.k === 'r' && lastMove?.k === 'r' ? { k: 'r', dx: lastMove.dx + e.dx, dy: lastMove.dy + e.dy } : e;
    const wait = MOVE_MS - (performance.now() - lastSent);
    if (wait <= 0) { clearTimeout(flushTimer); flush(); } else if (!flushTimer) flushTimer = setTimeout(flush, wait);
    return;
  }
  if (lastMove) { queue.push(lastMove); lastMove = null; }
  queue.push(e); clearTimeout(flushTimer); flush();
};
function flush() {
  flushTimer = 0; lastSent = performance.now(); if (lastMove) { if (lastMove.k === 'r') { const c = (v) => Math.max(-2000, Math.min(2000, Math.round(v))); lastMove = { k: 'r', dx: c(lastMove.dx), dy: c(lastMove.dy) }; } if (lastMove.k !== 'r' || lastMove.dx || lastMove.dy) queue.push(lastMove); lastMove = null; }
  const s = ctlSess(); if (!s || !queue.length) { queue = []; return; }
  while (queue.length) sendInput(s.id, queue.splice(0, 64));
}
// ponto do vídeo (0..1) sob o cursor, descontando as faixas pretas do object-fit: contain
function norm(video, cx, cy) {
  const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !r.width || !r.height) return null;
  const s = Math.min(r.width / vw, r.height / vh), w = vw * s, hh = vh * s, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - hh) / 2;
  const x = (cx - x0) / w, y = (cy - y0) / hh;
  return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y };
}
const videoOf = (t) => t?.closest?.('.tile.screen')?.querySelector('video');
const ownerTile = (t) => { const tile = t?.closest?.('.tile.screen'); return tile && controlling(tile.dataset.sid) ? tile : null; };
const releaseAll = () => { for (const c of keysDown) push({ k: 'ku', c }); keysDown.clear(); for (const b of btnsDown) push({ k: 'u', b }); btnsDown.clear(); };
function setKb(on) {
  if (kbOn === on) return; kbOn = on; if (!on) releaseAll();
  document.querySelectorAll('.tile.screen.controlling').forEach(t => t.classList.toggle('kbcap', on));
}
// tudo no modo captura: o clique dentro do quadro não troca o foco nem abre menus da página
const opts = { capture: true, passive: false };
// mouse travado (jogos 3D): com o cursor preso no quadro, vai o deslocamento (movementX/Y), não a posição
export const relLocked = () => { const l = document.pointerLockElement; return !!l && !!ownerTile(l); };
let relMode = false;
export const relAvailable = () => { const s = ctlSess(); return !!s && s.kind === 'play' && !!s.perms.mouse && !!s.caps?.rel; };
export const relOn = () => relMode && relAvailable();
export function setRelMode(on) { relMode = !!on; if (!relMode && relLocked()) document.exitPointerLock(); if (relMode) toast('Mouse travado: clique na transmissão para travar o cursor; Esc solta.'); paintChip(); }
document.addEventListener('pointerlockchange', () => paintChip());
addEventListener('pointermove', (e) => {
  const t = ownerTile(e.target); if (!t || !ctlSess()?.perms.mouse) return;
  if (relLocked()) { if (relOn() && (e.movementX || e.movementY)) push({ k: 'r', dx: e.movementX, dy: e.movementY }); return; }
  const p = norm(videoOf(t), e.clientX, e.clientY); if (p) push({ k: 'm', ...p });
}, opts);
addEventListener('pointerdown', (e) => {
  const t = ownerTile(e.target); if (!t) { setKb(false); return; }
  if (e.target.closest('.tctl, .remote-chip, button')) return; // botões do próprio quadro continuam funcionando
  e.preventDefault(); e.stopPropagation(); setKb(true);
  if (!ctlSess()?.perms.mouse || e.button > 2) return;
  if (relOn() && !relLocked()) { try { const r = t.requestPointerLock({ unadjustedMovement: true }); r?.catch?.(() => t.requestPointerLock()); } catch { t.requestPointerLock(); } return; } // 1º clique só trava
  if (relLocked()) { push({ k: 'd', b: e.button }); btnsDown.add(e.button); return; }
  const p = norm(videoOf(t), e.clientX, e.clientY); if (!p) return;
  push({ k: 'm', ...p }); push({ k: 'd', b: e.button }); btnsDown.add(e.button);
}, opts);
addEventListener('pointerup', (e) => { if (!btnsDown.has(e.button)) return; e.preventDefault(); e.stopPropagation(); btnsDown.delete(e.button); push({ k: 'u', b: e.button }); }, opts);
addEventListener('click', (e) => { if (ownerTile(e.target) && !e.target.closest('.tctl, .remote-chip, button')) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('dblclick', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('contextmenu', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('wheel', (e) => {
  const t = ownerTile(e.target); if (!t || !ctlSess()?.perms.mouse) return;
  e.preventDefault(); e.stopPropagation();
  const f = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1.2; // pixels/linhas/páginas -> unidades do Windows (120 por "dente")
  const cl = (v) => Math.max(-2400, Math.min(2400, Math.round(v * f)));
  if (e.deltaX || e.deltaY) push({ k: 'w', dx: cl(e.deltaX), dy: cl(e.deltaY) });
}, opts);
const keyHandler = (down) => (e) => {
  const cs = ctlSess(); if (!kbOn || !cs || !cs.perms.keyboard || !e.code) return;
  e.preventDefault(); e.stopPropagation();
  if (down) { if (e.repeat && keysDown.has(e.code)) { push({ k: 'kd', c: e.code }); return; } keysDown.add(e.code); push({ k: 'kd', c: e.code }); }
  else if (keysDown.delete(e.code)) push({ k: 'ku', c: e.code });
};
addEventListener('keydown', keyHandler(true), true);
addEventListener('keyup', keyHandler(false), true);
addEventListener('blur', () => { if (S.remote || myPlay()) { setKb(false); releaseAll(); padNeutral(); flush(); } });

// controle de videogame de quem controla (Gamepad API): lê ~60 vezes por segundo e manda o estado inteiro só quando muda.
// Sem foco na janela o navegador para de atualizar o controle: manda tudo solto para nada ficar apertado no PC do dono.
let padTimer = 0, padLast = '', padHinted = false;
const DEAD = 0.08; // zona morta dos analógicos (controles gastos "andam" sozinhos)
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.round(v * 1e3) / 1e3);
function readPad() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean), g = pads.find(p => p.mapping === 'standard') || pads[0];
  if (!g) return null;
  let b = 0; g.buttons.forEach((x, i) => { if (i < 17 && i !== 6 && i !== 7 && x.pressed) b |= 1 << i; });
  const ax = [0, 1, 2, 3].map(i => dz(g.axes[i] || 0));
  return { k: 'g', b, ax, lt: Math.round((g.buttons[6]?.value || 0) * 1e3) / 1e3, rt: Math.round((g.buttons[7]?.value || 0) * 1e3) / 1e3 };
}
// para onde vai o controle: a sessão de jogador (jogar junto) ou a de controle remoto com o controle liberado
const padTarget = () => { const p = myPlay(); if (p?.state === 'active' && (p.kind === 'pad' || p.perms.gamepad)) return p; const s = S.remote; return s && s.state === 'active' && s.controller === S.me.id && s.perms.gamepad ? s : null; };
const NEUTRAL = { k: 'g', b: 0, ax: [0, 0, 0, 0], lt: 0, rt: 0 };
// jogador: manda direto (só o estado que mudou, ~60/s no máximo); controle remoto: pela fila junto com mouse e teclado
function padSend(st, s = padTarget()) { if (!s) return; if (s.kind === 'pad' || s.kind === 'play') sendInput(s.id, [st || NEUTRAL]); else push(st || NEUTRAL); }
function padNeutral() { if (padLast && padLast !== '0') { padLast = '0'; padSend(null); } }
function padTick() {
  const s = padTarget();
  if (!s) { clearInterval(padTimer); padTimer = 0; padLast = ''; return; }
  if (!document.hasFocus()) return padNeutral();
  const st = readPad(); if (!st) return;
  const key = st.b || st.ax.some(Boolean) || st.lt || st.rt ? JSON.stringify(st) : '0';
  if (key !== padLast) { padLast = key; padSend(st, s); }
}
function padStart() {
  if (padTimer) return;
  padTimer = setInterval(padTick, 16); padLast = '';
  if (!padHinted && !readPad()) { padHinted = true; toast('Ligue o controle neste PC e aperte qualquer botão para o navegador reconhecer.'); }
}

// ---------- quem transmite ----------
let askDlg = null, askTimer = 0;
async function onRequest(s) {
  const who = ctx.name(s.controller);
  const cap = desktop?.remoteCapable ? await desktop.remoteCapable() : { ok: false, reason: 'O controle remoto só funciona no app Resenha para Windows.' };
  if (!cap.ok) { ctx.send('REMOTE_ANSWER', { id: s.id, accept: false, capable: false }); toast(`${who} pediu para controlar seu PC, mas não é possível: ${cap.reason}`, true); return; }
  playSound('ring');
  const mouse = h('input', { type: 'checkbox', checked: true }), kb = h('input', { type: 'checkbox', checked: true });
  const pad = h('input', { type: 'checkbox', checked: false, disabled: !cap.pad }); // controle: só com o driver ViGEmBus aqui
  let answered = false;
  const answer = (accept) => { if (answered) return; answered = true; clearTimeout(askTimer); askDlg = null; ctx.send('REMOTE_ANSWER', { id: s.id, accept, mouse: mouse.checked, keyboard: kb.checked, gamepad: pad.checked && !pad.disabled, capable: true }); };
  askDlg = modal(`${who} quer controlar seu PC`, null, h('div.rmask',
    h('p', `${who} vai poder mexer no seu computador pela transmissão, como se estivesse sentado aí. Só aceite se confiar nessa pessoa.`),
    h('label.rmopt', mouse, h('span', h('b', 'Mouse'), h('small', 'mover, clicar, arrastar e rolar'))),
    h('label.rmopt', kb, h('span', h('b', 'Teclado'), h('small', 'digitar e usar atalhos'))),
    h('label.rmopt' + (cap.pad ? '' : '.off'), pad, h('span', h('b', 'Controle de videogame'),
      cap.pad ? h('small', 'aparece aqui como um controle de Xbox 360 enquanto durar')
        : h('small', 'precisa do driver gratuito ', h('a', { href: 'https://github.com/nefarius/ViGEmBus/releases', target: '_blank', rel: 'noopener' }, 'ViGEmBus'), ' instalado neste PC (reinicie o app depois)'))),
    cap.window && h('p.rmwin', 'Você está transmitindo uma janela: os comandos só valem dentro dela, e só quando ela está na frente. O resto do PC fica de fora.'),
    antiCheatWarning(cap.antiCheats || []),
    h('ul.rmnotes',
      h('li', 'Para parar a qualquer momento: botão ', h('b', 'Parar'), ' no aviso vermelho ou ', h('b', 'Ctrl+Alt+Shift+Q'), ' (só o seu teclado aciona).'),
      h('li', 'Acaba sozinho se alguém sair da sala ou você parar de transmitir.')),
    limitations()),
    [{ label: 'Recusar', cls: 'grey', fn: () => answer(false) }, { label: 'Permitir', cls: 'red', fn: () => { if (!mouse.checked && !kb.checked && !(pad.checked && !pad.disabled)) { toast('Escolha mouse, teclado ou controle', true); return false; } answer(true); } }]);
  // fechou a janela no X, Esc ou "voltar" sem escolher: conta como recusa (antes o pedido ficava pendurado até expirar)
  const dlg = askDlg; whenGone(dlg.el, () => { if (!dlg.quiet) answer(false); }); // quiet: fechada porque o pedido acabou
  askTimer = setTimeout(() => { answered = true; dlg.close(); if (askDlg === dlg) askDlg = null; }, 30000); // o servidor expira o pedido e avisa
}
// pedido para jogar junto: só o controle (nada de mouse/teclado). "Aceitar os próximos nesta chamada" vale até sair da sala.
// Sem o driver do controle virtual aqui, o botão instala (baixa o oficial, confere e abre com o UAC) e aceita em seguida.
let autoPlay = null; // id da sala onde os próximos pedidos são aceitos sozinhos
const padAsks = new Map(); // id do pedido -> janela aberta
async function onPadRequest(s) {
  const who = ctx.name(s.controller), say = (accept, capable = true) => ctx.send('REMOTE_ANSWER', { id: s.id, accept, gamepad: accept, capable });
  let cap = desktop?.remoteCapable ? await desktop.remoteCapable() : { ok: false, reason: 'Jogar junto só funciona com quem transmite pelo app Resenha para Windows.' };
  if (!cap.ok) { say(false, false); toast(`${who} quis jogar junto, mas não é possível: ${cap.reason}`, true); return; }
  if (autoPlay && autoPlay === s.channel_id && cap.pad) { say(true); return; }
  playSound('ring');
  const auto = h('input', { type: 'checkbox', checked: autoPlay === s.channel_id });
  const drv = h('div.rmdrv');
  const paintDrv = () => drv.replaceChildren(...(cap.pad ? [] : [h('p.rmwarn', 'Para o controle de quem joga aparecer aqui, este PC precisa do driver gratuito ViGEmBus (controle virtual de Xbox, o mesmo que o Parsec usava). O Windows vai pedir permissão de administrador uma vez.'),
    h('button.btn.sm', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Instalando… siga o instalador';
      const r = await desktop?.padDriverInstall?.().catch(err => ({ ok: false, reason: err.message })) || { ok: false, reason: 'Atualize o app Resenha.' };
      if (r.ok) { cap = { ...cap, pad: true }; toast('Controles ativados neste PC'); paintDrv(); } else { b.disabled = false; b.textContent = 'Instalar o driver'; toast(r.reason, true); } } }, 'Instalar o driver')]));
  paintDrv();
  let answered = false;
  const answer = (accept) => { if (answered) return; answered = true; padAsks.delete(s.id); if (accept && auto.checked) autoPlay = s.channel_id; say(accept); };
  const dlg = modal(`${who} quer jogar junto`, null, h('div.rmask',
    h('p', `${who} vai entrar como mais um jogador, com o próprio controle (Xbox, DualSense…). No seu PC ele aparece como um controle de Xbox 360 a mais; o seu continua sendo o jogador 1. Mouse e teclado ficam só com você.`),
    drv,
    h('label.rmopt', auto, h('span', h('b', 'Aceitar os próximos pedidos nesta chamada'), h('small', 'até 3 jogadores; vale até você sair da sala'))),
    antiCheatWarning(cap.antiCheats || [])),
    [{ label: 'Recusar', cls: 'grey', fn: () => answer(false) }, { label: 'Deixar jogar', fn: () => { if (!cap.pad) { toast('Instale o driver primeiro (botão acima)', true); return false; } answer(true); } }]);
  padAsks.set(s.id, dlg);
  whenGone(dlg.el, () => { if (!dlg.quiet) answer(false); });
  setTimeout(() => { if (!answered) { answered = true; dlg.quiet = true; dlg.close(); padAsks.delete(s.id); } }, 30000);
}
const kicked = new Set(); // tirados por mim: o fim vem com 'stopped', igual a quando o jogador sai sozinho
export const kickPlayer = (id) => { kicked.add(id); ctx.send('REMOTE_STOP', { id }); };
desktop?.onRemoteEvent?.((k) => {
  if (k === 'panic') for (const p of playersOf(S.me.id)) ctx.send('REMOTE_STOP', { id: p.id, reason: 'panic' }); // atalho de emergência: todo mundo sai
  if (k === 'panic' && S.remote?.owner === S.me.id) ctx.send('REMOTE_STOP', { id: S.remote.id, reason: 'panic' });
  if (k === 'blocked') toast('O Windows bloqueou o controle: a janela em foco foi aberta como administrador.', true);
  if (k === 'covered') toast('Um comando do controle remoto foi ignorado: a janela transmitida estava coberta, minimizada ou fora de foco.', true);
  if (k === 'nopad') toast('O controle de videogame não funcionou: o driver ViGEmBus não respondeu neste PC.', true);
});

// jogos com anti-cheat: a entrada injetada pode ser ignorada ou tratada como trapaça (risco de banimento da conta do dono)
export function antiCheatWarning(found) {
  const hot = found.length > 0;
  return h('div.rmwarn' + (hot ? '.hot' : ''),
    h('b', hot ? `Anti-cheat rodando agora: ${found.join(', ')}` : 'Cuidado com jogos com anti-cheat'),
    h('p', 'Jogos online com anti-cheat (Valorant, League of Legends, Fortnite, Apex, PUBG, Rainbow Six, CS2 com FACEIT, Call of Duty, Battlefield e outros) podem ', h('b', 'ignorar'), ' os comandos do controle remoto ou considerá-los ', h('b', 'trapaça'), '. Quem corre risco de suspensão ou banimento é a conta do jogo ', h('b', 'neste PC'), ', não a de quem controla.'),
    h('p', hot ? 'Recomendado: recuse, ou feche o jogo antes de permitir.' : 'Recomendado: não use com esses jogos abertos. Para ajudar alguém com o PC (programas, configurações, jogos sem anti-cheat) não há problema.'));
}
// o que o controle remoto não faz (aparece no pedido e no "saiba mais")
export function limitations() {
  return h('details.rmlimits', h('summary', 'Limitações'),
    h('ul',
      h('li', 'Só funciona com quem transmite pelo app para Windows (não pelo navegador). Transmitindo uma ', h('b', 'janela'), ', os comandos só valem dentro dela e com ela na frente.'),
      h('li', 'Programas abertos ', h('b', 'como administrador'), ' não recebem os comandos (regra do Windows); você vê um aviso quando acontecer.'),
      h('li', 'Jogos em ', h('b', 'tela cheia exclusiva'), ' podem não receber os comandos e às vezes aparecem pretos na transmissão; use "janela sem bordas".'),
      h('li', h('b', 'Ctrl+Alt+Del'), ' e a tela de bloqueio/UAC do Windows não podem ser controlados.'),
      h('li', 'Há um pequeno atraso: os comandos vão pelo mesmo caminho do vídeo (direto ao servidor de voz) e, se ele não estiver disponível, pelo servidor do app, que é mais lento.'),
      h('li', 'Controle de videogame: quem controla usa o próprio controle ligado no PC dele; no PC de quem transmite ele aparece como um controle de Xbox 360 (precisa do driver gratuito ViGEmBus instalado lá).'),
      h('li', 'Com vários monitores, só o monitor transmitido é controlado.')));
}

// ---------- medições para o painel Desempenho (public/perfpanel.js) ----------
// perf.rtt: id da sessão -> [{ at, ms }] do eco de comando; perf.host: id -> resumo de quem transmite (vem no eco);
// perf.inputs: id -> comandos por segundo que chegaram aqui (quem transmite)
export const perf = { rtt: new Map(), host: new Map(), inputs: new Map() };
export const sessionsForPing = () => { const a = [...pads().values()].filter(s => s.state === 'active' && s.kind === 'play' && (s.owner === S.me.id || s.controller === S.me.id)); if (S.remote?.state === 'active') a.push(S.remote); return a; };
export const sendPing = (id) => ctx.send('REMOTE_PING', { id, t: performance.now() });

// ---------- canal direto dos comandos (DataChannel pelo SFU) ----------
// Pelo gateway, cada comando ia de quem joga até o servidor e de lá até quem transmite, as duas vezes pela Cloudflare
// (WebSocket/TCP, junto com o resto do app). Pelo canal de dados do WebRTC ele segue o caminho da mídia (UDP direto ao
// SFU). Quem joga cria o canal e avisa (REMOTE_DC ready); quem transmite assina o canal daquela pessoa e confirma (on).
// Só então os comandos passam por ele; caiu (reconexão, túnel de voz, navegador sem SCTP), voltam sozinhos pelo gateway.
// Como o servidor não confere o que passa por aqui, quem transmite confere cada evento (remoteclean.js, a mesma regra do
// servidor), a permissão da sessão, quem mandou (o SFU diz de quem é o canal) e a taxa.
const dc = { prod: null, sfu: null, making: false, on: new Set(), want: new Set(), told: new Set() };
const hostDc = new Map(); // uid de quem joga -> { c, sfu }
const hostTry = new Map(); // uid -> última tentativa de assinar
const dcBucket = new Map(); // id da sessão -> { b, t }
const DC_RATE = 400, DC_BURST = 800;
export const dcState = () => ({ prod: dc.prod?.readyState || null, on: [...dc.on], host: [...hostDc.keys()] }); // testes/painel
const vc = () => ctx.voice?.();
const calm = () => !keysDown.size && !btnsDown.size && (!padLast || padLast === '0'); // nada apertado: trocar de caminho sem inverter apertar/soltar
function sendInput(id, ev) {
  if (dc.want.has(id) && calm()) { dc.want.delete(id); dc.on.add(id); }
  const p = dc.prod;
  if (dc.on.has(id) && p && !p.closed && p.readyState === 'open' && dc.sfu === vc()?.sfu && (p.bufferedAmount || 0) < 65536) {
    try { p.send(JSON.stringify({ i: id, e: ev })); return; } catch { }
  }
  ctx.send('REMOTE_INPUT', { id, ev });
}
const ctlIds = () => { const a = [...pads().values()].filter(s => s.state === 'active' && s.controller === S.me.id).map(s => s.id); if (S.remote?.state === 'active' && S.remote.controller === S.me.id) a.push(S.remote.id); return a; };
const hostSessions = () => { const a = [...pads().values()].filter(s => s.state === 'active' && s.owner === S.me.id && s.kind !== 'pad'); if (S.remote?.state === 'active' && S.remote.owner === S.me.id) a.push(S.remote); return a; };
let dcTimer = 0;
function dcSync() {
  const v = vc(), sfu = v?.sfu, ids = ctlIds(), hosts = hostSessions();
  for (const id of [...dc.on, ...dc.want, ...dc.told]) if (!ids.includes(id)) { dc.on.delete(id); dc.want.delete(id); dc.told.delete(id); }
  // quem joga: um canal por conexão de voz, criado na primeira sessão
  if (ids.length && sfu?.ready && sfu.send && !v.tunnel && !dc.making && (dc.sfu !== sfu || !dc.prod || dc.prod.closed)) {
    dc.making = true; dc.on.clear(); dc.want.clear(); dc.told.clear();
    sfu.send.produceData({ ordered: true, label: 'input' }).then((p) => {
      dc.prod = p; dc.sfu = sfu;
      const lost = () => { if (dc.prod === p) { dc.prod = null; dc.on.clear(); dc.want.clear(); dc.told.clear(); } };
      p.on('open', dcSync); p.on('close', lost); p.on('transportclose', lost); p.on('error', () => { });
    }).catch(() => { dc.prod = null; }).finally(() => { dc.making = false; });
  }
  if (dc.prod?.readyState === 'open' && dc.sfu === sfu) for (const id of ids) if (!dc.told.has(id)) { dc.told.add(id); ctx.send('REMOTE_DC', { id, ready: true }); }
  // quem transmite: assina o canal de cada jogador ativo (tenta de novo a cada 5 s se ainda não existir)
  for (const [uid, x] of hostDc) if (x.sfu !== sfu || !hosts.some(s => s.controller === uid)) { hostDc.delete(uid); x.c.close(); }
  for (const s of hosts) if (!hostDc.has(s.controller) && Date.now() - (hostTry.get(s.controller) || 0) > 5000) dcConsume(s.controller);
  if (ids.length || hosts.length) { if (!dcTimer) dcTimer = setInterval(dcSync, 3000); } else if (dcTimer) { clearInterval(dcTimer); dcTimer = 0; }
}
async function dcConsume(uid) {
  const v = vc(), sfu = v?.sfu; if (!sfu?.ready || !sfu.recv || v.tunnel) return;
  hostTry.set(uid, Date.now());
  const r = await v.sfuReq('consume_data', { transport_id: sfu.recv.id, from: uid }).catch(() => null);
  if (!r?.id || vc()?.sfu !== sfu) return;
  const c = await sfu.recv.consumeData({ id: r.id, dataProducerId: r.dataProducerId, sctpStreamParameters: r.sctpStreamParameters, label: r.label, protocol: r.protocol }).catch(() => null);
  if (!c) return;
  const old = hostDc.get(uid); const x = { c, sfu }; hostDc.set(uid, x); old?.c.close();
  const tell = (on) => { for (const s of hostSessions()) if (s.controller === uid) ctx.send('REMOTE_DC', { id: s.id, on }); };
  const gone = () => { if (hostDc.get(uid) === x) { hostDc.delete(uid); hostTry.delete(uid); tell(false); } };
  if (c.readyState === 'open') tell(true); else c.on('open', () => tell(true));
  c.on('message', (m) => onDcMessage(uid, m));
  c.on('close', gone); c.on('transportclose', gone); c.on('dataproducerclose', gone); c.on('error', () => { });
}
function onDcMessage(from, m) {
  if (typeof m !== 'string' || m.length > 16384) return;
  let d; try { d = JSON.parse(m); } catch { return; }
  if (!d || typeof d.i !== 'string' || !Array.isArray(d.e)) return;
  const s = S.remote?.id === d.i ? S.remote : pads().get(d.i);
  if (!s || s.state !== 'active' || s.owner !== S.me.id || s.controller !== from) return;
  const t = performance.now(), bk = dcBucket.get(s.id) || { b: DC_BURST, t }; bk.b = Math.min(DC_BURST, bk.b + (t - bk.t) / 1000 * DC_RATE); bk.t = t; dcBucket.set(s.id, bk);
  const perms = s.caps?.rel ? { ...s.perms, rel: true } : s.perms, ev = [];
  for (const e of d.e.slice(0, 64)) { if (bk.b < 1) break; const c = cleanEvent(e, perms); if (c) { bk.b -= 1; ev.push(c); } }
  if (ev.length) onRemoteEvent('REMOTE_INPUT', { id: s.id, ev });
}
let hostCache = null, hostAt = 0;
function onPing(d) {
  const mineHost = pads().get(d.id)?.owner === S.me.id || S.remote?.id === d.id && S.remote.owner === S.me.id;
  ctx.send('REMOTE_PONG', { id: d.id, t: d.t, ...(mineHost && hostCache ? { h: hostCache } : {}) }); // responde já (o resumo é o da última leitura)
  if (mineHost && performance.now() - hostAt > 2000) { hostAt = performance.now(); import('./perfpanel.js').then(m => m.hostSummary()).then(h => { hostCache = h; }, () => { }); }
}
function onPong(d) {
  if (typeof d.t !== 'number') return;
  const ms = performance.now() - d.t; if (!(ms >= 0 && ms < 30000)) return;
  const a = perf.rtt.get(d.id) || []; a.push({ at: Date.now(), ms }); if (a.length > 120) a.shift(); perf.rtt.set(d.id, a);
  if (d.h) perf.host.set(d.id, { at: performance.now(), h: d.h });
}
function countInputs(id, n) {
  const c = perf.inputs.get(id) || { n: 0, t: performance.now(), rate: 0 }; c.n += n;
  const dt = performance.now() - c.t; if (dt >= 1000) { c.rate = Math.round(c.n * 1000 / dt); c.n = 0; c.t = performance.now(); }
  perf.inputs.set(id, c);
}
export const openPerf = (uid) => import('./perfpanel.js').then(m => m.openPerf(uid));
// ---------- eventos do servidor ----------
let pendingTimer = 0;
export function onRemoteEvent(t, d) {
  if (t === 'REMOTE_REQUEST') return d.kind === 'pad' ? onPadRequest(d) : d.kind === 'play' ? onPlayRequest(d) : onRequest(d);
  if (t === 'REMOTE_ERROR') return toast(d.error, true);
  if (t === 'REMOTE_PING') return onPing(d);
  if (t === 'REMOTE_PONG') return onPong(d);
  if (t === 'REMOTE_DC') { // canal direto: quem transmite confirmou (on) ou perdeu; quem joga avisou que o canal existe (ready)
    if (ctlIds().includes(d.id)) { if (d.on) { if (dc.on.has(d.id)) { } else if (calm()) dc.on.add(d.id); else dc.want.add(d.id); } else { dc.on.delete(d.id); dc.want.delete(d.id); } }
    else if (d.ready) { const s = hostSessions().find(x => x.id === d.id); if (s) dcConsume(s.controller); }
    return;
  }
  if (t === 'REMOTE_INPUT') { countInputs(d.id, d.ev?.length || 0); if (S.remote?.id === d.id && S.remote.owner === S.me.id) desktop?.remoteInput?.(d.ev); else if (pads().get(d.id)?.owner === S.me.id) routeInput(pads().get(d.id), d.ev); return; }
  if (t !== 'REMOTE_STATE') return;
  queueMicrotask(dcSync);
  if (d.kind === 'pad' || d.kind === 'play') return padState(d);
  const mine = d.owner === S.me.id, other = ctx.name(mine ? d.controller : d.owner);
  if (d.state === 'ended') {
    const was = S.remote; S.remote = null; setKb(false); queue = []; lastMove = null;
    if (mine) { desktop?.remoteStop?.('ctl'); if (askDlg) { askDlg.quiet = true; askDlg.close(); } askDlg = null; }
    if (was?.id === d.id || !was) {
      const r = d.reason || 'stopped';
      if (mine) { if (was?.state === 'active') toast('Controle remoto encerrado'); } // recusar/expirar o pedido: quem recusou não precisa de aviso
      else if (r === 'cancelled') toast('Pedido de controle cancelado');
      else toast(`${other} ${REASON[r] || 'encerrou o controle remoto'}`, r !== 'stopped' && r !== 'panic' && r !== 'expired');
    }
  } else {
    const before = S.remote; S.remote = d;
    // rede de segurança: se o aviso de expiração do servidor se perder, o pedido pendente não trava o botão para sempre
    clearTimeout(pendingTimer);
    if (d.state === 'pending') pendingTimer = setTimeout(() => { if (S.remote?.id === d.id && S.remote.state === 'pending') onRemoteEvent('REMOTE_STATE', { ...d, state: 'ended', reason: 'expired' }); }, 35000);
    if (d.state === 'active' && before?.state !== 'active') {
      if (mine) {
        desktop?.remoteStart?.({ who: other, perms: d.perms }).then(r => { if (!r?.ok) { toast(r?.reason || 'Não foi possível iniciar o controle remoto', true); ctx.send('REMOTE_STOP', { id: d.id }); } });
      } else {
        toast(`${other} liberou: ${permsText(d.perms)}. ${d.perms.mouse || d.perms.keyboard ? 'Clique na transmissão para controlar. ' : ''}Evite jogos com anti-cheat.`);
        if (d.perms.gamepad) padStart();
      }
    }
  }
  paintChip(); ctx.rerender();
}
const PLAY_END = { declined: 'recusou', unsupported: 'não pode receber jogadores (só pelo app para Windows)', expired: 'não respondeu', stream_ended: 'parou de transmitir', left: 'saiu da sala', full: 'já tem 4 jogadores', panic: 'tirou todos os jogadores', cancelled: 'cancelou o convite' };
// ponte com o app desktop de quem transmite. Funciona com o app que as pessoas já têm: o controle do jogador vai numa
// entrada 'pad' (vaga = Player N) e o mouse/teclado numa 'control' à parte (id + ':kb'); muda conforme as permissões
const bridge = new Map(); // id -> { pad, kb, m, k }
const bridgeQ = new Map(); // id -> promessa (as mudanças de uma pessoa em ordem)
function syncBridge(s) {
  const run = async () => {
    const cur = bridge.get(s.id) || { pad: false, kb: false }, live = pads().get(s.id);
    const p = live?.state === 'active' ? live.perms : { mouse: false, keyboard: false, gamepad: false }, who = ctx.name(s.controller);
    const next = { ...cur };
    if (p.gamepad && !cur.pad) { const r = await desktop?.remoteStart?.({ id: s.id, who, kind: 'pad', slot: live.slot }); next.pad = !!r?.ok; if (!r?.ok) toast(r?.reason || `O controle de ${who} não ligou neste PC`, true); }
    if (!p.gamepad && cur.pad) { desktop?.remoteStop?.(s.id); next.pad = false; }
    const kb = !!(p.mouse || p.keyboard);
    if (kb && (!cur.kb || cur.m !== p.mouse || cur.k !== p.keyboard)) { const r = await desktop?.remoteStart?.({ id: s.id + ':kb', who, kind: 'control', perms: { mouse: p.mouse, keyboard: p.keyboard, gamepad: false } }); next.kb = !!r?.ok; next.m = p.mouse; next.k = p.keyboard; if (!r?.ok) toast(r?.reason || 'Não foi possível ligar o mouse/teclado', true); }
    if (!kb && cur.kb) { desktop?.remoteStop?.(s.id + ':kb'); next.kb = false; }
    if (next.pad || next.kb) bridge.set(s.id, next); else bridge.delete(s.id);
  };
  const q = (bridgeQ.get(s.id) || Promise.resolve()).then(run, run); bridgeQ.set(s.id, q); q.finally(() => { if (bridgeQ.get(s.id) === q) bridgeQ.delete(s.id); });
  return q;
}
function routeInput(s, ev) {
  if (s.kind === 'pad') return desktop?.remoteInput?.(ev, s.id);
  const b = bridge.get(s.id); if (!b) return;
  const g = ev.filter(e => e.k === 'g'), o = ev.filter(e => e.k !== 'g');
  if (g.length && b.pad) desktop?.remoteInput?.(g, s.id);
  if (o.length && b.kb) desktop?.remoteInput?.(o, s.id + ':kb');
}
// reconectou (READY): o servidor manda o estado de novo depois do VOICE_RESUME; até lá, nada fica ligado aqui
const quiet = new Set(); // ids que voltam sem aviso
export function remoteReconnected() {
  for (const s of [...pads().values()]) { quiet.add(s.id); if (s.owner === S.me.id) { if (s.kind === 'pad') desktop?.remoteStop?.(s.id); else { pads().delete(s.id); syncBridge(s); } } pads().delete(s.id); }
  setTimeout(() => quiet.clear(), 15000);
  paintChip(); playersChanged();
}
const inviteDlgs = new Map();
async function showInvite(d) {
  const who = ctx.name(d.owner);
  playSound('ring');
  const dlg = modal(`${who} convidou você para jogar`, null, h('div.rmask',
    h('p', `Você entra na transmissão de ${who} como mais um jogador. Liberado agora: `, h('b', permsText(d.perms)), `. ${who} pode mudar isso a qualquer momento.`),
    antiCheatWarning([])),
    [{ label: 'Recusar', cls: 'grey', fn: () => ctx.send('REMOTE_JOIN', { id: d.id, accept: false }) },
     { label: 'Jogar', fn: () => { ctx.send('REMOTE_JOIN', { id: d.id, accept: true }); import('./share.js').then(m => { m.watchOnly(d.owner); ctx.rerender(); }).catch(() => { }); } }]);
  inviteDlgs.set(d.id, dlg);
  whenGone(dlg.el, () => { if (inviteDlgs.get(d.id) === dlg) inviteDlgs.delete(d.id); if (!dlg.quiet && pads().get(d.id)?.state === 'pending') ctx.send('REMOTE_JOIN', { id: d.id, accept: false }); });
}
function padState(d) {
  const mine = d.owner === S.me.id, other = ctx.name(mine ? d.controller : d.owner), before = pads().get(d.id), hush = quiet.has(d.id);
  if (d.state === 'ended') {
    pads().delete(d.id);
    for (const m of [padAsks, inviteDlgs]) { const dlg = m.get(d.id); if (dlg) { dlg.quiet = true; dlg.close(); m.delete(d.id); } }
    const r = d.reason || 'stopped';
    if (mine) {
      if (d.kind === 'pad') desktop?.remoteStop?.(d.id); else syncBridge(d);
      if (before?.state === 'active' && !kicked.has(d.id) && r !== 'stream_ended' && r !== 'panic') toast(`${other} saiu do jogo`);
      else if (r === 'invite_declined') toast(`${other} recusou o convite para jogar`);
      kicked.delete(d.id);
      if (['stream_ended', 'left', 'panic'].includes(r)) autoPlay = null;
    } else {
      if (r === 'cancelled' && before?.invite) toast(`${other} cancelou o convite`);
      else if (r === 'cancelled' || r === 'invite_declined' || (r === 'stopped' && before?.state === 'active' && padLeaving)) { if (r === 'cancelled') toast('Pedido para jogar cancelado'); else if (r === 'stopped') toast('Você saiu do jogo'); }
      else toast(`${other} ${PLAY_END[r] || (before?.state === 'active' ? 'tirou você do jogo' : 'encerrou o jogo')}`, r !== 'stopped');
      padLeaving = false; if (before?.kind === 'play') { setKb(false); releaseAll(); if (relLocked()) document.exitPointerLock(); relMode = false; }
    }
  } else {
    pads().set(d.id, d);
    if (mine) {
      if (d.state === 'active') {
        if (d.kind === 'pad') { if (before?.state !== 'active') desktop?.remoteStart?.({ id: d.id, who: other, kind: 'pad', slot: d.slot }).then(r => { if (!r?.ok) { toast(r?.reason || 'Não foi possível ligar o controle virtual', true); ctx.send('REMOTE_STOP', { id: d.id }); } else toast(`${other} entrou como jogador ${d.slot}`); }); }
        else { syncBridge(d); if (before?.state !== 'active' && !hush) toast(`${other} entrou como Player ${d.slot}`); }
      }
    } else if (d.state === 'pending' && d.invite && !before && !hush) showInvite(d);
    else if (d.state === 'active') {
      const dlg = inviteDlgs.get(d.id); if (dlg) { dlg.quiet = true; dlg.close(); inviteDlgs.delete(d.id); }
      const ctl = d.perms.mouse || d.perms.keyboard;
      if (before?.state !== 'active') { if (!hush) toast(d.kind === 'pad' ? `Você é o jogador ${d.slot} na transmissão de ${other}. Use o seu controle.` : `Você é o Player ${d.slot} de ${other}. Liberado: ${permsText(d.perms)}.${ctl ? ' Clique na transmissão para usar o ' + [d.perms.mouse && 'mouse', d.perms.keyboard && 'teclado'].filter(Boolean).join(' e ') + '.' : ''}`); }
      else if (JSON.stringify(before.perms) !== JSON.stringify(d.perms)) {
        toast(d.reason === 'mouse_moved' ? `${other} passou o mouse para outro jogador. Liberado: ${permsText(d.perms)}` : `${other} mudou suas permissões. Liberado: ${permsText(d.perms)}`);
        if (!d.perms.keyboard || !d.perms.mouse) { if (!d.perms.keyboard) setKb(false); releaseAll(); flush(); if (!d.perms.mouse && relLocked()) document.exitPointerLock(); }
      }
      if (d.kind === 'pad' || d.perms.gamepad) padStart();
    }
  }
  gameProfile();
  paintChip(); ctx.rerender(); playersChanged();
}
// perfil de jogo (definição do dono do projeto): ao entrar o 1º jogador, quem transmite passa a 60 FPS (o quadro que mostra
// a reação espera em média meio intervalo: ~17 ms a 30 FPS, ~8 ms a 60; e no Windows, 60 FPS leva ao caminho nativo);
// quando o último sai, volta ao que era. Se a pessoa mudar a qualidade no meio, a escolha dela fica.
let profile = null; // { prev: { fps, hint }, set: { fps, hint } }
function gameProfile() {
  const v = ctx.voice?.(); if (!v) return;
  const n = playersOf(S.me.id).length, o = v.screenOpts;
  if (n && !profile && v.screen && o) {
    const set = { fps: Math.max(60, +o.fps || 0), hint: 'motion' };
    profile = { prev: { fps: o.fps, hint: o.hint }, set };
    if (+o.fps !== set.fps || o.hint !== set.hint) { v.changeScreenQuality(set).catch?.(() => { }); toast(`Perfil de jogo: transmissão a ${set.fps} FPS enquanto houver jogadores`); }
  } else if (!n && profile) {
    const p = profile; profile = null;
    if (v.screen && o && +o.fps === p.set.fps && o.hint === p.set.hint && (+p.prev.fps !== p.set.fps || p.prev.hint !== p.set.hint)) v.changeScreenQuality(p.prev).catch?.(() => { });
  }
}
export const gameProfileState = () => profile && { ...profile }; // para o painel de desempenho e os testes
// pedido para jogar (novo): sem diálogo bloqueante; a janela Jogadores abre com o pedido (Aceitar já com "Controle")
async function onPlayRequest(s) {
  pads().set(s.id, s); playersChanged();
  const cap = await ownerCap();
  if (!cap.ok) { pads().delete(s.id); ctx.send('REMOTE_ANSWER', { id: s.id, accept: false, capable: false }); toast(`${ctx.name(s.controller)} pediu para jogar, mas não é possível: ${cap.reason}`, true); playersChanged(); return; }
  if (autoPlay && autoPlay === s.channel_id) return acceptPlay(s.id, { gamepad: true });
  playSound('ring');
  openPlayers({ focus: s.id });
}
let padLeaving = false;
export const leavePlay = (uid) => { padLeaving = true; padSend(null, myPlay(uid)); stopPlay(uid); }; // solta tudo antes de sair
// três ícones (controle, teclado, mouse): aceso = liberado. withOff: mostra os apagados também (para quem joga)
export function permIcons(p, withOff = true) {
  return h('span.rperms', [['gamepad', 'gamepad', 'Controle'], ['keyboard', 'keyboard', 'Teclado'], ['mouse', 'pointer', 'Mouse']].filter(([k]) => withOff || p[k])
    .map(([k, ic, label]) => h('i.rperm' + (p[k] ? '.on' : ''), { title: `${label}: ${p[k] ? 'liberado' : 'não liberado'}`, 'aria-label': `${label} ${p[k] ? 'liberado' : 'não liberado'}` }, icon(ic, 13))));
}
function paintChip() { document.getElementById('remote-chip')?.remove(); const c = remoteBar(); if (c) { c.id = 'remote-chip'; document.body.append(c); } }

// aviso dentro do app (os dois lados); o dono também tem o aviso nativo sempre por cima
export function remoteBar() {
  const s = S.remote, players = playersOf(S.me.id), me = myPlay();
  const asks = playRequests().length;
  if ((!s || s.state !== 'active') && (players.length || asks || me?.state === 'active')) {
    if (players.length || asks) return h('div.remote-chip.owner.players', icon('gamepad', 16),
      players.map(p => h('span.rplayer', { title: `${ctx.name(p.controller)}: ${p.kind === 'pad' ? 'controle' : permsText(p.perms)}` }, h('b', 'P' + p.slot), ctx.name(p.controller), p.kind === 'play' && permIcons(p.perms))),
      asks ? h('span.rpask', asks > 1 ? `${asks} pedidos para jogar` : '1 pedido para jogar') : null,
      h('button.btn.sm', { onclick: (e) => { e.stopPropagation(); openPlayers(); } }, 'Jogadores'));
    return h('div.remote-chip.players', icon('gamepad', 16), h('span', h('b', 'Player ' + me.slot), ` · transmissão de ${ctx.name(me.owner)}`),
      me.kind === 'play' && permIcons(me.perms, true),
      relAvailable() && h('button.btn.sm' + (relOn() ? '' : '.grey'), { title: relOn() ? (relLocked() ? 'Cursor travado no jogo (Esc solta). Clique para voltar ao mouse comum' : 'Clique na transmissão para travar o cursor. Clique aqui para voltar ao mouse comum') : 'Para jogos 3D (câmera com o mouse): o cursor fica preso na transmissão e vai o movimento, não a posição', 'aria-pressed': String(relOn()), onclick: (e) => { e.stopPropagation(); setRelMode(!relOn()); } }, relOn() ? (relLocked() ? 'Mouse travado' : 'Mouse travado: clique no jogo') : 'Mouse travado'),
      h('button.btn.sm.grey', { onclick: (e) => { e.stopPropagation(); leavePlay(me.owner); } }, 'Sair do jogo'));
  }
  if (!s || s.state !== 'active') return null;
  const mine = s.owner === S.me.id, who = ctx.name(mine ? s.controller : s.owner);
  const what = permsText(s.perms);
  return h('div.remote-chip' + (mine ? '.owner' : ''), h('i'), h('span', mine ? `${who} está controlando seu ${what}` : `Você está controlando o PC de ${who} (${what})`),
    h('button.btn.red.sm', { onclick: (e) => { e.stopPropagation(); stopControl(); } }, 'Parar'));
}
