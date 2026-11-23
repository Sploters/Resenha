// Retrospectiva do ano da turma (GET /api/guilds/:id/retro, server/routes/sessions.js): cartões um por vez, só com dados
// reais do grupo e "o seu ano" (só você vê). Sem ranking de pessoas.
import { h, icon, avatar } from './util.js';
import { S, tryApi, modal } from './state.js';
import { openClip } from './clipsgallery.js';
import { openNight } from './nights.js';

const uOf = (id) => S.users.get(id) || { id, display_name: '?', username: '?' };
const nm = (id) => (id === S.me?.id ? 'Você' : uOf(id).display_name || uOf(id).username);
const hours = (secs) => { const h2 = secs / 3600; return h2 >= 10 ? `${Math.round(h2)} horas` : h2 >= 1 ? `${h2.toFixed(1).replace('.', ',')} horas` : (m => `${m} ${m === 1 ? 'minuto' : 'minutos'}`)(Math.max(1, Math.round(secs / 60))); };
const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const date = (t) => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
const faces = (ids, px = 44) => h('div.rt-faces', ...ids.slice(0, 6).map(id => avatar(uOf(id), px, { status: false })));
const card = (kicker, big, ...rest) => h('div.rt-card', h('div.rt-kicker', kicker), big && h('div.rt-big', big), ...rest.filter(Boolean));

function cards(r) {
  const g = r.group, m = r.me, out = [];
  out.push(card(r.guild_name, `Retrospectiva ${r.year}`, h('p.rt-p', g.first_night && new Date(g.first_night).getFullYear() === r.year ? `Desde ${date(g.first_night)}, a turma guardou ${g.nights === 1 ? 'uma noite' : `${num(g.nights)} noites`}. Bora rever?` : 'O que a turma aprontou este ano.')));
  if (g.nights) out.push(card('As noites', `${num(g.nights)} ${g.nights === 1 ? 'noite' : 'noites'}`, h('p.rt-p', `${hours(g.secs)} juntos numa sala de voz`), g.best_day && h('p.rt-p', `O dia preferido da turma: `, h('b', g.best_day))));
  if (g.longest) out.push(card('A noite mais longa', g.longest.title, h('p.rt-p', date(g.longest.ended_at)), faces(g.longest.members), h('button.btn.grey', { onclick: () => openNight(g.longest.id) }, icon('moon', 16), 'Ver a noite')));
  if (g.games?.length) out.push(card('Os jogos da turma', g.games[0].title, h('ol.rt-list', ...g.games.map(x => h('li', h('b', x.title), ` · ${hours(x.mins * 60)} em ${x.nights} ${x.nights === 1 ? 'noite' : 'noites'}`)))));
  if (g.duo) out.push(card('A dupla do ano', `${nm(g.duo.ids[0])} e ${nm(g.duo.ids[1])}`, faces(g.duo.ids, 56), h('p.rt-p', `juntos em ${g.duo.nights} ${g.duo.nights === 1 ? 'noite' : 'noites'}`)));
  if (g.messages) out.push(card('No chat', `${num(g.messages)} mensagens`, g.top_emoji && h('p.rt-p', 'A reação do ano: ', h('span.rt-emoji', g.top_emoji.emoji), ` (${num(g.top_emoji.n)} vezes)`)));
  if (g.top_message) out.push(card('A mensagem do ano', null, h('blockquote.rt-quote', `“${g.top_message.content}”`), h('p.rt-p', `— ${nm(g.top_message.author_id)}, ${date(g.top_message.created_at)} · ${g.top_message.reactions} reações`)));
  if (g.top_pearl) out.push(card(`A pérola do ano${g.pearls > 1 ? ` (de ${g.pearls})` : ''}`, null, h('blockquote.rt-quote', `“${g.top_pearl.content}”`), h('p.rt-p', `— ${nm(g.top_pearl.author_id)}, ${date(g.top_pearl.created_at)}`)));
  if (g.top_clip) out.push(card(`O clipe do ano${g.clips > 1 ? ` (de ${g.clips})` : ''}`, g.top_clip.title || 'Clipe', h('p.rt-p', `de ${nm(g.top_clip.author_id)}${g.top_clip.streamer_id && g.top_clip.streamer_id !== g.top_clip.author_id ? `, na tela de ${nm(g.top_clip.streamer_id)}` : ''} · ${g.top_clip.likes} curtidas`), h('button.btn.green', { onclick: () => openClip(g.top_clip.id) }, icon('play', 16), 'Assistir')));
  if (m.nights || m.messages || m.clips) out.push(card('O seu ano (só você vê)', m.nights ? `${m.nights} ${m.nights === 1 ? 'noite' : 'noites'} com a turma` : `${num(m.messages)} mensagens`,
    h('ul.rt-list', ...[
      m.secs > 0 && h('li', `${hours(m.secs)} em sala de voz`),
      m.buddy && h('li', 'Quem mais esteve com você: ', h('b', nm(m.buddy.id)), ` (${m.buddy.nights} ${m.buddy.nights === 1 ? 'noite' : 'noites'})`),
      m.messages > 0 && h('li', `${num(m.messages)} mensagens, ${num(m.reactions_got)} reações recebidas`),
      m.clips > 0 && h('li', `${m.clips} ${m.clips === 1 ? 'clipe feito' : 'clipes feitos'}`),
      m.clipped > 0 && h('li', `clipado ${m.clipped} ${m.clipped === 1 ? 'vez' : 'vezes'} pela turma`),
      m.pearls > 0 && h('li', `${m.pearls} ${m.pearls === 1 ? 'pérola sua' : 'pérolas suas'} guardada${m.pearls === 1 ? '' : 's'}`),
    ].filter(Boolean))));
  out.push(card('Fim', `Que venha ${r.year + 1}`, h('p.rt-p', 'Cada noite nova entra na próxima retrospectiva.')));
  return out;
}

export async function openRetro(gid, year) {
  const stage = h('div.rt-stage', h('div.rt-card', h('div.rt-kicker', 'Carregando…')));
  const nav = h('div.rt-nav');
  modal('Retrospectiva', '', h('div.rt', stage, nav), [], { width: 'min(560px, 96vw)' });
  const r = await tryApi('GET', `/guilds/${gid}/retro${year ? `?year=${year}` : ''}`);
  if (!r?.group) { stage.replaceChildren(h('div.rt-card', h('div.rt-kicker', 'Não consegui montar a retrospectiva agora.'))); return; }
  for (const u of r.users || []) if (u && !S.users.has(u.id)) S.users.set(u.id, u);
  const list = cards(r); let i = 0;
  const show = (k) => {
    i = Math.max(0, Math.min(list.length - 1, k));
    stage.replaceChildren(list[i]);
    nav.replaceChildren(
      h('button.btn.grey', { disabled: i === 0, onclick: () => show(i - 1) }, 'Voltar'),
      h('div.rt-dots', ...list.map((_, j) => h('span' + (j === i ? '.on' : ''), { onclick: () => show(j) }))),
      h('button.btn.green', { disabled: i === list.length - 1, onclick: () => show(i + 1) }, 'Próximo'));
  };
  const onKey = (e) => { if (!stage.isConnected) return document.removeEventListener('keydown', onKey); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  document.addEventListener('keydown', onKey);
  show(0);
}
