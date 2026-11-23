// A Noite: cada sessão de voz vira uma página (GET /api/nights/:id, server/routes/sessions.js) com quem esteve, jogos,
// linha do tempo, clipes, pérolas, conquistas e GG; "Nossas noites" (lista do servidor) e o mural de pérolas.
import { h, icon, avatar } from './util.js';
import { S, api, tryApi, toast, modal, closeFloating } from './state.js';
import { openClip } from './clipsgallery.js';
import { openRetro } from './retro.js';

const uOf = (id) => S.users.get(id) || { id, display_name: '?', username: '?' };
const addUsers = (list) => { for (const u of list || []) if (u && !S.users.has(u.id)) S.users.set(u.id, u); };
const nameOf = (id) => (id === S.me?.id ? 'Você' : uOf(id).display_name || uOf(id).username);
const dur = (secs) => { const m = Math.max(1, Math.round((secs || 0) / 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
const hm = (t) => { const d = new Date(t); return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0'); };
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const nightDay = (t) => {
  const a = new Date(t), b = new Date(); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  const d = Math.round((b - a) / 864e5);
  return d === 0 ? 'de hoje' : d === 1 ? 'de ontem' : d < 7 ? `de ${WD[new Date(t).getDay()]}` : `de ${new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')}`;
};
const who = (n) => {
  const names = n.members.map(m => nameOf(m.id)), extra = n.hidden || 0;
  if (!names.length) return `${n.peak || 2} pessoas`;
  const base = names.length <= 3 ? names.slice(0, -1).join(', ') + (names.length > 1 ? ' e ' : '') + names.at(-1) : `${names.slice(0, 3).join(', ')} e +${names.length - 3}`;
  return extra ? `${base} e +${extra}` : base;
};
const faces = (ids, px = 22) => h('span.nt-faces', ...ids.slice(0, 6).map(id => avatar(uOf(id), px, { status: false })));

function ggButton(n, onChange) {
  const b = h('button.btn.sm' + (n.my_gg ? '.green' : '.grey'), { title: 'Dar GG nesta noite', onclick: async () => {
    const r = await tryApi('POST', `/nights/${n.id}/gg`); if (!r) return;
    n.gg = r.gg; n.my_gg = r.mine; onChange?.(); b.replaceWith(ggButton(n, onChange));
  } }, '🎮 GG', n.gg ? ` · ${n.gg}` : '');
  return b;
}

const TL = {
  join: (e) => [avatar(uOf(e.user_id), 18, { status: false }), h('span', h('b', nameOf(e.user_id)), ' chegou')],
  clip: (e) => [icon('clip', 16), h('span', h('b', nameOf(e.user_id)), ' clipou ', e.streamer_id && e.streamer_id !== e.user_id ? h('b', nameOf(e.streamer_id)) : 'a tela', e.title ? ` · ${e.title}` : '')],
  pearl: (e) => [h('span', '📜'), h('span', h('b', nameOf(e.user_id)), ': “', e.content, '”')],
  ach: (e) => [icon('trophy', 16), h('span', h('b', nameOf(e.user_id)), ' destravou uma conquista', e.title ? ` em ${e.title}` : '')],
};

// página de uma noite
export async function openNight(id) {
  closeFloating();
  const body = h('div.nt', h('div.nt-load', 'Carregando a noite…'));
  const md = modal('A Noite', '', body, [], { width: 'min(720px, 96vw)' });
  const r = await tryApi('GET', `/nights/${id}`);
  if (!r?.night) { body.replaceChildren(h('div.nt-load', 'Essa noite não está mais disponível.')); return; }
  addUsers(r.users);
  const n = r.night, top = n.clip_list.find(c => c.id === n.top_clip);
  const head = h('div.nt-head',
    h('div.nt-when', `A Noite ${nightDay(n.ended_at)} · ${hm(n.started_at)}–${hm(n.ended_at)} · ${n.channel_name || 'sala'}`),
    h('h2.nt-title', n.title),
    h('div.nt-who', faces(n.members.map(m => m.id), 26), h('span', `${who(n)} · ${dur(n.secs)}`)),
    h('div.nt-acts', ggButton(n)));
  const stats = h('div.nt-stats', ...[
    n.games.length && h('div.nt-stat', h('b', n.games.length === 1 ? '1 jogo' : `${n.games.length} jogos`), h('small', n.games.slice(0, 3).map(g => `${g.title} (${dur((g.mins || 0) * 60)})`).join(' · '))),
    h('div.nt-stat', h('b', `${n.clip_list.length} ${n.clip_list.length === 1 ? 'clipe' : 'clipes'}`), h('small', top ? `lance da noite: ${top.title || 'clipe'}` : 'nenhum clipe enviado')),
    h('div.nt-stat', h('b', `${n.pearls.length} ${n.pearls.length === 1 ? 'pérola' : 'pérolas'}`), h('small', 'mensagens guardadas da noite')),
    n.watch > 0 && h('div.nt-stat', h('b', `${n.watch} ${n.watch === 1 ? 'vídeo' : 'vídeos'}`), h('small', 'no Watch Together')),
  ].filter(Boolean));
  const clips = n.clip_list.length ? h('div.nt-sec', h('h3', 'Clipes'), h('div.nt-clips', ...n.clip_list.map(c => h('button.nt-clip' + (c.id === n.top_clip ? '.top' : ''), { onclick: () => openClip(c.id) },
    icon('play', 16), h('span', c.title || 'Clipe'), h('small', `${nameOf(c.author_id)}${c.likes ? ` · ${c.likes} curtida${c.likes > 1 ? 's' : ''}` : ''}${c.id === n.top_clip && c.likes ? ' · lance da noite' : ''}`))))) : null;
  const pearls = n.pearls.length ? h('div.nt-sec', h('h3', 'Pérolas'), ...n.pearls.map(p => h('blockquote.nt-pearl', `“${p.content}”`, h('small', `— ${nameOf(p.author_id)}, ${hm(p.created_at)}`)))) : null;
  const tl = n.timeline.length ? h('div.nt-sec', h('h3', 'Linha do tempo'), h('ol.nt-tl', ...n.timeline.map(e => h('li.nt-ev.' + e.kind, h('time', hm(e.t)), ...(TL[e.kind]?.(e) || []))))) : null;
  const priv = n.was_here && h('div.nt-priv', h('button.linkbtn', { onclick: async () => {
    if (await tryApi('DELETE', `/voice-sessions/${n.id}/me`)) { toast('Você saiu do histórico desta noite'); md.close(); }
  } }, 'Tirar minha participação desta noite'));
  body.replaceChildren(head, stats, clips, pearls, tl, priv);
}

// "Nossas noites" do servidor, com a aba de pérolas
export async function openNights(gid) {
  const list = h('div.nt-list', h('div.nt-load', 'Carregando…'));
  const tabs = h('div.nt-tabs');
  const body = h('div.nt', tabs, list);
  modal('Nossas noites', 'As sessões de voz da turma, guardadas para sempre', body, [], { width: 'min(720px, 96vw)' });
  const show = async (tab) => {
    tabs.replaceChildren(...[['nights', 'Noites'], ['pearls', 'Pérolas']].map(([k, l]) => h('button.ctab' + (k === tab ? '.active' : ''), { onclick: () => show(k) }, l)),
      h('button.btn.green.sm.nt-retro', { title: 'Resumo da semana, do mês ou do ano', onclick: () => openRetro(gid) }, icon('star', 14), 'Rewind'));
    list.replaceChildren(h('div.nt-load', 'Carregando…'));
    if (tab === 'pearls') {
      const r = await tryApi('GET', `/guilds/${gid}/pearls`); addUsers(r?.users);
      const ps = r?.pearls || [];
      list.replaceChildren(...(ps.length ? ps.map(p => h('blockquote.nt-pearl', `“${p.content}”`, h('small', `— ${nameOf(p.author_id)}, ${new Date(p.created_at).toLocaleDateString('pt-BR')} · guardada por ${nameOf(p.by_id)}`)))
        : [h('div.nt-load', 'Nenhuma pérola ainda. No menu de uma mensagem (clique direito), "Guardar como pérola".')]));
      return;
    }
    const r = await tryApi('GET', `/nights?guild_id=${encodeURIComponent(gid)}`); addUsers(r?.users);
    const ns = r?.nights || [];
    list.replaceChildren(...(ns.length ? ns.map(n => h('button.nt-row', { onclick: () => openNight(n.id) },
      faces(n.members.map(m => m.id)), h('div.nt-rowt', h('b', n.title), h('small', `${nightDay(n.ended_at)} · ${who(n)}${n.clips ? ` · ${n.clips} clipe${n.clips > 1 ? 's' : ''}` : ''}${n.gg ? ` · ${n.gg} GG` : ''}`))))
      : [h('div.nt-load', 'Nenhuma noite ainda. Quando 2 ou mais pessoas ficarem 3 minutos numa sala de voz, a noite aparece aqui.')]));
  };
  show('nights');
}

// menu da mensagem: "Guardar como pérola"
export const pearlMenuItem = (m, gid) => (gid && m.content && !m.e2ee ? {
  label: m.pearl ? 'Tirar das pérolas' : 'Guardar como pérola', hint: 'Mural "Nossas noites → Pérolas"',
  fn: async () => { const r = await api('POST', `/messages/${m.id}/pearl`).catch(e => (toast(e.message, true), null)); if (r) { m.pearl = r.pearl; toast(r.pearl ? 'Guardada como pérola 📜' : 'Tirada das pérolas'); } },
} : null);
