// Canais favoritos: lista própria com grupos, de qualquer servidor.
import { h, icon, imgUrl } from './util.js';
import { S, guild, channelById, chVisible, toast, promptBox, menu, savePrefs, isChatCh } from './state.js';
import { previewHooks } from './chpreview.js';
import { chName } from './chnames.js';
import { go } from './nav.js';
import { renderRail, callTimer } from './rail.js';
import { chIcon, renderSide, vusersBlock, voiceDropHooks } from './side.js';
import { channelMenu } from './chmenu.js';
import { initialsOf } from './usermenu.js';
// ---------- canais favoritos ----------
// Canais de qualquer servidor reunidos num lugar só (estrela na barra dos servidores), na ordem que você quiser e em
// grupos seus (ex.: "Campanha" com canais de servidores diferentes). Arrastar reordena e muda de grupo. Fica na conta
// (S.prefs.favs: [{ c: id do canal, g: grupo }], S.prefs.favGroups: ordem dos grupos) e sincroniza com os outros aparelhos.
// Post de fórum também pode ser favorito: { c: id do post, g, p: 1, gid, f: id do fórum, n: título }. Os posts não vêm no
// READY, então o favorito guarda o servidor, o fórum e o título; abrir carrega o post (go → loadPost).
export const favList = () => (S.prefs.favs || []).filter(f => { if (f.p) return guild(f.gid) && channelById(f.f); const c = channelById(f.c); return c && c.guild_id && guild(c.guild_id) && chVisible(c); });
const favGid = (f) => (f.p ? f.gid : channelById(f.c)?.guild_id);
export function toggleFavPost(p) {
  const list = S.prefs.favs ||= [];
  if (isFav(p.id)) { S.prefs.favs = list.filter(f => f.c !== p.id); if (S.favMode && !favList().length) S.favMode = false; toast('Post removido dos favoritos'); }
  else { list.push({ c: p.id, g: '', p: 1, gid: p.guild_id, f: p.forum_id, n: String(p.title || '').slice(0, 120) }); toast(`"${p.title}" está nos favoritos (estrela na barra dos servidores)`); }
  savePrefs(); renderRail(); renderSide();
}
// post apagado ou título mudado: o favorito acompanha
export function favPostChanged(id, title) {
  const f = (S.prefs.favs || []).find(x => x.c === id && x.p); if (!f) return;
  if (title == null) S.prefs.favs = S.prefs.favs.filter(x => x !== f); else if (f.n !== title) f.n = String(title).slice(0, 120); else return;
  savePrefs(); if (S.favMode) renderSide(); renderRail();
}
export const isFav = (cid) => (S.prefs.favs || []).some(f => f.c === cid);
export function toggleFav(c) {
  const list = S.prefs.favs ||= [];
  if (isFav(c.id)) { S.prefs.favs = list.filter(f => f.c !== c.id); if (S.favMode && !favList().length) S.favMode = false; }
  else { list.push({ c: c.id, g: '' }); toast(`#${chName(c)} está nos favoritos (estrela na barra dos servidores)`); }
  savePrefs(); renderRail(); renderSide();
}
export function openFavs() {
  const fl = favList(); if (!fl.length) return;
  const f = fl.find(x => x.c === S.prefs.favLast) || fl[0];
  S.favMode = true; go(favGid(f), f.c); renderRail(); renderSide();
}
const favGroups = () => { const used = new Set(favList().map(f => f.g).filter(Boolean)); return [...new Set([...(S.prefs.favGroups || []).filter(g => used.has(g)), ...used])]; };
export function moveFav(cid, group, beforeCid) {
  const old = (S.prefs.favs || []).find(f => f.c === cid), list = (S.prefs.favs || []).filter(f => f.c !== cid), item = { ...old, c: cid, g: group || '' }; // ...old: post de fórum guarda servidor, fórum e título
  const i = beforeCid ? list.findIndex(f => f.c === beforeCid) : -1;
  if (i >= 0) list.splice(i, 0, item); else { let j = -1; list.forEach((f, k) => { if ((f.g || '') === item.g) j = k; }); list.splice(j >= 0 ? j + 1 : list.length, 0, item); }
  S.prefs.favs = list; if (group && !(S.prefs.favGroups || []).includes(group)) (S.prefs.favGroups ||= []).push(group);
  savePrefs(); renderSide();
}
async function newFavGroup(cid) {
  const name = (await promptBox('Novo grupo de favoritos', 'Nome do grupo', '', 'Criar'))?.slice(0, 40); if (!name) return;
  moveFav(cid, name);
}
export function favGroupMenuItem(cid) {
  const cur = (S.prefs.favs || []).find(f => f.c === cid)?.g || '';
  return { label: 'Mover para o grupo', sub: [
    { label: 'Sem grupo', radio: cur === '', fn: () => moveFav(cid, '') },
    ...favGroups().map(g => ({ label: g, radio: cur === g, fn: () => moveFav(cid, g) })),
    '-', { label: 'Novo grupo…', fn: () => newFavGroup(cid) }] };
}
function favGroupMenu(e, g) {
  menu(e, [
    { label: 'Renomear grupo', fn: async () => { const n = (await promptBox('Renomear grupo', 'Nome do grupo', g))?.slice(0, 40); if (!n || n === g) return; for (const f of S.prefs.favs || []) if (f.g === g) f.g = n; S.prefs.favGroups = (S.prefs.favGroups || []).map(x => (x === g ? n : x)); savePrefs(); renderSide(); } },
    { label: 'Subir grupo', fn: () => { const gs = favGroups(), i = gs.indexOf(g); if (i > 0) { [gs[i - 1], gs[i]] = [gs[i], gs[i - 1]]; S.prefs.favGroups = gs; savePrefs(); renderSide(); } } },
    { label: 'Descer grupo', fn: () => { const gs = favGroups(), i = gs.indexOf(g); if (i >= 0 && i < gs.length - 1) { [gs[i + 1], gs[i]] = [gs[i], gs[i + 1]]; S.prefs.favGroups = gs; savePrefs(); renderSide(); } } },
    '-', { label: 'Desfazer grupo (os canais continuam nos favoritos)', fn: () => { for (const f of S.prefs.favs || []) if (f.g === g) f.g = ''; S.prefs.favGroups = (S.prefs.favGroups || []).filter(x => x !== g); savePrefs(); renderSide(); } },
  ]);
}
export function favSide() {
  const head = h('div#side-head.fav-head', icon('star', 20), h('span', 'Favoritos'),
    h('button.sh-btn', { type: 'button', title: 'Como organizar', 'aria-label': 'Como organizar os favoritos', onclick: () => toast('Arraste para mudar a ordem ou o grupo. Clique direito num canal: grupos e remover. Para adicionar: clique direito num canal de qualquer servidor → Adicionar aos favoritos.') }, icon('info', 18)));
  let dragId = null;
  const drop = (el, group, before) => {
    el.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); el.classList.add('fav-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('fav-over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('fav-over'); if (dragId && dragId !== before) moveFav(dragId, group, before); dragId = null; });
    return el;
  };
  const postRow = (f) => {
    const g = guild(f.gid), forum = channelById(f.f), title = S.posts.get(f.c)?.name || f.n || 'Post';
    const el = h('div.ch.favrow' + (S.view.cid === f.c ? '.active' : ''), {
      draggable: true, title: `${title} — ${forum.name} (${g.name})`,
      onclick: () => { S.favMode = true; go(g.id, f.c); },
      oncontextmenu: (e) => menu(e, [{ label: 'Abrir post', fn: () => { S.favMode = true; go(g.id, f.c); } }, { label: 'Remover dos favoritos', fn: () => toggleFavPost({ id: f.c }) }, favGroupMenuItem(f.c)]),
      ondragstart: (e) => { dragId = f.c; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.c); el.classList.add('dragging'); },
      ondragend: () => { dragId = null; el.classList.remove('dragging'); } },
      h('span.fav-g', g.icon ? h('img', { src: imgUrl(g.icon, 32), alt: '' }) : initialsOf(g.name)), icon('forum', 20),
      h('span.name', h('span.fn', title), h('small', `${chName(forum)} · ${g.name}`)));
    return h('div', drop(el, f.g || '', f.c));
  };
  const row = (f) => {
    if (f.p) return postRow(f);
    const c = channelById(f.c), g = guild(c.guild_id), vs = c.type === 2 ? [...S.voice.values()].filter(v => v.channel_id === c.id) : [];
    const el = h('div.ch.favrow' + (S.view.cid === c.id ? '.active' : '') + (S.unread[c.id] && isChatCh(c) ? '.unread' : ''), {
      draggable: true, title: `#${chName(c)} — ${g.name}`,
      onclick: () => { S.favMode = true; go(g.id, c.id); }, oncontextmenu: (e) => channelMenu(e, g, c), ...previewHooks(c),
      ondragstart: (e) => { dragId = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); el.classList.add('dragging'); },
      ondragend: () => { dragId = null; el.classList.remove('dragging'); } },
      h('span.fav-g', g.icon ? h('img', { src: imgUrl(g.icon, 32), alt: '' }) : initialsOf(g.name)), chIcon(c),
      h('span.name', h('span.fn', chName(c)), h('small', g.name)), vs.length > 0 && callTimer(vs), S.mentions[c.id] > 0 && h('span.pill', S.mentions[c.id]));
    return h('div', voiceDropHooks(g, c), drop(el, f.g || '', c.id), vs.length > 0 && vusersBlock(g, vs));
  };
  const fl = favList(), loose = fl.filter(f => !f.g);
  const list = h('div#side-list.favlist',
    drop(h('div.fav-drop', loose.length ? null : 'Solte aqui para tirar do grupo'), '', null), loose.map(row),
    favGroups().map(gn => [drop(h('div.cat.fav-cat', { oncontextmenu: (e) => favGroupMenu(e, gn), title: 'Clique direito: renomear, mudar a ordem ou desfazer' }, h('span', gn)), gn, null), fl.filter(f => f.g === gn).map(row)]));
  return { head, list };
}
