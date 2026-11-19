// Procurar jogadores: mural de anúncios (quem divide servidor com você ou é seu amigo), "Quero entrar" → o autor
// aceita e você vai para a chamada, "Copiar anúncio" para colar em grupos de LFG, perfil de jogador e atalhos para sites.
import { h, icon, avatar } from './util.js';
import { S, tryApi, toast, modal, notify, savePrefs, guild, alertAllowed } from './state.js';
import { toggle } from './ui.js';
import { gamesTabs } from './gamestabs.js';
import { flow } from './ux.js';
import { playSound } from './sounds.js';
import { activityOf, gameIcon } from './activity.js';

let ctx = {}; // injetado por app.js: go, profile(anchor, uid), inVoice, voiceChannel, settings(page)
export const initLfg = (c) => { ctx = c; };
// filtro por servidor: só anúncios de quem está naquele servidor com você (ou com a sala de voz nele)
export function setLfgGuild(gid) { st.guild = gid || null; ls.set('lc_lfg_guild', st.guild); }
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { } } };
const st = { guild: ls.get('lc_lfg_guild'), games: null, platforms: [], posts: [], game: null, root: null, mine: [], chat: null };
const G = (id) => st.games?.find(g => g.id === id);
const meta = async () => { if (!st.games) { const r = await tryApi('GET', '/lfg/meta'); st.games = r?.games || []; st.platforms = r?.platforms || []; } return st.games; };
const platName = (id) => st.platforms.find(p => p[0] === id)?.[1] || 'PC';

// ---------- sessão ao vivo ----------
// O cartão mostra "Jogando agora" quando o autor está com o jogo do anúncio aberto (app desktop ou conta vinculada), com a
// mesma privacidade da atividade. Diferente do Discord, não precisa abrir o jogo ANTES de publicar: aparece e some sozinho.
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const ALIASES = { cs2: ['counterstrike2', 'cs2', 'counterstrikeglobaloffensive'], lol: ['leagueoflegends', 'lol'], repo: ['repo'], valorant: ['valorant'] };
export function liveOf(p, uid = p.author.id) {
  const a = activityOf(uid); if (!a?.game?.title) return null;
  const t = norm(a.game.title), names = [...(ALIASES[p.game] || []), norm(p.game_name)].filter(Boolean);
  return names.some(n => t === n || (n.length >= 4 && (t.includes(n) || n.includes(t) && t.length >= 4))) ? a : null;
}
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return m < 1 ? 'agora mesmo' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };

// ---------- textos ----------
const whenText = (p) => {
  if (!p.when_at || p.when_at <= Date.now() + 60e3) return 'Agora';
  const d = new Date(p.when_at), today = new Date(), tm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 86400e3);
  return days === 0 ? `Hoje ${tm}` : days === 1 ? `Amanhã ${tm}` : `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${tm}`;
};
const rankText = (p) => (p.rank_min && p.rank_max ? (p.rank_min === p.rank_max ? p.rank_min : `${p.rank_min} – ${p.rank_max}`) : p.rank_min ? `${p.rank_min}+` : p.rank_max ? `até ${p.rank_max}` : 'Qualquer elo');
// links para sites de estatística a partir do nick / Riot ID (só abre o site; nada é consultado daqui)
export function statLinks(game, ign) {
  if (!ign) return [];
  const riot = ign.match(/^(.+?)#(\w{2,6})$/);
  if (game === 'lol' && riot) return [{ name: 'OP.GG', url: `https://op.gg/lol/summoners/br/${encodeURIComponent(riot[1])}-${encodeURIComponent(riot[2])}` }];
  if (game === 'valorant' && riot) return [{ name: 'Tracker', url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(ign)}/overview` }];
  if (game === 'cs2') return /^https?:\/\/steamcommunity\.com\//.test(ign) ? [{ name: 'Steam', url: ign }] : [{ name: 'Faceit', url: `https://www.faceit.com/pt/players/${encodeURIComponent(ign)}` }];
  return [];
}
export function adText(p) {
  const prof = p.author_profile;
  return [`🎮 LFG — ${p.game_name} · ${p.mode}`,
    `Precisa de ${p.slots} · ${rankText(p)}`,
    [p.roles.length ? `Funções: ${p.roles.join(', ')}` : null, p.mic ? '🎙️ Com microfone' : null].filter(Boolean).join(' · ') || null,
    `Quando: ${whenText(p) === 'Agora' ? 'agora' : whenText(p)}`,
    prof?.ign ? `${G(p.game)?.idLabel || 'Nick'}: ${prof.ign}${prof.rank ? ` (${prof.rank})` : ''}` : null,
    p.note ? `"${p.note}"` : null].filter(Boolean).join('\n');
}

// ---------- página ----------
async function load() {
  await meta();
  const r = await tryApi('GET', '/lfg/posts'); if (!r) return;
  st.posts = r; draw();
}
export async function renderLfg(main) {
  st.root = h('div#lfgview'); main.replaceChildren(st.root);
  draw(); load();
}
function draw() {
  const root = st.root; if (!root || !document.body.contains(root)) return;
  const games = st.games || [], g = st.game && G(st.game);
  if (st.guild && !guild(st.guild)) setLfgGuild(null); // saiu do servidor
  const gsel = st.guild && guild(st.guild);
  const list = st.posts.filter(p => (!st.game || p.game === st.game) && (!gsel || p.author.id === S.me.id || p.guilds?.includes(gsel.id))); // os meus aparecem em todos: os membros de cada servidor veem
  const open = list.filter(p => !p.closed), done = list.filter(p => p.closed && p.author.id === S.me.id);
  const alerts = S.prefs.lfgAlerts || {};
  const myGuilds = [...S.guilds.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const gfilter = myGuilds.length > 0 && h('label.lfgguild', { title: 'Mostrar só anúncios de quem está neste servidor com você' }, icon('grid4', 16),
    h('select', { onchange: (e) => { setLfgGuild(e.target.value); draw(); } }, h('option', { value: '' }, 'Todos os servidores'), myGuilds.map(x => h('option', { value: x.id, selected: x.id === st.guild }, x.name))));
  const chips = h('div.lfgchips.lfgscroll', h('button.lchip' + (!st.game ? '.on' : ''), { onclick: () => { st.game = null; draw(); } }, 'Todos'),
    games.map(x => h('button.lchip' + (st.game === x.id ? '.on' : ''), { style: { '--gc': x.color }, onclick: () => { st.game = x.id; draw(); } }, h('i'), x.name)));
  const links = g ? g.links.map(l => ({ ...l, game: g.name })) : []; // atalhos externos só com um jogo escolhido (todos juntos poluíam o topo)
  const people = new Set(open.filter(p => p.author.id !== S.me.id).map(p => p.author.id)).size;
  root.replaceChildren(
    h('div#topbar', ...gamesTabs('lfg'),
      h('div.spacer'),
      h('button.btn.grey.sm.lfg-prof', { title: 'Nick, elo e funções que aparecem nos seus anúncios', onclick: () => profileModal() }, icon('edit', 16), h('span', 'Meu perfil de jogador'))),
    h('div.lfgbody', h('div.lfg-wrap',
      h('header.lfg-hero',
        h('div.lfg-herot', h('h1', 'Procurar jogadores'),
          h('p', st.posts.length || open.length ? [h('b', open.length === 1 ? '1 grupo' : `${open.length} grupos`), ` procurando gente${people ? ` · ${people} ${people === 1 ? 'pessoa' : 'pessoas'}` : ''}. Quem divide servidor com você ou é seu amigo vê o seu anúncio na hora.`] : 'Quem divide servidor com você ou é seu amigo vê o seu anúncio na hora e pode pedir para entrar.')),
        h('div.lfg-heroa',
          // LFG invertido: em vez de esperar quem vê o mural, chama quem tem o jogo (public/intents.js)
          h('button.btn.grey.in-lfgbtn', { title: 'O Resenha chama só quem tem ou joga e forma o grupo sozinho', onclick: () => ctx.intent?.({ game: st.game && st.game !== 'other' ? { lfg: st.game, name: G(st.game)?.name } : null }) }, icon('gamepad', 16), 'A fim de jogar'),
          h('button.btn.green', { onclick: () => createModal() }, icon('plus', 16), 'Criar anúncio'))),
      h('div.lfg-filters', chips, gfilter),
      (g || links.length > 0) && h('div.lfgbar',
        g && h('label.lfgalert', toggle(!!alerts[g.id], (v) => { (S.prefs.lfgAlerts ||= {})[g.id] = v; if (!v) delete S.prefs.lfgAlerts[g.id]; savePrefs(); toast(v ? `Você será avisado de novos anúncios de ${g.name}` : 'Aviso desligado'); }), h('span', `Avisar quando alguém anunciar ${g.name}`)),
        links.length > 0 && h('div.lfglinks', h('span', 'Procurar também em'), links.map(l => h('a.lfglink', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: `${l.name} — ${l.game}` }, l.name, icon('external', 12))))),
      open.length ? h('div.lfggrid', open.map(card)) : h('div.lfgempty', h('div.ceart', icon('users', 36)), h('b', `Ninguém procurando ${st.game ? g?.name : 'grupo'}${gsel ? ' em ' + gsel.name : ''} agora`), h('p', g ? `Escolha "Avisar" acima para saber quando alguém anunciar ${g.name}, ou seja o primeiro.` : 'Use "Criar anúncio" acima: quem divide servidor com você ou é seu amigo vê na hora e pode pedir para entrar.')), // os botões ficam só no topo (antes se repetiam aqui)
      done.length > 0 && [h('h4.lfgsec', 'Seus anúncios encerrados (últimas 12 h)'), h('div.lfggrid.done', done.map(card))])));
}

function card(p) {
  const g = G(p.game) || { color: '#5865f2' }, me = p.author.id === S.me.id, myReq = p.requests.find(r => r.user.id === S.me.id);
  const prof = p.author_profile, links = statLinks(p.game, prof?.ign);
  const when = whenText(p), ch = p.channel, gch = ch && guild(ch.guild_id);
  const btns = [];
  if (!me && !p.closed) {
    if (!myReq) btns.push(h('button.btn.green', { title: p.join_mode === 'open' ? 'Entra direto no grupo, sem esperar aprovação' : `${p.author.display_name} aceita ou recusa o pedido`, onclick: () => join(p) }, p.join_mode === 'open' ? 'Entrar' : 'Pedir para entrar'));
    else if (myReq.state === 'pending') btns.push(h('button.btn.grey', { title: 'Cancelar o pedido', onclick: () => tryApi('POST', `/lfg/posts/${p.id}/request`, { cancel: true }).then(r => r && upsert(r)) }, 'Pedido enviado', icon('check', 14)));
  }
  if (ch && !['expired', 'closed'].includes(p.closed_reason) && (me || myReq?.state === 'accepted')) btns.push(h('button.btn.green', { title: `Vai para ${ch.name}${gch ? ' · ' + gch.name : ''}, a sala combinada no anúncio`, onclick: () => goRoom(p) }, icon('voice', 16), 'Ir para a sala'));
  if (myReq?.state === 'accepted') btns.push(h('span.lfgok', icon('check', 14), 'Você está no grupo'), !p.closed_reason || p.closed_reason === 'full' ? h('button.btn.link', { title: 'Libera a sua vaga', onclick: () => tryApi('POST', `/lfg/posts/${p.id}/request`, { cancel: true }).then(r => r && (upsert(r), toast('Você saiu do grupo'))) }, 'Sair') : null);
  btns.push(h('button.btn.grey', { title: 'Converse antes de entrar: estilo de jogo, microfone, horário', onclick: () => chatModal(p) }, icon('forum', 16), 'Conversa', p.msg_count ? h('span.lfg-n', String(p.msg_count)) : null));
  if (myReq?.state === 'declined') btns.push(h('span.lfgno', 'Pedido recusado'));
  btns.push(h('button.btn.grey.lfg-ic', { title: 'Copiar anúncio (texto para colar em grupos de LFG)', 'aria-label': 'Copiar anúncio', onclick: () => { navigator.clipboard?.writeText(adText(p)); toast('Anúncio copiado'); } }, icon('copy', 16), h('span.lfg-sr', 'Copiar anúncio')));
  if (me && !p.closed) btns.push(h('button.btn.link', { onclick: () => tryApi('POST', `/lfg/posts/${p.id}/close`).then(r => r && upsert(r)) }, 'Encerrar'));
  const pend = me ? p.requests.filter(r => r.state === 'pending') : [];
  const live = !p.closed && liveOf(p);
  return h('div.lfgcard' + (p.closed ? '.closed' : '') + (me ? '.mine' : ''), { 'data-id': p.id, style: { '--gc': g.color } },
    h('div.lfgtop', h('div.lfgtt', h('span.lfggame', p.game_name), h('span.lfgmode', p.mode)),
      p.closed ? h('span.lfgstate', p.closed_reason === 'full' ? 'Completo' : p.closed_reason === 'expired' ? 'Expirado' : 'Encerrado') : h('span.lfgwhen' + (when === 'Agora' ? '.now' : ''), when === 'Agora' && h('span.lfgdot'), when)),
    live && h('div.lfglive', { title: `${p.author.display_name} está com ${live.game.title} aberto` }, h('span.lfgdot'), gameIcon(live, 18), h('b', 'Jogando agora'), h('span', `${live.game.title} · ${ago(live.since)}`),
      h('small', p.slots === 1 ? '1 vaga aberta' : `${p.slots} vagas abertas`)),
    h('div.lfgneed', h('b', p.closed && p.closed_reason === 'full' ? 'Grupo fechado' : `Precisa de ${p.slots}`), h('span', rankText(p)), h('span.lfgplat', { title: 'Entrar de outra plataforma não funciona, a não ser em crossplay' }, platName(p.platform)),
      p.mic && h('span.lfgmic', { title: 'Microfone obrigatório' }, icon('mic', 14), 'mic'), p.join_mode === 'open' && h('span.lfgopen', { title: 'Quem clicar em Entrar já está no grupo' }, 'Entrada direta')),
    p.roles.length > 0 && h('div.lfgroles', p.roles.map(r => h('span', r))),
    p.note && h('div.lfgnote', p.note),
    h('div.lfgwho', { onclick: (e) => ctx.profile?.(e.currentTarget, p.author.id) }, avatar(S.users.get(p.author.id) || p.author, 32, { status: false }),
      h('div.lfgwinfo', h('b', p.author.display_name + (me ? ' (você)' : '')), h('small', prof?.ign ? `${prof.ign}${prof.rank ? ' · ' + prof.rank : ''}${prof.roles?.length ? ' · ' + prof.roles.join('/') : ''}` : 'sem perfil de jogador')),
      links.map(l => h('a.lfgstat', { href: l.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, l.name, icon('external', 11)))),
    ch && h('div.lfgch', icon('voice', 16), h('span', `${ch.name}${gch ? ' · ' + gch.name : ''}`), h('small', ch.in_call ? `${ch.in_call} na chamada` : 'sala vazia')),
    p.accepted.length > 0 && h('div.lfgacc', h('small', 'No grupo:'), p.accepted.map(u => h('span', { title: u.display_name }, avatar(S.users.get(u.id) || u, 20, { status: false })))),
    pend.length > 0 && h('div.lfgreqs', h('small', `${pend.length} ${pend.length === 1 ? 'pedido' : 'pedidos'} para entrar`), pend.map(r => h('div.lfgreq',
      avatar(S.users.get(r.user.id) || r.user, 28, { status: false }),
      h('div.lfgwinfo', h('b', r.user.display_name), h('small', r.profile?.ign ? `${r.profile.ign}${r.profile.rank ? ' · ' + r.profile.rank : ''}` : 'sem perfil de jogador'), statLinks(p.game, r.profile?.ign).map(l => h('a.lfgstat', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name, icon('external', 11)))),
      h('button.btn.green.sm', { onclick: () => answer(p, r.user.id, true) }, 'Aceitar'), h('button.btn.grey.sm', { onclick: () => answer(p, r.user.id, false) }, 'Recusar')))),
    h('div.lfgbtns', btns));
}
async function join(p) {
  const r = await tryApi('POST', `/lfg/posts/${p.id}/request`, {}); if (!r) return;
  upsert(r);
  if (r.joined?.room) { // entrada direta com sala combinada: já está no servidor; "agora" entra na chamada, agendado só mostra a sala
    const now = whenText(p) === 'Agora';
    toast(now ? `Você entrou no grupo de ${p.author.display_name}! Entrando em ${r.joined.room.name}…` : `Você entrou no grupo de ${p.author.display_name}! A sala é ${r.joined.room.name}: use "Ir para a sala" na hora do jogo.`);
    if (now) enterRoom(r.joined.room);
    return;
  }
  if (r.joined) { toast(r.joined.invited ? `Você entrou no grupo de ${p.author.display_name}! Veja o convite para a chamada.` : `Você entrou no grupo de ${p.author.display_name}! Mandamos uma mensagem para combinar.`); }
  else toast(`Pedido enviado para ${p.author.display_name}`);
}
async function answer(p, uid, accept) {
  const r = await tryApi('POST', `/lfg/posts/${p.id}/answer`, { user_id: uid, accept }); if (!r) return;
  upsert(r);
  if (accept) toast(ctx.inVoice?.() ? 'Aceito! A pessoa recebeu o convite para a sua chamada.' : 'Aceito! Mandamos uma mensagem para a pessoa. Entre numa sala de voz para chamá-la direto.');
}
// vai para a sala combinada no anúncio (o servidor coloca a pessoa no servidor se ainda não for membro)
async function goRoom(p) {
  const room = await tryApi('POST', `/lfg/posts/${p.id}/go`); if (!room) return;
  enterRoom(room);
}
async function enterRoom(room) {
  // acabou de virar membro: o servidor chega pelo GUILD_CREATE; espera um pouco para o canal existir na página
  for (let i = 0; i < 30 && !ctx.channelById?.(room.channel_id); i++) await new Promise(res => setTimeout(res, 100));
  document.querySelectorAll('.backdrop:not(.leaving)').forEach(b => b.querySelector('.lfgad') && b.remove());
  ctx.go(room.guild_id, room.channel_id);
  if (ctx.voiceChannel?.() !== room.channel_id) ctx.joinVoice?.(room.channel_id);
}
function upsert(p) { const i = st.posts.findIndex(x => x.id === p.id); if (i >= 0) st.posts[i] = p; else st.posts.push(p); draw(); }

// replaceChildren não achata listas nem ignora partes ocultas (false/null): esta versão faz as duas coisas
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k || k === 0));

// ---------- criar anúncio ----------
// pre: plano B do "A fim de jogar" (ninguém topou a tempo): o anúncio já vem com o jogo, as vagas e o recado
export const openLfgCreate = (pre) => createModal(pre);
async function createModal(pre = null) {
  flow('lfg_post', 'start');
  const games = await meta();
  const f = { platform: 'pc', join_mode: 'ask', game: pre?.game || st.game || 'valorant', game_name: pre?.game_name && pre.game === 'other' ? pre.game_name : '', mode: pre?.mode || '', slots: pre?.slots || 1, rank_min: '', rank_max: '', roles: new Set(), mic: true, when: 'now', at: '', note: pre?.note || '', channel_id: ctx.voiceChannel?.() || '' };
  const box = h('div.lfgform');
  const voiceRooms = [...S.guilds.values()].flatMap(gg => gg.channels.filter(c => c.type === 2).map(c => ({ id: c.id, label: `${c.name} · ${gg.name}` })));
  const sel = (opts, val, on, cls = '') => h('select' + cls, { onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const draw2 = () => {
    const g = G(f.game);
    if (!g.modes.includes(f.mode) && f.game !== 'other') f.mode = g.modes[0];
    if (f.game === 'other' && !f.mode) f.mode = g.modes[0];
    put(box,
      h('div.lfglab', 'Jogo'), h('div.lfgchips.pick', games.map(x => h('button.lchip' + (f.game === x.id ? '.on' : ''), { style: { '--gc': x.color }, onclick: () => { f.game = x.id; f.roles.clear(); f.rank_min = f.rank_max = ''; draw2(); } }, h('i'), x.name))),
      f.game === 'other' && h('label.f', 'Nome do jogo', h('input', { maxLength: 40, value: f.game_name, placeholder: 'Ex.: Lethal Company', oninput: (e) => { f.game_name = e.target.value; } })),
      h('div.lfgrow',
        h('label.f', 'Modo', sel(g.modes.map(m => [m, m]), f.mode, (v) => { f.mode = v; })),
        h('label.f', 'Vagas', sel([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, n === 1 ? 'Falta 1' : `Faltam ${n}`]), f.slots, (v) => { f.slots = +v; }))),
      g.ranks.length > 0 && h('div.lfgrow',
        h('label.f', 'Elo mínimo', sel([['', 'Qualquer'], ...g.ranks.map(r => [r, r])], f.rank_min, (v) => { f.rank_min = v; })),
        h('label.f', 'Elo máximo', sel([['', 'Qualquer'], ...g.ranks.map(r => [r, r])], f.rank_max, (v) => { f.rank_max = v; }))),
      g.roles.length > 0 && [h('div.lfglab', 'Funções que faltam (opcional)'), h('div.lfgroles.pick', g.roles.map(r => h('button' + (f.roles.has(r) ? '.on' : ''), { onclick: () => { f.roles.has(r) ? f.roles.delete(r) : f.roles.add(r); draw2(); } }, r)))],
      h('div.lfgrow',
        h('label.f', 'Quando', sel([['now', 'Agora'], ['later', 'Mais tarde…']], f.when, (v) => { f.when = v; draw2(); })),
        f.when === 'later' ? h('label.f', 'Dia e hora', h('input', { type: 'datetime-local', value: f.at, oninput: (e) => { f.at = e.target.value; } })) : h('div')),
      h('div.lfgrow',
        h('label.f', 'Plataforma', sel(st.platforms.map(([v, l]) => [v, l]), f.platform, (v) => { f.platform = v; })),
        h('label.f', 'Quem entra', sel([['ask', 'Eu aceito cada pedido'], ['open', 'Entrada direta (sem aprovação)']], f.join_mode, (v) => { f.join_mode = v; }))),
      liveHint(f),
      h('label.f', 'Sala de voz (opcional)', sel([['', 'Nenhuma'], ...voiceRooms.map(v => [v.id, v.label])], f.channel_id, (v) => { f.channel_id = v; })),
      h('div.lfgset', h('div', h('b', 'Microfone obrigatório')), toggle(f.mic, (v) => { f.mic = v; })),
      h('label.f', 'Recado (opcional)', h('input', { maxLength: 200, value: f.note, placeholder: 'Ex.: sem rage, call tranquila', oninput: (e) => { f.note = e.target.value; } })));
  };
  draw2();
  modal('Criar anúncio', 'Quem divide servidor com você ou é seu amigo vê o anúncio e pode pedir para entrar.', box, [{ label: 'Cancelar', cls: 'link' }, { label: 'Publicar', cls: 'green', fn: async () => {
    const when_at = f.when === 'later' ? (f.at ? new Date(f.at).getTime() : NaN) : null;
    if (f.when === 'later' && !(when_at > Date.now())) { toast('Escolha um dia e hora no futuro', true); return false; }
    const r = await tryApi('POST', '/lfg/posts', { game: f.game, game_name: f.game_name, mode: f.mode, slots: f.slots, rank_min: f.rank_min || null, rank_max: f.rank_max || null, roles: [...f.roles], mic: f.mic, when_at, note: f.note, channel_id: f.channel_id || null, platform: f.platform, join_mode: f.join_mode });
    if (!r) return false;
    upsert(r); flow('lfg_post', 'done'); toast('Anúncio publicado');
  } }], { width: '560px' });
}

// "Jogando agora" no anúncio: diz se já está funcionando ou o que falta (o FAQ do Discord lista as mesmas condições:
// jogo aberto + compartilhar atividade), sem obrigar nada: o anúncio funciona igual sem isso
function liveHint(f) {
  const g = G(f.game), name = f.game === 'other' ? f.game_name : g?.name;
  const live = name && liveOf({ game: f.game, game_name: name, author: S.me }, S.me.id);
  if (live) return h('div.lfgtip.ok', icon('check', 16), h('span', h('b', `${live.game.title} aberto: `), 'o anúncio vai mostrar "Jogando agora" e as vagas abertas.'));
  const off = S.pcActivity === 'off';
  return h('div.lfgtip', icon('gamepad', 16), h('span', off
    ? ['Seu jogo do PC está escondido para todos, então o anúncio não mostra "Jogando agora". ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.settings?.('connections'); } }, 'Mudar em Contas vinculadas')]
    : 'Opcional: com o jogo aberto (app do Resenha no PC ou Steam vinculada), o anúncio mostra "Jogando agora". Pode abrir depois de publicar, ele aparece sozinho.'));
}

// ---------- conversa do anúncio ----------
// resumo do anúncio no topo do popup: jogo, quando, vagas, elo, plataforma, sala combinada e o que fazer agora
function adInfo(p) {
  const g = G(p.game) || { color: '#5865f2' }, ch = p.channel, gch = ch && guild(ch.guild_id), me = p.author.id === S.me.id;
  const myReq = p.requests.find(r => r.user.id === S.me.id), inGroup = me || myReq?.state === 'accepted', prof = p.author_profile;
  const when = whenText(p);
  const act = [];
  if (ch && inGroup && !['expired', 'closed'].includes(p.closed_reason)) act.push(h('button.btn.green.sm', { onclick: () => goRoom(p) }, icon('voice', 14), 'Ir para a sala'));
  else if (!me && !p.closed && !myReq) act.push(h('button.btn.green.sm', { onclick: async () => { await join(p); const n = st.posts.find(x => x.id === p.id); const el = document.querySelector('.lfgad'); if (n && el) el.replaceWith(adInfo(n)); } }, p.join_mode === 'open' ? 'Entrar' : 'Pedir para entrar'));
  else if (myReq?.state === 'pending') act.push(h('span.lfgad-st', 'Pedido enviado, aguardando resposta'));
  return h('div.lfgad', { style: { '--gc': g.color } },
    h('div.lfgad-top', h('span.lfggame', p.game_name), h('span.lfgmode', p.mode), h('span.lfgwhen' + (when === 'Agora' ? '.now' : ''), when === 'Agora' && h('span.lfgdot'), when)),
    h('div.lfgneed', h('b', p.closed && p.closed_reason === 'full' ? 'Grupo fechado' : `Precisa de ${p.slots}`), h('span', rankText(p)), h('span.lfgplat', platName(p.platform)),
      p.mic && h('span.lfgmic', icon('mic', 14), 'mic'), p.join_mode === 'open' && h('span.lfgopen', 'Entrada direta')),
    p.roles.length > 0 && h('div.lfgroles', p.roles.map(r => h('span', r))),
    p.note && h('div.lfgnote', p.note),
    h('div.lfgad-row', avatar(S.users.get(p.author.id) || p.author, 24, { status: false }), h('span', h('b', p.author.display_name), prof?.ign ? ` · ${prof.ign}${prof.rank ? ' · ' + prof.rank : ''}` : '')),
    h('div.lfgch', icon('voice', 16), ch ? h('span', `${ch.name}${gch ? ' · ' + gch.name : ''}`) : h('span', 'Sem sala de voz combinada'), ch && h('small', ch.in_call ? `${ch.in_call} na chamada` : 'sala vazia')),
    ch && !inGroup && !p.closed && h('small.lfgad-hint', p.join_mode === 'open' ? 'Ao entrar, você já vai para esta sala (e para o servidor dela).' : 'Se o pedido for aceito, você recebe o convite para esta sala e já entra no servidor.'),
    act.length > 0 && h('div.lfgad-act', act));
}

async function chatModal(p) {
  const list = h('div.lfgmsgs', h('div.lfghint', 'Carregando…'));
  const input = h('input', { maxLength: 500, placeholder: `Conversar sobre o grupo de ${p.game_name}…`, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
  const row = (m) => h('div.lfgmsg', h('span.lfgav', { onclick: (e) => ctx.profile?.(e.currentTarget, m.author.id) }, avatar(S.users.get(m.author.id) || m.author, 28, { status: false })),
    h('div', h('div.lfgmh', h('b', m.author.display_name), m.author.id === p.author.id && h('span.lfgtag', 'autor'), h('small', new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))), h('div.lfgmt', m.content)));
  const msgs = [];
  const paint = () => { put(list, msgs.length ? msgs.map(row) : h('div.lfghint', 'Ninguém escreveu ainda. Combine estilo de jogo, microfone e horário antes de entrar.')); list.scrollTop = list.scrollHeight; };
  const send = async () => {
    const content = input.value.trim(); if (!content) return;
    input.value = ''; const m = await tryApi('POST', `/lfg/posts/${p.id}/messages`, { content });
    if (!m) { input.value = content; return; }
    if (!msgs.some(x => x.id === m.id)) { msgs.push(m); paint(); }
  };
  st.chat = { id: p.id, add: (m) => { if (!msgs.some(x => x.id === m.id)) { msgs.push(m); paint(); } } };
  const box = h('div.lfgchat', adInfo(p), list, h('div.lfgsend', input, h('button.btn.green', { onclick: send }, 'Enviar')));
  modal(`Conversa · ${p.game_name} (${p.mode})`, `Anúncio de ${p.author.display_name}. Quem vê o anúncio vê a conversa.`, box, [{ label: 'Fechar', cls: 'grey' }], { width: '520px' });
  setTimeout(() => input.focus(), 50);
  const r = await tryApi('GET', `/lfg/posts/${p.id}/messages`);
  if (r) { for (const m of r) if (!msgs.some(x => x.id === m.id)) msgs.push(m); msgs.sort((a, b) => a.created_at - b.created_at); }
  paint();
}

// ---------- perfil de jogador ----------
export const openLfgProfile = () => profileModal();
async function profileModal() {
  const games = (await meta()).filter(g => g.id !== 'other');
  const mine = new Map(((await tryApi('GET', '/lfg/profile/@me')) || []).map(p => [p.game, p]));
  let cur = st.game && st.game !== 'other' ? st.game : 'valorant';
  const box = h('div.lfgform');
  const draw2 = () => {
    const g = G(cur), p = mine.get(cur) || { ign: '', rank: '', roles: [] }, roles = new Set(p.roles);
    const ign = h('input', { maxLength: 60, value: p.ign || '', placeholder: g.idHint || 'seu nick no jogo' });
    const rank = g.ranks.length ? h('select', [['', 'Não informar'], ...g.ranks.map(r => [r, r])].map(([v, l]) => h('option', { value: v, selected: (p.rank || '') === v }, l))) : null;
    const roleBtns = h('div.lfgroles.pick', g.roles.map(r => h('button' + (roles.has(r) ? '.on' : ''), { onclick: (e) => { roles.has(r) ? roles.delete(r) : roles.add(r); e.currentTarget.classList.toggle('on'); } }, r)));
    put(box,
      h('div.lfgchips.pick', games.map(x => h('button.lchip' + (cur === x.id ? '.on' : '') + (mine.has(x.id) ? '.has' : ''), { style: { '--gc': x.color }, onclick: () => { cur = x.id; draw2(); } }, h('i'), x.name))),
      h('label.f', g.idLabel || 'Nick no jogo', ign),
      rank && h('label.f', 'Elo atual', rank),
      g.roles.length > 0 && [h('div.lfglab', 'Funções que você costuma jogar'), roleBtns],
      h('p.lfghint', 'Aparece nos seus anúncios e pedidos, com link para o OP.GG/Tracker/Faceit. O elo é informado por você (não é verificado).'),
      h('div.lfgsave', h('button.btn.green', { onclick: async () => {
        const r = await tryApi('PUT', `/lfg/profile/${cur}`, { ign: ign.value.trim(), rank: rank?.value || null, roles: [...roles] });
        if (r === undefined) return; if (r) mine.set(cur, r); else mine.delete(cur); toast(`Perfil de ${g.name} salvo`); draw2(); load();
      } }, `Salvar ${g.name}`)));
  };
  draw2();
  modal('Meu perfil de jogador', null, box, [{ label: 'Fechar', cls: 'grey' }], { width: '520px' });
}

// ---------- eventos em tempo real ----------
// alguém abriu/fechou um jogo: redesenha o mural (o "Jogando agora" dos cartões)
export function onLfgActivity(uid) { if (st.root && document.body.contains(st.root) && st.posts.some(p => p.author.id === uid)) draw(); }
export function onLfgEvent(t, d) {
  if (t === 'LFG_POST') {
    const isNew = !st.posts.some(p => p.id === d.id);
    if (isNew && d.author.id !== S.me.id && !d.closed && (S.prefs.lfgAlerts || {})[d.game] && Date.now() - d.created_at < 15000 && alertAllowed('server')) { // modo foco: em silêncio
      playSound('mention'); toast(`${d.author.display_name} procura ${d.slots === 1 ? '1 pessoa' : d.slots + ' pessoas'} para ${d.game_name} (${d.mode})`);
      notify(`Procurando grupo: ${d.game_name}`, `${d.author.display_name} · ${d.mode} · precisa de ${d.slots}`, () => ctx.go('@me', 'lfg'));
    }
    if (st.root && document.body.contains(st.root)) upsert(d); else { const i = st.posts.findIndex(p => p.id === d.id); if (i >= 0) st.posts[i] = d; else st.posts.push(d); }
  }
  if (t === 'LFG_REQUEST') {
    if (alertAllowed('dm')) playSound('mention'); toast(`${d.user.display_name} quer entrar no seu grupo de ${d.game_name}`);
    notify(`${d.user.display_name} quer entrar no seu grupo`, `${d.game_name} · ${d.mode}`, () => ctx.go('@me', 'lfg'));
  }
  if (t === 'LFG_MESSAGE') {
    const i = st.posts.findIndex(x => x.id === d.post_id); if (i >= 0) { st.posts[i] = { ...st.posts[i], msg_count: d.count }; if (st.root && document.body.contains(st.root)) draw(); }
    if (st.chat?.id === d.post_id && document.querySelector('.lfgchat')) st.chat.add(d);
    else if (d.post_author === S.me.id && d.author.id !== S.me.id) { toast(`${d.author.display_name} escreveu no seu anúncio de ${d.game_name}`); notify(`Conversa do anúncio: ${d.game_name}`, `${d.author.display_name}: ${d.content}`, () => ctx.go('@me', 'lfg')); }
  }
  if (t === 'LFG_JOINED') {
    if (alertAllowed('dm')) playSound('mention'); toast(`${d.user.display_name} entrou no seu grupo de ${d.game_name}${d.invited ? ' (convite para a chamada enviado)' : ''}`);
    notify(`${d.user.display_name} entrou no seu grupo`, `${d.game_name} · ${d.mode}`, () => ctx.go('@me', 'lfg'));
  }
  if (t === 'LFG_LEFT') toast(`${d.user.display_name} saiu do seu grupo de ${d.game_name}. A vaga voltou para o anúncio.`);
  if (t === 'LFG_ANSWER') {
    if (d.accept) { if (alertAllowed('dm')) playSound('mention'); toast(d.invited ? `${d.author.display_name} aceitou! Veja o convite para a chamada${d.room ? ' em ' + d.room.name : ''}.` : d.room ? `${d.author.display_name} aceitou! A sala é ${d.room.name}: use "Ir para a sala" no anúncio.` : `${d.author.display_name} aceitou você no grupo de ${d.game_name}!`); }
    else toast(`${d.author.display_name} recusou o pedido para ${d.game_name}`, true);
  }
}
