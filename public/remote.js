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

// eventos capturados no quadro -> fila -> servidor (movimento agrupado a cada 16 ms)
let queue = [], lastMove = null, flushTimer = 0, kbOn = false;
const keysDown = new Set(), btnsDown = new Set();
const push = (e) => { if (e.k === 'm') { lastMove = e; } else { if (lastMove) { queue.push(lastMove); lastMove = null; } queue.push(e); } if (!flushTimer) flushTimer = setTimeout(flush, 16); };
function flush() {
  flushTimer = 0; if (lastMove) { queue.push(lastMove); lastMove = null; }
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
function padNeutral() { if (padLast && padLast !== '0') { padLast = '0'; push({ k: 'g', b: 0, ax: [0, 0, 0, 0], lt: 0, rt: 0 }); } }
function padTick() {
  const s = S.remote;
  if (!s || s.state !== 'active' || s.controller !== S.me.id || !s.perms.gamepad) { clearInterval(padTimer); padTimer = 0; padLast = ''; return; }
  if (!document.hasFocus()) return padNeutral();
  const st = readPad(); if (!st) return;
  const key = st.b || st.ax.some(Boolean) || st.lt || st.rt ? JSON.stringify(st) : '0';
  if (key !== padLast) { padLast = key; push(st); }
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
desktop?.onRemoteEvent?.((k) => {
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
  if (t === 'REMOTE_REQUEST') return onRequest(d);
  if (t === 'REMOTE_ERROR') return toast(d.error, true);
  if (t === 'REMOTE_INPUT') { if (S.remote?.id === d.id && S.remote.owner === S.me.id) desktop?.remoteInput?.(d.ev); return; }
  if (t !== 'REMOTE_STATE') return;
  const mine = d.owner === S.me.id, other = ctx.name(mine ? d.controller : d.owner);
  if (d.state === 'ended') {
    const was = S.remote; S.remote = null; setKb(false); queue = []; lastMove = null;
    if (mine) { desktop?.remoteStop?.(); if (askDlg) { askDlg.quiet = true; askDlg.close(); } askDlg = null; }
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
function paintChip() { document.getElementById('remote-chip')?.remove(); const c = remoteBar(); if (c) { c.id = 'remote-chip'; document.body.append(c); } }

// aviso dentro do app (os dois lados); o dono também tem o aviso nativo sempre por cima
export function remoteBar() {
  const s = S.remote; if (!s || s.state !== 'active') return null;
  const mine = s.owner === S.me.id, who = ctx.name(mine ? s.controller : s.owner);
  const what = permsText(s.perms);
  return h('div.remote-chip' + (mine ? '.owner' : ''), h('i'), h('span', mine ? `${who} está controlando seu ${what}` : `Você está controlando o PC de ${who} (${what})`),
    h('button.btn.red.sm', { onclick: (e) => { e.stopPropagation(); stopControl(); } }, 'Parar'));
}
