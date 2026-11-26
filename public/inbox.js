// Painéis por cima do chat: fixadas, busca do canal, notificações do canal e caixa de entrada (menções e pedidos).
import { dealsUnseen, dealsList, markDealsSeen } from './games.js';
import { h, icon, avatar, clock, dayLabel, sameDay, busy, skeleton, imgUrl } from './util.js';
import { S, tryApi, user, guild, channelById, nameOf, dmPeer, toast, menu, popout, closeFloating, channelMuted, channelUnmuted, setChannelUnmuted, savePrefs } from './state.js';
import { chName } from './chnames.js';
import { stagger } from './motion.js';
import { $ } from './gateway.js';
import { ack } from './unread.js';
import { openSettings, go, ctxSettings } from './nav.js';
import { renderRail } from './rail.js';
import { renderSide } from './side.js';
import { profile, initialsOf, openDM } from './usermenu.js';
import { msgEl } from './chat.js';
import { jumpTo } from './msgactions.js';
// prende o popup pela borda direita do botão, logo abaixo dele (medir a largura falha durante a animação de entrada, que encolhe o popup)
export const anchorRight = (pop, btn, gap) => { const r = btn.getBoundingClientRect(); pop.style.left = 'auto'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px'; pop.style.top = (r.bottom + gap) + 'px'; };
// popups dos botões do topo (fixadas, notificações): clicar de novo no mesmo botão fecha
let topWasOpen = false;
window.addEventListener('mousedown', (e) => { topWasOpen = (!!$('.pinspop') && !!e.target.closest?.('.pins-btn')) || (!!$('.notifmenu') && !!e.target.closest?.('.notif-btn')) || (!!$('.inboxpop') && !!e.target.closest?.('.inbox-btn')); }, true);
// menu de notificações do canal: silenciar por um tempo e nível de aviso (padrão do servidor, tudo, só @menções, nada)
export function notifMenu(e, ch) { notifCard(e, { ch }); }
// cartão de notificações: nível (todas / só @menções / nada), blocos para @everyone/@here, silenciar e avisos na área
// de trabalho, e o atalho para todas as configurações. Serve para um canal, uma DM ou o servidor inteiro ({ g })
export function notifCard(e, { ch, g: srv }) {
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
export async function showPins(e) {
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
// ---------- caixa de entrada: menções, respostas e @everyone ----------
const inboxCount = () => Object.values(S.mentions).reduce((n, v) => n + (v || 0), 0) + [...S.rels.values()].filter(r => r.type === 3).length + dealsUnseen(); // menções + pedidos de amizade esperando resposta + promoções da wishlist
export const inboxBadge = () => { const n = inboxCount(); return n ? h('span.ibadge', n > 99 ? '99+' : n) : null; };
const KIND_TXT = { mention: 'mencionou você', reply: 'respondeu você', everyone: 'mencionou @everyone' };
// popup "Caixa de entrada" no canto superior direito: não lidas por canal e menções/respostas
let inboxTab = 'unread';
export const setInboxTab = (tab) => { inboxTab = tab; };
const unreadCh = () => Object.entries(S.unread).map(([cid, u]) => ({ ch: channelById(cid), u })).filter(x => x.ch).sort((a, b) => (b.u.last_id > a.u.last_id ? 1 : -1));
const jumpMsg = (m) => { const ch = channelById(m.channel_id); closeFloating(); if (S.view.cid !== m.channel_id) { go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } else jumpTo(m.id); };
// mensagens com separador de dia e o botão "Ir" ao passar o mouse
const ibMsgs = (list, head) => { let prev = null; return list.flatMap(m => { const out = []; if (!prev || !sameDay(prev.created_at, m.created_at)) out.push(h('div.ib-day', h('span', dayLabel(m.created_at)))); prev = m; const e = msgEl(m, null); e.querySelector('.toolbar')?.remove(); out.push(h('div.ib-msg', head?.(m), e, h('button.ib-jump', { onclick: (ev) => { ev.stopPropagation(); jumpMsg(m); } }, 'Ir'))); return out; }); };
export async function showInbox(e) {
  const btn = e?.currentTarget || $('.inbox-btn');
  if (topWasOpen) { topWasOpen = false; return closeFloating(); }
  const body = h('div.ib-body'), tabs = h('div.ib-tabs');
  const pending = [...S.rels.values()].filter(r => r.type === 3).length;
  const reqCount = () => [...S.rels.values()].filter(r => r.type === 3).length;
  const drawTabs = () => tabs.replaceChildren(...[['unread', 'Não lidas'], ['mentions', 'Menções'], ['requests', 'Pedidos'], ['deals', 'Promoções']].map(([k, l]) => h('button' + (inboxTab === k ? '.on' : ''), { onclick: () => { inboxTab = k; drawTabs(); draw(); } }, l, k === 'deals' && dealsUnseen() > 0 && h('span.ib-tabn', dealsUnseen()), k === 'requests' && reqCount() > 0 && h('span.ib-tabn', reqCount()))));
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
    if (inboxTab === 'deals') { body.replaceChildren(...dealsList(empty)); setTimeout(() => { if (inboxTab === 'deals' && body.isConnected) { markDealsSeen(); drawTabs(); } }, 1500); return; }
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
export const seenLoss = () => { try { return +localStorage.getItem(LOSS_SEEN + ':' + S.me.id) || 0; } catch { return 0; } };
export function noticeFriendLosses(list) {
  if (!list.length) return;
  try { localStorage.setItem(LOSS_SEEN + ':' + S.me.id, String(Math.max(seenLoss(), ...list.map(x => x.at)))); } catch { }
  if (S.prefs.friendLossNotice !== true) return; // desligado por padrão (socialmente arriscado)
  const names = list.map(x => user(x.user.id).display_name);
  toast(names.length === 1 ? `${names[0]} desfez a amizade com você` : `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` e mais ${names.length - 2}` : ''} desfizeram a amizade com você`);
}
export function refreshInboxRequests() { if ($('.inboxpop') && inboxTab === 'requests') $('.inboxpop .ib-tabs button.on')?.click(); }
function friendLossRows(redraw) {
  const list = S.prefs.friendLossNotice !== true ? [] : (S.friendLosses || []);
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
