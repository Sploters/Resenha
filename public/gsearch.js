// Buscar em tudo (painel ao lado da lista de canais) e o atalho flutuante do servidor com a lista de canais oculta.
import { h, icon, avatar, stripInvites, skeleton, debounce, imgUrl } from './util.js';
import { S, api, user, guild, channelById, nameOf, dmPeer, menu, popout, savePrefs } from './state.js';
import { chName } from './chnames.js';
import { voice, $ } from './gateway.js';
import { go } from './nav.js';
import { renderRail } from './rail.js';
import { shortWhen } from './side.js';
import { joinVoice } from './userbar.js';
import { initialsOf, openDM } from './usermenu.js';
import { jumpTo } from './msgactions.js';
// ---------- busca em tudo (lupa no topo da barra) ----------
// a lista da esquerda vira o painel de busca: onde procurar, ordem (novas/antigas/relevantes) e resultados agrupados por
// servidor e por conversa; abrir um grupo mostra as mensagens ali mesmo
export const GS = { q: '', scope: 'all', sort: 'new', groups: null, loading: false, open: null, msgs: {}, seq: 0 };
// Buscar em tudo é um painel próprio, ao lado da lista de canais (antes tomava o lugar dela): continua aberto enquanto
// você troca de servidor e de canal, para comparar o resultado da busca com o que está nos canais. A largura é ajustável
// arrastando a borda (fica na conta). No celular abre por cima e fecha ao escolher um resultado.
const gsNarrow = () => matchMedia('(max-width: 640px)').matches;
const gsNarrowClose = () => { if (gsNarrow()) closeGlobalSearch(); };
export function renderGS() {
  const box = $('#gsearch'); if (!box) return;
  box.classList.toggle('hidden', !S.searchOpen);
  if (!S.searchOpen) return box.replaceChildren();
  const old = $('#gs-q'), focused = old && document.activeElement === old, val = old?.value, a = old?.selectionStart, b = old?.selectionEnd;
  const keep = box.querySelector('.gs-list')?.scrollTop || 0;
  const { head, list } = globalSearchPanel();
  const grip = h('div.gs-grip', { title: 'Arraste para mudar a largura', onpointerdown: (e) => {
    e.preventDefault(); const x0 = e.clientX, w0 = box.offsetWidth; grip.setPointerCapture(e.pointerId);
    const mv = (ev) => { box.style.width = Math.max(260, Math.min(720, w0 + ev.clientX - x0)) + 'px'; $('#app').style.setProperty('--gs-w', box.offsetWidth + 'px'); };
    const up = () => { grip.removeEventListener('pointermove', mv); S.prefs.gsWidth = box.offsetWidth; savePrefs(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up, { once: true });
  } });
  if (S.prefs.gsWidth && !gsNarrow()) box.style.width = S.prefs.gsWidth + 'px';
  box.replaceChildren(head, list, grip);
  $('#app').style.setProperty('--gs-w', box.offsetWidth + 'px'); // as abas de canais passam por cima do painel também
  list.scrollTop = keep;
  const inp = $('#gs-q');
  if (old && inp) { inp.value = val; if (focused) { inp.focus(); try { inp.setSelectionRange(a, b); } catch { } } }
}
export function toggleGlobalSearch(focus = true) { S.searchOpen = !S.searchOpen; $('#app')?.classList.toggle('gs-open', S.searchOpen); renderRail(); renderGS(); if (S.searchOpen && focus) setTimeout(() => $('#gs-q')?.focus()); }
function closeGlobalSearch() { if (!S.searchOpen) return; S.searchOpen = false; $('#app')?.classList.remove('gs-open'); renderRail(); renderGS(); }
// ---------- Mensagens/Amigos e Buscar em tudo com a lista de canais oculta ----------
// Buscar em tudo: só abre com clique (passar o mouse não faz nada); com a lista
// oculta, o painel de busca aparece flutuando por cima da conversa e fecha ao clicar fora ou no ícone de novo
export const sideHidden = () => !!$('#app.hide-side') && matchMedia('(min-width: 641px)').matches;
// Servidores com a lista de canais oculta: o mouse parado 0,45 s em cima do servidor abre um atalho com Clipes, Arquivos,
// o canal de texto principal e a sala de voz principal (o primeiro de cada tipo, na ordem da lista). Clicar na sala já
// entra nela. Fecha 0,4 s depois que o mouse sai; passar para outro servidor com o atalho aberto troca na hora
const RG = { el: null, gid: null, t: 0, wait: 0 };
const gFlyOpen = () => !!RG.el && RG.el.isConnected && !RG.el.classList.contains('leaving');
export function gFlyHide() { clearTimeout(RG.t); gFlyCancel(); if (gFlyOpen()) RG.el.remove(); RG.el = null; RG.gid = null; }
export function gFlyCancel() { clearTimeout(RG.wait); RG.wait = 0; }
function gFlyLater() { clearTimeout(RG.t); RG.t = setTimeout(gFlyHide, 400); }
// canais na ordem em que aparecem na lista: os sem categoria primeiro, depois categoria por categoria
export const guildChOrder = (g) => { const kids = (pid) => g.channels.filter(c => c.type !== 4 && (c.parent_id || null) === pid); return [...kids(null), ...g.channels.filter(c => c.type === 4).flatMap(c => kids(c.id))]; };
function gFlyShow(anchor, g) {
  clearTimeout(RG.t); gFlyCancel(); if (gFlyOpen() && RG.gid === g.id) return;
  const chans = guildChOrder(g), text = chans.find(c => c.type === 0), room = chans.find(c => c.type === 2);
  const here = S.view.gid === g.id && !S.favMode, inRoom = room && voice?.channelId === room.id;
  const people = room ? [...S.voice.values()].filter(v => v.channel_id === room.id) : [];
  const opt = (on, ic, label, fn, extra, tip) => h('button.rf-opt' + (on ? '.on' : ''), { type: 'button', role: 'menuitem', title: tip || null, 'aria-current': on ? 'page' : null, onclick: () => { gFlyHide(); S.favMode = false; fn(); } }, icon(ic, 20), h('span.gf-l', label), extra);
  const el = RG.el = popout(anchor, h('div.rf-pop.gf-pop', { role: 'menu', 'aria-label': g.name },
    h('div.gf-head', g.name),
    opt(here && S.view.kind === 'clips', 'clip', 'Clipes', () => go(g.id, 'clips')),
    opt(here && S.view.kind === 'files', 'file', 'Arquivos', () => go(g.id, 'files')),
    opt(here && S.view.kind === 'wishlist', 'gift', 'Wishlist', () => go(g.id, 'wishlist')),
    opt(here && S.view.kind === 'events', 'calendar', 'Eventos', () => go(g.id, 'events')),
    (text || room) && h('div.gf-sep'),
    text && opt(here && S.view.cid === text.id, 'hash', chName(text), () => go(g.id, text.id),
      S.mentions[text.id] > 0 ? h('span.pill', S.mentions[text.id]) : S.unread[text.id] ? h('i.gf-dot') : null),
    room && opt(inRoom, 'voice', chName(room), () => { go(g.id, room.id); joinVoice(room.id); },
      people.length > 0 && h('span.gf-av', people.slice(0, 3).map(v => avatar(user(v.user_id), 20, { status: false })), people.length > 3 && h('small', '+' + (people.length - 3))),
      inRoom ? 'Você está nesta sala' : 'Entrar na sala de voz')));
  el.classList.add('rf-popout', 'gf-popout'); RG.gid = g.id;
  el.addEventListener('mouseenter', () => clearTimeout(RG.t)); el.addEventListener('mouseleave', gFlyLater);
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, Math.min(r.top + r.height / 2 - 24, innerHeight - b.height - 8)) + 'px'; // o nome do servidor na altura do ícone
}
{
  const flyOf = (e) => sideHidden() && e.target.closest?.('#rail [data-fly]')?.dataset.fly;
  document.addEventListener('mouseover', (e) => {
    const k = flyOf(e);
    if (k === 'g') {
      const anchor = e.target.closest('[data-fly]'), g = guild(anchor.dataset.gid); if (!g) return;
      clearTimeout(RG.t);
      if (gFlyOpen()) { if (RG.gid !== g.id) gFlyShow(anchor, g); return; } // já aberto: troca de servidor na hora
      if (RG.wait) return;
      RG.wait = setTimeout(() => { RG.wait = 0; if (anchor.isConnected && anchor.matches(':hover') && !document.querySelector('#layer :is(.popout, .menu, .emoji-picker):not(.leaving):not(.rf-popout)')) gFlyShow(anchor, g); }, 450);
    }
  });
  document.addEventListener('mouseout', (e) => {
    const k = flyOf(e), to = e.relatedTarget;
    if (k === 'g' && to?.closest?.('[data-fly]') !== e.target.closest('[data-fly]')) { gFlyCancel(); if (gFlyOpen() && !to?.closest?.('.gf-popout')) gFlyLater(); }
  });
  // busca flutuando: clicar fora fecha; abrir um resultado também (para ver a mensagem que estava embaixo do painel)
}
const gsKey = (g) => g.guild_id ? 'g:' + g.guild_id : 'd:' + g.channel_id;
async function runGlobalSearch() {
  const q = GS.q.trim(), seq = ++GS.seq; GS.open = null; GS.msgs = {};
  if (!q) { GS.groups = null; GS.loading = false; return renderGS(); }
  GS.loading = true; renderGS();
  const r = await api('GET', `/search/groups?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(GS.scope)}&sort=${GS.sort}`).catch(() => []);
  if (seq !== GS.seq) return; // chegou uma busca mais nova
  GS.groups = (r || []).filter(g => g.guild_id ? guild(g.guild_id) : S.dms.has(g.channel_id)); GS.loading = false; renderGS();
}
// buscas recentes: ficam na conta (S.prefs, sincroniza com os outros aparelhos na hora) — a busca feita no PC aparece no celular
function rememberSearch(q) {
  q = String(q || '').trim(); if (q.length < 2) return;
  const list = (S.prefs.recentSearches || []).filter(x => x.toLowerCase() !== q.toLowerCase());
  S.prefs.recentSearches = [q, ...list].slice(0, 8); savePrefs();
}
async function openGsGroup(g) {
  rememberSearch(GS.q);
  const k = gsKey(g); if (GS.open === k) { GS.open = null; return renderGS(); }
  GS.open = k; renderGS();
  if (GS.msgs[k]) return;
  const seq = GS.seq, list = await api('GET', `/search?q=${encodeURIComponent(GS.q.trim())}&${g.guild_id ? 'guild=' + g.guild_id : 'channel=' + g.channel_id}&sort=${GS.sort}`).catch(() => []);
  if (seq !== GS.seq) return; // a busca mudou no meio: o resultado é da antiga
  GS.msgs[k] = list || []; renderGS();
}
// termos digitados (sem os filtros de:, tem:, em:) para destacar nos resultados
const gsTerms = () => GS.q.split(/\s+/).filter(t => t && !/^(de|tem|em|from|has|in):/i.test(t)).map(t => t.toLowerCase());
function gsMark(text) {
  const terms = gsTerms(); if (!terms.length) return [text];
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return String(text).split(re).map((p, i) => (i % 2 ? h('mark.gs-hl', p) : p));
}
function globalSearchPanel() {
  const input = h('input#gs-q', { type: 'search', placeholder: 'Buscar em tudo', value: GS.q, 'aria-label': 'Buscar em todas as conversas e servidores',
    oninput: debounce((e) => { GS.q = e.target.value; runGlobalSearch(); }, 300), onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); } else if (e.key === 'Enter') rememberSearch(e.target.value); } });
  const head = h('div.gs-head', icon('search', 22), input, h('button.sh-btn', { type: 'button', title: 'Fechar a busca', 'aria-label': 'Fechar a busca', onclick: () => closeGlobalSearch() }, icon('x', 18)));
  const scopeLabel = GS.scope === 'all' ? 'DMs e servidores' : GS.scope === 'dms' ? 'Mensagens diretas' : (guild(GS.scope)?.name || 'Servidor');
  const scopeMenu = (e) => { const it = (k, l) => ({ label: (GS.scope === k ? '✓ ' : '') + l, fn: () => { GS.scope = k; runGlobalSearch(); } });
    const r = e.currentTarget.getBoundingClientRect(); menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [it('all', 'DMs e servidores'), it('dms', 'Só mensagens diretas'), '-', ...[...S.guilds.values()].map(g => it(g.id, g.name))]); };
  const chip = (k, l) => h('button.gs-chip' + (GS.sort === k ? '.on' : ''), { type: 'button', 'aria-pressed': String(GS.sort === k), onclick: () => { GS.sort = k; runGlobalSearch(); } }, l);
  const filters = h('div.gs-filters', h('button.gs-scope', { type: 'button', onclick: scopeMenu }, h('span', scopeLabel), icon('chevdown', 16)), chip('new', 'Novas'), chip('old', 'Antigas'), chip('relevant', 'Relevantes'));
  // servidores e pessoas cujo nome bate com a busca: atalho direto
  const t = GS.q.trim().toLowerCase(), plain = t && !/[:]/.test(t);
  const gHits = plain ? [...S.guilds.values()].filter(g => g.name.toLowerCase().includes(t)).slice(0, 4) : [];
  const pHits = plain ? [...S.dms.values()].map(d => user(dmPeer(d)?.id)).filter(u => u && (u.display_name + ' ' + u.username).toLowerCase().includes(t)).slice(0, 4) : [];
  const fmtN = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : String(n));
  const groupRow = (g) => {
    const gg = g.guild_id && guild(g.guild_id), dm = !gg && S.dms.get(g.channel_id), u = dm && user(dmPeer(dm).id), k = gsKey(g), open = GS.open === k;
    const ic = gg ? h('div.gs-ic', gg.icon ? h('img', { src: imgUrl(gg.icon, 48), alt: '' }) : initialsOf(gg.name)) : avatar(u, 40, { status: false });
    const sub = `${fmtN(g.count)} ${g.count === 1 ? 'mensagem' : 'mensagens'}` + (gg ? ` em ${g.channels} ${g.channels === 1 ? 'canal' : 'canais'}` : '');
    const msgs = open && (GS.msgs[k] ? h('div.gs-msgs', GS.msgs[k].length ? GS.msgs[k].map(m => gsMsg(m, !!gg)) : h('div.dm-empty', 'Nada encontrado')) : h('div.gs-msgs', skeleton('rows', 3)));
    return [h('button.gs-group' + (open ? '.open' : ''), { type: 'button', 'aria-expanded': String(open), onclick: () => openGsGroup(g) }, ic, h('span.gs-t', h('b', gg ? gsMark(gg.name) : gsMark(u.display_name)), h('small', sub)), icon('chevdown', 16)), msgs];
  };
  const hits = (gHits.length + pHits.length > 0) && [h('div.cat', { style: { cursor: 'default' } }, 'Ir para'),
    ...gHits.map(g => h('button.gs-group', { type: 'button', onclick: () => { gsNarrowClose(); go(g.id); } }, h('div.gs-ic', g.icon ? h('img', { src: imgUrl(g.icon, 48), alt: '' }) : initialsOf(g.name)), h('span.gs-t', h('b', gsMark(g.name)), h('small', 'Servidor')))),
    ...pHits.map(u => h('button.gs-group', { type: 'button', onclick: () => { gsNarrowClose(); openDM(u.id); } }, avatar(u, 40), h('span.gs-t', h('b', gsMark(u.display_name)), h('small', 'Mensagem direta'))))];
  const recent = S.prefs.recentSearches || [];
  const recentBox = recent.length > 0 && h('div.gs-recent', h('div.cat', { style: { cursor: 'default' } }, h('span', 'Buscas recentes'),
    h('button.gs-clear', { type: 'button', title: 'Limpar as buscas recentes (em todos os aparelhos)', onclick: () => { S.prefs.recentSearches = []; savePrefs(); renderGS(); } }, 'Limpar')),
    recent.map(q => h('button.gs-rq', { type: 'button', onclick: () => { GS.q = q; const i = $('#gs-q'); if (i) i.value = q; runGlobalSearch(); } }, icon('clock', 16), h('span', q))));
  const body = !t ? [recentBox, h('div.dm-empty', h('p', 'Procure mensagens em todas as suas conversas e servidores.'), h('small', 'Filtros: de:nome · tem:imagem, arquivo, link ou video · em:canal'))]
    : GS.loading && !GS.groups ? skeleton('rows', 4)
    : [hits, GS.groups?.length ? [h('div.cat', { style: { cursor: 'default' } }, 'Mensagens'), ...GS.groups.flatMap(groupRow)] : !GS.loading && h('div.dm-empty', 'Nenhuma mensagem encontrada')];
  return { head, list: h('div.gs-list', filters, body) };
}
function gsMsg(m, inGuild) {
  const ch = channelById(m.channel_id), txt = stripInvites(m.content || '').replace(/<@&(\d+)>/g, (x, id) => '@' + (guild(ch?.guild_id)?.roles.find(r => r.id === id)?.name || 'cargo')).replace(/<@!?(\d+)>/g, (x, id) => '@' + (S.users.get(id)?.display_name || 'alguém')).replace(/[*_~`>|]/g, '') || (m.attachments?.length ? 'Anexo' : '');
  return h('button.gs-msg', { type: 'button', onclick: () => { rememberSearch(GS.q); gsNarrowClose(); go(ch?.guild_id || '@me', m.channel_id); setTimeout(() => jumpTo(m.id), 600); } },
    avatar(user(m.author_id), 24, { status: false }),
    h('span.gs-mt', h('span.gs-mh', h('b', nameOf(m.author_id, ch?.guild_id)), inGuild && ch && h('small', '#' + chName(ch)), h('small', shortWhen(m.created_at))), h('span.gs-mb', gsMark(txt.slice(0, 220)))));
}
