// Barra lateral: lista de canais do servidor, conversas diretas, quem está em cada sala de voz e mover arrastando.
import { fxBadge } from './fxui.js';
import { h, morph, icon, avatar, clock, sameDay, debounce, imgUrl, platformIcons } from './util.js';
import { S, user, guild, channelById, nameOf, can, PERM, dmPeer, modal, menu, notifPolicy, serverMuted, savePrefs, CH, chCan, CH_KINDS, isChatCh } from './state.js';
import { playSound } from './sounds.js';
import { previewHooks, hidePreview } from './chpreview.js';
import { chName } from './chnames.js';
import { streamHover } from './livepip.js';
import { openLfgCreate, openLfgProfile } from './lfg.js';
import { gamesNav } from './gamestabs.js';
import { openIntentModal } from './intents.js';
import { styleName } from './themes.js';
import { canMoveVoice, canMoveTo, moveVoice } from './mod.js';
import { activityOf, sameGameAs, gameIcon, voiceGameIcon } from './activity.js';
import { voice, $, syncView, deferRender } from './gateway.js';
import { botRow } from './botmusic.js';
import { appBadge } from './appver.js';
import { go } from './nav.js';
import { inGames, srvGames, callTimer, friendsIn, avStack, friendsInServer, guildMenu, inviteModal } from './rail.js';
import { favList, isFav, favSide } from './favs.js';
import { channelModal, channelMenu, channelSettings } from './chmenu.js';
import { voicePanel, rejoinPanel, joinVoice, userbar } from './userbar.js';
import { profile, pinnedDMs, togglePinDM, muteIco, openDM, userMenu } from './usermenu.js';
import { renderVoiceUI } from './stage.js';
import { watchOnly } from './share.js';
// ---------- barra lateral ----------
export const chIcon = (c, sz = 20) => icon(CH_KINDS[c.type]?.[0] || 'hash', sz);
export function renderSide() {
  if (deferRender(renderSide)) return; // vários eventos seguidos: um redesenho só no próximo quadro
  const side = $('#side'); if (!side) return;
  if (vDrag) return; // arrastando alguém para outra sala: redesenha ao soltar (senão o arrasto é cancelado)
  let head, list;
  if (S.favMode && favList().length) ({ head, list } = favSide());
  else if ((S.view.gid === '@me' || !guild(S.view.gid)) && inGames()) {
    // seção Jogos: própria, como um servidor (antes ficava dentro de Amigos)
    head = h('div#side-head.sh-plain', h('span.sh-title', 'Jogos'));
    // as quatro áreas (Procurar jogadores, Início, Notícias, Torneios) e atalhos do mural (gamestabs.js)
    list = gamesNav({ create: () => openLfgCreate(), intent: () => openIntentModal(), profile: () => openLfgProfile() });
  } else if (S.view.gid === '@me' || !guild(S.view.gid)) {
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
    head = h('div#side-head.srv-head' + (g.banner ? '.has-banner' : ''), { style: !g.banner && g.accent ? { borderTop: `3px solid ${g.accent}` } : null },
      g.banner && h('div.srv-banner', { style: { backgroundImage: `url("${String(imgUrl(g.banner, 480)).replace(/["\\\n]/g, encodeURIComponent)}")` } }),
      h('div.srv-name', h('div.gd', { title: 'Ações do servidor', onclick: (e) => menuAt(e.currentTarget) }, h('span', g.name), icon('chevdown', 16)),
        h('button.sh-btn', { type: 'button', title: 'Convidar pessoas', 'aria-label': 'Convidar pessoas para o servidor', onclick: () => inviteModal(g) }, icon('invite', 20))),
      srvGames(g),
      (() => { const fr = friendsIn(g); return fr.length > 0 && h('button.srv-friends', { type: 'button', title: 'Ver os amigos neste servidor', onclick: () => friendsInServer(g) }, avStack(fr, 18), h('span', fr.length === 1 ? `${fr[0].display_name} está aqui` : `${fr.length} amigos aqui`)); })());
    const cats = g.channels.filter(c => c.type === 4), byParent = new Map();
    for (const c of g.channels) if (c.type !== 4) { const k = c.parent_id || null; (byParent.get(k) || byParent.set(k, []).get(k)).push(c); }
    const kids = (pid) => byParent.get(pid) || [];
    if (sideCats.gid !== g.id) { sideCats.gid = g.id; sideCats.open.clear(); }
    const chRow = (c) => {
      const vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
      const pol = isChatCh(c) ? notifPolicy(c) : null, live = pol && serverMuted(g.id) && !pol.muted; // reativado num servidor silenciado
      return h('div', voiceDropHooks(g, c), h('div.ch' + (S.view.cid === c.id || (c.type === 15 && S.posts.get(S.view.cid)?.parent_id === c.id) ? '.active' : '') + (S.unread[c.id] && isChatCh(c) ? '.unread' : '') + (pol?.muted ? '.muted' : ''),
        { onclick: () => { go(g.id, c.id); }, ondblclick: c.type === 2 ? () => { hidePreview(); joinVoice(c.id); } : null, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c) },
        chIcon(c), h('span.name', chName(c)), (c.type === 2 ? !chCan(c, CH.CONNECT) : !chCan(c, CH.SEND)) && h('span.lockmark', { title: c.type === 2 ? 'Você não pode entrar nesta sala' : 'Só leitura para você' }, icon('lock', 12)), isFav(c.id) && h('span.favmark', { title: 'Nos seus favoritos' }, icon('star', 12)), live && h('span.unmutemark', { title: 'Reativado: avisa mesmo com o servidor silenciado' }, icon('bell', 12)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]),
        can(g.id, PERM.MANAGE_CHANNELS) && h('span.actions', { onclick: (e) => { e.stopPropagation(); channelSettings(g, c); } }, icon('gear', 16))),
        vs.length > 0 && vusersBlock(g, vs));
    };
    const catRow = (c) => h('div.catblk', h('div.cat' + (S.collapsed.has(c.id) ? '.collapsed' : ''), { title: c.topic || null, onclick: () => { S.collapsed.has(c.id) ? S.collapsed.delete(c.id) : S.collapsed.add(c.id); localStorage.setItem('lc_collapsed', JSON.stringify([...S.collapsed])); renderSide(); }, oncontextmenu: (e) => channelMenu(e, g, c) },
      h('span', { style: { display: 'flex', alignItems: 'center' } }, icon('caret', 12), chName(c)),
      can(g.id, PERM.MANAGE_CHANNELS) && h('span.add', { title: 'Criar canal', onclick: (e) => { e.stopPropagation(); channelModal(g, 0, c.id); } }, icon('plus', 16))),
      !S.collapsed.has(c.id) && (catReady(c, kids(c.id)) ? kids(c.id).map(chRow) : h('div.cat-lazy', { 'data-cat': c.id, style: { height: kids(c.id).length * 36 + 'px' } })),
      S.collapsed.has(c.id) && kids(c.id).filter(k => k.id === S.view.cid || S.unread[k.id]).map(chRow));
    // atalhos do servidor (clipes, arquivos, wishlist, eventos): bloco próprio no topo, separado dos canais por uma linha
    const clipsRow = h('div.ch.clipsrow' + (S.view.kind === 'clips' ? '.active' : ''), { onclick: () => go(g.id, 'clips'), title: 'Todos os clipes salvos neste servidor' }, icon('clip', 20), h('span.name', 'Clipes'));
    const filesRow = h('div.ch.clipsrow.filesrow' + (S.view.kind === 'files' ? '.active' : ''), { onclick: () => go(g.id, 'files'), title: 'Fotos, vídeos, áudios, documentos e links enviados neste servidor' }, icon('file', 20), h('span.name', 'Arquivos'));
    const wishRow = h('div.ch.clipsrow.wishrow' + (S.view.kind === 'wishlist' ? '.active' : ''), { onclick: () => go(g.id, 'wishlist'), title: 'Jogos que o pessoal deste servidor quer, com preço e promoção' }, icon('gift', 20), h('span.name', 'Wishlist'));
    const evRow = h('div.ch.clipsrow.evrow' + (S.view.kind === 'events' ? '.active' : ''), { onclick: () => go(g.id, 'events'), title: 'Jogatinas marcadas: dia, hora, sala e quem vai' }, icon('calendar', 20), h('span.name', 'Eventos'));
    list = h('div#side-list', h('div.side-tools', clipsRow, filesRow, wishRow, evRow), kids(null).map(chRow), cats.map((c, i) => (sideCats.i = i, catRow(c))));
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
const sideScroll = new Map(), sideKey = () => (S.favMode ? 'fav' : guild(S.view.gid) ? S.view.gid : inGames() ? '@games' : '@msgs');
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
    avatar(u, 36, { ring: 'var(--bg-sec)' }), styleName(h('span.name', u.display_name), u.name_style), platformIcons(u, 13), un > 0 && h('span.pill', un),
    pin && h('button.dmpin', { type: 'button', title: 'Desafixar', 'aria-label': 'Desafixar conversa', onclick: (e) => { e.stopPropagation(); togglePinDM(p.id); } }, icon('pin', 22)));
}
// tela inicial de Mensagens (botão de Mensagens na barra): em vez de pular para uma conversa, mostra as recentes em
// cartões (foto, nome, prévia da última mensagem, hora e não lidas) para escolher com um clique
// nova mensagem: escolher um amigo (ou qualquer pessoa dos seus servidores)
function newMessageModal() {
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
    h('span.nm', nameOf(v.user_id, g.id), fxBadge(v.fx)), voiceGameIcon(v.user_id), appBadge(v), v.screen && h('span.live', 'Ao vivo'), v.hold && h('span.vu-hold', { title: 'Em espera: volta já (não ouve nem fala até voltar)' }, 'Em espera'),
    h('span.ico', v.wt && h('span.vu-wt', { title: 'Assistindo no Watch Together' }, icon('tv', 14)), v.watching && h('span.vu-watch', { title: 'Assistindo a uma transmissão' }, icon('eye', 14)), v.video && icon('video', 14), muteIco(v), v.mod_deaf ? h('span.mico.lmute', { title: 'Ensurdecido pela moderação' }, icon('headoff', 14)) : v.deaf && icon('headoff', 14)));
  if (v.screen) { const mine = v.user_id === S.me.id; streamHover(row, { uid: v.user_id, mine, getStream: () => (mine ? voice.screen : voice.peers.get(v.user_id)?.streams.screen), onWatch: () => watchFromList(v) }); }
  return row;
}
