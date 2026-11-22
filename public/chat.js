// Mensagens do canal: carregar, desenhar, histórico em janela (corte do topo e do fim) e o elemento de cada mensagem.
import { gifEl, isGifMessage } from './gifs.js';
import { coverMedia, coverReason, freezeGif, isGifName } from './mediasafe.js';
import { undoImportModal } from './importer.js';
import { socialCard } from './media.js';
import { steamCard, steamApp } from './steamcard.js';
import { eventCard } from './events.js';
import { h, icon, avatar, md, stamp, clock, dayLabel, sameDay, onlyEmoji, isImageUrl, inviteCodes, callCodes, stripInvites, clipLinkIds, stripClipLinks, inviteText, skeleton, plainTs } from './util.js';
import { S, tryApi, user, guild, channelById, nameOf, roleColor, can, PERM, dmPeer, emojiPicker, lightbox, emojiUrl, roleDot } from './state.js';
import { chName } from './chnames.js';
import { pollCard } from './polls.js';
import { track, stopTimer } from './ux.js';
import { postHead } from './forum.js';
import { callCard } from './callinvite.js';
import { THEME_CODE_RE, decodeTheme, styleName, stripThemeCodes, themeText } from './themes.js';
import { flaggedMap } from './mod.js';
import { translationBlock } from './translate.js';
import { unlockModal } from './e2ee.js';
import { voice, $, deferRender, mergeUser, detached, arriving } from './gateway.js';
import { ack } from './unread.js';
import { go } from './nav.js';
import { renderSide, shortWhen } from './side.js';
import { profile, userMenu } from './usermenu.js';
import { renderHomeIfHome, postTop, renderMain } from './mainview.js';
import { impColor, deleteMenu, inviteCard, themeCard, reactionFace, appendAttachments, clipEmbed } from './msgcards.js';
import { msgMenu, spoiled, spoilShown, coverSpoiler, refreshMsg, react, saveEdit, setReply, msgDblClick, jumpTo, detachedBar, mentionAvatar } from './msgactions.js';
import { renderPending, renderTyping } from './composer.js';
import { renderMembers } from './members.js';
// ---------- mensagens ----------
// Canal aberto depois de reconectar: pede as mais novas. Se o que estava na tela já era o fim do canal, a lista nova
// substitui (pega também edições e apagadas do meio-tempo); se a pessoa estava lendo mais acima, entram só as novas.
export async function catchUp(cid) {
  const cur = S.messages.get(cid); if (!cur || detached.has(cid)) return; // lendo mensagens antigas: as novas vêm ao rolar até o fim
  const after = (a, b) => a.length !== b.length ? a.length > b.length : a > b; // ids são números grandes em texto
  const last = cur.at(-1)?.id;
  const fresh = await tryApi('GET', `/channels/${cid}/messages?limit=50`); if (!fresh || S.messages.get(cid) !== cur) return;
  fresh.forEach(m => mergeUser(m.author));
  const box = $('#msgs'), atEnd = !box || box.stick !== false, overlap = !last || fresh.some(m => m.id === last) || fresh.length < 50;
  if (!overlap) { S.messages.delete(cid); S.loaded.delete(cid); if (S.view.cid === cid) loadChannel(cid); return; } // mais de 50 novas: recomeça do fim
  if (atEnd || !fresh.length) cur.splice(0, cur.length, ...cur.filter(m => fresh.length && after(fresh[0].id, m.id)), ...fresh);
  else for (const m of fresh) if (after(m.id, last)) cur.push(m);
  if (S.view.cid === cid) renderMessages(true);
}
// troca de canal que passou de 1 s: onde foi o tempo (servidor, montar as mensagens ou esperando outra coisa — a página
// ocupada com outra tarefa) e o que estava acontecendo (chamada, transmitindo, assistindo, conversa protegida). Só rótulos fixos.
function slowSwitch(ms, netMs, drawMs, cid) {
  const where = netMs > ms / 2 ? 'rede' : drawMs > ms / 2 ? 'desenho' : 'espera', ctx = [];
  if (voice?.channelId) ctx.push('chamada');
  if (voice?.screen) ctx.push('transmitindo');
  if ([...(voice?.peers?.values() || [])].some(p => p.streams?.screen)) ctx.push('assistindo');
  if (S.messages.get(cid)?.some(m => m.e2ee === true)) ctx.push('cripto');
  track('slow_switch', where + (ctx.length ? ':' + ctx.join('+') : ''));
}
export async function loadChannel(cid) {
  const box = $('#msgs');
  if (detached.delete(cid)) { S.messages.delete(cid); S.loaded.delete(cid); }
  // voltando a um chat lido para trás (até 300 guardadas): abre no fim, então monta só as 50 mais novas. As outras voltam
  // do servidor ao rolar para cima (~4 ms cada página). Antes eram montadas todas (300 mensagens = quadro de ~1 s na CPU 4x)
  const cached = S.messages.get(cid);
  if (cached) { S.messages.delete(cid); S.messages.set(cid, cached); } // vai para o fim: os abertos há mais tempo saem primeiro (pruneCachedChannels)
  if (cached && cached.length > OPEN_KEEP + 30) { cached.splice(0, cached.length - OPEN_KEEP); S.loaded.set(cid, false); }
  let netMs = 0; // telemetria: quanto da troca foi esperando o servidor
  if (!S.messages.has(cid)) {
    // conversa direta: o início dela (avatar grande e nome) costuma estar à vista, com poucas mensagens embaixo
    const dmSk = channelById(cid)?.type === 1;
    box.replaceChildren(dmSk ? h('div.skeleton.sk-msgs.sk-dm', h('div.sk-welcome', h('i.sk-av.big'), h('i.sk-bar.sk-wname')), ...skeleton('msgs', 4).children) : skeleton('msgs', 9));
    // mensagens que chegam ao vivo enquanto a lista vem do servidor: sem lista ainda, onMessage as descartava, e a resposta
    // (montada antes delas) também não as trazia. Sumiam até reabrir o canal. Agora ficam guardadas e entram no fim.
    const early = []; arriving.set(cid, early);
    const tf = performance.now(), list = await tryApi('GET', `/channels/${cid}/messages?limit=50`); netMs = performance.now() - tf;
    if (arriving.get(cid) === early) arriving.delete(cid);
    if (!list) return;
    if (S.messages.has(cid)) return loadChannel(cid); // outra carga do mesmo canal terminou antes: usa a dela
    const last = list[list.length - 1]?.id, newer = (a, b) => a.length !== b.length ? a.length > b.length : a > b; // ids numéricos em texto
    for (const m of early) if ((!last || newer(m.id, last)) && !list.some(x => x.id === m.id)) list.push(m);
    list.forEach(m => mergeUser(m.author));
    S.messages.set(cid, list); S.loaded.set(cid, list.length < 50);
  }
  if (S.view.cid !== cid) return;
  const tr = performance.now(); renderMessages(false); ack(cid); renderTyping(); const drawMs = performance.now() - tr;
  requestAnimationFrame(() => { const ms = stopTimer('channel_switch', cid); if (ms > 1000) slowSwitch(ms, netMs, drawMs, cid); }); // telemetria: do clique até as mensagens na tela
  const msgs = $('#msgs');
  msgs.onscroll = async () => {
    if (detached.has(cid) && !msgs.dataset.loading && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80) {
      msgs.dataset.loading = 1; const cur = S.messages.get(cid), newer = await tryApi('GET', `/channels/${cid}/messages?limit=50&after=${cur[cur.length - 1]?.id}`); delete msgs.dataset.loading;
      if (S.messages.get(cid) !== cur || S.view.cid !== cid || !msgs.isConnected) return; // trocou de canal ou a lista foi refeita no meio
      if (newer?.length) { newer.forEach(x => mergeUser(x.author)); cur.push(...newer); keepAnchor(msgs, () => { if (cur.length > HIST_MAX) { cur.splice(0, cur.length - HIST_KEEP); S.loaded.set(cid, false); } renderMessages(true); }); }
      if (newer && newer.length < 50) { detached.delete(cid); $('#detached-bar')?.remove(); }
      return;
    }
    if (msgs.scrollTop > 40 || S.loaded.get(cid) || msgs.dataset.loading) return;
    msgs.dataset.loading = 1;
    const list = S.messages.get(cid), older = await tryApi('GET', `/channels/${cid}/messages?limit=50&before=${list[0]?.id}`);
    delete msgs.dataset.loading; if (!older) return;
    if (S.messages.get(cid) !== list) return; // a lista foi refeita no meio (pulo para uma mensagem, início do canal)
    if (S.view.cid !== cid || !msgs.isConnected) { if (older.length < 50) S.loaded.set(cid, true); list.unshift(...older); return; } // guarda; desenha quando voltar
    if (older.length < 50) S.loaded.set(cid, true);
    list.unshift(...older); const prevH = msgs.scrollHeight;
    if (!prependMessages(cid, older)) renderMessages(false);
    msgs.scrollTop = msgs.scrollHeight - prevH;
    if (list.length > HIST_MAX) dropNewest(cid);
  };
}
function welcomeBlock(ch) {
  if (ch.type === 11) return postHead(ch); // post de fórum: o post inteiro no topo dos comentários
  if (ch.type === 1) { const p = user(dmPeer(ch).id); return h('div.welcome', avatar(p, 80, { status: false }), h('h1', p.display_name), h('p', `Este é o início do seu histórico de mensagens diretas com ${p.display_name}.`)); }
  // texto próprio do Resenha (antes era a frase do Discord traduzida); sala de voz não leva '#'
  if (ch.type === 2) return h('div.welcome', h('div.big', icon('voice', 40)), h('h1', `Chat da sala ${chName(ch)}`), h('p', 'Links e recados para quem está na call.'));
  return h('div.welcome', h('div.big', icon('hash', 40)), h('h1', `#${chName(ch)}`), h('p', 'Primeira mensagem do canal. Manda aí.'));
}
// linha fina que liga as mensagens seguidas do mesmo autor: marca com classe quem tem uma .cont logo depois (.tnext) em
// vez de .msg.first:has(+ .msg.cont) no CSS, que o navegador reavaliava a cada recálculo de estilo do chat (~26 ms
// no teste com a CPU 4x mais lenta). Um observador no #msgs remarca só os vizinhos do que entrou ou saiu.
const isCont = (el) => !!(el?.classList?.contains('cont') && el.classList.contains('msg'));
function threadMark(el) { if (el?.classList?.contains('msg')) { const n = isCont(el.nextElementSibling); if (el.classList.contains('tnext') !== n) el.classList.toggle('tnext', n); } }
export function threadWatch(box) {
  new MutationObserver((recs) => {
    const touched = new Set();
    for (const r of recs) {
      if (r.addedNodes.length > 40) { for (const el of box.children) threadMark(el); return; } // montou o chat inteiro
      touched.add(r.previousSibling?.nodeType === 1 ? r.previousSibling : r.previousSibling?.previousElementSibling);
      for (const n of r.addedNodes) if (n.nodeType === 1) { touched.add(n); touched.add(n.previousElementSibling); }
    }
    for (const el of touched) threadMark(el);
  }).observe(box, { childList: true });
  // .rolando enquanto a PESSOA rola (e 1,2 s depois): a data grudada no topo só aparece nesse tempo (ux.css .daysep). A
  // rolagem que o próprio app faz (descer até o fim ao abrir, imagem carregando) não conta: só a que vem logo depois de
  // roda do mouse, toque, tecla ou clique na barra. Só troca a classe no começo e no fim, não a cada evento
  let idle = 0, intent = -Infinity;
  const mark = () => { intent = performance.now(); };
  for (const ev of ['wheel', 'touchmove', 'keydown', 'pointerdown']) box.addEventListener(ev, mark, { passive: true });
  box.addEventListener('scroll', () => {
    if (performance.now() - intent > 1500) return;
    if (!box.classList.contains('rolando')) box.classList.add('rolando', 'rolou'); // .rolou: a data grudada só ganha o fade depois da 1ª rolagem
    clearTimeout(idle); idle = setTimeout(() => box.classList.remove('rolando'), 1200);
  }, { passive: true });
  return box;
}
export function renderMessages(keepPos) {
  const box = $('#msgs'); if (!box) return;
  const ch = channelById(S.view.cid), list = S.messages.get(ch.id) || [];
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120, old = box.scrollTop;
  // monta tudo fora da página e entra de uma vez (antes: um append por mensagem direto no chat)
  const frag = document.createDocumentFragment(); frag.append(h('div.grow')); if (S.loaded.get(ch.id)) frag.append(welcomeBlock(ch));
  let prev = null;
  for (const m of list) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) frag.append(h('div.daysep', h('span', dayLabel(m.created_at))));
    frag.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null)); prev = m;
  }
  box.replaceChildren(frag);
  if (S.pending.length) renderPending();
  box.stick = !(keepPos && !near);
  box.scrollTop = box.stick ? box.scrollHeight : old;
  if (ch.type === 11 && postTop === ch.id) { box.stick = false; box.scrollTop = 0; } // post aberto agora: fica no topo (o post) até a pessoa rolar ou comentar // post aberto agora: começa pelo post (como no Reddit), não pelo último comentário
}
// Histórico mais antigo chegou (rolou até o topo): põe só as mensagens novas no começo. Antes o chat inteiro era montado de
// novo a cada página (50, 100, 150… mensagens), travando a rolagem num PC fraco (quadro de ~650 ms com 350 mensagens).
function prependMessages(cid, older) {
  const box = $('#msgs'), list = S.messages.get(cid); if (!box || S.view.cid !== cid || !older.length || !list) return false;
  const first = list[older.length], firstEl = first && box.querySelector(`:scope > [data-mid="${first.id}"]`); // a que estava no topo
  const grow = box.querySelector(':scope > .grow'); if (!firstEl || !grow) return false;
  const ch = channelById(cid), frag = document.createDocumentFragment(); let prev = null;
  if (S.loaded.get(cid) && !box.querySelector(':scope > .welcome')) frag.append(welcomeBlock(ch));
  for (const m of older) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) frag.append(h('div.daysep', h('span', dayLabel(m.created_at))));
    frag.append(msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null)); prev = m;
  }
  // fronteira: a antiga primeira mensagem pode agrupar com a anterior, e o separador de dia dela pode sobrar
  const sep = firstEl.previousElementSibling?.classList.contains('daysep') ? firstEl.previousElementSibling : null;
  const same = sameDay(prev.created_at, first.created_at);
  if (sep && same) sep.remove();
  firstEl.replaceWith(msgEl(first, same ? prev : null));
  grow.after(frag);
  return true;
}
export function appendMessage(m) {
  const box = $('#msgs'), list = S.messages.get(m.channel_id); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160 || m.author_id === S.me.id;
  const prev = list[list.length - 2];
  if (!prev || !sameDay(prev.created_at, m.created_at)) box.append(h('div.daysep', h('span', dayLabel(m.created_at))));
  const mel = msgEl(m, prev && sameDay(prev.created_at, m.created_at) ? prev : null);
  // animação de entrada só na própria mensagem: em cada quadro dela o Chrome recompõe as camadas do chat inteiro (receber
  // 30 mensagens dos outros: 4,8 s de trabalho da página com a animação, 1,0 s sem, CPU 4x)
  if (m.author_id === S.me.id) { mel.classList.add('fresh'); setTimeout(() => mel.classList.remove('fresh'), 700); }
  box.append(mel);
  if (near) { box.stick = true; trimChat(m.channel_id); box.scrollTop = box.scrollHeight; }
}
// Canal aberto por horas: as mensagens que chegam iam se acumulando no chat e na memória para sempre (~900 por hora num
// canal movimentado). Com a pessoa no fim da conversa, passando de CHAT_MAX ficam as CHAT_KEEP mais novas; rolar até o topo
// busca as antigas de novo no servidor (o mesmo caminho do histórico).
const CHAT_MAX = 250, CHAT_KEEP = 150, OPEN_KEEP = 50;
// Canais que já foram abertos e ficaram para trás continuam recebendo as novas (gateway: onMessage) e a lista crescia sem
// parar enquanto a pessoa estava em outro canal (trimChat só olha o canal na tela). De minuto em minuto: lista grande fora
// da tela volta às OPEN_KEEP mais novas (o mesmo corte que o loadChannel faria ao reabrir) e, passando de CACHE_CHANNELS
// canais guardados, os abertos há mais tempo saem (reabrir busca de novo no servidor, como no primeiro acesso).
const CACHE_CHANNELS = 40;
export function pruneCachedChannels() {
  const here = S.view.cid; let extra = S.messages.size - CACHE_CHANNELS;
  for (const [cid, list] of [...S.messages]) {
    if (cid === here || detached.has(cid) || arriving.has(cid)) continue;
    if (extra > 0) { S.messages.delete(cid); S.loaded.delete(cid); extra--; continue; }
    if (list.length > CHAT_MAX) { list.splice(0, list.length - OPEN_KEEP); S.loaded.set(cid, false); }
  }
}
setInterval(pruneCachedChannels, 60e3);
// Lendo o histórico para cima: o chat guarda no máximo HIST_MAX mensagens. Passando disso, as mais novas saem de baixo e o
// chat fica "vendo mensagens antigas" (rolar até o fim busca de novo; o botão volta ao presente). Descendo de volta, saem as
// de cima. Antes cada página de 50 se somava para sempre: lendo 2.000 mensagens para trás eram 2.000 no chat e cada
// redesenho passava por todas (scripts/history-window-test.mjs).
const HIST_MAX = 300, HIST_KEEP = 200;
function dropNewest(cid) {
  const list = S.messages.get(cid), box = $('#msgs'); if (!list || !box || list.length <= HIST_MAX) return;
  const cut = list.splice(HIST_KEEP);
  for (const m of cut) box.querySelector(`:scope > [data-mid="${m.id}"]`)?.remove();
  while (box.lastElementChild?.classList.contains('daysep')) box.lastElementChild.remove(); // separador de dia que ficou sem mensagem
  box.stick = false; detached.add(cid); detachedBar(cid, 'Você está vendo mensagens antigas');
}
// redesenho que tira coisas de cima: a mensagem que estava no topo da tela continua no mesmo lugar
function keepAnchor(box, fn) {
  const top = box.getBoundingClientRect().top, el = [...box.querySelectorAll(':scope > [data-mid]')].find(e => e.getBoundingClientRect().bottom > top);
  const id = el?.dataset.mid, off = el ? el.getBoundingClientRect().top - top : 0;
  fn();
  const again = id && box.querySelector(`:scope > [data-mid="${id}"]`); if (again) box.scrollTop += again.getBoundingClientRect().top - top - off;
}
function trimChat(cid) {
  const list = S.messages.get(cid), box = $('#msgs'); if (!list || list.length <= CHAT_MAX || !box || S.view.cid !== cid || detached.has(cid)) return;
  const cut = list.length - CHAT_KEEP, first = list[cut], firstEl = box.querySelector(`:scope > [data-mid="${first.id}"]`); if (!firstEl) return;
  list.splice(0, cut); S.loaded.set(cid, false);
  const grow = box.querySelector(':scope > .grow');
  while (grow && grow.nextSibling && grow.nextSibling !== firstEl) grow.nextSibling.remove(); // mensagens, separadores e o "começo do canal"
  grow.after(h('div.daysep', h('span', dayLabel(first.created_at)))); firstEl.replaceWith(msgEl(first, null)); // a nova primeira não agrupa com quem saiu
}
export function applyUser(d, quiet) { // quiet: muitos de uma vez (PRESENCE_SYNC), quem chamou redesenha
  const old = S.users.get(d.id), presence = !!old && presenceOnly(old, d);
  S.users.set(d.id, d); if (d.id === S.me.id) S.me = d;
  for (const dm of S.dms.values()) dm.recipients = dm.recipients.map(r => r.id === d.id ? d : r);
  for (const r of S.rels.values()) if (r.user.id === d.id) r.user = d;
  // só status/aparelho mudou (o caso comum: alguém entrou ou saiu): as mensagens não mostram status, e a lista de canais
  // de um servidor só mostra quem está em sala. Antes cada entrada/saída redesenhava o chat e a lista lateral inteiros.
  if (quiet) return;
  const g = guild(S.view.gid);
  if (!presence || d.id === S.me.id || !g || S.voice.has(d.id)) renderSide();
  if (!g || g.members.has(d.id)) renderMembers();
  if (!presence) refreshAuthors(d.id);
  if (S.view.kind === 'home' && !deferRender(renderHomeIfHome)) renderMain();
}
const PRESENCE_KEYS = new Set(['status', 'platforms']);
function presenceOnly(a, b) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!PRESENCE_KEYS.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false; return true; }
export function refreshAuthors(uid) { if ($('#msgs') && S.view.cid && S.messages.get(S.view.cid)?.some(m => m.author_id === uid)) renderMessages(true); }

export const ctxFor = (gid) => ({ userName: (id) => (S.users.has(id) ? nameOf(id, gid) : null), roleOf: (id) => S.guilds.get(gid)?.roles.find(r => r.id === id), emojiUrl });
export function msgEl(m, prev) {
  const ch = channelById(m.channel_id), gid = ch?.guild_id, mine = m.author_id === S.me.id;
  const grouped = prev && prev.author_id === m.author_id && (prev.imported?.n || '') === (m.imported?.n || '') && m.created_at - prev.created_at < 600000 && !m.reply && !S.prefs.compact && prev.type !== 1;
  // importada do Discord com o nome original (ninguém daqui): nome e inicial dele, sem perfil (server/importer.js)
  const impName = m.imported?.n, a = impName ? { id: 'imp', display_name: impName, color: impColor(impName) } : user(m.author_id), col = impName ? null : roleColor(gid, m.author_id);
  const mentioned = m.mentions?.includes(S.me.id) || (m.content || '').includes(`<@${S.me.id}>`);
  if (m.type === 1) return h('div.msg.system', { 'data-mid': m.id }, h('span.arrow', icon(/^importou /.test(m.content) ? 'inbox' : 'arrowr', 18)), h('span', h('b', { style: { color: col || 'var(--header)' } }, nameOf(m.author_id, gid)), ' ' + m.content), h('span.ts', stamp(m.created_at)),
    /^importou /.test(m.content) ? h('button.btn.link.sm', { onclick: () => undoImportModal(ch) }, 'Ver importações')
      : h('button.btn.grey.wave', { onclick: () => tryApi('POST', `/channels/${m.channel_id}/messages`, { content: `👋 Bem-vindo(a), <@${m.author_id}>!` }) }, icon('smile', 18), 'Dar boas-vindas'));
  if (flaggedMap.has(m.id) && !m._show) return h('div.msg.flagged', { 'data-mid': m.id, oncontextmenu: (e) => msgMenu(e, m) }, icon('shield', 16),
    h('span', `Você marcou esta mensagem de ${nameOf(m.author_id, gid)} como ${flaggedMap.get(m.id) === 'spam' ? 'spam' : 'ofensiva'}. `),
    h('button.btn.link.sm', { onclick: () => { m._show = true; refreshMsg(m); } }, 'Mostrar'));
  const el = h('div.msg' + (grouped ? '.cont' : '.first') + (mentioned ? '.mentioned' : '') + (S.editing === m.id ? '.editing' : '') + (S.replyTo?.id === m.id ? '.qr-target' : ''), { 'data-mid': m.id, oncontextmenu: (e) => msgMenu(e, m), ondblclick: (e) => msgDblClick(e, m) });
  if (!grouped) el.append(h('div.av', { onclick: (e) => !impName && profile(e.currentTarget, m.author_id, gid) }, avatar(a, 40, { status: false })));
  else el.append(h('div.time-s', clock(m.created_at)));
  if (m.reply) el.append(h('div.reply-ref', { onclick: () => jumpTo(m.reply.id) },
    m.reply.deleted ? h('i', 'A mensagem original foi excluída') : [avatar(user(m.reply.author.id), 16, { status: false }), h('span.rn', '@' + nameOf(m.reply.author.id, gid)), h('span.rt', plainTs(inviteText(themeText(m.reply.content))) || 'Clique para ver o anexo')]));
  if (!grouped) el.append(h('div.head', impName ? h('span.author.imp-author', impName) : styleName(h('span.author', { style: col ? { color: col } : null, onclick: (e) => profile(e.currentTarget, m.author_id, gid), oncontextmenu: (e) => { e.stopPropagation(); userMenu(e, m.author_id, gid); } }, nameOf(m.author_id, gid)), a.name_style), !impName && roleDot(gid, m.author_id),
    m.imported && h('span.imp-tag', { title: `Importada do Discord por ${user(m.imported.by)?.display_name || 'alguém'}${m.imported.re ? ' · respondia a ' + m.imported.re : ''}` }, icon('inbox', 11), 'Discord'), h('span.ts', stamp(m.created_at)), m.pinned && h('span.pin', icon('pin', 12)), m.e2ee === true && h('span.e2-ic', { title: 'Protegida de ponta a ponta' }, icon('lock', 12))));
  if (m.forwarded) el.append(h('div.fwd-tag', icon('arrowr', 14), 'Encaminhada'));
  const spoilFrom = el.childNodes.length; // daqui para baixo (texto, cartões, anexos) é o que o spoiler cobre
  if (S.editing === m.id) {
    const ta = h('textarea', { value: m.content, rows: 1, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m, ta.value); } if (e.key === 'Escape') { S.editing = null; renderMessages(true); } } });
    el.append(h('div.edit-box', ta, h('div.edit-hint', 'esc para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.editing = null; renderMessages(true); } }, 'cancelar'), ' • enter para ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); saveEdit(m, ta.value); } }, 'salvar'))));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  } else if (typeof m.e2ee === 'string') { // protegida e não abriu aqui (trancada neste aparelho, chave apagada ou adulterada)
    el.append(h('div.body.e2-locked', h('span', m.content), m.e2ee === 'locked' && h('button.btn.link.sm', { onclick: () => unlockModal() }, 'Desbloquear')));
  } else if (m.content) {
    const body = h('div.body'), shared = THEME_CODE_RE.test(m.content) && decodeTheme(m.content), invites = inviteCodes(m.content), calls = callCodes(m.content);
    let shown = shared ? stripThemeCodes(m.content) : m.content; // o código do tema não aparece, só o bloco
    if (invites.length || calls.length) shown = stripInvites(shown); // o link do convite também vira só o cartão
    const clipIds = m.clip ? [] : clipLinkIds(shown); if (clipIds.length) shown = stripClipLinks(shown); // link de clipe: só o cartão
    if (m.poll || m.event) shown = ''; // enquete / anúncio de evento: o cartão mostra tudo
    if (m.clip) shown = ''; // clipe: o cartão mostra o título
    const gifOnly = !m.poll && !shared && isGifMessage(shown); if (gifOnly) shown = ''; // só um GIF: mostra a imagem, sem o link
    if (shown) body.innerHTML = md(shown, ctxFor(gid));
    if (shown && onlyEmoji(shown.replace(/<:\w+:\d+>/g, '😀'))) body.classList.add('emoji-big');
    if (m.edited_at) body.append(h('span.edited', '(editado)'));
    if (shared) body.append(themeCard(shared));
    for (const code of invites) body.append(inviteCard(code));
    for (const id of calls) body.append(callCard(id));
    for (const id of clipIds) body.append(clipEmbed(id));
    if (m.poll) body.append(pollCard(m));
    if (m.event) body.append(eventCard(m.event));
    if (gifOnly && S.prefs.embedLinks !== false) body.append(coverMedia(gifEl(m.content.trim(), (u) => lightbox(u)), coverReason(m), m.id + ':gif')); else if (gifOnly) body.append(h('a', { href: m.content.trim(), target: '_blank', rel: 'noopener' }, m.content.trim()));
    if (S.prefs.embedLinks !== false) for (const url of (shown.match(/https?:\/\/\S+/g) || []).filter(isImageUrl).slice(0, 3)) { const im = h('img', { src: url, loading: 'lazy', referrerPolicy: 'no-referrer', onclick: () => lightbox(url) }), box = h('div.attach', im); if (isGifName(url)) freezeGif(im, url, box); body.append(coverMedia(box, coverReason(m), m.id + ':' + url)); }
    if (S.prefs.embedLinks !== false) for (const card of [...new Set((shown.match(/https?:\/\/[^\s<>)]+/g) || []))].slice(0, 6).map(socialCard).filter(Boolean).slice(0, 3)) body.append(coverMedia(card, coverReason(m), m.id + ':social')); // YouTube/Shorts/TikTok/Reels (media.js)
    if (S.prefs.embedLinks !== false) { const seen = new Set(); for (const url of (shown.match(/https?:\/\/[^\s<>)]+/g) || []).slice(0, 10)) { const id = steamApp(url); if (id && !seen.has(id) && seen.size < 3) { seen.add(id); body.append(steamCard(url)); } } } // loja da Steam (steamcard.js)
    body.querySelectorAll('.spoiler').forEach(s => (s.onclick = () => s.classList.add('shown')));
    body.querySelectorAll('.mention[data-uid]').forEach(s => { s.onclick = () => profile(s, s.dataset.uid, gid); const u = S.users.get(s.dataset.uid); if (u) s.prepend(mentionAvatar(u)); });
    el.append(body);
    const tr = translationBlock(m, (t) => { const d = h('div.body'); d.innerHTML = md(t, ctxFor(gid)); return d; });
    if (tr) el.append(tr);
  }
  appendAttachments(el, m, mine || (gid && can(gid, PERM.MANAGE_MESSAGES)));
  if (m.forwarded) { const f = m.forwarded, src = channelById(f.channel_id); // de onde veio: abre a original se você também vê aquele canal
    el.append(h(src ? 'button.fwd-from' : 'div.fwd-from', src ? { type: 'button', title: 'Ir para a mensagem original', onclick: () => { go(src.guild_id || '@me', src.id); setTimeout(() => jumpTo(f.message_id), 600); } } : null, f.from || 'Outra conversa', ' · ', shortWhen(f.created_at))); }
  if (S.editing !== m.id && spoiled(m) && !spoilShown.has(m.id)) coverSpoiler(el, spoilFrom, m);
  if (m.reactions?.length) el.append(h('div.reactions', m.reactions.map(r => h('div.react' + (r.users.includes(S.me.id) ? '.me' : ''), { title: r.users.map(u => nameOf(u, gid)).join(', '), onclick: () => react(m, r.emoji, !r.users.includes(S.me.id)) }, reactionFace(r.emoji), h('span', r.users.length)))));
  el.append(h('div.toolbar',
    h('button', { title: 'Reagir', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em, true)) }, icon('smile', 18)),
    h('button', { title: 'Responder', onclick: () => setReply(m) }, icon('reply', 18)),
    mine && !m.poll && !m.event && typeof m.e2ee !== 'string' && h('button', { title: 'Editar', onclick: () => { S.editing = m.id; renderMessages(true); } }, icon('edit', 18)),
    (mine || (gid && can(gid, PERM.MANAGE_MESSAGES))) && h('button.tdel', { title: 'Excluir (Shift: sem confirmar)', onclick: (e) => deleteMenu(e, m) }, icon('trash', 18)),
    h('button', { title: 'Mais', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); msgMenu({ preventDefault() { }, clientX: r.left, clientY: r.bottom }, m); } }, icon('more', 18))));
  return el;
}
