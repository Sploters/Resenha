// Biblioteca e wishlist (server/games.js): quem da Resenha tem cada jogo e quem quer.
// - cartão de link da Steam: "3 têm · 2 querem", botão Quero e o popup de quem joga/tem/quer
// - Wishlist do servidor (entrada na lista de canais): os jogos que os membros mais querem, com preço e promoção
// - Jogos de alguém (menu da pessoa): wishlist e mais jogados
// - Configurações → Contas vinculadas: quem vê, sincronizar a Steam e a sua wishlist
// O servidor decide quem cada um pode ver; aqui só se mostra o que ele mandou.
import { h, icon, avatar, skeleton } from './util.js';
import { S, api, tryApi, toast, modal, notify } from './state.js';
import { steamInfo } from './steamcard.js';
import { playingSteam } from './activity.js';
import { section, row, seg } from './ui.js';

const ctx = {}; // injetado por app.js: profile(anchor, uid), go(gid, cid), openSettings(k), onDeals() (selo da caixa de entrada), playSound(nome)
export const initGames = (c) => Object.assign(ctx, c);
const uOf = (id) => S.users.get(id) || { id, display_name: 'Alguém', username: '' };
const nameOf = (id) => (id === S.me?.id ? 'Você' : uOf(id).display_name || uOf(id).username || 'Alguém');
export const hours = (min) => (!min ? 'nunca jogou' : min < 60 ? min + ' min' : (min < 6000 ? (Math.round(min / 6) / 10).toLocaleString('pt-BR') : Math.round(min / 60).toLocaleString('pt-BR')) + ' h');

// ---------------------------------------------------------------- minha wishlist (carregada uma vez, atualizada pelo GAMES_UPDATE)
let me = null, meP = null;
const loadMe = (force) => { if (!force && (me || meP)) return meP || Promise.resolve(me); meP = tryApi('GET', '/games/me').then(r => { meP = null; if (r) { me = r; S.myWish = new Set(r.wishlist.map(x => x.appid)); } return me; }); return meP; };
export const inWish = (appid) => !!S.myWish?.has(String(appid));
const wishSrc = (appid) => me?.wishlist.find(x => x.appid === String(appid))?.sources || [];

// ---------------------------------------------------------------- quem tem / quem quer (em lote, guardado 2 min)
const people = new Map(); let pq = new Set(), pt = null;
export function gamePeople(appid) {
  appid = String(appid); const c = people.get(appid);
  if (c && (c.v === undefined || Date.now() - c.at < 120e3)) return c.p;
  let res; const p = new Promise(r => (res = r)); people.set(appid, { at: Date.now(), p, res, v: undefined }); pq.add(appid);
  clearTimeout(pt); pt = setTimeout(async () => {
    const ids = [...pq]; pq = new Set();
    for (let i = 0; i < ids.length; i += 30) {
      const part = ids.slice(i, i + 30), r = await tryApi('GET', '/games/people?ids=' + part.join(',')).catch(() => null);
      for (const x of part) { const e = people.get(x); if (e) { e.v = r?.[x] || { owners: [], wish: [] }; e.at = Date.now(); e.res(e.v); } }
    }
  }, 40);
  return p;
}
export const cachedPeople = (appid) => people.get(String(appid))?.v;

// mudou algo meu (sincronizou, pôs/tirou da wishlist): recarrega e redesenha o que está na tela
export function onGamesUpdate(d) {
  if (d?.appid) people.delete(String(d.appid)); else people.clear();
  loadMe(true).then(() => dispatchEvent(new Event('rs-games')));
}

// ---------------------------------------------------------------- botão Quero
export function wishButton(appid, { small } = {}) {
  appid = String(appid); S.myWish ||= new Set();
  const b = h('button.sc-btn.wishbtn' + (small ? '.sm' : ''), { type: 'button' });
  const paint = () => { const on = inWish(appid); b.classList.toggle('on', on); b.title = on ? 'Na sua wishlist (clique para tirar)' : 'Pôr na sua wishlist da Resenha'; b.replaceChildren(icon(on ? 'check' : 'gift', 16), on ? 'Na wishlist' : 'Quero'); };
  b.onclick = async (e) => {
    e.stopPropagation(); b.disabled = true;
    if (!inWish(appid)) { const r = await tryApi('PUT', '/wishlist/' + appid); if (r) { S.myWish.add(appid); toast('Na sua wishlist. Quem divide servidor com você vê.'); } }
    else if (wishSrc(appid).includes('steam') && !wishSrc(appid).includes('resenha')) toast('Este jogo veio da sua wishlist da Steam: tire por lá e sincronize.');
    else { const r = await tryApi('DELETE', '/wishlist/' + appid); if (r) { if (r.steam) toast('Continua na wishlist pela Steam.'); else S.myWish.delete(appid); } }
    b.disabled = false; paint();
  };
  paint(); if (!S.myWish) loadMe().then(paint);
  return b;
}

// ---------------------------------------------------------------- linha "N têm · M querem" (cartão de link e wishlist do servidor)
export function socialLine(appid, title, v) {
  const owners = v.owners.filter(o => o.user_id !== S.me?.id), wish = v.wish.filter(u => u !== S.me?.id);
  const mine = v.owners.find(o => o.user_id === S.me?.id);
  const ids = [...new Set([...owners.map(o => o.user_id), ...wish])];
  if (!ids.length && !mine) return null;
  const bits = [mine && `Você tem · ${hours(mine.minutes)}`, owners.length && `${owners.length} ${owners.length === 1 ? 'tem' : 'têm'}`, wish.length && `${wish.length} ${wish.length === 1 ? 'quer' : 'querem'}`].filter(Boolean);
  return h('button.sc-social', { type: 'button', title: 'Ver quem tem e quem quer', onclick: (e) => { e.stopPropagation(); peopleModal(appid, title); } },
    ids.length ? h('span.sc-avs', ids.slice(0, 5).map(uid => avatar(uOf(uid), 20, { status: false }))) : null, h('span', bits.join(' · ')));
}

// ---------------------------------------------------------------- popup: jogando agora, quem tem (com horas), quem quer
export async function peopleModal(appid, title) {
  appid = String(appid);
  const body = h('div.gp', skeleton('rows', 4));
  const m = modal(title || 'Jogo', 'Pessoas que você pode ver: amigos e quem divide servidor com você', body, [], { width: 'min(460px, 94vw)' });
  m.el.querySelector('.modal').classList.add('gpmodal'); m.el.querySelector('.mf')?.remove(); m.el.querySelector('.mh').append(h('button.inv-x.gp-x', { title: 'Fechar', 'aria-label': 'Fechar', onclick: m.close }, icon('x', 20)));
  people.delete(appid);
  const [v, info] = await Promise.all([gamePeople(appid), steamInfo(appid)]);
  if (info?.title) m.el.querySelector('.mh h2').textContent = info.title;
  const now = playingSteam(appid);
  const person = (uid, sub) => h('div.gm-person', { onclick: (e) => { m.close(); ctx.profile?.(e.currentTarget, uid); } }, avatar(uOf(uid), 32), h('div.an-who', h('b', nameOf(uid)), sub && h('small', sub)));
  const block = (cap, list) => list.length ? [h('div.gm-cap', cap + ' · ' + list.length), h('div.gm-people', list)] : [];
  const parts = [
    ...block('Jogando agora', now.map(uid => person(uid, null))),
    ...block('Têm o jogo', v.owners.map(o => person(o.user_id, hours(o.minutes)))),
    ...block('Querem', v.wish.map(uid => person(uid, v.owners.some(o => o.user_id === uid) ? null : 'na wishlist'))),
  ];
  body.replaceChildren(...(parts.length ? parts : [h('p.gm-none', 'Ninguém que você pode ver tem ou quer este jogo ainda.')]),
    h('div.gp-foot', wishButton(appid), h('a.sc-btn', { href: `https://store.steampowered.com/app/${appid}/`, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), 'Ver na Steam')));
}

// ---------------------------------------------------------------- Jogos de alguém (menu da pessoa)
export async function userGamesModal(uid) {
  const body = h('div.gp', skeleton('rows', 4));
  const m = modal('Jogos de ' + nameOf(uid), null, body, [], { width: 'min(560px, 94vw)' });
  m.el.querySelector('.modal').classList.add('gpmodal'); m.el.querySelector('.mf')?.remove(); m.el.querySelector('.mh').append(h('button.inv-x.gp-x', { title: 'Fechar', 'aria-label': 'Fechar', onclick: m.close }, icon('x', 20)));
  const r = await tryApi('GET', `/users/${uid}/games`);
  if (!r) return m.close();
  if (r.hidden) return body.replaceChildren(h('p.gm-none', nameOf(uid) + ' não mostra os jogos para você.'));
  const tile = (appid, sub) => {
    const t = h('div.ug-tile', { onclick: () => { m.close(); peopleModal(appid); } }, h('div.ug-img'), h('div.ug-txt', h('b', 'Jogo ' + appid), sub && h('small', sub)));
    steamInfo(appid).then(x => { if (!x) return; t.querySelector('b').textContent = x.title; if (x.image) t.querySelector('.ug-img').append(h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }));
      if (x.discount) t.querySelector('.ug-txt').append(h('span.ug-off', `-${x.discount}% · ${x.price}`)); });
    return t;
  };
  body.replaceChildren(...[
    r.top.length && h('div.gm-cap', `Mais jogados · ${r.count} ${r.count === 1 ? 'jogo' : 'jogos'} na biblioteca`), r.top.length && h('div.ug-grid', r.top.map(g => tile(g.appid, hours(g.minutes)))),
    h('div.gm-cap', 'Wishlist · ' + r.wishlist.length),
    r.wishlist.length ? h('div.ug-grid', r.wishlist.slice(0, 60).map(w => tile(w.appid, null))) : h('p.gm-none', 'Wishlist vazia.')].filter(Boolean));
}

// ---------------------------------------------------------------- Wishlist do servidor
const gw = { gid: null, sort: 'wish', data: null };
export function renderGuildWishlist(main, gid) {
  if (gw.gid !== gid) Object.assign(gw, { gid, data: null });
  const root = h('div#wishview'); main.replaceChildren(root);
  const g = S.guilds.get(gid);
  const draw = () => {
    if (!root.isConnected) return;
    const d = gw.data;
    const tabs = [['wish', 'Mais desejados'], ['sale', 'Em promoção'], ['nobody', 'Ninguém tem']].map(([k, l]) => h('button.ctab' + (gw.sort === k ? '.on' : ''), { onclick: () => { gw.sort = k; draw(); } }, l));
    let items = d?.items || [];
    if (gw.sort === 'sale') items = items.filter(x => steamCached(x.appid)?.discount > 0).sort((a, b) => steamCached(b.appid).discount - steamCached(a.appid).discount);
    if (gw.sort === 'nobody') items = items.filter(x => !x.owners.length);
    const empty = d && !items.length && h('div.cempty', h('div.ceart', icon('gift', 40)),
      h('b', !d.items.length ? 'Ninguém pôs jogos na wishlist ainda' : gw.sort === 'sale' ? 'Nenhum jogo da wishlist em promoção agora' : 'Todos os jogos desejados já têm dono por aqui'),
      !d.items.length && h('p', 'Vincule a Steam em Configurações → Contas vinculadas (a wishlist vem junto) ou clique em "Quero" no cartão de um link da Steam.'));
    root.replaceChildren(
      h('div#topbar', h('span.hash', icon('gift', 24)), h('span', 'Wishlist'), h('span.topic', d ? (d.items.length ? `${d.items.length} ${d.items.length === 1 ? 'jogo desejado' : 'jogos desejados'} por ${d.wishers} ${d.wishers === 1 ? 'pessoa' : 'pessoas'} de ${g?.name || 'este servidor'}` : g?.name || '') : '')),
      h('div.cbody', h('div.ctool', h('div.ctabs', tabs), h('button.btn.grey.sm', { onclick: openMyGames }, icon('gear', 14), 'Minha wishlist')),
        !d ? skeleton('cards', 6) : h('div.wgrid', items.map(wishCard)), empty || null));
  };
  const load = async () => {
    const r = await tryApi('GET', `/guilds/${gid}/wishlist`); if (!r) return;
    for (const u of r.users || []) if (!S.users.has(u.id)) S.users.set(u.id, u);
    gw.data = r; draw();
    await Promise.all(r.items.map(x => steamInfo(x.appid))); if (gw.sort === 'sale') draw();
  };
  const on = () => { if (!root.isConnected) return removeEventListener('rs-games', on); load(); }; addEventListener('rs-games', on);
  draw(); load();
}
const steamCached = (appid) => steamInfo.cached(appid);
function wishCard(x) {
  const card = h('div.wcard', { onclick: () => peopleModal(x.appid) },
    h('div.wc-img'), h('div.wc-body', h('b.wc-title', 'Carregando…'), h('div.wc-price'),
      h('div.wc-who', h('span.sc-avs', x.wish.slice(0, 5).map(uid => avatar(uOf(uid), 22, { status: false }))),
        h('span', `${x.wish.length} ${x.wish.length === 1 ? 'quer' : 'querem'}` + (x.owners.length ? ` · ${x.owners.length} ${x.owners.length === 1 ? 'tem' : 'têm'}` : ''))),
      h('div.wc-acts', wishButton(x.appid, { small: true }))));
  steamInfo(x.appid).then(i => {
    if (!i) { card.querySelector('.wc-title').textContent = 'Jogo ' + x.appid; return; }
    card.querySelector('.wc-title').textContent = i.title;
    if (i.image) card.querySelector('.wc-img').append(h('img', { src: i.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }));
    card.querySelector('.wc-price').replaceChildren(...[i.discount ? h('span.sc-off', '-' + i.discount + '%') : null, i.discount && i.old ? h('s', i.old) : null, h('b', i.free ? 'Gratuito' : i.price || (i.soon ? 'Em breve' : ''))].filter(Boolean));
  });
  return card;
}

// ---------------------------------------------------------------- alerta de promoção (caixa de entrada → Promoções)
// O servidor confere os preços da wishlist e manda GAME_DEAL quando um jogo entra em promoção.
S.deals = { alerts: [], unseen: 0, loaded: false };
export const dealsUnseen = () => S.deals.unseen || 0;
const keepUsers = (list) => { for (const u of list || []) if (!S.users.has(u.id)) S.users.set(u.id, u); };
export async function loadDeals() {
  const r = await tryApi('GET', '/deals').catch(() => null); if (!r) return;
  keepUsers(r.users); S.deals = { alerts: r.alerts, unseen: r.unseen, loaded: true }; ctx.onDeals?.();
}
const fmtEnds = (t) => (t ? (t - Date.now() < 864e5 ? 'acaba hoje' : 'até ' + new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace(/ de /g, ' ')) : '');
const othersTxt = (ids) => { const n = ids.map(nameOf); return !n.length ? '' : n.length === 1 ? `${n[0]} também quer` : n.length === 2 ? `${n[0]} e ${n[1]} também querem` : `${n[0]}, ${n[1]} e mais ${n.length - 2} também querem`; };
export function onGameDeal(d) {
  keepUsers(d.users);
  const a = d.alert, replaced = S.deals.alerts.filter(x => x.appid === a.appid && !x.seen).length; // o aviso novo do mesmo jogo substitui o anterior
  S.deals.alerts = [a, ...S.deals.alerts.filter(x => x.id !== a.id && x.appid !== a.appid)]; S.deals.unseen = Math.max(0, (S.deals.unseen || 0) - replaced) + 1;
  ctx.onDeals?.(); ctx.playSound?.('mention');
  const line = `-${a.discount}% · ${a.price || ''}${a.ends ? ' · ' + fmtEnds(a.ends) : ''}`;
  toast(`${a.title} (da sua wishlist) está em promoção: ${line}`);
  notify(`${a.title} em promoção`, line + (a.others.length ? ' · ' + othersTxt(a.others) : ''), () => ctx.openInbox?.('deals'), 'deal-' + a.appid);
}
export const onDealsSeen = () => loadDeals();
export function markDealsSeen() { if (!S.deals.unseen) return; S.deals.unseen = 0; for (const a of S.deals.alerts) a.seen = true; ctx.onDeals?.(); tryApi('POST', '/deals/seen'); }
// lista da aba Promoções
export function dealsList(empty) {
  if (!S.deals.loaded) { loadDeals().then(() => dispatchEvent(new Event('rs-deals'))); return [skeleton('rows', 3)]; }
  if (!S.deals.alerts.length) return [empty('Nenhuma promoção ainda', 'Quando um jogo da sua wishlist entrar em promoção, ele aparece aqui (e você recebe um aviso).')];
  return S.deals.alerts.map(a => {
    const el = h('div.deal' + (a.seen ? '' : '.new'), { 'data-app': a.appid },
      h('a.deal-img', { href: `https://store.steampowered.com/app/${a.appid}/`, target: '_blank', rel: 'noopener noreferrer' }),
      h('div.deal-body',
        h('b.deal-title', a.title || 'Jogo ' + a.appid),
        h('div.wc-price', h('span.sc-off', '-' + a.discount + '%'), a.old && h('s', a.old), a.price && h('b', a.price), a.ends && h('small.deal-ends', fmtEnds(a.ends))),
        a.others.length ? h('div.wc-who', h('span.sc-avs', a.others.slice(0, 5).map(uid => avatar(uOf(uid), 20, { status: false }))), h('span', othersTxt(a.others))) : null,
        h('div.deal-acts', h('button.sc-btn.sm', { type: 'button', onclick: () => peopleModal(a.appid, a.title) }, icon('users', 14), 'Quem joga'),
          h('a.sc-btn.sm.primary', { href: `https://store.steampowered.com/app/${a.appid}/`, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), 'Ver na Steam'),
          h('button.sc-btn.sm.deal-x', { type: 'button', title: 'Apagar aviso', 'aria-label': 'Apagar aviso', onclick: async () => { if (await tryApi('DELETE', '/deals/' + a.id)) { S.deals.alerts = S.deals.alerts.filter(x => x.id !== a.id); el.remove(); } } }, icon('x', 14)))));
    steamInfo(a.appid).then(i => { if (i?.thumb || i?.image) el.querySelector('.deal-img').append(h('img', { src: i.image || i.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); });
    return el;
  });
}

// ---------------------------------------------------------------- Configurações → Contas vinculadas → Biblioteca e wishlist
export const DEAL_OPTS = { all: 'Qualquer desconto', big: '50% ou mais', off: 'Não avisar' };
export const SHARE = { servers: 'Amigos e quem está nos meus servidores', friends: 'Só amigos', off: 'Ninguém' };
const LIB = { ok: (n) => `${n} ${n === 1 ? 'jogo' : 'jogos'} na biblioteca`, private: () => 'Biblioteca privada na Steam: deixe "Detalhes do jogo" públicos e sincronize',
  nokey: () => 'O servidor não tem a chave da Steam: só a wishlist é copiada', error: () => 'A Steam não respondeu; tentando de novo mais tarde', pending: () => 'Sincronizando…' };
export function gamesBlock() {
  const box = h('div.card2', skeleton('rows', 2));
  const draw = (r) => {
    if (!r) return;
    const st = r.steam, when = st.synced_at ? new Date(st.synced_at).toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    const list = h('div.mywish', r.wishlist.length ? r.wishlist.slice(0, 100).map(w => {
      const el = h('div.mw-row', h('div.mw-img'), h('div.mw-txt', h('b', 'Jogo ' + w.appid), h('small', w.sources.includes('steam') ? (w.sources.includes('resenha') ? 'Steam e Resenha' : 'Da Steam') : 'Da Resenha')), wishButton(w.appid, { small: true }));
      steamInfo(w.appid).then(i => { if (!i) return; el.querySelector('b').textContent = i.title; if (i.thumb) el.querySelector('.mw-img').append(h('img', { src: i.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); });
      return el;
    }) : h('p.hintline', 'Vazia. Clique em "Quero" no cartão de um link da Steam ou cole o link aqui embaixo.'));
    const add = h('input', { placeholder: 'Cole o link de um jogo da Steam', 'aria-label': 'Link de um jogo da Steam' });
    const addFn = async () => { const id = (add.value.match(/(?:\/app\/|s\.team\/a\/)(\d{1,10})/) || [])[1] || (/^\d{1,10}$/.test(add.value.trim()) ? add.value.trim() : null);
      if (!id) return toast('Cole um link como store.steampowered.com/app/123'); const ok = await tryApi('PUT', '/wishlist/' + id); if (ok) { add.value = ''; S.myWish?.add(id); toast('Adicionado.'); } };
    add.onkeydown = (e) => { if (e.key === 'Enter') addFn(); };
    box.replaceChildren(
      row('Avisar quando um jogo da minha wishlist entrar em promoção', 'Aviso na hora e na caixa de entrada → Promoções, com quem mais quer o jogo. Jogos que você já tem não avisam.', seg(DEAL_OPTS, r.deal_alerts || 'all', async (v) => { const x = await tryApi('PATCH', '/games/me', { deal_alerts: v }); if (x) { me = x; toast(v === 'off' ? 'Sem avisos de promoção.' : 'Pronto.'); } })),
      row('Quem vê meus jogos e minha wishlist', 'Vale para o "têm/querem" nos cartões da Steam, a Wishlist do servidor e o seu perfil.', seg(SHARE, r.share, async (v) => { const x = await tryApi('PATCH', '/games/me', { share: v }); if (x) { me = x; toast(v === 'off' ? 'Ninguém mais vê seus jogos.' : 'Pronto.'); } })),
      st.linked ? row('Steam', [LIB[st.library_state]?.(st.library_count) || '', st.wishlist_state === 'ok' ? `${st.wishlist_count} na wishlist da Steam` : '', when && 'atualizado ' + when].filter(Boolean).join(' · '),
        h('button.btn.grey', { disabled: st.syncing, onclick: async (e) => { e.target.disabled = true; const x = await tryApi('POST', '/games/sync'); if (x) { toast('Sincronizando com a Steam…'); draw(x); } else e.target.disabled = false; } }, st.syncing ? 'Sincronizando…' : 'Sincronizar agora'))
        : h('p.hintline', 'Vincule a Steam acima para trazer sua biblioteca (quais jogos você tem e as horas) e a wishlist da Steam.'),
      section('Minha wishlist · ' + r.wishlist.length), h('div.mw-add', add, h('button.btn', { onclick: addFn }, 'Adicionar')), list);
  };
  loadMe(true).then(draw);
  const on = () => { if (!box.isConnected) return removeEventListener('rs-games', on); draw(me); }; addEventListener('rs-games', on);
  return [section('Biblioteca e wishlist'), box];
}
function openMyGames() { ctx.openSettings?.('connections'); }
