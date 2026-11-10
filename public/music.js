// Bot de música (server/music.js), no estilo do Jockie Music. Popup do painel de voz:
// - busca no topo (nome: escolher entre os resultados; link: entra direto), com tocar agora / a seguir / no fim
// - "tocando agora" com a capa ao fundo, barra para pular para qualquer ponto e os controles no centro
// - reprodução automática e 24/7 como chips, volume do bot só para você
// - abas Fila (arrastar para reordenar), Histórico e Playlists do servidor; rodapé com parar e tirar o bot da sala
import { h, icon } from './util.js';
import { S, toast, popout, promptBox, confirmBox, menu } from './state.js';

let send = () => { }, state = null, redraw = null, rid = 0;
const waiting = new Map();
const recvAt = { t: 0 };
const ui = { tab: 'queue', results: null, searching: false, playlists: null };

export const initMusic = (gwSend) => { send = gwSend; };
export const musicState = () => state;

export function onState(d) {
  if (!d.active) { if (state?.active && d.notice) toast(d.notice); state = d.channel_id ? { channel_id: d.channel_id, active: false } : null; }
  else { state = d; recvAt.t = Date.now(); if (d.notice) toast(d.notice, true); }
  redraw?.();
  document.dispatchEvent(new Event('music-changed'));
}
export function onRes(d) {
  const w = waiting.get(d.rid); if (!w) return;
  waiting.delete(d.rid); d.error ? w.reject(new Error(d.error)) : w.resolve(d.data);
}
export const musicCmd = (op, extra = {}) => new Promise((resolve, reject) => {
  const id = ++rid; waiting.set(id, { resolve, reject });
  send('MUSIC', { rid: id, op, ...extra });
  setTimeout(() => { if (waiting.delete(id)) reject(new Error('Sem resposta do servidor')); }, 90_000);
});
const act = (op, extra) => musicCmd(op, extra).catch(e => { toast(e.message, true); return null; });

const fmt = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(s % 60).padStart(2, '0'); };
const who = (id) => (id === state?.bot_id ? 'automático' : S.users.get(id)?.display_name || 'alguém');
const elapsedMs = () => (state?.current ? state.elapsed + (state.paused || state.loading || state.stalled ? 0 : Date.now() - recvAt.t) : 0);
// resposta imediata no painel (o servidor confirma logo depois com o estado de verdade)
const optimistic = (patch) => { if (!state?.current) return; state = { ...state, elapsed: elapsedMs(), ...patch }; recvAt.t = Date.now(); redraw?.(); };
const isLink = (q) => /^https?:\/\//i.test(q);
const LOOP = { off: ['Repetir', 'Repetir desligado'], track: ['Repetindo a música', 'Repetindo esta música'], queue: ['Repetindo a fila', 'Repetindo a fila inteira'] };
const art = (t, cls = '.muart') => (t?.thumb ? h('img' + cls, { src: t.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('div' + cls + '.ph', icon('music', 18)));

export function openMusic(anchor, voice) {
  const body = h('div.mupanel');
  // ---------- busca ----------
  const input = h('input.muin', { type: 'search', placeholder: 'Buscar música ou colar um link', maxLength: 500, 'aria-label': 'Buscar música ou colar link' });
  const spin = h('span.muspin', { 'aria-hidden': 'true' });
  let busy = false;
  const play = async (extra) => {
    const r = await act('play', extra); if (!r) return null;
    toast(r.added > 1 ? `${r.added} músicas na fila` : `${r.where === 'now' ? 'Tocando' : r.where === 'next' ? 'A seguir' : 'Na fila'}: ${r.title}`);
    ui.results = null; redraw?.(); return r;
  };
  const submit = async (where = 'end') => {
    const q = input.value.trim(); if (!q || busy) return;
    busy = true; ui.searching = true; redraw();
    try {
      if (isLink(q)) { if (await play({ query: q, where })) input.value = ''; } // link (vídeo, playlist, Spotify…): entra direto
      else ui.results = (await musicCmd('search', { query: q })).results; // nome: escolher entre os resultados
    } catch (e) { toast(e.message, true); }
    busy = false; ui.searching = false; redraw();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(e.shiftKey ? 'next' : 'end'); if (e.key === 'Escape' && ui.results) { ui.results = null; redraw(); e.preventDefault(); } e.stopPropagation(); };
  input.oninput = () => { if (!input.value && ui.results) { ui.results = null; redraw(); } };
  const searchBox = h('label.musearch', icon('search', 16), input, spin);

  // ---------- tocando agora ----------
  const fill = h('div.mufill'), knob = h('i.muknob'), tCur = h('span', '0:00'), tEnd = h('span', '');
  const seekBar = h('div.mubar', { role: 'slider', 'aria-label': 'Posição na música', tabIndex: 0,
    onclick: (e) => { const c = state?.current; if (!c?.duration) return; const r = seekBar.getBoundingClientRect(); seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * c.duration * 1000); },
    onkeydown: (e) => { if (!state?.current) return; const d = e.key === 'ArrowRight' ? 10e3 : e.key === 'ArrowLeft' ? -10e3 : 0; if (d) { e.preventDefault(); e.stopPropagation(); seekTo(elapsedMs() + d); } } }, h('div.mutrack', fill), knob);
  const seekTo = (ms) => { const c = state?.current; ms = Math.max(0, Math.min(c?.duration ? c.duration * 1000 - 1000 : Infinity, ms)); optimistic({ elapsed: ms, loading: true }); act('seek', { ms }); };
  const togglePause = () => { const p = !state.paused; optimistic({ paused: p }); act(p ? 'pause' : 'resume'); };
  // o painel é montado depois do primeiro desenho: só para de atualizar quando ele sai da tela de verdade
  let mounted = false;
  const tick = () => {
    if (!body.isConnected) { if (mounted) clearInterval(iv); return; }
    const c = state?.current; if (!c) return;
    const el = Math.min(elapsedMs() / 1000, c.duration || Infinity), p = c.duration ? Math.min(100, el / c.duration * 100) + '%' : '0%';
    fill.style.width = p; knob.style.left = p;
    tCur.textContent = state.loading ? 'carregando…' : state.stalled ? fmt(el) + ' · carregando…' : fmt(el); tEnd.textContent = c.duration ? fmt(c.duration) : 'ao vivo';
  };
  const iv = setInterval(tick, 250);
  const ibtn = (ic, title, fn, cls = '') => h('button.muib' + cls, { type: 'button', title, 'aria-label': title, onclick: fn }, ic);
  const chip = (ic, label, on, title, fn) => h('button.muchip' + (on ? '.on' : ''), { type: 'button', title, 'aria-pressed': String(!!on), onclick: fn }, icon(ic, 14), label);

  const hero = () => {
    const c = state?.active && state.current;
    if (!c) return h('div.muhero.empty', h('div.muhero-in',
      h('div.muart.big.ph', icon('music', 30)),
      h('div.mutitle', h('b', state?.active ? 'Nada tocando' : 'O bot ainda não está na sala'),
        h('small', state?.active ? 'Busque uma música para continuar.' : 'Busque uma música ou cole um link (YouTube, Spotify, SoundCloud…). O bot entra e toca para todos.'))));
    return h('div.muhero', c.thumb ? h('div.mubg', { style: { backgroundImage: `url("${String(c.thumb).replace(/["\\\n]/g, encodeURIComponent)}")` } }) : null,
      h('div.muhero-in',
        h('div.murow', art(c, '.muart.big'),
          h('div.mutitle', h('b', { title: c.title }, c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.title) : c.title),
            h('small', [c.artist, c.auto ? 'reprodução automática' : `pedido por ${who(c.by)}`].filter(Boolean).join(' · ')))),
        seekBar, h('div.mutimes', tCur, tEnd),
        h('div.mucontrols',
          ibtn(icon('shuffle', 18), 'Embaralhar a fila', () => act('shuffle'), state.queue.length > 1 ? '' : '.dim'),
          ibtn(icon('skip', 20), 'Voltar para a anterior', () => act('back'), '.back'),
          ibtn(icon(state.paused ? 'play' : 'pause', 22), state.paused ? 'Continuar' : 'Pausar', togglePause, '.main'),
          ibtn(icon('skip', 20), 'Pular', () => act('skip')),
          ibtn([icon('refresh', 18), state.loop === 'track' ? h('i.mu1', '1') : null], LOOP[state.loop][1] + ' (clique para trocar)', () => act('loop'), state.loop !== 'off' ? '.on' : ''))));
  };

  // ---------- listas ----------
  let drag = null;
  const rowMeta = (t, extra) => h('div.mumeta', h('b', { title: t.title }, t.title), h('small', [t.artist, t.duration ? fmt(t.duration) : '', extra].filter(Boolean).join(' · ')));
  const queueItem = (t, i) => h('div.murow.muitem', { draggable: true, title: 'Arraste para mudar a ordem',
    ondragstart: (e) => { drag = t.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => { drag = null; e.currentTarget.classList.remove('dragging'); },
    ondragover: (e) => { if (drag && drag !== t.id) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); if (drag && drag !== t.id) act('move', { id: drag, to: i }); drag = null; } },
    h('span.muidx', String(i + 1)), art(t), rowMeta(t, who(t.by)),
    h('span.muacts', ibtn(icon('play', 14), 'Tocar agora', () => act('skipto', { id: t.id })), ibtn(icon('x', 14), 'Tirar da fila', () => act('remove', { id: t.id }), '.del')));
  const addActs = (t) => h('span.muacts.show', ibtn(icon('play', 14), 'Tocar agora', () => play({ track: t, where: 'now' })),
    h('button.mutxt', { type: 'button', title: 'Tocar logo depois desta', onclick: () => play({ track: t, where: 'next' }) }, 'A seguir'),
    ibtn(icon('plus', 15), 'Adicionar no fim da fila', () => play({ track: t, where: 'end' })));
  const resultsView = () => h('div.mulist', h('div.musec', h('span', 'Resultados'), h('button.mulink', { type: 'button', onclick: () => { ui.results = null; input.value = ''; redraw(); } }, 'Fechar')),
    ...ui.results.map(t => h('div.murow.muitem.res', art(t), rowMeta(t), addActs(t))));
  const loadPlaylists = async () => { const r = await act('pl_list'); ui.playlists = r?.playlists || []; redraw(); };
  const queueMenu = (e) => menu(e, [
    state.queue.length > 1 && { label: 'Embaralhar a fila', fn: () => act('shuffle') },
    state.queue.length > 1 && { label: 'Tirar repetidas', fn: () => act('dedupe') },
    (state.current || state.queue.length) && { label: 'Salvar como playlist…', fn: savePl },
    state.queue.length > 0 && '-', state.queue.length > 0 && { label: 'Limpar a fila', danger: true, fn: () => act('clear') }]);
  const savePl = async () => { const n = await promptBox('Salvar como playlist', 'Nome da playlist', ''); if (!n) return; const r = await act('pl_save', { name: n }); if (r) { ui.playlists = r.playlists; toast(`Playlist "${n}" salva com ${r.saved} músicas`); redraw(); } };
  const tabBody = () => {
    if (ui.tab === 'playlists') {
      const list = ui.playlists;
      return h('div.mulist',
        state?.active && (state.current || state.queue.length) && h('button.mulink.add', { type: 'button', onclick: savePl }, icon('plus', 14), 'Salvar a fila atual como playlist'),
        !list ? h('div.muempty', 'Carregando…') : !list.length ? h('div.muempty', 'Nenhuma playlist salva neste servidor.')
          : list.map(p => h('div.murow.muitem', h('div.muart.ph.pl', icon('music', 16)),
            h('div.mumeta', h('b', p.name), h('small', `${p.count} ${p.count === 1 ? 'música' : 'músicas'}${p.duration ? ' · ' + fmt(p.duration) : ''} · ${who(p.by)}`)),
            h('span.muacts.show', h('button.mutxt', { type: 'button', title: 'Pôr todas no fim da fila', onclick: () => act('pl_load', { id: p.id }).then(r => r && toast(`${r.added} músicas de "${p.name}" na fila`)) }, 'Tocar'),
              ibtn(icon('trash', 14), 'Apagar a playlist', async () => { if (await confirmBox('Apagar playlist', `Apagar "${p.name}"?`, 'Apagar')) { const r = await act('pl_delete', { id: p.id }); if (r) { ui.playlists = r.playlists; redraw(); } } }, '.del')))));
    }
    if (!state?.active) return null;
    if (ui.tab === 'history') return h('div.mulist', ...(state.history?.length ? state.history.map(t => h('div.murow.muitem', art(t), rowMeta(t), addActs(t))) : [h('div.muempty', 'Nada tocou ainda nesta sessão.')]));
    return h('div.mulist', ...(state.queue.length ? state.queue.map(queueItem)
      : [h('div.muempty', state.autoplay ? 'Fila vazia: a reprodução automática escolhe a próxima.' : 'Fila vazia. Busque músicas acima; elas entram aqui.')]));
  };

  const draw = () => {
    const inRoom = voice?.active && state?.channel_id === voice.channelId;
    const total = state?.queue?.reduce((a, t) => a + (t.duration || 0), 0) || 0;
    const tab = (k, label, badge, fn) => h('button.mutab' + (ui.tab === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(ui.tab === k), onclick: () => { ui.tab = k; fn?.(); redraw(); } }, label, badge ? h('i', badge) : null);
    body.classList.toggle('busy', ui.searching);
    body.replaceChildren(...[
      searchBox,
      ...(ui.results ? [resultsView()] : [
        hero(),
        state?.active && h('div.mubar2',
          chip('sparkle', 'Automático', state.autoplay, 'Quando a fila acaba, toca músicas parecidas', () => act('autoplay')),
          chip('clock', '24/7', state.stay, 'O bot fica na sala mesmo parado ou sozinho', () => act('stay')),
          inRoom && h('label.muvol', { title: 'Volume do bot só para você' }, icon('headset', 16),
            h('input', { type: 'range', min: 0, max: 200, step: 5, value: voice.volumes[state.bot_id] ?? 100, 'aria-label': 'Volume do bot só para você', oninput: (e) => { voice.setVolume(state.bot_id, +e.target.value); e.target.nextSibling.textContent = e.target.value + '%'; } }),
            h('small', (voice.volumes[state.bot_id] ?? 100) + '%'))),
        h('div.mutabs', { role: 'tablist' },
          state?.active && tab('queue', 'Fila', state.queue.length || null),
          state?.active && tab('history', 'Histórico', null),
          tab('playlists', 'Playlists', null, loadPlaylists),
          h('span.mutabsp'),
          state?.active && ui.tab === 'queue' && total > 0 && h('small.mutotal', fmt(total)),
          state?.active && ui.tab === 'queue' && h('button.muib.sm', { type: 'button', title: 'Mais opções da fila', 'aria-label': 'Mais opções da fila', onclick: queueMenu }, icon('more', 16))),
        tabBody(),
        state?.active && h('div.mufoot', h('span.mubot', h('span.botav.sm', icon('musicbot', 12)), state.bot_n > 1 ? `Música ${state.bot_n}` : 'Música', h('span.bottag', 'BOT'), state.stay && h('small', ' · 24/7')),
          state.current && h('button.mulink', { type: 'button', onclick: () => act('stop') }, icon('stop', 13), 'Parar'),
          h('button.mulink.red', { type: 'button', onclick: () => act('disconnect') }, icon('eject', 13), 'Tirar da sala')),
      ])].filter(Boolean));
    tick();
  };
  redraw = () => {
    if (!document.body.contains(body)) { redraw = null; return; }
    if (!state?.active && ui.tab !== 'playlists') ui.tab = 'queue';
    const f = document.activeElement === input, v = input.value, sc = body.querySelector('.mulist')?.scrollTop;
    draw(); input.value = v; if (f) input.focus();
    const l = body.querySelector('.mulist'); if (l && sc) l.scrollTop = sc;
  };
  if (!state?.active && ui.tab !== 'playlists') ui.tab = 'queue';
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('mu-pop'); mounted = true;
  const place = () => { const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect(); el.style.top = Math.max(8, Math.min(r.top - b.height - 12, innerHeight - b.height - 8)) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - b.width - 8)) + 'px'; };
  place(); new ResizeObserver(place).observe(body); // cresce com a fila/resultados sem sair da tela
  setTimeout(() => input.focus(), 30);
}
