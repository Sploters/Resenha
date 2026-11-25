// Partes de uma mensagem: anexos, cartões (convite, tema, clipe), reações e apagar.
import { coverMedia, coverReason, freezeGif, isGifName } from './mediasafe.js';
import { onKindsEvent } from './chkinds.js';
import { favStarFor } from './mediafavs.js';
import { importModal } from './importer.js';
import { prepVideo } from './media.js';
import { eventModal } from './events.js';
import { h, icon, avatar, fsVideo, thumbUrl, bytes, clipLink, imgUrl } from './util.js';
import { timestampModal } from './timestamp.js';
import { S, api, tryApi, user, channelById, nameOf, can, PERM, dmPeer, toast, modal, confirmBox, menu, popout, lightbox, emojiUrl, CH, chCan, isChatCh } from './state.js';
import { chName } from './chnames.js';
import { openShareClip } from './myclips.js';
import { pollModal } from './polls.js';
import { track } from './ux.js';
import { galleryFocus } from './clipsgallery.js';
import { saveCustomTheme } from './themeeditor.js';
import { gradientCss, encodeTheme, GRADIENT_THEMES, themeDef } from './themes.js';
import { voiceEl } from './voicemsg.js';
import { guildGamesRow } from './activity.js';
import { openFile, openedFileUrl } from './e2ee.js';
import { $ } from './gateway.js';
import { go } from './nav.js';
import { joinInvite, friendNames, avStack } from './rail.js';
import { chIcon, lastTime } from './side.js';
import { initialsOf } from './usermenu.js';
import { loadChannel } from './chat.js';
import { renderReplyBar } from './composer.js';
// cor fixa por nome para quem veio na importação (a mesma pessoa sempre com a mesma cor)
const IMP_COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22'];
export const impColor = (n) => { let x = 0; for (const c of String(n)) x = (x * 31 + c.codePointAt(0)) | 0; return IMP_COLORS[Math.abs(x) % IMP_COLORS.length]; };
// importação terminou ou foi desfeita: recarrega o canal (as mensagens antigas entraram no meio da conversa)
export function onImported(d) {
  onKindsEvent('MESSAGES_IMPORTED', d);
  if (!S.messages.has(d.channel_id)) return;
  S.messages.delete(d.channel_id); S.loaded.delete(d.channel_id);
  if (S.view.cid === d.channel_id && $('#msgs')) loadChannel(d.channel_id);
  if (d.by?.id !== S.me.id) toast(d.removed != null ? `${d.by?.display_name || 'Alguém'} desfez uma importação do Discord (${d.removed} mensagens)` : `${d.by?.display_name || 'Alguém'} importou ${d.count} mensagens do Discord nesta conversa`);
}
// lixeira da barra da mensagem: apaga a mensagem; com áudio/arquivo junto de outro conteúdo, pergunta o que remover
const removeAtt = (m, i) => tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
const deleteMsg = async (m, quick) => { if (quick || await confirmBox('Apagar mensagem', 'Tem certeza?', 'Apagar')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}`); };
export function deleteMenu(e, m) {
  const files = (m.attachments || []).map((f, i) => ({ f, i })).filter(a => !isImg(a.f));
  const alone = !m.content && (m.attachments || []).length <= 1; // só um áudio/arquivo: apagar a mensagem é o mesmo que remover o anexo
  if (!files.length || alone) return deleteMsg(m, e.shiftKey);
  const r = e.currentTarget.getBoundingClientRect(), what = (f) => (f.voice ? 'a mensagem de voz' : `"${f.name}"`);
  menu({ preventDefault() { }, clientX: r.left, clientY: r.bottom + 4 }, [
    ...files.map(({ f, i }) => ({ label: 'Remover ' + what(f), danger: true, fn: async () => { if (e.shiftKey || await confirmBox('Remover anexo', `Remover ${what(f)} desta mensagem?`, 'Remover')) removeAtt(m, i); } })),
    '-', { label: 'Apagar mensagem inteira', danger: true, fn: () => deleteMsg(m, e.shiftKey) },
  ]);
}

// cartão de convite de servidor no chat (no lugar do link)
const inviteInfo = new Map();
const fetchInvite = (code) => { if (!inviteInfo.has(code)) inviteInfo.set(code, api('GET', `/invites/${encodeURIComponent(code)}?peek=1`).then(r => (r?.gone ? null : r)).catch(() => null)); return inviteInfo.get(code); };
export function inviteCard(code) {
  const card = h('div.invcard.loading', h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon'), h('div.ivinfo', h('b', 'Carregando…'))));
  fetchInvite(code).then(info => {
    if (!info) {
      card.className = 'invcard bad';
      return card.replaceChildren(h('div.ivh', 'Convite para um servidor'), h('div.ivbody', h('div.ivicon', icon('x', 28)), h('div.ivinfo', h('b', 'Convite inválido'), h('small', 'Pode ter expirado ou sido apagado.'))));
    }
    const g = info.guild, inside = () => S.guilds.has(g.id);
    const btn = h('button.btn');
    const paint = () => { btn.textContent = inside() ? 'Ir para o servidor' : 'Entrar'; btn.className = 'btn ' + (inside() ? 'grey' : 'green'); };
    btn.onclick = async () => {
      if (inside()) return go(g.id);
      btn.disabled = true; btn.textContent = 'Entrando…';
      if (await joinInvite(code) === false) { btn.disabled = false; paint(); return; }
      inviteInfo.delete(code); document.querySelectorAll(`.invcard[data-code="${code}"]`).forEach(c => c.replaceWith(inviteCard(code)));
    };
    paint();
    const top = h('div.ivbanner'), ic = g.icon ? h('img.ivicon', { src: imgUrl(g.icon, 80), alt: '' }) : h('div.ivicon', initialsOf(g.name));
    if (g.banner) top.style.backgroundImage = `url("${imgUrl(g.banner, 480).replace(/"/g, '%22')}")`;
    else top.style.background = `linear-gradient(120deg, ${g.accent || '#5865f2'}, color-mix(in srgb, ${g.accent || '#5865f2'} 40%, #000))`;
    card.className = 'invcard'; card.dataset.code = code;
    card.replaceChildren(top, h('div.ivh', inside() ? 'Você já está neste servidor' : 'Você foi convidado para entrar em um servidor'),
      h('div.ivbody', ic, h('div.ivinfo', h('b', { title: g.name }, g.name),
        h('div.ivstats', h('span', h('i.on'), `${info.online} online`), h('span', h('i'), `${info.members} ${info.members === 1 ? 'membro' : 'membros'}`)),
        info.games?.length > 0 && h('div.ivgames', guildGamesRow(info.games, { size: 20, show: 6 })),
        info.friends?.length > 0 && h('div.ivfriends', { title: info.friends.map(u => u.display_name).join(', ') }, avStack(info.friends, 18), h('span', `${friendNames(info.friends)} ${info.friends.length === 1 ? 'está' : 'estão'} aqui`))), btn));
  });
  return card;
}

// bloco de tema compartilhado no chat
export function themeCard(t) {
  const inUse = () => { const cur = themeDef(S.prefs.theme, S.prefs.customThemes || []); return !!cur && cur.base === t.base && cur.colors.join() === t.colors.join() && (cur.angle ?? 180) === t.angle; };
  const btn = h('button.btn', { onclick: () => { saveCustomTheme(t); toast(`Tema "${t.name}" aplicado e salvo em Aparência`); document.querySelectorAll('.themeshare').forEach(c => c.dispatchEvent(new Event('repaint'))); } });
  const paint = () => { const on = inUse(); btn.textContent = on ? 'Em uso' : 'Usar tema'; btn.disabled = on; btn.classList.toggle('grey', on); };
  const card = h('div.themeshare', { onrepaint: paint }, h('i.sw', { style: { background: gradientCss(t) } }),
    h('div', h('b', t.name), h('small', `Tema ${t.base === 'light' ? 'claro' : 'escuro'} em gradiente`), h('div.tsdots', t.colors.map(c => h('i', { style: { background: c } })))), btn);
  paint(); return card;
}
// "+" do campo de mensagem: enviar arquivo ou compartilhar um tema (vai só o bloco do tema)
function shareThemePicker(ch) {
  const mine = S.prefs.customThemes || [], presets = Object.values(GRADIENT_THEMES);
  const cur = themeDef(S.prefs.theme, mine);
  const send = (t) => {
    dlg.close();
    tryApi('POST', `/channels/${ch.id}/messages`, { content: encodeTheme({ ...t, angle: t.angle ?? 180, intensity: t.intensity ?? 50 }), reply_to: S.replyTo?.id });
    S.replyTo = null; renderReplyBar();
  };
  const tile = (t) => h('button.tpick' + (t === cur ? '.cur' : ''), { title: `Enviar "${t.name}"`, onclick: () => send(t) }, h('i', { style: { background: gradientCss(t) } }), h('span', t.name), t === cur && h('small', 'em uso'));
  const body = h('div.tpicker',
    h('h5', 'Seus temas'), mine.length ? h('div.tpgrid', mine.map(tile)) : h('p.tpempty', 'Você ainda não criou temas. Crie em Configurações → Aparência → Criar tema.'),
    h('h5', 'Temas prontos'), h('div.tpgrid', presets.filter(t => !t.group).map(tile)),
    h('h5', 'Agentes do Valorant'), h('div.tpgrid', presets.filter(t => t.group === 'valorant').map(tile)));
  const dlg = modal('Compartilhar tema', 'Quem receber vê o bloco do tema e pode usá-lo com um clique.', body, [{ label: 'Cancelar', cls: 'link' }], { width: '540px' });
}
export function plusMenu(e, ch, fileIn) {
  const r = e.currentTarget.getBoundingClientRect();
  const imp = !ch.guild_id || can(ch.guild_id, PERM.MANAGE_CHANNELS);
  menu({ preventDefault() { }, clientX: r.left, clientY: r.top - (imp ? 223 : 190) }, [
    { label: 'Enviar arquivo', fn: () => fileIn.click() },
    { label: 'Compartilhar um clipe', fn: () => openShareClip(ch) },
    { label: 'Criar enquete', fn: () => pollModal(ch) },
    ch.guild_id && { label: 'Marcar evento', fn: () => eventModal(ch.guild_id) },
    { label: 'Inserir horário', fn: () => { const ta = $('#composer textarea'); if (ta) timestampModal(ta); } },
    { label: 'Compartilhar tema', fn: () => shareThemePicker(ch) },
    (!ch.guild_id || can(ch.guild_id, PERM.MANAGE_CHANNELS)) && { label: 'Importar conversa do Discord…', fn: () => importModal(ch) },
  ]);
}

export function reactionFace(e) {
  const m = e.match(/^<:(\w+):(\d+)>$/);
  if (m) { const u = emojiUrl(m[2]); return u ? h('img.cemoji', { src: u, alt: ':' + m[1] + ':', style: { height: '16px' } }) : h('span', ':' + m[1] + ':'); }
  return h('span', e);
}
// tamanho (px de tela) da miniatura pedida ao servidor: o que o chat de fato mostra. Foto sozinha ocupa no máximo 400 px
// (style.css .mgrid.n1) e várias ficam lado a lado em ~275 px; no celular, menos. imgUrl dobra em tela de alta densidade.
// Antes pedia 960 (1600 em tela retina) para mostrar 400: 3 a 6 vezes mais bytes por foto, pesando no 4G
const chatImgSize = (n) => { const free = Math.max(160, (window.innerWidth || 1280) - 76); return n === 1 ? Math.min(400, free) : Math.min(280, Math.round(free / 2)); };
const isImg = (f) => /^(png|jpe?g|gif|webp|avif|bmp)$/.test((f.name.split('.').pop() || '').toLowerCase());
// imagens da mesma mensagem viram uma grade; cada anexo tem uma lixeira ao passar o mouse
export function appendAttachments(el, m, canDel) {
  // anexos protegidos de ponta a ponta: baixa e abre no aparelho quando a mensagem aparece (imagens, áudio, voz e vídeos
  // até 50 MB); os maiores e os outros arquivos abrem no clique. Sem a chave (trancado neste aparelho) só o aviso.
  if (m.attachments?.some(f => f.enc || f.e2ee)) {
    const auto = (f) => f.e2ee && !f.expired && f.size <= 50 * 1048576 && (f.voice || /^(image|audio|video)\//.test(f.type));
    const waiting = m.attachments.filter(f => auto(f) && !openedFileUrl(f));
    if (waiting.length) {
      const ph = h('div.e2-files', icon('lock', 16), h('span', 'Abrindo arquivo protegido…')); el.append(ph);
      const io = new IntersectionObserver((es) => { if (!es.some(e => e.isIntersecting)) return; io.disconnect();
        Promise.all(waiting.map(openFile)).then(() => { const tmp = h('div'); appendAttachments(tmp, m, canDel); ph.replaceWith(...tmp.childNodes); },
          () => ph.replaceChildren(icon('lock', 16), h('span', 'Não foi possível abrir o arquivo protegido'))); }, { rootMargin: '400px' });
      io.observe(ph); return;
    }
    m = { ...m, attachments: m.attachments.map(f => (f.e2ee && openedFileUrl(f) ? { ...f, url: openedFileUrl(f) } : f)) };
  }
  const atts = (m.attachments || []).map((f, i) => ({ f, i }));
  const del = (f, i) => canDel && h('button.adel', { title: 'Remover anexo (Shift: sem confirmar)', onclick: async (e) => {
    e.stopPropagation();
    if (e.shiftKey || await confirmBox('Remover anexo', `Remover "${f.name}" desta mensagem?`, 'Remover')) tryApi('DELETE', `/channels/${m.channel_id}/messages/${m.id}/attachments/${i}`);
  } }, icon('trash', 16));
  const imgs = atts.filter(a => isImg(a.f) && !a.f.expired);
  // cada foto pode vir coberta (spoiler no envio ou "Esconder mídia até clicar") e GIF fica parado com "GIFs parados" (mediasafe.js)
  if (imgs.length) el.append(h('div.mgrid.n' + Math.min(imgs.length, 5), imgs.map(({ f, i }) => {
    const im = h('img' + (imgs.length === 1 && f.width && f.height ? '.sized' : ''), { style: imgs.length === 1 && f.width && f.height ? { '--ar': String(f.width / f.height) } : null, src: imgUrl(f.url, chatImgSize(imgs.length)), decoding: 'async', alt: f.alt || f.name, title: f.size ? `${f.name} • ${bytes(f.size)}` : f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(f.url) });
    const tile = h('div.mtile' + (f.spoiler ? '.spoilfile' : ''), coverMedia(im, coverReason(m, f), m.id + ':' + i), del(f, i), favStarFor(f));
    if (f.alt) tile.append(h('button.alt-tag', { type: 'button', title: f.alt, 'aria-label': 'Texto alternativo: ' + f.alt, onclick: (e) => { e.stopPropagation(); popout(e.currentTarget, h('div.alt-pop', h('b', 'Texto alternativo'), h('p', f.alt))); } }, 'ALT'));
    if (isGifName(f.name)) { tile.classList.add('giftile'); tile.append(h('span.gtag', 'GIF')); freezeGif(im, f.url, tile); }
    return tile;
  })));
  if (m.clip) el.append(clipMsgCard(m)); // clipe: cartão leve no lugar do player (o vídeo fica na galeria)
  for (const { f, i } of atts.filter(a => (!isImg(a.f) || a.f.expired) && !(m.clip && a.f.url === m.clip.url))) {
    const a = attachEl(f); a.classList.add('mtile');
    const media = !f.expired && !f.voice && /\.(mp4|webm|mov|m4v)$/i.test(f.name);
    el.append(media ? coverMedia(a, coverReason(m, f), m.id + ':' + i) : a);
  } // áudio/arquivo: excluir fica na barra da mensagem
}
// cartão do clipe no chat: miniatura pequena + título; o vídeo só carrega ao clicar em assistir
function clipMsgCard(m, full, msg = m.id ? m : null) {
  const c = m.clip, ch = channelById(m.channel_id), gid = full ? (full.guild_id && S.guilds.has(full.guild_id) ? full.guild_id : null) : ch?.guild_id;
  const who = c.streamer_id ? nameOf(c.streamer_id, gid) || user(c.streamer_id).display_name : null;
  const thumb = h('div.cmthumb', { title: 'Assistir aqui', onclick: () => { thumb.replaceWith(fsVideo({ src: c.url, autoplay: true, preload: 'auto', poster: thumbUrl(c.url) || undefined }, '.cmvideo')); } },
    thumbUrl(c.url) && h('img', { src: thumbUrl(c.url), loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }), h('span.cmplay', icon('play', 26)), c.secs ? h('span.cmdur', c.secs + 's') : null);
  // quem assistiu de verdade (visualização qualificada, sem contar o autor): vem do clipe completo, buscado uma vez
  const seen = h('span.cmseen');
  const paintSeen = (cc) => { const n = cc?.stats?.views || 0; seen.replaceChildren(...(n ? [icon('eye', 14), `${n} ${n === 1 ? 'assistiu' : 'assistiram'}`] : [])); };
  if (full) paintSeen(full); else if (c.id) fetchClip(c.id).then(paintSeen);
  return h('div.clipmsg', thumb, h('div.cminfo', h('b', c.title), h('small', [who && `transmissão de ${who}`, !c.has_audio && 'sem áudio'].filter(Boolean).join(' · ') || 'clipe'),
    h('div.cmfoot', seen, gid && h('button.btn.link.sm', { onclick: () => { galleryFocus(c.id); go(gid, 'clips'); } }, icon('clip', 14), 'Ver na galeria'))));
}
// cartão de um clipe compartilhado por link: busca o clipe pelo id (nome e vídeo sempre atuais, mesmo depois de renomear)
const clipCache = new Map(); // id -> Promise<clipe | null>
const fetchClip = (id) => { if (!clipCache.has(id)) clipCache.set(id, api('GET', `/clips/${encodeURIComponent(id)}`).catch(() => null)); return clipCache.get(id); };
export function clipEmbed(id, msg) {
  const box = h('div.clipmsg.clipembed.loading', { 'data-clip': id }, h('div.cmthumb'), h('div.cminfo', h('b', 'Carregando clipe…')));
  box._msg = msg;
  fetchClip(id).then(c => paintClipEmbed(box, c));
  return box;
}
function paintClipEmbed(box, c) {
  box.classList.remove('loading');
  if (!c) return box.replaceChildren(h('div.cmthumb.cmgone', icon('clip', 22)), h('div.cminfo', h('b', 'Clipe indisponível'), h('small', 'Foi apagado ou você não tem acesso.')));
  const fake = { clip: { id: c.id, title: c.title, secs: c.secs, url: c.url, has_audio: c.has_audio, streamer_id: c.streamer?.id || null }, channel_id: c.channel_id };
  const card = clipMsgCard(fake, c, box._msg || null);
  box.replaceChildren(...card.childNodes);
}
export function updateClipEmbeds(t, d) {
  const id = String(d.id); clipCache.set(id, Promise.resolve(t === 'CLIP_DELETE' ? null : d));
  document.querySelectorAll(`.clipembed[data-clip="${CSS.escape(id)}"]`).forEach(b => paintClipEmbed(b, t === 'CLIP_DELETE' ? null : d));
}
// compartilhar um clipe: manda o link numa conversa ou canal (com um comentário opcional); quem recebe vê o cartão e assiste,
// mesmo sem estar no servidor do clipe
export function shareClipModal(c) {
  const q = h('input', { type: 'search', placeholder: 'Buscar conversa ou canal', 'aria-label': 'Buscar conversa ou canal' });
  const note = h('input', { placeholder: 'Comentário (opcional)', maxLength: 300, 'aria-label': 'Comentário' });
  const list = h('div.share-list');
  const dms = [...S.dms.values()].filter(d => dmPeer(d)).sort((a, b) => lastTime(b) - lastTime(a)).map(d => ({ id: d.id, label: user(dmPeer(d).id).display_name, sub: 'Mensagem direta', av: avatar(user(dmPeer(d).id), 32) }));
  const chans = [...S.guilds.values()].flatMap(g => g.channels.filter(ch => isChatCh(ch) && chCan(ch, CH.SEND)).map(ch => ({ id: ch.id, label: '#' + chName(ch), sub: g.name, av: h('span.share-ic', chIcon(ch, 18)) })));
  const sent = new Set();
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const rows = [...dms, ...chans].filter(r => !t || (r.label + ' ' + r.sub).toLowerCase().includes(t)).slice(0, 50);
    list.replaceChildren(...rows.map(r => h('div.share-row', r.av, h('div.share-txt', h('b', r.label), h('small', r.sub)),
      h('button.btn' + (sent.has(r.id) ? '.grey' : ''), { type: 'button', disabled: sent.has(r.id), onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        const content = (note.value.trim() ? note.value.trim() + '\n' : '') + clipLink(c.id);
        const ok = await tryApi('POST', `/channels/${r.id}/messages`, { content });
        if (ok) { sent.add(r.id); btn.replaceChildren(icon('clipcheck', 14), 'Enviado'); btn.classList.add('grey', 'sent'); } else btn.disabled = false;
      } }, ...(sent.has(r.id) ? [icon('clipcheck', 14), 'Enviado'] : ['Enviar'])))), !rows.length && h('div.dm-empty', 'Nada encontrado'));
  };
  q.oninput = draw;
  const copy = h('button.btn.grey', { type: 'button', onclick: () => { navigator.clipboard?.writeText(clipLink(c.id)); toast('Link do clipe copiado'); } }, icon('link', 16), 'Copiar link');
  modal('Compartilhar clipe', `"${c.title}" — quem receber pode assistir pelo link.`, h('div.share-box', h('div.share-top', h('label.f', q), copy), list, h('label.f', note)), [{ label: 'Concluir', cls: 'green' }], { width: '480px' });
  draw(); setTimeout(() => q.focus());
}
export function attachEl(f) {
  if (f.enc && !f.e2ee && !f.expired) return h('div.file.e2-file', icon('lock', 32), h('div', h('div.fn', 'Arquivo protegido'), h('div.fs', 'Desbloqueie a criptografia neste aparelho para abrir'))); // trancado aqui
  if (f.e2ee && !f.expired && !f.url.startsWith('blob:')) { // protegido, grande ou não é mídia: abre no clique
    const go = async (b, play) => { b.disabled = true; try { const u = await openFile(f); if (play) box.replaceWith(attachEl({ ...f, url: u })); else { const a = h('a', { href: u, download: f.name }); a.click(); } } catch (e) { toast(e.message, true); } b.disabled = false; };
    const isMedia = /^(video|audio)\//.test(f.type);
    const box = h('div.file.e2-file', icon('lock', 32), h('div', h('div.fn', f.name), h('div.fs', bytes(f.size) + ' · protegido')),
      isMedia && h('button.btn.sm', { style: { marginLeft: 'auto' }, onclick: (e) => go(e.currentTarget, true) }, 'Abrir'),
      h('button.ibtn', { title: 'Baixar', style: { marginLeft: isMedia ? '4px' : 'auto' }, onclick: (e) => go(e.currentTarget, false) }, icon('dl')));
    return box;
  }
  // apagado para liberar espaço (Configurações → Armazenamento / expiração do servidor): a conversa continua fazendo sentido
  // (antes da linha do link: o arquivo expirado não tem mais endereço, e f.url.startsWith quebrava a mensagem inteira)
  if (f.expired) return h('div.file.expired', { title: 'Apagado em ' + new Date(f.expired).toLocaleDateString('pt-BR') }, icon('file', 32), h('div', h('div.fn', f.name), h('div.fs', 'Arquivo expirado' + (f.size ? ' • ' + bytes(f.size) : ''))));
  const ext = (f.name.split('.').pop() || '').toLowerCase(), url = f.url, dl = url.startsWith('blob:') ? url : url + '?download=1';
  if (f.voice) return voiceEl(f);
  if (isImg(f)) return h('div.attach', h('img', { src: url, alt: f.name, 'data-size': f.size || '', loading: 'lazy', onclick: () => lightbox(url) }));
  // o vídeo só baixa no play (antes cada vídeo do chat começava a baixar ao abrir o canal); a miniatura vem do servidor
  if (/^(mp4|webm|mov|m4v)$/.test(ext)) { const poster = thumbUrl(url), box = fsVideo({ src: url, preload: 'none', ...(poster ? { poster } : {}) }); prepVideo(box, poster);
    box.addEventListener('vc-result', (e) => track('video_play', e.detail + ':' + (f.vc || 'nd'))); // medição: tocou ou não, por codec (server/ux.js)
    return h('div.attach', box); }
  if (/^(mp3|ogg|wav|m4a)$/.test(ext)) return h('div.attach', h('audio', { src: url, controls: true, preload: 'none' }));
  return h('div.file', icon('file', 32), h('div', h('a.fn', { href: dl, download: f.name }, f.name), h('div.fs', bytes(f.size))), h('a.ibtn', { href: dl, download: f.name, style: { marginLeft: 'auto' } }, icon('dl')));
}
