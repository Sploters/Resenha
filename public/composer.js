// Compositor: caixa de texto, rascunhos, anexos (com compressão de imagem), envio otimista, autocompletar e digitando.
import { needsRules, rulesLock } from './onboarding.js';
import { gifPicker } from './gifs.js';
import { mediaFavPicker } from './mediafavs.js';
import { uploadFile, compressVideo, maxUpload, isVideo } from './upload.js';
import { h, icon, avatar, sameDay, bytes, SHORT, cleanLinks } from './util.js';
import { S, api, user, guild, channelById, nameOf, toast, promptBox, popout, emojiPicker, closeFloating, allEmojis, CH, chCan } from './state.js';
import { timing } from './ux.js';
import { recordVoiceMessage } from './voicemsg.js';
import { addMention, resolveMentions } from './plugins.js';
import { translateOutgoing } from './translate.js';
import { protectFiles, encryptFile } from './e2ee.js';
import { $, gwSend, renderSoftmute } from './gateway.js';
import { freePostTop } from './mainview.js';
import { renderMessages, msgEl } from './chat.js';
import { plusMenu } from './msgcards.js';
import { quickReply, jumpToTop } from './msgactions.js';
// ---------- compositor ----------
// Rascunho por canal, guardado neste aparelho (lc_drafts): trocar de canal, recarregar ou o navegador descartar a aba
// (no celular é comum) não apaga o que estava sendo escrito. Até 50 canais; o mais antigo sai.
const DRAFTS = 'lc_drafts';
const readDrafts = () => { try { return JSON.parse(localStorage.getItem(DRAFTS) || '{}'); } catch { return {}; } };
function saveDraft(cid, text) {
  const d = readDrafts(); if ((d[cid]?.t || '') === (text || '')) return;
  if (text) d[cid] = { t: text.slice(0, 4000), at: Date.now() }; else delete d[cid];
  const ks = Object.keys(d); if (ks.length > 50) ks.sort((a, b) => d[a].at - d[b].at).slice(0, ks.length - 50).forEach(k => delete d[k]);
  try { localStorage.setItem(DRAFTS, JSON.stringify(d)); } catch { }
}
// o campo na tela agora: a aba pode ser congelada ou fechada a qualquer momento (pagehide/freeze), então grava já
export const flushDraft = () => { const ta = $('#composer textarea'); if (ta?.dataset.cid) { clearTimeout(ta._dt); saveDraft(ta.dataset.cid, ta.value); } };
for (const ev of ['pagehide', 'freeze']) addEventListener(ev, flushDraft, { capture: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
const MSG_MAX = 4000, MSG_WARN = 500; // limite do servidor para texto comum (server/e2ee.js)
export function composer(ch, label) {
  // sem permissão de enviar (canal só leitura para os seus cargos): no lugar do campo, um aviso
  if (ch.guild_id && needsRules(ch.guild_id)) return rulesLock(ch.guild_id); // regras do servidor ainda não aceitas (onboarding.js)
  if (ch.guild_id && !chCan(ch, CH.SEND)) return h('div#composer-wrap', h('div.composer-locked', { role: 'status' }, icon('lock', 18), h('span', 'Você não tem permissão para enviar mensagens neste canal.')));
  const ta = h('textarea', { placeholder: label == null ? 'Escreva um comentário…' : `Conversar em ${label}`, rows: 1, maxLength: MSG_MAX, value: readDrafts()[ch.id]?.t || '' });
  // perto do limite de 4000 caracteres aparece quanto falta (antes o campo só parava de aceitar letras, sem dizer por quê)
  const cnt = h('span.msg-count.hidden', { 'aria-live': 'polite' });
  const count = () => { const left = MSG_MAX - ta.value.length; cnt.classList.toggle('hidden', left > MSG_WARN); cnt.classList.toggle('full', left <= 0); cnt.textContent = String(left); cnt.title = left > 0 ? `Faltam ${left} caracteres (limite de ${MSG_MAX})` : `Limite de ${MSG_MAX} caracteres. Texto maior: cole e ele vai como arquivo`; };
  ta.dataset.cid = ch.id; ta.addEventListener('blur', flushDraft);
  const grow = () => { ta.style.height = '0'; ta.style.height = Math.min(ta.scrollHeight, 400) + 'px'; };
  let lastTyping = 0;
  const fileIn = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => { [...fileIn.files].forEach(addFile); fileIn.value = ''; } });
  ta.addEventListener('input', () => { grow(); count(); clearTimeout(ta._dt); ta._dt = setTimeout(() => saveDraft(ch.id, ta.value), 400); if (Date.now() - lastTyping > 3000 && ta.value) { lastTyping = Date.now(); gwSend('TYPING', { channel_id: ch.id }); } autocomplete(ta); });
  ta.addEventListener('paste', (e) => {
    const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.forEach(addFile); return; }
    // texto colado maior que o que cabe: o campo cortava o resto calado (log, código). Agora vai inteiro como mensagem.txt
    const txt = e.clipboardData?.getData('text/plain') || '', room = MSG_MAX - ta.value.length + (ta.selectionEnd - ta.selectionStart);
    if (txt.length <= room) return;
    if (ch.guild_id && !chCan(ch, CH.ATTACH)) { toast(`O texto colado tem ${txt.length.toLocaleString('pt-BR')} caracteres e o limite é ${MSG_MAX}: entrou só o começo.`, true); setTimeout(count); return; }
    e.preventDefault(); addFile(new File([txt], 'mensagem.txt', { type: 'text/plain' }));
    toast(`Texto longo demais para uma mensagem (${txt.length.toLocaleString('pt-BR')} de ${MSG_MAX.toLocaleString('pt-BR')} caracteres): ele vai anexado como mensagem.txt`);
  });
  ta.addEventListener('keydown', (e) => {
    const ac = $('.ac');
    if (ac && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
      e.preventDefault(); const items = [...ac.querySelectorAll('.it')], i = items.findIndex(x => x.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { items[i]?.classList.remove('sel'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('sel'); }
      else items[i]?.dispatchEvent(new MouseEvent('mousedown'));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(ta, ch); setTimeout(() => { grow(); count(); }); }
    else if (e.key === 'Escape') { if (ac) ac.remove(); else if (S.replyTo) { S.replyTo = null; renderReplyBar(); } }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && S.prefs.quickReply !== false) { e.preventDefault(); quickReply(ch, e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'ArrowUp' && !ta.value) { const mine = [...(S.messages.get(ch.id) || [])].reverse().find(m => m.author_id === S.me.id); if (mine) { S.editing = mine.id; renderMessages(true); } }
  });
  // GIF, emoji e gravar voz num botão só: abre uma fileira com os três ícones (o nome aparece ao passar o mouse)
  const extrasBtn = h('button.ibtn.extras-btn', { type: 'button', 'data-keepfloat': '', title: 'GIF, emoji e mensagem de voz', 'aria-label': 'GIF, emoji e mensagem de voz', 'aria-haspopup': 'true' }, icon('extras', 26));
  const insertEmoji = (em) => { ta.setRangeText(em, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); };
  // abre ao passar o mouse (ou clicar) e fecha 0,5 s depois que o mouse sai do botão e do painel
  let cxEl = null, cxTimer = 0, cxAt = 0;
  const cxOpen = () => !!cxEl && cxEl.isConnected;
  const cxHide = () => { clearTimeout(cxTimer); if (cxOpen()) cxEl.remove(); cxEl = null; };
  const cxLater = () => { clearTimeout(cxTimer); cxTimer = setTimeout(cxHide, 500); };
  const cxShow = () => {
    clearTimeout(cxTimer); if (cxOpen()) return;
    const opt = (ic, label, fn) => h('button.cx-opt', { type: 'button', title: label, 'aria-label': label, onclick: () => { cxHide(); closeFloating(); fn(); } }, icon(ic, 24));
    const body = h('div.cx-pop', { role: 'menu' },
      opt('cxgif', 'GIF', () => gifPicker(extrasBtn, (url) => sendGif(ch, url))),
      opt('cxemoji', 'Emoji', () => emojiPicker(extrasBtn, insertEmoji)),
      opt('star', 'Mídia favorita', () => mediaFavPicker(extrasBtn, { pick: (it) => sendFavMedia(ch, it), emoji: insertEmoji })),
      opt('cxmic', 'Gravar mensagem de voz', () => recordVoiceMessage(ch, extrasBtn.closest('#composer'), { onSent: () => { S.replyTo = null; renderReplyBar(); } })));
    const el = cxEl = popout(extrasBtn, body, 'up'); el.classList.add('cx-popout'); cxAt = Date.now();
    el.addEventListener('mouseenter', () => clearTimeout(cxTimer)); el.addEventListener('mouseleave', cxLater);
    const r = extrasBtn.getBoundingClientRect(), b = el.getBoundingClientRect();
    el.style.top = Math.max(8, r.top - b.height - 8) + 'px'; el.style.left = Math.max(8, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 8)) + 'px';
  };
  // passar o mouse não fecha um seletor de GIF/emoji que já está aberto (só o clique troca)
  extrasBtn.addEventListener('mouseenter', () => { if (cxOpen() || !document.querySelector('#layer :is(.popout, .emoji-picker, .menu):not(.leaving)')) cxShow(); });
  extrasBtn.addEventListener('mouseleave', () => { if (cxOpen()) cxLater(); });
  extrasBtn.onclick = () => (!cxOpen() ? cxShow() : Date.now() - cxAt > 700 && cxHide()); // clique logo depois de abrir pelo mouse (ou toque) mantém aberto
  const wrap = h('div#composer-wrap', h('div#softmute-bar.hidden', { role: 'status' }), h('div#reply-bar.hidden'), h('div#attach-prev.hidden'),
    h('div#composer', h('button.ibtn', { title: 'Enviar arquivo, compartilhar um clipe e mais', onclick: (e) => plusMenu(e, ch, fileIn) }, icon('plus', 24)), fileIn, ta, cnt,
      extrasBtn));
  // ir para a primeira mensagem: canto de baixo, logo acima do campo; só aparece depois de rolar para cima
  const topBtn = h('button#totop-btn.hidden', { type: 'button', title: 'Ir para a primeira mensagem', 'aria-label': 'Ir para a primeira mensagem', onclick: jumpToTop }, icon('totop', 20));
  wrap.append(topBtn);
  // ao abrir o chat ele aparece de uma vez (o fade de entrada aparecia pela metade logo depois da tela montar); o fade fica
  // para quando a pessoa rola
  topBtn.classList.add('nofade'); setTimeout(() => topBtn.classList.remove('nofade'), 1500);
  setTimeout(() => {
    renderReplyBar(); renderPendingPrev(); renderSoftmute(); if (ta.value) { grow(); count(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    // sala de voz: o chat não pega o foco sozinho, senão a tecla de push-to-talk (uma letra, por padrão V) vira texto
    // em vez de abrir o microfone; para escrever, é só clicar no campo
    if (ch.type !== 2) ta.focus();
    const box = $('#msgs'); if (!box) return;
    const upd = () => topBtn.classList.toggle('hidden', box.scrollHeight - box.clientHeight < 200 || box.scrollTop < 120 || !!$('#detached-bar'));
    box.addEventListener('scroll', upd, { passive: true }); upd();
  }, 0);
  return wrap;
}
export function renderReplyBar() {
  const bar = $('#reply-bar'); if (!bar) return;
  document.querySelectorAll('#msgs .msg.qr-target').forEach(x => { if (x.dataset.mid !== S.replyTo?.id) x.classList.remove('qr-target'); });
  if (!S.replyTo) return bar.classList.add('hidden');
  bar.classList.remove('hidden'); bar.replaceChildren(h('span', 'Respondendo a ', h('b', nameOf(S.replyTo.author_id, channelById(S.replyTo.channel_id)?.guild_id))), h('button.ibtn', { style: { width: '20px', height: '20px' }, onclick: () => { S.replyTo = null; renderReplyBar(); } }, icon('x', 14)));
}
// prévia das imagens anexadas é um blob: URL; precisa ser liberada quando o anexo sai da lista (senão o arquivo fica na memória)
const freePending = (list) => { for (const p of list) if (p.preview) { URL.revokeObjectURL(p.preview); p.preview = null; p.imgEl = null; } };
export function clearPending() { freePending(S.pending); S.pending = []; }
// fotos ficam bem mais leves antes de enviar: no máximo 2560 px no lado maior (o chat e o visualizador nunca mostram mais
// que isso), no formato moderno mais compacto que este navegador sabe GERAR. GIF (animação), SVG e arquivos já pequenos
// ficam como estão; se a versão comprimida não ficar menor, vai o original. Configurações → Aparência → "Enviar imagens no
// tamanho original" desliga.
// Formato: AVIF quando o canvas sabe codificar (uns 20–30% menor que WebP na mesma qualidade), senão WebP. Hoje nenhum
// navegador nem o Electron gera AVIF pelo canvas (o pedido volta PNG); o teste é feito uma vez e passa a valer sozinho
// quando o motor ganhar o codificador. JPEG XL não é gerado: quase ninguém do outro lado consegue abrir.
// Entrada: foto .jxl / .heic (iPhone) / .avif que ESTE aparelho consegue abrir é convertida sempre (mesmo pequena), para
// todo mundo ver; a que ele não abre vai como arquivo, do jeito que está.
const IMG_MAX = 2560, IMG_SKIP_BYTES = 200 * 1024, IMG_Q = { 'image/webp': .86, 'image/avif': .72 };
let imgOutFmt = null;
const imgOut = () => (imgOutFmt ||= new Promise((res) => {
  try { const c = document.createElement('canvas'); c.width = c.height = 2; c.toBlob(b => res(b?.type === 'image/avif' ? 'image/avif' : 'image/webp'), 'image/avif', .5); } catch { res('image/webp'); }
}));
const IMG_EXT_OF = { 'image/webp': '.webp', 'image/avif': '.avif' };
const imgKind = (file) => { const ext = (file.name.split('.').pop() || '').toLowerCase(), t = file.type;
  if (/^image\/(png|jpeg|webp|bmp)$/.test(t)) return 'photo';
  if (/^image\/(jxl|heic|heif|avif)$/.test(t) || /^(jxl|heic|heif|avif)$/.test(ext)) return 'convert'; // formato que nem todo mundo abre / já compacto
  return null; };
async function compressImage(file) {
  const kind = imgKind(file); if (S.prefs.imgOriginal || !kind) return file;
  const must = kind === 'convert' && !/\.avif$/i.test(file.name) && file.type !== 'image/avif'; // AVIF todo mundo abre: só reduz se compensar
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height));
    if (!must && k === 1 && file.size < IMG_SKIP_BYTES) { bmp.close?.(); return file; }
    const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, hh); bmp.close?.();
    const fmt = await imgOut();
    let blob = await new Promise(r => c.toBlob(r, fmt, IMG_Q[fmt]));
    if (blob?.type !== fmt && fmt !== 'image/webp') { blob = await new Promise(r => c.toBlob(r, 'image/webp', IMG_Q['image/webp'])); }
    if (!blob || !IMG_EXT_OF[blob.type] || (!must && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + IMG_EXT_OF[blob.type], { type: blob.type, lastModified: file.lastModified });
  } catch { return file; } // este aparelho não abre o formato (ex.: .jxl no Chrome): vai como está
}
export async function addFile(file) {
  { const c = channelById(S.view.cid); if (c?.guild_id && !chCan(c, CH.ATTACH)) return toast('Você não tem permissão para enviar arquivos neste canal', true); }
  // prévia na hora, do próprio arquivo escolhido (blob: local, sem esperar comprimir nem enviar). Formato que este
  // navegador não desenha (ex.: HEIC no Chrome) cai no ícone pelo onerror da imagem
  const item = { name: file.name, size: file.size, file, state: 'up', stage: 'prep', pct: 0, ctrl: new AbortController(), preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : null }, cid = S.view.cid;
  S.pending.push(item); renderPendingPrev();
  const pct = (stage) => (f) => { const p = Math.floor(f * 100); if (p !== item.pct || item.stage !== stage) { item.pct = p; item.stage = stage; renderPendingPrev(); } };
  try {
    file = await compressImage(file); Object.assign(item, { name: file.name, size: file.size, file });
    if (item.ctrl.signal.aborted) return;
    pct('up')(0);
    // vídeo acima do limite do servidor: comprime aqui antes (upload.js), em vez do "arquivo muito grande"
    const max = await maxUpload();
    if (file.size > max) {
      if (!isVideo(file)) throw new Error(`arquivo muito grande (limite de ${Math.round(max / 1048576)} MB)`);
      const before = file.size;
      try { file = await compressVideo(file, max, pct('compress')); } catch (e) { throw new Error(`vídeo maior que o limite de ${Math.round(max / 1048576)} MB e não deu para comprimir: ${e.message}`); }
      if (item.ctrl.signal.aborted) return;
      Object.assign(item, { name: file.name, size: file.size, file });
      toast(`Vídeo comprimido: ${bytes(before)} → ${bytes(file.size)}`);
    }
    let up = file;
    if (await protectFiles(cid)) { const x = await encryptFile(file); up = x.file; item.e2ee = x.meta; } // conversa protegida: sobe cifrado (public/e2ee.js)
    if (item.ctrl.signal.aborted) return;
    const r = await uploadFile(up, { onProgress: pct('up'), signal: item.ctrl.signal, onWait: (w) => { if (item.wait !== w) { item.wait = w; renderPendingPrev(); } } });
    Object.assign(item, r, item.e2ee ? { name: file.name, size: file.size } : {}, { state: 'ok' });
    if (!S.pending.includes(item)) freePending([item]); // removido (ou trocou de canal) durante o envio: solta a prévia
  } catch (e) { if (!item.ctrl.signal.aborted) toast(`Falha ao enviar ${file.name}: ${e.message}`, true); freePending([item]); S.pending = S.pending.filter(p => p !== item); }
  renderPendingPrev();
}
const upLabel = (p) => p.wait ? 'Sem conexão — continua quando voltar' : p.stage === 'prep' ? 'Preparando…' : p.stage === 'compress' ? `Comprimindo… ${p.pct || 0}%` : p.stage === 'up' && p.pct < 100 ? `Enviando… ${p.pct || 0}%` : 'Enviando…';
// a mesma <img> da prévia em todo redesenho (o progresso redesenha a lista várias vezes por segundo: criar outra imagem
// a cada vez decodificava a foto inteira de novo e piscava)
const prevImg = (p) => p.imgEl ||= h('img', { src: p.preview, alt: '', decoding: 'async', onerror: () => { freePending([p]); renderPendingPrev(); } });
function renderPendingPrev() {
  const box = $('#attach-prev'); if (!box) return;
  box.classList.toggle('hidden', !S.pending.length);
  // olho: marca o anexo como spoiler (borrado para todos até clicarem; mediasafe.js)
  box.replaceChildren(...S.pending.map(p => h('div.prev-item' + (p.spoiler ? '.spoil' : ''), p.preview ? prevImg(p) : icon('file', 40),
    h('button.pv-spoil' + (p.spoiler ? '.on' : ''), { type: 'button', title: p.spoiler ? 'Tirar o spoiler' : 'Marcar como spoiler', 'aria-label': p.spoiler ? 'Tirar o spoiler' : 'Marcar como spoiler', 'aria-pressed': String(!!p.spoiler), onclick: () => { p.spoiler = !p.spoiler; renderPendingPrev(); } }, icon(p.spoiler ? 'eyeoff' : 'eye', 14)),
    p.preview && !p.e2ee && h('button.pv-alt' + (p.alt ? '.on' : ''), { type: 'button', title: p.alt ? 'Texto alternativo: ' + p.alt : 'Adicionar texto alternativo (descrição para quem usa leitor de tela)', 'aria-label': p.alt ? 'Editar texto alternativo' : 'Adicionar texto alternativo', onclick: async () => { const v = await promptBox('Texto alternativo', 'Descreva a imagem para quem não consegue vê-la (leitores de tela leem este texto)', p.alt || '', 'Salvar'); if (v == null) return; p.alt = v.trim().slice(0, 1000); renderPendingPrev(); } }, 'ALT'), h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name), p.state === 'up' && h('div.up-st' + (p.wait ? '.wait' : ''), upLabel(p), p.stage && h('i.up-bar', { style: { width: (p.pct || 0) + '%' } })),
    h('button.x', { onclick: () => { p.ctrl?.abort(); freePending([p]); S.pending = S.pending.filter(x => x !== p); renderPendingPrev(); } }, icon('x', 14)))));
}
export const renderPending = () => { };
// mídia favorita (mediafavs.js): arquivo daqui vai como anexo (o mesmo arquivo, sem subir de novo); link vai como link
async function sendFavMedia(ch, it) {
  if (!it.url.startsWith('/files/')) return sendGif(ch, it.url);
  if (!chCan(ch, CH.ATTACH)) return toast('Você não tem permissão para enviar arquivos aqui', true);
  const body = { content: '', reply_to: S.replyTo?.id, attachments: [{ url: it.url, name: it.name || 'arquivo', size: it.size || 0, type: it.type || '' }] };
  S.replyTo = null; renderReplyBar();
  try { await api('POST', `/channels/${ch.id}/messages`, body); } catch (e) { toast(e.message, true); }
}
// GIF escolhido no seletor: vai como o próprio link (respeita a resposta em andamento)
async function sendGif(ch, url) {
  const body = { content: url, reply_to: S.replyTo?.id };
  S.replyTo = null; renderReplyBar();
  try { await api('POST', `/channels/${ch.id}/messages`, body); } catch (e) { toast(e.message, true); }
}
// mensagem otimista: mostrada antes da resposta do servidor (no celular/VPN a ida e volta leva 150-300 ms). Fica só na
// tela (não entra em S.messages); sai quando a MESSAGE_CREATE minha com o mesmo texto chega, quando o envio responde
// ou quando falha. Comandos (/…) ficam de fora: o servidor pode transformar o texto.
const ghosts = []; // { cid, content, el }
function optimistic(cid, body) {
  const box = $('#msgs'), list = S.messages.get(cid);
  if (!box || S.view.cid !== cid || !list || /^\//.test(body.content || '')) return null;
  const prev = list[list.length - 1], m = { id: 'tmp-' + Date.now(), channel_id: cid, author_id: S.me.id, author: S.me, content: body.content, created_at: Date.now(),
    attachments: body.attachments || [], reactions: [], reply_to: body.reply_to || null };
  const el = msgEl(m, prev && prev.author_id === S.me.id && sameDay(prev.created_at, m.created_at) ? prev : null);
  el.classList.add('sending'); el.removeAttribute('data-mid'); el.querySelector('.toolbar')?.remove();
  freePostTop(); // comentou: segue o fim, como num chat
  box.append(el); box.stick = true; box.scrollTop = box.scrollHeight;
  const g = { cid, content: body.content, el }; ghosts.push(g); return g;
}
function dropGhost(g) { if (!g) return; g.el.remove(); const i = ghosts.indexOf(g); if (i >= 0) ghosts.splice(i, 1); }
// a minha mensagem chegou pelo servidor: tira a "enviando" correspondente antes de mostrar a definitiva
export function ghostFor(m) { if (m.author_id !== S.me.id) return; const g = ghosts.find(x => x.cid === m.channel_id && x.content === m.content); if (g) dropGhost(g); }
async function sendMsg(ta, ch) {
  let content = ta.value; const atts = S.pending.filter(p => p.state === 'ok');
  if (S.pending.some(p => p.state === 'up')) return toast('Aguarde o envio dos anexos…');
  if (!content.trim() && !atts.length) return;
  const typed = content; content = resolveMentions(ta, content);
  if (S.prefs.cleanLinks !== false) content = cleanLinks(content); // tira utm_*, fbclid, si=… dos links
  if (/^\$[a-z]{2,3}(-[A-Z]{2})?\s/.test(content)) {
    try { const t = await translateOutgoing(content); if (t) content = t; } catch (e) { return toast('Não foi possível traduzir: ' + e.message, true); }
  }
  ta.value = ''; clearTimeout(ta._dt); saveDraft(ch.id, ''); $('.ac')?.remove();
  const body = { content, reply_to: S.replyTo?.id, attachments: atts.map(({ url, name, size, type, e2ee, spoiler, vc, alt }) => ({ url, name, size, type, ...(vc ? { vc } : {}), ...(spoiler ? { spoiler: true } : {}), ...(alt && !e2ee ? { alt } : {}), ...(e2ee ? { _e2ee: e2ee } : {}) })) };
  const sent = S.pending; S.replyTo = null; S.pending = []; renderReplyBar(); renderPendingPrev();
  const ghost = optimistic(ch.id, body); // aparece na hora, "enviando"; a definitiva entra quando o servidor confirma
  try {
    const t0 = performance.now(), r = await api('POST', `/channels/${ch.id}/messages`, body); freePending(sent); dropGhost(ghost);
    timing('msg_send', performance.now() - t0); // telemetria: do Enter até o servidor confirmar
    if (r?.slow_wait && ch.guild_id) { (S.slowUntil ||= {})[ch.guild_id] = Date.now() + r.slow_wait * 1000; renderSoftmute(); } // limitado: mostra quando pode mandar a próxima
  }
  catch (e) { // falhou: devolve o texto e os anexos (antes os anexos sumiam)
    dropGhost(ghost); toast(e.message, true); ta.value = typed; saveDraft(ch.id, typed);
    if (e.data?.softmute && ch.guild_id) { (S.slowUntil ||= {})[ch.guild_id] = Date.now() + e.data.retry_after * 1000; renderSoftmute(); }
    if (S.view.cid === ch.id) { S.pending = [...sent, ...S.pending]; renderPendingPrev(); } else freePending(sent);
  }
}
function autocomplete(ta) {
  $('.ac')?.remove();
  const before = ta.value.slice(0, ta.selectionStart), m = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  const em = before.match(/(?:^|\s):([a-z0-9_]{2,})$/i);
  if (em) {
    const q = em[1].toLowerCase();
    const list = [...allEmojis().filter(e => e.name.toLowerCase().includes(q)).map(e => ({ label: e.name, node: h('img', { src: e.url, style: { width: '24px', height: '24px', objectFit: 'contain' } }), ins: `<:${e.name}:${e.id}> ` })),
      ...Object.entries(SHORT).filter(([k]) => k.startsWith(q)).map(([k, v]) => ({ label: k, node: h('span', { style: { fontSize: '22px' } }, v), ins: v + ' ' }))].slice(0, 10);
    if (!list.length) return;
    const box = h('div.ac', list.map((x, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => { e.preventDefault?.(); ta.setRangeText(x.ins, ta.selectionStart - em[1].length - 1, ta.selectionStart, 'end'); box.remove(); ta.focus(); } }, x.node, h('b', ':' + x.label + ':'))));
    return $('#chat').append(box);
  }
  if (!m) return;
  const ch = channelById(S.view.cid), q = m[1].toLowerCase();
  const pool = ch.guild_id ? [...guild(ch.guild_id).members.keys()] : ch.recipients.map(r => r.id);
  const found = pool.map(id => user(id)).filter(u => u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q)).slice(0, 8);
  const extra = 'everyone'.startsWith(q) && ch.guild_id ? [{ id: 'everyone', display_name: '@everyone', username: 'Notifica todos' }] : [];
  // cargos do servidor (menos @everyone): marca todo mundo que tem o cargo
  const g = ch.guild_id && guild(ch.guild_id);
  const roles = g ? g.roles.filter(r => r.name && r.name !== '@everyone' && r.name.toLowerCase().includes(q)).slice(0, 5).map(r => {
    const n = [...g.members.values()].filter(mm => mm.roles?.includes(r.id)).length;
    return { id: '&' + r.id, role: r, display_name: r.name, username: `Cargo · ${n} ${n === 1 ? 'pessoa' : 'pessoas'}` };
  }) : [];
  const all = [...extra, ...found, ...roles]; if (!all.length) return;
  const box = h('div.ac', all.map((u, i) => h('div.it' + (i ? '' : '.sel'), { onmousedown: (e) => {
    e.preventDefault?.(); const start = ta.selectionStart - m[1].length - 1, ins = u.id === 'everyone' ? '@everyone ' : `@${u.display_name} `; if (u.id !== 'everyone') addMention(ta, u.display_name, u.id);
    ta.setRangeText(ins, start, ta.selectionStart, 'end'); box.remove(); ta.focus();
  } }, u.role ? h('span.ac-role', { style: { background: u.role.color && u.role.color !== '#99aab5' ? u.role.color : 'var(--brand)' } }, '@') : u.id !== 'everyone' && avatar(u, 24, { status: false }), h('b', u.display_name), h('small', u.username))));
  $('#chat').append(box);
}
export function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const m = S.typing.get(S.view.cid), now = Date.now();
  const ids = m ? [...m].filter(([, t]) => t > now).map(([u]) => u) : [];
  const names = ids.map(u => nameOf(u, S.view.gid));
  const txt = names.length > 3 ? 'Várias pessoas estão digitando…' : names.join(', ') + (names.length > 1 ? ' estão digitando…' : ' está digitando…');
  // rostos empilhados de quem escreve (até 4) + os pontinhos; o texto fica no title e para leitor de tela
  el.title = names.length ? txt : '';
  el.replaceChildren(...(names.length ? [
    h('span.typing-faces', { 'aria-hidden': 'true' }, ids.slice(0, 4).map(u => avatar(user(u), 20, { status: false })), ids.length > 4 && h('span.typing-more', '+' + (ids.length - 4))),
    h('span.dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('span.sr-only', txt)] : []));
}
