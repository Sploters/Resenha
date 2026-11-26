// Eventos do servidor (server/events.js): cartão no chat com Vou / Talvez / Não vou, tela "Eventos" na lista de canais,
// criar/editar/cancelar, arquivo de agenda (.ics) e os avisos (30 min antes e na hora, com "Entrar na sala", e som próprio).
// Capa: da Steam (link/appid), de jogos fora dela (catálogo Riot/Battle.net/Epic…, ou link de qualquer loja/site) ou imagem própria.
// Horários no fuso e formato de quem lê (o servidor guarda em UTC).
import { h, icon, avatar, skeleton, imgUrl } from './util.js';
import { S, api, tryApi, toast, modal, confirmBox, can, PERM, user, channelById, chVisible, guild, notify, menu } from './state.js';
import { steamInfo, steamApp } from './steamcard.js';
import { uploadFile } from './upload.js';

const ctx = {}; // injetado por app.js: go(gid, cid), joinVoice(cid), profile(anchor, uid), playSound(nome)
export const initEvents = (c) => Object.assign(ctx, c);
S.events = new Map(); // id -> evento (o mais novo que chegou)
const keepUsers = (list) => { for (const u of list || []) if (!S.users.has(u.id)) S.users.set(u.id, u); };
const nameOf = (id) => (id === S.me?.id ? 'Você' : user(id).display_name);

// ---------- textos de horário ----------
const H12 = () => !!S.prefs.hour12;
const hm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: H12() });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export function whenText(ev) {
  const d = new Date(ev.starts_at), today = new Date(), tom = new Date(Date.now() + 864e5);
  const day = sameDay(d, today) ? 'Hoje' : sameDay(d, tom) ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(/ de /g, ' ');
  return `${day[0].toUpperCase() + day.slice(1)}, ${hm(ev.starts_at)} – ${hm(ev.ends_at)}`;
}
function relText(ev) {
  if (ev.status === 'cancelled') return 'Cancelado';
  if (ev.status === 'ended') return 'Encerrado';
  if (ev.status === 'live') return 'Acontecendo agora';
  const min = Math.round((ev.starts_at - Date.now()) / 60000);
  if (min < 1) return 'Começando';
  if (min < 60) return `Começa em ${min} min`;
  if (min < 24 * 60) return `Começa em ${Math.round(min / 60)} h`;
  const days = Math.round(min / 1440); return `Em ${days} ${days === 1 ? 'dia' : 'dias'}`;
}
// o status no aparelho anda sozinho (scheduled -> live -> ended) sem esperar o servidor
const live = (ev) => ev.status === 'cancelled' ? ev : { ...ev, status: Date.now() >= ev.ends_at ? 'ended' : Date.now() >= ev.starts_at ? 'live' : 'scheduled' };

// ---------- cartão (anúncio no chat e tela Eventos) ----------
export function eventCard(ev0, { compact } = {}) {
  S.events.set(ev0.id, ev0);
  const el = h('div.evcard', { 'data-ev': ev0.id });
  paint(el, ev0, compact);
  return el;
}
function paint(el, ev0, compact) {
  const ev = live(ev0), g = guild(ev.guild_id), room = ev.channel_id && channelById(ev.channel_id);
  const wait = ev.wait || [], roles = ev.roles || [], myRole = ev.picks?.[S.me.id] || null;
  const mine = ev.yes.includes(S.me.id) ? 'yes' : wait.includes(S.me.id) ? 'wait' : ev.maybe.includes(S.me.id) ? 'maybe' : ev.no.includes(S.me.id) ? 'no' : null;
  const open = ev.status === 'scheduled' || ev.status === 'live', full = !roles.length && ev.slots && ev.yes.length >= ev.slots;
  const manage = open && (ev.author_id === S.me.id || (g && can(g.id, PERM.MANAGE_GUILD)));
  const d = new Date(ev.starts_at);
  const send = async (body) => { const r = await tryApi('PUT', `/events/${ev.id}/rsvp`, body); if (!r) return; onEventUpdate({ event: r }); if (body.state === 'yes' && r.wait?.includes(S.me.id)) toast('Vagas cheias: você entrou na lista de espera e sobe sozinho quando abrir uma'); };
  const rsvp = (st) => async (e) => {
    e.stopPropagation();
    // com funções, "Vou" pergunta qual (ou sai, se já estava confirmado/na espera)
    if (st === 'yes' && roles.length && !(mine === 'yes' || mine === 'wait')) return menu(e, roles.map(x => ({ label: `${x.emoji ? x.emoji + ' ' : ''}${x.name} · ${x.yes.length}/${x.slots}${x.yes.length >= x.slots ? ' (espera)' : ''}`, fn: () => send({ state: 'yes', role: x.id }) })));
    send({ state: (mine === st || (st === 'yes' && mine === 'wait')) ? null : st });
  };
  const waitPos = mine === 'wait' ? (roles.length ? (roles.find(x => x.id === myRole)?.wait || []) : wait).indexOf(S.me.id) + 1 : 0;
  const banner = h('div.ev-banner', h('span.ev-bph', { 'aria-hidden': 'true' }, icon(ev.game ? 'gamepad' : 'calendar', 30), ev.game && h('b', ev.game))); // sem capa: só na tela Eventos (CSS)
  el.className = 'evcard ev-' + ev.status + (compact ? ' compact' : '');
  el.replaceChildren(
    banner,
    h('div.ev-main',
      h('div.ev-date', { 'aria-hidden': 'true' }, h('small', d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')), h('b', String(d.getDate()))),
      h('div.ev-info',
        h('div.ev-status', ev.status === 'live' && h('span.ev-dot'), relText(ev)),
        h('b.ev-title', ev.title),
        h('div.ev-meta', h('span', icon('clock', 14), whenText(ev)),
          room && h('span', icon('voice', 14), room.name),
          ev.game && h('span', icon('gamepad', 14), ev.game),
          ev.weekly && h('span.ev-weekly', { title: 'Repete toda semana: o da semana seguinte é marcado sozinho quando este termina' }, icon('refresh', 14), 'Toda semana'),
          !roles.length && ev.slots ? h('span' + (full ? '.ev-full' : ''), icon('users', 14), `${ev.yes.length}/${ev.slots} vagas`) : null,
          wait.length ? h('span.ev-waitn', `${wait.length} na espera`) : null),
        ev.description && !compact && h('p.ev-desc', ev.description))),
    roles.length > 0 && h('div.ev-roles', roles.map(x => h('div.ev-role' + (x.yes.length >= x.slots ? '.full' : '') + (myRole === x.id ? '.mine' : ''),
      h('span.ev-rname', x.emoji && h('span.ev-remo', x.emoji), x.name), h('span.ev-rcount', `${x.yes.length}/${x.slots}`),
      h('span.sc-avs', x.yes.slice(0, 6).map(uid => avatar(user(uid), 20, { status: false }))),
      x.wait.length ? h('small.ev-rwait', `+${x.wait.length} na espera`) : null,
      open && myRole !== x.id && h('button.ev-link', { type: 'button', onclick: (e) => { e.stopPropagation(); send({ state: 'yes', role: x.id }); } }, x.yes.length >= x.slots ? 'Esperar' : mine === 'yes' || mine === 'wait' ? 'Trocar' : 'Entrar')))),
    mine === 'wait' && h('div.ev-waitme', icon('clock', 14), `Você está na lista de espera (${waitPos}º)${roles.length ? ' de ' + (roles.find(x => x.id === myRole)?.name || '') : ''}: sobe sozinho quando abrir uma vaga`),
    h('div.ev-people',
      ev.yes.length ? h('span.sc-avs', ev.yes.slice(0, 8).map(uid => avatar(user(uid), 24, { status: false }))) : null,
      h('span', [ev.yes.length && `${ev.yes.length} ${ev.yes.length === 1 ? 'vai' : 'vão'}`, ev.maybe.length && `${ev.maybe.length} talvez`].filter(Boolean).join(' · ') || 'Ninguém confirmou ainda'),
      (ev.yes.length || ev.maybe.length || ev.no.length) ? h('button.ev-link', { type: 'button', onclick: (e) => { e.stopPropagation(); whoModal(ev); } }, 'Ver quem') : null),
    h('div.ev-acts',
      open && h('div.ev-rsvp', { role: 'group', 'aria-label': 'Sua resposta' },
        h('button.ev-btn' + (mine === 'yes' || mine === 'wait' ? '.on.yes' : ''), { type: 'button', 'aria-pressed': String(mine === 'yes' || mine === 'wait'), title: full && mine !== 'yes' ? 'Vagas esgotadas: entra na lista de espera' : null, onclick: rsvp('yes') }, icon(mine === 'wait' ? 'clock' : 'check', 16), mine === 'wait' ? 'Na espera' : full && mine !== 'yes' ? 'Entrar na espera' : 'Vou'),
        h('button.ev-btn' + (mine === 'maybe' ? '.on.maybe' : ''), { type: 'button', 'aria-pressed': String(mine === 'maybe'), onclick: rsvp('maybe') }, 'Talvez'),
        h('button.ev-btn' + (mine === 'no' ? '.on.no' : ''), { type: 'button', 'aria-pressed': String(mine === 'no'), onclick: rsvp('no') }, 'Não vou')),
      ev.status === 'live' && room && h('button.btn.green.ev-join', { type: 'button', onclick: (e) => { e.stopPropagation(); ctx.joinVoice?.(room.id); } }, icon('voice', 16), 'Entrar na sala'),
      open && h('a.ev-btn.ev-ics', { href: `/api/events/${ev.id}.ics`, title: 'Baixar para a agenda (Google, Outlook, celular)', onclick: (e) => { e.preventDefault(); e.stopPropagation(); downloadIcs(ev); } }, icon('calendar', 16), 'Agenda'),
      manage && h('button.ev-btn.ev-more', { type: 'button', title: 'Editar ou cancelar', 'aria-label': 'Editar ou cancelar', onclick: (e) => { e.stopPropagation(); eventModal(ev.guild_id, ev); } }, icon('edit', 16))));
  const appid = ev.appid || null;
  if (ev.banner) { banner.append(h('img', { src: imgUrl(ev.banner, 480), alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); el.classList.remove('has-art'); } })); el.classList.add('has-art'); } // capa própria/de fora da Steam
  else if (appid) steamInfo(appid).then(i => { if (i?.image) { banner.append(h('img', { src: i.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() })); el.classList.add('has-art'); } });
}
// redesenha os cartões na tela quando o horário vira (agendado -> acontecendo -> encerrado)
setInterval(() => { for (const el of document.querySelectorAll('.evcard')) { const ev = S.events.get(el.dataset.ev); if (ev) paint(el, ev, el.classList.contains('compact')); } }, 30e3);

async function downloadIcs(ev) {
  const r = await fetch(`/api/events/${ev.id}.ics`, { headers: { authorization: 'Bearer ' + localStorage.lc_token } }).catch(() => null);
  if (!r?.ok) return toast('Não deu para baixar agora.', true);
  const url = URL.createObjectURL(await r.blob()), a = h('a', { href: url, download: (ev.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'evento') + '.ics' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function whoModal(ev) {
  const sec = (cap, ids) => ids.length ? [h('div.gm-cap', `${cap} · ${ids.length}`), h('div.gm-people', ids.map(uid => h('div.gm-person', { onclick: (e) => { m.close(); ctx.profile?.(e.currentTarget, uid); } }, avatar(user(uid), 32), h('div.an-who', h('b', nameOf(uid)), uid === ev.author_id && h('small', 'marcou o evento')))))] : [];
  const m = modal(ev.title, whenText(ev), h('div.gp', ...(ev.roles?.length ? ev.roles.flatMap(x => [...sec(`${x.emoji ? x.emoji + ' ' : ''}${x.name} (${x.yes.length}/${x.slots})`, x.yes), ...sec(`Espera de ${x.name}`, x.wait)]) : [...sec('Vão', ev.yes), ...sec('Na espera', ev.wait || [])]), ...sec('Talvez', ev.maybe), ...sec('Não vão', ev.no)), [{ label: 'Fechar', cls: 'grey' }], { width: 'min(420px, 94vw)' });
}

// ---------- tempo real ----------
export function onEventUpdate(d) {
  const ev = d.event; if (!ev) return;
  S.events.set(ev.id, ev);
  for (const el of document.querySelectorAll(`.evcard[data-ev="${CSS.escape(ev.id)}"]`)) paint(el, ev, el.classList.contains('compact'));
  dispatchEvent(new CustomEvent('rs-events', { detail: ev }));
}
export function onEventReminder(d) {
  const ev = d.event, room = ev.channel_id && channelById(ev.channel_id), g = guild(ev.guild_id);
  const where = room ? ` na sala ${room.name}` : '';
  const mins = Math.max(1, Math.round((ev.starts_at - Date.now()) / 60000)), soon = mins >= 25 ? '30 min' : `${mins} min`;
  const txt = d.kind === 'soon' ? `${ev.title} começa em ${soon}${where}` : d.kind === 'start' ? `${ev.title} começou${where}`
    : d.kind === 'promoted' ? `Abriu uma vaga: você saiu da espera e está confirmado em ${ev.title}`
    : d.kind === 'weekly' ? `${ev.title} da próxima semana foi marcado (${whenText(ev)}). Confirme se vai.` : `${ev.title} foi cancelado`;
  toast(txt + (g ? ` (${g.name})` : ''));
  if (d.kind === 'soon' || d.kind === 'start' || d.kind === 'cancelled') ctx.playSound?.(d.kind === 'soon' ? 'event' : 'eventStart'); // som próprio dos eventos (dá para trocar/desligar em Configurações → Sons)
  notify(d.kind === 'cancelled' ? 'Evento cancelado' : d.kind === 'promoted' ? 'Você entrou no evento' : d.kind === 'weekly' ? 'Evento da semana' : d.kind === 'soon' ? `Evento em ${soon}` : 'Evento começando', txt, () => { if (room && (d.kind === 'soon' || d.kind === 'start')) ctx.joinVoice?.(room.id); else if (g) ctx.go?.(g.id, 'events'); }, 'event-' + ev.id);
  onEventUpdate({ event: ev });
}

// ---------- tela Eventos do servidor ----------
// agrupa por dia (Hoje, Amanhã, sáb., 22 nov.) para a tela ler como uma agenda
const dayLabel = (t) => {
  const d = new Date(t), today = new Date(), tom = new Date(Date.now() + 864e5), y = new Date(Date.now() - 864e5);
  if (sameDay(d, today)) return 'Hoje'; if (sameDay(d, tom)) return 'Amanhã'; if (sameDay(d, y)) return 'Ontem';
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1);
};
const byDay = (list) => { const m = new Map(); for (const e of list) { const k = new Date(e.starts_at).toDateString(); (m.get(k) || m.set(k, []).get(k)).push(e); } return [...m.values()]; };
export function renderGuildEvents(main, gid) {
  const root = h('div#eventsview'); main.replaceChildren(root);
  const g = guild(gid); let data = null, past = false;
  const draw = () => {
    if (!root.isConnected) return;
    const list = (data || []).map(live), now = list.filter(e => e.status === 'live'), next = list.filter(e => e.status === 'scheduled'), old = list.filter(e => e.status === 'ended' || e.status === 'cancelled').reverse();
    const cards = (l) => h('div.ev-list', l.map(e => eventCard(e)));
    const days = (l) => byDay(l).map(grp => h('section.ev-day', h('div.ev-dayh', h('b', dayLabel(grp[0].starts_at)), h('span', `${grp.length} ${grp.length === 1 ? 'evento' : 'eventos'}`)), cards(grp)));
    const tab = (on, label, n, fn) => h('button.ev-tab' + (on ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(on), onclick: fn }, label, n ? h('span.ev-tabn', String(n)) : null);
    const upcoming = now.length + next.length;
    const empty = (title, text, cta) => h('div.ev-empty',
      h('div.ev-empty-art', icon('calendar', 36)), h('b', title), h('p', text),
      cta && [h('div.ev-steps',
        h('div.ev-step', h('span.ev-stepn', '1'), h('div', h('b', 'Escolha dia e hora'), h('small', 'Cada pessoa vê no próprio fuso'))),
        h('div.ev-step', h('span.ev-stepn', '2'), h('div', h('b', 'O pessoal responde'), h('small', 'Vou, Talvez ou Não vou'))),
        h('div.ev-step', h('span.ev-stepn', '3'), h('div', h('b', 'Aviso na hora certa'), h('small', 'Com som, 30 min antes')))),
        h('button.btn.ev-cta', { onclick: () => eventModal(gid) }, icon('plus', 16), 'Marcar evento')]);
    root.replaceChildren(
      h('div#topbar', h('span.hash', icon('calendar', 24)), h('span', 'Eventos'), h('span.topic', g?.name || '')),
      h('div.cbody', h('div.ev-wrap',
        h('header.ev-head',
          h('div.ev-headt', h('h1', 'Eventos'), h('p', data ? (upcoming ? `${now.length ? now.length + ' acontecendo agora · ' : ''}${next.length} ${next.length === 1 ? 'marcado' : 'marcados'} em ${g?.name || 'este servidor'}` : `Jogatinas marcadas em ${g?.name || 'este servidor'}`) : ' ')),
          h('button.btn.ev-cta', { onclick: () => eventModal(gid) }, icon('plus', 16), 'Marcar evento')),
        h('div.ev-tabs', { role: 'tablist' },
          tab(!past, 'Próximos', data ? upcoming : null, () => { if (past) { past = false; draw(); } }),
          tab(past, 'Última semana', null, () => { if (!past) { past = true; data = null; draw(); load(); } })),
        !data ? skeleton('cards', 3)
          : past ? (old.length ? days(old) : empty('Nada nos últimos 7 dias', 'Os eventos que já aconteceram (ou foram cancelados) ficam aqui por uma semana.'))
          : upcoming ? [now.length > 0 && h('section.ev-day.ev-now', h('div.ev-dayh', h('b', h('span.ev-dot'), 'Acontecendo agora')), cards(now)), ...days(next)]
          : empty('Nenhum evento marcado', 'Marque uma jogatina e chame o servidor todo. Quem confirmar recebe um aviso antes de começar.', true))));
  };
  const load = async () => { const r = await tryApi('GET', `/guilds/${gid}/events${past ? '?past=1' : ''}`); if (!r) return; keepUsers(r.users); data = r.events; for (const e of data) S.events.set(e.id, e); draw(); };
  const on = (e) => { if (!root.isConnected) return removeEventListener('rs-events', on); const ev = e.detail; if (ev.guild_id !== gid) return; if (!data) return; const i = data.findIndex(x => x.id === ev.id); if (i >= 0) data[i] = ev; else data.push(ev); data.sort((a, b) => a.starts_at - b.starts_at); draw(); };
  addEventListener('rs-events', on);
  draw(); load();
}

// ---------- criar / editar ----------
const DUR = [[30, '30 min'], [60, '1 hora'], [90, '1 h 30'], [120, '2 horas'], [180, '3 horas'], [240, '4 horas'], [360, '6 horas']];
const pad = (n) => String(n).padStart(2, '0');
const localInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// pre: só valores iniciais de um evento novo (ex.: "Outro dia…" do Bora: título e jogo)
export function eventModal(gid, ev = null, pre = null) {
  const g = guild(gid); if (!g) return;
  const voices = g.channels.filter(c => c.type === 2 && chVisible(c)), texts = g.channels.filter(c => c.type === 0);
  const def = new Date(Date.now() + 864e5); def.setHours(21, 0, 0, 0); if (def - Date.now() > 864e5) def.setDate(def.getDate() - 1); // hoje 21h (ou amanhã se já passou)
  const title = h('input', { maxLength: 100, value: ev?.title || pre?.title || '', placeholder: 'Ex.: Sexta de CS2' });
  const game = h('input', { maxLength: 300, value: ev?.game || pre?.game || '', placeholder: 'Nome do jogo ou link da loja (Steam, Epic, Battle.net, Riot…)', list: 'ev-games' });
  const cover = coverPicker(gid, ev, game);
  const when = h('input', { type: 'datetime-local', value: localInput(ev?.starts_at || def.getTime()) });
  const dur = h('select', DUR.map(([v, l]) => h('option', { value: v, selected: v === (ev?.duration_min || 120) }, l)));
  const room = h('select', h('option', { value: '' }, 'Nenhuma'), voices.map(c => h('option', { value: c.id, selected: ev ? ev.channel_id === c.id : c === voices[0] }, c.name)));
  const ann = !ev && h('select', h('option', { value: '' }, 'Não anunciar (só na tela Eventos)'), texts.map(c => h('option', { value: c.id, selected: S.view.gid === gid && S.view.cid === c.id ? true : c === texts[0] }, '#' + c.name)));
  const slots = h('input', { type: 'number', min: 0, max: 100, value: ev?.slots || '', placeholder: 'Sem limite' });
  const desc = h('textarea', { maxLength: 1000, rows: 3, placeholder: 'Detalhes: modo, quem leva o quê… (opcional)' }, ev?.description || '');
  const rolesEd = rolesEditor(ev, slots);
  const weekly = h('input', { type: 'checkbox', checked: !!ev?.weekly });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = h('div.evform',
    h('label.f', 'Nome do evento', title), h('label.f', 'Jogo', game),
    h('div.ev-frow', h('label.f', 'Dia e hora', when), h('label.f', 'Duração', dur)),
    h('small.ev-tz', `No seu fuso (${tz}); cada pessoa vê no fuso dela.`),
    h('div.ev-frow', h('label.f', 'Sala de voz', room), h('label.f', 'Vagas', slots)),
    rolesEd.el,
    h('label.ev-check', weekly, h('span', h('b', 'Repetir toda semana'), h('small', 'Raid fixa: quando este termina, o da semana seguinte é marcado sozinho no mesmo horário, com as mesmas funções.'))),
    ann && h('label.f', 'Anunciar no canal', ann),
    h('label.f', 'Descrição', desc),
    cover.el);
  const buttons = [{ label: 'Cancelar', cls: 'link' }];
  if (ev) buttons.unshift({ label: 'Cancelar evento', cls: 'red', fn: async () => { if (!(await confirmBox('Cancelar evento', `Cancelar "${ev.title}"? Quem respondeu Vou ou Talvez recebe um aviso.`, 'Cancelar evento'))) return false; const r = await tryApi('DELETE', `/events/${ev.id}${ev.weekly && await confirmBox('Evento semanal', 'Parar de repetir também? Senão, só esta semana é cancelada e a próxima é marcada normalmente.', 'Parar a série') ? '?serie=1' : ''}`); if (r) { onEventUpdate({ event: r }); toast('Evento cancelado.'); } return !!r; } });
  buttons.push({ label: ev ? 'Salvar' : 'Marcar evento', fn: async () => {
    const t = new Date(when.value).getTime();
    if (!title.value.trim()) { toast('Dê um nome ao evento', true); title.focus(); return false; }
    if (!isFinite(t) || t < Date.now() - 60e3) { toast('Escolha um horário no futuro', true); return false; }
    if (cover.busy()) { toast('Espere a capa terminar de carregar', true); return false; }
    const raw = game.value.trim(), appid = steamApp(raw) || null;
    let gameName = raw;
    if (appid) { const i = await steamInfo(appid); gameName = i?.title || ''; }
    else if (/^https?:\/\//i.test(raw)) gameName = cover.title() || nameFromLink(raw); // link de outra loja: o nome vem da página
    const c = cover.value();
    const payload = { title: title.value.trim(), starts_at: t, duration_min: +dur.value, channel_id: room.value || null, slots: +slots.value || 0, game: gameName.slice(0, 80), appid, description: desc.value.trim(),
      banner: appid && c.auto ? null : c.url, banner_link: appid && c.auto ? null : c.link, weekly: weekly.checked };
    const rl = rolesEd.value(); if (rl.error) { toast(rl.error, true); return false; }
    if (rl.roles || ev?.roles?.length) payload.roles = rl.roles || [];
    if (!ev && rl.mine) payload.my_role = rl.mine;
    if (!ev) payload.announce_id = ann.value || null;
    const r = await tryApi(ev ? 'PATCH' : 'POST', ev ? `/events/${ev.id}` : `/guilds/${gid}/events`, payload);
    if (!r) return false;
    onEventUpdate({ event: r }); toast(ev ? 'Evento atualizado.' : payload.announce_id ? 'Evento marcado e anunciado no canal.' : 'Evento marcado.');
    return true;
  } });
  modal(ev ? 'Editar evento' : 'Marcar evento', g.name, body, buttons, { width: 'min(520px, 94vw)' });
  setTimeout(() => title.focus(), 0);
}

// ---------- capa do evento ----------
// Automática: jogo da Steam (capa da loja) ou do catálogo de jogos fora dela (Valorant, LoL, Overwatch, Fortnite…), ou link
// de outra loja colado no campo Jogo (Epic, Battle.net, site do jogo). Ou a pessoa escolhe: link de uma imagem/página, ou
// envia uma imagem. O servidor baixa a imagem uma vez (/event-art) e todo mundo carrega daqui.
let catalog = null;
// sem o título da página: o nome sai do endereço (store.epicgames.com/pt-BR/p/rocket-league -> Rocket League)
const nameFromLink = (u) => { try { const x = new URL(u), seg = x.pathname.split('/').filter(Boolean).filter(p => !/^[a-z]{2}(-[a-z]{2})?$/i.test(p) && !['p', 'product', 'games', 'game'].includes(p.toLowerCase())).pop(); return seg ? decodeURIComponent(seg).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : x.hostname.replace(/^www\./, ''); } catch { return ''; } };
const loadCatalog = () => (catalog ||= tryApi('GET', '/event-art/catalog').then(r => r || []));
function coverPicker(gid, ev, gameInput) {
  // estado: url (arquivo desta instalação), link (de onde veio), auto (escolhida pelo jogo; trocar o jogo troca a capa)
  const st = { url: ev?.banner || null, link: ev?.banner_link || null, auto: !ev?.banner, title: '', busy: 0, err: '' };
  const prev = h('div.evc-prev'), msg = h('small.evc-msg'), file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif', hidden: true });
  const linkIn = h('input.evc-link', { type: 'url', placeholder: 'Link de uma imagem ou página (Epic, Battle.net, site do jogo…)', hidden: true });
  const draw = () => {
    const sid = steamApp(gameInput.value.trim()) || (ev?.appid && gameInput.value.trim() === ev.game ? ev.appid : null);
    prev.replaceChildren();
    if (st.busy) prev.append(h('span.evc-spin', 'Buscando a capa…'));
    else if (st.url) prev.append(h('img', { src: imgUrl(st.url, 480), alt: 'Capa do evento' }));
    else if (sid && st.auto) steamInfo(sid).then(i => { if (!st.url && !st.busy && i?.image) prev.replaceChildren(h('img', { src: i.image, alt: 'Capa do evento', referrerPolicy: 'no-referrer' })); });
    else prev.append(h('span.evc-empty', icon('image', 22), 'Sem capa'));
    prev.classList.toggle('has', !!st.url || !!sid);
    msg.textContent = st.err || (st.url ? (st.auto ? 'Capa automática do jogo' : st.link ? 'Capa do link' : 'Imagem enviada') : sid ? 'Capa da Steam' : 'Escolha um jogo da lista, cole um link ou envie uma imagem');
    msg.classList.toggle('err', !!st.err);
    rm.hidden = !st.url;
  };
  const fetchArt = async (body, auto) => {
    const my = ++st.busy; st.err = ''; draw();
    let r = null, fail = '';
    try { r = await api('POST', `/guilds/${gid}/event-art`, body); } catch (e) { fail = e.message; }
    if (my !== st.busy) return; st.busy = 0;
    if (r?.url) Object.assign(st, { url: r.url, link: body.url || null, auto, title: r.title || '' });
    else st.err = (fail || 'Não consegui pegar a imagem desse link.') + (auto ? '' : ' Tente outro link ou envie uma imagem.');
    draw();
  };
  // jogo digitado: do catálogo -> capa oficial; link de outra loja -> capa da página. Só troca se a capa for automática.
  let t = 0;
  const onGame = () => {
    clearTimeout(t); if (!st.auto) return draw();
    t = setTimeout(async () => {
      const v = gameInput.value.trim();
      if (!v || steamApp(v)) { if (st.auto) Object.assign(st, { url: null, link: null }); return draw(); }
      if (/^https?:\/\/\S+$/i.test(v)) return fetchArt({ url: v }, true);
      const list = await loadCatalog(), hit = list.find(g => g.name.toLowerCase() === v.toLowerCase());
      if (hit) return fetchArt({ game: hit.name }, true);
      if (st.auto && st.url) Object.assign(st, { url: null, link: null }); draw();
    }, 500);
  };
  gameInput.addEventListener('input', onGame);
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(f.type)) { st.err = 'Envie uma imagem png, jpg, webp, gif ou avif'; return draw(); }
    if (f.size > 8 * 2 ** 20) { st.err = 'Imagem grande demais (máx. 8 MB)'; return draw(); }
    const my = ++st.busy; st.err = ''; draw();
    try { const r = await uploadFile(f); if (my !== st.busy) return; Object.assign(st, { url: r.url, link: null, auto: false, busy: 0 }); }
    catch (e) { if (my === st.busy) Object.assign(st, { busy: 0, err: e.message || 'Falha no envio' }); }
    draw();
  };
  linkIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } };
  const useLink = () => { const v = linkIn.value.trim(); if (!/^https?:\/\/\S+$/i.test(v)) { st.err = 'Cole um link começando com https://'; return draw(); } linkIn.hidden = true; okBtn.hidden = true; fetchArt({ url: v }, false); };
  const okBtn = h('button.btn.sm', { type: 'button', hidden: true, onclick: useLink }, 'Usar');
  const rm = h('button.btn.link.sm', { type: 'button', onclick: () => { Object.assign(st, { url: null, link: null, auto: false, err: '' }); draw(); } }, 'Remover');
  const el = h('div.f.evc',
    h('span', 'Capa'),
    h('datalist#ev-games'),
    prev,
    h('div.evc-row',
      h('button.btn.grey.sm', { type: 'button', onclick: () => file.click() }, icon('upload', 14), 'Enviar imagem'),
      h('button.btn.grey.sm', { type: 'button', onclick: () => { linkIn.hidden = !linkIn.hidden; okBtn.hidden = linkIn.hidden; if (!linkIn.hidden) linkIn.focus(); } }, icon('link', 14), 'Usar um link'),
      rm, file),
    h('div.evc-row', linkIn, okBtn),
    msg);
  loadCatalog().then(list => { const dl = el.querySelector('#ev-games'); dl?.replaceChildren(...list.map(g => h('option', { value: g.name }, g.store))); });
  draw();
  return { el, value: () => ({ url: st.url, link: st.link, auto: st.auto }), busy: () => !!st.busy, title: () => st.title };
}

// ---------- vagas por função ----------
// modelos por jogo (o pessoal ajusta antes de marcar); cada função tem nome, emoji e vagas
export const ROLE_TEMPLATES = [
  { id: 'wow-raid', name: 'WoW: raid (10)', roles: [['🛡️', 'Tanque', 2], ['💚', 'Cura', 2], ['⚔️', 'Dano', 6]] },
  { id: 'wow-mplus', name: 'WoW: Mítica+ (5)', roles: [['🛡️', 'Tanque', 1], ['💚', 'Cura', 1], ['⚔️', 'Dano', 3]] },
  { id: 'dota', name: 'Dota 2', roles: [['🗡️', 'Carry', 1], ['🎯', 'Mid', 1], ['🪓', 'Offlane', 1], ['🧭', 'Suporte 4', 1], ['🛟', 'Suporte 5', 1]] },
  { id: 'lol', name: 'League of Legends / Clash', roles: [['⛰️', 'Top', 1], ['🌿', 'Selva', 1], ['🎯', 'Meio', 1], ['🏹', 'Atirador', 1], ['🛟', 'Suporte', 1]] },
  { id: 'valorant', name: 'Valorant', roles: [['💥', 'Duelista', 1], ['🔦', 'Iniciador', 1], ['🌫️', 'Controlador', 1], ['🧱', 'Sentinela', 1], ['🔁', 'Flex', 1]] },
  { id: 'deadlock', name: 'Deadlock (6)', roles: [['🎮', 'Jogador', 6]] },
  { id: 'times', name: 'Dois times de 5', roles: [['🔵', 'Time azul', 5], ['🔴', 'Time vermelho', 5]] },
];
function rolesEditor(ev, slotsInput) {
  let rows = (ev?.roles || []).map(x => ({ id: x.id, emoji: x.emoji || '', name: x.name, slots: x.slots }));
  const box = h('div.ev-roled'), mineSel = !ev && h('select');
  const tpl = h('select', { onchange: () => { const t = ROLE_TEMPLATES.find(x => x.id === tpl.value); tpl.value = ''; if (!t) return; rows = t.roles.map(([emoji, name, n], i) => ({ id: 'r' + (i + 1), emoji, name, slots: n })); draw(); } },
    h('option', { value: '' }, 'Usar um modelo…'), ROLE_TEMPLATES.map(t => h('option', { value: t.id }, t.name)));
  const draw = () => {
    slotsInput.disabled = rows.length > 0; slotsInput.title = rows.length ? 'Com funções, as vagas são as de cada função' : '';
    box.replaceChildren(...rows.map((r, i) => h('div.ev-rrow',
      h('input.ev-remoin', { value: r.emoji, maxLength: 8, placeholder: '🙂', 'aria-label': 'Emoji', oninput: (e) => { r.emoji = e.target.value; } }),
      h('input', { value: r.name, maxLength: 30, placeholder: 'Função (ex.: Tanque)', 'aria-label': 'Nome da função', oninput: (e) => { r.name = e.target.value; syncMine(); } }),
      h('input', { type: 'number', min: 1, max: 50, value: r.slots, 'aria-label': 'Vagas', style: { width: '64px' }, oninput: (e) => { r.slots = +e.target.value || 1; } }),
      h('button.btn.link.sm', { type: 'button', title: 'Tirar função', 'aria-label': 'Tirar função', onclick: () => { rows.splice(i, 1); draw(); } }, icon('x', 14)))));
    syncMine();
  };
  const syncMine = () => { if (!mineSel) return; const cur = mineSel.value; mineSel.replaceChildren(...rows.map((r, i) => h('option', { value: r.id || 'r' + (i + 1), selected: (r.id || 'r' + (i + 1)) === cur }, `${r.emoji ? r.emoji + ' ' : ''}${r.name || 'Função ' + (i + 1)}`))); mineLbl.hidden = !rows.length; };
  const mineLbl = mineSel ? h('label.f', 'A sua função', mineSel) : h('span');
  const add = h('button.btn.grey.sm', { type: 'button', onclick: () => { let n = 1; while (rows.some(r => r.id === 'r' + n)) n++; rows.push({ id: ev ? null : 'r' + n, emoji: '', name: '', slots: 1 }); draw(); } }, icon('plus', 14), 'Função');
  const el = h('div.f.ev-rolesf', h('span', 'Vagas por função ', h('small.mut', '(opcional: raid, times, rotas)')), h('div.evc-row', tpl, add), box, mineLbl,
    h('small.mut', 'Cheia, quem clicar fica na lista de espera e sobe sozinho quando abrir uma vaga.'));
  draw();
  return { el, value() {
    if (!rows.length) return { roles: null };
    for (const r of rows) if (!r.name.trim()) return { error: 'Dê um nome a cada função' };
    return { roles: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), emoji: r.emoji.trim(), name: r.name.trim(), slots: Math.max(1, Math.min(50, r.slots | 0)) })), mine: mineSel?.value || null };
  } };
}
