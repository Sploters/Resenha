// Barra lateral: lista de canais do servidor, conversas diretas, quem está em cada sala de voz e mover arrastando.
import { liveIn, boraCard } from './bora.js';
import { onbRow } from './onboarding.js';
import { fxBadge } from './fxui.js';
import { h, morph, icon, avatar, clock, sameDay, debounce, imgUrl, whenGone } from './util.js';
import { S, user, guild, channelById, nameOf, can, canInvite, PERM, dmPeer, modal, menu, closeFloating, notifPolicy, serverMuted, savePrefs, CH, chCan, chVisible, CH_KINDS, isChatCh, api, toast } from './state.js';
import { playSound } from './sounds.js';
import { previewHooks, hidePreview } from './chpreview.js';
import { chName } from './chnames.js';
import { streamHover } from './livepip.js';
import { setLfgGuild, ensureLfgPosts, openPosts, lfgMini } from './lfg.js';
import { styleName } from './themes.js';
import { canMoveVoice, canMoveTo, moveVoice } from './mod.js';
import { activityOf, sameGameAs, gameIcon, voiceGameIcon } from './activity.js';
import { voice, $, syncView, deferRender, roomVoice } from './gateway.js';
import { botRow } from './botmusic.js';
import { appBadge } from './appver.js';
import { go } from './nav.js';
import { callTimer, friendsIn, avStack, friendsInServer, guildMenu, inviteModal } from './rail.js';
import { favList, isFav, favSide } from './favs.js';
import { channelModal, channelMenu, channelSettings } from './chmenu.js';
import { voicePanel, rejoinPanel, joinVoice, userbar } from './userbar.js';
import { profile, pinnedDMs, togglePinDM, muteIco, openDM, userMenu } from './usermenu.js';
import { renderVoiceUI } from './stage.js';
import { watchOnly } from './share.js';
// ---------- barra lateral ----------
export const chIcon = (c, sz = 20) => icon(CH_KINDS[c.type]?.[0] || 'hash', sz);
// menu de ações do servidor aberto pelo nome (div.gd): seta para cima e aria-expanded enquanto ele está na tela
const gdMenu = { gid: null, m: null };
const gdPaint = () => { const el = document.querySelector('#side-head .gd'); if (!el) return; el.classList.toggle('open', !!gdMenu.gid); el.setAttribute('aria-expanded', String(!!gdMenu.gid)); };
export function renderSide() {
  if (deferRender(renderSide)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const side = $('#side'); if (!side) return;
  if (vDrag || cDrag) return; // arrastando alguém para outra sala (ou um canal): redesenha ao soltar (senão o arrasto é cancelado)
  let head, list;
  { const gg = S.view.gid !== '@me' && guild(S.view.gid); $('#app')?.style.setProperty('--srv', (gg && gg.accent) || 'transparent'); }
  if (S.favMode && favList().length) ({ head, list } = favSide());
  else if (S.view.gid === '@me' || !guild(S.view.gid)) {
    // Mensagens e Amigos juntos: Amigos no topo da lista (abre a página de amigos no meio) e as conversas embaixo,
    // com buscar e ordenar; fixadas no topo
    const SORT_L = { recent: 'Mais recentes', unread: 'Não lidas', name: 'Nome (A–Z)' };
    // cabeçalho: busca por nome no lugar do título e o botão de ordenar à direita
    const findInput = h('input#dm-q', { type: 'search', placeholder: 'Buscar conversa', 'aria-label': 'Buscar conversa por nome', value: dmFind.q,
      oninput: debounce((e) => { dmFind.q = e.target.value; renderSide(); setTimeout(() => { const i = $('#dm-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 120),
      onkeydown: (e) => { if (e.key === 'Escape' && dmFind.q) { dmFind.q = ''; renderSide(); setTimeout(() => $('#dm-q')?.focus()); } } });
    const sortL = SORT_L[S.prefs.dmSort || 'recent'];
    head = h('div#side-head.sh-plain.dm-head', h('label.dm-q', icon('search', 14), findInput),
      h('button.dm-sort', { type: 'button', title: 'Ordenar conversas: ' + sortL, 'aria-label': 'Ordenar conversas: ' + sortL, onclick: (e) => dmSortMenu(e) }, icon('sort', 18)));
    const q = dmFind.q.trim().toLowerCase();
    const all = sortedDMs().filter(d => !q || (user(dmPeer(d).id).display_name + ' ' + user(dmPeer(d).id).username).toLowerCase().includes(q));
    const pins = pinnedDMs(), pinned = pins.map(id => all.find(d => dmPeer(d)?.id === id)).filter(Boolean), rest = all.filter(d => !pinned.includes(d));
    list = h('div#side-list.dmlist',
      pinned.length > 0 && h('div.cat', { style: { cursor: 'default' } }, 'Fixadas'), ...pinned.map(d => dmRow(d, true)),
      rest.length > 0 && pinned.length > 0 && h('div.cat', { style: { cursor: 'default' } }, 'Conversas'), ...dmRest(rest),
      !all.length && h('div.dm-empty', q ? 'Nenhuma conversa com esse nome' : [h('p', 'Nenhuma conversa ainda'), h('button.btn', { onclick: () => newMessageModal() }, 'Nova mensagem')]));
  } else {
    const g = guild(S.view.gid);
    const menuAt = (el) => { const r = el.getBoundingClientRect(); guildMenu({ preventDefault() { }, clientX: r.left + 8, clientY: r.bottom + 4 }, g); };
    // o estado "aberto" fica fora do elemento (a lista se redesenha com o menu aberto). O nome tem data-keepfloat: o
    // "clique fora fecha" (state.js) o ignora e é ele quem alterna — abrir, ou fechar se o menu dele já está na tela
    const gdOpen = (el) => {
      if (gdMenu.gid === g.id && gdMenu.m?.isConnected && !gdMenu.m.classList.contains('leaving')) { closeFloating(); return; }
      const r = el.getBoundingClientRect(), m = guildMenu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 6 }, g, { width: r.width });
      if (!m) return;
      gdMenu.gid = g.id; gdMenu.m = m; gdPaint();
      whenGone(m, () => { if (gdMenu.m === m) { gdMenu.gid = null; gdMenu.m = null; gdPaint(); } });
    };
    // Resenha 2.0: convidar e "mais" ficam sobre a capa (banner ou a capa gerada em tons frios, coverOf); no Visual clássico
    // a capa gerada e esses botões somem (v2.css) e o convite volta para a linha do nome
    const cbtns = h('div.srv-cbtns',
      canInvite(g) && h('button.srv-cbtn', { type: 'button', title: 'Convidar pessoas', 'aria-label': 'Convidar pessoas para o servidor', onclick: () => inviteModal(g) }, icon('invite', 16)),
      h('button.srv-cbtn', { type: 'button', title: 'Ações do servidor', 'aria-label': 'Ações do servidor', onclick: (e) => menuAt(e.currentTarget) }, icon('more', 16)));
    head = h('div#side-head.srv-head' + (g.banner ? '.has-banner' : '.has-cover'), { style: !g.banner && g.accent ? { borderTop: `3px solid ${g.accent}` } : null },
      g.banner ? h('div.srv-banner', { style: { backgroundImage: `url("${String(imgUrl(g.banner, 480)).replace(/["\\\n]/g, encodeURIComponent)}")` } }, cbtns)
        : h('div.srv-banner.srv-cover', { style: coverOf(g) }, cbtns),
      // como no Discord: o nome ocupa a linha (cortado com "…") e a seta fica na ponta; com o menu aberto ela vira para cima
      h('div.srv-name', h('div.gd' + (gdMenu.gid === g.id ? '.open' : ''), { role: 'button', tabindex: 0, 'aria-haspopup': 'menu', 'aria-expanded': String(gdMenu.gid === g.id), 'aria-label': g.name + ', ações do servidor', title: 'Ações do servidor',
        'data-keepfloat': '', onclick: (e) => gdOpen(e.currentTarget), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); gdOpen(e.currentTarget); } } },
        h('span.gd-name', g.name), h('span.gd-chev', icon('chevdown', 16))),
        canInvite(g) && h('button.sh-btn', { type: 'button', title: 'Convidar pessoas', 'aria-label': 'Convidar pessoas para o servidor', onclick: () => inviteModal(g) }, icon('invite', 20))),
      (() => { const fr = friendsIn(g); return fr.length > 0 && h('button.srv-friends', { type: 'button', title: 'Ver os amigos neste servidor', onclick: () => friendsInServer(g) }, avStack(fr, 18), h('span', fr.length === 1 ? `${fr[0].display_name} está aqui` : `${fr.length} amigos aqui`)); })(),
      srvCta(g));
    // salas escondidas (sem permissão de entrar) ficam de fora; categoria que só tinha essas some junto
    const byParent = new Map(), hiddenIn = new Set();
    for (const c of g.channels) if (c.type !== 4) { const k = c.parent_id || null; if (!chVisible(c)) { hiddenIn.add(k); continue; } (byParent.get(k) || byParent.set(k, []).get(k)).push(c); }
    const cats = g.channels.filter(c => c.type === 4 && (byParent.has(c.id) || !hiddenIn.has(c.id)));
    // estava olhando uma sala que acabou de sumir (saiu da chamada para onde foi movido): volta para o servidor
    if (S.view.gid === g.id && !chVisible(channelById(S.view.cid))) setTimeout(() => { if (S.view.gid === g.id && !chVisible(channelById(S.view.cid))) go(g.id); });
    const kids = (pid) => byParent.get(pid) || [];
    if (sideCats.gid !== g.id) { sideCats.gid = g.id; sideCats.open.clear(); }
    const chRow = (c) => {
      const vs = c.type === 2 ? roomVoice(c.id) : [];
      const pol = isChatCh(c) ? notifPolicy(c) : null, live = pol && serverMuted(g.id) && !pol.muted; // reativado num servidor silenciado
      return h('div', voiceDropHooks(g, c), h('div.ch' + (S.view.cid === c.id || (c.type === 15 && S.posts.get(S.view.cid)?.parent_id === c.id) ? '.active' : '') + (S.unread[c.id] && isChatCh(c) ? '.unread' : '') + (pol?.muted ? '.muted' : ''),
        { onclick: () => { go(g.id, c.id); }, ondblclick: c.type === 2 ? () => { hidePreview(); joinVoice(c.id); } : null, onpointerenter: c.type === 2 ? () => voice?.prewarm?.() : null, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c), ...chDragHooks(g, c) },
        h('span.chic', chIcon(c)), h('span.name', chName(c)), (c.type === 2 ? !chCan(c, CH.CONNECT) : !chCan(c, CH.SEND)) && h('span.lockmark', { title: c.type === 2 ? 'Você não pode entrar nesta sala' : 'Só leitura para você' }, icon('lock', 12)), isFav(c.id) && h('span.favmark', { title: 'Nos seus favoritos' }, icon('star', 12)), live && h('span.unmutemark', { title: 'Reativado: avisa mesmo com o servidor silenciado' }, icon('bell', 12)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]), !(S.mentions[c.id] > 0) && !pol?.muted && S.unread[c.id]?.count > 0 && isChatCh(c) && h('span.ubadge', { title: 'Mensagens não lidas' }, S.unread[c.id].count > 99 ? '99+' : S.unread[c.id].count),
        can(g.id, PERM.MANAGE_CHANNELS) && h('span.actions', { onclick: (e) => { e.stopPropagation(); channelSettings(g, c); } }, icon('gear', 16))),
        vs.length > 0 && vusersBlock(g, vs));
    };
    const catRow = (c) => h('div.catblk', h('div.cat' + (S.collapsed.has(c.id) ? '.collapsed' : ''), { title: c.topic || null, onclick: () => { S.collapsed.has(c.id) ? S.collapsed.delete(c.id) : S.collapsed.add(c.id); localStorage.setItem('lc_collapsed', JSON.stringify([...S.collapsed])); renderSide(); }, oncontextmenu: (e) => channelMenu(e, g, c), ...chDragHooks(g, c) },
      h('span.cat-l', { style: { display: 'flex', alignItems: 'center' } }, icon('chevdown', 12), h('span.cat-t', chName(c))),
      can(g.id, PERM.MANAGE_CHANNELS) && h('span.add', { role: 'button', tabindex: 0, title: 'Criar canal', 'aria-label': 'Criar canal', onclick: (e) => { e.stopPropagation(); channelModal(g, 0, c.id); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); channelModal(g, 0, c.id); } } }, icon('plus', 16))),
      !S.collapsed.has(c.id) && (catReady(c, kids(c.id)) ? kids(c.id).map(chRow) : h('div.cat-lazy', { 'data-cat': c.id, style: { height: kids(c.id).length * 36 + 'px' } })),
      S.collapsed.has(c.id) && kids(c.id).filter(k => k.id === S.view.cid || S.unread[k.id]).map(chRow));
    // atalhos do servidor numa faixa de ícones (uma linha só; o nome aparece ao passar o mouse e o da tela aberta fica
    // marcado): Eventos, Clipes, Arquivos e Wishlist (mesma ordem do menu do servidor com a lista oculta, gsearch.js).
    // O "Bora?" fica no "+" da barra dos servidores (rail.js)
    const tool = (cls, ic, label, tip, fn, on = false) => h('button.st-btn.' + cls + (on ? '.on' : ''), { type: 'button', 'aria-label': `${label}: ${tip}`, 'data-tip': label, onclick: fn }, icon(ic, 20));
    const tools = h('div.side-tools.st-strip', { role: 'toolbar', 'aria-label': 'Atalhos do servidor' },
      tool('evrow', 'calendar', 'Eventos', 'jogatinas marcadas: dia, hora, sala e quem vai', () => go(g.id, 'events'), S.view.kind === 'events'),
      tool('clipsonly', 'clip', 'Clipes', 'todos os clipes salvos neste servidor', () => go(g.id, 'clips'), S.view.kind === 'clips'),
      tool('filesrow', 'file', 'Arquivos', 'fotos, vídeos, áudios, documentos e links enviados aqui', () => go(g.id, 'files'), S.view.kind === 'files'),
      tool('wishrow', 'gift', 'Wishlist', 'jogos que o pessoal quer, com preço e promoção', () => go(g.id, 'wishlist'), S.view.kind === 'wishlist'));
    const boras = liveIn(g.id);
    // gente deste servidor procurando grupo agora (Procurar jogadores), com Entrar direto; "Ver todos" abre o mural filtrado
    ensureLfgPosts(); const ads = openPosts(g.id);
    const adsBox = ads.length > 0 && h('div.side-lfg', h('div.side-lfg-cap', icon('users', 14), h('span', ads.length === 1 ? 'Procurando grupo' : `${ads.length} grupos procurando gente`),
      ads.length > 2 && h('button.side-lfg-all', { type: 'button', onclick: () => { setLfgGuild(g.id); go('@me', 'lfg'); } }, 'Ver todos')), ads.slice(0, 2).map(lfgMini));
    list = h('div#side-list.srv-list', boras.length > 0 && h('div.side-bora', ...boras.slice(0, 2).map(b => boraCard(b, { compact: true }))), adsBox, tools, onbRow(g), kids(null).map(chRow), cats.map((c, i) => (sideCats.i = i, catRow(c))));
  }
  // painel do usuário: aberto (nome, status, microfone, fone, engrenagem) ou recolhido na barra dos servidores
  // a barra do perfil fica sempre aberta com a lista visível; o painel de voz ocupa só a largura da lista de canais
  const area = h('div#user-area', voice?.active ? h('div.ua-vp', voicePanel()) : S.rejoin && h('div.ua-vp', rejoinPanel()), userbar());
  const oldHead = side.querySelector(':scope > #side-head'), oldList = side.querySelector(':scope > #side-list'), oldArea = side.querySelector(':scope > #user-area');
  if (oldHead && oldList && oldArea && head.id === 'side-head' && side.children.length === 3) {
    // mesma tela: atualiza só o que mudou (a área do usuário guarda referências a elementos e é recriada)
    morph(oldHead, head); list = morph(oldList, list); oldArea.replaceWith(area);
    if (sideScroll.last !== sideKey()) list.scrollTop = sideScroll.get(sideKey()) || 0; // outra lista (servidor ↔ conversas)
  } else {
    side.replaceChildren(head, list, area);
    // rolagem guardada pelo evento de scroll (ler scrollTop aqui forçava layout), uma por lista: antes a rolagem da lista
    // de canais de um servidor era aplicada à lista de conversas (e ao fim dela, montando as 500 de uma vez)
    const keep = sideScroll.get(sideKey()); if (keep) list.scrollTop = keep;
  }
  catObs.disconnect(); list.querySelectorAll('.cat-lazy').forEach(el => catObs.observe(el));
  dmObs.disconnect(); const dmPad = list.querySelector('.dm-lazy'); if (dmPad) dmObs.observe(dmPad);
  sideScroll.last = sideKey();
  if (!list._scrollWatch) { list._scrollWatch = true; list.addEventListener('scroll', () => { sideScroll.set(sideKey(), list.scrollTop); }, { passive: true }); }
  // altura do painel do usuário medida pelo ResizeObserver (depois do layout que o navegador já ia fazer). Antes o
  // offsetHeight logo depois de recriar a lista forçava o layout da página inteira na hora (até ~400 ms na abertura)
  uaObs.disconnect(); uaObs.observe(area);
  syncView();
}
// capa gerada do servidor sem banner (Resenha 2.0): só tons frios. A cor do servidor escolhe a mais próxima (azul, ciano ou
// violeta); cor quente, cinza ou sem cor: sorteada pelo id, sempre a mesma para o servidor
const COVERS = [['#4b8bff', '#22c3e6', '#7c5cff', 220], ['#13a8c9', '#2ee6c4', '#4b8bff', 190], ['#7c5cff', '#c05cff', '#4b8bff', 262], ['#3a3f4b', '#5b6475', '#4b8bff', -1]];
const hueOf = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < .15) return null; // quase cinza
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (hh * 60 + 360) % 360;
};
function coverOf(g) {
  const hu = hueOf(g.accent); let p;
  if (hu != null && hu >= 170 && hu <= 300) p = COVERS.slice(0, 3).reduce((a, c) => Math.abs(c[3] - hu) < Math.abs(a[3] - hu) ? c : a);
  else { let s = 0; for (const ch of String(g.id)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; p = COVERS[s % COVERS.length]; }
  return { '--cv1': p[0], '--cv2': p[1], '--cv3': p[2] };
}
// botão principal do topo do servidor (Resenha 2.0): com gente em call, "Bora? Entrar na call" com o tempo da call (a sala
// mais cheia que dá para ver); você já nela: "Você está na call" (abre a sala); ninguém em call: "Convidar amigos"
function srvCta(g) {
  let best = null, bv = [];
  for (const c of g.channels) if (c.type === 2 && chVisible(c)) { const vs = roomVoice(c.id); if (vs.length > bv.length) { best = c; bv = vs; } }
  if (best) {
    const mine = voice?.active && voice.channelId === best.id, canJoin = chCan(best, CH.CONNECT);
    return h('button.srv-cta' + (mine ? '.in' : ''), { type: 'button', title: chName(best), onclick: () => { if (mine || !canJoin) go(g.id, best.id); else { hidePreview(); joinVoice(best.id); } } },
      icon('headset', 16), h('span.srv-cta-l', mine ? 'Você está na call' : canJoin ? 'Bora? Entrar na call' : 'Ver a call'), callTimer(bv));
  }
  return canInvite(g) && h('button.srv-cta.inv', { type: 'button', onclick: () => inviteModal(g) }, icon('invite', 16), h('span.srv-cta-l', 'Convidar amigos'));
}
const sideScroll = new Map(), sideKey = () => (S.favMode ? 'fav' : guild(S.view.gid) ? S.view.gid : '@msgs');
// servidor com muitas categorias (1.000 canais): só as primeiras, a do canal aberto e as com gente em sala saem montadas; as
// outras viram um espaço do mesmo tamanho e são montadas quando chegam perto da tela (e ficam montadas). Antes cada
// renderSide montava as 1.000 linhas (~45 ms; scripts/perf-big.mjs)
const sideCats = { gid: null, open: new Set(), i: 0 };
const catReady = (c, list) => sideCats.open.has(c.id) || sideCats.i < 6 || list.length <= 3 || list.some(k => k.id === S.view.cid || (k.type === 2 && [...S.voice.values()].some(v => v.channel_id === k.id))) ? (sideCats.open.add(c.id), true) : false;
const catObs = new IntersectionObserver((es) => { let n = 0; for (const en of es) if (en.isIntersecting) { sideCats.open.add(en.target.dataset.cat); n++; } if (n) renderSide(); }, { rootMargin: '600px 0px' });
const uaObs = new ResizeObserver(() => {
  const area = document.getElementById('user-area'); if (!area) return;
  uaObs.unobserve(area); // uma medida por desenho, como antes (abrir ao passar o mouse não mexe nas margens)
  const hgt = area.offsetHeight, bar = area.querySelector('.pbar')?.offsetHeight || hgt;
  // a barra dos servidores reserva só o espaço do perfil: o painel de voz fica sobre a lista de canais, então a caixa de
  // entrada não sobe ao entrar numa chamada
  $('#app').style.setProperty('--ua-h', bar + 'px');
  $('#app').style.setProperty('--ua-side-h', hgt + 'px'); // a lista de canais termina acima do perfil e do painel de voz
});
const lastActivity = (dm) => { const l = S.messages.get(dm.id), a = l?.length ? l[l.length - 1].id : null, b = dm.last_message?.id || null; return a && b ? (a > b ? a : b) : a || b || dm.id; };
export const lastTime = (dm) => { const l = S.messages.get(dm.id); return Math.max(+(l?.length ? l[l.length - 1].created_at : 0) || 0, +(dm.last_message?.created_at || 0) || 0); };
export const inMessages = () => S.view.kind === 'dm' || S.view.kind === 'home'; // tela com a lista de conversas ao lado
const dmFind = { q: '' };
function sortedDMs() {
  const all = [...S.dms.values()].filter(d => dmPeer(d));
  const by = S.prefs.dmSort || 'recent', recent = (a, b) => (lastTime(b) - lastTime(a)) || (lastActivity(b) > lastActivity(a) ? 1 : -1);
  if (by === 'name') return all.sort((a, b) => user(dmPeer(a).id).display_name.localeCompare(user(dmPeer(b).id).display_name));
  if (by === 'unread') return all.sort((a, b) => (!!S.unread[b.id] - !!S.unread[a.id]) || recent(a, b));
  return all.sort(recent);
}
function dmSortMenu(e) {
  const set = (k) => { S.prefs.dmSort = k; savePrefs(); renderSide(); };
  const cur = S.prefs.dmSort || 'recent', it = (k, l) => ({ label: (cur === k ? '✓ ' : '') + l, fn: () => set(k) });
  menu(e, [it('recent', 'Mais recentes'), it('unread', 'Não lidas primeiro'), it('name', 'Nome (A–Z)')]);
}
// hora curta da última mensagem: "14:05" hoje, "ontem", "12/03"
export const shortWhen = (t) => { if (!t) return ''; const d = new Date(+t), now = new Date(); if (sameDay(t, now)) return clock(t); const y = new Date(now); y.setDate(y.getDate() - 1); if (sameDay(t, y)) return 'ontem'; return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
// muitas conversas (500): as primeiras DM_PAGE saem montadas e o resto vira um espaço do mesmo tamanho; chegando perto
// do fim montam mais DM_STEP. Antes abrir Mensagens montava as 500 linhas (com foto, nome e ícones) numa tarefa de ~100 ms
// (scripts/perf-big.mjs). A conversa aberta sempre aparece, mesmo lá embaixo.
const DM_PAGE = 60, DM_STEP = 200, DM_ROW_H = 50;
const dmLim = { n: DM_PAGE, q: '' };
function dmRest(rest) {
  if (dmLim.q !== dmFind.q) { dmLim.q = dmFind.q; dmLim.n = DM_PAGE; }
  if (rest.length <= dmLim.n) return rest.map(d => dmRow(d, false));
  const shown = rest.slice(0, dmLim.n), open = rest.slice(dmLim.n).find(d => d.id === S.view.cid);
  const pad = h('div.dm-lazy', { 'data-key': 'dm-lazy', style: { height: (rest.length - shown.length - (open ? 1 : 0)) * DM_ROW_H + 'px' } });
  return [...shown.map(d => dmRow(d, false)), pad, open && dmRow(open, false)];
}
const dmObs = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { dmLim.n += DM_STEP; renderSide(); } }, { rootMargin: '600px 0px' });
function dmRow(dm, pin) {
  const p = dmPeer(dm), u = user(p.id), un = S.mentions[dm.id];
  return h('div.ch.dmrow' + (S.view.cid === dm.id ? '.active' : '') + (S.unread[dm.id] ? '.unread' : ''), { onclick: () => go('@me', dm.id), oncontextmenu: (e) => userMenu(e, p.id), ...previewHooks(dm) },
    avatar(u, 36, { ring: 'var(--bg-sec)' }), styleName(h('span.name', u.display_name), u.name_style), un > 0 && h('span.pill', un),
    pin && h('button.dmpin', { type: 'button', title: 'Desafixar', 'aria-label': 'Desafixar conversa', onclick: (e) => { e.stopPropagation(); togglePinDM(p.id); } }, icon('pin', 22)));
}
// tela inicial de Mensagens (botão de Mensagens na barra): em vez de pular para uma conversa, mostra as recentes em
// cartões (foto, nome, prévia da última mensagem, hora e não lidas) para escolher com um clique
// nova mensagem: escolher um amigo (ou qualquer pessoa dos seus servidores)
export function newMessageModal() {
  const q = h('input', { type: 'search', placeholder: 'Digite o nome de um amigo' }), box = h('div.nm-list');
  const friends = new Set([...S.rels.values()].filter(r => r.type === 1).map(r => r.user?.id || r.id));
  const people = [...new Set([...friends, ...[...S.guilds.values()].flatMap(g => [...g.members.keys()])])].filter(id => id !== S.me.id && S.users.has(id));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const l = people.filter(id => !t || (user(id).display_name + ' ' + user(id).username).toLowerCase().includes(t)).sort((a, b) => (friends.has(b) - friends.has(a)) || user(a).display_name.localeCompare(user(b).display_name)).slice(0, 40);
    box.replaceChildren(...l.map(id => h('button.nm-row', { type: 'button', onclick: () => { m.close(); openDM(id); } }, avatar(user(id), 32), h('span', h('b', user(id).display_name), h('small', '@' + user(id).username)), friends.has(id) && h('small.nm-f', 'Amigo'))),
      !l.length && h('div.dm-empty', 'Ninguém encontrado'));
  };
  q.oninput = draw; q.onkeydown = (e) => { if (e.key === 'Enter') box.querySelector('.nm-row')?.click(); };
  const m = modal('Nova mensagem', 'Escolha com quem conversar.', h('div', h('label.f', q), box), [{ label: 'Cancelar', cls: 'link' }]);
  draw(); setTimeout(() => q.focus());
}
function watchFromList(v) {
  const ch = channelById(v.channel_id); if (!ch) return;
  go(ch.guild_id || '@me', ch.id);
  if (voice.channelId !== ch.id) joinVoice(ch.id);
  if (v.user_id !== S.me.id) watchOnly(v.user_id);
  renderVoiceUI();
}
// quem está na sala de voz. Com "Separar por jogos" (clique direito na sala), em grupos: cada jogo com quem está jogando
// (o mais jogado primeiro), depois quem só está conversando e, no fim, quem está "Em espera" (pausa na chamada)
export function vusersBlock(g, vs) {
  if (!S.prefs.voiceByGame || vs.length < 2) return h('div.vusers', vs.map(v => vuserRow(g, v)));
  const games = [], talk = [], hold = [];
  for (const v of vs) {
    if (v.hold) { hold.push(v); continue; }
    const a = !v.bot && activityOf(v.user_id);
    if (!a) { talk.push(v); continue; }
    const grp = games.find(x => sameGameAs(x.a, a)); if (grp) grp.vs.push(v); else games.push({ a, vs: [v] });
  }
  games.sort((x, y) => y.vs.length - x.vs.length || x.a.game.title.localeCompare(y.a.game.title));
  const head = (ic, label, n, cls = '') => h('div.vgroup' + cls, ic, h('span.vg-name', label), h('span.vg-n', String(n)));
  return h('div.vusers.bygame',
    ...games.flatMap(x => [head(gameIcon(x.a, 14), x.a.game.title, x.vs.length), ...x.vs.map(v => vuserRow(g, v))]),
    ...(talk.length && (games.length || hold.length) ? [head(icon('voice', 14), 'Conversando', talk.length), ...talk.map(v => vuserRow(g, v))] : talk.map(v => vuserRow(g, v))),
    ...(hold.length ? [head(icon('pause', 14), 'Em espera', hold.length, '.hold'), ...hold.map(v => vuserRow(g, v))] : []));
}
// ---------- mover arrastando ----------
// Quem pode Moderar voz (e o dono) arrasta alguém da lista de voz e solta em outra sala da barra lateral. Serve para
// chamar a atenção de quem está mutado: a pessoa ouve um "toc-toc" e vê o aviso de quem a moveu, com o botão de desmutar.
let vDrag = null;
export const voiceDragging = () => !!vDrag;
function vDragEnd() {
  if (!vDrag) return; vDrag = null; document.body.classList.remove('vdrag-on');
  document.querySelectorAll('.vdrop-ok,.vdrop-over').forEach(el => el.classList.remove('vdrop-ok', 'vdrop-over'));
  renderSide(); // redesenhos adiados enquanto arrastava
}
function vDragStart(e, g, v) {
  vDrag = { gid: g.id, uid: v.user_id, from: v.channel_id };
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-lc-vuser', v.user_id); e.dataTransfer.setData('text/plain', nameOf(v.user_id, g.id));
  document.body.classList.add('vdrag-on'); e.currentTarget.classList.add('vdragging');
  // salas que aceitam: destacadas durante o arrasto
  for (const el of document.querySelectorAll('[data-vroom]')) if (canMoveTo(channelById(el.dataset.vroom), vDrag.from)) el.classList.add('vdrop-ok');
}
// atributos do bloco de uma sala de voz (linha + lista de quem está nela) para receber alguém arrastado
export function voiceDropHooks(g, c) {
  if (c.type !== 2) return {};
  const ok = () => vDrag && vDrag.gid === g.id && canMoveTo(c, vDrag.from);
  return {
    'data-vroom': c.id,
    ondragenter: (e) => { if (ok()) { e.preventDefault(); e.currentTarget.classList.add('vdrop-over'); } },
    ondragover: (e) => { if (ok()) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('vdrop-over'); } },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('vdrop-over'); },
    ondrop: (e) => { if (!ok()) return; e.preventDefault(); const { gid, uid } = vDrag; vDragEnd(); moveVoice(gid, uid, c); },
  };
}
// ---------- arrastar canais ----------
// Quem pode Gerenciar canais arrasta um canal para cima/baixo de outro (inclusive de outra categoria) ou para logo
// abaixo do título de uma categoria (vira o primeiro dela); soltar na metade de cima do título de uma categoria põe o canal
// no fim da seção anterior (acima da primeira categoria: fora das categorias). Categorias arrastadas trocam de lugar entre si.
// A ordem muda na hora aqui e vai inteira para o servidor (PUT /guilds/:id/channels/order), que avisa todo mundo.
let cDrag = null;
export const channelDragging = () => !!cDrag;
export function applyChannelOrder(g, order) {
  const at = new Map(order.map(o => [o.id, o]));
  for (const c of g.channels) { const o = at.get(c.id); if (o) { c.position = o.position; c.parent_id = o.parent_id; } }
  g.channels.sort((a, b) => a.position - b.position);
}
// seções na ordem da barra: sem categoria primeiro, depois cada categoria com seus canais
function chSections(g) {
  const cats = g.channels.filter(c => c.type === 4), catIds = new Set(cats.map(c => c.id));
  const secs = [{ cat: null, kids: [] }, ...cats.map(c => ({ cat: c, kids: [] }))], by = new Map(secs.map(x => [x.cat?.id ?? null, x]));
  for (const c of g.channels) if (c.type !== 4) by.get(catIds.has(c.parent_id) ? c.parent_id : null).kids.push(c);
  return secs;
}
function cDragEnd() {
  if (!cDrag) return; cDrag = null; document.body.classList.remove('cdrag-on');
  document.querySelectorAll('.cdragging,.cdrop-before,.cdrop-after').forEach(el => el.classList.remove('cdragging', 'cdrop-before', 'cdrop-after'));
  renderSide();
}
// onde cai o que está sendo arrastado ao soltar sobre o canal/categoria t (metade de cima: antes; de baixo: depois)
function dropSpot(t, e) {
  if (!cDrag || cDrag.id === t.id || (cDrag.cat && t.type !== 4)) return null;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}
async function dropChannel(g, id, t, spot) {
  const secs = chSections(g), dragged = channelById(id); if (!dragged || dragged.id === t.id) return;
  if (dragged.type === 4) {
    const from = secs.findIndex(x => x.cat?.id === dragged.id), [sec] = secs.splice(from, 1);
    const to = secs.findIndex(x => x.cat?.id === t.id); secs.splice(to + (spot === 'after' ? 1 : 0), 0, sec);
  } else {
    for (const x of secs) x.kids = x.kids.filter(c => c.id !== dragged.id);
    if (t.type === 4) {
      const i = secs.findIndex(x => x.cat?.id === t.id);
      if (spot === 'after') secs[i].kids.unshift(dragged); else secs[Math.max(0, i - 1)].kids.push(dragged);
    } else {
      const sec = secs.find(x => x.kids.some(c => c.id === t.id)), i = sec.kids.findIndex(c => c.id === t.id);
      sec.kids.splice(i + (spot === 'after' ? 1 : 0), 0, dragged);
    }
  }
  const order = secs.flatMap(x => [...(x.cat ? [x.cat] : []), ...x.kids]).map((c, i) => ({ id: c.id, position: i, parent_id: c.type === 4 ? null : (secs.find(s => s.kids.includes(c)).cat?.id ?? null) }));
  if (order.every(o => { const c = channelById(o.id); return c.position === o.position && (c.parent_id || null) === o.parent_id; })) return;
  const undo = g.channels.map(c => ({ id: c.id, position: c.position, parent_id: c.parent_id || null }));
  if (dragged.type !== 4 && order.find(o => o.id === dragged.id).parent_id) S.collapsed.delete(order.find(o => o.id === dragged.id).parent_id); // mostra onde caiu
  applyChannelOrder(g, order); renderSide();
  try { await api('PUT', `/guilds/${g.id}/channels/order`, { order: order.map(({ id, parent_id }) => ({ id, parent_id })) }); }
  catch (err) { applyChannelOrder(g, undo); renderSide(); toast(err?.message || 'Não deu para mover o canal', true); }
}
// atributos de uma linha de canal ou do título de uma categoria para arrastar e receber canais
function chDragHooks(g, c) {
  if (!can(g.id, PERM.MANAGE_CHANNELS)) return {};
  const mark = (e, spot) => { const el = e.currentTarget; el.classList.toggle('cdrop-before', spot === 'before'); el.classList.toggle('cdrop-after', spot === 'after'); };
  return {
    draggable: true,
    ondragstart: (e) => {
      if (vDrag) return;
      e.stopPropagation(); hidePreview();
      cDrag = { gid: g.id, id: c.id, cat: c.type === 4 };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-lc-channel', c.id); e.dataTransfer.setData('text/plain', chName(c));
      document.body.classList.add('cdrag-on'); e.currentTarget.classList.add('cdragging');
    },
    ondragend: cDragEnd,
    ondragover: (e) => { const spot = cDrag?.gid === g.id && dropSpot(c, e); if (!spot) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; mark(e, spot); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) mark(e, null); },
    ondrop: (e) => { const spot = cDrag?.gid === g.id && dropSpot(c, e); if (!spot) return; e.preventDefault(); e.stopPropagation(); const id = cDrag.id; cDragEnd(); dropChannel(g, id, c, spot); },
  };
}
let movedT = 0;
export function movedNotice(by, to) {
  playSound('moved');
  document.getElementById('vmoved')?.remove(); clearTimeout(movedT);
  const close = () => { clearTimeout(movedT); el.remove(); };
  const muted = !!(voice?.muted || voice?.deafened);
  const el = h('div#vmoved.vmoved' + (muted ? '.muted' : ''), { role: 'alert' },
    icon('voice', 20),
    h('div.vm-t', h('b', `${by} moveu você para ${to ? chName(to) : 'outra sala'}`), muted && h('small', 'Você está mutado — talvez queiram falar com você')),
    muted && h('button.btn', { type: 'button', onclick: () => { if (voice?.muted || voice?.deafened) voice.toggleMute(); renderVoiceUI(); close(); } }, voice?.deafened ? 'Desensurdecer e desmutar' : 'Desmutar'),
    h('button.vm-x', { type: 'button', title: 'Fechar', 'aria-label': 'Fechar', onclick: close }, icon('x', 16)));
  document.body.append(el);
  movedT = setTimeout(close, muted ? 15000 : 6000);
  // janela em segundo plano: pisca o título até a pessoa voltar
  if (document.hidden) {
    const t0 = document.title, msg = `🔔 ${by} moveu você`; let n = 0;
    const iv = setInterval(() => { document.title = n++ % 2 ? t0 : msg; }, 1000);
    const stop = () => { if (document.hidden) return; clearInterval(iv); document.title = t0; document.removeEventListener('visibilitychange', stop); };
    document.addEventListener('visibilitychange', stop);
  }
}
function vuserRow(g, v) {
  if (v.bot) return botRow(v);
  const u = user(v.user_id), drag = canMoveVoice(g.id, v.user_id);
  const row = h('div.vuser' + (v.hold ? '.hold' : '') + (drag ? '.vdraggable' : ''), { 'data-uid': v.user_id, oncontextmenu: (e) => userMenu(e, v.user_id, g.id), onclick: (e) => profile(e.currentTarget, v.user_id, g.id),
    ...(drag ? { draggable: true, title: 'Arraste para outra sala para mover', ondragstart: (e) => vDragStart(e, g, v), ondragend: vDragEnd } : {}) },
    (() => { const a = avatar(u, 24, { status: false }); if (voice?.speaking.has(v.user_id)) a.classList.add('speaking'); if (voice?.sbActive.has(v.user_id)) a.classList.add('sbplay'); a.dataset.uid = v.user_id; return a; })(),
    h('span.nm', nameOf(v.user_id, g.id), fxBadge(v.fx)), voiceGameIcon(v.user_id), appBadge(v), v.screen && h('span.live', { title: v.screen_title ? 'Transmitindo ' + v.screen_title : 'Transmitindo' }, 'Ao vivo'), v.hold && h('span.vu-hold', { title: 'Em espera: volta já (não ouve nem fala até voltar)' }, 'Em espera'),
    h('span.ico', v.wt && h('span.vu-wt', { title: 'Assistindo no Watch Together' }, icon('tv', 14)), v.watching && h('span.vu-watch', { title: 'Assistindo a uma transmissão' }, icon('eye', 14)), v.video && icon('video', 14), muteIco(v), v.mod_deaf ? h('span.mico.lmute', { title: 'Ensurdecido pela moderação' }, icon('headoff', 14)) : v.deaf && icon('headoff', 14)));
  if (v.screen) { const mine = v.user_id === S.me.id; streamHover(row, { uid: v.user_id, mine, getStream: () => (mine ? voice.screen : voice.peers.get(v.user_id)?.streams.screen), onWatch: () => watchFromList(v) }); }
  return row;
}
