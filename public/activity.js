// Atividade social: estado em tempo real, painel "Ativo agora" (o que os amigos fazem AGORA, em destaque, e a retrospectiva
// da semana: os jogos e os clipes que marcaram) e página de contas vinculadas.
// A decisão de QUEM pode ver cada atividade é do servidor; aqui só se exibe o que ele enviou.
import { openNight, nightDay } from './nights.js';
import { canCallInvite, sendCallInvite, pendingInvites, acceptInvite, declineInvite } from './callinvite.js';
import { h, icon, avatar, skeleton, thumbUrl } from './util.js';
import { knownGame } from './gamecatalog.js';
import { chName } from './chnames.js';
import { styleName } from './themes.js';
import { S, api, tryApi, toast, notify, confirmBox, guild, channelById, modal, savePrefs, menu } from './state.js';
import { openIntentModal, myLiveIntent } from './intents.js';
import { playSound } from './sounds.js';
import { openClip } from './clipsgallery.js';
import { gamesBlock } from './games.js';
import { stagger } from './motion.js';
import { intentSection } from './intents.js';
import { liveIn, boraCard, openBoraModal } from './bora.js';
import { toggle, section } from './ui.js';

import { openPosts, lfgMini, ensureLfgPosts } from './lfg.js';
const ctx = {}; // injetado por app.js: openDM, profile, userMenu, go, joinVoice, watchFriend, voice(), openSettings, renderActiveNow
export const initActivity = (c) => Object.assign(ctx, c);
S.activities = new Map();      // 'uid:platform' -> { user_id, platform, game:{id,title}, since, state }
S.integrations = null;         // [{ id, name, configured, capabilities, account }]
let feed = null, feedTimer = null;

const PLATFORM = { steam: 'Steam', pc: 'No PC' };
export const platformName = (p) => PLATFORM[p] || p;
export function setActivities(list) { S.activities.clear(); for (const a of list || []) S.activities.set(a.user_id + ':' + a.platform, a); }
export const activityOf = (uid) => { let pc = null; for (const a of S.activities.values()) if (a.user_id === uid) { if (a.platform !== 'pc') return a; pc = a; } return pc; };
// jogo do PC: a opção "Quem pode ver meu jogo do PC" saiu em 24/11/2026 (sempre amigos + quem divide servidor). Quem
// tinha escolhido algo mais restrito recebe esta mensagem uma vez (server/db.js pc-always-on-1). Chamado ao abrir o app
export function pcNoticeCheck() {
  api('GET', '/activity/pc').then(r => {
    if (!r?.notice_at || S.prefs.pcNoticeSeen === r.notice_at) return;
    S.prefs.pcNoticeSeen = r.notice_at; savePrefs();
  }).catch(() => { });
}
export function onActivityUpdate(d) {
  const k = d.user_id + ':' + d.platform, prev = activityOf(d.user_id);
  if (d.activity) S.activities.set(k, d.activity); else S.activities.delete(k);
  sameGameCheck(d.user_id, prev, d.activity);
  ctx.renderActiveNow?.(); ctx.renderMembers?.(); scheduleFeed(); dispatchEvent(new Event('rs-activity')); // cartões da Steam no chat (steamcard.js)
  if (S.voice.has(d.user_id)) ctx.renderSide?.(); // ícone do jogo ao lado do nome na sala de voz
}
export function onIntegrationUpdate(d) {
  if (S.integrations) { const i = S.integrations.find(x => x.id === d.platform); if (i) i.account = d.account; }
  if (!d.account) for (const k of [...S.activities.keys()]) if (k === S.me.id + ':' + d.platform) S.activities.delete(k);
  S.refreshConnections?.(); scheduleFeed();
}
// a situação real mudou (alguém entrou/saiu de uma chamada, começou a transmitir…): redesenha os cartões para só mostrar ações possíveis
export const refreshFeedView = () => { if (document.getElementById('actfeed')) S.redrawFeed?.(); };
export function clearActivities() { S.activities.clear(); S.integrations = null; feed = null; away = null; awayAt = 0; awayReq = null; }

const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 1) return 'menos de 1 min'; if (m < 60) return m + ' min'; const hh = Math.floor(m / 60), mm = m % 60; return hh + 'h' + (mm ? ' ' + mm + 'min' : ''); };
const since = (t) => (Date.now() - t < 60000 ? 'começou agora' : 'há ' + dur(Date.now() - t));
export const playingLine = (a) => `Jogando ${gameTitle(a)}`;

// ---------------------------------------------------------------- imagem do jogo
// 1) ícone do executável, mandado pelo app desktop de quem joga (/game-icons/<hash>.png)
// 2) arte oficial da Steam (Steam vinculada, ou jogo instalado pela Steam): endereço resolvido pelo servidor (/api/steam-art)
// 3) ícone genérico de controle
const steamIdOf = (a) => (a.platform === 'steam' ? a.game.id : a.game.steam) || null;
// quem está jogando agora um jogo da Steam (pelo appid), para o cartão de link da loja
export const playingSteam = (appid) => [...new Set([...S.activities.values()].filter(a => String(steamIdOf(a)) === String(appid)).map(a => a.user_id))];
const iconUrl = (a) => (a.game.icon && /^[a-f0-9]{64}$/.test(a.game.icon) ? `/game-icons/${a.game.icon}.png` : null);
const art = new Map(); let artQ = new Set(), artTimer = null;
const ART_MAX = 20; // o servidor (/api/steam-art) responde no máximo 20 jogos por pedido
function steamArt(id) { // Promise<{ image, thumb, icon… } | null>, em lote (vários cartões ao mesmo tempo = poucos pedidos)
  id = String(id); if (!/^\d+$/.test(id)) return Promise.resolve(null);
  const c = art.get(id); if (c && (!c.failed || Date.now() - c.at < 60e3)) return c.p;
  let res; const p = new Promise(r => (res = r)); art.set(id, { p, res, at: Date.now() }); artQ.add(id);
  clearTimeout(artTimer); artTimer = setTimeout(async () => {
    const ids = [...artQ]; artQ = new Set();
    // antes ia tudo num pedido só e o servidor cortava em 20: do 21º jogo em diante (Ativo agora, ranking da semana,
    // conquistas) o ícone virava o controle. Agora em partes de 20, ao mesmo tempo
    await Promise.all(Array.from({ length: Math.ceil(ids.length / ART_MAX) }, (_, i) => ids.slice(i * ART_MAX, (i + 1) * ART_MAX)).map(async (part) => {
      const r = await tryApi('GET', '/steam-art?ids=' + part.join(',')).catch(() => null);
      for (const x of part) {
        const e = art.get(x); if (!e) continue;
        // a loja não respondeu: não guarda o "sem imagem" para sempre (tenta de novo depois de 1 min)
        if (!r) { e.failed = true; e.at = Date.now(); }
        e.res(r?.[x] && (r[x].image || r[x].icon) ? r[x] : null);
      }
    }));
  }, 30);
  return p;
}
// jogo sem o número da Steam (e sem o ícone do programa): procura pelo nome na loja (o servidor só aceita o nome exato).
// Em lote, até 10 nomes por pedido; "não achou" fica guardado (não pergunta de novo nesta abertura do app)
const artT = new Map(); let artTQ = new Set(), artTTimer = null;
function steamArtByTitle(title) {
  const t = String(title || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim(); if (t.length < 2 || t.length > 80 || t.includes('|')) return Promise.resolve(null);
  const c = artT.get(t); if (c && (!c.failed || Date.now() - c.at < 60e3)) return c.p;
  let res; const p = new Promise(r => (res = r)); artT.set(t, { p, res, at: Date.now() }); artTQ.add(t);
  clearTimeout(artTTimer); artTTimer = setTimeout(async () => {
    const ts = [...artTQ]; artTQ = new Set();
    await Promise.all(Array.from({ length: Math.ceil(ts.length / 10) }, (_, i) => ts.slice(i * 10, (i + 1) * 10)).map(async (part) => {
      const r = await tryApi('GET', '/steam-art?titles=' + encodeURIComponent(part.join('|'))).catch(() => null);
      for (const x of part) { const e = artT.get(x); if (!e) continue; if (!r) { e.failed = true; e.at = Date.now(); } e.res(r?.['t:' + x] || null); }
    }));
  }, 40);
  return p;
}
// quadradinho do jogo (lista de membros, cartão, painel). Ordem: ícone do catálogo (Valorant, LoL…) > ícone oficial do
// jogo na Steam > ícone do programa > recorte da capa da Steam > controle. O do programa vem depois do da Steam porque
// pode ser o do anticheat (Easy Anti-Cheat), o do Java ou o padrão do motor do jogo. Cada imagem que não carrega passa
// para a próxima (antes só havia um reserva, e uma falha virava o controle mesmo com outra imagem boa disponível).
export function gameIcon(a, size = 20) {
  const box = h('span.gicon', { style: { width: size + 'px', height: size + 'px' } });
  const pad = () => box.replaceChildren(icon('gamepad', Math.round(size * .8)));
  const tryList = (list) => {
    const [x, ...rest] = list.filter(c => c && c.src);
    if (!x) return pad();
    const img = h('img', { src: x.src, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', onerror: () => tryList(rest) });
    if (x.cover) img.classList.add('cover');
    box.replaceChildren(img);
  };
  const kg = knownGame(a.game), sid = steamIdOf(a) || kg?.steam, exe = iconUrl(a);
  const exeC = exe && { src: exe };
  if (kg?.icon) { tryList([{ src: kg.icon, cover: !/\.svg(\?|$)/.test(kg.icon) }, exeC]); return box; }
  const steamList = (x, withExe) => [x.icon && { src: x.icon, cover: true }, withExe && exeC, (x.thumb || x.image) && { src: x.thumb || x.image, cover: true }];
  if (!sid) {
    tryList([exeC]);
    // sem número da Steam e sem ícone do programa: procura o jogo pelo nome (antes ficava o controle)
    if (!exe) steamArtByTitle(gameTitle(a)).then(x => { if (x) tryList(steamList(x, false)); });
    return box;
  }
  // enquanto a Steam responde (o pedido é em lote e guardado): o ícone do programa, se houver; senão o controle
  tryList([exeC]);
  steamArt(sid).then(x => { if (x) tryList(steamList(x, true)); });
  return box;
}
// nome do jogo: o do catálogo, ou o da loja da Steam quando chega (o título da janela pode ser "Pagoda" ou um aviso)
const cleanName = (t) => String(t || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
export function gameTitle(a) { return knownGame(a.game)?.title || a.game.title; }
export function titleEl(a, tag = 'span') {
  const kg = knownGame(a.game), el = h(tag, kg?.title || a.game.title), sid = steamIdOf(a) || kg?.steam;
  if (!kg && sid) steamArt(sid).then(x => { const t = cleanName(x?.title); if (t) el.textContent = t; });
  return el;
}
// faixa com a arte da Steam (cartões maiores); some quando não há arte
export function gameBanner(a) {
  const kg = knownGame(a.game);
  if (kg?.banner) { const el = h('div.gbanner', h('img', { src: kg.banner, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => el.remove() })); return el; }
  const sid = steamIdOf(a) || kg?.steam;
  const el = h('div.gbanner.hidden');
  (sid ? steamArt(sid) : steamArtByTitle(gameTitle(a))).then(x => { if (!x?.image) return; el.replaceChildren(h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => el.remove() })); el.classList.remove('hidden'); });
  return el;
}

// ---------------------------------------------------------------- popup do jogo
// capa (arte da Steam, ou o ícone do programa), tags e avaliação da Steam, quais amigos jogaram e "Ver na Steam"
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameGame = (x, a) => !!x && (x.id === a.game.id || norm(x.title) === norm(a.game.title) || (!!steamIdOf({ platform: x.platform || 'pc', game: x }) && steamIdOf({ platform: x.platform || 'pc', game: x }) === steamIdOf(a)));
// mesmo jogo em duas atividades (por id, nome ou appid da Steam): agrupa a sala de voz por jogo
export const sameGameAs = (a, b) => sameGame({ ...a.game, platform: a.platform }, b);
function gamePeople(a) {
  const by = new Map(), get = (uid) => { if (!by.has(uid)) by.set(uid, { uid, now: null, secs: 0, days: 0, streak: 0 }); return by.get(uid); };
  for (const x of S.activities.values()) if (sameGame({ ...x.game, platform: x.platform }, a)) get(x.user_id).now = x;
  for (const x of feed?.week?.played || []) {
    if (!sameGame({ ...x.game, platform: x.platform }, a)) continue;
    const p = get(x.user_id); p.secs += x.secs; p.days = Math.max(p.days, x.days); p.streak = Math.max(p.streak, x.streak);
  }
  return [...by.values()].sort((x, y) => (y.now ? 1 : 0) - (x.now ? 1 : 0) || y.secs - x.secs).map(p => {
    const u = uOf(p.uid), bits = [p.now && `jogando agora · ${since(p.now.since)}`, p.secs >= 60 && `${durShort(p.secs)} esta semana`, p.streak >= 2 ? `${p.streak} dias seguidos` : p.days >= 2 && `em ${p.days} dias`].filter(Boolean);
    return h('div.gm-person', { onclick: (e) => ctx.profile(e.currentTarget, p.uid) }, avatar(u, 32, { ring: 'var(--bg-float)' }), h('div.an-who', h('b', p.uid === S.me.id ? 'Você' : u.display_name), h('small', bits.join(' · ') || 'jogou esta semana')));
  });
}
export function gameModal(a) {
  const kg = knownGame(a.game), sid = steamIdOf(a) || kg?.steam, ic = kg?.icon || iconUrl(a);
  const hero = h('div.gm-hero', ic ? h('img.gm-icon', { src: ic, alt: '', referrerPolicy: 'no-referrer' }) : h('span.gm-icon.gm-ph', icon('gamepad', 44)));
  const swapIcon = (src) => { const old = hero.querySelector('.gm-icon'); const img = h('img.gm-icon.cover', { src, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(old) }); old.replaceWith(img); };
  if (kg?.banner) { hero.prepend(h('img.gm-art', { src: kg.banner, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => { e.target.remove(); hero.classList.remove('has-art'); } })); hero.classList.add('has-art'); }
  const meta = h('div.gm-meta'), tags = h('div.gm-tags'), critic = h('div.gm-critic');
  const ext = (name, url) => h('a.btn.gm-steam', { href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), name);
  const store = [...(kg?.links || []).map(l => ext(l.name, l.url)), sid && ext('Ver na Steam', `https://store.steampowered.com/app/${sid}/`)].filter(Boolean);
  const people = gamePeople(a);
  const body = h('div.gm', hero, h('div.gm-main',
    h('div.gm-head', titleEl(a, 'h2'), store.length > 0 && h('div.gm-links', store)),
    meta, critic, tags,
    people.length ? [h('div.gm-cap', 'Amigos que jogaram'), h('div.gm-people', people)] : h('p.gm-none', 'Nenhum amigo jogou isto esta semana.')));
  const m = modal('', null, body, [], { width: 'min(560px, 94vw)' });
  const md = m.el.querySelector('.modal'); md.classList.add('gamemodal'); md.querySelector('.mf')?.remove(); md.querySelector('.mh')?.remove();
  hero.append(h('button.inv-x.gm-x', { title: 'Fechar', onclick: m.close }, icon('x', 20)));
  criticScore(gameTitle(a)).then(c => { if (c && critic.isConnected) critic.replaceChildren(criticEl(c)); });
  if (sid) steamArt(sid).then(x => {
    if (!x) return;
    if (!kg?.icon && x.icon) swapIcon(x.icon);
    if (x.image && !kg?.banner) { hero.prepend(h('img.gm-art', { src: x.image, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); hero.classList.add('has-art'); }
    const rv = x.reviews; meta.replaceChildren(...[rv && h('span.gm-rev', icon('star', 14), `${rv.label} · ${rv.pct}%`), (x.free || x.price) && h('span', x.free ? 'Gratuito' : x.price)].filter(Boolean));
    tags.replaceChildren(...(x.tags || []).map(t => h('span.gm-tag', t)));
  });
  return m;
}
// nota da crítica (OpenCritic) no popup do jogo, como informação extra: só aparece quando o servidor tem a chave e o jogo
// tem nota (GET /api/critic, server/opencritic.js). Guardada por nome nesta sessão
const critics = new Map();
function criticScore(title) {
  const t = String(title || '').trim(); if (t.length < 2) return Promise.resolve(null);
  if (!critics.has(t)) critics.set(t, api('GET', '/critic?title=' + encodeURIComponent(t)).then(r => (r && r.score >= 0 ? r : null), () => { critics.delete(t); return null; }));
  return critics.get(t);
}
const TIER_CLS = { Poderoso: 'mighty', Forte: 'strong', 'Razoável': 'fair', Fraco: 'weak' };
function criticEl(c) {
  const tip = `Nota média da crítica no OpenCritic${c.reviews ? ` (${c.reviews} análises)` : ''}`;
  return h('a.gm-oc' + (TIER_CLS[c.tier] ? '.oc-' + TIER_CLS[c.tier] : ''), { href: c.url, target: '_blank', rel: 'noopener noreferrer', title: tip, 'aria-label': `${tip}: ${c.score}` },
    h('span.oc-score', String(c.score)),
    h('span.oc-txt', h('b', 'OpenCritic' + (c.tier ? ' · ' + c.tier : '')), h('small', [c.pct != null && `${c.pct}% dos críticos recomendam`, c.reviews && `${c.reviews} análises`].filter(Boolean).join(' · ') || 'Nota da crítica')),
    icon('external', 14));
}
const openGame = (a) => (e) => { e?.stopPropagation(); gameModal(a); };

// ---------------------------------------------------------------- ícone do jogo na sala de voz + popup "Jogando agora"
// Ao lado do nome de quem está jogando. Passando o mouse: popup com a imagem, o nome do jogo, o que está fazendo (quando
// a plataforma conta) e há quanto tempo, em tempo real. Clicar no ícone, na imagem ou no nome abre o popup do jogo.
const elapsed = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
let gameCard = null, gameCardTimer = null, gameCardTick = null;
export function hideGameCard() { clearTimeout(gameCardTimer); clearInterval(gameCardTick); gameCard?.remove(); gameCard = null; }
function showGameCard(anchor, uid) {
  hideGameCard();
  const a = activityOf(uid); if (!a) return;
  const mine = activityOf(S.me.id), same = uid !== S.me.id && mine && sameGame({ ...mine.game, platform: mine.platform }, a);
  const open = (e) => { hideGameCard(); openGame(a)(e); };
  const time = h('span.gc-time', elapsed(a.since));
  gameCard = h('div.gamecard', { role: 'dialog', 'aria-label': `Jogando ${a.game.title}`, onmouseleave: (e) => { if (!anchor.contains(e.relatedTarget)) hideGameCard(); } },
    h('div.gc-head', 'Jogando agora'),
    h('div.gc-row',
      h('button.gc-img', { title: `Sobre ${a.game.title}`, onclick: open }, gameIcon(a, 56)),
      h('div.gc-info',
        h('button.gc-title', { title: `Sobre ${gameTitle(a)}`, onclick: open }, titleEl(a)),
        a.state && h('div.gc-state', a.state),
        h('div.gc-badges', h('span.gc-badge.gc-play', { title: 'Tempo jogando' }, icon('gamepad', 12), time),
          a.platform !== 'pc' && h('span.gc-badge', platformName(a.platform))))),
    h('div.gc-btns',
      h('button.btn.sm.gc-btn', { onclick: open }, 'Sobre o jogo'),
      same && h('button.btn.grey.sm.gc-btn', { disabled: true, title: 'Você está jogando isto agora' }, 'Você também está jogando')));
  document.body.append(gameCard);
  const r = anchor.getBoundingClientRect(), cw = gameCard.offsetWidth, ch = gameCard.offsetHeight;
  gameCard.style.left = Math.max(8, Math.min(r.right + 10, innerWidth - cw - 8)) + 'px';
  gameCard.style.top = Math.max(8, Math.min(r.top - 12, innerHeight - ch - 8)) + 'px';
  gameCardTick = setInterval(() => { if (!gameCard?.isConnected) return hideGameCard(); time.textContent = elapsed(a.since); }, 1000);
}
// jogos que a galera do servidor mais joga (cabeçalho do servidor e cartão de convite), como no Discord: os primeiros
// ícones à vista (com a chama quando o jogo está bombando na semana) e "+N" com o resto; passar o mouse mostra o nome e
// quantos jogaram, clicar abre o jogo. list: GET /api/guilds/:id/games (ou o convite)
const ggTip = (x) => `${x.game.title} — ${x.players} ${x.players === 1 ? 'pessoa jogou' : 'pessoas jogaram'} nos últimos 30 dias` + (x.playing ? ` · ${x.playing} jogando agora` : '');
export function guildGamesRow(list, { size = 24, show = 5 } = {}) {
  if (!list?.length) return null;
  const btn = (x) => { const b = h('button.gg-game', { type: 'button', title: ggTip(x), 'aria-label': ggTip(x), onclick: openGame(x) }, gameIcon(x, size), x.hot && h('span.gg-hot', { title: 'Muita gente jogando nesta semana' }, icon('fire', 10)));
    return b; };
  const head = list.slice(0, list.length > show ? show - 1 : show), rest = list.slice(head.length);
  const more = rest.length > 0 && h('button.gg-game.gg-more', { type: 'button', title: rest.map(x => x.game.title).join(', '), 'aria-label': `Mais ${rest.length} jogos`,
    onclick: (e) => { e.stopPropagation(); const box = e.currentTarget.nextElementSibling; box.hidden = !box.hidden; } }, gameIcon(rest[0], size), h('span.gg-n', '+' + rest.length));
  const extra = rest.length > 0 && h('div.gg-extra', { hidden: true }, rest.map(x => h('button.gg-row', { type: 'button', title: ggTip(x), onclick: openGame(x) }, gameIcon(x, 20), titleEl(x, 'span'), h('small', String(x.players)))));
  return h('div.gg', { role: 'list', 'aria-label': 'Jogos que a galera mais joga' }, ...head.map(btn), more, extra);
}

// "Jogam aqui" no topo da lista de membros. Normal: só os ícones dos jogos, um ao lado do outro, com setinhas para andar
// para os lados; clicar no meio (fora de um ícone) abre a lista completa (um jogo por linha, com quantos jogaram e quantos
// jogam agora), que fecha pelo título. Lembra o modo aberto (lc_gg_open)
const ggState = { open: (() => { try { return localStorage.getItem('lc_gg_open') === '1'; } catch { return false; } })() };
const ggSet = (v, redraw) => { ggState.open = v; try { localStorage.setItem('lc_gg_open', v ? '1' : '0'); } catch { } redraw(); };
export function guildGamesPanel(list, redraw) {
  if (!list?.length) return null;
  const open = ggState.open;
  const head = h('button.mgroup.ggp-head' + (open ? '' : '.col'), { type: 'button', 'aria-expanded': String(open), title: open ? 'Mostrar só os ícones' : 'Mostrar a lista', onclick: () => ggSet(!open, redraw) },
    icon('caret', 12), h('span.mg-name', 'Jogam aqui'), h('span.mg-n', list.length));
  if (open) {
    const row = (x) => h('button.ggp-row', { type: 'button', title: ggTip(x), onclick: openGame(x) }, gameIcon(x, 24),
      h('span.ggp-t', titleEl(x, 'b'), h('small', `${x.players} ${x.players === 1 ? 'pessoa' : 'pessoas'}` + (x.playing ? ` · ${x.playing} jogando agora` : ''))),
      x.hot && h('span.gg-hot.ggp-hot', { title: 'Muita gente jogando nesta semana' }, icon('fire', 12)));
    return h('div.ggp.open', head, h('div.ggp-list', list.map(row)));
  }
  // faixa de ícones
  const strip = h('div.ggp-strip', { role: 'list', 'aria-label': 'Jogos que a galera joga aqui' }, list.map(x => h('button.ggp-ic', { type: 'button', role: 'listitem', title: ggTip(x), 'aria-label': ggTip(x),
    onclick: (e) => { e.stopPropagation(); openGame(x)(e); } }, gameIcon(x, 28), x.hot && h('span.gg-hot', icon('fire', 9)))));
  const step = (dir) => (e) => { e.stopPropagation(); cancelAnimationFrame(raf); raf = 0; target = null; strip.style.scrollSnapType = ''; strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: 'smooth' }); };
  const prev = h('button.ggp-arr.prev', { type: 'button', title: 'Anteriores', 'aria-label': 'Jogos anteriores', onclick: step(-1) }, icon('chevl', 16));
  const next = h('button.ggp-arr.next', { type: 'button', title: 'Mais jogos', 'aria-label': 'Mais jogos', onclick: step(1) }, icon('chevr', 16));
  const bar = h('div.ggp-bar', { title: 'Clique para ver a lista', onclick: () => ggSet(true, redraw) }, prev, strip, next);
  // setas só quando há mais ícones do que cabem; a da ponta apaga quando não há mais para aquele lado
  const edges = () => { prev.disabled = strip.scrollLeft <= 2; next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2; bar.classList.toggle('fits', prev.disabled && next.disabled); };
  strip.addEventListener('scroll', edges, { passive: true }); requestAnimationFrame(edges);
  // rodinha do mouse anda para os lados direto (sem segurar Alt/Shift); sem mais ícones para aquele lado, a lista rola normal
  // deslizando: cada dente da rodinha soma num alvo e a faixa corre até ele com desaceleração (antes pulava 100 px seco).
  // O ímã das capas (scroll-snap) sai durante o deslize e volta no fim, senão ele puxava a faixa no meio do caminho
  let target = null, raf = 0;
  const glide = () => {
    const diff = target - strip.scrollLeft;
    if (Math.abs(diff) < 0.6) { strip.scrollLeft = target; target = null; raf = 0; strip.style.scrollSnapType = ''; return; }
    strip.scrollLeft += diff * 0.2; raf = requestAnimationFrame(glide);
  };
  strip.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : 0; if (!d) return;
    const max = strip.scrollWidth - strip.clientWidth, from = target ?? strip.scrollLeft;
    if (max <= 2 || (d < 0 && from <= 0) || (d > 0 && from >= max - 1)) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * strip.clientWidth : d;
    target = Math.max(0, Math.min(max, from + px));
    if (document.documentElement.classList.contains('reduce-motion')) { strip.scrollLeft = target; target = null; return; }
    strip.style.scrollSnapType = 'none';
    if (!raf) raf = requestAnimationFrame(glide);
  }, { passive: false });
  return h('div.ggp', head, bar);
}
// ícone pequeno (16 px) para a linha de quem está na sala; null se a pessoa não está jogando
export function voiceGameIcon(uid) {
  const a = activityOf(uid); if (!a) return null;
  const el = h('span.vgame', { title: '', 'aria-label': `Jogando ${a.game.title}`, onclick: (e) => { hideGameCard(); openGame(a)(e); } }, gameIcon(a, 16));
  el.addEventListener('mouseenter', () => { clearTimeout(gameCardTimer); gameCardTimer = setTimeout(() => showGameCard(el, uid), 250); });
  el.addEventListener('mouseleave', (e) => { clearTimeout(gameCardTimer); if (!e.relatedTarget?.closest?.('.gamecard')) setTimeout(() => { if (gameCard && !gameCard.matches(':hover')) hideGameCard(); }, 150); });
  return el;
}

// ---------------------------------------------------------------- "também está jogando"
// Você e um amigo no mesmo jogo, sem estarem na mesma sala: um aviso no canto com o que dá para fazer AGORA (entrar na
// sala dele, chamá-lo para a sua, ou mandar mensagem). Dois sentidos: o amigo abre o jogo que você está jogando
// ("começou a jogar"), ou você abre um jogo em que amigos já estão ("já está jogando"). Uma vez a cada 3 h por amigo e
// jogo (fica no aparelho), nada em "não perturbe"; desliga no próprio aviso ou em Contas vinculadas (S.prefs.sameGameAlert).
const SG_KEY = 'lc_samegame', SG_TTL = 3 * 3600e3;
const sgSeen = () => { try { return JSON.parse(localStorage.getItem(SG_KEY) || '{}'); } catch { return {}; } };
const sgKey = (uid, a) => uid + ':' + norm(gameTitle(a));
const sgFresh = (k) => !(Date.now() - (sgSeen()[k] || 0) < SG_TTL);
function sgMark(keys) {
  const m = sgSeen(), lim = Date.now() - SG_TTL;
  for (const k of Object.keys(m)) if (m[k] < lim) delete m[k];
  for (const k of keys) m[k] = Date.now();
  try { localStorage.setItem(SG_KEY, JSON.stringify(m)); } catch { }
}
const myRoomId = () => { const v = ctx.voice?.(); return v?.active ? v.channelId : null; };
const sgSame = (x, a) => !!x && !!a && sameGame({ ...x.game, platform: x.platform }, a);
// amigos no mesmo jogo que eu e fora da minha sala (os que ainda valem para o aviso aberto)
const sgApart = (uid, a) => S.rels.get(uid)?.type === 1 && sgSame(activityOf(uid), a) && (!myRoomId() || S.voice.get(uid)?.channel_id !== myRoomId());
let sg = null; // { kind: 'started' | 'already', uids, a, el, timer, tick }
export const sameGameOn = () => S.prefs.sameGameAlert !== false;
function sameGameCheck(uid, prev, now) {
  if (!S.me || !now || !sameGameOn() || S.me.status === 'dnd' || S.me.status === 'invisible') return;
  const a = { platform: now.platform, game: now.game };
  if (prev && sgSame(prev, a)) return; // mesmo jogo de antes (só mudou o "o que está fazendo"): não é novidade
  if (uid === S.me.id) { // abri um jogo: quem já está nele?
    const ids = [...S.rels.values()].filter(r => r.type === 1).map(r => r.user.id).filter(id => sgApart(id, a) && sgFresh(sgKey(id, a)));
    if (ids.length) showSameGame('already', ids, a);
  } else if (sgSame(activityOf(S.me.id), a) && sgApart(uid, a) && sgFresh(sgKey(uid, a))) showSameGame('started', [uid], a);
}
function sgClose() { if (!sg) return; clearInterval(sg.tick); clearTimeout(sg.timer); sg.el.remove(); sg = null; }
function showSameGame(kind, uids, a) {
  if (sg && sg.kind === kind && sgSame(sg.a, a)) uids = [...new Set([...sg.uids, ...uids])]; // outro amigo no mesmo jogo: junta
  sgClose(); sgMark(uids.map(id => sgKey(id, a)));
  sg = { kind, uids, a, el: h('div#samegame-banner', { role: 'alert' }), sig: '' };
  document.body.append(sg.el); sgPaint(true);
  playSound('friend');
  const u = uOf(uids[0]);
  notify(kind === 'started' ? `${u.display_name} começou a jogar ${gameTitle(a)}` : `${nameList(uids.map(uOf))} ${uids.length > 1 ? 'já estão' : 'já está'} jogando ${gameTitle(a)}`, 'Vocês estão no mesmo jogo', () => window.focus(), 'samegame');
  sg.timer = setTimeout(sgClose, 40000);
  sg.tick = setInterval(() => sgPaint(false), 1500); // entrou/saiu de sala, fechou o jogo: o aviso acompanha (ou some)
}
// redesenha só quando a situação muda; sem ninguém que ainda valha, some
function sgPaint(force) {
  if (!sg) return;
  if (!sg.el.isConnected) return sgClose();
  const ids = sg.uids.filter(id => sgApart(id, sg.a));
  if (!ids.length || !sgSame(activityOf(S.me.id), sg.a)) return sgClose();
  const room = ids.map(id => roomOf(id)).find(r => r?.g && r.ch.id !== myRoomId()), inv = ids.filter(id => canCallInvite(id));
  const sig = ids.join() + '|' + (room?.ch.id || '') + '|' + inv.join() + '|' + (myRoomId() || '');
  if (!force && sig === sg.sig) return;
  sg.sig = sig;
  const us = ids.map(uOf), u = us[0], a = sg.a, title = gameTitle(a);
  const head = sg.kind === 'started' && ids.length === 1 ? `${u.display_name} começou a jogar ${title}` : `${nameList(us)} ${ids.length > 1 ? 'já estão' : 'já está'} jogando ${title}`;
  const where = room ? `${chName(room.ch)} · ${room.g.name}` : null;
  const go = (fn) => (e) => { e.stopPropagation(); sgClose(); fn(); };
  const main = room ? h('button.btn.green', { onclick: go(() => { goRoom(room); ctx.joinVoice(room.ch.id); }) }, icon('voice', 14), 'Entrar na sala')
    : inv.length ? h('button.btn.green', { onclick: go(() => inv.forEach(id => sendCallInvite(id))) }, icon('invite', 14), 'Chamar para a call')
    : h('button.btn', { onclick: go(() => ctx.openDM(ids[0])) }, icon('dm', 14), 'Mensagem');
  sg.el.replaceChildren(
    h('div.sg-pic', avatar(u, 44, { status: false }), h('span.sg-game', gameIcon(a, 22))),
    h('div.sg-txt', h('b', head), h('div.sg-sub', where ? [icon('voice', 13), h('span', `Na sala ${where}`)] : h('span', sg.kind === 'started' ? 'Você também está jogando' : 'Vocês estão no mesmo jogo'))),
    h('button.ibtn.sg-x', { title: 'Fechar', onclick: go(() => { }) }, icon('x', 16)),
    h('div.sg-btns',
      h('button.btn.link.sm.sg-off', { title: 'Não mostrar mais este aviso (dá para religar em Configurações → Contas vinculadas)', onclick: go(() => { S.prefs.sameGameAlert = false; savePrefs(); toast('Aviso desligado. Religue em Configurações → Contas vinculadas.'); }) }, 'Não avisar'),
      h('button.btn.grey', { onclick: go(() => { }) }, 'Depois'), main));
}

// ---------------------------------------------------------------- ações reais (só aparecem quando a situação permite)
function voiceActions(uid) {
  const v = S.voice.get(uid), ch = v && channelById(v.channel_id), voice = ctx.voice(), out = [];
  const g = ch && ch.type !== 1 ? guild(ch.guild_id) : null;
  const myCh = voice?.active ? voice.channelId : null;
  if (ch && myCh !== ch.id) out.push(h('button.btn.green.sm', { title: g ? `Entrar em ${g.name}` : 'Entrar na chamada', onclick: (e) => { e.stopPropagation(); ctx.go(g ? g.id : '@me', ch.id); ctx.joinVoice(ch.id); } }, icon('voice', 14), 'Entrar'));
  if (ch && v.screen && (myCh !== ch.id || voice.closedStreams.has(uid))) out.push(h('button.btn.sm', { title: 'Entrar e assistir à transmissão', onclick: (e) => { e.stopPropagation(); ctx.watchFriend(uid, ch); } }, icon('screen', 14), 'Assistir'));
  // convite: estou numa sala de servidor e a pessoa (amiga ou membro do servidor) está online e fora da sala.
  // Quem não é membro recebe o convite e, ao aceitar, entra no servidor e na chamada.
  const u = S.users.get(uid);
  if (u && u.status !== 'offline' && canCallInvite(uid)) out.push(h('button.btn.grey.sm', { title: 'Chamar para a sua chamada (a pessoa recebe um aviso para entrar)', onclick: async (e) => { e.stopPropagation(); await sendCallInvite(uid); } }, icon('invite', 14), 'Convidar'));
  return out;
}

// ---------------------------------------------------------------- painel "Ativo agora"
const STATUS = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };
const uOf = (id) => S.users.get(id) || { id, display_name: '?', username: '?' };
const nameEl = (u) => styleName(h('b', u.display_name), u.name_style);
const roomOf = (uid) => { const v = S.voice.get(uid), ch = v && channelById(v.channel_id); if (!ch) return null; const g = ch.type === 1 ? null : guild(ch.guild_id); return { v, ch, g }; };
const roomLine = (r) => h('div.an-room', icon('voice', 16), h('span', r.g ? `${chName(r.ch)} · ${r.g.name}` : 'Ligação privada'), r.v.screen && h('span.an-live', 'AO VIVO'), r.v.mute && icon('micoff', 14));
const goRoom = (r) => (r.g ? ctx.go(r.g.id, r.ch.id) : ctx.go('@me', r.ch.id));
// para a lista de Amigos (public/home.js): a sala de voz de alguém, entrar nela e a sala em que estou
export const friendRoom = roomOf, myVoiceRoom = () => myRoomId();
export const enterRoom = (r) => { goRoom(r); ctx.joinVoice(r.ch.id); };

// cartão de quem está jogando: arte da Steam (se houver), quem, jogo, há quanto tempo, a sala em que está e as ações possíveis
// "Ativo agora": clicar na pessoa abre a conversa (pedido dos usuários); o perfil fica na foto (e no clique direito)
const profAv = (u, size) => h('span.an-av', { title: 'Ver perfil', onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, u.id); } }, avatar(u, size, { ring: 'var(--bg-sec)' }));
function playCard(uid, a) {
  const u = uOf(uid), r = roomOf(uid), lk = feed?.friends.find(f => f.user_id === uid)?.linked.find(l => l.platform === a.platform);
  return h('div.an-card.an-play', { title: `Mensagem para ${u.display_name}`, onclick: () => ctx.openDM(uid), oncontextmenu: (e) => ctx.userMenu(e, uid) },
    h('div.an-gamelink', { title: `Sobre ${a.game.title}`, onclick: openGame(a) }, gameBanner(a)),
    h('div.an-top', profAv(u, 40), h('div.an-who', nameEl(u), h('small', `${platformName(a.platform)} · ${since(a.since)}`)),
      h('button.ibtn.an-dm', { title: 'Mensagem', onclick: (e) => { e.stopPropagation(); ctx.openDM(uid); } }, icon('dm', 18))),
    h('div.an-game.an-gamelink', { title: `Sobre ${a.game.title}`, onclick: openGame(a) }, gameIcon(a, 22), titleEl(a)),
    r && roomLine(r),
    lk && lk.profile_url && h('a.act-link', { href: lk.profile_url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, `Perfil ${platformName(a.platform)}${lk.name ? ' de ' + lk.name : ''}`),
    h('div.act-btns', ...voiceActions(uid)));
}
// em chamada (sem jogo): a sala, quem é, ao vivo
function voiceCard(uid, r) {
  const u = uOf(uid);
  return h('div.an-card', { title: 'Ir para a sala', onclick: () => goRoom(r), oncontextmenu: (e) => ctx.userMenu(e, uid, r.g?.id) },
    h('div.an-top', { title: `Mensagem para ${u.display_name}`, onclick: (e) => { e.stopPropagation(); ctx.openDM(uid); } }, profAv(u, 40), h('div.an-who', nameEl(u), h('small', r.g ? 'Em chamada de voz' : 'Em uma ligação privada'))),
    roomLine(r),
    h('div.act-btns', ...voiceActions(uid)));
}

// ---------------------------------------------------------------- grupos: vários amigos no mesmo jogo / no mesmo servidor
// Dois ou mais amigos no mesmo jogo viram um cartão só ("Valorant · 2 amigos"), com cada um numa linha e as salas em que
// estão (uma sala com vários deles = um "Entrar" só). Em chamada sem jogo, o mesmo por servidor: as salas do servidor com
// quem está em cada uma. Ligação privada (DM) não agrupa: é de duas pessoas.
const gameKey = (a) => String(a.game?.title || a.game?.id || '').trim().toLowerCase();
const nameList = (us) => us.length <= 2 ? us.map(u => u.display_name).join(' e ') : `${us[0].display_name}, ${us[1].display_name} e mais ${us.length - 2}`;
function memberRow(u, sub) {
  return h('div.an-mem', { title: `Mensagem para ${u.display_name}`, onclick: (e) => { e.stopPropagation(); ctx.openDM(u.id); }, oncontextmenu: (e) => { e.stopPropagation(); ctx.userMenu(e, u.id); } },
    profAv(u, 28), h('div.an-who', nameEl(u), sub && h('small', sub)),
    h('button.ibtn.an-dm', { title: 'Mensagem', onclick: (e) => { e.stopPropagation(); ctx.openDM(u.id); } }, icon('dm', 16)));
}
// as salas em que essas pessoas estão: uma linha por sala, com os rostos de quem está nela e Entrar/Assistir
function roomBlocks(uids, { showGuild = true } = {}) {
  const rooms = new Map();
  for (const id of uids) { const r = roomOf(id); if (!r) continue; let x = rooms.get(r.ch.id); if (!x) rooms.set(r.ch.id, x = { r, ids: [] }); x.ids.push(id); }
  const voice = ctx.voice(), myCh = voice?.active ? voice.channelId : null;
  return [...rooms.values()].map(({ r, ids }) => {
    const live = ids.find(id => S.voice.get(id)?.screen);
    const btns = [
      myCh !== r.ch.id && h('button.btn.green.sm', { title: r.g ? `Entrar em ${chName(r.ch)} (${r.g.name})` : 'Entrar na chamada', onclick: (e) => { e.stopPropagation(); goRoom(r); ctx.joinVoice(r.ch.id); } }, icon('voice', 14), 'Entrar'),
      live && (myCh !== r.ch.id || voice.closedStreams.has(live)) && h('button.btn.sm', { title: 'Entrar e assistir à transmissão', onclick: (e) => { e.stopPropagation(); ctx.watchFriend(live, r.ch); } }, icon('screen', 14), 'Assistir'),
    ].filter(Boolean);
    return h('div.an-rblock', { title: 'Ir para a sala', onclick: (e) => { e.stopPropagation(); goRoom(r); } },
      h('div.an-room', icon('voice', 16), h('span', r.g ? (showGuild ? `${chName(r.ch)} · ${r.g.name}` : chName(r.ch)) : 'Ligação privada'), live && h('span.an-live', 'AO VIVO')),
      h('div.an-rwho', h('span.an-faces', ...ids.slice(0, 5).map(id => avatar(uOf(id), 20, { status: false }))), h('small', nameList(ids.map(uOf))),
        btns.length ? h('div.act-btns', ...btns) : null));
  });
}
function playGroupCard(list) {
  const a = list[0].a, uids = list.map(x => x.u.id);
  return h('div.an-card.an-play.an-group', { 'data-game': gameKey(a), onclick: openGame(a) },
    h('div.an-gamelink', { title: `Sobre ${a.game.title}` }, gameBanner(a)),
    h('div.an-game.an-gamelink', { title: `Sobre ${a.game.title}` }, gameIcon(a, 22), titleEl(a), h('small.an-count', `${list.length} amigos`)),
    h('div.an-mems', ...list.map(({ u, a: x }) => memberRow(u, since(x.since)))),
    ...roomBlocks(uids));
}
function voiceGroupCard(g, list) {
  const first = list[0].r;
  return h('div.an-card.an-group.an-vgroup', { 'data-guild': g.id, title: 'Ir para o servidor', onclick: () => goRoom(first) },
    h('div.an-top', g.icon ? h('img.an-gicon', { src: g.icon, alt: '' }) : h('div.an-gicon', (g.name || '?').slice(0, 2).toUpperCase()),
      h('div.an-who', h('b', g.name), h('small', `${list.length} amigos em chamada`))),
    ...roomBlocks(list.map(x => x.u.id), { showGuild: false }));
}

// ---------------------------------------------------------------- a semana da galera e os clipes da semana
// Retrospectiva dos últimos 7 dias, montada pelo servidor (activity.weekFor): o jogo que marcou a semana num cartão com a
// capa, mais dois em linhas, e os clipes que a galera mais assistiu, favoritou e compartilhou. Nada de lista cronológica.
const durShort = (s) => { const m = Math.round(s / 60), hh = Math.floor(m / 60), mm = m % 60; return hh ? `${hh}h${mm ? ' ' + String(mm).padStart(2, '0') + 'min' : ''}` : `${m} min`; };
const hrs = (s) => { const x = s / 3600; return x >= 10 ? Math.round(x) + 'h' : x >= 1 ? String(Math.round(x * 10) / 10).replace('.', ',') + 'h' : Math.max(1, Math.round(s / 60)) + ' min'; };
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'], WDN = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dayOf = (k) => new Date(k + 'T12:00:00');
const weekRange = (days) => { const a = dayOf(days[0]), b = dayOf(days[days.length - 1]), m = (d) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`; };
const people = (n) => n === 1 ? '1 pessoa' : `${n} pessoas`;
const nPeople = (x) => x.players.length + (x.anon || 0); // identificados + quem conta sem aparecer
// a semana em 7 barrinhas (altura = horas do dia); com rótulos no cartão principal
function weekBars(x, days, labels) {
  const max = Math.max(...x.day, 1), today = days.length - 1;
  return h('div.wk-bars' + (labels ? '.lab' : ''), { 'aria-hidden': 'true' }, x.day.map((s, i) => {
    const d = dayOf(days[i]).getDay();
    return h('span.wk-bar' + (s > 0 ? '.on' : '') + (i === today ? '.today' : ''), { title: `${WDN[d]}: ${s > 0 ? hrs(s) : 'ninguém jogou'}` },
      h('i', { style: { height: (s > 0 ? Math.max(14, Math.round(s / max * 100)) : 0) + '%' } }), labels && h('small', WD[d]));
  }));
}
// anon: quem jogou mas não dá para identificar (jogo do PC em "Ninguém", invisível): entra só no "+N"
function avatarStack(list, n = 4, anon = 0, size = 24) {
  const shown = list.slice(0, n), rest = list.length - shown.length + (anon || 0);
  return h('div.wk-stack', ...shown.map(p => { const u = uOf(p.user_id); return h('span.wk-av', { title: `${p.user_id === S.me.id ? 'Você' : u.display_name} · ${hrs(p.secs)}`, onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, p.user_id); } }, avatar(u, size, { status: false })); }),
    rest > 0 && h('span.wk-av.more', { style: size !== 24 ? { width: size + 'px', height: size + 'px' } : null }, `+${rest}`));
}
function heroArt(a) {
  const box = h('div.wk-art'), kg = knownGame(a.game), sid = steamIdOf(a) || kg?.steam;
  const set = (src) => box.replaceChildren(h('img', { src, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => { box.replaceChildren(fallback()); box.classList.add('ph'); } }));
  const fallback = () => h('span.wk-artic', gameIcon(a, 120)); // sem capa: o ícone grande e desfocado vira o fundo
  if (kg?.banner) set(kg.banner);
  else { box.classList.add('ph'); box.append(fallback()); if (sid) steamArt(sid).then(x => { if (x?.image) { box.classList.remove('ph'); set(x.image); } }); }
  return box;
}
function gameHero(x, days) {
  const a = { platform: x.platform, game: x.game };
  return h('div.wk-hero', { role: 'button', tabindex: 0, title: `Sobre ${x.game.title}`, onclick: openGame(a), onkeydown: (e) => { if (e.key === 'Enter') openGame(a)(e); } },
    heroArt(a), h('div.wk-shade'),
    h('div.wk-hin',
      h('div.wk-htop', h('span.wk-chip.gold', icon('trophy', 12), 'Jogo da semana'), x.playing.length > 0 && h('span.wk-live', h('i'), `${x.playing.length} jogando agora`)),
      titleEl(a, 'b.wk-title'),
      h('div.wk-stats',
        h('div', h('b', hrs(x.secs)), h('small', 'de jogo')),
        h('div', h('b', String(nPeople(x))), h('small', nPeople(x) === 1 ? 'pessoa' : 'pessoas')),
        x.streak >= 2 && h('div', h('b', String(x.streak)), h('small', 'dias seguidos'))),
      h('div.wk-hfoot', avatarStack(x.players, 4, x.anon), weekBars(x, days, true))));
}
function gameRow(x, rank, days) {
  const a = { platform: x.platform, game: x.game };
  return h('div.wk-row', { role: 'button', tabindex: 0, title: `Sobre ${x.game.title}`, onclick: openGame(a), onkeydown: (e) => { if (e.key === 'Enter') openGame(a)(e); } },
    h('span.wk-rank', String(rank)), gameIcon(a, 36),
    // quem jogou, com os rostos (antes só "3 pessoas": dava para ver o número, mas não quem)
    h('div.wk-rtxt', titleEl(a, 'b'), h('div.wk-rsub', avatarStack(x.players, 3, x.anon, 18), h('small', [hrs(x.secs), people(nPeople(x)), x.streak >= 2 && `${x.streak} dias seguidos`].filter(Boolean).join(' · ')))),
    weekBars(x, days, false));
}
// ---- clipes
// Ranking ponderado da semana (server/clipstats.js): Top 3 (expande para Top 5), categorias especiais e recomendados.
const CLIP_TAG = {
  you: ['sparkle', 'Você aparece', 'green', 'Clipe da sua transmissão'], foryou: ['gamepad', 'Pra você', 'green', 'De um jogo que você jogou esta semana e ainda não assistiu'],
  hot: ['fire', 'Em alta', 'fire', 'Muita gente assistiu nas últimas 24 horas'], fav: ['star', 'Favorito da galera', 'gold', 'O clipe mais favoritado da semana'],
  shared: ['clipshare', 'Mais compartilhado', 'blue', 'O clipe mais compartilhado da semana'], talk: ['smile', 'Deu o que falar', 'pink', 'O clipe com mais reações e respostas'],
  views: ['eye', 'Mais visto', 'blue', 'O clipe com mais visualizações da semana'],
  popular: ['eye', 'Mais popular', 'blue', 'O clipe com mais visualizações qualificadas da semana'], crowd: ['heart', 'Favorito da galera', 'pink', 'O clipe com mais curtidas da semana'],
  surprise: ['bolt', 'Surpresa da semana', 'fire', 'Cresceu rápido: muito acima do normal de quem postou, nas últimas 48 h'], discovery: ['compass', 'Descoberta', 'green', 'Pouca gente viu, e quem viu adorou'],
};
const clipTag = (t) => { const d = CLIP_TAG[t]; return d && h('span.wk-chip.' + d[2], { title: d[3] }, icon(d[0], 12), d[1]); };
const nfmt = (n) => n >= 1000 ? (Math.round(n / 100) / 10).toString().replace('.', ',') + ' mil' : String(n || 0);
const METRIC = [['views', 'eye', 'visualizações', 'visualização'], ['likes', 'heart', 'curtidas', 'curtida'], ['shares', 'clipshare', 'compartilhamentos', 'compartilhamento']];
const clipMetrics = (m, ret) => h('div.wk-met', ...METRIC.map(([k, ic, pl, sg]) => h('span', { title: `${m[k] || 0} ${m[k] === 1 ? sg : pl}` }, icon(ic, 13), nfmt(m[k]))),
  ret && m.retention != null && h('span.wk-ret', { title: `Quem assiste vê, em média, ${m.retention}% do clipe` }, icon('clock', 13), m.retention + '%'));
const clipBy = (c) => { const u = uOf(c.author_id); return [h('b.wk-who', { title: 'Ver perfil', onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, c.author_id); } }, c.author_id === S.me.id ? 'Você' : u.display_name), c.game && h('span', ' · ', titleEl({ platform: c.platform, game: c.game }))]; };
function clipThumb(c, big, rank) {
  const src = thumbUrl(c.url);
  return h('div.wk-thumb', src ? h('img', { src, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : '', h('span.wk-play', icon('play', big ? 22 : 14)), h('span.wk-dur', `${c.secs || 0}s`),
    big && h('span.wk-chip.gold.wk-ribbon', icon('trophy', 12), 'Clipe da semana'), rank && h('span.wk-rk', String(rank)));
}
const clipAttrs = (c) => { const open = () => openClip(c.id); return { role: 'button', tabindex: 0, title: 'Assistir ao clipe', 'data-clip': c.id, onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); }, oncontextmenu: (e) => ctx.userMenu(e, c.author_id) }; };
function clipCard(c, i) {
  const u = uOf(c.author_id);
  if (!c.tag && c.you) c = { ...c, tag: 'you' }; // clipe da sua transmissão no ranking: "Você aparece"
  if (i === 0) return h('div.wk-clip.big', clipAttrs(c),
    clipThumb(c, true),
    h('div.wk-cinfo', avatar(u, 28, { status: false }), h('div.wk-ctxt', c.tag && clipTag(c.tag), h('b.wk-ctitle', c.title || 'Clipe'), h('small', clipBy(c)))),
    clipMetrics(c.metrics, true));
  return h('div.wk-clip.row', clipAttrs(c),
    clipThumb(c, false, i + 1),
    h('div.wk-ctxt', c.tag && clipTag(c.tag), h('b.wk-ctitle', c.title || 'Clipe'), h('small', clipBy(c)), clipMetrics(c.metrics)));
}
// categoria especial / recomendado: linha compacta com o selo (ou o motivo) em cima
const REC_IC = { you: 'sparkle', game: 'gamepad', creator: 'user', friends: 'users', buddy: 'users', quality: 'fire' };
function miniClip(c, top) {
  return h('div.wk-clip.row.mini', clipAttrs(c), clipThumb(c, false),
    h('div.wk-ctxt', top, h('b.wk-ctitle', c.title || 'Clipe'), h('small', clipBy(c)), clipMetrics(c.metrics)));
}
// métricas em tempo real (CLIP_STATS): atualiza os números do clipe onde ele aparecer no painel (ranking, destaques,
// recomendados). A ORDEM do ranking não muda na hora: é recalculada quando o painel recarrega (evita cartões pulando)
export function onClipStats(d) {
  const w = feed?.week; if (!w) return;
  const id = String(d.id); let hit = false;
  for (const c of [...(w.clips || []), ...(w.clip_categories || []).map(x => x.clip), ...(w.clip_recs || [])])
    if (String(c.id) === id) { c.metrics = { ...c.metrics, ...d.stats }; hit = true; }
  if (hit && document.getElementById('actfeed')) S.redrawFeed?.();
}
let topOpen = false; // Top 3 → Top 5 (fica aberto enquanto o app está aberto)
function clipSections(w) {
  const list = w.clips || [], cats = w.clip_categories || [], recs = w.clip_recs || [];
  const shown = topOpen ? list : list.slice(0, 3);
  const more = list.length > 3 && h('button.wk-more', { type: 'button', 'aria-expanded': String(topOpen), onclick: () => { topOpen = !topOpen; S.redrawFeed?.(); } },
    topOpen ? 'Ver só o top 3' : `Ver top ${list.length}`, icon('chevdown', 14));
  const top = h('section.wk.wk-clips', h('div.wk-h', h('h4', 'Clipes da semana'), list.length > 0 && h('small', topOpen ? `top ${list.length}` : 'top 3')),
    list.length ? [...shown.map(clipCard), more, w.clip_quiet && h('p.wk-note', icon('info', 13), 'Semana devagar: poucos clipes com visualizações suficientes para o ranking.')]
      : h('p.wk-empty', icon('clip', 18), h('span', 'Nenhum clipe se destacou ainda. Entram no ranking os clipes com pelo menos 3 pessoas que assistiram de verdade.')));
  const out = [top];
  // categoria cujo clipe já está à vista no ranking: só o selo no cartão; as outras ganham a seção própria
  const seenIds = new Set(shown.map(c => c.id)), extra = cats.filter(x => !seenIds.has(x.clip.id));
  if (extra.length) out.push(h('section.wk.wk-cats', h('div.wk-h', h('h4', 'Destaques especiais')),
    ...extra.map(x => miniClip(x.clip, h('span.wk-cattop', clipTag(x.kind), x.why && h('small.wk-why', x.why))))));
  if (recs.length) out.push(h('section.wk.wk-recs', h('div.wk-h', h('h4', 'Recomendados pra você')),
    ...recs.map(c => miniClip(c, c.reason && h('span.wk-reason', { title: 'Por que este clipe' }, icon(REC_IC[c.reason.kind] || 'sparkle', 12), c.reason.text)))));
  return out;
}
function weekSections() {
  if (!feed) return [h('section.wk', h('div.wk-h', h('h4', 'A semana da galera')), skeleton('rows', 3))];
  const w = feed.week || { days: [], games: [], clips: [] }, range = w.days?.length ? weekRange(w.days) : '';
  const [first, ...rest] = w.games;
  const games = h('section.wk.wk-games', h('div.wk-h', h('h4', 'A semana da galera'), range && h('small', range)),
    first ? [gameHero(first, w.days), rest.length > 0 && h('div.wk-rows', ...rest.map((x, i) => gameRow(x, i + 2, w.days)))]
      : h('p.wk-empty', icon('gamepad', 18), h('span', 'Semana tranquila até agora. Os jogos que tomarem o tempo da galera aparecem aqui.')));
  return [games, ...clipSections(w)];
}

// ---------------------------------------------------------------- pedidos de amizade e convites para a chamada
// Primeira coisa do painel: quem quer ser seu amigo e quem chamou você para a sala, com a resposta ali mesmo.
const mins = (t) => { const m = Math.max(1, Math.ceil((t - Date.now()) / 60000)); return m === 1 ? '1 min' : m + ' min'; };
function requestCards() {
  const reqs = [...S.rels.values()].filter(r => r.type === 3).map(r => uOf(r.user.id)), invs = pendingInvites();
  if (!reqs.length && !invs.length) return [];
  const card = (u, kind, sub, btns) => h('div.an-card.an-req.' + kind, { onclick: (e) => ctx.profile(e.currentTarget, u.id), oncontextmenu: (e) => ctx.userMenu(e, u.id) },
    h('div.an-top', avatar(u, 40, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(u), h('small', sub)),
      h('span.an-reqic', icon(kind === 'inv' ? 'voice' : 'users', 16))),
    h('div.act-btns', ...btns));
  return [h('div.an-cap', `Para você — ${reqs.length + invs.length}`),
    ...invs.map(i => { const u = S.users.get(i.from.id) || i.from; return card(u, 'inv', `Chamou você para ${i.channel.name} · ${i.guild.name} · expira em ${mins(i.expires_at)}`, [
      h('button.btn.green.sm', { onclick: (e) => { e.stopPropagation(); return acceptInvite(i.id); } }, icon('voice', 14), i.member ? 'Entrar' : 'Entrar no servidor'),
      h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); return declineInvite(i.id); } }, 'Recusar')]); }),
    ...reqs.map(u => card(u, 'req', 'Quer ser seu amigo', [
      h('button.btn.green.sm', { onclick: (e) => { e.stopPropagation(); return tryApi('PUT', `/relationships/${u.id}`, {}); } }, icon('check', 14), 'Aceitar'),
      h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); return tryApi('DELETE', `/relationships/${u.id}`); } }, 'Ignorar')]))];
}

// ---------------------------------------------------------------- gente dos seus servidores (não amigos) + sugestões de amizade
// Quem divide um servidor com você e está jogando ou numa sala de voz desse servidor. Online parado não entra (seria barulho).
// O jogo só chega se a pessoa deixou "Amigos e quem está nos meus servidores" (o padrão); a regra é do servidor (canSee).
// Quem joga o mesmo que você ou que um amigo, ou está na mesma sala, vira "Talvez você conheça", com o motivo e Adicionar.
const SUG_HIDE_DAYS = 30, SRV_MAX = 6;
let srvMore = false;
const sugHidden = (uid) => { const t = S.prefs.anSugHide?.[uid]; return !!t && Date.now() - t < SUG_HIDE_DAYS * 864e5; };
function hideSug(uid) {
  const m = (S.prefs.anSugHide ||= {}), lim = Date.now() - SUG_HIDE_DAYS * 864e5;
  for (const k of Object.keys(m)) if (m[k] < lim) delete m[k]; // não acumula para sempre
  m[uid] = Date.now(); savePrefs();
}
function serverPeers() {
  const ids = new Set();
  for (const g of S.guilds.values()) for (const id of g.members?.keys?.() || []) ids.add(id);
  for (const [id, v] of S.voice) { const ch = channelById(v.channel_id); if (ch && ch.type !== 1 && guild(ch.guild_id) && !v.bot) ids.add(id); } // lista de membros ainda parcial
  const out = [];
  for (const id of ids) {
    const rt = S.rels.get(id)?.type || 0;
    if (id === S.me.id || rt === 1 || rt === 2 || rt === 3 || S.voice.get(id)?.bot) continue; // amigo, bloqueado, pedido recebido (já aparece em "Para você")
    const a = activityOf(id), r0 = roomOf(id), r = r0?.g ? r0 : null; // ligação privada de quem não é amigo não conta
    if (a || r) out.push({ u: uOf(id), a, r, rt });
  }
  return out;
}
const sharedGuilds = (uid) => [...S.guilds.values()].filter(g => g.members?.has?.(uid)).length;
// por que sugerir: a pontuação ordena; só entra quem tem algo em comum AGORA (não basta estar no mesmo servidor)
function suggestReason(p, ctx2) {
  let score = 0, why = null;
  const gk = p.a && gameKey(p.a);
  if (gk && ctx2.myGame === gk) { score += 3; why ||= `Também está jogando ${p.a.game.title}`; }
  if (p.r && ctx2.myRoom === p.r.ch.id) { score += 3; why ||= 'Na mesma chamada que você'; }
  const fr = p.r && ctx2.friendRooms.get(p.r.ch.id);
  if (fr) { score += 2; why ||= `Na chamada com ${nameList(fr.slice(0, 2))}`; }
  const fg = gk && ctx2.friendGames.get(gk);
  if (fg) { score += 2; why ||= `Joga ${p.a.game.title}, como ${nameList(fg.slice(0, 2))}`; }
  const n = sharedGuilds(p.u.id);
  if (n >= 2) { score += 1; why ||= `${n} servidores em comum`; }
  return { score, why };
}
function addFriend(u, btn, redraw) {
  btn.disabled = true;
  return tryApi('POST', '/relationships', { username: u.username }).then(r => {
    if (r) { toast(`Pedido de amizade enviado para ${u.display_name}`); if (!S.rels.has(u.id)) S.rels.set(u.id, { type: 4, user: { id: u.id } }); }
    else btn.disabled = false; // privacidade de pedidos da pessoa, por exemplo: o erro já apareceu
    redraw();
  });
}
const addBtn = (p, redraw, label) => p.rt === 4
  ? h('span.an-sent', { title: 'Pedido de amizade enviado' }, icon('check', 14), label ? 'Pedido enviado' : null)
  : h('button.btn.sm' + (label ? '.an-addbtn' : '.grey.ibtn-add'), { title: `Adicionar ${p.u.display_name} como amigo`, onclick: (e) => { e.stopPropagation(); addFriend(p.u, e.currentTarget, redraw); } }, icon('plus', 14), label ? 'Adicionar' : null);
function serverSection(friendsNow, redraw) {
  const peers = serverPeers();
  if (!peers.length) return [];
  const mine = activityOf(S.me.id), voice = ctx.voice();
  const ctx2 = { myGame: mine && gameKey(mine), myRoom: voice?.active ? voice.channelId : null, friendRooms: new Map(), friendGames: new Map() };
  for (const f of friendsNow) {
    if (f.r) { const l = ctx2.friendRooms.get(f.r.ch.id) || []; l.push(f.u); ctx2.friendRooms.set(f.r.ch.id, l); }
    if (f.a) { const k = gameKey(f.a), l = ctx2.friendGames.get(k) || []; l.push(f.u); ctx2.friendGames.set(k, l); }
  }
  const sugs = peers.filter(p => p.rt === 0 && !sugHidden(p.u.id)).map(p => ({ p, ...suggestReason(p, ctx2) })).filter(x => x.score >= 2)
    .sort((x, y) => y.score - x.score || (x.p.u.display_name || '').localeCompare(y.p.u.display_name || '')).slice(0, 3);
  const sugIds = new Set(sugs.map(x => x.p.u.id));
  const rest = peers.filter(p => !sugIds.has(p.u.id)).sort((x, y) => (!!y.a - !!x.a) || (x.a && y.a ? x.a.since - y.a.since : 0) || (x.u.display_name || '').localeCompare(y.u.display_name || ''));
  // título, contador e recolher ficam no cabeçalho da seção do painel (anSection 'servers')
  const sub = (p) => p.a ? h('small.an-sub', gameIcon(p.a, 14), h('span', playingLine(p.a))) : h('small.an-sub', icon('voice', 14), h('span', `${chName(p.r.ch)} · ${p.r.g.name}`));
  const sugCard = ({ p, why }) => h('div.an-sug', { onclick: (e) => ctx.profile(e.currentTarget, p.u.id), oncontextmenu: (e) => ctx.userMenu(e, p.u.id) },
    h('div.an-sugtop', avatar(p.u, 36, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(p.u), h('small.an-why', why)),
      h('button.ibtn.an-sugx', { title: `Não sugerir ${p.u.display_name} por ${SUG_HIDE_DAYS} dias`, onclick: (e) => { e.stopPropagation(); hideSug(p.u.id); redraw(); } }, icon('x', 14))),
    addBtn(p, redraw, true));
  const rowEl = (p) => h('div.an-row.an-srv', { title: p.r ? 'Ver perfil (clique direito: mais opções)' : 'Ver perfil', onclick: (e) => ctx.profile(e.currentTarget, p.u.id), oncontextmenu: (e) => ctx.userMenu(e, p.u.id, p.r?.g?.id) },
    avatar(p.u, 32, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(p.u), sub(p)),
    p.rt === 0 || p.rt === 4 ? addBtn(p, redraw, false) : null);
  const shown = srvMore ? rest : rest.slice(0, SRV_MAX), more = rest.length - shown.length;
  const out = [
    sugs.length ? h('div.an-sugs', h('div.an-sugh', icon('users', 14), 'Talvez você conheça'), ...sugs.map(sugCard)) : null,
    ...shown.map(rowEl),
    more > 0 && h('button.hl-more', { onclick: () => { srvMore = true; redraw(); } }, icon('chevdown', 14), `Mostrar mais ${more}`),
    srvMore && rest.length > SRV_MAX && h('button.hl-more', { onclick: () => { srvMore = false; redraw(); } }, h('span.hl-up', icon('chevdown', 14)), 'Mostrar menos')].filter(Boolean);
  out.count = peers.length;
  return out;
}

// ---------------------------------------------------------------- memória do grupo: "Desde a última vez" e "Nos últimos dias"
// "Desde a última vez" (GET /activity/since, server/sessions.js): quem volta depois de 2 h ou mais vê, no topo do painel, as
// sessões de voz que aconteceram sem ela, os eventos marcados e o clipe mais visto, cada um com a ação (Entrar na sala, Ver
// evento, Ver clipe). Dispensar marca "vi até agora" no servidor (POST /activity/seen), o que vale em todos os aparelhos.
// Servidor antigo (sem a rota): nada aparece. Quem decide o que cada um vê (sala, quem aparece pelo nome) é o servidor.
const AWAY_MIN = 2 * 3600e3, AWAY_TTL = 60e3, RECENT_MAX = 5;
let away = null, awayAt = 0, awayReq = null; // última resposta de /activity/since (null: nada a mostrar ou rota ausente)
// o painel pode ser montado de novo enquanto o pedido ainda está a caminho (a Home se redesenha ao abrir): quem chega
// nesse meio-tempo espera o MESMO pedido, em vez de desenhar sem a resposta e perdê-la
function loadSince() {
  if (awayReq) return awayReq;
  if (Date.now() - awayAt < AWAY_TTL) return Promise.resolve(); // trocar de aba no início não repete o pedido a cada vez
  awayAt = Date.now();
  return (awayReq = api('GET', '/activity/since').then((r) => {
    for (const u of r?.users || []) if (!S.users.has(u.id)) S.users.set(u.id, u);
    away = r && Array.isArray(r.items) ? r : null;
  }, () => { away = null; }).finally(() => { awayReq = null; })); // 404 (servidor ainda sem a memória) ou fora do ar: sem faixa e sem aviso
}
function dismissSince() {
  away = null; awayAt = Date.now(); S.redrawFeed?.();
  api('POST', '/activity/seen').catch(() => { }); // se falhar, a faixa volta numa próxima abertura, sem incomodar agora
}
// dias de calendário entre t e hoje (positivo = passado): "hoje", "ontem", "sexta"…
const dayDiff = (t) => { const a = new Date(t), b = new Date(); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 864e5); };
const dayWord = (t) => { const d = dayDiff(t); return d === 0 ? 'hoje' : d === 1 ? 'ontem' : d === -1 ? 'amanhã' : Math.abs(d) < 7 ? WDN[new Date(t).getDay()] : new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', ''); };
const daysAgo = (t) => { const d = dayDiff(t); return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`; };
const hourWord = (t) => { const d = new Date(t), m = d.getMinutes(); return d.getHours() + 'h' + (m ? String(m).padStart(2, '0') : ''); };
const hm2 = (s) => { const m = Math.max(1, Math.round(s / 60)); if (m < 60) return m + ' min'; const hh = Math.floor(m / 60), mm = m % 60; return hh + 'h' + (mm ? String(mm).padStart(2, '0') : ''); };
const awayWord = (ms) => { const hh = Math.floor(ms / 3600e3); return hh < 24 ? `há ${hh} h` : `há ${Math.floor(hh / 24)} ${hh < 48 ? 'dia' : 'dias'}`; };
const shortTitle = (t) => knownGame({ title: t })?.title || t;
// "Ana, Beto e +1": até dois nomes; o resto (e quem o servidor não deixa você ver pelo nome) vira "+N"
function whoLine(ids, hidden) {
  const names = ids.map(id => (id === S.me.id ? 'Você' : uOf(id).display_name)), extra = Math.max(0, names.length - 2) + (hidden || 0);
  if (!names.length) return `${hidden || 2} pessoas`;
  if (names.length === 3 && !hidden) return `${names[0]}, ${names[1]} e ${names[2]}`;
  const two = names.slice(0, 2);
  return extra ? `${two.join(', ')} e +${extra}` : two.join(' e ');
}
const sinceRow = (kind, ic, main, sub, btn) => h('div.an-si.' + kind, { 'data-kind': kind },
  h('span.an-siic', ic), h('div.an-sit', h('span.an-simain', ...[main].flat(2).filter(Boolean)), sub && h('small.an-sisub', ...[sub].flat().filter(Boolean)), btn || null));
function sessionItem(it) {
  const games = (it.games || []).filter(g => g?.title).slice(0, 2).map(g => shortTitle(g.title)), mem = it.members || [];
  const ch = it.channel_exists ? channelById(it.channel_id) : null, g = ch && guild(ch.guild_id);
  const join = ch && g && myRoomId() !== ch.id && h('button.btn.green.sm', { title: `Entrar em ${chName(ch)} (${g.name})`, onclick: (e) => { e.stopPropagation(); enterRoom({ ch, g }); } }, icon('voice', 14), 'Entrar na sala');
  return sinceRow('sess', icon('voice', 16),
    [h('b', whoLine(mem, it.hidden)), ` ficaram ${hm2(it.secs || 0)} na ${it.channel_name || 'sala'}`, games.length > 0 && [' jogando ', h('b', games.join(' e '))], it.clips > 0 && ` · ${it.clips} ${it.clips === 1 ? 'clipe' : 'clipes'}`],
    [mem.length > 0 && h('span.an-faces', ...mem.slice(0, 4).map(id => avatar(uOf(id), 16, { status: false }))), h('span', [`${dayWord(it.ended_at)} ${hourWord(it.ended_at)}`, it.guild_name].filter(Boolean).join(' · '))],
    h('span.an-sibtns', join || null, h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); openNight(it.id); } }, 'Ver a noite')));
}
function eventItem(it) {
  const g = guild(it.guild_id);
  return sinceRow('ev', icon('calendar', 16),
    [`Evento ${dayWord(it.starts_at)} ${hourWord(it.starts_at)}: `, h('b', it.title || 'Evento')],
    h('span', [it.game && shortTitle(it.game), it.guild_name].filter(Boolean).join(' · ')),
    g && h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); ctx.go(g.id, 'events'); } }, icon('calendar', 14), 'Ver evento'));
}
function clipItem(it, first) {
  const u = uOf(it.author_id);
  return sinceRow('clip', icon('clip', 16),
    [first ? 'Clipe mais visto: ' : 'Também bombou: ', h('b', it.title || 'Clipe')],
    h('span', [`de ${it.author_id === S.me.id ? 'você' : u.display_name}`, it.views > 0 && `${it.views} ${it.views === 1 ? 'visualização' : 'visualizações'}`].filter(Boolean).join(' · ')),
    h('button.btn.grey.sm', { onclick: (e) => { e.stopPropagation(); openClip(it.id); } }, icon('play', 14), 'Ver clipe'));
}
function nightItem(it) {
  const games = (it.games || []).filter(g => g?.title).slice(0, 2).map(g => shortTitle(g.title)), others = (it.members || []).filter(id => id !== S.me.id);
  return sinceRow('night', icon('moon', 16),
    [h('b', `A Noite ${nightDay(it.ended_at)}`), ' está pronta: ', it.title || ''],
    [others.length > 0 && h('span.an-faces', ...others.slice(0, 4).map(id => avatar(uOf(id), 16, { status: false }))), h('span', [others.length ? `com ${whoLine(others, it.hidden)}` : '', games.length ? games.join(' e ') : '', it.clips ? `${it.clips} ${it.clips === 1 ? 'clipe' : 'clipes'}` : '', it.gg ? `${it.gg} GG` : ''].filter(Boolean).join(' · '))],
    h('button.btn.green.sm', { onclick: (e) => { e.stopPropagation(); openNight(it.id); } }, icon('moon', 14), 'Ver a noite'));
}
function sinceStrip() {
  const d = away; if (!d?.items?.length || !(d.away_ms >= AWAY_MIN)) return null;
  let clips = 0;
  const rows = d.items.slice(0, 6).map(it => (it.type === 'night' ? nightItem(it) : it.type === 'session' ? sessionItem(it) : it.type === 'event' ? eventItem(it) : it.type === 'clip' ? clipItem(it, clips++ === 0) : null)).filter(Boolean);
  if (!rows.length) return null;
  return h('section.an-since', { 'aria-label': 'Desde a última vez' },
    h('div.an-sinceh', h('b', 'Desde a última vez'), h('small', `você saiu ${awayWord(d.away_ms)}`),
      h('button.ibtn.an-sincex', { title: 'Dispensar (marca como visto em todos os aparelhos)', 'aria-label': 'Dispensar', onclick: dismissSince }, icon('x', 16))),
    ...rows);
}
// "Nos últimos dias": o feed.events (jogos que os amigos fecharam nos últimos 7 dias), uma linha por pessoa com os jogos dela
// (somando o tempo de cada jogo). Quem está jogando o mesmo jogo agora já aparece em "Jogando" e aquele jogo não se repete aqui.
function recentGames() {
  const people = new Map();
  for (const ev of feed?.events || []) {
    if (ev.kind !== 'game_stop' || ev.user_id === S.me.id || !ev.game?.title) continue;
    const a = { platform: ev.platform, game: ev.game }, cur = activityOf(ev.user_id);
    if (cur && sameGameAs(cur, a)) continue;
    let p = people.get(ev.user_id); if (!p) people.set(ev.user_id, p = { uid: ev.user_id, games: new Map(), secs: 0, at: 0 });
    const k = gameKey(a);
    let x = p.games.get(k); if (!x) p.games.set(k, x = { a, secs: 0, at: 0 });
    x.secs += ev.seconds || 0; x.at = Math.max(x.at, ev.at || 0);
    p.secs += ev.seconds || 0; p.at = Math.max(p.at, ev.at || 0);
  }
  const list = [...people.values()].sort((p, q) => q.at - p.at).slice(0, RECENT_MAX);
  for (const p of list) {
    // o jogo em que a pessoa ficou mais tempo primeiro; empate: o mais recente
    p.games = [...p.games.values()].sort((x, y) => y.secs - x.secs || y.at - x.at);
    // ícone do jogo: a retrospectiva da semana guarda o do programa e o número na Steam (o evento só traz id e nome)
    for (const x of p.games) {
      const w = (feed.week?.played || []).find(q => q.user_id === p.uid && sameGame({ ...q.game, platform: q.platform }, x.a));
      if (w) x.a = { platform: x.a.platform, game: { ...x.a.game, icon: w.game.icon, steam: w.game.steam } };
    }
  }
  return list;
}
const RECENT_CHIPS = 3;
const recentRow = (p) => {
  const u = uOf(p.uid), top = p.games[0].a, more = p.games.length > 1;
  const sub = more ? h('small.an-sub', h('span', `Jogou ${p.games.length} jogos`, p.secs >= 60 ? ' · ' + hm2(p.secs) + ' no total' : ''))
    : h('small.an-sub', gameIcon(top, 14), h('span', 'Jogou ', titleEl(top), [p.secs >= 60 && hm2(p.secs), daysAgo(p.at)].filter(Boolean).map(t => ' · ' + t).join('')));
  const chip = (x) => h('button.an-pgame', { type: 'button', title: `Sobre ${x.a.game.title}` + (x.secs >= 60 ? ` · ${hm2(x.secs)}` : '') + ` · ${daysAgo(x.at)}`, onclick: openGame(x.a) },
    gameIcon(x.a, 16), h('span.an-pgt', x.a.game.title), x.secs >= 60 && h('span.an-pgs', hm2(x.secs)));
  return h('div.an-row.an-past' + (more ? '.multi' : ''), { 'data-uid': p.uid, 'data-secs': String(p.secs), title: more ? null : `Sobre ${top.game.title}`, onclick: openGame(top), oncontextmenu: (e) => ctx.userMenu(e, p.uid) },
    profAv(u, 32),
    h('div.an-who', h('div.an-pname', nameEl(u), more && h('small.an-when', daysAgo(p.at))), sub,
      more && h('div.an-pgames', p.games.slice(0, RECENT_CHIPS).map(chip), p.games.length > RECENT_CHIPS && h('span.an-pmore', { title: p.games.slice(RECENT_CHIPS).map(x => x.a.game.title).join(', ') }, '+' + (p.games.length - RECENT_CHIPS)))));
};

// painel inteiro. Topo, em destaque: o que os amigos estão fazendo AGORA (jogando, em chamada, online). Embaixo: os destaques.
// "Procurando grupo": anúncios abertos de amigos e de quem divide servidor com você (Procurar jogadores), amigos primeiro,
// com Entrar direto; "Ver todos" abre o mural
function lfgSection() {
  const fr = (p) => S.rels.get(p.author.id)?.type === 1;
  const ads = openPosts().sort((a, b) => fr(b) - fr(a));
  if (!ads.length) return '';
  return h('section.an-lfg', h('div.an-cap', `Procurando grupo — ${ads.length}`, ads.length > 3 && h('button.an-capbtn', { type: 'button', onclick: () => ctx.go('@me', 'lfg') }, 'Ver todos')), ...ads.slice(0, 3).map(lfgMini));
}
// ---------------------------------------------------------------- fase de uso: o painel se adapta a quem está chegando
// Quem acabou de criar a conta (ou quase não tem amigos/servidores) vê os "Primeiros passos", uma explicação curta em cada
// seção e o que ajuda a se enturmar primeiro (destaques da semana, gente dos servidores). Quem já usa há tempo vê o painel
// enxuto: o que pede resposta, o que perdeu e quem está jogando agora; nada de explicação. Conta: idade da conta, amigos,
// servidores e o quanto a pessoa fala e entra em chamada nos servidores (últimos 14 dias, GET /activity/feed → me).
// A pessoa pode fixar a fase no ⋯ do painel (S.prefs.anStage); a ordem que ela arrastou continua valendo em qualquer fase.
const STAGES = { novo: 'Começando agora', chegando: 'Pegando o jeito', veterano: 'Já conheço tudo' };
const STAGE_HINT = { novo: 'Primeiros passos e explicações em cada parte', chegando: 'Atalhos para jogar e conhecer a turma', veterano: 'Só o que está rolando e o que você perdeu' };
const AN_STAGE_ORDER = {
  // "Desde a última vez" só aparece depois de 2 h fora e some ao dispensar: fica no alto em qualquer fase
  novo: ['forme', 'since', 'start', 'now', 'play', 'servers', 'week', 'lfg', 'recent'],
  chegando: ['forme', 'since', 'start', 'now', 'play', 'lfg', 'servers', 'week', 'recent'],
  veterano: ['forme', 'since', 'now', 'play', 'lfg', 'recent', 'servers', 'week', 'start'],
};
function usageStats() {
  const m = feed?.me, friends = [...S.rels.values()].filter(r => r.type === 1).length;
  return { friends, guilds: S.guilds.size, age: S.me?.created_at ? (Date.now() - S.me.created_at) / 864e5 : 365,
    msgs14: m?.msgs14 || 0, calls14: m?.calls14 || 0, msgsAny: !!m?.msgs_any, callsAny: !!m?.calls_any, known: !!m };
}
// pontos de uso: amigos (3+, 10+), servidor, conversa (30+ mensagens em 14 dias), chamadas (3+ em 14 dias), conta de 30+ dias
function autoStage(x) {
  const pts = (x.friends >= 3) + (x.friends >= 10) + (x.guilds >= 1) + (x.msgs14 >= 30) + (x.calls14 >= 3) + (x.age >= 30);
  if (x.age < 3 && pts < 4) return 'novo'; // conta de poucos dias: ainda está conhecendo, mesmo que já tenha amigos
  return pts <= 1 ? 'novo' : pts <= 3 ? 'chegando' : 'veterano';
}
// antes do feed chegar faltam mensagens e chamadas: usa a última fase calculada (não pula de "novo" para "veterano" na tela)
let stageMemo = null;
function anStageAuto() {
  const x = usageStats();
  if (!x.known) { if (!stageMemo) try { stageMemo = localStorage.getItem('lc_anstage'); } catch { /* sem armazenamento */ } return STAGES[stageMemo] ? stageMemo : autoStage(x); }
  const s = autoStage(x);
  if (s !== stageMemo) { stageMemo = s; try { localStorage.setItem('lc_anstage', s); } catch { /* sem armazenamento */ } }
  return s;
}
export const anStage = () => (STAGES[S.prefs.anStage] ? S.prefs.anStage : anStageAuto());
// explicação curta embaixo do título de cada seção (só para quem está começando)
const AN_HINT = {
  forme: 'Pedidos de amizade e convites para entrar numa chamada.', now: 'Seus amigos jogando, em chamada ou online. Clique em alguém para conversar.',
  play: 'Chame a turma para jogar agora ou mais tarde. Quem topar entra no grupo.', lfg: 'Gente procurando grupo para jogar. Dá para entrar direto.',
  servers: 'Quem está jogando ou em chamada nos seus servidores. Bom jeito de achar amigos novos.', since: 'O que rolou enquanto você estava fora.',
  recent: 'O que seus amigos jogaram nos últimos dias.', week: 'Os jogos e clipes que a galera mais curtiu nos últimos 7 dias.',
};

// "Primeiros passos": lista do que faz o Resenha valer a pena, marcada pelo que a pessoa já fez de verdade (não por clique)
function startSteps(x) {
  const out = (S.rels && [...S.rels.values()].some(r => r.type === 4));
  const firstGuild = [...S.guilds.values()][0];
  const playOn = !!S.integrations?.some(i => i.account) || !!window.lcDesktop?.detectGame;
  const me = S.me || {};
  return [
    { k: 'friend', t: 'Adicione um amigo', d: 'Pelo nome de usuário. Quando ele aceitar, aparece aqui o que ele está fazendo.', done: x.friends > 0, wait: !x.friends && out && 'Pedido enviado, esperando a resposta',
      btn: 'Adicionar amigo', ic: 'plus', fn: () => { S.view.tab = 'add'; ctx.go('@me'); } },
    { k: 'guild', t: 'Entre num servidor', d: 'Crie o da sua turma ou entre com um convite.', done: x.guilds > 0, btn: 'Adicionar servidor', ic: 'grid', fn: () => import('./rail.js').then(m => m.addServerModal()) },
    { k: 'talk', t: 'Mande a primeira mensagem', d: 'Diga um oi num canal do servidor ou para um amigo.', done: x.msgsAny, btn: firstGuild ? 'Ir para o servidor' : null, ic: 'dm', fn: () => firstGuild && ctx.go(firstGuild.id) },
    { k: 'call', t: 'Entre numa chamada de voz', d: 'As salas de voz ficam na lista de canais do servidor. É só clicar para entrar.', done: x.callsAny, btn: firstGuild ? 'Ver as salas' : null, ic: 'voice', fn: () => firstGuild && ctx.go(firstGuild.id) },
    { k: 'game', t: 'Mostre o que você joga', d: 'Vincule a Steam ou use o app para PC: a turma vê seu jogo e chama você.', done: playOn, btn: 'Mostrar meu jogo', ic: 'gamepad', fn: () => ctx.openSettings('connections') },
    { k: 'profile', t: 'Deixe o perfil com a sua cara', d: 'Uma bio, um banner ou pronomes ajudam a turma a te reconhecer.', done: !!(me.bio || me.banner || me.pronouns || me.custom_status), btn: 'Editar perfil', ic: 'sparkle', fn: () => ctx.openSettings('profile') },
  ];
}
function startSection(stage, redraw) {
  if (S.prefs.anStartOff || stage === 'veterano') return null;
  const x = usageStats(), steps = startSteps(x), done = steps.filter(s => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find(s => !s.done && !s.wait) || steps.find(s => !s.done);
  const row = (s) => h('div.an-step' + (s.done ? '.done' : '') + (s === next ? '.next' : ''), { 'data-step': s.k },
    h('span.an-stepck', { 'aria-hidden': 'true' }, s.done ? icon('check', 14) : null),
    h('div.an-steptx', h('b', s.t), s === next && h('small', s.wait || s.d), s !== next && !s.done && s.wait && h('small', s.wait)),
    s === next && !s.done && s.btn && h('button.btn.sm', { type: 'button', onclick: (e) => { e.stopPropagation(); s.fn(); } }, icon(s.ic, 14), s.btn));
  return h('section.an-start', { 'aria-label': 'Primeiros passos' },
    h('div.an-starth', h('div', h('b', done ? `${done} de ${steps.length} feitos` : 'Comece por aqui'), h('small', done ? 'Continue de onde parou.' : 'O básico para aproveitar o Resenha com a sua turma.')),
      h('button.btn.link.sm', { type: 'button', title: 'Esconder os primeiros passos (volta pelo ⋯ do painel)', onclick: () => { S.prefs.anStartOff = true; savePrefs(); redraw(); } }, 'Já sei usar')),
    h('div.an-startbar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': steps.length, 'aria-valuenow': done }, h('i', { style: { width: Math.round(done / steps.length * 100) + '%' } })),
    // o próximo passo vem primeiro; os feitos vão para o fim (riscados)
    ...[next, ...steps.filter(s => s !== next && !s.done), ...steps.filter(s => s.done)].map(row));
}
// painel sem nada para mostrar: em vez de "tudo quieto", o caminho certo para cada um
function emptyNow(stage, x) {
  if (!x.friends) return h('div.an-guide', icon('users', 28), h('b', 'Aqui aparece a sua turma'),
    h('p', 'Quando você tiver amigos no Resenha, aparece aqui quem está jogando, em chamada ou online, com atalho para entrar junto.'),
    h('div.act-btns', h('button.btn.sm', { type: 'button', onclick: () => { S.view.tab = 'add'; ctx.go('@me'); } }, icon('plus', 14), 'Adicionar amigo'),
      !x.guilds && h('button.btn.grey.sm', { type: 'button', onclick: () => import('./rail.js').then(m => m.addServerModal()) }, icon('grid', 14), 'Entrar num servidor')));
  return h('div.an-empty', h('b', 'Tudo quieto por aqui…'), h('p', stage === 'veterano' ? 'Ninguém jogando nem em chamada agora.' : 'Quando seus amigos jogarem, entrarem numa chamada ou ficarem online, eles aparecem aqui.'),
    !S.integrations?.some(i => i.account) && !window.lcDesktop?.detectGame && h('button.btn.sm', { onclick: () => ctx.openSettings('connections') }, 'Mostrar o que eu jogo'));
}

// ---- seções do "Ativo agora": ordem, recolhidas e ocultas ficam salvas (S.prefs.anLay); a coluna inteira pode sumir (S.prefs.anOff)
const AN_SECS = { start: 'Primeiros passos', now: 'Online agora', forme: 'Para você', play: 'Bora jogar', lfg: 'Procurando grupo', servers: 'Nos seus servidores', since: 'Desde a última vez', recent: 'Nos últimos dias', week: 'Destaques da semana' };
const anLay = () => { const l = S.prefs.anLay ||= {}; l.col ||= {}; l.off ||= {}; if (S.prefs.anSrvClosed) { l.col.servers = true; delete S.prefs.anSrvClosed; } return l; };
// sem ordem arrastada: a ordem da fase de uso. Com ordem salva: ela, e seções novas (de versões futuras) no lugar da fase
const anOrder = () => {
  const def = AN_STAGE_ORDER[anStage()], saved = anLay().order;
  if (!saved) return [...def];
  const o = saved.filter(k => AN_SECS[k]);
  for (const k of def) if (!o.includes(k)) o.splice(Math.min(o.length, def.indexOf(k)), 0, k);
  return o;
};
const anSave = () => { savePrefs(); S.redrawFeed?.(); };
function anMove(k, to) { // to: índice na ordem completa
  const o = anOrder(), i = o.indexOf(k); if (i < 0) return; o.splice(i, 1); o.splice(Math.max(0, Math.min(o.length, to)), 0, k); anLay().order = o; anSave();
}
function anVisibleNeighbor(k, dir) { const vis = [...document.querySelectorAll('#actfeed > .ansec')].map(x => x.dataset.k), i = vis.indexOf(k); return vis[i + dir]; }
let anDrag = null;
function anSection(k, content, count) {
  const col = !!anLay().col[k];
  const head = h('div.ansec-h', { draggable: 'true', title: 'Arraste para mudar de lugar',
    ondragstart: (e) => { anDrag = k; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); sec.classList.add('dragging'); },
    ondragend: () => { anDrag = null; sec.classList.remove('dragging'); document.querySelectorAll('.ansec.drop-a, .ansec.drop-b').forEach(x => x.classList.remove('drop-a', 'drop-b')); },
    oncontextmenu: (e) => secMenu(e, k) },
    h('button.ansec-t', { type: 'button', 'aria-expanded': String(!col), onclick: () => { anLay().col[k] = !col; anSave(); } }, icon('chevdown', 14), h('span', AN_SECS[k]), count > 0 && h('small', String(count))),
    h('span.ansec-grip', { 'aria-hidden': 'true' }, icon('grid', 14)),
    h('button.ibtn.ansec-x', { type: 'button', title: 'Ocultar esta seção', 'aria-label': 'Ocultar ' + AN_SECS[k], onclick: (e) => secMenu(e, k) }, icon('more', 14)));
  const sec = h('div.ansec' + (col ? '.col' : ''), { 'data-k': k,
    ondragover: (e) => { if (!anDrag || anDrag === k) return; e.preventDefault(); const r = sec.getBoundingClientRect(), top = e.clientY < r.top + r.height / 2; sec.classList.toggle('drop-a', top); sec.classList.toggle('drop-b', !top); },
    ondragleave: () => sec.classList.remove('drop-a', 'drop-b'),
    ondrop: (e) => { if (!anDrag || anDrag === k) return; e.preventDefault(); const top = sec.classList.contains('drop-a'); sec.classList.remove('drop-a', 'drop-b');
      const o = anOrder().filter(x => x !== anDrag), i = o.indexOf(k); anMove(anDrag, top ? i : i + 1); } },
    head, !col && anStage() === 'novo' && AN_HINT[k] && h('p.ansec-hint', AN_HINT[k]), !col && h('div.ansec-b', ...[content].flat(2).filter(Boolean)));
  return sec;
}
function secMenu(e, k) {
  const up = anVisibleNeighbor(k, -1), down = anVisibleNeighbor(k, 1), o = anOrder();
  menu(e, [
    up && { label: 'Mover para cima', icon: 'upvote', fn: () => anMove(k, o.indexOf(up)) },
    down && { label: 'Mover para baixo', icon: 'chevdown', fn: () => anMove(k, o.indexOf(down)) },
    { label: anLay().col[k] ? 'Expandir' : 'Recolher', icon: 'chevdown', fn: () => { anLay().col[k] = !anLay().col[k]; anSave(); } },
    '-', { label: 'Ocultar esta seção', icon: 'eyeoff', hint: 'Volta pelo ⋯ no topo do Ativo agora', fn: () => { anLay().off[k] = true; anSave(); toast(`"${AN_SECS[k]}" oculta. Reexiba pelo ⋯ no topo do Ativo agora.`); } }]);
}
function panelMenu(e) {
  const l = anLay();
  const auto = anStageAuto(), cur = S.prefs.anStage;
  const pick = (v) => { if (v) S.prefs.anStage = v; else delete S.prefs.anStage; if (v === 'novo') delete S.prefs.anStartOff; anSave(); };
  menu(e, [{ head: 'Mostrar como' },
    { label: 'Automático', hint: `Pelo seu uso: ${STAGES[auto].toLowerCase()}`, checked: !STAGES[cur], fn: () => pick(null) },
    ...Object.entries(STAGES).map(([k, t]) => ({ label: t, hint: STAGE_HINT[k], checked: cur === k, fn: () => pick(k) })),
    '-', { head: 'Seções' },
    ...anOrder().map(k => k === 'start'
      ? { label: AN_SECS[k], checked: !l.off[k] && !S.prefs.anStartOff, fn: () => { const on = !l.off[k] && !S.prefs.anStartOff; l.off[k] = on; if (!on) delete S.prefs.anStartOff; anSave(); } }
      : { label: AN_SECS[k], checked: !l.off[k], fn: () => { l.off[k] = !l.off[k]; anSave(); } }),
    '-',
    { label: 'Expandir todas', icon: 'chevdown', fn: () => { l.col = {}; anSave(); } },
    { label: 'Ordem padrão', icon: 'refresh', fn: () => { l.order = null; anSave(); } },
    '-',
    { label: 'Ocultar o Ativo agora', icon: 'eyeoff', hint: 'Volta pelo botão no topo da tela de Amigos', fn: () => setAnOff(true) }]);
}
export function setAnOff(v) {
  S.prefs.anOff = !!v; savePrefs();
  document.getElementById('home')?.classList.toggle('an-off', !!v);
  if (v) toast('Ativo agora oculto. Para mostrar de novo, use o botão de controle no topo da tela de Amigos.');
}
// quem só está online (sem jogo nem chamada): em linhas. Muita gente (quem já usa há tempo costuma ter): as primeiras em
// linha e o resto numa fileira de rostos, que abre a lista inteira
const ONLINE_ROWS = 5;
let onlineMore = false;
function onlineList(list, redraw) {
  const row = ({ u }) => h('div.an-row', { onclick: () => ctx.openDM(u.id), oncontextmenu: (e) => ctx.userMenu(e, u.id) }, avatar(u, 32, { ring: 'var(--bg-sec)' }),
    h('div.an-who', nameEl(u), h('small', u.custom_status || STATUS[u.status] || 'Online')), ...voiceActions(u.id).slice(0, 1));
  if (onlineMore || list.length <= ONLINE_ROWS + 2) return [...list.map(row), onlineMore && list.length > ONLINE_ROWS + 2 && h('button.hl-more', { type: 'button', onclick: () => { onlineMore = false; redraw(); } }, h('span.hl-up', icon('chevdown', 14)), 'Mostrar menos')];
  const rest = list.slice(ONLINE_ROWS);
  return [...list.slice(0, ONLINE_ROWS).map(row),
    h('button.an-faces-more', { type: 'button', title: 'Ver todos que estão online', onclick: () => { onlineMore = true; redraw(); } },
      h('span.an-faces', ...rest.slice(0, 6).map(({ u }) => avatar(u, 24, { status: false }))), h('span', `+${rest.length} online`), icon('chevdown', 14))];
}
export function activityPanel(box) {
  ensureLfgPosts();
  box.id ||= 'active-now';
  const body = h('div#actfeed.an-body');
  box.replaceChildren(h('div.an-head', h('h3', 'Ativo agora'), h('button.ibtn.an-cfg', { type: 'button', title: 'Organizar o Ativo agora', 'aria-label': 'Organizar o Ativo agora', onclick: (e) => panelMenu(e) }, icon('more', 18))), body);
  const draw = () => {
    const friends = [...S.rels.values()].filter(r => r.type === 1).map(r => uOf(r.user.id));
    const byName = (x, y) => (x.u.display_name || '').localeCompare(y.u.display_name || '');
    const playing = [], inVoice = [], online = [];
    for (const u of friends) {
      const a = activityOf(u.id), r = roomOf(u.id);
      if (a) playing.push({ u, a }); else if (r) inVoice.push({ u, r }); else if (u.status && u.status !== 'offline') online.push({ u });
    }
    playing.sort((x, y) => x.a.since - y.a.since);
    // junta pela chave mantendo a ordem de quem apareceu primeiro (grupo no lugar do primeiro dele)
    const bunch = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m.values()]; };
    const mine = activityOf(S.me.id);
    const forMe = requestCards();
    // agora: quem está online fazendo algo (jogando, em chamada) primeiro, depois quem só está online
    const now = [
      ...(playing.length ? [h('div.an-cap', `Jogando — ${playing.length}`), ...bunch(playing, x => gameKey(x.a)).map(l => (l.length > 1 ? playGroupCard(l) : playCard(l[0].u.id, l[0].a)))] : []),
      ...(inVoice.length ? [h('div.an-cap', `Em chamada — ${inVoice.length}`), ...bunch(inVoice.sort(byName), x => x.r.g?.id || 'dm:' + x.u.id).map(l => (l.length > 1 ? voiceGroupCard(l[0].r.g, l) : voiceCard(l[0].u.id, l[0].r)))] : []),
      ...(online.length ? [h('div.an-cap', `Online — ${online.length}`), ...onlineList(online.sort(byName), draw)] : []),
    ];
    // gente dos seus servidores que não é amiga (jogando ou em chamada) e, no topo dela, sugestões de amizade
    const srv = serverSection([...playing.map(x => ({ u: x.u, a: x.a, r: roomOf(x.u.id) })), ...inVoice.map(x => ({ u: x.u, a: null, r: x.r }))], draw);
    const recent = recentGames(), back = sinceStrip(); // com a faixa "Desde a última vez" não está "tudo quieto"
    const stage = anStage(), start = startSection(stage, draw);
    // sem amigos, o vazio vira o guia (mesmo com outras seções); com amigos, só quando o painel inteiro está vazio
    if (!now.length && (!friends.length || (!forMe.length && !srv.length && !recent.length && !back))) now.push(emptyNow(stage, usageStats()));
    // você também está jogando: linha discreta (dá para esconder o jogo daqui)
    if (mine) now.push(h('div.an-me', gameIcon(mine, 18), h('span', 'Você está jogando ', h('b', mine.game.title)),
      h('button.btn.link.sm', { title: 'Este jogo nunca aparece como atividade', onclick: async () => { if (await tryApi('PUT', `/activity/games/${mine.platform}/${encodeURIComponent(mine.game.id)}`, { hidden: true })) toast('Jogo escondido. Você pode reexibi-lo em Contas vinculadas.'); } }, 'Esconder jogo')));
    // cada pedaço do painel vira uma seção que recolhe, muda de lugar (arrastando) e pode ser ocultada (S.prefs.anLay)
    const bora = boraSection(), ints = intentSection(), cta = playCta(), lfg = lfgSection();
    const parts = {
      start,
      now: now.length && h('section.an-now', ...now),
      forme: forMe.length > 1 && h('section.an-forme', ...forMe.slice(1)), // sem o rótulo "Para você": o cabeçalho da seção já diz
      play: (bora.childElementCount || ints.childElementCount || cta) && [bora, ints, cta],
      lfg: lfg || null,
      servers: srv.length && srv,
      since: back,
      recent: recent.length && recent.map(recentRow),
      week: weekSections(),
    };
    const counts = { now: playing.length + inVoice.length + online.length, forme: forMe.length ? forMe.length - 1 : 0, servers: srv.count || 0, recent: recent.length };
    box.classList.toggle('an-stage-novo', stage === 'novo'); box.dataset.stage = stage;
    body.replaceChildren(...anOrder().filter(k => parts[k] && !anLay().off[k]).map(k => anSection(k, parts[k], counts[k])));
    // janela estreita: o painel é uma gaveta fechada; um ponto no botão avisa que há novidade lá dentro
    document.querySelector('#home .an-toggle')?.classList.toggle('an-new', !!back);
  };
  S.redrawFeed = draw; draw();
  stagger(body.querySelector('.an-now')); // cartões entram em cascata ao montar o painel (não nos redesenhos)
  // redesenha o painel que estiver na tela (pode ser outro, montado enquanto os pedidos estavam a caminho)
  Promise.all([loadFeed(), loadSince()]).then(() => { if (body.isConnected) draw(); else if (document.getElementById('actfeed')) S.redrawFeed?.(); });
  clearInterval(S.feedClock); S.feedClock = setInterval(() => { if (!body.isConnected) return clearInterval(S.feedClock); draw(); }, 30000);
}
async function loadFeed() {
  try {
    const [f, ints] = await Promise.all([api('GET', '/activity/feed'), S.integrations ? Promise.resolve(S.integrations) : api('GET', '/integrations')]);
    for (const u of f.users) if (!S.users.has(u.id)) S.users.set(u.id, u);
    feed = f; S.integrations = ints;
  } catch { /* Steam/servidor indisponível: mantém o que havia */ }
}
function scheduleFeed() {
  if (!document.getElementById('actfeed')) return;
  clearTimeout(feedTimer); feedTimer = setTimeout(() => loadFeed().then(() => document.getElementById('actfeed') && S.redrawFeed?.()), 400);
}

// ---------------------------------------------------------------- Configurações → Contas vinculadas
const SYNC = { pending: 'Sincronizando…', ok: 'Sincronizado', private: 'Perfil privado: deixe o perfil e os "Detalhes do jogo" públicos',
  not_found: 'Perfil não encontrado', error: 'Steam fora do ar; tentando de novo', unavailable: 'Servidor sem acesso à Steam. Fale com o admin.' };
// logotipos dos cartões (desenho simples, sem asset de terceiros)
const LOGO = {
  steam: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15.4" cy="8.6" r="4.3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="15.4" cy="8.6" r="1.9" fill="currentColor"/><path d="M11.6 11.7 9.9 14.6M2.8 12.9l4.9 2.1" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="8.6" cy="16.1" r="2.7" fill="currentColor"/></svg>',
};
const logo = (id, ic) => { const el = h('span.lk-logo.lk-' + id); if (LOGO[id]) el.innerHTML = LOGO[id]; else el.append(icon(ic || 'link', 26)); return el; };
const pill = (tone, text) => h('span.lk-pill.' + tone, h('i'), text);
const feats = (list) => h('ul.lk-feats', list.filter(Boolean).map(([ic, t]) => h('li', icon(ic, 16), h('span', t))));
export function connectionsPage(reg) {
  const box = h('div.lk-steamslot', h('div.lk-card', skeleton('rows', 2)));
  const hiddenBox = h('div');
  const draw = async () => {
    let ints, hidden = [];
    try { [ints, hidden] = await Promise.all([api('GET', '/integrations'), api('GET', '/activity/hidden')]); S.integrations = ints; }
    catch (e) { return box.replaceChildren(h('div.lk-card', h('p.lk-err', icon('warn', 16), 'Não foi possível carregar: ' + e.message))); }
    box.replaceChildren(...ints.map(i => {
      const a = i.account;
      if (!a) return h('div.lk-card',
        h('div.lk-top', logo(i.id), h('div.lk-name', h('b', i.name), h('small', 'Conta de jogos')), pill('off', 'Não vinculada')),
        feats([['lock', 'Login oficial da ' + i.name + ', sem pedir sua senha'], ['gamepad', 'Mostra aos amigos o jogo que você está jogando'], ['gift', 'Traz sua biblioteca e a wishlist']]),
        h('p.lk-note', icon('eye', 14), 'Precisa do perfil e dos "Detalhes do jogo" públicos na ' + i.name + '.'),
        !i.configured && h('p.lk-note.warn', icon('warn', 14), 'O jogo atual só aparece quando o admin configurar a chave da ' + i.name + ' no servidor.'),
        h('div.lk-foot', h('button.btn.lk-main', { onclick: async () => { const r = await tryApi('POST', `/integrations/${i.id}/link`); if (r?.url) { window.open(r.url, '_blank', 'noopener'); toast('Conclua o login na janela que abriu e volte aqui.'); } } }, icon('link', 16), 'Vincular com a ' + i.name)));
      const patch = (body) => tryApi('PATCH', `/integrations/${i.id}`, body).then(r => { if (r) draw(); });
      const sync = !i.configured ? ['warn', 'Falta a chave no servidor'] : a.sync_state === 'ok' ? ['ok', 'Conectada'] : a.sync_state === 'pending' ? ['info', 'Sincronizando'] : ['warn', 'Atenção'];
      return h('div.lk-card.linked',
        h('div.lk-top', logo(i.id), h('div.lk-name', h('b', i.name), h('small', 'Conta de jogos')), pill(sync[0], sync[1])),
        h('div.lk-acc', a.avatar ? h('img.lk-av', { src: a.avatar, alt: '' }) : h('span.lk-av.ph', icon('user', 20)),
          h('div.lk-acct', h('b', a.display_name || 'Conta vinculada'), h('small', SYNC[a.sync_state] || '')),
          a.profile_url && h('a.btn.grey.sm.lk-open', { href: a.profile_url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir perfil', icon('external', 14))),
        h('div.lk-opts',
          h('div.lk-opt', h('span', h('b', 'Mostrar aos amigos o que estou jogando'), h('small', 'Só amigos, ao vivo e no feed. Desligado, nada é consultado.')), toggle(a.visibility === 'friends', (on) => patch({ visibility: on ? 'friends' : 'off' }))),
          h('div.lk-opt', h('span', h('b', 'Mostrar aos amigos que vinculei esta conta'), h('small', 'Aparece no seu perfil para os amigos.')), toggle(a.link_visibility === 'friends', (on) => patch({ link_visibility: on ? 'friends' : 'off' })))),
        h('div.lk-foot', h('button.btn.link.lk-unlink', { onclick: async () => { if (await confirmBox('Desvincular ' + i.name, 'Para de consultar e apaga o histórico desta conta.', 'Desvincular')) { await tryApi('DELETE', `/integrations/${i.id}`); draw(); } } }, 'Desvincular')));
    }));
    hiddenBox.replaceChildren(...(hidden.length ? [section('Jogos escondidos'), h('div.card2.lk-hidden', h('p.hintline', 'Nunca aparecem como atividade, nem do PC nem da Steam.'),
      ...hidden.map(g => h('div.lk-hrow', h('span', icon('eyeoff', 16), g.title || 'Jogo ' + g.game_id), h('button.btn.grey.sm', { onclick: async () => { await tryApi('PUT', `/activity/games/${g.platform}/${g.game_id}`, { hidden: false }); draw(); } }, 'Mostrar de novo'))))] : []));
  };
  S.refreshConnections = draw; reg?.(() => { S.refreshConnections = null; });
  draw();
  return h('div.lk-page', h('h2', 'Contas vinculadas'),
    h('p.lk-lead', 'Mostre aos amigos o que você está jogando e traga sua biblioteca da Steam. Você escolhe quem vê cada coisa.'),
    h('div.lk-grid', pcActivityBlock(), box), hiddenBox, gamesBlock());
}
// jogo aberto no PC (app desktop detecta, como na transmissão): quem pode ver
// 'off' era "Ninguém" até 24/11/2026: agora só os amigos veem (o valor guardado continua 'off'; server/activity.js)
// jogo aberto no PC (app desktop): aparece sempre para amigos e quem divide servidor (sem opção desde 24/11/2026)
function pcActivityBlock() {
  const on = !!window.lcDesktop?.detectGame;
  const ctl = h('p.lk-note', icon('users', 14), 'Aparece para seus amigos e para quem está nos seus servidores. Para não aparecer, use o status Invisível.');
  return h('div.lk-card',
    h('div.lk-top', logo('pc', 'screen'), h('div.lk-name', h('b', 'Jogo aberto no PC'), h('small', 'App desktop do Resenha')), on ? pill('ok', 'Ativo neste PC') : pill('off', 'Só no app desktop')),
    feats([['gamepad', 'Reconhece qualquer jogo aberto, não só os da Steam'], ['link', 'Não precisa vincular nenhuma conta'], ['lock', 'Só o nome do jogo é enviado']]),
    !on && h('p.lk-note', icon('info', 14), 'Funciona no app desktop para Windows (1.0.24 ou mais novo).'),
    ctl,
    h('div.lk-opt.sg-opt', h('span', h('b', 'Avisar quando um amigo jogar o mesmo que eu'), h('small', 'Um aviso no canto para entrar na sala dele ou chamá-lo para a sua. Não toca em "não perturbe".')), toggle(sameGameOn(), (on) => { S.prefs.sameGameAlert = on; savePrefs(); })),
    h('p.lk-note', icon('clock', 14), 'As horas só contam enquanto você está numa call (servidor ou DM, mesmo mutado). No modo invisível, só você vê o jogo, mas as horas entram na semana da galera sem seu nome.'));
}

// "Bora?" no topo do Ativo agora: os vivos dos meus servidores (com o contador) e o botão de chamar a turma
function boraSection() {
  const list = liveIn(null);
  return h('section.an-bora', list.length > 0 && h('div.an-cap', list.length === 1 ? 'Bora' : `Bora · ${list.length}`), ...list.slice(0, 3).map(b => boraCard(b)));
}
// botão único para chamar gente para jogar (eram dois: "Bora?" e "A fim de jogar?"): abre as duas formas de chamar
function playCta() {
  const canIntent = !myLiveIntent(), canBora = S.guilds.size > 0;
  if (!canIntent && !canBora) return null;
  return h('button.in-cta.play-cta', { type: 'button', 'aria-haspopup': 'menu', onclick: (e) => menu(e, [
    canBora && { label: 'Chamar a turma do servidor', hint: 'Agora ou mais tarde, com quem topar', icon: 'megaphone', fn: () => openBoraModal() },
    canIntent && { label: 'Chamar só quem tem o jogo', hint: 'Avisa quem joga e forma o grupo', icon: 'gamepad', fn: () => openIntentModal() }]) },
    h('span.in-ctaic', icon('megaphone', 20)), h('span.in-ctatx', h('b', 'Bora jogar?'), h('small', canIntent ? 'Chama a turma ou só quem tem o jogo' : 'Chama a turma do servidor')), icon('chevr', 16));
}
