// Registro de auditoria › Mensagens: mensagens editadas e excluídas nos canais do servidor (server/msglog.js).
// Filtros por tipo, canal, pessoa e período, busca no texto, comparação antes/depois das editadas (no texto ou lado a
// lado) e, para quem gerencia o servidor, quanto tempo o registro fica guardado.
import { h, icon, avatar, stamp, busy, debounce } from './util.js';
import { tryApi, toast, nameOf, user, guild, can, PERM, confirmBox } from './state.js';
import { seg } from './ui.js';

// comparação por palavras (maior subsequência comum). Textos muito longos: só antes/depois, sem marcar
const words = (s) => String(s || '').split(/(\s+)/).filter(x => x !== '');
export function diffWords(a, b) {
  const A = words(a), B = words(b);
  if (A.length * B.length > 160000) return null;
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, s) => { const last = out[out.length - 1]; if (last && last[0] === t) last[1] += s; else out.push([t, s]); };
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++]); else push('+', B[j++]);
  }
  while (i < A.length) push('-', A[i++]); while (j < B.length) push('+', B[j++]);
  return out;
}
const diffEl = (a, b) => { const d = diffWords(a, b); return d ? h('div.ml-text.ml-diff', d.map(([t, s]) => t === '=' ? s : h(t === '-' ? 'del' : 'ins', s))) : h('div.ml-text', b); };

const PERIOD = { 1: '24 h', 7: '7 dias', 30: '30 dias', 0: 'Tudo' };
const KIND = { all: 'Tudo', edit: 'Editadas', delete: 'Excluídas' };
const KEEP = { 0: 'Desligado', 7: '7 dias', 30: '30 dias', 90: '90 dias', 180: '180 dias' };

export function msglogPanel(gid) {
  const g = guild(gid), f = { kind: 'all', channel: '', user: '', period: '0', q: '' }, names = new Map();
  const nm = (id) => (id && g?.members?.has(id) ? nameOf(id, gid) : names.get(id)?.display_name || user(id).display_name || 'Usuário excluído');
  const av = (id) => avatar(names.get(id) || user(id), 32, { status: false });
  const box = h('div.ml-list'), more = h('button.btn.grey.ml-more', { hidden: true }, 'Carregar mais');
  const keepBox = h('div.ml-keep'), note = h('div.hintline');
  const chans = (g?.channels || []).filter(c => c.type === 0 || c.type === 2 || c.type === 5 || c.type === 15 || c.type === 16).sort((a, b) => (a.position || 0) - (b.position || 0));
  const people = [...(g?.members?.keys?.() || [])].map(id => [id, nameOf(id, gid)]).sort((a, b) => a[1].localeCompare(b[1]));
  const sel = (k, first, opts) => h('select.ml-sel', { 'aria-label': first, onchange: (e) => { f[k] = e.target.value; load(); } }, h('option', { value: '' }, first), opts.map(([v, l]) => h('option', { value: v }, l)));
  const q = h('input.ml-q', { type: 'search', placeholder: 'Buscar no texto das mensagens', oninput: debounce((e) => { f.q = e.target.value.trim(); load(); }, 300) });

  const entry = (e) => {
    const self = e.actor_id === e.author_id, ch = h('b.ml-ch', '#' + (e.channel_name || 'canal'));
    const who = e.kind === 'edit' ? [h('b', nm(e.author_id)), ' editou uma mensagem em ', ch]
      : self ? [h('b', nm(e.author_id)), ' apagou a própria mensagem em ', ch]
        : [h('b', nm(e.actor_id)), ' apagou uma mensagem de ', h('b', nm(e.author_id)), ' em ', ch];
    let side = false; const body = h('div.ml-body');
    const drawBody = () => body.replaceChildren(e.kind === 'delete'
      ? h('div.ml-text.ml-gone', e.before || h('i', 'Sem texto (só anexo ou conteúdo não disponível)'))
      : side ? h('div.ml-cmp', h('div', h('small', 'Antes'), h('div.ml-text', e.before)), h('div', h('small', 'Depois'), h('div.ml-text', e.after)))
        : diffEl(e.before, e.after));
    drawBody();
    return h('div.ml-entry.ml-' + e.kind,
      h('div.ml-head', av(e.kind === 'delete' && !self ? e.actor_id : e.author_id),
        h('div.ml-who', h('span', ...who), h('small', stamp(e.created_at), e.kind === 'delete' && h('span.ml-by', ' · responsável: ', h('b', self ? 'o próprio autor' : nm(e.actor_id))))),
        h('span.ml-tag', icon(e.kind === 'edit' ? 'edit' : 'trash', 14), e.kind === 'edit' ? 'Editada' : 'Excluída'),
        e.kind === 'edit' && h('button.btn.grey.sm.ml-mode', { type: 'button', onclick: (ev) => { side = !side; ev.currentTarget.textContent = side ? 'Ver no texto' : 'Lado a lado'; drawBody(); } }, 'Lado a lado')),
      body);
  };
  let seq = 0;
  async function load(before) {
    const my = before ? seq : ++seq;
    const p = new URLSearchParams();
    if (f.kind !== 'all') p.set('kind', f.kind);
    if (f.channel) p.set('channel', f.channel);
    if (f.user) p.set('user', f.user);
    if (+f.period) p.set('from', String(Date.now() - f.period * 864e5));
    if (f.q) p.set('q', f.q);
    if (before) p.set('before', before);
    const r = await tryApi('GET', `/guilds/${gid}/msglog?${p}`); if (!r || my !== seq) return;
    for (const u of r.users) names.set(u.id, u);
    if (!before) { box.replaceChildren(); drawKeep(r); }
    box.append(...r.entries.map(entry));
    more.hidden = r.entries.length < 50;
    more.onclick = () => busy(more, load(r.entries.at(-1).id));
    if (!box.children.length) box.append(h('div.ml-empty', icon('clock', 28), h('p', !r.keep_days ? 'O registro de mensagens está desligado neste servidor.' : f.q || f.channel || f.user || f.kind !== 'all' || +f.period ? 'Nada encontrado com esses filtros.' : 'Nenhuma mensagem editada ou excluída ainda.')));
  }
  function drawKeep(r) {
    note.textContent = r.keep_days ? `Cada registro fica guardado por ${r.keep_days} dias e depois é apagado. Os registros não podem ser alterados. Conversas diretas nunca entram.` : 'Registro desligado: mensagens editadas e excluídas não são guardadas.';
    keepBox.replaceChildren(r.can_configure ? h('label.f', 'Guardar o registro de mensagens por', seg(KEEP, String(r.keep_days), async (v) => {
      if (+v === 0 && !await confirmBox('Desligar o registro de mensagens', 'Desligar apaga todos os registros de mensagens deste servidor.', 'Desligar')) return load();
      if (await tryApi('PATCH', `/guilds/${gid}/msglog`, { days: +v })) { toast(+v ? `Registro guardado por ${v} dias` : 'Registro de mensagens desligado'); load(); }
    })) : '');
  }
  load();
  return h('div.ml',
    h('div.ml-filters',
      h('div.ml-kind', seg(KIND, f.kind, (v) => { f.kind = v; load(); })),
      sel('channel', 'Todos os canais', chans.map(c => [c.id, '#' + c.name])),
      sel('user', 'Todas as pessoas', people),
      h('select.ml-sel', { 'aria-label': 'Período', onchange: (e) => { f.period = e.target.value; load(); } }, Object.entries(PERIOD).map(([v, l]) => h('option', { value: v, selected: v === f.period }, l))),
      q),
    box, more, note, keepBox);
}
export const canMsgLog = (gid) => can(gid, PERM.VIEW_MSGLOG);
