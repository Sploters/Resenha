// Pastas de servidores (barra da esquerda). Pastas com nome e cor, uma dentro da outra, sem limite de servidores.
// Na barra a pasta é um quadrado com as miniaturas dos primeiros servidores; clicar abre um painel quadrado à direita com a
// grade de servidores e subpastas, busca (para quem está em centenas de servidores) e o caminho (Jogos › FPS) para voltar.
// Organizar arrastando: soltar um servidor no meio de outro cria uma pasta; no meio de uma pasta, entra nela. Arrastar um
// item do painel e soltar fora dele tira da pasta (na barra, entra onde soltar). Também pelo clique direito → "Mover para pasta".
// Fica na conta (S.prefs.gfolders): [{ id, name, color, parent: id|null, items: ['g:<guild>' | 'f:<pasta>'] }].
// Na ordem da barra (S.prefs.guildOrder) a pasta entra como 'f:<id>', junto com os ids dos servidores soltos.
import { h, icon, imgUrl } from './util.js';
import { S, savePrefs, menu, promptBox, confirmBox, toast } from './state.js';

export const COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#99aab5'];
const COLOR_NAMES = ['Azul', 'Verde', 'Amarelo', 'Vermelho', 'Rosa', 'Roxo', 'Turquesa', 'Cinza'];
let onChange = () => { }, goGuild = () => { };
export const initFolders = ({ change, go }) => { onChange = change; goGuild = go; };
const list = () => (Array.isArray(S.prefs.gfolders) ? S.prefs.gfolders : (S.prefs.gfolders = []));
export const folder = (id) => list().find(f => f.id === id) || null;
const save = () => { savePrefs(); onChange(); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// pasta onde está cada servidor / pasta (null = solto na barra). Servidores que saíram somem sozinhos da lista.
export function parentOf(key) { for (const f of list()) if (f.items.includes(key)) return f; return null; }
export const inAnyFolder = (gid) => !!parentOf('g:' + gid);
const alive = (key) => key.startsWith('g:') ? S.guilds.has(key.slice(2)) : !!folder(key.slice(2));
export const itemsOf = (f) => f.items.filter(alive);
// todos os servidores dentro da pasta, incluindo as subpastas (para miniaturas, não lidas e menções)
export function guildsIn(f, seen = new Set()) {
  if (seen.has(f.id)) return []; seen.add(f.id);
  return itemsOf(f).flatMap(k => k.startsWith('g:') ? [S.guilds.get(k.slice(2))] : guildsIn(folder(k.slice(2)), seen));
}
const path = (f) => { const out = []; for (let x = f, n = 0; x && n < 20; x = folder(x.parent), n++) out.unshift(x); return out; };
export const pathName = (f) => path(f).map(x => x.name).join(' › ');
const isInside = (f, anc) => path(f).some(x => x.id === anc.id); // f é anc ou está dentro dela

function detach(key) { for (const f of list()) f.items = f.items.filter(k => k !== key); S.prefs.guildOrder = (S.prefs.guildOrder || []).filter(k => k !== key && 'g:' + k !== key); }
// coloca um servidor ('g:id') ou pasta ('f:id') dentro de uma pasta (null = de volta solto na barra, no fim)
export function moveTo(key, dest) {
  if (key.startsWith('f:') && dest && isInside(dest, folder(key.slice(2)))) return toast('Não dá para pôr uma pasta dentro dela mesma.', true);
  detach(key);
  if (key.startsWith('f:')) folder(key.slice(2)).parent = dest ? dest.id : null;
  if (dest) dest.items.push(key);
  else S.prefs.guildOrder = [...(S.prefs.guildOrder || []), key.startsWith('g:') ? key.slice(2) : key];
  save();
}
// ---------- arrastar ----------
const orderKey = (key) => key.startsWith('g:') ? key.slice(2) : key; // como o item aparece na ordem da barra
const railOrder = () => [...document.querySelectorAll('#rail .rail-wrap.railg')].map(w => w.dataset.id);
const newFolder = (name, parent) => { const f = { id: newId(), name, color: COLORS[list().length % COLORS.length], parent: parent ? parent.id : null, items: [] }; list().push(f); return f; };
// pasta que ficou vazia depois de arrastar o último item para fora some sozinha (e a de cima, se esvaziar junto)
function prune(f) {
  for (let x = f; x && folder(x.id) && !itemsOf(x).length;) { const up = folder(x.parent); detach('f:' + x.id); S.prefs.gfolders = list().filter(y => y !== x); x = up; }
}
export function canJoin(src, dst) {
  if (src === dst) return false;
  if (!dst.startsWith('f:')) return src.startsWith('g:'); // dois servidores viram uma pasta
  const to = folder(dst.slice(2));
  return !!to && parentOf(src) !== to && !(src.startsWith('f:') && isInside(to, folder(src.slice(2))));
}
// soltar um item em cima de outro: numa pasta, entra nela; num servidor, os dois viram uma pasta no lugar dele
export function join(src, dst) {
  if (!canJoin(src, dst)) return;
  const from = parentOf(src);
  if (dst.startsWith('f:')) {
    const to = folder(dst.slice(2));
    detach(src); if (src.startsWith('f:')) folder(src.slice(2)).parent = to.id;
    to.items.push(src); toast(`Movido para ${to.name}`);
  } else {
    const up = parentOf(dst), order = railOrder().filter(k => k !== orderKey(src)), f = newFolder('Pasta', up);
    if (up) up.items[up.items.indexOf(dst)] = 'f:' + f.id;
    detach(src); detach(dst); f.items.push(dst, src);
    if (!up) S.prefs.guildOrder = order.map(k => k === orderKey(dst) ? 'f:' + f.id : k);
    toast('Pasta criada. Clique direito nela para renomear.');
  }
  prune(from); save();
}
// tira o item de onde estiver e põe solto na barra, antes ou depois de outro item dela
function dropOnRail(key, ref, after) {
  const from = parentOf(key), me = orderKey(key), order = railOrder().filter(k => k !== me), i = order.indexOf(ref);
  detach(key);
  if (key.startsWith('f:')) folder(key.slice(2)).parent = null;
  order.splice(i < 0 ? order.length : i + (after ? 1 : 0), 0, me);
  S.prefs.guildOrder = order;
  prune(from); save();
}
// muda a posição dentro da pasta
function reorderIn(f, key, ref, after) {
  const items = f.items.filter(k => k !== key), i = items.indexOf(ref);
  items.splice(i + (after ? 1 : 0), 0, key); f.items = items; save();
}
// o que acontece se soltar aqui: { el, cls (marca no alvo), run }; null = nada
function dropAt(x, y, key, p) {
  const hit = document.elementFromPoint(x, y); if (!hit) return null;
  if (p.el.contains(hit)) {
    const crumb = hit.closest('.fold-crumb');
    if (crumb) { const to = 'f:' + crumb.dataset.folder; return canJoin(key, to) ? { el: crumb, cls: 'drop-into', run: () => join(key, to) } : null; }
    const t = hit.closest('.fold-tile[data-key]'), dst = t?.dataset.key; if (!dst || dst === key) return null;
    const r = t.getBoundingClientRect(), at = (x - r.left) / r.width, can = canJoin(key, dst);
    if (can && at >= .25 && at <= .75) return { el: t, cls: 'drop-into', run: () => join(key, dst) };
    // na busca a grade mostra itens de subpastas; reordenar só entre itens do mesmo tipo da pasta aberta
    if (!p.cur.items.includes(key) || !p.cur.items.includes(dst) || key.slice(0, 2) !== dst.slice(0, 2)) return null;
    return { el: t, cls: at > .5 ? 'drop-after' : 'drop-before', run: () => reorderIn(p.cur, key, dst, at > .5) };
  }
  const w = hit.closest('#rail .rail-wrap.railg');
  if (w) {
    const id = w.dataset.id, dst = id.startsWith('f:') ? id : 'g:' + id;
    if (dst === key) return null;
    const r = w.getBoundingClientRect(), at = (y - r.top) / r.height, can = canJoin(key, dst);
    if (can && at >= .25 && at <= .75) return { el: w, cls: 'drop-into', run: () => join(key, dst) };
    return { el: w, cls: at > .5 ? 'drop-after' : 'drop-before', run: () => dropOnRail(key, id, at > .5) };
  }
  // soltou fora do painel, em qualquer outro lugar: sai da pasta e fica na barra, logo abaixo dela
  return { el: null, run: () => { dropOnRail(key, 'f:' + p.root, true); toast('Tirado da pasta'); } };
}
// arrastar um item do painel: uma cópia segue o mouse e o alvo fica marcado. No toque, segurar antes (senão é rolar a grade)
function dragTile(e, key, p) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const tile = e.currentTarget, touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
  let ghost = null, ready = !touch, timer = 0, drop = null, last = e;
  const mark = (d) => { drop?.el?.classList.remove(drop.cls); drop = d; d?.el?.classList.add(d.cls); };
  const follow = () => { ghost.style.left = last.clientX + 'px'; ghost.style.top = last.clientY + 'px'; };
  const start = () => {
    ghost = h('div.fold-ghost', tile.querySelector('.fold-ic, .fold-glyph').cloneNode(true));
    ghost.querySelector('.badge')?.remove();
    document.body.append(ghost); document.body.classList.add('reorder-on'); tile.classList.add('fold-dragging'); p.dragging = true; follow();
    if (navigator.vibrate && touch) try { navigator.vibrate(15); } catch { /* sem vibração */ }
  };
  const move = (ev) => {
    if (ev.pointerId !== id) return; last = ev;
    if (!ghost) {
      const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > (touch ? 8 : 5);
      if (!ready) { if (far) end(); return; }
      if (!far) return; start();
    }
    ev.preventDefault(); follow(); mark(dropAt(ev.clientX, ev.clientY, key, p));
  };
  const noScroll = (ev) => { if (ghost) ev.preventDefault(); };
  const esc = (ev) => { if (ev.key === 'Escape' && ghost) { ev.stopPropagation(); ev.preventDefault(); end(); } };
  const end = (ev) => {
    if (ev && ev.pointerId !== id) return;
    clearTimeout(timer);
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    removeEventListener('touchmove', noScroll); removeEventListener('keydown', esc, true);
    if (!ghost) return;
    const d = ev?.type === 'pointerup' ? dropAt(ev.clientX, ev.clientY, key, p) : null;
    mark(null); ghost.remove(); ghost = null; document.body.classList.remove('reorder-on'); tile.classList.remove('fold-dragging'); p.dragging = false;
    // o clique que vem junto com o soltar não abre o item
    const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
    addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, { capture: true }), 0);
    d?.run();
  };
  if (touch) timer = setTimeout(() => { ready = true; start(); }, 350);
  addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  addEventListener('touchmove', noScroll, { passive: false }); addEventListener('keydown', esc, true);
}

export async function createFolder(parent = null, first = null) {
  const name = (await promptBox(parent ? `Nova pasta em ${parent.name}` : 'Nova pasta', 'Nome da pasta', ''))?.trim();
  if (!name) return null;
  const f = { id: newId(), name: name.slice(0, 40), color: COLORS[list().length % COLORS.length], parent: parent ? parent.id : null, items: [] };
  list().push(f);
  if (parent) parent.items.push('f:' + f.id);
  else {
    // a pasta nova entra na barra onde estava o servidor que a criou (ou no fim)
    const order = S.prefs.guildOrder || [], at = first?.startsWith('g:') ? order.indexOf(first.slice(2)) : -1;
    S.prefs.guildOrder = at >= 0 ? [...order.slice(0, at), 'f:' + f.id, ...order.slice(at)] : [...order, 'f:' + f.id];
  }
  if (first) moveTo(first, f); else save();
  return f;
}
async function renameFolder(f) { const n = (await promptBox('Renomear pasta', 'Nome da pasta', f.name))?.trim(); if (n) { f.name = n.slice(0, 40); save(); } }
// desfazer: o que estava dentro vai para onde a pasta estava
async function removeFolder(f) {
  if (!await confirmBox(`Desfazer a pasta ${f.name}`, 'Os servidores e subpastas dela voltam para ' + (f.parent ? `"${folder(f.parent)?.name}"` : 'a barra') + '. Nenhum servidor é apagado.', 'Desfazer pasta')) return;
  const up = folder(f.parent), items = [...f.items];
  detach('f:' + f.id); S.prefs.gfolders = list().filter(x => x.id !== f.id);
  for (const k of items) { if (k.startsWith('f:') && folder(k.slice(2))) folder(k.slice(2)).parent = up ? up.id : null; if (up) up.items.push(k); else S.prefs.guildOrder = [...(S.prefs.guildOrder || []), k.startsWith('g:') ? k.slice(2) : k]; }
  save();
}
export function folderMenu(e, f) {
  return menu(e, [
    { icon: 'edit', label: 'Renomear', fn: () => renameFolder(f) },
    { icon: 'palette', label: 'Cor', sub: COLORS.map((c, i) => ({ label: COLOR_NAMES[i], checked: f.color === c, fn: () => { f.color = c; save(); } })) },
    { icon: 'plus', label: 'Nova subpasta', fn: () => createFolder(f) },
    f.parent && { icon: 'logout', label: 'Tirar desta pasta', fn: () => moveTo('f:' + f.id, folder(folder(f.parent)?.parent) || null) },
    '-',
    { icon: 'trash', label: 'Desfazer pasta', danger: true, fn: () => removeFolder(f) },
  ].filter(Boolean));
}
// submenu "Mover para pasta" (clique direito no servidor ou numa pasta)
export function moveMenuItems(key) {
  const cur = parentOf(key), self = key.startsWith('f:') ? folder(key.slice(2)) : null;
  const dests = list().filter(f => f !== cur && !(self && isInside(f, self))).sort((a, b) => pathName(a).localeCompare(pathName(b)));
  return [
    ...dests.map(f => ({ label: pathName(f), icon: 'folder', fn: () => { moveTo(key, f); toast(`Movido para ${f.name}`); } })),
    dests.length && '-',
    { label: 'Nova pasta…', icon: 'plus', fn: () => createFolder(cur, key) },
    cur && { label: 'Tirar da pasta', icon: 'logout', fn: () => moveTo(key, folder(cur.parent) || null) },
  ].filter(Boolean);
}

// ---------- na barra ----------
const unread = (g) => g.channels.some(c => S.unread[c.id]);
const mentions = (g) => g.channels.reduce((n, c) => n + (S.mentions[c.id] || 0), 0);
const gIcon = (g, px) => g.icon ? h('img', { src: imgUrl(g.icon, px), alt: '', draggable: 'false' }) : h('span.fold-ini', g.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3));
// o quadrado da pasta: até 4 miniaturas (2x2) sobre a cor da pasta
export function folderGlyph(f, size = 48) {
  const gs = guildsIn(f).slice(0, 4);
  return h('div.fold-glyph', { style: { '--gf': f.color, width: size + 'px', height: size + 'px' } },
    gs.length ? gs.map(g => h('div.fold-mini', gIcon(g, 32))) : icon('folder', size / 2));
}
export function folderRailItem(f, { wrap, badge, activeGid }) {
  const gs = guildsIn(f), here = gs.some(g => g.id === activeGid);
  const w = wrap('.railg.railfolder' + (here ? '.active' : '') + (gs.some(g => unread(g) && g.id !== activeGid) ? '.unread' : ''), f.name,
    h('div.rail-item.fold-item', { onclick: (e) => openFolder(e.currentTarget, f), oncontextmenu: (e) => folderMenu(e, f) }, folderGlyph(f)),
    badge(gs.reduce((n, g) => n + mentions(g), 0)), 'f:' + f.id);
  return w;
}

// ---------- painel da pasta (à direita da barra) ----------
let panel = null;
export const closeFolder = () => { panel?.el.remove(); document.removeEventListener('mousedown', panel?.out, true); document.removeEventListener('keydown', panel?.esc, true); panel = null; };
export function openFolder(anchor, f) {
  if (panel?.root === f.id) return closeFolder();
  closeFolder();
  const q = h('input.fold-q', { placeholder: 'Buscar nesta pasta', oninput: () => draw() });
  // cabeçalho e grade redesenham; a busca fica (redesenhar tudo tirava o foco dela a cada letra)
  const head = h('div.fold-head'), grid = h('div.fold-grid');
  const el = h('div.fold-panel', { role: 'dialog', 'aria-label': 'Pasta ' + f.name }, head, h('label.fold-search', icon('search', 14), q), grid);
  const p = panel = { el, root: f.id, cur: f, anchor };
  const go2 = (gid) => { closeFolder(); goGuild(gid); };
  const drag = (key) => ({ 'data-key': key, onpointerdown: (e) => dragTile(e, key, p), ondragstart: (e) => e.preventDefault() });
  const tile = (key) => {
    if (key.startsWith('f:')) {
      const sub = folder(key.slice(2)), n = guildsIn(sub).length;
      return h('button.fold-tile.sub', { ...drag(key), type: 'button', title: sub.name, onclick: () => { p.cur = sub; q.value = ''; draw(); }, oncontextmenu: (e) => folderMenu(e, sub) },
        folderGlyph(sub, 56), h('span.fold-n', sub.name), h('small', `${n} ${n === 1 ? 'servidor' : 'servidores'}`));
    }
    const g = S.guilds.get(key.slice(2)), m = mentions(g);
    return h('button.fold-tile' + (g.id === S.view.gid ? '.on' : '') + (unread(g) ? '.unread' : ''), { ...drag(key), type: 'button', title: g.name, onclick: () => go2(g.id),
      oncontextmenu: (e) => menu(e, [{ icon: 'folder', label: 'Mover para pasta', sub: moveMenuItems(key) }, { icon: 'logout', label: 'Tirar da pasta', fn: () => moveTo(key, folder(p.cur.parent) || null) }]) },
      h('div.fold-ic', gIcon(g, 64), m > 0 && h('span.badge', m > 99 ? '99+' : m)), h('span.fold-n', g.name));
  };
  const draw = () => {
    const cur = p.cur = folder(p.cur.id) || folder(p.root); if (!cur) return closeFolder();
    const term = q.value.trim().toLowerCase();
    // buscando: procura em toda a pasta (subpastas incluídas); sem busca: subpastas primeiro, depois os servidores
    const keys = term ? guildsIn(cur).filter(g => g.name.toLowerCase().includes(term)).map(g => 'g:' + g.id)
      : [...itemsOf(cur).filter(k => k.startsWith('f:')), ...itemsOf(cur).filter(k => k.startsWith('g:'))];
    const crumbs = path(cur).filter(x => isInside(x, folder(p.root)) || x.id === p.root);
    const startAt = crumbs.findIndex(x => x.id === p.root);
    head.replaceChildren(h('span.fold-dot', { style: { background: cur.color } }),
        h('div.fold-crumbs', ...crumbs.slice(Math.max(0, startAt)).flatMap((x, i) => [i ? h('span.fold-sep', icon('chevr', 14)) : null, x.id === cur.id ? h('b', x.name) : h('button.fold-crumb', { type: 'button', 'data-folder': x.id, onclick: () => { p.cur = x; q.value = ''; draw(); } }, x.name)])),
        h('button.ibtn', { type: 'button', title: 'Opções da pasta', onclick: (e) => folderMenu(e, cur) }, icon('more', 18)),
        h('button.ibtn', { type: 'button', title: 'Fechar', onclick: closeFolder }, icon('x', 18)));
    grid.replaceChildren(...(keys.length ? keys.map(tile) : [h('div.fold-empty', term ? 'Nenhum servidor com esse nome.' : 'Pasta vazia. Arraste um servidor para cima dela na barra.')]),
        !term && h('button.fold-tile.add', { type: 'button', title: 'Nova subpasta', onclick: () => createFolder(cur) }, h('div.fold-ic', icon('plus', 24)), h('span.fold-n', 'Nova subpasta')));
    place();
  };
  // ao lado da barra, alinhado com a pasta (sem sair da tela)
  const place = () => {
    // a barra é redesenhada quando a pasta muda: o item antigo sai da tela e mediria zero (o painel pulava para o topo)
    if (!anchor.isConnected) anchor = document.querySelector(`#rail [data-id="f:${p.root}"] .rail-item`) || anchor;
    const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
    el.style.left = Math.round(Math.max(r.right, document.getElementById('rail')?.getBoundingClientRect().right || 0) + 8) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(r.top - 8, innerHeight - w.height - 8))) + 'px';
  };
  p.out = (e) => { if (!el.contains(e.target) && !e.target.closest('.menu, .backdrop, .fold-item')) closeFolder(); };
  p.esc = (e) => { if (e.key === 'Escape' && !p.dragging && !document.querySelector('.menu, .backdrop')) { e.stopPropagation(); closeFolder(); } };
  document.body.append(el); draw();
  document.addEventListener('mousedown', p.out, true); document.addEventListener('keydown', p.esc, true);
  if (itemsOf(f).length > 12) setTimeout(() => q.focus(), 0);
  p.redraw = draw;
}
export const refreshFolder = () => panel?.redraw?.();
