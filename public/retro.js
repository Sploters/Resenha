// Rewind da turma: resumo da semana, do mês ou do ano (GET /api/guilds/:id/retro?period=&offset=, server/routes/sessions.js).
// Cartões um por vez, só com dados reais do grupo e "o seu" período (só você vê). Sem ranking de pessoas. No topo, a setinha
// troca Semana / Mês / Ano, e abaixo dá para voltar a semanas, meses e anos anteriores. No fim, sugestões de jogos para a
// turma (GET /api/guilds/:id/suggestions): parecidos com o que a galera mais joga e em alta na Steam.
import { h, icon, avatar } from './util.js';
import { S, tryApi, modal } from './state.js';
import { openClip } from './clipsgallery.js';
import { openNight } from './nights.js';
import { peopleModal } from './games.js';

const uOf = (id) => S.users.get(id) || { id, display_name: '?', username: '?' };
const nm = (id) => (id === S.me?.id ? 'Você' : uOf(id).display_name || uOf(id).username);
const hours = (secs) => { const h2 = secs / 3600; return h2 >= 10 ? `${Math.round(h2)} horas` : h2 >= 1 ? `${h2.toFixed(1).replace('.', ',')} horas` : (m => `${m} ${m === 1 ? 'minuto' : 'minutos'}`)(Math.max(1, Math.round(secs / 60))); };
const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const date = (t) => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
const faces = (ids, px = 44) => h('div.rt-faces', ...ids.slice(0, 6).map(id => avatar(uOf(id), px, { status: false })));
const card = (kicker, big, ...rest) => h('div.rt-card', h('div.rt-kicker', kicker), big && h('div.rt-big', big), ...rest.filter(Boolean));

// textos de cada período
const PER = {
  week: { name: 'Semana', title: () => 'Resumo da semana', of: 'da semana', my: 'A sua semana', end: () => 'Bora pra próxima semana', none: 'Semana tranquila' },
  month: { name: 'Mês', title: () => 'Resumo do mês', of: 'do mês', my: 'O seu mês', end: () => 'Que venha o próximo mês', none: 'Mês tranquilo' },
  year: { name: 'Ano', title: (r) => `Rewind ${r.year}`, of: 'do ano', my: 'O seu ano', end: (r) => `Que venha ${r.year + 1}`, none: 'Ano tranquilo' },
};
const ORDER = ['week', 'month', 'year'];
let prefPeriod = (() => { try { return ORDER.includes(localStorage.getItem('rs.rewind')) ? localStorage.getItem('rs.rewind') : 'week'; } catch { return 'week'; } })();

// sugestões para a turma (um pedido por servidor a cada abertura do app; o servidor guarda 1 h)
const sugCache = new Map();
const loadSuggestions = (gid) => { if (!sugCache.has(gid)) sugCache.set(gid, tryApi('GET', `/guilds/${gid}/suggestions`).then(r => r || { items: [] }).catch(() => ({ items: [] }))); return sugCache.get(gid); };
export { loadSuggestions };
export function suggestionRow(x, { big = false } = {}) {
  const why = [x.like?.length && 'parecido com ' + x.like.join(' e '), x.trending && 'em alta na Steam', x.owners && `${x.owners} da turma já ${x.owners === 1 ? 'tem' : 'têm'}`].filter(Boolean).join(' · ');
  return h('button.rt-sug' + (big ? '.big' : ''), { type: 'button', title: [x.title, why, x.why_tags?.join(', ')].filter(Boolean).join('\n'), onclick: () => peopleModal(x.appid, x.title) },
    h('span.rt-sug-img', (x.thumb || x.image) && h('img', { src: x.thumb || x.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
    h('span.rt-sug-t', h('b', x.title), h('small', why), big && x.why_tags?.length ? h('small.rt-sug-tags', x.why_tags.join(' · ')) : null),
    h('span.rt-sug-p', x.trending && h('span.rt-hot', icon('fire', 12), 'em alta'), h('small', x.free ? 'Gratuito' : x.discount ? `-${x.discount}% ${x.price}` : x.price || '')));
}

function cards(r, sug) {
  const g = r.group, m = r.me, out = [], P = PER[r.period] || PER.year, of = P.of;
  const quiet = !g.nights && !g.messages && !g.clips && !g.pearls && !m.nights && !m.messages;
  out.push(card(r.guild_name, P.title(r), h('p.rt-p', h('b', r.label)), h('p.rt-p', quiet ? 'Nada guardado neste período ainda: nenhuma noite, mensagem ou clipe. Veja as sugestões de jogos para animar a próxima.'
    : g.nights ? `${g.nights === 1 ? 'Uma noite' : `${num(g.nights)} noites`} guardadas. Bora rever?` : 'Bora rever?')));
  if (g.nights) out.push(card('As noites', `${num(g.nights)} ${g.nights === 1 ? 'noite' : 'noites'}`, h('p.rt-p', `${hours(g.secs)} juntos numa sala de voz`), g.best_day && h('p.rt-p', `O dia preferido da turma: `, h('b', g.best_day))));
  if (g.longest) out.push(card('A noite mais longa', g.longest.title, h('p.rt-p', date(g.longest.ended_at)), faces(g.longest.members), h('button.btn.grey', { onclick: () => openNight(g.longest.id) }, icon('moon', 16), 'Ver a noite')));
  if (g.games?.length) out.push(card('Os jogos da turma', g.games[0].title, h('ol.rt-list', ...g.games.map(x => h('li', h('b', x.title), ` · ${hours(x.mins * 60)} em ${x.nights} ${x.nights === 1 ? 'noite' : 'noites'}`)))));
  if (g.duo) out.push(card(`A dupla ${of}`, `${nm(g.duo.ids[0])} e ${nm(g.duo.ids[1])}`, faces(g.duo.ids, 56), h('p.rt-p', `juntos em ${g.duo.nights} ${g.duo.nights === 1 ? 'noite' : 'noites'}`)));
  if (g.messages) out.push(card('No chat', `${num(g.messages)} mensagens`, g.top_emoji && h('p.rt-p', `A reação ${of}: `, h('span.rt-emoji', g.top_emoji.emoji), ` (${num(g.top_emoji.n)} vezes)`)));
  if (g.top_message) out.push(card(`A mensagem ${of}`, null, h('blockquote.rt-quote', `“${g.top_message.content}”`), h('p.rt-p', `— ${nm(g.top_message.author_id)}, ${date(g.top_message.created_at)} · ${g.top_message.reactions} reações`)));
  if (g.top_pearl) out.push(card(`A pérola ${of}${g.pearls > 1 ? ` (de ${g.pearls})` : ''}`, null, h('blockquote.rt-quote', `“${g.top_pearl.content}”`), h('p.rt-p', `— ${nm(g.top_pearl.author_id)}, ${date(g.top_pearl.created_at)}`)));
  if (g.top_clip) out.push(card(`O clipe ${of}${g.clips > 1 ? ` (de ${g.clips})` : ''}`, g.top_clip.title || 'Clipe', h('p.rt-p', `de ${nm(g.top_clip.author_id)}${g.top_clip.streamer_id && g.top_clip.streamer_id !== g.top_clip.author_id ? `, na tela de ${nm(g.top_clip.streamer_id)}` : ''} · ${g.top_clip.likes} curtidas`), h('button.btn.green', { onclick: () => openClip(g.top_clip.id) }, icon('play', 16), 'Assistir')));
  if (m.nights || m.messages || m.clips) out.push(card(`${P.my} (só você vê)`, m.nights ? `${m.nights} ${m.nights === 1 ? 'noite' : 'noites'} com a turma` : `${num(m.messages)} mensagens`,
    h('ul.rt-list', ...[
      m.secs > 0 && h('li', `${hours(m.secs)} em sala de voz`),
      m.buddy && h('li', 'Quem mais esteve com você: ', h('b', nm(m.buddy.id)), ` (${m.buddy.nights} ${m.buddy.nights === 1 ? 'noite' : 'noites'})`),
      m.messages > 0 && h('li', `${num(m.messages)} mensagens, ${num(m.reactions_got)} reações recebidas`),
      m.clips > 0 && h('li', `${m.clips} ${m.clips === 1 ? 'clipe feito' : 'clipes feitos'}`),
      m.clipped > 0 && h('li', `clipado ${m.clipped} ${m.clipped === 1 ? 'vez' : 'vezes'} pela turma`),
      m.pearls > 0 && h('li', `${m.pearls} ${m.pearls === 1 ? 'pérola sua' : 'pérolas suas'} guardada${m.pearls === 1 ? '' : 's'}`),
    ].filter(Boolean))));
  if (sug?.items?.length) out.push(card('Para a próxima noite', 'Jogos para a turma', h('p.rt-p', 'Parecidos com o que vocês mais jogam e o que está em alta na Steam'),
    h('div.rt-sugs', ...sug.items.slice(0, 4).map(x => suggestionRow(x)))));
  out.push(card('Fim', P.end(r), h('p.rt-p', 'Cada noite nova entra no próximo resumo.')));
  return out;
}

// period: 'week' | 'month' | 'year' (sem: o último escolhido; padrão semana). year (número): aquele ano.
export function openRetro(gid, opt) {
  let period = typeof opt === 'string' && PER[opt] ? opt : typeof opt === 'number' ? 'year' : prefPeriod, offset = typeof opt === 'number' ? opt - new Date().getFullYear() : 0;
  const stage = h('div.rt-stage', h('div.rt-card', h('div.rt-kicker', 'Carregando…')));
  const nav = h('div.rt-nav'), head = h('div.rt-head');
  const m = modal('Rewind', '', h('div.rt-wrap', head, stage, nav), [], { width: 'min(560px, 96vw)' });
  m.el.querySelector('.mh p')?.remove();
  let list = [], i = 0, req = 0, cur = null;
  const show = (k) => {
    if (!list.length) return;
    i = Math.max(0, Math.min(list.length - 1, k));
    stage.replaceChildren(list[i]);
    nav.replaceChildren(
      h('button.btn.grey', { disabled: i === 0, onclick: () => show(i - 1) }, 'Voltar'),
      h('div.rt-dots', ...list.map((_, j) => h('span' + (j === i ? '.on' : ''), { onclick: () => show(j) }))),
      h('button.btn.green', { disabled: i === list.length - 1, onclick: () => show(i + 1) }, 'Próximo'));
  };
  // setinha: troca o tipo (Semana > Mês > Ano > Semana); embaixo, o período anterior/seguinte do mesmo tipo
  const drawHead = () => {
    const step = (d) => { period = ORDER[(ORDER.indexOf(period) + d + ORDER.length) % ORDER.length]; offset = 0; prefPeriod = period; try { localStorage.setItem('rs.rewind', period); } catch { } load(); };
    head.replaceChildren(
      h('div.rt-period', h('button.rt-arrow', { title: 'Trocar o resumo', 'aria-label': 'Resumo anterior', onclick: () => step(-1) }, icon('chevl', 20)),
        h('div.rt-pname', ORDER.map(k => h('span' + (k === period ? '.on' : ''), { onclick: () => { if (k !== period) step(ORDER.indexOf(k) - ORDER.indexOf(period)); } }, PER[k].name))),
        h('button.rt-arrow', { title: 'Trocar o resumo', 'aria-label': 'Próximo resumo', onclick: () => step(1) }, icon('chevr', 20))),
      h('div.rt-range', h('button.btn.link.sm', { disabled: cur ? !cur.has_prev : true, onclick: () => { offset--; load(); } }, '‹ anterior'),
        h('b', cur?.label || '…'), h('button.btn.link.sm', { disabled: !(offset < 0), onclick: () => { offset = Math.min(0, offset + 1); load(); } }, 'seguinte ›')));
  };
  const load = async () => {
    const my = ++req; cur = null; drawHead();
    stage.replaceChildren(h('div.rt-card', h('div.rt-kicker', 'Carregando…'))); nav.replaceChildren();
    const [r, sug] = await Promise.all([tryApi('GET', `/guilds/${gid}/retro?period=${period}&offset=${offset}`), loadSuggestions(gid)]);
    if (my !== req || !stage.isConnected) return;
    if (!r?.group) { stage.replaceChildren(h('div.rt-card', h('div.rt-kicker', 'Não consegui montar o resumo agora.'))); return; }
    for (const u of r.users || []) if (u && !S.users.has(u.id)) S.users.set(u.id, u);
    cur = r; drawHead(); list = cards(r, sug); show(0);
  };
  const onKey = (e) => { if (!stage.isConnected) return document.removeEventListener('keydown', onKey); if (e.target?.closest?.('input,textarea')) return; if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  document.addEventListener('keydown', onKey);
  load();
}
