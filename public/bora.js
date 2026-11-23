// "Bora?": chamar a turma do servidor para jogar ou só resenhar, agora ou num horário de hoje (server/bora.js).
// Onde aparece: botão "Bora?" no topo dos canais do servidor e no "Ativo agora"; o cartão com o contador ao vivo
// ("3/5 topam") fica no topo dos canais do servidor e no "Ativo agora"; o aviso com Tô dentro / Mais tarde / Hoje não
// chega na hora; "Formou!" e "Começou" trazem o Entrar. Outro dia: abre a criação de evento já preenchida.
import { h, icon, avatar } from './util.js';
import { S, api, tryApi, toast, notify, modal, savePrefs } from './state.js';
import { playSound } from './sounds.js';
import { gameIcon, activityOf, gameTitle } from './activity.js';

const ctx = {}; // injetado por app.js: go, joinVoice, channelById, guild, redraw(), eventModal(gid, pre), voice()
export const initBora = (c) => Object.assign(ctx, c);
S.bora = new Map();
let clock = null;

// ---------------------------------------------------------------- estado
export const LIVE = (b) => b && b.state !== 'ended' && b.ends_at > Date.now();
export async function loadBora() {
  const r = await api('GET', '/bora').catch(() => null); if (!Array.isArray(r)) return;
  S.bora.clear(); for (const b of r) S.bora.set(b.id, b); changed();
}
function apply(b) { S.bora.set(b.id, b); changed(); }
function changed() {
  ctx.redraw?.();
  for (const el of document.querySelectorAll('.bora-card[data-id]')) { const b = S.bora.get(el.dataset.id); if (b) el.replaceWith(boraCard(b, { compact: el.classList.contains('compact') })); }
  const bn = document.getElementById('bora-banner'); if (bn) { const b = S.bora.get(bn.dataset.id); if (!LIVE(b) || (bn.dataset.kind === 'new' && b.me && b.me !== 'author')) bn.remove(); }
  clearTimeout(clock); // some sozinho quando vence
  const next = Math.min(...[...S.bora.values()].filter(LIVE).map(b => b.ends_at));
  if (Number.isFinite(next)) clock = setTimeout(changed, Math.max(1000, next - Date.now() + 500));
}
export const liveIn = (gid) => [...S.bora.values()].filter(b => LIVE(b) && (!gid || b.guild.id === gid)).sort((a, b) => (a.me === 'author' ? -1 : 0) - (b.me === 'author' ? -1 : 0) || b.created_at - a.created_at);

// ---------------------------------------------------------------- eventos do servidor
export function onBoraEvent(t, d) {
  if (t === 'BORA_ANSWER') { playSound('friend'); toast(`${d.user.display_name} topou · ${d.label}`); return; }
  apply(d);
  if (t === 'BORA_NEW' && S.me.status !== 'dnd') banner(d, 'new');
  if ((t === 'BORA_FORMED' || t === 'BORA_START') && d.channel) banner(d, t === 'BORA_FORMED' ? 'formed' : 'start');
}

// ---------------------------------------------------------------- textos
const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const boraTitle = (b) => `${b.game ? `Bora ${b.game.name}` : 'Bora resenhar'}${b.starts_at ? ` às ${hhmm(b.starts_at)}` : ''}?`;
const countText = (b) => `${b.in.length}/${b.min} ${b.in.length === 1 ? 'topa' : 'topam'}`;
function statusText(b) {
  if (!LIVE(b)) return b.end_reason === 'canceled' ? 'Cancelado' : b.state === 'formed' || b.formed_at ? 'Já foi' : 'Não formou a tempo';
  if (b.state === 'formed') return `Formou! Sala ${b.channel?.name || ''}${b.starts_at && b.starts_at > Date.now() ? ` · começa às ${hhmm(b.starts_at)}` : ''}`;
  const miss = b.min - b.in.length;
  return miss > 0 ? `${countText(b)} · falta${miss > 1 ? 'm' : ''} ${miss}` : `${countText(b)} · forma perto das ${hhmm(b.starts_at)}`;
}
const faces = (users, n = 6) => h('span.bora-faces', users.slice(0, n).map(u => avatar(S.users.get(u.id) || u, 22, { status: false })), users.length > n && h('small', `+${users.length - n}`));
const gIcon = (b, size) => b.game ? gameIcon({ platform: b.game.appid ? 'steam' : 'pc', game: { id: b.game.appid || b.game.name, title: b.game.name } }, size) : h('span.bora-chat', icon('voice', Math.round(size * .7)));

// ---------------------------------------------------------------- ações
async function answer(b, state, btn) {
  if (btn) btn.disabled = true;
  try { const r = await api('POST', `/bora/${b.id}/answer`, { state }); apply(r); if (state === 'in') toast(r.state === 'formed' ? `Formou! Sala ${r.channel?.name || ''}` : `Você está dentro · ${countText(r)}`); }
  catch (e) { toast(e.message, true); if (e.data?.bora) apply(e.data.bora); else loadBora(); if (btn) btn.disabled = false; }
}
async function cancel(b) { const r = await tryApi('POST', `/bora/${b.id}/cancel`); if (r) apply(r); }
async function enter(b) {
  document.getElementById('bora-banner')?.remove();
  if (!b.channel) return;
  for (let i = 0; i < 20 && !ctx.channelById?.(b.channel.id); i++) await new Promise(r => setTimeout(r, 100));
  ctx.go?.(b.guild.id, b.channel.id); ctx.joinVoice?.(b.channel.id);
}
const inCall = (b) => b.channel && ctx.voice?.()?.channelId === b.channel.id;

// ---------------------------------------------------------------- cartão (contador ao vivo)
export function boraCard(b, { compact = false } = {}) {
  const live = LIVE(b), formed = b.state === 'formed', mine = b.me === 'author', pct = Math.min(100, Math.round(100 * b.in.length / b.min));
  const btn = (st, label, ic, cls) => h('button.btn.sm' + cls + (b.me === st ? '.on' : ''), { onclick: (e) => answer(b, st, e.currentTarget), 'aria-pressed': String(b.me === st) }, ic && icon(ic, 14), label);
  return h('div.bora-card' + (compact ? '.compact' : '') + (formed ? '.formed' : '') + (!live ? '.done' : ''), { 'data-id': b.id },
    h('div.bora-head', gIcon(b, compact ? 28 : 36), h('div.bora-who', h('b', boraTitle(b)), h('small', mine ? `Você chamou${compact ? '' : ' · ' + b.guild.name}` : `${b.author.display_name} chamou${compact ? '' : ' · ' + b.guild.name}`))),
    b.note && h('div.bora-note', `“${b.note}”`),
    h('div.bora-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': b.min, 'aria-valuenow': b.in.length, title: countText(b) }, h('i', { style: { width: pct + '%' } })),
    h('div.bora-row', faces(b.in), h('small.bora-st', statusText(b)), b.later.length > 0 && h('small.bora-later', { title: b.later.map(u => u.display_name).join(', ') }, `${b.later.length} mais tarde`)),
    live && h('div.bora-btns',
      formed && b.channel && !inCall(b) && h('button.btn.green.sm', { onclick: () => enter(b) }, icon('voice', 14), 'Entrar'),
      !mine && !formed && [btn('in', 'Tô dentro', 'check', '.green'), btn('later', 'Mais tarde', 'clock', '.grey'), btn('out', 'Hoje não', null, '.link')],
      !mine && formed && b.me !== 'in' && btn('in', 'Tô dentro', 'check', '.grey'),
      mine && h('button.btn.link.sm', { onclick: () => cancel(b) }, 'Cancelar')));
}

// ---------------------------------------------------------------- avisos
function banner(b, kind) {
  document.getElementById('bora-banner')?.remove();
  const title = kind === 'new' ? `${b.author.display_name}: ${boraTitle(b)}` : kind === 'formed' ? `Formou! ${boraTitle(b).replace(/\?$/, '')}` : `Começou: ${boraTitle(b).replace(/\?$/, '')}`;
  const sub = kind === 'new' ? `${countText(b)} · ${b.guild.name}${b.note ? ' · “' + b.note + '”' : ''}` : `Sala ${b.channel?.name || ''} · ${b.in.map(u => u.display_name).join(', ')}`;
  const el = h('div#bora-banner.callinv.inbanner.bora-banner' + (kind !== 'new' ? '.formed' : ''), { 'data-id': b.id, 'data-kind': kind }, kind === 'new' ? avatar(S.users.get(b.author.id) || b.author, 48, { status: false }) : h('span.in-bigic', icon('users', 26)),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('b', title), h('div.cbsub', sub)),
    h('div.ib-btns', kind === 'new'
      ? [h('button.btn.link', { onclick: () => { answer(b, 'out'); el.remove(); } }, 'Hoje não'), h('button.btn.grey', { onclick: () => { answer(b, 'later'); el.remove(); } }, 'Mais tarde'),
        h('button.btn.green', { onclick: () => { answer(b, 'in'); el.remove(); } }, icon('check', 14), 'Tô dentro')]
      : [h('button.btn.grey', { onclick: () => el.remove() }, 'Depois'), h('button.btn.green', { onclick: () => enter(b) }, icon('voice', 14), 'Entrar')]));
  document.body.append(el); playSound(kind === 'new' ? 'friend' : 'event');
  notify(title, sub, () => (kind === 'new' ? ctx.go?.(b.guild.id) : enter(b)));
  setTimeout(() => { if (document.getElementById('bora-banner') === el) el.remove(); }, kind === 'new' ? 60000 : 90000);
}

// ---------------------------------------------------------------- janela "Bora?"
// gid: servidor (sem: o aberto, ou escolhe). pre: { game: { name, appid } | null }
export async function openBoraModal(gid, pre = {}) {
  const guilds = [...S.guilds.values()];
  if (!guilds.length) return toast('Entre num servidor para chamar a turma.', true);
  gid = gid && S.guilds.has(gid) ? gid : (S.view.gid && S.guilds.has(S.view.gid) ? S.view.gid : guilds[0].id);
  const mineLive = liveIn(gid).find(b => b.me === 'author');
  if (mineLive) { toast('Você já chamou a turma deste servidor: o cartão está no topo dos canais.'); ctx.go?.(gid); return; }
  const st = { gid, game: pre.game === undefined ? undefined : pre.game, when: 'now', at: null, min: 3, note: '' };
  const body = h('div.bora-modal');
  // jogos sugeridos: o que estou jogando agora + o que a galera do servidor mais joga + "Só resenhar"
  let sug = [];
  const loadSug = async () => {
    const out = [], seen = new Set(), add = (name, appid) => { const k = String(name || '').toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push({ name, appid: appid || null }); };
    const a = activityOf(S.me.id); if (a) add(gameTitle(a), a.platform === 'steam' ? a.game.id : a.game.steam);
    const r = await tryApi('GET', `/guilds/${st.gid}/games`); for (const x of r?.games || []) add(gameTitle(x), x.platform === 'steam' ? x.game.id : x.game.steam);
    sug = out.slice(0, 7); if (st.game === undefined) st.game = sug[0] || null; drawChips();
  };
  const typed = h('input', { maxLength: 60, placeholder: 'Outro jogo…', 'aria-label': 'Nome do jogo', oninput: (e) => { st.game = e.target.value.trim() ? { name: e.target.value.trim(), appid: null } : null; drawChips(); } });
  const gameRow = h('div.bora-chips'), whenRow = h('div.bora-chips'), minRow = h('div.bora-chips');
  const time = h('input', { type: 'time', 'aria-label': 'Horário', onchange: (e) => { const [hh, mm] = e.target.value.split(':').map(Number); if (!Number.isFinite(hh)) return; const d = new Date(); d.setHours(hh, mm || 0, 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1); st.when = 'time'; st.at = d.getTime(); drawChips(); } });
  const note = h('input', { maxLength: 120, placeholder: 'Recado (opcional): "ranked até meia-noite"', oninput: (e) => { st.note = e.target.value; } });
  const chip = (on, label, fn, extra) => h('button.bora-chip' + (on ? '.on' : ''), { type: 'button', onclick: fn, 'aria-pressed': String(!!on) }, extra, label);
  const sameGame = (g) => st.game && g && String(st.game.name).toLowerCase() === String(g.name).toLowerCase();
  const drawChips = () => {
    gameRow.replaceChildren(chip(st.game === null, 'Só resenhar', () => { st.game = null; typed.value = ''; drawChips(); }, icon('voice', 14)),
      ...sug.map(g => chip(sameGame(g), g.name, () => { st.game = g; typed.value = ''; drawChips(); }, gameIcon({ platform: g.appid ? 'steam' : 'pc', game: { id: g.appid || g.name, title: g.name } }, 16))), typed);
    // horários: agora, daqui a 30 min, e as próximas horas cheias até meia-noite (no máximo 4)
    const opts = [['now', null, 'Agora'], ['30', Date.now() + 30 * 60e3, 'Em 30 min']];
    for (let i = 1, d = new Date(); opts.length < 6 && i <= 6; i++) { const x = new Date(d); x.setMinutes(0, 0, 0); x.setHours(d.getHours() + i); if (x - Date.now() < 45 * 60e3) continue; if (x.getDate() !== d.getDate() && x.getHours() > 1) break; opts.push(['h' + x.getHours(), x.getTime(), `${x.getHours()}h`]); }
    whenRow.replaceChildren(...opts.map(([k, at, l]) => chip(st.when === k, l, () => { st.when = k; st.at = at; time.value = ''; drawChips(); })),
      h('label.bora-time' + (st.when === 'time' ? '.on' : ''), icon('clock', 14), time),
      chip(false, 'Outro dia…', () => { m.close(); ctx.eventModal?.(st.gid, { title: st.game ? st.game.name : 'Resenha', game: st.game?.name || '' }); }, icon('calendar', 14)));
    minRow.replaceChildren(...[2, 3, 4, 5, 6].map(n => chip(st.min === n, n === 2 ? '2 (eu + 1)' : String(n), () => { st.min = n; drawChips(); })));
  };
  const guildSel = guilds.length > 1 && h('select.bora-guild', { 'aria-label': 'Servidor', onchange: (e) => { st.gid = e.target.value; st.game = undefined; loadSug(); } }, guilds.map(g => h('option', { value: g.id, selected: g.id === st.gid }, g.name)));
  const send = h('button.btn.green', { onclick: async () => {
    send.disabled = true;
    try {
      const b = await api('POST', `/guilds/${st.gid}/bora`, { game: st.game?.name || null, appid: st.game?.appid || null, at: st.when === 'now' ? null : st.at, min: st.min, note: st.note || null });
      apply(b); m.close(); toast(`Bora enviado para ${S.guilds.get(st.gid)?.name || 'a turma'}. O contador aparece no topo dos canais.`); playSound('event');
    } catch (e) { toast(e.message, true); if (e.data?.bora) apply(e.data.bora); send.disabled = false; }
  } }, icon('megaphone', 16), 'Mandar o Bora');
  body.append(
    guildSel && h('label.f', 'Turma (servidor)', guildSel),
    h('div.bora-sec', h('b', 'O quê'), gameRow),
    h('div.bora-sec', h('b', 'Quando'), whenRow),
    h('div.bora-sec', h('b', 'Quantos precisam topar (com você)'), minRow),
    note,
    h('p.bora-hint', 'Todo mundo do servidor vê o contador e responde Tô dentro, Mais tarde ou Hoje não. Quando o número bate, avisamos quem topou com a sala para entrar.'),
    h('div.bora-foot', send));
  const m = modal('Bora?', 'Chame a turma para jogar ou só resenhar', body, [], { width: 'min(560px, 96vw)' });
  m.el.querySelector('.mf')?.remove();
  drawChips(); loadSug();
}

// ---------------------------------------------------------------- Configurações → Notificações
export function boraPrefsBlock({ section, row, seg, toggle }) {
  const box = h('div.card2');
  const topicIn = h('input', { value: S.prefs.pushTopic || '', maxLength: 64, placeholder: 'ex.: resenha-ana-7k2q9x', spellcheck: false, 'aria-label': 'Tópico do ntfy' });
  const newTopic = () => 'resenha-' + Array.from(crypto.getRandomValues(new Uint8Array(9)), x => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
  const out = h('div.bora-pushout');
  const saveTopic = () => { const v = topicIn.value.trim(); if (v && !/^[A-Za-z0-9_-]{12,64}$/.test(v)) { out.textContent = 'Use de 12 a 64 letras, números, - ou _ (sem espaço).'; return false; } S.prefs.pushTopic = v || undefined; if (!v) delete S.prefs.pushTopic; savePrefs(); return true; };
  topicIn.addEventListener('change', () => { if (saveTopic()) out.textContent = topicIn.value ? 'Salvo.' : 'Avisos no celular desligados.'; });
  const test = h('button.btn.grey.sm', { onclick: async () => {
    if (!topicIn.value.trim()) { topicIn.value = newTopic(); }
    if (!saveTopic()) return; test.disabled = true; out.textContent = 'Mandando…';
    try { await api('POST', '/me/push-test', { topic: topicIn.value.trim() }); out.textContent = 'Mandei! Se não chegou, confira se o celular assinou exatamente esse tópico no app ntfy.'; }
    catch (e) { out.textContent = 'Não consegui mandar: ' + e.message; } finally { test.disabled = false; }
  } }, 'Testar');
  const copy = h('button.btn.grey.sm', { onclick: () => { if (!topicIn.value.trim()) { topicIn.value = newTopic(); saveTopic(); } navigator.clipboard?.writeText(topicIn.value.trim()).then(() => (out.textContent = 'Tópico copiado.'), () => { }); } }, 'Gerar e copiar');
  box.append(
    row('Avisos de "Bora?"', 'Quando alguém do servidor chama a turma: aviso com som e as respostas Tô dentro / Mais tarde / Hoje não. "Formou!" chega sempre que você topou.',
      seg({ all: 'Avisar', off: 'Só o cartão' }, S.prefs.boraNotify === 'off' ? 'off' : 'all', (v) => { S.prefs.boraNotify = v; savePrefs(); })),
    h('div.bora-push',
      h('b', 'Avisos no celular (ntfy)'),
      h('p.hintline', 'Com o Resenha fechado, o "Bora?" e os convites para a call chegam no celular. 1) Instale o app ntfy (Android ou iPhone). 2) Toque em "Gerar e copiar" e assine esse tópico no ntfy. 3) Toque em Testar. O tópico funciona como uma senha: não compartilhe. Com Não perturbe ligado, nada chega.'),
      h('div.bora-topic', topicIn, copy, test), out,
      row('No celular: Bora', 'Chamaram a turma, formou e começou (até 8 avisos por dia).', toggle(S.prefs.pushBora !== false, (v) => { S.prefs.pushBora = v; savePrefs(); })),
      row('No celular: convites para a call', 'Alguém chamou você para a sala ou para jogar.', toggle(S.prefs.pushInvites !== false, (v) => { S.prefs.pushInvites = v; savePrefs(); }))));
  return [section('Bora? e celular'), box];
}
