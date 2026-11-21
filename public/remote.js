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

let ctx = {}; // injetado por app.js: send(t, d), name(uid), rerender()
export const initRemote = (c) => { ctx = c; };
const REASON = { declined: 'recusou o pedido de controle', unsupported: 'não pode ser controlado (só pelo app para Windows)', stream_ended: 'parou de transmitir', left: 'saiu da sala', expired: 'não respondeu ao pedido de controle', panic: 'parou o controle remoto', stopped: 'encerrou o controle remoto' };
export const session = () => S.remote || null;
export const controlling = (uid) => { const s = S.remote; return !!s && s.state === 'active' && s.controller === S.me.id && s.owner === uid; };
// "mouse e teclado", "mouse, teclado e controle", "controle"…
export const permsText = (p) => { const l = [p.mouse && 'mouse', p.keyboard && 'teclado', p.gamepad && 'controle'].filter(Boolean); return l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l.at(-1) : l[0] || 'nada'; };
export const pendingFor = (uid) => { const s = S.remote; return !!s && s.state === 'pending' && s.controller === S.me.id && s.owner === uid; };
// ---------- "jogar junto" (kind 'pad'): entrar como jogador 2, 3 ou 4 com o próprio controle ----------
// S.pads: id -> sessão. Quem transmite pode ter até 3; quem joga, uma.
const pads = () => (S.pads ||= new Map());
export const myPlay = (uid) => [...pads().values()].find(s => s.controller === S.me.id && (!uid || s.owner === uid)) || null;
export const playersOf = (uid) => [...pads().values()].filter(s => s.owner === uid && s.state === 'active').sort((a, b) => a.slot - b.slot);
export function requestPlay(uid) {
  const cur = myPlay();
  if (cur) return cur.owner === uid ? ctx.send('REMOTE_STOP', { id: cur.id }) : toast(`Você já está jogando na transmissão de ${ctx.name(cur.owner)}. Saia de lá antes.`, true);
  if (!navigator.getGamepads) return toast('Este navegador não lê controles de videogame.', true);
  if (![...(navigator.getGamepads() || [])].some(Boolean)) toast('Ligue o controle (Xbox, DualSense…) neste PC e aperte um botão para ele ser reconhecido.');
  ctx.send('REMOTE_REQUEST', { to: uid, kind: 'pad' });
}
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
  if (e.k === 'm') {
    lastMove = e;
    const wait = MOVE_MS - (performance.now() - lastSent);
    if (wait <= 0) { clearTimeout(flushTimer); flush(); } else if (!flushTimer) flushTimer = setTimeout(flush, wait);
    return;
  }
  if (lastMove) { queue.push(lastMove); lastMove = null; }
  queue.push(e); clearTimeout(flushTimer); flush();
};
function flush() {
  flushTimer = 0; lastSent = performance.now(); if (lastMove) { queue.push(lastMove); lastMove = null; }
  const s = S.remote; if (!s || s.state !== 'active' || !queue.length) { queue = []; return; }
  while (queue.length) ctx.send('REMOTE_INPUT', { id: s.id, ev: queue.splice(0, 64) });
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
addEventListener('pointermove', (e) => { const t = ownerTile(e.target); if (!t || !S.remote?.perms.mouse) return; const p = norm(videoOf(t), e.clientX, e.clientY); if (p) push({ k: 'm', ...p }); }, opts);
addEventListener('pointerdown', (e) => {
  const t = ownerTile(e.target); if (!t) { setKb(false); return; }
  if (e.target.closest('.tctl, .remote-chip, button')) return; // botões do próprio quadro continuam funcionando
  e.preventDefault(); e.stopPropagation(); setKb(true);
  if (!S.remote.perms.mouse || e.button > 2) return;
  const p = norm(videoOf(t), e.clientX, e.clientY); if (!p) return;
  push({ k: 'm', ...p }); push({ k: 'd', b: e.button }); btnsDown.add(e.button);
}, opts);
addEventListener('pointerup', (e) => { if (!btnsDown.has(e.button)) return; e.preventDefault(); e.stopPropagation(); btnsDown.delete(e.button); push({ k: 'u', b: e.button }); }, opts);
addEventListener('click', (e) => { if (ownerTile(e.target) && !e.target.closest('.tctl, .remote-chip, button')) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('dblclick', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('contextmenu', (e) => { if (ownerTile(e.target)) { e.preventDefault(); e.stopPropagation(); } }, opts);
addEventListener('wheel', (e) => {
  const t = ownerTile(e.target); if (!t || !S.remote?.perms.mouse) return;
  e.preventDefault(); e.stopPropagation();
  const f = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1.2; // pixels/linhas/páginas -> unidades do Windows (120 por "dente")
  const cl = (v) => Math.max(-2400, Math.min(2400, Math.round(v * f)));
  if (e.deltaX || e.deltaY) push({ k: 'w', dx: cl(e.deltaX), dy: cl(e.deltaY) });
}, opts);
const keyHandler = (down) => (e) => {
  if (!kbOn || !S.remote || S.remote.state !== 'active' || S.remote.controller !== S.me.id) return;
  if (!S.remote.perms.keyboard || !e.code) return;
  e.preventDefault(); e.stopPropagation();
  if (down) { if (e.repeat && keysDown.has(e.code)) { push({ k: 'kd', c: e.code }); return; } keysDown.add(e.code); push({ k: 'kd', c: e.code }); }
  else if (keysDown.delete(e.code)) push({ k: 'ku', c: e.code });
};
addEventListener('keydown', keyHandler(true), true);
addEventListener('keyup', keyHandler(false), true);
addEventListener('blur', () => { if (S.remote) { setKb(false); releaseAll(); padNeutral(); flush(); } });

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
const padTarget = () => { const p = myPlay(); if (p?.state === 'active') return p; const s = S.remote; return s && s.state === 'active' && s.controller === S.me.id && s.perms.gamepad ? s : null; };
const NEUTRAL = { k: 'g', b: 0, ax: [0, 0, 0, 0], lt: 0, rt: 0 };
// jogador: manda direto (só o estado que mudou, ~60/s no máximo); controle remoto: pela fila junto com mouse e teclado
function padSend(st, s = padTarget()) { if (!s) return; if (s.kind === 'pad') ctx.send('REMOTE_INPUT', { id: s.id, ev: [st || NEUTRAL] }); else push(st || NEUTRAL); }
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
export const kickPlayer = (id) => ctx.send('REMOTE_STOP', { id });
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
      h('li', 'Há um pequeno atraso: os comandos passam pelo servidor. Bom para ajudar; para jogar à distância pode não ser ideal.'),
      h('li', 'Controle de videogame: quem controla usa o próprio controle ligado no PC dele; no PC de quem transmite ele aparece como um controle de Xbox 360 (precisa do driver gratuito ViGEmBus instalado lá).'),
      h('li', 'Com vários monitores, só o monitor transmitido é controlado.')));
}

// ---------- eventos do servidor ----------
let pendingTimer = 0;
export function onRemoteEvent(t, d) {
  if (t === 'REMOTE_REQUEST') return d.kind === 'pad' ? onPadRequest(d) : onRequest(d);
  if (t === 'REMOTE_ERROR') return toast(d.error, true);
  if (t === 'REMOTE_INPUT') { if (S.remote?.id === d.id && S.remote.owner === S.me.id) desktop?.remoteInput?.(d.ev); else if (pads().get(d.id)?.owner === S.me.id) desktop?.remoteInput?.(d.ev, d.id); return; }
  if (t !== 'REMOTE_STATE') return;
  if (d.kind === 'pad') return padState(d);
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
const PLAY_END = { declined: 'recusou', unsupported: 'não pode receber jogadores (só pelo app para Windows)', expired: 'não respondeu', stream_ended: 'parou de transmitir', left: 'saiu da sala', full: 'já tem 4 jogadores', panic: 'tirou todos os jogadores' };
function padState(d) {
  const mine = d.owner === S.me.id, other = ctx.name(mine ? d.controller : d.owner), before = pads().get(d.id);
  if (d.state === 'ended') {
    pads().delete(d.id);
    const dlg = padAsks.get(d.id); if (dlg) { dlg.quiet = true; dlg.close(); padAsks.delete(d.id); }
    if (mine) { desktop?.remoteStop?.(d.id); if (before?.state === 'active' && d.reason !== 'stream_ended') toast(`${other} saiu do jogo`); if (['stream_ended', 'left', 'panic'].includes(d.reason)) autoPlay = null; }
    else {
      const r = d.reason || 'stopped';
      if (r === 'cancelled' || (r === 'stopped' && before?.state === 'active' && before.controller === S.me.id && padLeaving)) toast(r === 'cancelled' ? 'Pedido para jogar cancelado' : 'Você saiu do jogo');
      else toast(`${other} ${PLAY_END[r] || (before?.state === 'active' ? 'tirou você do jogo' : 'encerrou o jogo')}`, r !== 'stopped');
      padLeaving = false;
    }
  } else {
    pads().set(d.id, d);
    if (d.state === 'active' && before?.state !== 'active') {
      if (mine) desktop?.remoteStart?.({ id: d.id, who: other, kind: 'pad', slot: d.slot }).then(r => { if (!r?.ok) { toast(r?.reason || 'Não foi possível ligar o controle virtual', true); ctx.send('REMOTE_STOP', { id: d.id }); } else toast(`${other} entrou como jogador ${d.slot}`); });
      else { toast(`Você é o jogador ${d.slot} na transmissão de ${other}. Use o seu controle.`); padStart(); }
    }
  }
  paintChip(); ctx.rerender();
}
let padLeaving = false;
export const leavePlay = (uid) => { padLeaving = true; padSend(null, myPlay(uid)); stopPlay(uid); }; // solta tudo antes de sair
function paintChip() { document.getElementById('remote-chip')?.remove(); const c = remoteBar(); if (c) { c.id = 'remote-chip'; document.body.append(c); } }

// aviso dentro do app (os dois lados); o dono também tem o aviso nativo sempre por cima
export function remoteBar() {
  const s = S.remote, players = playersOf(S.me.id), me = myPlay();
  if ((!s || s.state !== 'active') && (players.length || me?.state === 'active')) {
    if (players.length) return h('div.remote-chip.owner.players', icon('gamepad', 16), h('span', players.length > 1 ? 'Jogadores:' : 'Jogador:'),
      players.map(p => h('span.rplayer', h('b', p.slot), ctx.name(p.controller), h('button.ibtn', { title: `Tirar ${ctx.name(p.controller)} do jogo`, 'aria-label': `Tirar ${ctx.name(p.controller)} do jogo`, onclick: (e) => { e.stopPropagation(); kickPlayer(p.id); } }, icon('x', 14)))));
    return h('div.remote-chip.players', icon('gamepad', 16), h('span', `Você é o jogador ${me.slot} de ${ctx.name(me.owner)}`),
      h('button.btn.sm.grey', { onclick: (e) => { e.stopPropagation(); leavePlay(me.owner); } }, 'Sair do jogo'));
  }
  if (!s || s.state !== 'active') return null;
  const mine = s.owner === S.me.id, who = ctx.name(mine ? s.controller : s.owner);
  const what = permsText(s.perms);
  return h('div.remote-chip' + (mine ? '.owner' : ''), h('i'), h('span', mine ? `${who} está controlando seu ${what}` : `Você está controlando o PC de ${who} (${what})`),
    h('button.btn.red.sm', { onclick: (e) => { e.stopPropagation(); stopControl(); } }, 'Parar'));
}
