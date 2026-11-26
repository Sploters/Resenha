// "Times e fila" da chamada (atividade do foguete; servidor: server/lobby.js).
// Fila do lobby: jogo com N vagas, quem está jogando, a fila numerada ("próximo") e quem está só na resenha. Quando a vez
// chega, o app avisa com som, aviso na tela e notificação (se a janela estiver em segundo plano).
// Sorteio de times: na sorte ou equilibrado (força de cada um no jogo, pelos resultados marcados), com mapa e
// agente/personagem/função sorteados de uma lista pronta do jogo ou da sua própria lista (guardada por jogo).
import { h, icon, avatar } from './util.js';
import { S, toast, modal, notify, nameOf, channelById, menu, tryApi, savePrefs } from './state.js';
import { playSound } from './sounds.js';
import { voice } from './gateway.js';

// listas prontas: mapas e agentes/personagens/funções. Dá para trocar por uma lista própria (fica guardada por jogo).
const PRESETS = [
  { re: /counter.?strike|cs2|csgo|^cs$/, slots: 5, maps: ['Ancient', 'Anubis', 'Dust II', 'Inferno', 'Mirage', 'Nuke', 'Overpass', 'Train', 'Vertigo'] },
  { re: /valorant/, slots: 5, maps: ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset'],
    agents: ['Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade', 'Gekko', 'Harbor', 'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Neon', 'Omen', 'Phoenix', 'Raze', 'Reyna', 'Sage', 'Skye', 'Sova', 'Tejo', 'Viper', 'Vyse', 'Waylay', 'Yoru'] },
  { re: /league of legends|^lol$/, slots: 5, agents: ['Top', 'Selva', 'Meio', 'Atirador', 'Suporte'] },
  { re: /rainbow|siege|^r6/, slots: 5, maps: ['Bank', 'Border', 'Chalet', 'Clubhouse', 'Coastline', 'Consulate', 'Kafe Dostoyevsky', 'Lair', 'Nighthaven Labs', 'Oregon', 'Skyscraper', 'Villa'] },
  { re: /overwatch/, slots: 5, agents: ['Tanque', 'Dano', 'Suporte'] },
  { re: /rocket league/, slots: 3 }, { re: /fortnite/, slots: 4 }, { re: /apex/, slots: 3 }, { re: /^peak$/, slots: 4 }, { re: /^r\.?e\.?p\.?o\.?$/, slots: 6 },
  { re: /dota/, slots: 5, agents: ['Carry', 'Meio', 'Offlane', 'Suporte (4)', 'Suporte (5)'] },
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const presetOf = (game) => PRESETS.find(p => p.re.test(norm(game))) || null;
const keyOf = (game) => norm(game).replace(/[^a-z0-9]+/g, '');
const lists = (game) => { // a lista própria (se tiver) vence a pronta
  const own = S.prefs.lobbyLists?.[keyOf(game)], p = presetOf(game);
  return { maps: own?.maps ?? p?.maps ?? [], agents: own?.agents ?? p?.agents ?? [], own: !!own };
};
const splitList = (t) => [...new Set(String(t || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean))].slice(0, 60);

const room = () => (S.room?.cid === voice?.channelId ? S.room : null);
const L = () => room()?.lobby || null;
const send = (d) => voice?.send('ROOM_LOBBY', d);
const gid = () => channelById(voice?.channelId)?.guild_id;
const who = (uid) => nameOf(uid, gid());
// quem está na call agora, na ordem de entrada (sem bots)
const callIds = () => [...S.voice.values()].filter(v => v.channel_id === voice?.channelId && !v.bot).map(v => v.user_id);
// jogo mais comum entre quem está na call (jogo detectado no PC ou Steam)
function guessGame() {
  const ids = new Set(callIds()), n = new Map();
  for (const a of S.activities?.values() || []) if (ids.has(a.user_id) && a.game?.title) n.set(a.game.title, (n.get(a.game.title) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export const lobbyEntry = () => ({ id: 'lobby', icon: 'users', title: 'Times e fila', desc: 'Sortear times, mapa e agentes; fila de quem joga a próxima', color: '#d6408f', on: !!L(), fn: () => openLobby() });

// ---------- avisos: chegou a sua vez / você é o próximo / times sorteados ----------
export function lobbyChanged(prev, next) {
  document.dispatchEvent(new Event('lobby-changed'));
  const me = S.me.id; if (!next) return;
  const wasQ = prev?.queue?.indexOf(me) ?? -1, nowQ = next.queue.indexOf(me);
  if (prev && !prev.playing.includes(me) && next.playing.includes(me) && wasQ >= 0) {
    playSound('lobbyTurn');
    toast(`Sua vez! Você entrou no ${next.game}.`);
    if (!document.hasFocus()) notify('Sua vez no lobby', `Você entrou no ${next.game}.`, () => openLobby(), 'lobby');
  } else if (nowQ === 0 && wasQ !== 0 && prev) toast(`Você é o próximo da fila do ${next.game}.`);
  const t = next.teams;
  if (t && t.at !== prev?.teams?.at && t.by !== me && !document.querySelector('.lobby-box')) {
    const side = t.a.includes(me) ? 'A' : t.b.includes(me) ? 'B' : null;
    toast(`${who(t.by)} sorteou os times${side ? `: você está no Time ${side}` : ''}${t.picks?.[me] ? ` (${t.picks[me]})` : ''}${t.map ? ` · ${t.map}` : ''}.`);
  }
}

// ---------- janela ----------
export function openLobby() {
  if (!voice?.channelId) return toast('Entre numa sala de voz para usar Times e fila.', true);
  if (document.querySelector('.lobby-box')) return;
  const body = h('div.lobby-box');
  const ui = { mode: S.prefs.lobbyMode || 'luck', pool: 'playing', editing: false };
  const draw = () => { if (!body.isConnected && body.dataset.drawn) return document.removeEventListener('lobby-changed', draw); body.dataset.drawn = 1; body.replaceChildren(...(L() ? lobbyView(ui, draw) : setupView())); };
  document.addEventListener('lobby-changed', draw);
  draw();
  modal('Times e fila', 'Quem joga, quem está na fila e os times da partida. Todo mundo da chamada vê e pode mexer.', body, [{ label: 'Fechar', cls: 'link' }], { width: 'min(820px, 96vw)' });
}

function slotsCtl(val, on) {
  const out = h('b', String(val));
  const step = (d) => { val = Math.max(1, Math.min(16, val + d)); out.textContent = val; on(val); };
  return h('div.lb-slots', h('button.ibtn', { title: 'Menos vagas', onclick: () => step(-1) }, icon('minus', 16)), out, h('button.ibtn', { title: 'Mais vagas', onclick: () => step(1) }, icon('plus', 16)));
}

function setupView() {
  let game = guessGame(), slots = presetOf(game)?.slots || 5;
  const slotBox = h('div'), note = h('p.mut'), n = callIds().length;
  const drawNote = () => { note.textContent = n > slots ? `Na call agora: ${n}. ${slots} começam jogando e ${n - slots} ${n - slots === 1 ? 'fica' : 'ficam'} na fila, na ordem em que entraram.` : `Na call agora: ${n}. Quem entrar depois vai para a fila quando o lobby lotar.`; };
  const drawSlots = () => { slotBox.replaceChildren(slotsCtl(slots, (v) => { slots = v; drawNote(); })); drawNote(); };
  const inp = h('input.lb-game', { value: game, maxLength: 60, placeholder: 'Ex.: Counter-Strike 2', oninput: () => { game = inp.value; const p = presetOf(game); if (p) { slots = p.slots; drawSlots(); } } });
  drawSlots();
  return [
    h('div.lb-setup',
      h('label.f', 'Jogo', inp),
      h('div.flab', 'Vagas por partida'), slotBox,
      note,
      h('button.btn', { onclick: () => send({ op: 'open', game: inp.value.trim() || 'Partida', slots }) }, icon('users', 18), 'Abrir lobby')),
  ];
}

function person(uid, extra, opts = {}) {
  const u = S.users.get(uid) || { id: uid, display_name: '?' }, me = uid === S.me.id;
  return h('div.lb-p' + (me ? '.me' : '') + (opts.cls || ''), { title: 'Clique para mover', onclick: (e) => moveMenu(e, uid) },
    opts.n != null && h('span.lb-n', opts.n === 0 ? 'Próximo' : `${opts.n + 1}º`),
    avatar(u, 28, { status: false }), h('span.lb-name', who(uid) + (me ? ' (você)' : '')), extra);
}
function moveMenu(e, uid) {
  const l = L(); if (!l) return;
  const inP = l.playing.includes(uid), inQ = l.queue.includes(uid);
  menu(e, [
    !inP && (l.playing.length >= l.slots ? { label: 'Pôr para jogar', hint: 'Lobby cheio: aumente as vagas ou faça o rodízio', fn: () => toast('O lobby está cheio. Aumente as vagas em Editar ou use "Fim da partida".', true) } : { label: 'Pôr para jogar', fn: () => send({ op: 'move', uid, to: 'playing' }) }),
    !inQ && { label: 'Mandar para o fim da fila', fn: () => send({ op: 'move', uid, to: 'queue' }) },
    inQ && l.queue.indexOf(uid) > 0 && { label: 'Passar para o começo da fila', fn: () => send({ op: 'move', uid, to: 'queue', index: 0 }) },
    (inP || inQ) && { label: 'Só na resenha (fora da fila)', fn: () => send({ op: 'move', uid, to: 'out' }) },
  ]);
}

function lobbyView(ui, redraw) {
  const l = L(), me = S.me.id, inCall = callIds(), out = inCall.filter(u => !l.playing.includes(u) && !l.queue.includes(u));
  const where = l.playing.includes(me) ? 'playing' : l.queue.includes(me) ? 'queue' : 'out';
  const myBtns = where === 'playing' ? [h('button.btn.grey', { title: 'Você vai para o fim da fila e o próximo entra', onclick: () => send({ op: 'pass' }) }, 'Passar a vez'), h('button.btn.link', { onclick: () => send({ op: 'out' }) }, 'Só resenhar')]
    : where === 'queue' ? [h('span.lb-pos', l.queue.indexOf(me) === 0 ? 'Você é o próximo' : `Você é o ${l.queue.indexOf(me) + 1}º da fila`), h('button.btn.link', { onclick: () => send({ op: 'out' }) }, 'Sair da fila')]
      : [h('button.btn', { onclick: () => send({ op: 'join' }) }, 'Entrar na fila')];
  const stat = (uid) => { const s = l.stats?.[uid]; return s?.g ? h('small.lb-vd', { title: `${s.w} vitórias em ${s.g} partidas de ${l.game} (sorteios marcados aqui)` }, `${s.w}V ${s.g - s.w}D`) : null; };
  const head = ui.editing
    ? (() => {
      let slots = l.slots; const gi = h('input.lb-game', { value: l.game, maxLength: 60 });
      return h('div.lb-head', gi, slotsCtl(slots, (v) => { slots = v; }), h('button.btn', { onclick: () => { ui.editing = false; send({ op: 'open', game: gi.value.trim() || l.game, slots }); redraw(); } }, 'Salvar'), h('button.btn.link', { onclick: () => { ui.editing = false; redraw(); } }, 'Cancelar'));
    })()
    : h('div.lb-head', h('div.lb-title', icon('gamepad', 20), h('b', l.game), h('span.mut', `${l.slots} ${l.slots === 1 ? 'vaga' : 'vagas'} · rodada ${l.round}`)),
      h('button.btn.link', { onclick: () => { ui.editing = true; redraw(); } }, 'Editar'));
  const cols = h('div.lb-cols',
    h('div.lb-col', h('h4', `Jogando ${l.playing.length}/${l.slots}`), ...l.playing.map(u => person(u, stat(u))), ...Array.from({ length: Math.max(0, l.slots - l.playing.length) }, () => h('div.lb-p.empty', h('i', 'Vaga livre')))),
    h('div.lb-col', h('h4', `Fila ${l.queue.length ? '(' + l.queue.length + ')' : ''}`), ...(l.queue.length ? l.queue.map((u, i) => person(u, stat(u), { n: i, cls: i === 0 ? '.next' : '' })) : [h('p.mut', 'Ninguém esperando.')]),
      out.length > 0 && [h('h4', { style: { marginTop: '14px' } }, 'Só na resenha'), ...out.map(u => person(u, null, { cls: '.out' }))]));
  const actions = h('div.lb-actions', ...myBtns, h('span.grow'),
    h('button.btn.grey', { title: l.queue.length ? `Quem joga há mais tempo cede a vaga para os ${Math.min(l.queue.length, l.playing.length)} primeiros da fila` : 'Ninguém na fila: só conta a rodada e limpa os times', onclick: () => send({ op: 'rotate' }) }, icon('shuffle', 16), 'Fim da partida (rodízio)'),
    h('button.btn.link.red', { onclick: () => send({ op: 'close' }) }, 'Fechar lobby'));
  return [head, cols, actions, teamsView(ui, redraw, l)];
}

function teamsView(ui, redraw, l) {
  const T = l.teams, me = S.me.id, ls = lists(l.game);
  const box = h('div.lb-teams');
  const draw = () => send({ op: 'teams', mode: ui.mode, pool: ui.pool, maps: ls.maps, agents: ls.agents });
  const edit = () => {
    const mi = h('textarea', { rows: 4, value: ls.maps.join('\n'), placeholder: 'Um por linha (vazio: não sorteia mapa)' });
    const ai = h('textarea', { rows: 4, value: ls.agents.join('\n'), placeholder: 'Um por linha (vazio: não sorteia)' });
    modal(`Listas do ${l.game}`, 'Mapas e agentes/personagens/funções para o sorteio. Fica guardado para este jogo.', h('div', h('label.f', 'Mapas', mi), h('label.f', 'Agentes, personagens ou funções', ai)),
      [presetOf(l.game) && ls.own && { label: 'Voltar à lista pronta', cls: 'link', fn: () => { delete S.prefs.lobbyLists[keyOf(l.game)]; savePrefs(); redraw(); } },
        { label: 'Cancelar', cls: 'link' },
        { label: 'Salvar', fn: () => { (S.prefs.lobbyLists ||= {})[keyOf(l.game)] = { maps: splitList(mi.value), agents: splitList(ai.value) }; savePrefs(); redraw(); } }].filter(Boolean));
  };
  const opts = h('div.lb-opts',
    seg2([['luck', 'Na sorte'], ['balanced', 'Equilibrado']], ui.mode, (v) => { ui.mode = v; S.prefs.lobbyMode = v; savePrefs(); }, { balanced: 'Soma de força parecida nos dois times (pelos resultados marcados aqui) e separa quem estava junto no último sorteio' }),
    seg2([['playing', 'Quem está jogando'], ['call', 'A call toda']], ui.pool, (v) => { ui.pool = v; }),
    h('button.btn.link', { title: 'Mapas e agentes do sorteio', onclick: edit }, `${ls.maps.length ? ls.maps.length + ' mapas' : 'sem mapas'} · ${ls.agents.length ? ls.agents.length + ' agentes' : 'sem agentes'}`),
    h('span.grow'),
    h('button.btn', { onclick: draw }, icon('shuffle', 16), T ? 'Sortear de novo' : 'Sortear times'));
  box.append(h('h4.lb-sec', 'Sorteio de times'), opts);
  if (!T) return box;
  const team = (k, ids) => h('div.lb-team.t' + k + (T.result === k ? '.won' : T.result ? '.lost' : ''),
    h('div.lb-th', h('b', `Time ${k.toUpperCase()}`), T.result === k && h('span.lb-win', icon('trophy', 14), 'Venceu')),
    ...ids.map(u => h('div.lb-p' + (u === me ? '.me' : ''), avatar(S.users.get(u) || { id: u }, 28, { status: false }), h('span.lb-name', who(u)), T.picks?.[u] && h('span.lb-agent', T.picks[u]))));
  box.append(
    h('div.lb-tmeta', h('span.mut', `${T.mode === 'balanced' ? 'Equilibrado' : 'Na sorte'} · por ${who(T.by)}`),
      T.map && h('span.lb-map', icon('compass', 14), T.map, h('button.ibtn', { title: 'Sortear outro mapa', onclick: () => send({ op: 'reroll', what: 'map' }) }, icon('shuffle', 14))),
      T.agents?.length > 0 && h('button.btn.link', { onclick: () => send({ op: 'reroll', what: 'agents' }) }, 'Sortear agentes de novo')),
    h('div.lb-vs', team('a', T.a), h('span.lb-x', 'x'), team('b', T.b)),
    h('div.lb-actions',
      T.result ? h('button.btn.link', { onclick: () => send({ op: 'undo_result' }) }, 'Desfazer resultado')
        : [h('button.btn.grey', { onclick: () => send({ op: 'result', win: 'a' }) }, icon('trophy', 16), 'Time A venceu'), h('button.btn.grey', { onclick: () => send({ op: 'result', win: 'b' }) }, icon('trophy', 16), 'Time B venceu')],
      h('span.grow'),
      h('button.btn.link', { onclick: () => postTeams(l, T) }, 'Mandar no chat')));
  return box;
}
// seletor de 2-3 opções (marca na hora, sem esperar o servidor)
function seg2(opts, val, on, titles = {}) {
  const box = h('div.seg');
  const draw = () => box.replaceChildren(...opts.map(([k, l]) => h('button' + (k === val ? '.on' : ''), { title: titles[k] || null, onclick: () => { if (k === val) return; val = k; on(k); draw(); } }, l)));
  draw(); return box;
}
async function postTeams(l, T) {
  const line = (ids) => ids.map(u => `<@${u}>${T.picks?.[u] ? ` (${T.picks[u]})` : ''}`).join(', ');
  const txt = `**${l.game}**${T.map ? ` · mapa: **${T.map}**` : ''}\n**Time A:** ${line(T.a)}\n**Time B:** ${line(T.b)}${T.result ? `\n🏆 Time ${T.result.toUpperCase()} venceu` : ''}`;
  if (await tryApi('POST', `/channels/${voice.channelId}/messages`, { content: txt })) toast('Times enviados no chat da sala');
}
