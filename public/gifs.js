// GIFs: seletor no campo de mensagem (busca, Em alta, Favoritos, Do grupo) e o GIF dentro da mensagem.
// O GIF vai como o próprio link na mensagem; o servidor só busca a lista (KLIPY ou GIPHY) e guarda os favoritos.
import { h, icon } from './util.js';
import { S, api, toast, closeFloating, savePrefs } from './state.js';
import { gifFrozen, still } from './mediasafe.js';

let meta = null, favs = null; // favs: Map url -> gif
const loadMeta = async () => (meta ||= await api('GET', '/gifs/meta').catch(() => ({ provider: null })));
const loadFavs = async () => { if (!favs) { const r = await api('GET', '/gifs/favs').catch(() => ({ gifs: [] })); favs = new Map(r.gifs.map(g => [g.url, g])); } return favs; };
export const isFav = (url) => !!favs?.has(url);
export const gifFavList = async () => [...(await loadFavs()).values()]; // aba GIFs da mídia favorita (mediafavs.js)
export async function toggleFav(g) {
  await loadFavs();
  if (favs.has(g.url)) { favs.delete(g.url); await api('DELETE', '/gifs/favs', { url: g.url }).catch(e => toast(e.message, true)); toast('Tirado dos favoritos'); return false; }
  try { await api('PUT', '/gifs/favs', { url: g.url, preview: g.preview || g.url, w: g.w || 0, h: g.h || 0, title: g.title || '' }); favs = new Map([[g.url, g], ...favs]); toast('GIF favoritado'); return true; }
  catch (e) { toast(e.message, true); return null; }
}

// mensagem que é só um link de GIF/WebP animado: mostra só a imagem (sem o texto do link)
export const GIF_ONLY = /^https?:\/\/[^\s"'<>]+\.(gif|webp)(\?[^\s"'<>]*)?$/i;
export const isGifMessage = (content) => GIF_ONLY.test((content || '').trim());

const calm = gifFrozen; // modo leve, animações desligadas ou "GIFs parados" (Acessibilidade)

// o GIF dentro da mensagem: estrela para favoritar; no modo leve fica parado e anima com o mouse em cima
export function gifEl(url, onOpen) {
  const img = h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', alt: 'GIF', onclick: () => onOpen?.(url) });
  const star = h('button.gstar', { title: 'Favoritar GIF', onclick: async (e) => { e.stopPropagation(); const r = await toggleFav({ url, preview: url, w: img.naturalWidth, h: img.naturalHeight }); if (r != null) paintStar(); } }, icon('star', 16));
  const paintStar = () => { star.classList.toggle('on', isFav(url)); star.title = isFav(url) ? 'Tirar dos favoritos' : 'Favoritar GIF'; };
  loadFavs().then(paintStar);
  const box = h('div.attach.gifmsg', img, star, h('span.gtag', 'GIF'));
  if (calm()) {
    still(url).then(s => { if (s && calm()) { img.src = s; box.classList.add('paused'); } });
    box.addEventListener('mouseenter', () => { img.src = url; box.classList.remove('paused'); });
    box.addEventListener('mouseleave', () => { still(url).then(x => { if (x && calm()) { img.src = x; box.classList.add('paused'); } }); });
  }
  return box;
}

// ---------- seletor ----------
// Abre na tela inicial (como no Discord): blocos de Favoritos, Em alta, Do grupo e categorias de reação, cada um com um
// GIF de capa. Clicar num bloco abre a lista; a seta volta. Digitar busca em qualquer tela.
let coverCache = null; // { src, t, data } — capas das categorias (o servidor já guarda por 6 h)
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export async function gifPicker(anchor, onPick) {
  closeFloating();
  await loadMeta(); await loadFavs();
  const hasProv = !!meta.provider, provs = meta.providers || (meta.provider ? [{ name: meta.provider, label: meta.label }] : []);
  let src = provs.some(p => p.name === S.prefs.gifSource) ? S.prefs.gifSource : provs[0]?.name; // fonte escolhida (fica na conta)
  const labelOf = (n) => provs.find(p => p.name === n)?.label || n;
  // view: 'home' | 'trend' | 'favs' | 'group' | 'cat' (cat = termo da categoria)
  let view = 'home', cat = '', q = '', page = 1, more = false, busy = false, seq = 0, items = [], group = null;
  const input = h('input', { placeholder: hasProv ? 'Pesquisar GIFs' : 'Pesquisar nos favoritos e do grupo', oninput: () => { clearTimeout(input._t); input._t = setTimeout(() => { q = input.value.trim(); load(true); }, 350); } });
  const tabs = h('div.gtabs'), grid = h('div.ggrid'), foot = h('div.gfoot'), home = h('div.ghome');
  const cols = [h('div.gcol'), h('div.gcol')];
  grid.append(...cols);
  const TITLES = { trend: 'GIFs em alta', favs: 'Favoritos', group: 'Do grupo' };
  const open = (v, c = '') => { view = v; cat = c; input.value = q = ''; load(true); };
  const back = () => { if (q) { input.value = q = ''; load(true); } else open('home'); input.focus(); };
  // cabeçalho: na tela inicial, nada; numa lista, a seta de voltar e o nome dela
  const drawHead = () => {
    const title = q ? `Resultados para “${q}”` : view === 'cat' ? capital(cat) : TITLES[view];
    tabs.replaceChildren(...(view === 'home' && !q ? [] : [
      h('button.gback', { type: 'button', title: 'Voltar', 'aria-label': 'Voltar', onclick: back }, icon('chevl', 20)),
      h('span.gtitle2', title)]));
    tabs.hidden = view === 'home' && !q;
  };
  const card = (g) => {
    const star = h('button.gstar' + (isFav(g.url) ? '.on' : ''), { title: isFav(g.url) ? 'Tirar dos favoritos' : 'Favoritar', onclick: async (e) => { e.stopPropagation(); const r = await toggleFav(g); if (r != null) { star.classList.toggle('on', r); star.title = r ? 'Tirar dos favoritos' : 'Favoritar'; if (view === 'favs' && !q && !r) el.remove(); } } }, icon('star', 14));
    const el = h('div.gcard', { title: g.title || '', onclick: () => { onPick(g.url, g); closeFloating(); } },
      h('img', { src: g.preview || g.url, loading: 'lazy', referrerPolicy: 'no-referrer', style: g.w && g.h ? { aspectRatio: `${g.w} / ${g.h}` } : null, onerror: () => el.remove() }), star);
    return el;
  };
  // bloco da tela inicial: capa (GIF) escurecida com o nome por cima
  const tile = (label, cover, onclick, ic) => h('button.gtile', { type: 'button', onclick, title: label },
    cover && h('img', { src: cover, loading: 'lazy', referrerPolicy: 'no-referrer', alt: '', onerror: (e) => e.target.remove() }),
    h('span', ic && icon(ic, 16), label));
  async function drawHome() {
    const my = seq, favCover = [...favs.values()][0], tiles = h('div.gtiles');
    const base = () => [tile('Favoritos', favCover && (favCover.preview || favCover.url), () => open('favs'), 'star'),
      hasProv && tile('GIFs em alta', coverCache?.data?.trending?.preview, () => open('trend'), 'fire'),
      tile('Do grupo', group?.[0]?.url, () => open('group'), 'users')].filter(Boolean);
    const cats = () => hasProv ? (coverCache?.data?.cats || []).map(c => tile(capital(c.q), c.preview, () => open('cat', c.q))) : [];
    const paint = () => { if (my === seq && view === 'home' && !q) tiles.replaceChildren(...base(), ...cats()); };
    home.replaceChildren(tiles); paint();
    const jobs = [];
    if (!group) jobs.push(api('GET', '/gifs/group').then(r => { group = r.gifs; }, () => { group = []; }));
    if (hasProv && !(coverCache?.src === src && Date.now() - coverCache.t < 30 * 60000))
      jobs.push(api('GET', `/gifs/categories?src=${src}`).then(d => { coverCache = { src, t: Date.now(), data: d }; }, () => { }));
    for (const j of jobs) j.then(paint);
  }
  const add = (list) => { for (const g of list) { const c = cols[0].offsetHeight <= cols[1].offsetHeight ? cols[0] : cols[1]; c.append(card(g)); } };
  const empty = (t) => { cols.forEach(c => c.replaceChildren()); grid.dataset.empty = t; };
  async function load(reset) {
    if (reset) { page = 1; items = []; cols.forEach(c => c.replaceChildren()); grid.scrollTop = 0; delete grid.dataset.empty; }
    drawHead();
    const my = ++seq, atHome = view === 'home' && !q;
    home.hidden = !atHome; grid.hidden = atHome;
    if (atHome) { busy = false; more = false; return drawHome(); }
    busy = true;
    try {
      let list = [];
      const term = q || (view === 'cat' ? cat : '');
      if (term && hasProv) { const r = await api('GET', `/gifs/search?q=${encodeURIComponent(term)}&page=${page}&src=${src}`); list = r.gifs; more = r.more; credit(r); }
      else if (view === 'trend' && hasProv) { const r = await api('GET', `/gifs/trending?page=${page}&src=${src}`); list = r.gifs; more = r.more; credit(r); }
      else {
        const pool = view === 'group' ? (group = (await api('GET', '/gifs/group')).gifs) : view === 'favs' ? [...favs.values()] : [...favs.values(), ...(group || (group = (await api('GET', '/gifs/group')).gifs)).filter(g => !favs.has(g.url))];
        const f = q.toLowerCase(); list = q ? pool.filter(g => (g.title || '').toLowerCase().includes(f) || g.url.toLowerCase().includes(f)) : pool; more = false;
      }
      if (my !== seq) return;
      items.push(...list); add(list);
      if (!items.length) empty(q ? 'Nada encontrado' : view === 'favs' ? h('span', 'Nenhum favorito ainda. Clique na ', icon('star', 14), ' de um GIF para guardar aqui.') : view === 'group' ? 'Ninguém mandou GIF por aqui ainda.' : 'Nada por aqui');
    } catch (e) { if (my === seq) empty(e.message); }
    finally { if (my === seq) busy = false; }
  }
  grid.addEventListener('scroll', () => { if (more && !busy && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 300) { page++; load(false); } });
  // rodapé: crédito do serviço que respondeu e, com mais de um, a troca de fonte; se o escolhido falhou, o aviso
  function credit(r) {
    if (!hasProv) return foot.replaceChildren(h('span', 'Busca de GIFs desligada no servidor (falta a chave do serviço de GIFs).'));
    const used = r?.source || src;
    foot.replaceChildren(h('span', 'GIFs por ', h('b', labelOf(used))),
      r?.fallback && h('span.gwarn', { title: r.reason || '' }, ` · ${labelOf(r.fallback)} fora do ar agora`),
      provs.length > 1 && h('span.gsrc', provs.map(p => h('button' + (p.name === src ? '.on' : ''), { type: 'button', title: `Buscar na ${p.label}`, onclick: (e) => {
        e.stopPropagation(); if (p.name === src) return; src = p.name; S.prefs.gifSource = src; savePrefs(); if (q || view !== 'favs' && view !== 'group') load(true); else credit(); } }, p.label))));
  }
  credit();
  const el = h('div.emoji-picker.gifpicker', input, tabs, home, grid, foot);
  // Esc numa lista volta para a tela inicial (na tela inicial, fecha como os outros painéis)
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (view !== 'home' || q)) { e.stopPropagation(); back(); } });
  document.getElementById('layer').append(el);
  const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.right - w.width, innerWidth - w.width - 8)) + 'px';
  el.style.top = Math.max(8, r.top - w.height - 8) + 'px';
  input.focus();
  load(true);
}
