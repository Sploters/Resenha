// Ações em mensagens: encaminhar, menu da mensagem, spoiler, editar, responder e pular até uma mensagem.
import { pearlMenuItem } from './nights.js';
import { isGifMessage, toggleFav as toggleGifFav, isFav as isGifFav } from './gifs.js';
import { favMenuItems } from './mediafavs.js';
import { undoImportModal } from './importer.js';
import { h, icon, avatar, sameDay, imgUrl, cleanLinks } from './util.js';
import { S, api, tryApi, user, channelById, can, PERM, toast, modal, confirmBox, menu, emojiPicker, savePrefs, CH, chCan, isChatCh } from './state.js';
import { chName } from './chnames.js';
import { flaggedMap, flagMessage, unflagMessage } from './mod.js';
import { mentionUser } from './plugins.js';
import { toggleTranslation, isTranslated } from './translate.js';
import { $, mergeUser, detached } from './gateway.js';
import { guildChOrder } from './gsearch.js';
import { chIcon } from './side.js';
import { loadChannel, renderMessages, msgEl } from './chat.js';
import { renderReplyBar } from './composer.js';
// ---------- encaminhar mensagem ----------
// copia o texto e os anexos (os mesmos arquivos, sem subir de novo) para até 5 conversas/canais, com um recado opcional
// mandado logo depois. Vai pelo envio normal: numa DM protegida, o app cifra como qualquer mensagem. Protegidas, enquetes
// e eventos não são encaminhados; a encaminhada não marca ninguém de novo.
const canForward = (m) => m.type !== 1 && !m.poll && !m.event && !m.e2ee && !(m.attachments || []).some(a => a.enc || a.e2ee || a.expired) && !!(m.content || m.attachments?.length);
const idCmp = (a = '', b = '') => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
function forwardModal(m) {
  const hasAtt = !!m.attachments?.length, dests = [];
  for (const dm of [...S.dms.values()].sort((a, b) => idCmp(b.last_message?.id || b.id, a.last_message?.id || a.id))) {
    const others = dm.recipients.filter(r => r.id !== S.me.id), u = others[0] && user(others[0].id);
    const label = dm.type === 1 ? (u?.display_name || 'Conversa') : (dm.name || others.map(r => user(r.id).display_name).join(', ') || 'Grupo');
    dests.push({ id: dm.id, label, sub: dm.type === 1 ? '@' + (u?.username || '') : 'Grupo', av: dm.type === 1 && u ? avatar(u, 28, { status: false }) : h('span.fwd-ic', icon('dm', 16)) });
  }
  for (const g of S.guilds.values()) for (const c of guildChOrder(g)) if ((isChatCh(c) || c.type === 2) && chCan(c, CH.SEND) && (!hasAtt || chCan(c, CH.ATTACH)))
    dests.push({ id: c.id, label: (c.type === 2 ? '' : '#') + chName(c), sub: g.name, av: h('span.fwd-ic', chIcon(c)) });
  const picked = new Set(), q = h('input', { type: 'search', placeholder: 'Buscar conversas e canais', autocomplete: 'off' }), list = h('div.fwd-list'), note = h('input', { placeholder: 'Recado (opcional)', maxLength: 2000 });
  const count = h('small.mut');
  const draw = () => {
    const t = q.value.trim().toLowerCase(), rows = dests.filter(d => !t || d.label.toLowerCase().includes(t) || d.sub.toLowerCase().includes(t)).slice(0, 60);
    list.replaceChildren(...(rows.length ? rows.map(d => h('label.fwd-row' + (picked.has(d.id) ? '.on' : ''), d.av, h('span.fwd-t', h('b', d.label), h('small', d.sub)),
      h('input', { type: 'checkbox', checked: picked.has(d.id), disabled: !picked.has(d.id) && picked.size >= 5, onchange: (e) => { e.target.checked ? picked.add(d.id) : picked.delete(d.id); draw(); } }))) : [h('div.dm-empty', 'Nada encontrado')]));
    count.textContent = picked.size ? `${picked.size} de 5 escolhidos` : 'Escolha até 5';
  };
  q.addEventListener('input', draw); draw();
  const preview = h('div.fwd-prev', icon('arrowr', 14), h('span', (m.content || '').replace(/<@&?\d+>/g, '@…').slice(0, 140) || (m.attachments.length === 1 ? m.attachments[0].name : `${m.attachments.length} anexos`)));
  modal('Encaminhar mensagem', null, h('div.fwd', preview, q, list, count, h('label.f', 'Recado', note)),
    [{ label: 'Cancelar', cls: 'link' }, { label: 'Encaminhar', fn: async () => {
      if (!picked.size) { toast('Escolha para onde encaminhar', true); return false; }
      const body = { content: m.content || '', forward: { channel_id: m.channel_id, message_id: m.id },
        attachments: (m.attachments || []).map(({ url, name, size, type, vc, voice, duration, waveform }) => ({ url, name, size, type, ...(vc ? { vc } : {}), ...(voice ? { voice, duration, waveform } : {}) })) };
      let ok = 0;
      for (const cid of picked) {
        try { await api('POST', `/channels/${cid}/messages`, body); ok++; if (note.value.trim()) await api('POST', `/channels/${cid}/messages`, { content: note.value.trim() }); }
        catch (e) { const d = dests.find(x => x.id === cid); toast(`${d?.label || 'Destino'}: ${e.message}`, true); }
      }
      if (ok) toast(ok === 1 ? 'Mensagem encaminhada' : `Encaminhada para ${ok} lugares`);
    } }]);
}
export function msgMenu(e, m) {
  const ch = channelById(m.channel_id), gid = ch.guild_id, mine = m.author_id === S.me.id, mod = gid && can(gid, PERM.MANAGE_MESSAGES) || (!gid && false);
  menu(e, [
    { label: 'Adicionar reação', fn: () => emojiPicker(document.querySelector(`[data-mid="${m.id}"]`) || document.body, (em) => react(m, em, true)) },
    { label: 'Responder', fn: () => setReply(m) },
    !mine && { label: 'Mencionar', fn: () => mentionUser(m.author_id) },
    m.content && { label: 'Copiar texto', fn: () => navigator.clipboard?.writeText(m.content) },
    pearlMenuItem(m, gid),
    canForward(m) && { label: 'Encaminhar', hint: 'Para outras conversas e canais', fn: () => forwardModal(m) },
    ...favMenuItems(m),
    isGifMessage(m.content) && { label: isGifFav(m.content.trim()) ? 'Tirar GIF dos favoritos' : 'Favoritar GIF', fn: () => toggleGifFav({ url: m.content.trim(), preview: m.content.trim() }).then(() => renderMessages(true)) },
    m.content && !m.e2ee && { label: isTranslated(m) ? 'Mostrar original' : 'Traduzir', fn: () => toggleTranslation(m, refreshMsg) }, // protegida: traduzir mandaria o texto para fora
    mine && !m.poll && !m.event && { label: 'Editar mensagem', fn: () => { S.editing = m.id; renderMessages(true); } },
    (mod || !gid) && { label: m.pinned ? 'Desafixar mensagem' : 'Fixar mensagem', fn: () => tryApi(m.pinned ? 'DELETE' : 'PUT', `/channels/${m.channel_id}/pins/${m.id}`) },
    ...(m.type === 1 ? [] : spoilerItems(m, mine, mod)),
    m.imported && { label: 'Importações do Discord…', hint: 'Ver ou desfazer', fn: () => undoImportModal(ch) },
    S.prefs.devMode && { label: 'Copiar ID da mensagem', fn: () => navigator.clipboard?.writeText(m.id) },
    // reputação: sinal da comunidade (esconde para mim; várias pessoas em pouco tempo limitam o envio do autor)
    gid && !mine && m.type !== 1 && '-',
    ...(!gid || mine || m.type === 1 ? [] : flaggedMap.has(m.id) ? [{ label: 'Desfazer marcação', fn: () => unflagMessage(m, () => { delete m._show; refreshMsg(m); }) }]
      : [{ label: 'Marcar como spam', fn: () => flagMessage(m, 'spam', () => refreshMsg(m)) }, { label: 'Denunciar como ofensiva', danger: true, fn: () => flagMessage(m, 'toxic', () => refreshMsg(m)) }]),
    (mine || mod) && '-',
    (mine || mod) && { label: 'Apagar mensagem', danger: true, fn: async () => { if (await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); } },
  ]);
}
// ---------- spoiler em mensagens (inclusive de outras pessoas) ----------
// para todos: o autor ou um moderador marca (servidor guarda; m.spoiler). Só para mim: fica nas preferências da conta
// (vale em todos os aparelhos), útil numa conversa direta ou quando não sou moderador.
const mySpoilers = () => (S.prefs.mySpoilers ||= {});
export const spoiled = (m) => !!(m.spoiler || mySpoilers()[m.id]);
export const spoilShown = new Set(); // revelados nesta sessão (clicou para ver)
function setMySpoiler(m, on) {
  const all = mySpoilers();
  if (on) { all[m.id] = Date.now(); const ks = Object.keys(all); if (ks.length > 500) ks.sort((a, b) => all[a] - all[b]).slice(0, ks.length - 500).forEach(k => delete all[k]); } // guarda as 500 mais recentes
  else delete all[m.id];
  spoilShown.delete(m.id); savePrefs(); refreshMsg(m);
}
export function coverSpoiler(el, from, m) {
  const parts = [...el.childNodes].slice(from); if (!parts.length) return;
  const who = m.spoiler ? (m.spoiler_by_mod ? 'Marcado como spoiler por um moderador' : 'Spoiler') : 'Você marcou como spoiler';
  const box = h('div.mspoil', { role: 'button', tabIndex: 0, title: 'Clique para ver', onclick: () => { spoilShown.add(m.id); refreshMsg(m); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
    h('div.mspoil-in', { 'aria-hidden': 'true', inert: '' }, ...parts), h('span.mspoil-tag', icon('eye', 16), h('b', 'SPOILER'), h('small', who)));
  el.append(box);
}
function spoilerItems(m, mine, mod) {
  const forAll = mine || mod, ours = !!mySpoilers()[m.id];
  return [
    forAll && (m.spoiler ? { label: 'Tirar spoiler para todos', fn: () => tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/spoiler`) }
      : { label: 'Marcar como spoiler para todos', hint: mine ? 'Esconde o texto e os anexos até clicarem' : 'Como moderador: esconde para todo o servidor, sem apagar', fn: () => tryApi('PUT', `/channels/${m.channel_id}/messages/${m.id}/spoiler`) }),
    !m.spoiler && !mine && (ours ? { label: 'Tirar spoiler (só para mim)', fn: () => setMySpoiler(m, false) }
      : { label: 'Marcar como spoiler só para mim', hint: 'Ninguém mais vê a diferença', fn: () => setMySpoiler(m, true) }),
    spoiled(m) && spoilShown.has(m.id) && { label: 'Esconder de novo', fn: () => { spoilShown.delete(m.id); refreshMsg(m); } },
  ];
}
// redesenha uma única mensagem (por ex. depois de traduzir)
export function refreshMsg(m) {
  const list = S.messages.get(m.channel_id), i = list?.findIndex(x => x.id === m.id), el = document.querySelector(`[data-mid="${m.id}"]`);
  if (i >= 0 && el) el.replaceWith(msgEl(m, list[i - 1] && sameDay(list[i - 1].created_at, m.created_at) ? list[i - 1] : null));
}
export const react = (m, emoji, add) => tryApi(add ? 'PUT' : 'DELETE', `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
export async function saveEdit(m, text) {
  if (!text.trim()) return;
  if (S.prefs.cleanLinks !== false) text = cleanLinks(text);
  S.editing = null; if (text !== m.content) await tryApi('PATCH', `/channels/${m.channel_id}/messages/${m.id}`, { content: text });
  renderMessages(true);
}
export function setReply(m) { S.replyTo = m; renderReplyBar(); $('#composer textarea')?.focus(); }
// Ctrl+↑ / Ctrl+↓ no campo: escolhe a mensagem a responder sem tirar a mão do teclado (passar da última cancela)
export function quickReply(ch, dir) {
  const list = (S.messages.get(ch.id) || []).filter(m => m.type !== 1 && !String(m.id).startsWith('tmp-') && m.channel_id === ch.id);
  if (!list.length) return;
  const cur = S.replyTo ? list.findIndex(x => x.id === S.replyTo.id) : -1;
  const n = (cur < 0 ? list.length : cur) + dir;
  document.querySelectorAll('#msgs .msg.qr-target').forEach(x => x.classList.remove('qr-target'));
  if (n >= list.length) { S.replyTo = null; renderReplyBar(); return; }
  const m = list[Math.max(0, n)]; setReply(m);
  const el = document.querySelector(`#msgs [data-mid="${m.id}"]`);
  if (el) { el.classList.add('qr-target'); el.scrollIntoView({ block: 'nearest' }); }
}
// duplo clique numa mensagem: a sua abre a edição, a dos outros vira resposta (links, mídia, botões e reações ficam de fora)
export function msgDblClick(e, m) {
  if (S.prefs.dblClickMsg === false || String(m.id).startsWith('tmp-') || typeof m.e2ee === 'string') return;
  if (e.target.closest('a, button, img, video, audio, canvas, textarea, input, select, .reactions, .react, .spoiler, .fsvid, .mention, .author, .av, .reply-ref, .md-pre, .md-code, .edit-box, [contenteditable]')) return;
  if (S.editing === m.id) return;
  getSelection()?.removeAllRanges(); // o duplo clique selecionava uma palavra
  if (m.author_id === S.me.id && m.content) { S.editing = m.id; renderMessages(true); }
  else if ($('#composer textarea')) setReply(m);
}
export async function jumpTo(mid) {
  let el = document.querySelector(`[data-mid="${mid}"]`);
  if (!el) {
    const cid = S.view.cid; // a resposta pode chegar depois de trocar de canal: não guarda as mensagens no canal errado
    const list = await tryApi('GET', `/channels/${cid}/messages?around=${mid}`); if (!list || S.view.cid !== cid) return;
    list.forEach(m => mergeUser(m.author));
    S.messages.set(cid, list); S.loaded.set(cid, false); renderMessages(false); el = document.querySelector(`[data-mid="${mid}"]`);
  }
  if (el) { $('#msgs').stick = false; el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2000); }
}
export async function jumpToTop() {
  const cid = S.view.cid; if (!cid) return;
  const list = await tryApi('GET', `/channels/${cid}/messages?oldest=1&limit=50`); if (!list || S.view.cid !== cid) return;
  list.forEach(m => mergeUser(m.author));
  S.messages.set(cid, list); S.loaded.set(cid, true); $('#detached-bar')?.remove();
  renderMessages(false); const box = $('#msgs'); box.stick = false; box.scrollTop = 0;
  if (list.length >= 50) {
    detached.add(cid); detachedBar(cid, 'Você está vendo o início do canal');
  }
}
export function detachedBar(cid, text) {
  if ($('#detached-bar')) return;
  $('#chat')?.append(h('div#detached-bar', h('span', text), h('button.btn', { onclick: () => { $('#detached-bar')?.remove(); loadChannel(cid); } }, 'Ir para o presente')));
}
export function mentionAvatar(u) {
  return u.avatar ? h('img.mav', { src: imgUrl(u.avatar, 20), alt: '', loading: 'lazy' }) : h('span.mav.mini', { style: { background: u.color || '#5865f2' } }, (u.display_name || u.username || '?')[0].toUpperCase());
}
