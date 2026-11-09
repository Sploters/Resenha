// Vídeos de redes sociais no chat e visualizador vertical.
// - Links do YouTube (inclusive Shorts), TikTok e Instagram (Reels/posts) viram um cartão que toca ali mesmo, pelo
//   player oficial de cada site (iframe). Nada é carregado desses sites até a pessoa dar play (só a miniatura do
//   YouTube, sem enviar de onde veio).
// - Vídeos em pé (Shorts, TikTok, Reels e vídeos enviados gravados no celular) ganham o botão "Tela vertical": abre os
//   vídeos em pé da conversa em tela cheia, um por vez, deslizando (ou rolando / ↑ ↓) para o próximo, como nos apps
//   dessas redes. Só o vídeo da vez fica carregado.
import { h, icon, fsVideo } from './util.js';

const NAMES = { youtube: 'YouTube', shorts: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram' };

// URL -> { kind, id, vertical, embed, thumb, href } ou null
export function videoLink(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, ''), parts = u.pathname.split('/').filter(Boolean);
  const yt = (id, shorts) => {
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    const t = u.searchParams.get('t') || u.searchParams.get('start') || ''; let start = 0;
    const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/); if (m) start = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    return { kind: shorts ? 'shorts' : 'youtube', id, vertical: !!shorts, href: url,
      thumb: `https://i.ytimg.com/vi/${id}/${shorts ? 'oar2' : 'hqdefault'}.jpg`, thumbFallback: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0${shorts ? '&loop=1&playlist=' + id : ''}${start ? '&start=' + start : ''}` };
  };
  if (host === 'youtu.be') return yt(parts[0]);
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') return yt(u.searchParams.get('v'));
    if (parts[0] === 'shorts') return yt(parts[1], true);
    if (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'v') return yt(parts[1]);
    return null;
  }
  if (host === 'tiktok.com') { // tiktok.com/@pessoa/video/<id> (links curtos vm.tiktok.com precisam abrir no site)
    const i = parts.indexOf('video'), id = i >= 0 ? parts[i + 1] : null;
    if (!/^\d{8,25}$/.test(id || '')) return null;
    return { kind: 'tiktok', id, vertical: true, href: url, embed: `https://www.tiktok.com/player/v1/${id}?autoplay=1&rel=0&music_info=1&description=1` };
  }
  if (host === 'instagram.com') { // /reel/<código>, /reels/<código>, /p/<código>, /tv/<código>
    const i = parts.findIndex(p => /^(reels?|p|tv)$/.test(p)), code = i >= 0 ? parts[i + 1] : null;
    if (!/^[\w-]{5,40}$/.test(code || '')) return null;
    const reel = parts[i] !== 'p';
    return { kind: 'instagram', id: code, vertical: reel, href: url, embed: `https://www.instagram.com/${reel ? 'reel' : 'p'}/${code}/embed/` };
  }
  return null;
}

const frame = (v) => h('iframe', { src: v.embed, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write', allowFullscreen: true,
  referrerPolicy: 'strict-origin-when-cross-origin', loading: 'eager', title: NAMES[v.kind] }); // o YouTube recusa o player sem a origem

// cartão do chat: miniatura + play; o play troca pelo player do site
export function socialCard(url) {
  const v = videoLink(url); if (!v) return null;
  const cover = h('div.se-cover');
  if (v.thumb) {
    const img = h('img', { src: v.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
    img.onerror = () => { if (v.thumbFallback && img.src !== v.thumbFallback) img.src = v.thumbFallback; else img.remove(); };
    cover.append(img);
  }
  const card = h('div.sembed.se-' + v.kind + (v.vertical ? '.vert' : ''), { 'data-url': url },
    cover,
    h('button.se-play', { type: 'button', title: 'Assistir aqui', onclick: (e) => { e.stopPropagation(); play(); } }, icon('play', 30)),
    h('div.se-top', h('span.se-name', NAMES[v.kind]),
      v.vertical && h('button.se-btn', { type: 'button', title: 'Tela vertical (deslize para o próximo)', onclick: (e) => { e.stopPropagation(); openShorts(card); } }, icon('expand', 16)),
      h('a.se-btn', { href: v.href, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no site', onclick: (e) => e.stopPropagation() }, icon('external', 16))));
  card._video = v;
  const play = () => { if (card.classList.contains('on')) return; card.classList.add('on'); cover.replaceChildren(frame(v)); };
  cover.onclick = play;
  return card;
}

// vídeo enviado: descobre se é em pé pela miniatura (o vídeo só baixa no play) e põe o botão "Tela vertical" na barra
export function prepVideo(box, poster) {
  const btn = h('button.vc-btn.vc-shorts', { type: 'button', title: 'Tela vertical (deslize para o próximo)', onclick: (e) => { e.stopPropagation(); openShorts(box); } }, icon('expand', 18));
  const row = box.querySelector('.vc-row'); row?.insertBefore(btn, row.querySelector('.vc-speed'));
  if (poster) { const i = new Image(); i.onload = () => { if (i.naturalHeight > i.naturalWidth * 1.1) box.classList.add('vert'); }; i.src = poster; }
}

// ---------- visualizador vertical ----------
let open = null;
export function openShorts(start) {
  if (open) open.close();
  const root = start.closest('#msgs') || document;
  const items = [...root.querySelectorAll('.sembed.vert, .attach .fsvid.vert')];
  if (!items.includes(start)) items.unshift(start);
  let cur = Math.max(0, items.indexOf(start));
  start.querySelector('video')?.pause();
  const prevActive = document.activeElement;

  const slides = items.map((src, i) => h('div.sh-slide', { 'data-i': i }, h('div.sh-media')));
  const track = h('div.sh-track', slides);
  const count = h('div.sh-count');
  const close = () => {
    if (!open) return; open = null;
    for (const s of slides) unload(s);
    removeEventListener('keydown', onKey, true); obs.disconnect(); el.remove();
    try { prevActive?.focus?.(); } catch { }
  };
  const go = (i) => { i = Math.max(0, Math.min(items.length - 1, i)); slides[i].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  const el = h('div#shorts', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vídeos em pé' },
    track,
    h('div.sh-bar',
      count,
      h('button.sh-btn', { type: 'button', title: 'Anterior (↑)', onclick: () => go(cur - 1) }, icon('chevdown', 22)),
      h('button.sh-btn', { type: 'button', title: 'Próximo (↓)', onclick: () => go(cur + 1) }, icon('chevdown', 22)),
      h('button.sh-btn', { type: 'button', title: 'Fechar (Esc)', onclick: close }, icon('x', 22))));

  function load(s) {
    const i = +s.dataset.i, src = items[i], box = s.firstChild;
    if (box.firstChild) return;
    if (src._video) box.append(frame(src._video), h('a.sh-site', { href: src._video.href, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), 'Abrir no ' + NAMES[src._video.kind].replace(' Shorts', '')));
    else {
      const v0 = src.querySelector('video'), url = v0?.currentSrc || v0?.getAttribute('src');
      const vb = fsVideo({ src: url, autoplay: true, loop: true, preload: 'auto', poster: v0?.getAttribute('poster') || undefined }, '.sh-vid');
      box.append(vb); vb.video.play?.().catch(() => { });
    }
  }
  function unload(s) { const box = s.firstChild; box.querySelector('video')?.pause(); box.replaceChildren(); }
  const obs = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) { cur = +e.target.dataset.i; count.textContent = `${cur + 1} / ${items.length}`; load(e.target); }
      else if (!e.isIntersecting || e.intersectionRatio < 0.2) unload(e.target); // saiu da tela: libera o player
    }
  }, { root: track, threshold: [0, 0.2, 0.6] });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); go(cur + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(cur - 1); }
  };
  addEventListener('keydown', onKey, true);
  document.body.append(el);
  slides.forEach(s => obs.observe(s));
  slides[cur].scrollIntoView({ block: 'start' }); count.textContent = `${cur + 1} / ${items.length}`;
  el.querySelector('.sh-btn:last-child').focus({ preventScroll: true });
  open = { close };
}
