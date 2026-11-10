// Bot de música (server/music.js), no estilo do Jockie Music: painel com busca (escolher entre os resultados), tocar
// agora / a seguir / no fim, barra para pular de ponto, voltar, pular, repetir faixa ou fila, embaralhar, reprodução
// automática, modo 24/7, volume do bot para todos (e só para você), efeitos, e abas Fila (arrastar para reordenar),
// Letra (sincronizada com a música), Histórico e Playlists do servidor. O áudio chega como um participante da sala.
import { h, icon } from './util.js';
import { S, toast, popout, promptBox, confirmBox } from './state.js';
import { slider } from './ui.js';

let send = () => { }, state = null, redraw = null, rid = 0;
const waiting = new Map();
const recvAt = { t: 0 };
const ui = { tab: 'queue', results: null, searching: false, lyrics: null, lyricsFor: null, playlists: null };

export const initMusic = (gwSend) => { send = gwSend; };
export const musicState = () => state;

export function onState(d) {
  if (!d.active) { if (state?.active && d.notice) toast(d.notice); state = d.channel_id ? { channel_id: d.channel_id, active: false } : null; }
  else { if (d.current?.id !== state?.current?.id) { ui.lyrics = null; ui.lyricsFor = null; } state = d; recvAt.t = Date.now(); if (d.notice) toast(d.notice, true); }
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
// posição na música (ms): o servidor manda a posição e a velocidade (efeitos como nightcore andam mais rápido)
const elapsedMs = () => (state?.current ? state.elapsed + (state.paused || state.loading ? 0 : (Date.now() - recvAt.t) * (state.rate || 1)) : 0);
const isLink = (q) => /^https?:\/\//i.test(q);
const LOOP_TXT = { off: 'Repetir: desligado', track: 'Repetindo esta música', queue: 'Repetindo a fila' };

export function openMusic(anchor, voice) {
  const body = h('div.mupanel');
  const input = h('input.muin', { placeholder: 'Nome da música ou link (YouTube, Spotify, SoundCloud…)', maxLength: 500, 'aria-label': 'Buscar música ou colar link' });
  const goBtn = h('button.btn', 'Buscar');
  let busy = false;
  const play = async (extra, label) => {
    const r = await act('play', extra); if (!r) return;
    toast(r.added > 1 ? `${r.added} músicas adicionadas` : `${r.where === 'now' ? 'Tocando' : r.where === 'next' ? 'A seguir' : 'Na fila'}: ${r.title}`);
    ui.results = null; redraw?.(); return r;
  };
  const submit = async (where = 'end') => {
    const q = input.value.trim(); if (!q || busy) return;
    busy = true; goBtn.disabled = true; goBtn.textContent = isLink(q) ? 'Abrindo…' : 'Buscando…';
    try {
      if (isLink(q)) { if (await play({ query: q, where })) input.value = ''; } // link: entra direto
      else { ui.searching = true; redraw(); const r = await musicCmd('search', { query: q }); ui.results = r.results; } // texto: escolher entre os resultados
    } catch (e) { toast(e.message, true); }
    busy = false; ui.searching = false; goBtn.disabled = false; goBtn.textContent = 'Buscar'; redraw();
  };
  goBtn.onclick = () => submit(); input.onkeydown = (e) => { if (e.key === 'Enter') submit(e.shiftKey ? 'next' : 'end'); if (e.key === 'Escape' && ui.results) { ui.results = null; redraw(); e.preventDefault(); } e.stopPropagation(); };
  input.oninput = () => { goBtn.textContent = isLink(input.value.trim()) ? 'Tocar' : 'Buscar'; };

  const bar = h('div.mufill'), knob = h('i.muknob'), time = h('span.mutime', '0:00');
  const seekBar = h('div.mubar', { role: 'slider', 'aria-label': 'Posição na música', tabIndex: 0,
    onclick: (e) => { const c = state?.current; if (!c?.duration) return; const r = seekBar.getBoundingClientRect(); act('seek', { ms: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * c.duration * 1000 }); },
    onkeydown: (e) => { if (!state?.current) return; const d = e.key === 'ArrowRight' ? 10e3 : e.key === 'ArrowLeft' ? -10e3 : 0; if (d) { e.preventDefault(); e.stopPropagation(); act('seek', { ms: elapsedMs() + d }); } } }, bar, knob);
  let lyricBox = null;
  const tick = () => {
    if (!document.body.contains(body)) return clearInterval(iv);
    const c = state?.current; if (!c) return;
    const ms = elapsedMs(), el = Math.min(ms / 1000, c.duration || Infinity), p = c.duration ? (el / c.duration * 100) + '%' : '0%';
    bar.style.width = p; knob.style.left = p;
    time.textContent = state.loading ? 'carregando…' : `${fmt(el)} / ${c.duration ? fmt(c.duration) : 'ao vivo'}`;
    // letra sincronizada: destaca a linha da vez e mantém à vista
    const syn = ui.lyrics?.synced; if (lyricBox && syn?.length) {
      let i = syn.findIndex(([t]) => t > ms) - 1; if (i < -1) i = syn.length - 1;
      const cur = lyricBox.querySelector('.ly.on'), next = lyricBox.children[i];
      if (next !== cur) { cur?.classList.remove('on'); if (next) { next.classList.add('on'); lyricBox.scrollTo({ top: next.offsetTop - lyricBox.clientHeight / 2 + 12, behavior: 'smooth' }); } }
    }
  };
  const iv = setInterval(tick, 300);

  const ctl = (ic, title, fn, cls = '') => h('button.mubtn' + cls, { type: 'button', title, 'aria-label': title, onclick: fn }, ic);
  const loadLyrics = async () => {
    const c = state?.current; if (!c || ui.lyricsFor === c.id) return;
    ui.lyricsFor = c.id; ui.lyrics = 'loading'; redraw();
    const r = await act('lyrics'); if (state?.current?.id !== c.id) return;
    ui.lyrics = r?.lyrics || 'none'; redraw();
  };
  const loadPlaylists = async () => { const r = await act('pl_list'); ui.playlists = r?.playlists || []; redraw(); };
  let drag = null;
  const queueItem = (t, i) => h('div.muitem', { draggable: true,
    ondragstart: (e) => { drag = t.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => { drag = null; e.currentTarget.classList.remove('dragging'); },
    ondragover: (e) => { if (drag && drag !== t.id) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); if (drag && drag !== t.id) act('move', { id: drag, to: i }); drag = null; } },
    h('span.muidx', String(i + 1)), t.thumb ? h('img.muqt', { src: t.thumb, alt: '', loading: 'lazy' }) : null,
    h('div.mumeta', h('b', { title: t.title }, t.title), h('small', [t.artist, t.duration ? fmt(t.duration) : '', who(t.by)].filter(Boolean).join(' • '))),
    h('button.mux', { title: 'Tocar agora', onclick: () => act('skipto', { id: t.id }) }, icon('play', 15)),
    h('button.mux', { title: 'Remover da fila', onclick: () => act('remove', { id: t.id }) }, icon('x', 15)));
  const resultItem = (t) => h('div.muitem.mures',
    t.thumb ? h('img.muqt', { src: t.thumb, alt: '', loading: 'lazy' }) : h('div.muqt', icon('music', 16)),
    h('div.mumeta', h('b', { title: t.title }, t.title), h('small', [t.artist, t.duration ? fmt(t.duration) : ''].filter(Boolean).join(' • '))),
    h('button.mux', { title: 'Tocar agora', onclick: () => play({ track: t, where: 'now' }) }, icon('play', 15)),
    h('button.mux.txt', { title: 'Tocar a seguir', onclick: () => play({ track: t, where: 'next' }) }, 'A seguir'),
    h('button.mux', { title: 'Adicionar no fim da fila', onclick: () => play({ track: t, where: 'end' }) }, icon('plus', 15)));

  const draw = () => {
    const inRoom = voice?.active && state?.channel_id === voice.channelId;
    const kids = [h('div.muhead', h('b', icon('music', 18), state?.active ? (state.bot_n > 1 ? `Música ${state.bot_n}` : 'Música') : 'Música'),
      state?.active && h('button.mutog' + (state.stay ? '.on' : ''), { type: 'button', title: state.stay ? '24/7 ligado: o bot fica na sala mesmo parado ou sozinho' : 'Ligar 24/7: o bot não sai da sala quando para ou fica sozinho', onclick: () => act('stay') }, icon('clock', 14), '24/7')),
      h('div.muadd', input, goBtn)];
    if (ui.searching) kids.push(h('div.muempty', 'Buscando…'));
    if (ui.results) kids.push(h('div.mures-box', h('div.muqh', 'Resultados', h('button.btn.link', { onclick: () => { ui.results = null; draw(); } }, 'Fechar')), ...ui.results.map(resultItem)));
    if (!state?.active) kids.push(h('div.muempty', 'O bot ainda não está na sala. Busque uma música ou cole um link (também playlists do YouTube e do Spotify) e ele entra para tocar.',
      h('button.btn.grey.sm', { style: { marginTop: '8px' }, onclick: () => { ui.tab = 'playlists'; loadPlaylists(); } }, 'Ver playlists do servidor')));
    else {
      const c = state.current;
      kids.push(c ? h('div.munow',
        c.thumb ? h('img', { src: c.thumb, alt: '' }) : h('div.muthumb', icon('music', 28)),
        h('div.mumeta', h('b', { title: c.title }, c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.title) : c.title),
          h('small', [c.artist, c.auto ? 'reprodução automática' : `pedido por ${who(c.by)}`].filter(Boolean).join(' • ')), seekBar, time))
        : h('div.muempty', 'Nada tocando. Busque uma música acima.'));
      kids.push(h('div.mubtns',
        ctl(icon('skip', 18), 'Voltar para a anterior', () => act('back'), '.back'),
        c && ctl(icon(state.paused ? 'play' : 'pause', 20), state.paused ? 'Continuar' : 'Pausar', () => act(state.paused ? 'resume' : 'pause'), '.main'),
        ctl(icon('skip', 18), 'Pular', () => act('skip')),
        ctl([icon('refresh', 17), state.loop === 'track' ? h('i.mu1', '1') : null], LOOP_TXT[state.loop], () => act('loop'), state.loop !== 'off' ? '.on' : ''),
        ctl(icon('shuffle', 17), 'Embaralhar a fila', () => act('shuffle')),
        ctl(icon('sparkle', 17), state.autoplay ? 'Reprodução automática ligada: quando a fila acaba, toca músicas parecidas' : 'Reprodução automática: quando a fila acaba, toca músicas parecidas', () => act('autoplay'), state.autoplay ? '.on' : ''),
        c && ctl(icon('stop', 17), 'Parar e limpar a fila', () => act('stop')),
        h('span', { style: { flex: 1 } }),
        ctl(icon('eject', 16), 'Tirar o bot da chamada', () => act('disconnect'), '.red')));
      // volume: do bot para todos (o servidor reaplica no mesmo ponto) e só para você
      let vt = 0;
      kids.push(h('div.muvol', h('span', icon('vol', 16), 'Volume do bot para todos'), slider(0, 200, state.volume ?? 100, 5, v => { clearTimeout(vt); vt = setTimeout(() => act('volume', { value: v }), 500); }, v => v + '%')));
      if (inRoom) kids.push(h('div.muvol', h('span', icon('headset', 16), 'Só para você'), slider(0, 200, voice.volumes[state.bot_id] ?? 100, 5, v => voice.setVolume(state.bot_id, v), v => v + '%')));
      kids.push(h('div.mufx', h('span', 'Efeito'), ...Object.entries(state.filters || {}).map(([k, l]) => h('button.mufxc' + (state.filter === k ? '.on' : ''), { type: 'button', onclick: () => act('filter', { name: k }) }, l))));
      const tab = (k, l, fn) => h('button.mutab' + (ui.tab === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(ui.tab === k), onclick: () => { ui.tab = k; fn?.(); draw(); } }, l);
      kids.push(h('div.mutabs', { role: 'tablist' }, tab('queue', `Fila (${state.queue.length})`), tab('lyrics', 'Letra', loadLyrics), tab('history', 'Histórico'), tab('playlists', 'Playlists', loadPlaylists)));
    }
    lyricBox = null;
    if (ui.tab === 'playlists') kids.push(playlistsTab());
    else if (state?.active && ui.tab === 'queue') {
      const total = state.queue.reduce((a, t) => a + (t.duration || 0), 0);
      kids.push(h('div.muqh', h('span', state.queue.length ? `${state.queue.length} na fila${total ? ' • ' + fmt(total) : ''}` : 'Fila vazia'),
        state.queue.length > 1 && h('button.btn.link', { onclick: () => act('dedupe') }, 'Tirar repetidas'),
        state.queue.length > 0 && h('button.btn.link', { onclick: () => act('clear') }, 'Limpar')));
      kids.push(h('div.muq', ...(state.queue.length ? state.queue.map(queueItem) : [h('div.muempty', state.autoplay ? 'Quando esta acabar, a reprodução automática escolhe a próxima.' : 'Adicione músicas pela busca. Arraste para mudar a ordem.')])));
    } else if (state?.active && ui.tab === 'lyrics') {
      if (!state.current) kids.push(h('div.muempty', 'Nada tocando.'));
      else if (ui.lyricsFor !== state.current.id) loadLyrics();
      if (ui.lyrics === 'loading') kids.push(h('div.muempty', 'Procurando a letra…'));
      else if (ui.lyrics === 'none' || (ui.lyrics && !ui.lyrics.synced?.length && !ui.lyrics.plain)) kids.push(h('div.muempty', 'Não achei a letra desta música.'));
      else if (ui.lyrics?.synced?.length) { lyricBox = h('div.mulyr', ...ui.lyrics.synced.map(([ms, t]) => h('div.ly', { onclick: () => act('seek', { ms }), title: 'Ir para este trecho' }, t || '♪'))); kids.push(lyricBox, h('small.musrc', `Letra: ${ui.lyrics.source}`)); }
      else if (ui.lyrics?.plain) kids.push(h('div.mulyr.plain', ui.lyrics.plain), h('small.musrc', `Letra: ${ui.lyrics.source}`));
    } else if (state?.active && ui.tab === 'history') {
      kids.push(h('div.muq', ...(state.history?.length ? state.history.map(t => h('div.muitem', t.thumb ? h('img.muqt', { src: t.thumb, alt: '', loading: 'lazy' }) : null,
        h('div.mumeta', h('b', { title: t.title }, t.title), h('small', [t.artist, t.duration ? fmt(t.duration) : ''].filter(Boolean).join(' • '))),
        h('button.mux.txt', { title: 'Tocar de novo a seguir', onclick: () => play({ track: t, where: 'next' }) }, 'A seguir'),
        h('button.mux', { title: 'Adicionar no fim da fila', onclick: () => play({ track: t, where: 'end' }) }, icon('plus', 15)))) : [h('div.muempty', 'Nada tocou ainda nesta sessão.')])));
    }
    body.replaceChildren(...kids.filter(Boolean));
    tick();
  };
  const playlistsTab = () => {
    const list = ui.playlists;
    return h('div.mupl',
      state?.active && (state.current || state.queue.length) && h('button.btn.grey.sm', { onclick: async () => { const n = await promptBox('Salvar a fila como playlist', 'Nome da playlist', ''); if (!n) return; const r = await act('pl_save', { name: n }); if (r) { ui.playlists = r.playlists; toast(`Playlist "${n}" salva com ${r.saved} músicas`); draw(); } } }, icon('plus', 14), 'Salvar a fila como playlist'),
      !list ? h('div.muempty', 'Carregando…') : !list.length ? h('div.muempty', 'Nenhuma playlist salva neste servidor ainda.')
        : h('div.muq', ...list.map(p => h('div.muitem', h('div.muqt', icon('music', 16)),
          h('div.mumeta', h('b', p.name), h('small', `${p.count} músicas${p.duration ? ' • ' + fmt(p.duration) : ''} • ${who(p.by)}`)),
          h('button.mux.txt', { title: 'Adicionar todas no fim da fila', onclick: () => act('pl_load', { id: p.id }).then(r => r && toast(`${r.added} músicas de "${p.name}" na fila`)) }, 'Tocar'),
          h('button.mux', { title: 'Apagar a playlist', onclick: async () => { if (await confirmBox('Apagar playlist', `Apagar "${p.name}"?`, 'Apagar')) { const r = await act('pl_delete', { id: p.id }); if (r) { ui.playlists = r.playlists; draw(); } } } }, icon('trash', 15))))));
  };
  redraw = () => { if (document.body.contains(body)) { const f = document.activeElement === input, v = input.value, sc = body.querySelector('.muq')?.scrollTop; draw(); input.value = v; if (f) input.focus(); const q = body.querySelector('.muq'); if (q && sc) q.scrollTop = sc; } else redraw = null; };
  draw();
  const el = popout(anchor, body, 'up'); el.classList.add('mu-pop');
  const r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
  el.style.top = Math.max(8, Math.min(r.top - b.height - 12, innerHeight - b.height - 8)) + 'px'; el.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - b.width - 8)) + 'px';
  setTimeout(() => input.focus(), 30);
}
