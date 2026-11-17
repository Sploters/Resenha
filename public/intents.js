// "A fim de jogar": a intenção de jogar (jogo, até quando, com quantas pessoas), os convites direcionados que o
// servidor manda só para quem tem/joga o jogo e o grupo que se forma sozinho (server/intents.js).
// Onde aparece (sem tela nova): no topo do painel "Ativo agora" (minha intenção + convites para mim), no aviso com
// Topo/Agora não, no atalho da tela Procurar jogadores e em Configurações → Notificações (preferências).
import { h, icon, avatar } from './util.js';
import { S, api, tryApi, toast, notify, modal, savePrefs } from './state.js';
import { playSound } from './sounds.js';
import { gameBanner } from './activity.js';

const ctx = {}; // injetado por app.js: go, joinVoice, channelById, openLfg(prefill), redraw()
export const initIntents = (c) => Object.assign(ctx, c);
S.intents = { mine: [], invites: [], loaded: false };
let clock = null;

// ---------------------------------------------------------------- estado
export async function loadIntents() {
  const r = await api('GET', '/intents').catch(() => null);
  if (!r) return; // servidor fora: mantém o que havia (o painel continua funcionando)
  S.intents.mine = r.mine || []; S.intents.invites = r.invites || []; S.intents.loaded = true;
  changed();
}
const upsert = (list, it) => { const i = list.findIndex(x => x.id === it.id); if (i >= 0) list[i] = it; else list.unshift(it); };
const LIVE = (it) => (it.status === 'open' || it.status === 'formed') && it.expires_at > Date.now();
function apply(it) {
  if (it.mine) { upsert(S.intents.mine, it); S.intents.mine = S.intents.mine.slice(0, 3); }
  else {
    const keep = LIVE(it) && (it.me?.state === 'invited' || it.me?.state === 'joined');
    S.intents.invites = S.intents.invites.filter(x => x.id !== it.id); if (keep) S.intents.invites.unshift(it);
    const b = document.getElementById('intent-banner'); if (b?.dataset.id === it.id && !(keep && it.me?.state === 'invited' && it.status === 'open')) b.remove();
  }
  changed();
}
function changed() {
  ctx.redraw?.();
  // o painel se atualiza sozinho quando algo vence (expira, "até 22:40")
  clearTimeout(clock);
  const next = Math.min(...[...S.intents.mine, ...S.intents.invites].filter(LIVE).map(x => x.expires_at));
  if (Number.isFinite(next)) clock = setTimeout(() => { for (const x of [...S.intents.mine, ...S.intents.invites]) if (x.expires_at <= Date.now() && LIVE(x)) x.status = x.state === 'formed' ? 'ended' : 'expired'; S.intents.invites = S.intents.invites.filter(LIVE); changed(); }, Math.max(1000, next - Date.now() + 300));
}
export const myLiveIntent = () => S.intents.mine.find(LIVE) || null;

// ---------------------------------------------------------------- eventos do servidor
export function onIntentEvent(t, d) {
  if (t === 'INTENT_RESPONSE') {
    const verb = d.action === 'join' ? 'topou' : d.action === 'decline' ? 'não pode agora' : 'saiu do grupo';
    if (d.action === 'join') playSound('friend');
    toast(`${d.user.display_name} ${verb} · ${d.game_name}`);
    return;
  }
  apply(d);
  if (t === 'INTENT_INVITE' && d.delivery === 'push' && S.me.status !== 'dnd') banner(d);
  if (t === 'INTENT_FORMED') formedBanner(d);
  if (t === 'INTENT_EXPIRED') toast(`Ninguém topou ${d.game.name} a tempo. Dá para chamar de novo ou publicar no mural do LFG.`);
}

// ---------------------------------------------------------------- textos
const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const untilText = (it) => (it.availability === 'later' && it.starts_at > Date.now() ? `a partir das ${hhmm(it.starts_at)} · até ${hhmm(it.expires_at)}` : `até ${hhmm(it.expires_at)}`);
const sizeText = (it) => `${it.size} de ${it.min_size}${it.max_size && it.max_size !== it.min_size ? ` (máx. ${it.max_size})` : ''}`;
function statusLine(it) {
  if (it.status === 'formed') return it.channel ? `Grupo formado · sala ${it.channel.name}${it.channel.in_call ? ` · ${it.channel.in_call} na sala` : ''}` : 'Grupo formado';
  if (it.status === 'expired') return 'Ninguém topou a tempo';
  if (it.status === 'canceled') return 'Cancelada';
  if (it.status === 'ended') return 'Encerrada';
  return it.missing > 0 ? `${sizeText(it)} · falta${it.missing > 1 ? 'm' : ''} ${it.missing} · ${untilText(it)}` : `${sizeText(it)} · ${untilText(it)}`;
}
const art = (it) => it.game.appid ? gameBanner({ platform: 'steam', game: { id: it.game.appid, title: it.game.name } }) : null;
const faces = (users, n = 5) => h('span.in-faces', users.slice(0, n).map(u => avatar(S.users.get(u.id) || u, 22, { ring: 'var(--bg-sec)', status: false })), users.length > n && h('small', `+${users.length - n}`));
const STATE = { invited: ['clock', 'Sem resposta'], joined: ['check', 'Topou'], declined: ['x', 'Agora não'], ignored: ['clock', 'Não respondeu'], left: ['x', 'Saiu'], full: ['users', 'Grupo completo'] };

// ---------------------------------------------------------------- ações
async function respond(it, action, btn) {
  if (btn) btn.disabled = true;
  try { const r = await api('POST', `/intents/${it.id}/respond`, { action }); apply(r); if (action === 'join') toast(r.status === 'formed' ? 'Grupo formado! Você vai receber o convite para a sala.' : `Você topou. ${r.missing ? `Falta${r.missing > 1 ? 'm' : ''} ${r.missing}.` : ''}`); return r; }
  catch (e) { toast(e.message, true); if (e.data?.intent) apply(e.data.intent); else loadIntents(); if (btn) btn.disabled = false; return null; }
}
async function enter(it, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('POST', `/intents/${it.id}/enter`);
    document.getElementById('intent-banner')?.remove();
    for (let i = 0; i < 20 && !ctx.channelById(r.channel_id); i++) await new Promise(res => setTimeout(res, 100)); // amigo de fora: o servidor chega pelo GUILD_CREATE
    ctx.go(r.guild_id, r.channel_id); ctx.joinVoice(r.channel_id);
  } catch (e) { toast(e.message, true); loadIntents(); if (btn) btn.disabled = false; }
}
async function cancel(it) { const r = await tryApi('POST', `/intents/${it.id}/cancel`); if (r) apply(r); }
async function more(it, btn) {
  btn.disabled = true; const r = await tryApi('POST', `/intents/${it.id}/more`);
  if (r) { apply(r); toast(r.added ? `Chamei mais ${r.added}` : 'Não achei mais ninguém compatível agora'); } btn.disabled = false;
}
async function fallbackLfg(it) { const r = await tryApi('POST', `/intents/${it.id}/fallback`); if (r) ctx.openLfg?.(r); }
function muteGame(it, ms) {
  const m = (S.prefs.intentMuted ||= {}); m[it.game.key] = ms === true ? true : Date.now() + ms; (S.prefs.intentMutedNames ||= {})[it.game.key] = it.game.name;
  for (const [k, v] of Object.entries(m)) if (v !== true && v < Date.now()) delete m[k]; // não acumula
  savePrefs(); toast(ms === true ? `Você não recebe mais convites de ${it.game.name}` : `Sem convites de ${it.game.name} até amanhã`);
}
const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d - Date.now(); };
function declineMenu(it, btn) {
  const m = h('div.in-more', h('button', { onclick: () => { respond(it, 'decline'); muteGame(it, endOfDay()); m.remove(); } }, icon('moon', 14), `Agora não e silenciar ${it.game.name} hoje`),
    h('button', { onclick: () => { respond(it, 'decline'); muteGame(it, true); m.remove(); } }, icon('bell', 14), `Nunca me chamar para ${it.game.name}`));
  btn.closest('.in-card')?.append(m);
}

// ---------------------------------------------------------------- seção do painel "Ativo agora"
export function intentSection() {
  const mine = S.intents.mine.filter(x => LIVE(x) || (Date.now() - Math.max(x.expires_at, x.formed_at || 0) < 30 * 60e3 && x.status !== 'canceled'))[0];
  const inv = S.intents.invites.filter(LIVE);
  const cta = !myLiveIntent() && h('button.in-cta', { onclick: () => openIntentModal() }, h('span.in-ctaic', icon('gamepad', 20)), h('span.in-ctatx', h('b', 'A fim de jogar?'), h('small', 'Chama só quem tem o jogo')), icon('chevr', 16));
  return h('section.an-intents', inv.length > 0 && h('div.an-cap', `Te chamaram — ${inv.length}`), ...inv.map(inviteCard), mine && myCard(mine), cta);
}
function myCard(it) {
  const live = LIVE(it), formed = it.status === 'formed';
  const waiting = it.members?.filter(m => m.state === 'invited') || [];
  const list = h('div.in-members.hidden', (it.members || []).map(m => h('div.in-mem', avatar(S.users.get(m.user.id) || m.user, 22, { status: false }), h('span', m.user.display_name),
    h('small.in-st.' + m.state, icon(STATE[m.state]?.[0] || 'dot', 12), STATE[m.state]?.[1] || m.state), m.delivery === 'quiet' && m.state === 'invited' && h('small.in-quiet', { title: 'Avisado sem som (offline, não perturbe ou limite de avisos)' }, '🔕'))));
  return h('div.in-card.mine' + (formed ? '.formed' : '') + (!live ? '.done' : ''), { 'data-id': it.id },
    art(it),
    h('div.in-head', h('span.in-ic', icon(formed ? 'check' : 'gamepad', 18)), h('div.an-who', h('b', `Você está a fim de ${it.game.name}`), h('small', statusLine(it)))),
    it.note && h('div.in-note', `“${it.note}”`),
    h('div.in-row', faces(it.group), live && waiting.length > 0 && h('small.in-wait', `${waiting.length} sem resposta`),
      h('button.btn.link.sm.in-toggle', { onclick: (e) => { list.classList.toggle('hidden'); e.currentTarget.textContent = list.classList.contains('hidden') ? 'Quem foi chamado' : 'Esconder'; } }, 'Quem foi chamado')),
    list,
    h('div.in-btns',
      formed && it.channel && h('button.btn.green.sm', { onclick: (e) => enter(it, e.currentTarget) }, icon('voice', 14), 'Entrar na sala'),
      live && it.status === 'open' && h('button.btn.grey.sm', { onclick: (e) => more(it, e.currentTarget) }, icon('plus', 14), 'Chamar mais'),
      live && h('button.btn.link.sm', { onclick: () => cancel(it) }, 'Cancelar'),
      it.status === 'expired' && [h('button.btn.sm', { onclick: () => openIntentModal({ game: it.game, min: it.min_size, max: it.max_size, note: it.note }) }, icon('refresh', 14), 'Chamar de novo'),
        h('button.btn.grey.sm', { onclick: () => fallbackLfg(it) }, icon('megaphone', 14), 'Publicar no mural')]));
}
function inviteCard(it) {
  const st = it.me?.state, formed = it.status === 'formed';
  return h('div.in-card' + (st === 'joined' ? '.joined' : ''), { 'data-id': it.id },
    art(it),
    h('div.in-head', avatar(S.users.get(it.author.id) || it.author, 32, { ring: 'var(--bg-sec)' }), h('div.an-who', h('b', `${it.author.display_name} está a fim de ${it.game.name}`), h('small', statusLine(it)))),
    it.me?.reasons?.length > 0 && h('div.in-why', icon('sparkle', 12), 'Você: ' + it.me.reasons.join(' · ')),
    it.note && h('div.in-note', `“${it.note}”`),
    h('div.in-row', faces(it.group)),
    h('div.in-btns', st === 'invited' && !it.full
      ? [h('button.btn.green.sm', { onclick: (e) => respond(it, 'join', e.currentTarget) }, icon('check', 14), 'Topo!'),
        h('button.btn.grey.sm', { onclick: (e) => respond(it, 'decline', e.currentTarget) }, 'Agora não'),
        h('button.ibtn.in-dots', { title: 'Mais opções', onclick: (e) => declineMenu(it, e.currentTarget) }, icon('more', 16))]
      : st === 'joined' ? [formed && it.channel ? h('button.btn.green.sm', { onclick: (e) => enter(it, e.currentTarget) }, icon('voice', 14), 'Entrar na sala') : h('small.in-wait', icon('check', 12), it.missing ? `Você topou · falta${it.missing > 1 ? 'm' : ''} ${it.missing}` : 'Você topou'),
        h('button.btn.link.sm', { onclick: (e) => respond(it, 'leave', e.currentTarget) }, 'Sair')] : h('small.in-wait', 'Grupo completo')));
}

// ---------------------------------------------------------------- avisos
function banner(it) {
  document.getElementById('intent-banner')?.remove();
  const el = h('div#intent-banner.callinv.inbanner', { 'data-id': it.id }, avatar(S.users.get(it.author.id) || it.author, 48, { status: false }),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('b', `${it.author.display_name} está a fim de ${it.game.name}`), h('div.cbsub', `${statusLine(it)}`), it.me?.reasons?.length > 0 && h('div.cbsub.cbwhere', 'Você: ' + it.me.reasons.join(' · '))),
    h('div.ib-btns', h('button.btn.grey', { onclick: () => { respond(it, 'decline'); el.remove(); } }, 'Agora não'), h('button.btn.green', { onclick: (e) => { respond(it, 'join', e.currentTarget); el.remove(); } }, icon('check', 14), 'Topo!')));
  document.body.append(el); playSound('friend');
  notify(`${it.author.display_name} está a fim de ${it.game.name}`, `${statusLine(it)}${it.me?.reasons?.length ? ' · ' + it.me.reasons[0] : ''}`, () => ctx.showPanel?.());
  setTimeout(() => { if (document.getElementById('intent-banner') === el) el.remove(); }, 45000);
}
function formedBanner(it) {
  document.getElementById('intent-banner')?.remove();
  if (!it.channel) return;
  const el = h('div#intent-banner.callinv.inbanner.formed', { 'data-id': it.id }, h('span.in-bigic', icon('users', 26)),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('b', `Grupo de ${it.game.name} formado!`), h('div.cbsub', `${it.group.map(u => u.display_name).join(', ')}`), h('div.cbsub.cbwhere', `Sala ${it.channel.name}${it.guild ? ' · ' + it.guild.name : ''}`)),
    h('div.ib-btns', h('button.btn.grey', { onclick: () => el.remove() }, 'Depois'), h('button.btn.green', { onclick: (e) => enter(it, e.currentTarget) }, icon('voice', 14), 'Entrar na sala')));
  document.body.append(el); playSound('event');
  notify(`Grupo de ${it.game.name} formado!`, `Sala ${it.channel.name} · entre quando quiser`, () => enter(it));
  setTimeout(() => { if (document.getElementById('intent-banner') === el) el.remove(); }, 60000);
}

// ---------------------------------------------------------------- janela "A fim de jogar"
const VALID = [[30, '30 min'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [360, '6 horas']];
const SRC = { playing: 'Jogando agora', recent: 'Jogou há pouco', library: 'Na sua Steam' };
export async function openIntentModal(pre = {}) {
  const own = myLiveIntent(); if (own) { toast('Você já está chamando para um jogo. Cancele para criar outra.', true); return; }
  const games = (await tryApi('GET', '/intents/games')) || [];
  const f = { game: pre.game ? { name: pre.game.name, appid: pre.game.appid, lfg: pre.game.lfg } : games[0] ? { name: games[0].name, appid: games[0].appid, lfg: games[0].lfg } : null,
    other: '', when: 'now', at: '', valid: 60, min: pre.min || 2, max: pre.max ?? '', note: pre.note || '', guild: '', picked: null, force: false };
  let pv = null, seq = 0;
  const box = h('div.lfgform.inform'), who = h('div.in-who');
  const key = (g) => `${g.lfg || ''}|${g.appid || ''}|${(g.name || '').toLowerCase()}`;
  const sel = (opts, val, on) => h('select', { onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const draw = () => {
    const chips = games.map(g => h('button.lchip' + (f.game && key(f.game) === key(g) && !f.other ? '.on' : ''), { title: SRC[g.source] || '', onclick: () => { f.game = { name: g.name, appid: g.appid, lfg: g.lfg }; f.other = ''; f.picked = null; f.force = false; draw(); preview(); } },
      g.source === 'playing' ? icon('live', 12) : h('i'), g.name, SRC[g.source] && h('small.in-src', SRC[g.source])));
    box.replaceChildren(
      h('div.lfglab', 'Jogo'), h('div.lfgchips.pick.in-games', chips),
      h('label.f', 'Ou digite outro jogo', h('input', { maxLength: 60, value: f.other, placeholder: 'Ex.: Deep Rock Galactic', oninput: (e) => { f.other = e.target.value; f.game = f.other.trim() ? { name: f.other.trim() } : null; f.picked = null; f.force = false; box.querySelectorAll('.in-games .lchip.on').forEach(x => x.classList.remove('on')); debounced(); } })),
      h('div.lfgrow',
        h('label.f', 'Quando', sel([['now', 'Agora'], ['later', 'Mais tarde…']], f.when, (v) => { f.when = v; draw(); })),
        f.when === 'later' ? h('label.f', 'A partir de', h('input', { type: 'time', value: f.at, oninput: (e) => { f.at = e.target.value; } })) : h('label.f', 'Disponível por', sel(VALID, f.valid, (v) => { f.valid = +v; }))),
      f.when === 'later' && h('label.f', 'Disponível por', sel(VALID, f.valid, (v) => { f.valid = +v; })),
      h('div.lfgrow',
        h('label.f', 'Forma o grupo com', sel([2, 3, 4, 5, 6, 8, 10].map(n => [n, `${n} pessoas (com você)`]), f.min, (v) => { f.min = +v; if (f.max && f.max < f.min) f.max = f.min; draw(); })),
        h('label.f', 'No máximo', sel([['', 'Sem limite'], ...[2, 3, 4, 5, 6, 8, 10].filter(n => n >= f.min).map(n => [n, `${n} pessoas`])], f.max, (v) => { f.max = v ? +v : ''; }))),
      h('label.f', 'Recado (opcional)', h('input', { maxLength: 140, value: f.note, placeholder: 'Ex.: ranked de leve, sem tryhard', oninput: (e) => { f.note = e.target.value; } })),
      who);
    paintWho();
  };
  const paintWho = () => {
    if (!f.game) return who.replaceChildren(h('p.lfghint', 'Escolha um jogo para ver quem seria chamado.'));
    if (!pv) return who.replaceChildren(h('div.lfglab', 'Quem vai ser chamado'), h('p.lfghint', 'Procurando quem tem esse jogo…'));
    if (pv.error) return who.replaceChildren(h('p.lfghint.in-err', icon('warn', 14), pv.error, ' ', h('button.btn.link.sm', { onclick: preview }, 'Tentar de novo')));
    const picked = f.picked ||= new Set(pv.candidates.filter(c => c.selected).map(c => c.user.id));
    const dup = pv.duplicate && !f.force;
    who.replaceChildren(
      h('div.lfglab', 'Quem vai ser chamado', h('small', ` · ${picked.size} de ${pv.candidates.length}`)),
      dup && h('div.in-dup', icon('users', 16), h('span', h('b', `${pv.duplicate.author.display_name} já está chamando para ${pv.duplicate.game.name}`), ` (${statusLine(pv.duplicate)}). Entre no grupo em vez de abrir outro.`),
        h('div.in-btns', h('button.btn.green.sm', { onclick: async (e) => { const r = await respond(pv.duplicate, 'join', e.currentTarget); if (r) m.close(); } }, 'Entrar no grupo'), h('button.btn.link.sm', { onclick: () => { f.force = true; paintWho(); } }, 'Criar a minha mesmo assim'))),
      pv.fallback && pv.candidates.length > 0 && h('p.lfgtip', icon('info', 14), h('span', 'Não achei ninguém com esse jogo na Steam, jogando ou no histórico. Vou sugerir amigos online.')),
      !pv.candidates.length ? h('div.in-none', h('b', 'Ninguém do seu círculo combina com esse jogo agora.'), h('p', 'Publique no mural do LFG: quem divide servidor com você vê e pode pedir para entrar.'),
        h('button.btn.sm', { onclick: () => { m.close(); ctx.openLfg?.({ game: f.game.lfg || 'other', game_name: f.game.name, slots: Math.max(1, f.min - 1), note: f.note }); } }, icon('megaphone', 14), 'Publicar no mural'))
        : h('div.in-cands', pv.candidates.map(c => h('label.in-cand', h('input', { type: 'checkbox', checked: picked.has(c.user.id), onchange: (e) => { e.target.checked ? picked.add(c.user.id) : picked.delete(c.user.id); paintWho(); } }),
          avatar(S.users.get(c.user.id) || c.user, 28, { status: true, ring: 'var(--bg-float)' }), h('div.an-who', h('b', c.user.display_name), h('small', c.reasons.join(' · '))),
          h('span.in-dl' + (c.delivery === 'quiet' ? '.quiet' : ''), { title: c.delivery === 'quiet' ? (c.why || 'Sem som') : 'Recebe o aviso com som' }, icon(c.delivery === 'quiet' ? 'moon' : 'bell', 14))))),
      pv.guilds?.length > 1 && h('label.f.in-guild', 'Sala no servidor', sel(pv.guilds.map(g => [g.id, `${g.name}${g.members ? ` · ${g.members} dos chamados já estão lá` : ''}`]), f.guild || pv.guilds[0].id, (v) => { f.guild = v; })),
      !pv.guilds?.length && h('p.lfgtip', icon('warn', 14), h('span', 'Você precisa estar num servidor para o Resenha montar a sala do grupo.')),
      h('p.lfghint', `Só quem você marcou recebe. Quem está offline ou em "não perturbe" recebe sem som e vê quando abrir. Quando ${f.min} toparem (com você), o Resenha escolhe a sala e manda o convite para a chamada.`));
  };
  const preview = async () => {
    const my = ++seq; pv = null; paintWho();
    if (!f.game) return;
    try { const r = await api('POST', '/intents/preview', { game: f.game }); if (my !== seq) return; pv = r; f.picked = null; }
    catch (e) { if (my !== seq) return; pv = { error: e.message || 'Não consegui consultar agora' }; }
    paintWho();
  };
  let dt = null; const debounced = () => { clearTimeout(dt); dt = setTimeout(preview, 350); };
  draw(); preview();
  const m = modal('A fim de jogar', 'Diga o jogo, até quando e com quantos. O Resenha chama só quem tem ou joga e forma o grupo sozinho.', box, [{ label: 'Cancelar', cls: 'link' }, { label: 'Chamar', cls: 'green', fn: async () => {
    if (!f.game) { toast('Escolha o jogo', true); return false; }
    if (!pv || pv.error) { toast('Espere a lista de quem vai ser chamado', true); return false; }
    if (!f.picked?.size) { toast(pv.candidates.length ? 'Marque pelo menos uma pessoa' : 'Ninguém para chamar: publique no mural', true); return false; }
    let starts_at = null;
    if (f.when === 'later') { if (!f.at) { toast('Escolha o horário', true); return false; } const [hh, mm] = f.at.split(':').map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); if (d < Date.now() - 60e3) d.setDate(d.getDate() + 1); starts_at = d.getTime(); }
    const body = { game: f.game, availability: f.when, starts_at, valid_min: f.valid, min_size: f.min, max_size: f.max || null, note: f.note, invite_ids: [...f.picked], guild_id: f.guild || pv.guilds?.[0]?.id || null, force: f.force };
    try { const r = await api('POST', '/intents', body); apply(r); toast(`Chamei ${r.members.length} pessoa${r.members.length > 1 ? 's' : ''} para ${r.game.name}`); ctx.showPanel?.(); }
    catch (e) { if (e.data?.code === 'duplicate') { pv.duplicate = e.data.intent; f.force = false; paintWho(); } toast(e.message, true); return false; }
  } }], { width: '600px' });
}

// ---------------------------------------------------------------- Configurações → Notificações
export function intentPrefsBlock({ section, row, seg }) {
  const box = h('div.card2');
  const draw = () => {
    const muted = Object.entries(S.prefs.intentMuted || {}).filter(([, v]) => v === true || v > Date.now());
    box.replaceChildren(
      row('Quem pode me chamar para jogar', 'Convites do "A fim de jogar": só chegam se você tem, joga ou jogou o jogo.',
        seg({ all: 'Amigos e servidores', friends: 'Só amigos', off: 'Ninguém' }, S.prefs.intentNotify || 'all', (v) => { S.prefs.intentNotify = v; savePrefs(); toast(v === 'off' ? 'Ninguém vai te chamar para jogar.' : 'Pronto.'); })),
      h('p.hintline', 'No máximo 3 convites com som por hora; o mesmo amigo não toca de novo antes de 30 min. Em "não perturbe" ou offline, o convite chega sem som e fica no Ativo agora.'),
      muted.length > 0 && h('div.in-muted', h('div.lfglab', 'Jogos silenciados'), muted.map(([k, v]) => h('div.in-mutedrow', h('span', S.prefs.intentMutedNames?.[k] || k.replace(/^(lfg|name|steam):/, '')), h('small', v === true ? 'sempre' : `até ${new Date(v).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`),
        h('button.btn.grey.sm', { onclick: () => { delete S.prefs.intentMuted[k]; savePrefs(); draw(); } }, 'Voltar a receber')))));
  };
  draw();
  return [section('Convites para jogar'), box];
}
