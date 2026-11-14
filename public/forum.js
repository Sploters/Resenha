// Canal de fórum (server/forum.js), com cara de Reddit em tamanho de grupo de amigos:
// - fórum: feed de cartões (▲ e votos à esquerda, tags coloridas, título, começo do texto, imagem, nº de comentários),
//   ordem Em alta / Novos / Top / Atividade, busca, filtro por tag e o quadro "Sobre" ao lado (regras, tags, criar post)
// - post aberto: o post em destaque no topo e os comentários embaixo, no chat de sempre (o post é um canal type 11)
// Os posts ficam em S.posts (channelById procura lá): não vêm no READY, chegam pela lista ou pelo link do post.
import { h, icon, avatar, md } from './util.js';
import { S, api, tryApi, toast, modal, confirmBox, menu, can, PERM, guild, channelById, user, nameOf, lightbox } from './state.js';
import { uploadFile } from './upload.js';

const ctx = {}; // injetado por app.js: go, renderMain, profile, userMenu, mdCtx, attachEl, chName
export const initForum = (c) => Object.assign(ctx, c);
S.posts ||= new Map();

const SORTS = [['hot', 'Em alta', 'fire'], ['new', 'Novos', 'sparkle'], ['top', 'Top', 'upvote'], ['activity', 'Atividade', 'clock']];
const view = { fid: null, sort: 'hot', tag: '', q: '', posts: [], next: null, forum: null, loading: false, err: null };

const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'agora'; const m = Math.round(s / 60); if (m < 60) return `há ${m} min`;
  const hh = Math.round(m / 60); if (hh < 24) return `há ${hh} h`; const d = Math.round(hh / 24); if (d < 30) return `há ${d} d`;
  return new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
};
const plain = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<@!?\d+>/g, '@alguém').replace(/[*_~`>#|]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
const cfgOf = (f) => { try { return { tags: [], guidelines: '', ...(typeof f?.forum === 'string' ? JSON.parse(f.forum || '{}') : f?.forum || {}) }; } catch { return { tags: [], guidelines: '' }; } };
const tagOf = (cfg, id) => cfg.tags.find(t => t.id === id);
const tagEl = (t, on, onclick) => h('button.fo-tag' + (on ? '.on' : ''), { type: 'button', style: { '--tc': t.color || '#5865f2' }, onclick }, t.emoji ? h('span.fo-te', t.emoji) : null, t.name);
const isMod = (gid) => can(gid, PERM.MANAGE_MESSAGES);
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : String(n));

// ---------- posts em memória ----------
export function rememberPost(p) {
  const old = S.posts.get(p.id);
  const post = { ...(old?.post || {}), ...p };
  if (p.voted === undefined && old) post.voted = old.post.voted; // eventos não trazem o meu voto
  const ch = old || { id: p.id, guild_id: p.guild_id, type: 11 };
  Object.assign(ch, { name: post.title, parent_id: post.forum_id, post });
  S.posts.set(p.id, ch);
  return ch;
}
export async function loadPost(pid) {
  try { const p = await api('GET', `/posts/${pid}`); rememberPost(p); return S.posts.get(pid); } catch { return null; }
}
const postOf = (id) => S.posts.get(id)?.post;

// ---------- eventos ----------
export function onForumEvent(t, d) {
  if (t === 'FORUM_POST_DELETE') {
    S.posts.delete(d.id); view.posts = view.posts.filter(p => p.id !== d.id);
    if (S.view.cid === d.id) { toast('Este post foi apagado.'); ctx.go(d.guild_id, d.forum_id); return; }
    if (S.view.cid === d.forum_id) drawFeed();
    return;
  }
  const mine = d.voter === S.me.id;
  const ch = rememberPost(mine ? { ...d, voted: d.vote } : d);
  const i = view.posts.findIndex(p => p.id === d.id);
  if (i >= 0) view.posts[i] = ch.post; else if (t === 'FORUM_POST_CREATE' && view.fid === d.forum_id && !view.tag && !view.q) view.posts.splice(view.posts.findIndex(p => !p.pinned) < 0 ? view.posts.length : view.posts.findIndex(p => !p.pinned), 0, ch.post);
  if (S.view.cid === d.forum_id) drawFeed();
  if (S.view.cid === d.id) { paintPostHead(); paintLocked(); }
}
// comentário novo num post (MESSAGE_CREATE com forum_id): conta no cartão sem tratar como canal
export function onPostReply(m) {
  const ch = S.posts.get(m.channel_id); if (!ch) return;
  ch.post.replies = (ch.post.replies || 0) + 1; ch.post.last_at = m.created_at;
  const i = view.posts.findIndex(p => p.id === m.channel_id); if (i >= 0) view.posts[i] = ch.post;
  if (S.view.cid === ch.post.forum_id) drawFeed();
  if (S.view.cid === m.channel_id) paintPostHead();
}

// ---------- tela do fórum ----------
let feedEl = null, sideEl = null, toolsEl = null;
export function renderForum(main, f) {
  const g = guild(f.guild_id);
  if (view.fid !== f.id) Object.assign(view, { fid: f.id, tag: '', q: '', posts: [], next: null, forum: null, err: null });
  const cfg = cfgOf(f);
  const q = h('input.fo-q', { type: 'search', placeholder: `Buscar em ${ctx.chName(f)}`, value: view.q, 'aria-label': 'Buscar posts',
    oninput: debounce(() => { view.q = q.value.trim(); load(true); }, 300) });
  toolsEl = h('div.fo-tools');
  feedEl = h('div.fo-feed', { role: 'feed', 'aria-busy': 'true' });
  sideEl = h('aside.fo-side');
  main.replaceChildren(
    h('div#topbar',
      h('button.ibtn.menu-btn', { onclick: () => document.getElementById('app').classList.toggle('nav-open') }, icon('more')),
      h('span.hash', icon('forum', 24)), h('span', { title: f.name }, ctx.chName(f)), f.topic && h('span.topic', f.topic),
      h('div.spacer'), h('div.fo-search', icon('search', 16), q)),
    h('div#content.fo-page', h('div.fo-wrap', h('div.fo-main', h('div.fo-head', h('button.btn.fo-new', { onclick: () => newPostModal(f) }, icon('plus', 16), 'Criar post'), toolsEl), feedEl), sideEl)));
  drawTools(f, cfg); drawSide(f, g, cfg); drawFeed();
  load(true);
}
function drawTools(f, cfg) {
  if (!toolsEl) return;
  toolsEl.replaceChildren(
    h('div.fo-sorts', { role: 'tablist' }, SORTS.map(([k, l, ic]) => h('button.fo-sort' + (view.sort === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(view.sort === k), onclick: () => { view.sort = k; drawTools(f, cfg); load(true); } }, icon(ic, 16), l))),
    cfg.tags.length ? h('div.fo-tags', tagEl({ name: 'Todas', color: '#80848e' }, !view.tag, () => { view.tag = ''; drawTools(f, cfg); load(true); }),
      ...cfg.tags.map(t => tagEl(t, view.tag === t.id, () => { view.tag = view.tag === t.id ? '' : t.id; drawTools(f, cfg); load(true); }))) : null);
}
function drawSide(f, g, cfg) {
  if (!sideEl) return;
  const mod = can(f.guild_id, PERM.MANAGE_CHANNELS);
  sideEl.replaceChildren(h('div.fo-card.fo-about',
    h('div.fo-about-h', h('span.fo-ficon', icon('forum', 22)), h('div', h('b', ctx.chName(f)), h('small', g?.name || ''))),
    f.topic && h('p.fo-desc', f.topic),
    h('button.btn.fo-new.wide', { onclick: () => newPostModal(f) }, icon('plus', 16), 'Criar post'),
    cfg.guidelines && h('div.fo-rules', h('h4', 'Regras do fórum'), (() => { const d = h('div.fo-md'); d.innerHTML = md(cfg.guidelines, ctx.mdCtx(f.guild_id)); return d; })()),
    cfg.tags.length > 0 && h('div.fo-sidetags', h('h4', 'Tags'), h('div.fo-tags', ...cfg.tags.map(t => tagEl(t, view.tag === t.id, () => { view.tag = view.tag === t.id ? '' : t.id; drawTools(f, cfg); drawSide(f, g, cfg); load(true); })))),
    mod && h('button.btn.grey.wide.fo-cfg', { onclick: () => forumSettings(f) }, icon('sliders', 16), 'Tags e regras')));
}
async function load(reset) {
  const fid = view.fid; if (!fid) return;
  if (reset) { view.posts = []; view.next = null; view.loading = true; drawFeed(); }
  const off = reset ? 0 : view.next || 0;
  const qs = new URLSearchParams({ sort: view.sort, offset: off, ...(view.tag ? { tag: view.tag } : {}), ...(view.q ? { q: view.q } : {}) });
  const key = qs.toString(); view.key = key; view.loading = true;
  try {
    const r = await api('GET', `/forums/${fid}/posts?${qs}`);
    if (view.fid !== fid || view.key !== key) return; // trocou de ordem/filtro enquanto carregava
    for (const p of r.posts) rememberPost(p);
    view.posts = reset ? r.posts : [...view.posts, ...r.posts]; view.next = r.next; view.err = null;
  } catch (e) { view.err = e.message; }
  view.loading = false; drawFeed();
}
function drawFeed() {
  if (!feedEl?.isConnected) return;
  const f = channelById(view.fid), cfg = cfgOf(f);
  feedEl.setAttribute('aria-busy', String(view.loading));
  if (view.err) return feedEl.replaceChildren(h('div.fo-empty', h('b', 'Não deu para carregar os posts'), h('p', view.err), h('button.btn.sm', { onclick: () => load(true) }, 'Tentar de novo')));
  if (!view.posts.length) return feedEl.replaceChildren(view.loading ? h('div.fo-skel', ...[0, 1, 2].map(() => h('div.fo-card.fo-skelcard', h('i'), h('i'), h('i'))))
    : h('div.fo-empty', icon('forum', 40), h('b', view.q || view.tag ? 'Nada encontrado' : 'Nenhum post ainda'), h('p', view.q || view.tag ? 'Tente outra busca ou tag.' : 'Comece a conversa: o primeiro post fica no topo.'),
      !view.q && !view.tag && h('button.btn', { onclick: () => newPostModal(f) }, icon('plus', 16), 'Criar o primeiro post')));
  feedEl.replaceChildren(...view.posts.map(p => postCard(p, cfg)),
    view.next != null && h('button.btn.grey.fo-more', { disabled: view.loading, onclick: () => load(false) }, view.loading ? 'Carregando…' : 'Carregar mais'));
}
function voteBox(p, big) {
  return h('div.fo-vote' + (p.voted ? '.on' : '') + (big ? '.lg' : ''), { onclick: (e) => e.stopPropagation() },
    h('button.fo-up', { type: 'button', title: p.voted ? 'Tirar o voto' : 'Votar', 'aria-label': p.voted ? 'Tirar o voto' : 'Votar', 'aria-pressed': String(!!p.voted), onclick: () => vote(p) }, icon('upvote', big ? 20 : 18)),
    h('b.fo-score', fmt(p.score)));
}
async function vote(p) {
  const on = !p.voted, ch = S.posts.get(p.id), post = ch?.post || p;
  post.voted = on; post.score += on ? 1 : -1; // na hora; o servidor confirma
  refreshPost(post);
  try { const r = await api(on ? 'PUT' : 'DELETE', `/posts/${p.id}/vote`); post.score = r.score; post.voted = r.voted; }
  catch (e) { post.voted = !on; post.score += on ? -1 : 1; toast(e.message, true); }
  refreshPost(post);
}
function refreshPost(post) {
  const i = view.posts.findIndex(x => x.id === post.id); if (i >= 0) view.posts[i] = post;
  if (S.view.cid === post.forum_id) drawFeed();
  if (S.view.cid === post.id) paintPostHead();
}
function metaLine(p, f) {
  return h('div.fo-meta',
    h('button.fo-who', { onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, p.author_id); }, oncontextmenu: (e) => { e.stopPropagation(); ctx.userMenu(e, p.author_id); } },
      avatar(user(p.author_id).id ? user(p.author_id) : p.author, 20, { status: false }), h('span', nameOf(p.author_id, p.guild_id) || p.author?.display_name)),
    h('span.fo-dot', '•'), h('time', { title: new Date(p.created_at).toLocaleString('pt-BR'), datetime: new Date(p.created_at).toISOString() }, ago(p.created_at)),
    p.edited_at && h('span.fo-edited', { title: 'Editado ' + new Date(p.edited_at).toLocaleString('pt-BR') }, '(editado)'),
    f && h('span.fo-in', ''),
    p.pinned && h('span.fo-flag.pin', { title: 'Fixado pela moderação' }, icon('pin', 13), 'Fixado'),
    p.locked && h('span.fo-flag.lock', { title: 'Só a moderação comenta' }, icon('lock', 13), 'Trancado'));
}
function postCard(p, cfg) {
  const open = () => { rememberPost(p); ctx.go(p.guild_id, p.id); };
  const text = plain(p.content), img = p.cover;
  return h('article.fo-card.fo-post' + (p.pinned ? '.pinned' : ''), { 'data-pid': p.id, tabIndex: 0, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }, oncontextmenu: (e) => postMenu(e, p) },
    voteBox(p),
    h('div.fo-body',
      metaLine(p),
      h('h3.fo-title', p.title),
      p.tags.length > 0 && h('div.fo-tags.fo-ptags', ...p.tags.map(id => tagOf(cfg, id)).filter(Boolean).map(t => tagEl(t, false, (e) => { e.stopPropagation(); view.tag = t.id; drawTools(channelById(view.fid), cfg); load(true); }))),
      text && !img && h('p.fo-prev', text.length > 280 ? text.slice(0, 279) + '…' : text),
      img && h('div.fo-media', h('img', { src: img, alt: '', loading: 'lazy' })),
      h('div.fo-acts',
        h('span.fo-act', icon('dm', 16), `${p.replies} ${p.replies === 1 ? 'comentário' : 'comentários'}`),
        p.replies > 0 && h('span.fo-act.muted', `última ${ago(p.last_at)}`),
        h('button.fo-act', { type: 'button', title: 'Copiar link do post', onclick: (e) => { e.stopPropagation(); copyLink(p); } }, icon('link', 16), 'Compartilhar'),
        h('button.fo-act.fo-more-btn', { type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções', onclick: (e) => { e.stopPropagation(); postMenu(e, p); } }, icon('more', 16)))));
}
const copyLink = (p) => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/${p.guild_id}/${p.id}`); toast('Link do post copiado'); };
function postMenu(e, p) {
  e.preventDefault?.();
  const mine = p.author_id === S.me.id, mod = isMod(p.guild_id);
  menu(e, [
    { label: 'Abrir post', fn: () => { rememberPost(p); ctx.go(p.guild_id, p.id); } },
    { label: 'Copiar link', icon: 'link', fn: () => copyLink(p) },
    (mine || mod) && { label: 'Editar post', icon: 'edit', fn: () => newPostModal(channelById(p.forum_id), p) },
    mod && '-',
    mod && { label: p.pinned ? 'Desafixar' : 'Fixar no topo', icon: 'pin', fn: () => tryApi('PATCH', `/posts/${p.id}`, { pinned: !p.pinned }) },
    mod && { label: p.locked ? 'Destrancar comentários' : 'Trancar comentários', icon: 'lock', hint: 'Só a moderação comenta', fn: () => tryApi('PATCH', `/posts/${p.id}`, { locked: !p.locked }) },
    (mine || mod) && '-',
    (mine || mod) && { label: 'Apagar post', icon: 'trash', danger: true, fn: async () => { if (await confirmBox('Apagar post', `"${p.title}" e todos os comentários somem para todos.`, 'Apagar')) tryApi('DELETE', `/posts/${p.id}`); } },
  ]);
}

// ---------- criar / editar post ----------
function newPostModal(f, edit) {
  if (!f) return;
  const cfg = cfgOf(f), mod = isMod(f.guild_id);
  let tags = [...(edit?.tags || (view.tag ? [view.tag] : []))], files = [...(edit?.attachments || [])], busy = false, tab = 'write';
  const title = h('input.fo-in-title', { maxLength: 120, placeholder: 'Título', value: edit?.title || '', oninput: () => { cnt.textContent = `${title.value.length}/120`; } });
  const cnt = h('small.fo-cnt', `${title.value.length}/120`);
  const body = h('textarea.fo-in-body', { rows: 8, maxLength: 8000, placeholder: 'Escreva o post (opcional). Dá para usar **negrito**, *itálico*, > citação, `código` e links.', value: edit?.content || '' });
  const prev = h('div.fo-md.fo-prevbox');
  const tagBox = h('div.fo-tags.fo-pick');
  const drawTags = () => tagBox.replaceChildren(...cfg.tags.filter(t => !t.modOnly || mod).map(t => tagEl(t, tags.includes(t.id), () => { tags = tags.includes(t.id) ? tags.filter(x => x !== t.id) : [...tags, t.id].slice(-5); drawTags(); })));
  const thumbs = h('div.fo-thumbs');
  const drawThumbs = () => thumbs.replaceChildren(...files.map((a, i) => h('div.fo-thumb', /^image\//.test(a.type) ? h('img', { src: a.preview || a.url, alt: '' }) : h('span', icon('file', 22), a.name),
    a.uploading && h('div.fo-upl', a.uploading), h('button.ibtn', { type: 'button', title: 'Tirar', onclick: () => { files.splice(i, 1); drawThumbs(); } }, icon('x', 14)))));
  const pick = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: async () => {
    for (const file of [...pick.files].slice(0, 10 - files.length)) {
      const a = { name: file.name, type: file.type, size: file.size, preview: URL.createObjectURL(file), uploading: '0%' };
      files.push(a); drawThumbs();
      try { const r = await uploadFile(file, { onProgress: (x) => { a.uploading = Math.round(x * 100) + '%'; drawThumbs(); } }); Object.assign(a, { url: r.url, name: r.name || file.name, size: r.size || file.size, type: r.type || file.type }); delete a.uploading; }
      catch (e) { files = files.filter(x => x !== a); toast(e.message, true); }
      drawThumbs();
    }
    pick.value = '';
  } });
  const tabs = h('div.fo-wtabs', ...[['write', 'Escrever'], ['preview', 'Prévia']].map(([k, l]) => h('button' + (k === tab ? '.on' : ''), { type: 'button', onclick: () => { tab = k; body.hidden = k !== 'write'; prev.hidden = k === 'write'; if (k === 'preview') prev.innerHTML = body.value.trim() ? md(body.value, ctx.mdCtx(f.guild_id)) : '<p class="fo-muted">Nada para mostrar ainda.</p>'; for (const b of tabs.children) b.classList.toggle('on', b.textContent === l); } }, l)));
  prev.hidden = true;
  drawTags(); drawThumbs();
  modal(edit ? 'Editar post' : 'Criar post', `em ${ctx.chName(f)}`, h('div.fo-form',
    h('div.fo-titlerow', title, cnt),
    cfg.tags.length > 0 && h('div', h('label.f', 'Tags', cfg.requireTag ? h('small.fo-req', ' (escolha pelo menos uma)') : null), tagBox),
    tabs, body, prev,
    h('div.fo-attrow', h('button.btn.grey.sm', { type: 'button', onclick: () => pick.click() }, icon('image', 16), 'Imagem ou vídeo'), pick, thumbs),
    cfg.guidelines && h('details.fo-guide', h('summary', 'Regras do fórum'), (() => { const d = h('div.fo-md'); d.innerHTML = md(cfg.guidelines, ctx.mdCtx(f.guild_id)); return d; })())),
  [{ label: 'Cancelar', cls: 'link' }, { label: edit ? 'Salvar' : 'Postar', fn: async () => {
    if (busy) return false;
    if (!title.value.trim()) { toast('Dê um título ao post', true); title.focus(); return false; }
    if (files.some(a => a.uploading)) { toast('Espere os arquivos terminarem de enviar', true); return false; }
    busy = true;
    const payload = { title: title.value, content: body.value, tags, attachments: files.map(({ url, name, size, type }) => ({ url, name, size, type })) };
    const r = await tryApi(edit ? 'PATCH' : 'POST', edit ? `/posts/${edit.id}` : `/forums/${f.id}/posts`, edit ? { title: payload.title, content: payload.content, tags } : payload);
    busy = false; if (!r) return false;
    rememberPost(r);
    if (!edit) ctx.go(f.guild_id, r.id); else refreshPost(S.posts.get(r.id).post);
  } }], { width: '640px' });
}

// ---------- ajustes do fórum (tags e regras) ----------
const COLORS = ['#5865f2', '#23a55a', '#f0b232', '#da373c', '#eb459e', '#00a8fc', '#9b59b6', '#e67e22'];
function forumSettings(f) {
  const cfg = cfgOf(f); let tags = cfg.tags.map(t => ({ ...t }));
  const list = h('div.fo-tagedit');
  const draw = () => list.replaceChildren(...tags.map((t, i) => h('div.fo-tagrow',
    h('input.fo-te-emoji', { value: t.emoji || '', maxLength: 4, placeholder: '🙂', 'aria-label': 'Emoji', oninput: (e) => { t.emoji = e.target.value; } }),
    h('input', { value: t.name, maxLength: 24, placeholder: 'Nome da tag', 'aria-label': 'Nome da tag', oninput: (e) => { t.name = e.target.value; } }),
    h('div.fo-colors', ...COLORS.map(c => h('button.fo-color' + (t.color === c ? '.on' : ''), { type: 'button', style: { background: c }, title: c, onclick: () => { t.color = c; draw(); } }))),
    h('label.fo-modonly', { title: 'Só a moderação usa esta tag' }, h('input', { type: 'checkbox', checked: !!t.modOnly, onchange: (e) => { t.modOnly = e.target.checked; } }), 'Só moderação'),
    h('button.ibtn', { type: 'button', title: 'Tirar a tag', onclick: () => { tags.splice(i, 1); draw(); } }, icon('trash', 16)))),
    tags.length < 20 && h('button.btn.grey.sm', { type: 'button', onclick: () => { tags.push({ name: '', emoji: '', color: COLORS[tags.length % COLORS.length] }); draw(); } }, icon('plus', 14), 'Nova tag'));
  const guide = h('textarea', { rows: 5, maxLength: 2000, placeholder: 'Ex.: sem spoiler no título; marque a tag certa; seja gentil.', value: cfg.guidelines || '' });
  const req = h('input', { type: 'checkbox', checked: !!cfg.requireTag });
  draw();
  modal('Tags e regras do fórum', ctx.chName(f), h('div.fo-form', h('label.f', 'Tags'), list, h('label.fo-chk', req, 'Exigir pelo menos uma tag em cada post'), h('label.f', 'Regras (aparecem ao lado e na hora de postar)'), guide),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Salvar', fn: async () => {
      const r = await tryApi('PATCH', `/forums/${f.id}`, { tags: tags.filter(t => t.name.trim()), guidelines: guide.value, requireTag: req.checked });
      if (!r) return false; toast('Fórum atualizado');
    } }], { width: '640px' });
}

// ---------- post aberto ----------
// o topo do chat do post (no lugar do "Bem-vindo a #canal"): o post inteiro, com voto, tags, texto, imagens e ações
let headEl = null;
export function postHead(ch) {
  headEl = h('div.welcome.fo-posthead', { 'data-pid': ch.id });
  paintPostHead(ch);
  return headEl;
}
export function paintPostHead(chArg) {
  const ch = chArg || S.posts.get(S.view.cid); if (!ch || !headEl || headEl.dataset.pid !== ch.id) return;
  const p = ch.post, f = channelById(p.forum_id), cfg = cfgOf(f);
  const body = h('div.fo-md.fo-full'); body.innerHTML = p.content ? md(p.content, ctx.mdCtx(p.guild_id)) : '';
  headEl.replaceChildren(h('div.fo-card.fo-post.fo-open', { oncontextmenu: (e) => postMenu(e, p) },
    voteBox(p, true),
    h('div.fo-body',
      metaLine(p),
      h('h1.fo-title', p.title),
      p.tags.length > 0 && h('div.fo-tags.fo-ptags', ...p.tags.map(id => tagOf(cfg, id)).filter(Boolean).map(t => tagEl(t, false, () => { view.tag = t.id; ctx.go(p.guild_id, p.forum_id); }))),
      p.content && body,
      p.attachments.length > 0 && h('div.fo-atts', ...p.attachments.map(a => (/^image\//.test(a.type) ? h('img.fo-img', { src: a.url, alt: a.name, loading: 'lazy', onclick: () => lightbox(a.url) }) : ctx.attachEl(a)))),
      h('div.fo-acts',
        h('span.fo-act', icon('dm', 16), `${p.replies} ${p.replies === 1 ? 'comentário' : 'comentários'}`),
        h('button.fo-act', { type: 'button', onclick: () => copyLink(p) }, icon('link', 16), 'Compartilhar'),
        h('button.fo-act.fo-more-btn', { type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções', onclick: (e) => postMenu(e, p) }, icon('more', 16))))),
    h('div.fo-csep', h('span', 'Comentários')));
}
// post trancado: o compositor dá lugar a um aviso (a moderação ainda comenta)
export function paintLocked() {
  const ch = S.posts.get(S.view.cid), comp = document.getElementById('composer'); if (!ch || !comp) return;
  const lock = ch.post.locked && !isMod(ch.guild_id);
  comp.classList.toggle('fo-lockedcomp', lock);
  let note = document.getElementById('fo-locknote');
  if (lock && !note) comp.before(note = h('div#fo-locknote', icon('lock', 16), 'Este post está trancado: só a moderação pode comentar.'));
  if (!lock) note?.remove();
}
export const forumOfPost = (ch) => channelById(ch.post?.forum_id);

function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
