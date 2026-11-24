// Janela "Jogadores" de quem transmite (jogar junto, como o Remote Play Together): quem está jogando (Player 1 = você,
// Player 2-4 com avatar, nome e as três permissões independentes: Controle, Teclado, Mouse), pedidos para jogar (Aceitar
// já vem com só o Controle), convites enviados e quem está na sala (assistindo ou não) com Convidar. Só um jogador com o
// mouse por vez (o servidor tira de quem tinha). As regras valem no servidor (server/remote.js); aqui é só a interface.
import { h, icon, avatar, whenGone } from './util.js';
import { S, modal, user, toast } from './state.js';
import { voice } from './gateway.js';
import { playersOf, playRequests, sentInvites, acceptPlay, declinePlay, setPlayPerms, invitePlayer, kickPlayer, revokeAll, autoAccept, ownerCap, installPadDriver, onPlayersChange, permIcons } from './remote.js';

const MAX = 4; // no total, com você
const PERMS = [['gamepad', 'gamepad', 'Controle'], ['keyboard', 'keyboard', 'Teclado'], ['mouse', 'pointer', 'Mouse']];
const nm = (uid) => user(uid)?.display_name || user(uid)?.username || 'Alguém';
let dlg = null, draw = null, focusId = null, reqPerms = new Map(); // escolhas do dono num pedido ainda não aceito

// três chaves; "on" decide o visual, "set" muda (na hora, no servidor)
function permRow(p, set, { busy = false } = {}) {
  return h('div.pl-perms', PERMS.map(([k, ic, label]) => h('button.pl-perm' + (p[k] ? '.on' : ''), {
    type: 'button', role: 'switch', 'aria-checked': String(!!p[k]), disabled: busy, title: `${label}: ${p[k] ? 'liberado (clique para tirar)' : 'não liberado (clique para liberar)'}${k === 'mouse' ? '. Um jogador por vez: liberar aqui tira de quem tem.' : ''}`,
    onclick: (e) => { e.stopPropagation(); set({ ...p, [k]: !p[k] }); },
  }, icon(ic, 15), h('span', label))));
}
const who = (uid, slot, sub) => h('div.pl-who', avatar(user(uid), 36), h('div.pl-name', h('b', nm(uid)), sub && h('small', sub)), slot && h('span.pl-slot', 'P' + slot));

function body(cap) {
  cap = cap || { ok: false };
  const me = S.me?.id, players = playersOf(me), asks = playRequests(), invites = sentInvites();
  const taken = new Set([...players, ...asks, ...invites].map(s => s.controller));
  const full = players.length + 1 >= MAX;
  const room = [...S.voice.values()].filter(v => v.channel_id === voice?.channelId && v.user_id !== me && !taken.has(v.user_id) && !user(v.user_id)?.bot);
  const watching = new Set(S.viewers.get(me) || []);
  room.sort((a, b) => watching.has(b.user_id) - watching.has(a.user_id));
  const mouseOwner = players.find(p => p.perms?.mouse);
  const sec = (title, n, ...kids) => h('section.pl-sec', h('h4', title, n != null && h('span.pl-n', n)), ...kids);
  return h('div.pl-body',
    !cap.ok ? h('p.rmwarn.hot', h('b', 'Este app não pode receber jogadores'), h('p', cap.reason || '')) : null,
    cap.ok && !cap.pad ? h('div.rmwarn', h('b', 'Controle de videogame desligado neste PC'),
      h('p', 'Para o controle de quem joga aparecer aqui, falta o driver gratuito ViGEmBus (controle virtual de Xbox). O Windows pede permissão de administrador uma vez.'),
      h('button.btn.sm', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Instalando… siga o instalador'; const r = await installPadDriver(); if (r.ok) { toast('Controles ativados neste PC'); refresh(true); } else { b.disabled = false; b.textContent = 'Instalar o driver'; toast(r.reason, true); } } }, 'Instalar o driver')) : null,
    cap.antiCheats?.length ? h('div.rmwarn.hot', h('b', `Anti-cheat rodando agora: ${cap.antiCheats.join(', ')}`), h('p', 'O jogo pode ignorar os comandos dos outros jogadores ou tratá-los como trapaça (risco para a sua conta).')) : null,
    sec('Jogando', `${players.length + 1}/${MAX}`,
      h('div.pl-row.host', who(me, 1, 'Você (anfitrião): tudo é seu'), h('div.pl-perms.fixed', PERMS.map(([, ic, label]) => h('span.pl-perm.on.fixed', { title: label }, icon(ic, 15), h('span', label))))),
      ...players.map(p => h('div.pl-row' + (p.id === focusId ? '.focus' : ''), { 'data-id': p.id },
        who(p.controller, p.slot, p.kind === 'pad' ? 'Só controle (app antigo de quem joga)' : !p.perms?.mouse && !p.perms?.keyboard && !p.perms?.gamepad ? 'Sem permissões: só assistindo' : null),
        p.kind === 'pad' ? permIcons({ gamepad: true }) : permRow(p.perms || {}, (np) => setPlayPerms(p.id, np)),
        h('button.btn.sm.grey.pl-kick', { title: `Tirar ${nm(p.controller)} do jogo`, onclick: () => kickPlayer(p.id) }, 'Tirar'))),
      mouseOwner && players.length > 1 ? h('p.pl-note', icon('pointer', 13), ` O mouse está com ${nm(mouseOwner.controller)}. Liberar para outro jogador tira dele (o cursor é um só).`) : null),
    asks.length ? sec('Pedidos para jogar', asks.length, ...asks.map(s => {
      const p = reqPerms.get(s.id) || { gamepad: true, keyboard: false, mouse: false };
      return h('div.pl-row.ask' + (s.id === focusId ? '.focus' : ''), { 'data-id': s.id },
        who(s.controller, null, full ? 'A transmissão já tem 4 jogadores' : 'Quer jogar. Escolha o que liberar:'),
        permRow(p, (np) => { reqPerms.set(s.id, np); refresh(); }),
        h('div.pl-acts', h('button.btn.sm.grey', { onclick: () => { reqPerms.delete(s.id); declinePlay(s.id); } }, 'Recusar'),
          h('button.btn.sm', { disabled: full, onclick: () => { reqPerms.delete(s.id); acceptPlay(s.id, p); } }, 'Aceitar')));
    })) : null,
    invites.length ? sec('Convites enviados', invites.length, ...invites.map(s => h('div.pl-row.inv', who(s.controller, null, `Aguardando… entra com: ${[s.perms?.gamepad && 'controle', s.perms?.keyboard && 'teclado', s.perms?.mouse && 'mouse'].filter(Boolean).join(', ') || 'nada'}`),
      h('button.btn.sm.grey', { onclick: () => kickPlayer(s.id) }, 'Cancelar')))) : null,
    sec('Na sala', room.length, room.length ? null : h('p.pl-empty', 'Ninguém mais na sala para convidar.'),
      ...room.map(v => h('div.pl-row.watch', who(v.user_id, null, watching.has(v.user_id) ? 'Assistindo a sua transmissão' : 'Na sala, sem assistir'),
        h('button.btn.sm', { disabled: full || !cap.ok, title: full ? 'A transmissão já tem 4 jogadores' : 'Convidar para jogar (entra só com o controle; você muda depois)', onclick: () => invitePlayer(v.user_id, { gamepad: true }) }, 'Convidar')))),
    h('div.pl-foot',
      h('label.pl-auto', h('input', { type: 'checkbox', checked: autoAccept.on, onchange: (e) => { autoAccept.on = e.target.checked; } }), h('span', 'Aceitar os próximos pedidos nesta chamada (só com o controle)')),
      players.some(p => p.kind === 'play' && (p.perms?.mouse || p.perms?.keyboard || p.perms?.gamepad)) ? h('button.btn.sm.red', { title: 'Desliga controle, teclado e mouse de todos (eles continuam na sessão)', onclick: () => revokeAll() }, 'Revogar tudo') : null,
      h('small.pl-help', 'Parar tudo na hora: ', h('b', 'Ctrl+Alt+Shift+Q'), ' (só o seu teclado aciona).')));
}

let capNow = { ok: true, pad: true }, tick = 0;
function refresh(freshCap) {
  if (!dlg || !draw) return;
  if (freshCap) ownerCap(true).then(c => { capNow = c; draw(); });
  draw();
}
export async function openPlayers({ focus } = {}) {
  focusId = focus || null;
  if (dlg?.el.isConnected) { refresh(); const r = focus && dlg.el.querySelector(`[data-id="${focus}"]`); r?.scrollIntoView?.({ block: 'nearest' }); return; }
  capNow = await ownerCap();
  const holder = h('div.pl-wrap.rmask');
  draw = () => holder.replaceChildren(body(capNow));
  draw();
  dlg = modal('Jogadores', 'Até 4 jogadores no total. Você é o Player 1 e decide o que cada um pode usar.', holder, [{ label: 'Fechar', cls: 'grey' }], { width: '620px' });
  dlg.el.classList.add('playersdlg');
  onPlayersChange(() => refresh());
  clearInterval(tick); tick = setInterval(() => { if (dlg?.el.isConnected) draw(); }, 2000); // quem assiste / quem está na sala muda sem evento daqui
  const me = dlg;
  whenGone(dlg.el, () => { if (dlg === me) { dlg = null; draw = null; clearInterval(tick); onPlayersChange(null); } });
}
export const playersOpen = () => !!dlg?.el.isConnected;
