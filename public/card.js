import { h, icon, avatar, framePos, imgUrl, thumbUrl } from './util.js';
import { lightbox, S, profileThemeOn, api } from './state.js';
import { steamInfo } from './steamcard.js';
import { gameIcon, gameBanner, gameModal, titleEl } from './activity.js';
import { isLightPair, styleName } from './themes.js';

// "Jogando agora" no cartão: Steam vinculada ou jogo detectado no PC pelo app desktop (o servidor já filtrou quem pode ver)
function playing(uid) {
  let a = null; for (const x of S.activities?.values() || []) if (x.user_id === uid && (!a || a.platform === 'pc')) a = x;
  if (!a) return null;
  const m = Math.max(0, Math.round((Date.now() - a.since) / 60000)), t = m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'min' : ''}`;
  return [h('h4.pplay-h', 'Jogando agora'), h('div.pplaybox', { title: `Sobre ${a.game.title}`, onclick: (e) => { e.stopPropagation(); gameModal(a); } }, gameBanner(a), h('div.pplay', gameIcon(a, 40), h('div', titleEl(a, 'b'), h('small', `${a.platform === 'pc' ? 'No PC' : 'Steam'} · ${t}`))))];
}

export const STATUS_TXT = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };

// Cartão de perfil (usado no popout e na prévia da tela de perfil)
export function profileCard(u, { nickname, roles = [], since, extra, top, accent, onImage, onEditAvatar, onEditBanner } = {}) { // top: logo abaixo do nome/status
  const tp = u.theme_primary, ta = u.theme_accent, themed = profileThemeOn(u) || !!(onEditBanner && tp && ta); // edição do próprio perfil sempre mostra o tema
  const color = themed ? tp : accent || u.banner_color || u.color || '#5865f2'; // com tema, o banner sem imagem segue a cor principal
  const banner = h('div.banner', { style: { background: color, position: 'relative', overflow: 'hidden' }, ...(u.banner && !onEditBanner ? { title: onImage ? 'Ver perfil completo' : 'Ver banner', onclick: () => (onImage ? onImage() : lightbox(u.banner)) } : {}) });
  if (u.banner) banner.append(framePos(h('img', { src: imgUrl(u.banner, 960), alt: '', draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }), u.banner_pos));
  if (onEditBanner) { banner.classList.add('editable'); banner.title = 'Editar banner'; banner.append(h('div.avedit', icon('edit', 22))); banner.onclick = (e) => { e.stopPropagation(); onEditBanner(e); }; } // edição do perfil: lápis com menu, igual ao avatar
  else banner.classList.toggle(onImage ? 'clickable' : 'zoomable', !!u.banner); // com onImage o clique abre o perfil completo, não o zoom
  const av = avatar(u, 80, { ring: themed ? tp : 'var(--bg-float)' });
  if (onEditAvatar) { av.classList.add('editable'); av.title = 'Editar avatar'; av.append(h('div.avedit', icon('edit', 22))); av.onclick = (e) => { e.stopPropagation(); onEditAvatar(av); }; } // perfil completo: lápis com menu em vez de zoom
  else if (u.avatar || onImage) { av.classList.add(onImage ? 'clickable' : 'zoomable'); av.title = onImage ? 'Ver perfil completo' : 'Ver foto de perfil'; av.onclick = (e) => { e.stopPropagation(); onImage ? onImage() : lightbox(u.avatar); }; }
  const emoji = u.status_emoji && /^<:/.test(u.status_emoji) ? null : u.status_emoji;
  const el = h('div.pcard' + (themed ? '.themed' + (isLightPair(tp, ta) ? '.tlight' : '.tdark') : ''),
    banner,
    h('div.pa', av),
    h('div.pb',
      h('h3', styleName(h('span', nickname || u.display_name), u.name_style)),
      h('div.un', u.username + (u.status && u.status !== 'offline' ? ' • ' + STATUS_TXT[u.status] : '')),
      (u.custom_status || emoji) && h('p.cstat', emoji && h('span', emoji + ' '), u.custom_status),
      playing(u.id),
      top,
      showcase(u),
      h('hr'),
      u.bio && [h('h4', 'Sobre mim'), h('p', { style: { whiteSpace: 'pre-wrap' } }, u.bio)],
      h('h4', 'Na Resenha desde'), h('p', new Date(+u.created_at || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })),
      roles.length > 0 && [h('h4', 'Cargos'), h('div.chips', roles.map(r => h('span.chip', h('i.dot', { style: { background: r.color } }), r.name)))],
      extra));
  if (u.pinned_clip && !onEditBanner) clipBanner(banner, u.pinned_clip);
  // variáveis CSS só entram via setProperty (Object.assign no style as ignora)
  el.style.setProperty('--pc', color);
  if (themed) { el.style.setProperty('--tp', tp); el.style.setProperty('--ta', ta); }
  return el;
}

// ---- vitrine do perfil (Resenha 2.0) ----
// Os 3 jogos mais jogados (biblioteca da Steam vinculada, /users/:id/games) com capa e horas. Some quando a pessoa não tem
// jogos com tempo ou esconde os jogos. Guarda a resposta por 2 min: abrir o cartão várias vezes não refaz o pedido.
const gamesCache = new Map(); // uid -> { at, p }
export const topGames = (uid) => { const c = gamesCache.get(uid); if (c && Date.now() - c.at < 120000) return c.p; const p = api('GET', `/users/${uid}/games`).catch(() => null); gamesCache.set(uid, { at: Date.now(), p }); return p; };
const hrs = (min) => (min < 60 ? min + ' min' : Math.round(min / 60).toLocaleString('pt-BR') + ' h');
function showcase(u) {
  const box = h('div.pshow.hidden');
  topGames(u.id).then(r => {
    const top = (r && !r.hidden ? r.top || [] : []).slice(0, 3); if (!top.length) return;
    box.replaceChildren(h('h4', 'Mais jogados'), h('div.pshow-row', top.map(g => {
      const t = h('div.pshow-g', { title: g.title || '' }, h('div.pshow-img'), h('b', g.title || 'Jogo'), h('small', hrs(g.minutes)));
      steamInfo(g.appid).then(x => { if (!x) return; if (x.title) t.querySelector('b').textContent = x.title; if (x.image) t.querySelector('.pshow-img').append(h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); });
      return t;
    })));
    box.classList.remove('hidden');
  });
  return box;
}
// clipe fixado: vira o banner do cartão, tocando sem som em loop (com "reduzir animações", fica a miniatura parada).
// Quem não tem acesso ao clipe (servidor onde não está) continua vendo o banner normal.
const clipCache2 = new Map();
function clipBanner(banner, id) {
  if (!clipCache2.has(id)) clipCache2.set(id, api('GET', `/clips/${encodeURIComponent(id)}`).catch(() => null));
  clipCache2.get(id).then(c => {
    if (!c?.url) return;
    const still = document.documentElement.classList.contains('reduce-motion') || !document.documentElement.classList.contains('anim');
    const media = still ? (thumbUrl(c.url) && h('img', { src: thumbUrl(c.url), alt: '' }))
      : h('video', { src: c.url, muted: true, autoplay: true, loop: true, playsInline: true, preload: 'metadata', poster: thumbUrl(c.url) || undefined, 'aria-hidden': 'true' });
    if (!media) return;
    if (media.tagName === 'VIDEO') { media.muted = true; media.play?.().catch(() => { }); }
    banner.classList.add('clipban');
    banner.append(h('div.clipban-media', media), h('span.clipban-tag', icon('clip', 12), c.title || 'Clipe'));
  });
}
