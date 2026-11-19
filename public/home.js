// Início: Amigos e o painel Ativo agora.
import { h, icon, avatar, debounce } from './util.js';
import { S, api, tryApi } from './state.js';
import { inviteFrom, acceptInvite, declineInvite } from './callinvite.js';
import { styleName } from './themes.js';
import { STATUS_TXT } from './card.js';
import { activityPanel, refreshFeedView } from './activity.js';
import { viewTransition, stagger } from './motion.js';
import { $ } from './gateway.js';
import { openDM, userMenu } from './usermenu.js';
// =============== Início / amigos ===============
// painel "Ativo agora": amigos online, com servidor e sala de voz quando estão numa chamada
// painel "Ativo agora" (à direita dos Amigos): o que os amigos fazem agora + destaques da semana (public/activity.js)
export function renderActiveNow() {
  const box = document.getElementById('active-now'); if (!box) return;
  if (box.querySelector('#actfeed')) return refreshFeedView(); // já montado: só redesenha (presença/voz mudaram)
  activityPanel(box);
}
// lista de amigos única, separada como a lista de membros: Pedidos, Online e Offline, cada grupo recolhível (fica salvo)
const friendCol = (() => { try { return JSON.parse(localStorage.getItem('lc_fcol') || '{}'); } catch { return {}; } })();
export function renderHome(main) {
  if (S.view.tab !== 'add') S.view.tab = 'list'; // Online e Todos viraram uma lista só; bloqueados: Privacidade e segurança; a atividade virou o painel "Ativo agora"
  const tab = S.view.tab, rels = [...S.rels.values()], reqs = rels.filter(r => r.type === 3).length;
  const tabs = [['list', 'Todos']];
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
    const t = q.value.trim().toLowerCase();
    const st = (r) => S.users.get(r.user.id)?.status || 'offline';
    const list = rels.filter(r => (r.type === 1 || r.type === 3 || r.type === 4) && (!t || r.user.username.toLowerCase().includes(t) || (r.user.display_name || '').toLowerCase().includes(t)));
    const nm = (r) => (r.user.display_name || r.user.username).toLowerCase();
    // pedidos (recebidos antes dos enviados), online (quem chamou você para a sala dele primeiro, depois pelo status) e offline
    const groups = [
      ['req', 'Pedidos', list.filter(r => r.type !== 1).sort((a, b) => (a.type - b.type) || nm(a).localeCompare(nm(b)))],
      ['online', 'Online', list.filter(r => r.type === 1 && (st(r) !== 'offline' || inviteFrom(r.user.id))).sort((a, b) => (!!inviteFrom(b.user.id) - !!inviteFrom(a.user.id)) || (ORD[st(a)] - ORD[st(b)]) || nm(a).localeCompare(nm(b)))],
      ['offline', 'Offline', list.filter(r => r.type === 1 && st(r) === 'offline' && !inviteFrom(r.user.id)).sort((a, b) => nm(a).localeCompare(nm(b)))],
    ].filter(([, , l]) => l.length);
    const isCol = (k) => !t && !!friendCol[k]; // buscando: tudo aberto
    const toggle = (k) => { friendCol[k] = !isCol(k); try { localStorage.setItem('lc_fcol', JSON.stringify(friendCol)); } catch { } draw(); };
    pane.append(h('div.fctl', q));
    if (!list.length) return pane.append(h('div.empty', { style: { marginTop: '60px' } }, h('div.empty-ic', icon('moon', 48)), h('p', t ? 'Ninguém com esse nome.' : 'Ninguém por aqui ainda. Que tal adicionar um amigo?')));
    for (const [k, name, l] of groups) {
      const c = isCol(k);
      pane.append(h('button.mgroup.fgroup' + (c ? '.col' : ''), { type: 'button', 'aria-expanded': String(!c), title: c ? 'Mostrar' : 'Recolher', onclick: () => toggle(k) },
        icon('caret', 12), h('span.mg-name', name), h('span.mg-n', l.length),
        c && h('span.mg-faces', l.slice(0, 4).map(r => avatar(S.users.get(r.user.id) || r.user, 18, { ring: 'var(--bg-pri)', status: false })))));
      if (!c) for (const r of l) friendRow(r);
    }
  };
  const friendRow = (r) => {
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
