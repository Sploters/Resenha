// Mídia favorita (ideia "Favorite (any) Media", Stoat #1231): estrela em qualquer foto, vídeo, áudio ou arquivo do chat
// (ou clique direito na mensagem) e o seletor no campo de mensagem com abas GIFs, Imagens, Vídeos, Áudios, Emojis e
// Outros. Cada aba tem categorias com nome (ex.: "Reações", "Artes"): elas aparecem primeiro e o que não está em nenhuma
// vem depois. Clique manda (o mesmo arquivo, sem subir de novo); clique direito move de categoria ou tira dos favoritos.
// Os dados ficam no servidor (server/mediafavs.js) e acompanham os outros aparelhos (evento MEDIA_FAVS).
import { h, icon, imgUrl, thumbUrl, bytes } from './util.js';
import { S, api, toast, menu, closeFloating, emojiUrl, allEmojis } from './state.js';
import { gifFavList, toggleFav as toggleGifFav } from './gifs.js';
import { freezeGif } from './mediasafe.js';

const TABS = [['gif', 'GIFs', 'cxgif'], ['image', 'Imagens', 'image'], ['video', 'Vídeos', 'video'], ['audio', 'Áudios', 'music'], ['emoji', 'Emojis', 'smile'], ['other', 'Outros', 'file']];
let st = null; // { favs: [], cats: [] }
let loading = null;
const listeners = new Set();
const load = () => (st ? Promise.resolve(st) : (loading ||= api('GET', '/media-favs').then(r => (st = r), () => (st = { favs: [], cats: [] })).finally(() => { loading = null; })));
export function onMediaFavs(d) { st = d; for (const fn of listeners) fn(); paintStars(); }

export function kindOf(f) {
  const ext = (String(f.name || f.url || '').split('?')[0].split('.').pop() || '').toLowerCase(), t = f.type || '';
  if (t === 'image/gif' || ext === 'gif') return 'gif';
  if (/^image\//.test(t) || /^(png|jpe?g|webp|avif|bmp)$/.test(ext)) return 'image';
  if (/^video\//.test(t) || /^(mp4|webm|mov|m4v)$/.test(ext)) return 'video';
  if (/^audio\//.test(t) || /^(mp3|ogg|wav|m4a|opus|flac)$/.test(ext)) return 'audio';
  return 'other';
}
export const isMediaFav = (url) => !!st?.favs.some(x => x.url === url);
const canFav = (f) => f && !f.enc && !f.e2ee && !f.expired && typeof f.url === 'string' && (f.url.startsWith('/files/') || /^https:\/\//.test(f.url));

export async function toggleMediaFav(f, cat) {
  await load();
  try {
    if (isMediaFav(f.url) && cat === undefined) { await api('DELETE', '/media-favs', { url: f.url }); st.favs = st.favs.filter(x => x.url !== f.url); toast('Tirado da mídia favorita'); }
    else {
      const r = await api('PUT', '/media-favs', { url: f.url, name: f.name, type: f.type, size: f.size, w: f.width || f.w, h: f.height || f.h, ...(cat !== undefined ? { cat } : {}), ...(f.kind ? { kind: f.kind } : {}) });
      if (!isMediaFav(f.url)) { st.favs.unshift({ url: f.url, kind: r.kind, name: f.name, type: f.type, size: f.size, cat: cat || '' }); toast('Na mídia favorita: abra pelo botão de GIF/emoji do campo de mensagem'); }
      else { const x = st.favs.find(y => y.url === f.url); if (x) x.cat = cat || ''; }
    }
  } catch (e) { toast(e.message, true); }
  paintStars();
}
// estrela no canto da foto/arquivo do chat
const stars = new Set();
export function favStarFor(f) {
  if (!canFav(f)) return null;
  const b = h('button.gstar.mfstar', { type: 'button', title: 'Favoritar mídia', 'aria-label': 'Favoritar mídia', onclick: (e) => { e.stopPropagation(); toggleMediaFav(f); } }, icon('star', 16));
  b._url = f.url; stars.add(b); load().then(() => paintStar(b));
  return b;
}
function paintStar(b) { const on = isMediaFav(b._url); b.classList.toggle('on', on); b.title = on ? 'Tirar da mídia favorita' : 'Favoritar mídia'; }
function paintStars() { for (const b of stars) { if (!b.isConnected) { stars.delete(b); continue; } paintStar(b); } }
// itens do clique direito da mensagem: um por anexo
export function favMenuItems(m) {
  return (m.attachments || []).filter(canFav).slice(0, 5).map(f => ({ label: (isMediaFav(f.url) ? 'Tirar da mídia favorita: ' : 'Favoritar: ') + (f.name || 'arquivo').slice(0, 40), fn: () => toggleMediaFav(f) }));
}

// ---------- seletor ----------
// pick({ kind, url, name, type, size }) manda a mídia; emoji(code) insere o emoji no campo
export async function mediaFavPicker(anchor, { pick, emoji }) {
  closeFloating();
  await load();
  let tab = S.prefs.mediaFavTab && TABS.some(t => t[0] === S.prefs.mediaFavTab) ? S.prefs.mediaFavTab : 'gif', only = '', q = '';
  const input = h('input', { placeholder: 'Buscar nos favoritos', oninput: () => { q = input.value.trim().toLowerCase(); draw(); } });
  const tabsEl = h('div.gtabs.mf-tabs'), chips = h('div.mf-chips'), body = h('div.mf-body');
  const el = h('div.emoji-picker.gifpicker.mfpicker', input, tabsEl, chips, body);
  let gifs = [];
  const refresh = async () => { gifs = await gifFavList().catch(() => []); draw(); };
  const onChange = () => { if (el.isConnected) refresh(); else listeners.delete(onChange); };
  listeners.add(onChange);

  const catsOf = (k) => st.cats.filter(c => c.kind === k).map(c => c.name);
  // itens da aba: GIFs = favoritos do seletor de GIF + GIFs enviados como arquivo (a categoria fica na mídia favorita)
  const items = (k) => {
    if (k === 'gif') {
      const rows = new Map(st.favs.filter(x => x.kind === 'gif').map(x => [x.url, x]));
      const ext = gifs.map(g => ({ kind: 'gif', url: g.url, preview: g.preview || g.url, name: g.title || 'GIF', cat: rows.get(g.url)?.cat || '', ext: true }));
      const files = [...rows.values()].filter(x => !gifs.some(g => g.url === x.url)).map(x => ({ ...x, preview: x.url }));
      return [...ext, ...files];
    }
    return st.favs.filter(x => x.kind === k);
  };
  const drawTabs = () => tabsEl.replaceChildren(...TABS.map(([k, l, ic]) => h('button' + (tab === k ? '.on' : ''), { type: 'button', title: l, onclick: () => { tab = k; only = ''; S.prefs.mediaFavTab = k; draw(); } }, icon(ic, 16), h('span', l))));

  const tile = (it) => {
    const open = () => { pick(it); closeFloating(); };
    const ctx = (e) => {
      e.preventDefault(); e.stopPropagation();
      const cats = catsOf(tab);
      menu(e, [
        { label: 'Enviar', fn: open },
        ...(cats.length ? ['-', ...cats.map(c => ({ label: (it.cat === c ? '✓ ' : '') + 'Categoria: ' + c, fn: () => setCat(it, it.cat === c ? '' : c) }))] : []),
        { label: 'Nova categoria com esta mídia…', fn: async () => { const n = await newCat(); if (n) setCat(it, n); } },
        it.cat && { label: 'Tirar da categoria', fn: () => setCat(it, '') },
        '-', { label: 'Tirar dos favoritos', danger: true, fn: () => removeIt(it) },
      ], { keepFloat: true });
    };
    let face;
    if (it.kind === 'gif' || it.kind === 'image') { const im = h('img', { src: it.kind === 'image' ? imgUrl(it.url, 240) : it.preview || it.url, loading: 'lazy', alt: it.name || '', referrerPolicy: 'no-referrer', onerror: () => im.replaceWith(h('span.mf-broken', icon('image', 22))) }); face = im; if (it.kind === 'gif') queueMicrotask(() => freezeGif(im, it.preview || it.url, im.parentElement)); }
    else if (it.kind === 'video') face = h('span.mf-vid', thumbUrl(it.url) && h('img', { src: thumbUrl(it.url), loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }), h('i', icon('play', 18)));
    else face = h('span.mf-file', icon(it.kind === 'audio' ? 'music' : 'file', 26), h('small', it.name || 'arquivo'), it.size ? h('small.mut', bytes(it.size)) : null);
    return h('button.mf-item.mf-' + it.kind, { type: 'button', title: (it.name || '') + ' — clique para enviar, clique direito para organizar', onclick: open, oncontextmenu: ctx }, face);
  };
  const setCat = async (it, cat) => {
    try { await api('PUT', '/media-favs', { url: it.url, name: it.name, type: it.type, size: it.size, kind: tab, cat }); const x = st.favs.find(y => y.url === it.url); if (x) x.cat = cat; else st.favs.unshift({ url: it.url, kind: tab, name: it.name, cat }); draw(); }
    catch (e) { toast(e.message, true); }
  };
  const removeIt = async (it) => {
    if (it.ext) await toggleGifFav({ url: it.url });
    if (st.favs.some(x => x.url === it.url)) { await api('DELETE', '/media-favs', { url: it.url }).catch(e => toast(e.message, true)); st.favs = st.favs.filter(x => x.url !== it.url); }
    paintStars(); refresh();
  };
  // nome de categoria pedido dentro do próprio painel (um modal fecharia o painel)
  const askName = (label, value = '') => new Promise(res => {
    const inp = h('input', { value, maxLength: 40, placeholder: label, 'aria-label': label });
    const done = (v) => { row.remove(); res(v); };
    const row = h('form.mf-ask', { onsubmit: (e) => { e.preventDefault(); done(inp.value.trim().slice(0, 40) || null); } }, inp,
      h('button.btn.sm', { type: 'submit' }, 'OK'), h('button.btn.link.sm', { type: 'button', onclick: () => done(null) }, 'Cancelar'));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    el.querySelector('.mf-ask')?.remove(); chips.after(row); inp.focus(); inp.select();
  });
  const newCat = async () => {
    const n = await askName(`Nome da nova categoria (${TABS.find(t => t[0] === tab)[1]})`); if (!n) return null;
    try { await api('POST', '/media-favs/cats', { kind: tab, name: n }); st.cats.push({ kind: tab, name: n }); draw(); return n; } catch (e) { toast(e.message, true); return null; }
  };
  const catMenu = (e, c) => menu(e, [
    { label: 'Renomear categoria', fn: async () => { const n = await askName('Novo nome da categoria', c); if (!n || n === c) return;
      try { await api('POST', '/media-favs/cats', { kind: tab, name: c, to: n }); st.cats.forEach(x => { if (x.kind === tab && x.name === c) x.name = n; }); st.favs.forEach(x => { if (x.kind === tab && x.cat === c) x.cat = n; }); if (only === c) only = n; draw(); } catch (er) { toast(er.message, true); } } },
    { label: 'Apagar categoria (a mídia continua nos favoritos)', danger: true, fn: async () => {
      await api('DELETE', '/media-favs/cats', { kind: tab, name: c }).catch(er => toast(er.message, true)); st.cats = st.cats.filter(x => !(x.kind === tab && x.name === c)); st.favs.forEach(x => { if (x.kind === tab && x.cat === c) x.cat = ''; }); if (only === c) only = ''; draw(); } },
  ], { keepFloat: true });

  function drawEmojis() {
    chips.replaceChildren();
    const favs = (Array.isArray(S.prefs.emojiFavs) ? S.prefs.emojiFavs : []).filter(c => !q || c.toLowerCase().includes(q));
    const cell = (code) => { const m = /^<:(\w+):(\d+)>$/.exec(code); const ce = m && allEmojis().find(e => e.id === m[2]); if (m && !ce) return null;
      return h('button.mf-emoji', { type: 'button', title: ce ? ':' + ce.name + ':' : code, onclick: () => { emoji(code); closeFloating(); } }, ce ? h('img', { src: emojiUrl(ce.id) || ce.url, alt: ce.name }) : code); };
    body.replaceChildren(favs.length ? h('div.mf-emojis', favs.map(cell).filter(Boolean)) : h('div.mf-empty', 'Nenhum emoji favorito. No seletor de emoji, clique direito num emoji para favoritar.'));
  }
  function draw() {
    drawTabs();
    if (tab === 'emoji') return drawEmojis();
    const cats = catsOf(tab), all = items(tab).filter(it => !q || (it.name || '').toLowerCase().includes(q) || (it.cat || '').toLowerCase().includes(q));
    chips.replaceChildren(h('button.mf-chip' + (!only ? '.on' : ''), { type: 'button', onclick: () => { only = ''; draw(); } }, 'Tudo'),
      ...cats.map(c => h('button.mf-chip' + (only === c ? '.on' : ''), { type: 'button', title: 'Clique direito: renomear ou apagar', onclick: () => { only = only === c ? '' : c; draw(); }, oncontextmenu: (e) => { e.preventDefault(); catMenu(e, c); } }, c)),
      h('button.mf-chip.add', { type: 'button', title: 'Nova categoria', onclick: () => newCat() }, icon('plus', 14), 'Categoria'));
    if (!all.length) return body.replaceChildren(h('div.mf-empty', q ? 'Nada encontrado.' : tab === 'gif' ? 'Nenhum GIF favorito. Clique na estrela de um GIF no chat ou no seletor de GIF.' : 'Nada aqui ainda. Passe o mouse numa foto, vídeo ou arquivo do chat e clique na estrela (ou clique direito na mensagem → Favoritar).'));
    const sec = (title, list, c) => list.length ? h('div.mf-sec', h('div.mf-sech', h('b', title), h('small', list.length), c && h('button.ibtn.mf-catmenu', { type: 'button', title: 'Opções da categoria', onclick: (e) => catMenu(e, c) }, icon('more', 14))), h('div.mf-grid', list.map(tile))) : null;
    if (only) return body.replaceChildren(sec(only, all.filter(it => it.cat === only), only) || h('div.mf-empty', 'Categoria vazia. Clique direito numa mídia → Categoria.'));
    // categorias primeiro (na ordem), depois o que não está em nenhuma
    body.replaceChildren(...cats.map(c => sec(c, all.filter(it => it.cat === c), c)).filter(Boolean), sec(cats.length ? 'Sem categoria' : 'Favoritos', all.filter(it => !it.cat || !cats.includes(it.cat))));
  }

  document.getElementById('layer').append(el);
  const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.right - w.width, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, r.top - w.height - 8) + 'px';
  input.focus();
  draw(); refresh();
}
