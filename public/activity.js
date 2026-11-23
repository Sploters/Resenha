// Atividade social: estado em tempo real, painel "Ativo agora" (o que os amigos fazem AGORA, em destaque, e a retrospectiva
// da semana: os jogos e os clipes que marcaram) e página de contas vinculadas.
// A decisão de QUEM pode ver cada atividade é do servidor; aqui só se exibe o que ele enviou.
import { openNight, nightDay } from './nights.js';
import { canCallInvite, sendCallInvite, pendingInvites, acceptInvite, declineInvite } from './callinvite.js';
import { h, icon, avatar, skeleton, thumbUrl } from './util.js';
import { knownGame } from './gamecatalog.js';
import { chName } from './chnames.js';
import { styleName } from './themes.js';
import { S, api, tryApi, toast, notify, confirmBox, guild, channelById, modal, savePrefs } from './state.js';
import { playSound } from './sounds.js';
import { openClip } from './clipsgallery.js';
import { gamesBlock } from './games.js';
import { stagger } from './motion.js';
import { intentSection } from './intents.js';
import { toggle, section, seg } from './ui.js';

const ctx = {}; // injetado por app.js: openDM, profile, userMenu, go, joinVoice, watchFriend, voice(), openSettings, renderActiveNow
export const initActivity = (c) => Object.assign(ctx, c);
S.activities = new Map();      // 'uid:platform' -> { user_id, platform, game:{id,title}, since, state }
S.integrations = null;         // [{ id, name, configured, capabilities, account }]
let feed = null, feedTimer = null;

const PLATFORM = { steam: 'Steam', pc: 'No PC' };
export const platformName = (p) => PLATFORM[p] || p;
export function setActivities(list) { S.activities.clear(); for (const a of list || []) S.activities.set(a.user_id + ':' + a.platform, a); }
export const activityOf = (uid) => { let pc = null; for (const a of S.activities.values()) if (a.user_id === uid) { if (a.platform !== 'pc') return a; pc = a; } return pc; };
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
  if (!sid) { tryList([exeC]); return box; }
  // enquanto a Steam responde (o pedido é em lote e guardado): o ícone do programa, se houver; senão o controle
  tryList([exeC]);
  steamArt(sid).then(x => { if (x) tryList([x.icon && { src: x.icon, cover: true }, exeC, (x.thumb || x.image) && { src: x.thumb || x.image, cover: true }]); });
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
  const sid = steamIdOf(a) || kg?.steam; if (!sid) return null;
  const el = h('div.gbanner.hidden');
  steamArt(sid).then(x => { if (!x?.image) return; el.replaceChildren(h('img', { src: x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: () => el.remove() })); el.classList.remove('hidden'); });
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
  const meta = h('div.gm-meta'), tags = h('div.gm-tags');
  const ext = (name, url) => h('a.btn.gm-steam', { href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), name);
  const store = [...(kg?.links || []).map(l => ext(l.name, l.url)), sid && ext('Ver na Steam', `https://store.steampowered.com/app/${sid}/`)].filter(Boolean);
  const people = gamePeople(a);
  const body = h('div.gm', hero, h('div.gm-main',
    h('div.gm-head', titleEl(a, 'h2'), store.length > 0 && h('div.gm-links', store)),
    meta, tags,
    people.length ? [h('div.gm-cap', 'Amigos que jogaram'), h('div.gm-people', people)] : h('p.gm-none', 'Nenhum amigo jogou isto esta semana.')));
  const m = modal('', null, body, [], { width: 'min(560px, 94vw)' });
  const md = m.el.querySelector('.modal'); md.classList.add('gamemodal'); md.querySelector('.mf')?.remove(); md.querySelector('.mh')?.remove();
  hero.append(h('button.inv-x.gm-x', { title: 'Fechar', onclick: m.close }, icon('x', 20)));
  if (sid) steamArt(sid).then(x => {
    if (!x) return;
    if (!kg?.icon && x.icon) swapIcon(x.icon);
    if (x.image && !kg?.banner) { hero.prepend(h('img.gm-art', { src: x.image, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); hero.classList.add('has-art'); }
    const rv = x.reviews; meta.replaceChildren(...[rv && h('span.gm-rev', icon('star', 14), `${rv.label} · ${rv.pct}%`), (x.free || x.price) && h('span', x.free ? 'Gratuito' : x.price)].filter(Boolean));
    tags.replaceChildren(...(x.tags || []).map(t => h('span.gm-tag', t)));
  });
  return m;
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
function avatarStack(list, n = 4, anon = 0) {
  const shown = list.slice(0, n), rest = list.length - shown.length + (anon || 0);
  return h('div.wk-stack', ...shown.map(p => { const u = uOf(p.user_id); return h('span.wk-av', { title: `${p.user_id === S.me.id ? 'Você' : u.display_name} · ${hrs(p.secs)}`, onclick: (e) => { e.stopPropagation(); ctx.profile(e.currentTarget, p.user_id); } }, avatar(u, 24, { status: false })); }),
    rest > 0 && h('span.wk-av.more', `+${rest}`));
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
    h('div.wk-rtxt', titleEl(a, 'b'), h('small', [hrs(x.secs), people(nPeople(x)), x.streak >= 2 && `${x.streak} dias seguidos`].filter(Boolean).join(' · '))),
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
  const closed = !!S.prefs.anSrvClosed;
  const cap = h('button.an-cap.an-capbtn', { 'aria-expanded': String(!closed), title: closed ? 'Mostrar' : 'Esconder', onclick: () => { S.prefs.anSrvClosed = !closed; savePrefs(); redraw(); } },
    h('span.an-capchev' + (closed ? '.closed' : ''), icon('chevdown', 14)), `Nos seus servidores — ${peers.length}`);
  if (closed) return [cap];
  const sub = (p) => p.a ? h('small.an-sub', gameIcon(p.a, 14), h('span', playingLine(p.a))) : h('small.an-sub', icon('voice', 14), h('span', `${chName(p.r.ch)} · ${p.r.g.name}`));
  const sugCard = ({ p, why }) => h('div.an-sug', { onclick: (e) => ctx.profile(e.currentTarget, p.u.id), oncontextmenu: (e) => ctx.userMenu(e, p.u.id) },
    h('div.an-sugtop', avatar(p.u, 36, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(p.u), h('small.an-why', why)),
      h('button.ibtn.an-sugx', { title: `Não sugerir ${p.u.display_name} por ${SUG_HIDE_DAYS} dias`, onclick: (e) => { e.stopPropagation(); hideSug(p.u.id); redraw(); } }, icon('x', 14))),
    addBtn(p, redraw, true));
  const rowEl = (p) => h('div.an-row.an-srv', { title: p.r ? 'Ver perfil (clique direito: mais opções)' : 'Ver perfil', onclick: (e) => ctx.profile(e.currentTarget, p.u.id), oncontextmenu: (e) => ctx.userMenu(e, p.u.id, p.r?.g?.id) },
    avatar(p.u, 32, { ring: 'var(--bg-sec)' }), h('div.an-who', nameEl(p.u), sub(p)),
    p.rt === 0 || p.rt === 4 ? addBtn(p, redraw, false) : null);
  const shown = srvMore ? rest : rest.slice(0, SRV_MAX), more = rest.length - shown.length;
  return [cap,
    sugs.length ? h('div.an-sugs', h('div.an-sugh', icon('users', 14), 'Talvez você conheça'), ...sugs.map(sugCard)) : null,
    ...shown.map(rowEl),
    more > 0 && h('button.hl-more', { onclick: () => { srvMore = true; redraw(); } }, icon('chevdown', 14), `Mostrar mais ${more}`),
    srvMore && rest.length > SRV_MAX && h('button.hl-more', { onclick: () => { srvMore = false; redraw(); } }, h('span.hl-up', icon('chevdown', 14)), 'Mostrar menos')].filter(Boolean);
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
// "Nos últimos dias": o feed.events (jogos que os amigos fecharam nos últimos 7 dias) por pessoa e jogo, somando o tempo
// em call. Quem está jogando o mesmo jogo agora já aparece em "Jogando" e não se repete aqui.
function recentGames() {
  const by = new Map();
  for (const ev of feed?.events || []) {
    if (ev.kind !== 'game_stop' || ev.user_id === S.me.id || !ev.game?.title) continue;
    const a = { platform: ev.platform, game: ev.game }, cur = activityOf(ev.user_id);
    if (cur && sameGameAs(cur, a)) continue;
    const k = ev.user_id + '|' + gameKey(a);
    let x = by.get(k); if (!x) by.set(k, x = { uid: ev.user_id, a, secs: 0, at: 0 });
    x.secs += ev.seconds || 0; x.at = Math.max(x.at, ev.at || 0);
  }
  const list = [...by.values()].sort((p, q) => q.at - p.at).slice(0, RECENT_MAX);
  // ícone do jogo: a retrospectiva da semana guarda o do programa e o número na Steam (o evento só traz id e nome)
  for (const x of list) {
    const w = (feed.week?.played || []).find(p => p.user_id === x.uid && sameGame({ ...p.game, platform: p.platform }, x.a));
    if (w) x.a = { platform: x.a.platform, game: { ...x.a.game, icon: w.game.icon, steam: w.game.steam } };
  }
  return list;
}
const recentRow = (x) => {
  const u = uOf(x.uid), a = x.a;
  return h('div.an-row.an-past', { 'data-uid': x.uid, 'data-secs': String(x.secs), title: `Sobre ${a.game.title}`, onclick: openGame(a), oncontextmenu: (e) => ctx.userMenu(e, x.uid) },
    profAv(u, 32), h('div.an-who', nameEl(u), h('small.an-sub', gameIcon(a, 14), h('span', 'Jogou ', titleEl(a), [x.secs >= 60 && hm2(x.secs), daysAgo(x.at)].filter(Boolean).map(t => ' · ' + t).join('')))));
};

// painel inteiro. Topo, em destaque: o que os amigos estão fazendo AGORA (jogando, em chamada, online). Embaixo: os destaques.
export function activityPanel(box) {
  box.id ||= 'active-now';
  const body = h('div#actfeed.an-body');
  box.replaceChildren(h('h3', 'Ativo agora'), body);
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
    const now = [
      ...(playing.length ? [h('div.an-cap', `Jogando — ${playing.length}`), ...bunch(playing, x => gameKey(x.a)).map(l => (l.length > 1 ? playGroupCard(l) : playCard(l[0].u.id, l[0].a)))] : []),
      ...(inVoice.length ? [h('div.an-cap', `Em chamada — ${inVoice.length}`), ...bunch(inVoice.sort(byName), x => x.r.g?.id || 'dm:' + x.u.id).map(l => (l.length > 1 ? voiceGroupCard(l[0].r.g, l) : voiceCard(l[0].u.id, l[0].r)))] : []),
      ...(online.length ? [h('div.an-cap', `Online — ${online.length}`), ...online.sort(byName).map(({ u }) => h('div.an-row', { onclick: () => ctx.openDM(u.id), oncontextmenu: (e) => ctx.userMenu(e, u.id) }, avatar(u, 32, { ring: 'var(--bg-sec)' }),
        h('div.an-who', nameEl(u), h('small', u.custom_status || STATUS[u.status] || 'Online')), ...voiceActions(u.id).slice(0, 1)))] : []),
    ];
    // gente dos seus servidores que não é amiga (jogando ou em chamada) e, no topo dela, sugestões de amizade
    const srv = serverSection([...playing.map(x => ({ u: x.u, a: x.a, r: roomOf(x.u.id) })), ...inVoice.map(x => ({ u: x.u, a: null, r: x.r }))], draw);
    const recent = recentGames(), back = sinceStrip(); // com a faixa "Desde a última vez" não está "tudo quieto"
    if (!now.length && !forMe.length && !srv.length && !recent.length && !back) now.push(h('div.an-empty', h('b', 'Tudo quieto por aqui…'), h('p', 'Quando seus amigos jogarem, entrarem numa chamada ou ficarem online, eles aparecem aqui.'),
      !S.integrations?.some(i => i.account) && !window.lcDesktop?.detectGame && h('button.btn.sm', { onclick: () => ctx.openSettings('connections') }, 'Mostrar o que eu jogo')));
    // você também está jogando: linha discreta (dá para esconder o jogo daqui)
    if (mine) now.push(h('div.an-me', gameIcon(mine, 18), h('span', 'Você está jogando ', h('b', mine.game.title)),
      h('button.btn.link.sm', { title: 'Este jogo nunca aparece como atividade', onclick: async () => { if (await tryApi('PUT', `/activity/games/${mine.platform}/${encodeURIComponent(mine.game.id)}`, { hidden: true })) toast('Jogo escondido. Você pode reexibi-lo em Contas vinculadas.'); } }, 'Esconder jogo')));
    now.push(...srv);
    // o que os amigos jogaram nos últimos dias (por pessoa e jogo), depois do que está acontecendo agora
    if (recent.length) now.push(h('div.an-cap.an-pastcap', 'Nos últimos dias'), ...recent.map(recentRow));
    // "Desde a última vez" no topo; "A fim de jogar" (public/intents.js): minha intenção, convites para mim e o atalho;
    // embaixo a retrospectiva da semana
    body.replaceChildren(back || '', intentSection(), forMe.length ? h('section.an-forme', ...forMe) : '', h('section.an-now', ...now), ...weekSections());
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
export const PC_VIS = { servers: 'Amigos e meus servidores', friends: 'Só amigos', off: 'Ninguém' };
function pcActivityBlock() {
  const on = !!window.lcDesktop?.detectGame;
  const ctl = h('div.lk-ctl', h('div.lk-ctlh', 'Quem pode ver meu jogo do PC'), h('div.lk-seg', skeleton('rows', 1)));
  const draw = (v) => ctl.lastChild.replaceChildren(seg(PC_VIS, v, async (nv) => { const r = await tryApi('PATCH', '/activity/pc', { visibility: nv }); if (r) { S.pcActivity = r.visibility; toast(nv === 'off' ? 'Só você vê o que está jogando. Suas horas em call continuam contando na semana da galera, sem seu nome.' : 'Pronto.'); } }));
  tryApi('GET', '/activity/pc').then(r => { if (r) { S.pcActivity = r.visibility; draw(r.visibility); } });
  return h('div.lk-card',
    h('div.lk-top', logo('pc', 'screen'), h('div.lk-name', h('b', 'Jogo aberto no PC'), h('small', 'App desktop do Resenha')), on ? pill('ok', 'Ativo neste PC') : pill('off', 'Só no app desktop')),
    feats([['gamepad', 'Reconhece qualquer jogo aberto, não só os da Steam'], ['link', 'Não precisa vincular nenhuma conta'], ['lock', 'Só o nome do jogo é enviado']]),
    !on && h('p.lk-note', icon('info', 14), 'Funciona no app desktop para Windows (1.0.24 ou mais novo).'),
    ctl,
    h('div.lk-opt.sg-opt', h('span', h('b', 'Avisar quando um amigo jogar o mesmo que eu'), h('small', 'Um aviso no canto para entrar na sala dele ou chamá-lo para a sua. Não toca em "não perturbe".')), toggle(sameGameOn(), (on) => { S.prefs.sameGameAlert = on; savePrefs(); })),
    h('p.lk-note', icon('clock', 14), 'As horas só contam enquanto você está numa call (servidor ou DM, mesmo mutado). Em "Ninguém" ou no modo invisível, só você vê o jogo, mas as horas entram na semana da galera sem seu nome.'));
}
