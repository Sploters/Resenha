// Cartão de links da loja da Steam no chat: store.steampowered.com/app/<id> (e steamcommunity.com/app/<id>, s.team/a/<id>)
// vira um cartão com a capa, nome, descrição, tags, avaliações, lançamento, preço em reais (com o desconto e até quando vale)
// e, da Resenha, quem está jogando agora. Os dados vêm do servidor (/api/steam-apps, que guarda cada jogo por 6 h); o
// aparelho não fala com a Steam, só baixa a imagem da capa.
import { h, icon, avatar } from './util.js';
import { S, tryApi } from './state.js';
import { gameModal, playingSteam } from './activity.js';

// URL -> appid (string) ou null
export function steamApp(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase(), p = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'store.steampowered.com') id = p[0] === 'app' ? p[1] : p[0] === 'agecheck' && p[1] === 'app' ? p[2] : null;
  else if (host === 'steamcommunity.com') id = p[0] === 'app' ? p[1] : null;
  else if (host === 's.team') id = p[0] === 'a' ? p[1] : null;
  return /^\d{1,10}$/.test(id || '') ? id : null;
}

// ---------- dados (em lote: vários cartões na tela = 1 pedido) ----------
const data = new Map(); // appid -> { at, p, v }
let queue = new Set(), timer = null;
function load(id) {
  const c = data.get(id);
  if (c && (c.v === undefined || Date.now() - c.at < 30 * 60e3)) return c.p;
  let res; const p = new Promise(r => (res = r)); data.set(id, { at: Date.now(), p, res, v: undefined }); queue.add(id);
  clearTimeout(timer); timer = setTimeout(async () => {
    const ids = [...queue]; queue = new Set();
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const r = await tryApi('GET', '/steam-apps?ids=' + part.join(',')).catch(() => null);
      for (const x of part) { const e = data.get(x); if (!e) continue; e.v = r?.[x] || null; e.at = r ? Date.now() : Date.now() - 29 * 60e3; e.res(e.v); }
    }
  }, 30);
  return p;
}

// ---------- textos ----------
const dateFmt = (t, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(t).toLocaleDateString('pt-BR', opts).replace(/ de /g, ' ');
const reviewTone = (pct) => (pct >= 70 ? 'good' : pct >= 40 ? 'mixed' : 'bad');
const DECK = { verified: ['Verificado no Steam Deck', 'deck-ok'], playable: ['Jogável no Steam Deck', 'deck-mid'] };
const PLAT = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
function release(x) {
  if (x.soon) return typeof x.when === 'number' ? 'Chega em ' + dateFmt(x.when) : String(x.when || 'Em breve');
  return x.released ? 'Lançado em ' + dateFmt(x.released) : '';
}
function ends(t) {
  const left = t - Date.now(); if (left <= 0) return '';
  if (left < 864e5) return 'Promoção acaba hoje';
  return 'Promoção até ' + dateFmt(t, { day: 'numeric', month: 'short' });
}

// ---------- cartão ----------
export function steamCard(url) {
  const id = steamApp(url); if (!id) return null;
  const card = h('div.steamcard.loading', { 'data-app': id },
    h('div.sc-hero'), h('div.sc-body', h('div.sc-sk.w40'), h('div.sc-sk.w70'), h('div.sc-sk.w90'), h('div.sc-sk.w60')));
  const c = data.get(id);
  if (c && c.v) paint(card, c.v);
  else load(id).then(v => { if (v) paint(card, v); else card.remove(); }); // sem dados (jogo removido, Steam fora): fica só o link
  return card;
}

function paint(card, x) {
  const id = String(x.appid), title = x.title || 'Jogo ' + id;
  const store = `https://store.steampowered.com/app/${id}/`;
  const ext = (e) => e.stopPropagation();
  const rv = x.reviews, rel = release(x), deck = DECK[x.deck];
  const priceBox = (x.free || x.price) && h('div.sc-price' + (x.discount ? '.sale' : ''),
    x.discount ? h('span.sc-off', '-' + x.discount + '%') : null,
    h('span.sc-cost', x.discount && x.old ? h('s', x.old) : null, h('b', x.free ? 'Gratuito' : x.price)));
  const now = h('div.sc-now');
  card.className = 'steamcard';
  card.replaceChildren(
    h('a.sc-hero', { href: store, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir na loja da Steam', onclick: ext },
      x.image ? h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
      x.discount && x.ends ? h('span.sc-ends', icon('clock', 13), ends(x.ends)) : null),
    h('div.sc-body',
      h('div.sc-top', h('span.sc-store', 'Steam'), x.dev && h('span.sc-dev', x.dev)),
      h('a.sc-title', { href: store, target: '_blank', rel: 'noopener noreferrer', onclick: ext }, title),
      x.desc && h('p.sc-desc', x.desc),
      h('div.sc-tags',
        x.early && h('span.sc-tag.early', 'Acesso antecipado'),
        ...(x.tags || []).map(t => h('span.sc-tag', t)),
        deck && h('span.sc-tag.' + deck[1], { title: deck[0] }, deck[0])),
      h('div.sc-meta',
        rv && h('span.sc-rev.' + reviewTone(rv.pct), { title: `${rv.pct}% de ${rv.count.toLocaleString('pt-BR')} análises positivas` }, icon('star', 14), `${rv.label} · ${rv.pct}%`),
        rel && h('span', icon('calendar', 14), rel),
        x.platforms?.length ? h('span.sc-plat', x.platforms.map(p => PLAT[p] || p).join(' · ')) : null),
      h('div.sc-foot',
        priceBox,
        h('div.sc-acts',
          h('button.sc-btn', { type: 'button', title: 'Quem da Resenha joga isto', onclick: (e) => { e.stopPropagation(); gameModal({ platform: 'steam', game: { id, title } }); } }, icon('users', 16), 'Quem joga'),
          h('a.sc-btn.sc-app', { href: `steam://store/${id}`, title: 'Abrir no aplicativo da Steam', onclick: ext }, icon('gamepad', 16), 'No app'),
          h('a.sc-btn.primary', { href: store, target: '_blank', rel: 'noopener noreferrer', onclick: ext }, icon('external', 16), 'Ver na Steam'))),
      now));
  paintNow(card);
}

// "jogando agora" com os avatares de quem está no jogo (atualiza quando a atividade muda)
function paintNow(card) {
  const box = card.querySelector('.sc-now'); if (!box) return;
  const ids = playingSteam(card.dataset.app);
  if (!ids.length) { box.replaceChildren(); return; }
  const names = ids.map(uid => (uid === S.me?.id ? 'Você' : (S.users.get(uid)?.display_name || S.users.get(uid)?.username || 'Alguém')));
  const txt = names.length === 1 ? `${names[0]} está jogando agora` : names.length === 2 ? `${names[0]} e ${names[1]} estão jogando agora` : `${names[0]}, ${names[1]} e mais ${names.length - 2} jogando agora`;
  box.replaceChildren(h('span.sc-dot'), h('span.sc-avs', ids.slice(0, 4).map(uid => avatar(S.users.get(uid) || { id: uid }, 20, { status: false }))), h('span', txt));
}
addEventListener('rs-activity', () => { for (const c of document.querySelectorAll('.steamcard:not(.loading)')) paintNow(c); });
