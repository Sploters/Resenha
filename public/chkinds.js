// Tipos de canal novos (ideia "Kinds of Channels", Stoat #1027). O de anúncios (5) usa o chat de sempre (só a moderação
// escreve, por padrão); aqui ficam as duas telas próprias:
// - Galeria (16): os posts (foto ou vídeo + legenda) numa grade. Clique abre o post com reações e comentários (respostas
//   ao post). "Conversa" mostra o mesmo canal como chat normal, para quem prefere.
// - Documento (17): uma página em markdown (regras, guias, listas). "- [ ] tarefa" vira caixinha que quem pode editar marca
//   com um clique. Edição com prévia ao lado; duas pessoas salvando ao mesmo tempo não perdem nada (server/docchannel.js).
import { h, icon, avatar, md, imgUrl, thumbUrl, stamp, debounce } from './util.js';
import { S, api, tryApi, toast, modal, confirmBox, menu, can, PERM, guild, user, nameOf, lightbox, emojiPicker, chCan, CH } from './state.js';
import { uploadFile } from './upload.js';
import { coverMedia, coverReason, freezeGif, isGifName } from './mediasafe.js';

const ctx = {}; // injetado por app.js: go, renderMain, profile, mdCtx, chName, attachEl, jumpTo, setReply, react, reactionFace, galleryChat
export const initKinds = (c) => Object.assign(ctx, c);
const isMedia = (f) => !f.expired && !f.enc && (/^(image|video)\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|avif|bmp|mp4|webm|mov|m4v)$/i.test(f.name || ''));
const isVid = (f) => /^video\//.test(f.type || '') || /\.(mp4|webm|mov|m4v)$/i.test(f.name || '');
const topbar = (ch, kindIcon, ...right) => h('div#topbar',
  h('button.ibtn.menu-btn', { onclick: () => document.getElementById('app').classList.toggle('nav-open') }, icon('more')),
  h('span.hash', icon(kindIcon, 24)), h('span', { title: ch.name }, ctx.chName(ch)), ch.topic && h('span.topic', ch.topic), h('div.spacer'), ...right);

// ============================ Galeria ============================
const gal = { cid: null, msgs: [], more: false, busy: false, grid: null, count: null };
export function renderGallery(main, ch) {
  const fresh = gal.cid !== ch.id;
  if (fresh) Object.assign(gal, { cid: ch.id, msgs: [], more: false });
  const canPost = chCan(ch, CH.SEND) && chCan(ch, CH.ATTACH);
  gal.grid = h('div.gal-grid', { role: 'list' }); gal.count = h('small.mut');
  const more = h('button.btn.grey.gal-more.hidden', { type: 'button', onclick: () => load(false) }, 'Carregar mais');
  gal.moreBtn = more;
  main.replaceChildren(
    topbar(ch, 'image',
      h('button.ibtn', { title: 'Ver como conversa', 'aria-label': 'Ver como conversa', onclick: () => ctx.galleryChat(ch.id, true) }, icon('dm')),
      canPost && h('button.btn.green.sm.gal-post', { type: 'button', onclick: () => postModal(ch) }, icon('plus', 16), 'Postar')),
    h('div#content.gal-page', h('div.gal-wrap',
      h('div.gal-head', h('div', h('b', ctx.chName(ch)), gal.count), canPost ? h('small.mut', 'Cada post é uma foto ou vídeo com legenda. Comente abrindo o post.') : h('small.mut', 'Só leitura para você.')),
      gal.grid, more)));
  if (fresh || !gal.msgs.length) load(true); else draw();
}
async function load(reset) {
  if (gal.busy) return; gal.busy = true;
  const cid = gal.cid, oldest = !reset && gal.msgs[0]?.id;
  try {
    const list = await api('GET', `/channels/${cid}/messages?limit=100${oldest ? '&before=' + oldest : ''}`);
    if (gal.cid !== cid) return;
    gal.msgs = reset ? list : [...list, ...gal.msgs]; gal.more = list.length === 100;
    draw();
  } catch (e) { gal.grid && gal.grid.replaceChildren(h('div.mf-empty', e.message)); }
  finally { gal.busy = false; }
}
const posts = () => gal.msgs.filter(m => !m.reply && (m.attachments || []).some(isMedia)).reverse(); // mais novo primeiro
const commentsOf = (id) => gal.msgs.filter(m => m.reply?.id === id);
function draw() {
  if (!gal.grid?.isConnected) return;
  const ps = posts();
  gal.count.textContent = ps.length ? ` · ${ps.length}${gal.more ? '+' : ''} post${ps.length === 1 ? '' : 's'}` : '';
  gal.moreBtn.classList.toggle('hidden', !gal.more);
  if (!ps.length) return gal.grid.replaceChildren(h('div.gal-empty', icon('image', 40), h('b', 'Nenhum post ainda'), h('small', 'Fotos e vídeos postados aqui aparecem em grade.')));
  gal.grid.replaceChildren(...ps.map(card));
}
function mediaThumb(m, f, size) {
  let el;
  if (isVid(f)) el = h('span.gal-vid', thumbUrl(f.url) && h('img', { src: thumbUrl(f.url), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }), h('i', icon('play', 22)));
  else { const im = h('img', { src: imgUrl(f.url, size), alt: f.name || '', loading: 'lazy' }); el = h('span.gal-img', im); if (isGifName(f.name)) freezeGif(im, f.url, el); }
  return coverMedia(el, coverReason(m, f), m.id + ':g:' + f.url);
}
function card(m) {
  const media = m.attachments.filter(isMedia), f = media[0], gid = guild(S.view.gid)?.id;
  const likes = (m.reactions || []).reduce((n, r) => n + r.users.length, 0), comments = commentsOf(m.id).length;
  const cap = String(m.content || '').replace(/\s+/g, ' ').trim();
  return h('button.gal-card', { type: 'button', role: 'listitem', 'data-mid': m.id, onclick: () => openPost(m.id), title: cap || f.name },
    mediaThumb(m, f, 360), media.length > 1 && h('span.gal-n', '+' + (media.length - 1)),
    h('span.gal-meta', avatar(user(m.author_id), 18, { status: false }), h('b', nameOf(m.author_id, gid)), cap && h('span.gal-cap', cap.slice(0, 80)),
      h('span.gal-stats', likes > 0 && h('i', icon('smile', 12), likes), comments > 0 && h('i', icon('dm', 12), comments))));
}
function openPost(mid) {
  const m = gal.msgs.find(x => x.id === mid); if (!m) return;
  const ch = { id: m.channel_id, guild_id: S.view.gid }, gid = S.view.gid, mod = gid && can(gid, PERM.MANAGE_MESSAGES), mine = m.author_id === S.me.id;
  const reacts = h('div.reactions'), list = h('div.gal-comments'), input = h('input', { placeholder: 'Comentar…', maxLength: 2000 });
  const paint = () => {
    const cur = gal.msgs.find(x => x.id === mid) || m;
    reacts.replaceChildren(...(cur.reactions || []).map(r => h('div.react' + (r.users.includes(S.me.id) ? '.me' : ''), { onclick: () => ctx.react(cur, r.emoji, !r.users.includes(S.me.id)) }, ctx.reactionFace(r.emoji), h('span', r.users.length))),
      h('button.ibtn.gal-addreact', { type: 'button', title: 'Reagir', onclick: (e) => emojiPicker(e.currentTarget, (em) => ctx.react(cur, em, true)) }, icon('smile', 18)));
    const cs = commentsOf(mid);
    list.replaceChildren(...(cs.length ? cs.map(c => { const b = h('span.gal-ctext'); b.innerHTML = md(c.content || '', ctx.mdCtx(gid)); return h('div.gal-comment', avatar(user(c.author_id), 24, { status: false }), h('div', h('b', nameOf(c.author_id, gid)), h('small.mut', ' ' + stamp(c.created_at)), b)); }) : [h('small.mut', 'Nenhum comentário ainda.')]));
  };
  const body = h('div.gal-post');
  const cap = h('div.gal-pcap'); cap.innerHTML = md(m.content || '', ctx.mdCtx(gid));
  body.append(h('div.gal-pmedia', m.attachments.filter(isMedia).map(f => {
    const node = isVid(f) ? ctx.attachEl(f) : h('img', { src: imgUrl(f.url, 960), alt: f.name || '', onclick: () => lightbox(f.url) });
    if (!isVid(f) && isGifName(f.name)) freezeGif(node, f.url, null);
    return coverMedia(node, coverReason(m, f), m.id + ':p:' + f.url);
  })),
  h('div.gal-pinfo', avatar(user(m.author_id), 32, { status: false }), h('div', h('b', nameOf(m.author_id, gid)), h('small.mut', ' ' + stamp(m.created_at)), m.content && cap)),
  reacts, h('div.gal-csec', h('h5', 'Comentários'), list),
  chCan(ch, CH.SEND) && h('form.gal-cform', { onsubmit: async (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.disabled = true;
    try { await api('POST', `/channels/${m.channel_id}/messages`, { content: t, reply_to: m.id }); input.value = ''; } catch (er) { toast(er.message, true); } input.disabled = false; input.focus(); } },
  input, h('button.btn.sm', { type: 'submit' }, 'Enviar')));
  paint();
  const dlg = modal(null, null, body, [
    (mine || mod) && { label: 'Apagar post', cls: 'red', fn: async () => { if (!await confirmBox('Apagar post', 'Apagar este post da galeria?', 'Apagar')) return false; await tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); } },
    { label: 'Ver na conversa', cls: 'grey', fn: () => { ctx.galleryChat(m.channel_id, true); setTimeout(() => ctx.jumpTo(m.id), 400); } },
    { label: 'Fechar' }].filter(Boolean), { width: '720px' });
  dlg.el.classList.add('gal-modal');
  openRefresh = () => { if (!dlg.el.isConnected) { openRefresh = null; return; } paint(); };
}
let openRefresh = null;
// postar: escolhe fotos/vídeos, legenda e spoiler; sobe e manda uma mensagem só
function postModal(ch) {
  const inp = h('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: { display: 'none' } });
  let files = [];
  const prev = h('div.gal-prev'), cap = h('textarea', { rows: 3, maxLength: 4000, placeholder: 'Legenda (opcional)' }), spoil = h('input', { type: 'checkbox' });
  const status = h('small.mut');
  const paint = () => prev.replaceChildren(...files.map((f, i) => h('div.gal-pv', f.type.startsWith('image/') ? h('img', { src: f._u ||= URL.createObjectURL(f), alt: '' }) : h('span.gal-vid', h('i', icon('play', 18)), h('small', f.name)),
    h('button.x', { type: 'button', title: 'Tirar', onclick: () => { URL.revokeObjectURL(f._u); files.splice(i, 1); paint(); } }, icon('x', 12)))),
    h('button.gal-pick', { type: 'button', onclick: () => inp.click() }, icon('plus', 22), h('small', files.length ? 'Mais' : 'Escolher fotos ou vídeos')));
  inp.onchange = () => { files.push(...[...inp.files].filter(f => /^(image|video)\//.test(f.type))).slice(0, 10); files = files.slice(0, 10); inp.value = ''; paint(); };
  paint();
  modal('Postar na galeria', `#${ctx.chName(ch)}`, h('div.gal-new', inp, prev, h('label.f', 'Legenda', cap), h('label.chk', spoil, h('span', 'Marcar como spoiler (fica borrado até clicarem)')), status),
    [{ label: 'Cancelar', cls: 'link', fn: () => files.forEach(f => f._u && URL.revokeObjectURL(f._u)) }, { label: 'Postar', fn: async () => {
      if (!files.length) { toast('Escolha pelo menos uma foto ou vídeo', true); return false; }
      const atts = [];
      try {
        for (const [i, f] of files.entries()) {
          status.textContent = `Enviando ${i + 1} de ${files.length}…`;
          const r = await uploadFile(f, { onProgress: (p) => { status.textContent = `Enviando ${i + 1} de ${files.length}… ${Math.round(p * 100)}%`; } });
          atts.push({ url: r.url, name: r.name || f.name, size: r.size || f.size, type: r.type || f.type, ...(spoil.checked ? { spoiler: true } : {}) });
        }
        await api('POST', `/channels/${ch.id}/messages`, { content: cap.value.trim(), attachments: atts });
        files.forEach(f => f._u && URL.revokeObjectURL(f._u));
      } catch (e) { status.textContent = ''; toast(e.message, true); return false; }
    } }], { width: '520px' });
}
const reloadSoon = debounce(() => { if (gal.grid?.isConnected) load(true); }, 400);

// ============================ Documento ============================
const docs = new Map(); // canal -> { content, v, by, at, can_edit }
const dv = { cid: null, editing: false, draft: '', root: null, stale: false };
export function renderDoc(main, ch) {
  if (dv.cid !== ch.id) Object.assign(dv, { cid: ch.id, editing: false, draft: '', stale: false });
  dv.root = h('div.doc-wrap');
  const d = docs.get(ch.id);
  main.replaceChildren(topbar(ch, 'doc', h('div#doc-actions')), h('div#content.doc-page', dv.root));
  if (d) drawDoc(ch); else dv.root.replaceChildren(h('div.doc-loading', 'Carregando o documento…'));
  api('GET', `/channels/${ch.id}/doc`).then(r => { docs.set(ch.id, r); if (dv.cid === ch.id && !dv.editing) drawDoc(ch); }, e => dv.root.replaceChildren(h('div.mf-empty', e.message)));
}
const TASK = /^(\s*)[-*] \[( |x|X)\] (.*)$/, BULLET = /^(\s*)[-*] (.+)$/;
function docBody(ch, d) {
  const gid = ch.guild_id, out = h('article.doc-body'), lines = (d.content || '').split('\n');
  let chunk = [];
  const flush = () => { if (!chunk.length) return; const div = h('div.doc-md'); div.innerHTML = md(chunk.join('\n'), ctx.mdCtx(gid)); out.append(div); chunk = []; };
  lines.forEach((ln, i) => {
    const t = TASK.exec(ln), b = !t && BULLET.exec(ln);
    if (t) {
      flush(); const done = t[2] !== ' ', txt = h('span'); txt.innerHTML = md(t[3], ctx.mdCtx(gid));
      out.append(h('label.doc-task' + (done ? '.done' : ''), { style: { marginLeft: t[1].length * 8 + 'px' } },
        h('input', { type: 'checkbox', checked: done, disabled: !d.can_edit, onchange: (e) => toggleTask(ch, i, ln, e.target.checked) }), txt));
    } else if (b) { flush(); const txt = h('span'); txt.innerHTML = md(b[2], ctx.mdCtx(gid)); out.append(h('div.doc-li', { style: { marginLeft: b[1].length * 8 + 'px' } }, h('i', '•'), txt)); }
    else chunk.push(ln);
  });
  flush();
  return out;
}
function drawDoc(ch) {
  const d = docs.get(ch.id); if (!d || !dv.root?.isConnected) return;
  const acts = document.getElementById('doc-actions');
  if (dv.editing) return drawEditor(ch, d);
  acts?.replaceChildren(...(d.can_edit ? [h('button.btn.sm', { type: 'button', onclick: () => { dv.editing = true; dv.draft = d.content; dv.stale = false; drawDoc(ch); } }, icon('edit', 16), 'Editar')] : []));
  const empty = !d.content.trim();
  dv.root.replaceChildren(
    empty ? h('div.gal-empty', icon('doc', 40), h('b', 'Documento vazio'), h('small', d.can_edit ? 'Regras, guias, listas de tarefas: escreva em markdown. "- [ ] tarefa" vira caixinha.' : 'A moderação ainda não escreveu nada aqui.'),
      d.can_edit && h('div.doc-tpls', TEMPLATES.map(([l, t]) => h('button.btn.grey.sm', { type: 'button', onclick: () => { dv.editing = true; dv.draft = t; drawDoc(ch); } }, l)))) : docBody(ch, d),
    d.at && h('div.doc-foot', icon('edit', 12), 'Editado por ', h('b', d.by?.display_name || 'alguém'), ' · ' + stamp(d.at), ` · versão ${d.v}`));
}
const TEMPLATES = [
  ['Regras do servidor', '# Regras\n\n1. Respeite todo mundo.\n2. Nada de spam ou divulgação sem permissão.\n3. Spoiler sempre marcado como spoiler.\n4. Conteúdo adulto não é permitido.\n\n## Punições\nAviso → castigo → expulsão.'],
  ['Lista de tarefas', '# Tarefas\n\n- [ ] Primeira tarefa\n- [ ] Segunda tarefa\n- [x] Tarefa feita'],
  ['Guia', '# Guia\n\n## Começando\nEscreva aqui.\n\n## Links úteis\n- https://exemplo.com'],
];
function drawEditor(ch, d) {
  const ta = h('textarea.doc-ta', { value: dv.draft, spellcheck: true, 'aria-label': 'Texto do documento (markdown)' });
  const prev = h('div.doc-prev');
  const paint = () => { dv.draft = ta.value; prev.replaceChildren(docBody(ch, { ...d, content: ta.value, can_edit: false })); };
  ta.addEventListener('input', debounce(paint, 150));
  const wrapSel = (a, b = a) => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'texto'; ta.setRangeText(a + sel + b, s, e, 'end'); ta.focus(); paint(); };
  const linePre = (p) => { const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; ta.setRangeText(p, s, s, 'end'); ta.focus(); paint(); };
  const tool = (ic, label, fn) => h('button.ibtn', { type: 'button', title: label, 'aria-label': label, onclick: fn }, typeof ic === 'string' && ic.length <= 2 ? h('b', ic) : icon(ic, 16));
  const save = async (force) => {
    try {
      const r = await api('PUT', `/channels/${ch.id}/doc`, { content: ta.value, ...(force ? {} : { v: d.v }) });
      docs.set(ch.id, { ...r, can_edit: true }); dv.editing = false; dv.stale = false; drawDoc(ch); toast('Documento salvo');
    } catch (e) {
      if (e.status !== 409) return toast(e.message, true);
      const newer = e.data?.doc;
      menu({ preventDefault() { }, clientX: innerWidth / 2 - 120, clientY: innerHeight / 3 }, [
        { label: `${newer?.by?.display_name || 'Alguém'} salvou uma versão nova enquanto você editava`, disabled: true },
        { label: 'Salvar a minha por cima', danger: true, fn: () => save(true) },
        { label: 'Descartar a minha e ver a nova', fn: () => { if (newer) docs.set(ch.id, { ...newer, can_edit: true }); dv.editing = false; drawDoc(ch); } },
        { label: 'Continuar editando (copie o seu texto antes)', fn: () => { } },
      ]);
    }
  };
  document.getElementById('doc-actions')?.replaceChildren(
    h('button.btn.link.sm', { type: 'button', onclick: async () => { if (ta.value !== d.content && !await confirmBox('Descartar alterações', 'Sair sem salvar?', 'Descartar')) return; dv.editing = false; drawDoc(ch); } }, 'Cancelar'),
    h('button.btn.green.sm', { type: 'button', onclick: () => save(false) }, icon('check', 16), 'Salvar'));
  dv.root.replaceChildren(
    dv.stale && h('div.doc-stale', icon('info', 14), 'Alguém salvou uma versão nova enquanto você editava. Ao salvar, você escolhe o que fazer.'),
    h('div.doc-tools', tool('H', 'Título', () => linePre('# ')), tool('B', 'Negrito', () => wrapSel('**')), tool('I', 'Itálico', () => wrapSel('*')),
      tool('•', 'Lista', () => linePre('- ')), tool('check', 'Tarefa (caixinha)', () => linePre('- [ ] ')), tool('link', 'Link', () => wrapSel('[', '](https://)')),
      h('small.mut', `${ta.value.length.toLocaleString('pt-BR')} / 60.000`)),
    h('div.doc-edit', ta, prev));
  ta.addEventListener('input', () => { dv.root.querySelector('.doc-tools small').textContent = `${ta.value.length.toLocaleString('pt-BR')} / 60.000`; });
  ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); } });
  paint(); ta.focus();
}
// marcar/desmarcar uma caixinha: grava na hora; se outra pessoa salvou antes, refaz na versão nova (pela mesma linha)
async function toggleTask(ch, i, line, on, retry) {
  const d = docs.get(ch.id), lines = d.content.split('\n');
  let idx = lines[i] === line ? i : lines.findIndex(l => l.replace(/\[[ xX]\]/, '[ ]') === line.replace(/\[[ xX]\]/, '[ ]'));
  if (idx < 0) { toast('Essa tarefa mudou no documento', true); return drawDoc(ch); }
  lines[idx] = lines[idx].replace(/\[[ xX]\]/, on ? '[x]' : '[ ]');
  try { const r = await api('PUT', `/channels/${ch.id}/doc`, { content: lines.join('\n'), v: d.v }); docs.set(ch.id, { ...r, can_edit: d.can_edit }); drawDoc(ch); }
  catch (e) {
    if (e.status === 409 && !retry && e.data?.doc) { docs.set(ch.id, { ...e.data.doc, can_edit: d.can_edit }); return toggleTask(ch, idx, line, on, true); }
    toast(e.message, true); drawDoc(ch);
  }
}

// eventos ao vivo (app.js chama para mensagens e CHANNEL_DOC)
export function onKindsEvent(t, d) {
  if (t === 'CHANNEL_DOC') {
    const cur = docs.get(d.channel_id); docs.set(d.channel_id, { ...d, can_edit: cur?.can_edit ?? false });
    if (dv.cid === d.channel_id && dv.root?.isConnected) {
      if (!dv.editing) drawDoc({ id: d.channel_id, guild_id: d.guild_id });
      else if (d.by?.id !== S.me.id) { dv.stale = true; dv.root.querySelector('.doc-stale') || dv.root.prepend(h('div.doc-stale', icon('info', 14), `${d.by?.display_name || 'Alguém'} salvou uma versão nova enquanto você editava. Ao salvar, você escolhe o que fazer.`)); }
    }
    return;
  }
  if (gal.cid && d?.channel_id === gal.cid) {
    if (t === 'MESSAGE_CREATE' && !gal.msgs.some(m => m.id === d.id)) gal.msgs.push(d);
    else if (t === 'MESSAGE_UPDATE') { const i = gal.msgs.findIndex(m => m.id === d.id); if (i >= 0) gal.msgs[i] = d; }
    else if (t === 'MESSAGE_DELETE') gal.msgs = gal.msgs.filter(m => m.id !== d.id);
    else if (t === 'MESSAGES_IMPORTED') return reloadSoon();
    draw(); openRefresh?.();
  }
}
